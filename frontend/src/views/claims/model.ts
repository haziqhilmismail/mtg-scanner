// What the Claims page knows about a post's claims: where each buyer stands,
// what they owe, and the message they are sent. Pure, so the page and the
// tests read the same rules.

import type { Payment } from '../../api.ts';
import type { Buyer, Order, OrderItem } from '../../api/checklist.ts';
import type { T } from '../../i18n/index.ts';
import type { CardRowData } from '../../types.ts';
import { paymentLines } from '../../utils.ts';

// "1 card", "3 cards": counted strings come as `key` ({n}) and `key_one`.
export const counted = (t: T, key: string, n: number) => t(n === 1 ? `${key}_one` : key, { n: n.toLocaleString('en-MY') });

export type PayState = 'unpaid' | 'paid' | 'done';
export const PAY_STATES: readonly PayState[] = ['unpaid', 'paid', 'done'];

// Unpaid while any order is unpaid (cards handed over on credit included),
// Done once every order is paid and dropped off, else Paid.
export function payState(orders: ReadonlyArray<Pick<Order, 'paid_at' | 'delivered_at'>>): PayState {
  if (orders.some(o => !o.paid_at)) return 'unpaid';
  return orders.every(o => o.delivered_at) ? 'done' : 'paid';
}

export type Stamps = Pick<Order, 'paid_at' | 'delivered_at'>;
// A status picked outright, or Mark paid, which keeps a drop-off already made.
export type StatusMove = PayState | 'markPaid';

export function stampsFor(o: Stamps, to: StatusMove, now: string): Stamps {
  if (to === 'unpaid') return { paid_at: null, delivered_at: null };
  if (to === 'done') return { paid_at: o.paid_at ?? now, delivered_at: o.delivered_at ?? now };
  return { paid_at: o.paid_at ?? now, delivered_at: to === 'paid' ? null : o.delivered_at };
}

// How a card's price was made, while that still gives what the buyer is
// charged: not for a typed price, a card with no CK price, or a live price
// that moved after the claim.
export interface Formula { usd: number; mult: number }
export function priceFormula(cd: Pick<CardRowData, 'hasOverride' | 'usd' | 'mult' | 'autoPrice'>, charged: number): Formula | null {
  if (cd.hasOverride || !(cd.usd > 0) || Math.abs(cd.autoPrice - charged) > 0.005) return null;
  return { usd: cd.usd, mult: cd.mult };
}

// One claimed card, as the page and the message show it.
export interface Line {
  id: number;            // the order item
  name: string;
  qty: number;
  each: number;          // RM a copy, as charged
  formula: Formula | null;
  photo: number | null;  // its photo in the post, when known
  live: boolean;         // a live price the buyer has not been sent yet
}

export interface BuyerGroup {
  buyerId: number;
  name: string;
  phone: string;
  orders: Order[];       // oldest first
  lines: Line[];         // in claim order
  total: number;
  cards: number;
  state: PayState;
  droppedOff: boolean;   // Unpaid, though the cards were handed over
  live: boolean;
}

// Each buyer with claims on the post, in claim order, their lines in claim
// order too. Cancelled and archived orders are left out, and so are items
// from other posts.
export function buyerGroups(
  orders: Order[], buyers: Buyer[],
  inPost: (item: OrderItem) => boolean,
  lineOf: (item: OrderItem, order: Order) => Line,
): BuyerGroup[] {
  const byBuyer = new Map<number, Order[]>();
  for (const o of [...orders].sort((a, b) => a.id - b.id)) {
    if (o.status === 'cancelled' || o.archived_at || !o.items.some(inPost)) continue;
    byBuyer.set(o.buyer_id, [...(byBuyer.get(o.buyer_id) ?? []), o]);
  }
  const people = new Map(buyers.map(b => [b.id, b]));
  return [...byBuyer].map(([buyerId, os]) => {
    const lines = os.flatMap(o => o.items.filter(inPost).map(i => lineOf(i, o)));
    const state = payState(os);
    return {
      buyerId,
      name: people.get(buyerId)?.fb_name ?? `#${buyerId}`,
      phone: people.get(buyerId)?.phone ?? '',
      orders: os,
      lines,
      total: lines.reduce((sum, l) => sum + l.each * l.qty, 0),
      cards: lines.reduce((sum, l) => sum + l.qty, 0),
      state,
      droppedOff: state === 'unpaid' && os.some(o => o.delivered_at),
      live: lines.some(l => l.live),
    };
  });
}

// How many copies of each card are spoken for, and by whom. Every order not
// cancelled counts, archived ones too, so an archived claim keeps its card.
export function claimedCounts(
  orders: Order[], buyers: Buyer[], cardOf: (item: OrderItem) => string | undefined,
): Map<string, { qty: number; names: string[] }> {
  const names = new Map(buyers.map(b => [b.id, b.fb_name]));
  const out = new Map<string, { qty: number; names: string[] }>();
  for (const o of [...orders].sort((a, b) => a.id - b.id)) {
    if (o.status === 'cancelled') continue;
    const name = names.get(o.buyer_id) ?? `#${o.buyer_id}`;
    for (const item of o.items) {
      const key = cardOf(item);
      if (!key) continue;
      const cur = out.get(key) ?? { qty: 0, names: [] };
      cur.qty += item.qty;
      if (!cur.names.includes(name)) cur.names.push(name);
      out.set(key, cur);
    }
  }
  return out;
}

// The totals card. `live` says which sums still hold a price not sent yet.
export function claimTotals(groups: BuyerGroup[]) {
  const sum = (pick: (g: BuyerGroup) => boolean) => groups.filter(pick).reduce((s, g) => s + g.total, 0);
  const owing = (g: BuyerGroup) => g.state === 'unpaid';
  return {
    claimed: sum(() => true),
    paid: sum(g => !owing(g)),
    toCollect: sum(owing),
    cards: groups.reduce((s, g) => s + g.cards, 0),
    live: {
      claimed: groups.some(g => g.live),
      paid: groups.some(g => !owing(g) && g.live),
      toCollect: groups.some(g => owing(g) && g.live),
    },
  };
}

export type ClaimSort = 'claimed' | 'name' | 'photo';
export const CLAIM_SORTS: readonly ClaimSort[] = ['claimed', 'name', 'photo'];

const photoOf = (l: Line) => l.photo ?? Number.MAX_SAFE_INTEGER;
const byName = (a: BuyerGroup, b: BuyerGroup) => a.name.trim().localeCompare(b.name.trim(), undefined, { sensitivity: 'base' });

// Claim order, by name, or by photo: each buyer under their first photo, their
// cards in photo order, so the seller can pull cards photo by photo.
export function sortGroups(groups: BuyerGroup[], sort: ClaimSort): BuyerGroup[] {
  if (sort === 'name') return [...groups].sort(byName);
  if (sort === 'claimed') return groups;
  return groups
    .map(g => ({ ...g, lines: [...g.lines].sort((a, b) => photoOf(a) - photoOf(b)) }))
    .sort((a, b) => photoOf(a.lines[0]) - photoOf(b.lines[0]) || byName(a, b));
}

// RM as buyers read it (DESIGN.md section 7): RM1,240, with cents only when
// the seller shows cents or the amount has them.
export function rm(n: number, cents = false): string {
  const digits = cents || Math.abs(n - Math.round(n)) >= 0.005 ? 2 : 0;
  return 'RM' + n.toLocaleString('en-MY', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// The working of a price: "$4.49 × 2.5".
export const formulaText = (f: Formula) =>
  `$${f.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × ${+f.mult.toFixed(3)}`;

// The message a buyer is sent, built exactly as DESIGN.md section 8 has it:
// each card with the working of its price, the total in *bold* (Messenger
// shows it bold), then how to pay. Empty payment parts are left out.
export function buyerMessage(name: string, lines: Line[], payment: Payment | null, cents: boolean, t: T): string {
  const each = t('claims_copy_each');
  const cards = lines.map(l => {
    const price = l.formula ? `${formulaText(l.formula)} → ${rm(l.each, cents)}` : rm(l.each, cents);
    return l.qty > 1
      ? `${l.name} ×${l.qty} — ${price} ${each} = ${rm(l.each * l.qty, cents)}`
      : `${l.name} — ${price}`;
  });
  const total = lines.reduce((sum, l) => sum + l.each * l.qty, 0);
  const pay = paymentLines(payment, t);
  return [
    name.trim().replace(/\s+/g, ' '), ...cards, '', `*${t('total')}: ${rm(total, cents)}*`,
    ...(pay.length ? ['', ...pay] : []),
  ].join('\n');
}
