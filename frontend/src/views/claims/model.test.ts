import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Buyer } from '../../api/buyers.ts';
import type { Order, OrderItem } from '../../api/orders.ts';
import type { Payment } from '../../api/payment.ts';
import { translate, type T } from '../../i18n/index.ts';
import { computeCardData, freshState, lockPrices } from '../../lib/scanState.ts';
import { DEFAULT_SETTINGS, type Candidate, type DetectedCard } from '../../types.ts';
import {
  buyerGroups, buyerMessage, claimedCounts, claimTotals, dueForSupportAsk, priceFormula, rm, sortGroups, sortScreenshots, stampsFor,
  type BuyerGroup, type Line,
} from './model.ts';

const en: T = (k, v) => translate('en', k, v);
const ms: T = (k, v) => translate('ms', k, v);
const AT = '2026-10-22T08:00:00Z';
const NOW = '2026-10-24T09:30:00Z';

const line = (over: Partial<Line>): Line => ({ id: 1, name: 'Opt', qty: 1, each: 1, formula: null, photo: null, crop: null, live: false, ...over });
const AMBITION = line({ id: 1, name: 'Increasing Ambition', each: 12, formula: { usd: 4.49, mult: 2.5 }, photo: 7 });
const GLADE = line({ id: 2, name: 'Deathcap Glade', qty: 2, each: 13, formula: { usd: 4.99, mult: 2.5 }, photo: 3 });
const PAYMENT: Payment = {
  bank_name: 'Maybank', bank_account_number: '0000 0000 0000', bank_account_holder: 'Your name',
  payment_note: 'Send the receipt here after paying', qr_version: null,
};
const NO_PAYMENT: Payment = { bank_name: '', bank_account_number: '', bank_account_holder: '', payment_note: '', qr_version: null };

test('the buyer message follows the template character for character', () => {
  assert.equal(buyerMessage('Aina', [AMBITION, GLADE], PAYMENT, false, en), [
    'Aina',
    'Increasing Ambition — $4.49 × 2.5 → RM12',
    'Deathcap Glade ×2 — $4.99 × 2.5 → RM13 each = RM26',
    '',
    '*Total: RM38*',
    '',
    'Payment: Maybank 0000 0000 0000 (Your name)',
    'Send the receipt here after paying',
  ].join('\n'));
});

test('with no payment details the message ends at the total', () => {
  assert.equal(buyerMessage('Aina', [AMBITION], NO_PAYMENT, false, en), 'Aina\nIncreasing Ambition — $4.49 × 2.5 → RM12\n\n*Total: RM12*');
  assert.equal(buyerMessage('Aina', [AMBITION], null, false, en), 'Aina\nIncreasing Ambition — $4.49 × 2.5 → RM12\n\n*Total: RM12*');
  // Only the note: no Payment line.
  assert.equal(buyerMessage('Aina', [AMBITION], { ...NO_PAYMENT, payment_note: 'COD ok' }, false, en),
    'Aina\nIncreasing Ambition — $4.49 × 2.5 → RM12\n\n*Total: RM12*\n\nCOD ok');
});

test('a price no formula gives is sent without one, and cents and thousands read as RM', () => {
  const typed = line({ id: 3, name: 'Sol Ring', qty: 2, each: 15.5 });
  const crypt = line({ id: 4, name: 'Mana Crypt', each: 560, formula: { usd: 199.99, mult: 2.8 } });
  const vial = line({ id: 5, name: 'Æther Vial', each: 3640, formula: { usd: 1299.99, mult: 2.8 } });
  assert.equal(buyerMessage('  Hafiz   Rahman ', [typed, crypt, vial, line({ id: 6, name: 'Opt', each: 1 })], null, false, en), [
    'Hafiz Rahman',
    'Sol Ring ×2 — RM15.50 each = RM31',
    'Mana Crypt — $199.99 × 2.8 → RM560',
    'Æther Vial — $1,299.99 × 2.8 → RM3,640',
    'Opt — RM1',
    '',
    '*Total: RM4,232*',
  ].join('\n'));
  assert.equal(buyerMessage('Jo', [AMBITION], null, true, en), 'Jo\nIncreasing Ambition — $4.49 × 2.5 → RM12.00\n\n*Total: RM12.00*');
});

test('in Malay the message says Jumlah, seunit and Pembayaran', () => {
  assert.equal(buyerMessage('Aina', [GLADE], PAYMENT, false, ms), [
    'Aina',
    'Deathcap Glade ×2 — $4.99 × 2.5 → RM13 seunit = RM26',
    '',
    '*Jumlah: RM26*',
    '',
    'Pembayaran: Maybank 0000 0000 0000 (Your name)',
    'Send the receipt here after paying',
  ].join('\n'));
});

test('RM has no space, commas for thousands and cents only when they count', () => {
  assert.deepEqual([rm(13), rm(1240), rm(15.5), rm(13, true), rm(12.999), rm(0)], ['RM13', 'RM1,240', 'RM15.50', 'RM13.00', 'RM13', 'RM0']);
});

test('Mark paid keeps a drop-off already made; picking a status sets it outright', () => {
  const credit = { paid_at: null, delivered_at: AT };
  assert.deepEqual(stampsFor(credit, 'markPaid', NOW), { paid_at: NOW, delivered_at: AT });
  assert.deepEqual(stampsFor(credit, 'paid', NOW), { paid_at: NOW, delivered_at: null });
  assert.deepEqual(stampsFor({ paid_at: AT, delivered_at: null }, 'done', NOW), { paid_at: AT, delivered_at: NOW });
  assert.deepEqual(stampsFor({ paid_at: AT, delivered_at: AT }, 'unpaid', NOW), { paid_at: null, delivered_at: null });
});

test('the formula shows only while it gives the price charged', () => {
  const cd = { usd: 3.6, mult: 2.5, autoPrice: 9, hasOverride: false };
  assert.deepEqual(priceFormula(cd, 9), { usd: 3.6, mult: 2.5 });
  assert.equal(priceFormula(cd, 10), null);                          // the price moved after the claim
  assert.equal(priceFormula({ ...cd, hasOverride: true }, 9), null); // typed price
  assert.equal(priceFormula({ ...cd, usd: 0 }, 9), null);            // no CK price
});

// Orders as the server sends them: newest first.
const item = (id: number, listing_id: number, qty = 1): OrderItem => ({
  id, order_id: 0, listing_id, qty, unit_price_myr: '10.00', line_total_myr: (10 * qty).toFixed(2),
  name_snapshot: `Card ${listing_id}`, set_snapshot: null, created_at: AT,
});
const order = (id: number, buyer_id: number, items: OrderItem[], over: Partial<Order> = {}): Order => ({
  id, user_id: 1, buyer_id, status: 'claimed', paid_at: null, delivered_at: null, archived_at: null, prices_sent_at: null,
  total_myr: '0', dropoff_method: null, dropoff_address: null, notes: null,
  items: items.map(i => ({ ...i, order_id: id })), created_at: AT, updated_at: AT, ...over,
});
const buyer = (id: number, fb_name: string, phone: string | null = null): Buyer => ({
  id, user_id: 1, fb_name, fb_url: null, phone, default_dropoff_method: null, default_dropoff_address: null, notes: null, created_at: AT, updated_at: AT,
});
const BUYERS = [buyer(1, 'Tan Wei Jie', '0123456789'), buyer(2, 'Aina 🌸'), buyer(3, 'K')];
// Listings 1-9 are this post's cards; 50 is another post's.
const ORDERS = [
  order(16, 1, [item(160, 5)]),
  order(15, 2, [item(150, 4)], { archived_at: AT }),
  order(14, 3, [item(140, 50)]),
  order(13, 1, [item(130, 3)], { status: 'cancelled' }),
  order(12, 3, [item(120, 2, 3), item(121, 50)], { delivered_at: AT }),
  order(11, 1, [item(110, 1)], { paid_at: AT }),
];
const inPost = (i: OrderItem) => i.listing_id < 10;
const lineOf = (i: OrderItem): Line => line({ id: i.id, name: i.name_snapshot, qty: i.qty, each: 10, photo: 10 - i.listing_id });

test('buyers come in claim order with their cards in claim order; cancelled, archived and other posts left out', () => {
  const groups = buyerGroups(ORDERS, BUYERS, inPost, lineOf);
  assert.deepEqual(groups.map(g => [g.name, g.phone, g.orders.map(o => o.id), g.lines.map(l => l.id), g.total, g.cards, g.state, g.droppedOff]), [
    ['Tan Wei Jie', '0123456789', [11, 16], [110, 160], 20, 2, 'unpaid', false],
    ['K', '', [12], [120], 30, 3, 'unpaid', true],
  ]);
});

test('a buyer stays Unpaid until paid, cards handed over on credit included', () => {
  const stateOf = (...stamps: Array<[string | null, string | null]>) => {
    const orders = stamps.map(([paid_at, delivered_at], k) => order(20 + k, 1, [item(200 + k, 1)], { paid_at, delivered_at }));
    const [g] = buyerGroups(orders, BUYERS, inPost, lineOf);
    return [g.state, g.droppedOff];
  };
  assert.deepEqual(stateOf([null, null]), ['unpaid', false]);
  assert.deepEqual(stateOf([null, AT]), ['unpaid', true]);
  assert.deepEqual(stateOf([AT, null]), ['paid', false]);
  assert.deepEqual(stateOf([AT, AT]), ['done', false]);
  assert.deepEqual(stateOf([AT, AT], [AT, null]), ['paid', false]);
  assert.deepEqual(stateOf([AT, AT], [null, null]), ['unpaid', true]);
});

test('an archived claim still holds its card; a cancelled one frees it', () => {
  const counts = claimedCounts(ORDERS, BUYERS, i => (inPost(i) ? `card${i.listing_id}` : undefined));
  assert.deepEqual([...counts].sort(), [
    ['card1', { qty: 1, names: ['Tan Wei Jie'] }],
    ['card2', { qty: 3, names: ['K'] }],
    ['card4', { qty: 1, names: ['Aina 🌸'] }],
    ['card5', { qty: 1, names: ['Tan Wei Jie'] }],
  ]);
});

const group = (over: Partial<BuyerGroup>): BuyerGroup => ({
  buyerId: 1, name: 'A', phone: '', orders: [], lines: [], total: 0, cards: 0, state: 'unpaid', droppedOff: false, live: false, ...over,
});

test('the totals card: to collect from unpaid buyers, paid from the rest', () => {
  assert.deepEqual(claimTotals([
    group({ total: 38, cards: 3, state: 'unpaid', live: true }),
    group({ total: 70, cards: 2, state: 'paid' }),
    group({ total: 12, cards: 1, state: 'done' }),
  ]), { claimed: 120, paid: 82, toCollect: 38, cards: 6, live: { claimed: true, paid: false, toCollect: true } });
  assert.deepEqual(claimTotals([]), { claimed: 0, paid: 0, toCollect: 0, cards: 0, live: { claimed: false, paid: false, toCollect: false } });
});

test('sorting by name ignores case and stray spaces; by photo puts each buyer under their first photo', () => {
  const groups = [
    group({ buyerId: 1, name: 'tan Wei Jie', lines: [line({ id: 1, photo: 4 }), line({ id: 2, photo: 2 })] }),
    group({ buyerId: 2, name: '  Aina', lines: [line({ id: 3, photo: 7 })] }),
    group({ buyerId: 3, name: 'K', lines: [line({ id: 4, photo: null }), line({ id: 5, photo: 2 })] }),
  ];
  assert.deepEqual(sortGroups(groups, 'claimed').map(g => g.buyerId), [1, 2, 3]);
  assert.deepEqual(sortGroups(groups, 'name').map(g => g.buyerId), [2, 3, 1]);
  const byPhoto = sortGroups(groups, 'photo');
  assert.deepEqual(byPhoto.map(g => [g.buyerId, g.lines.map(l => l.id)]), [[3, [5, 4]], [1, [2, 1]], [2, [3]]]);
});

test('the tip-jar popup waits for the third save, then asks once a month', () => {
  const day = 24 * 3600 * 1000;
  assert.equal(dueForSupportAsk(2, null, 100 * day), false);
  assert.equal(dueForSupportAsk(3, null, 100 * day), true);
  assert.equal(dueForSupportAsk(9, 100 * day, 129 * day), false);
  assert.equal(dueForSupportAsk(9, 100 * day, 130 * day), true);
});

test('a finished photo keeps its prices and their working whatever changes after', () => {
  const sel = { name: 'X', usd: 3.6, price_source_normal: 'cardkingdom' } as Candidate;
  const cards = [{ candidates: [sel] } as DetectedCard, { candidates: [sel] } as DetectedCard];
  const state = { ...freshState(cards), priceOverride: [null, '7'], quantity: [1, 2] };
  const posted = { ...DEFAULT_SETTINGS, multNormal: 2.5, roundDirection: 'up' as const, roundStep: 1 as const };
  const finished = { ...state, locked: lockPrices(computeCardData(cards, state, posted)), lockedAt: '2026-10-23T12:00:00Z' };
  // CK moves and the multiplier changes after posting.
  const moved = [{ candidates: [{ ...sel, usd: 9 }] } as DetectedCard, { candidates: [{ ...sel, usd: 9 }] } as DetectedCard];
  const [ck, typed] = computeCardData(moved, finished, { ...posted, multNormal: 4 });
  assert.equal(ck.unitPrice, 9);
  assert.deepEqual(priceFormula(ck, 9), { usd: 3.6, mult: 2.5 });
  assert.deepEqual([typed.unitPrice, typed.lineTotal], [7, 14]);
  assert.equal(priceFormula(typed, 7), null);
  // Edit prices: the lock no longer counts, so prices follow again.
  assert.equal(computeCardData(moved, { ...finished, lockedAt: null }, { ...posted, multNormal: 4 })[0].unitPrice, 36);
});

test('comment screenshots go to the photo they show, else the one before', () => {
  const seen = (sure: number | null, guess: number | null = null) => ({ sure, guess });
  // Photo 3 with its comments, two scrolls of comments, photo 5 (a guess between look-alikes), then comments.
  assert.deepEqual(sortScreenshots([seen(3), seen(null), seen(null), seen(null, 5), seen(null)], null, 0), [
    { scanId: 3, by: 'found' }, { scanId: 3, by: 'follows' }, { scanId: 3, by: 'follows' },
    { scanId: 5, by: 'guess' }, { scanId: 5, by: 'follows' },
  ]);
  // Comments only, nothing before: every photo. Added later: they follow what is there.
  assert.deepEqual(sortScreenshots([seen(null), seen(null)], null, 0), [{ scanId: 0, by: 'none' }, { scanId: 0, by: 'none' }]);
  assert.deepEqual(sortScreenshots([seen(null)], 7, 0), [{ scanId: 7, by: 'follows' }]);
});
