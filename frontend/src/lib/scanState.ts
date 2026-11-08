// A scan's per-card edits, saved on the server as the scan's ui_state so every
// device sees the same prices. Parallel arrays, one entry per card, each
// defined once in FIELDS: its value for a card nobody edited yet and what a
// stored entry must look like. The stored key names are read by the backend
// (rev, lockedAt, locked[].price, picks), so renaming one needs a data migration.

import type { Batch, Candidate, Correction, DetectedCard, PriceSource, Settings } from '../types.ts';
import { applyRounding, parseOverride } from './money.ts';

// Per-card draggable pill offset. The pill default position is derived from
// the bbox + the global label-position setting; this offset (in source image
// pixels) is added on top so the user can pull the pill onto the card when
// the detector's bbox drifted. Null means no override (use the default).
export interface PillOffset {
  dx: number;
  dy: number;
}

// One card's price as a photo was finished. manual: typed in by hand, so it
// has no "USD × multiplier" working to show a buyer.
export interface LockedPrice { price: number; usd: number; mult: number; manual: boolean }

interface Field<V> { fresh: (card: DetectedCard) => V; valid: (v: unknown) => boolean }
const field = <V>(fresh: (card: DetectedCard) => V, valid: (v: unknown) => boolean): Field<V> => ({ fresh, valid });
const bool = (v: unknown) => typeof v === 'boolean';
const none = () => null;

const FIELDS = {
  isFoil: field(c => !!c.gemini?.is_foil, bool),
  priceOverride: field<string | null>(none, v => v === null || typeof v === 'string'),
  quantity: field(c => Math.max(1, c.gemini?.quantity || 1), v => Number.isInteger(v) && (v as number) >= 1),
  multOverride: field<number | null>(none, v => v === null || (Number.isFinite(v) && (v as number) >= 0)),
  removed: field(() => false, bool),
  // Why a removed card went: it sold on an earlier post, so the photo of a
  // repost covers it. Only counts while the card is removed (Restore uncovers).
  sold: field(() => false, bool),
  pillOffset: field<PillOffset | null>(none, v => v === null || (Number.isFinite((v as PillOffset)?.dx) && Number.isFinite((v as PillOffset)?.dy))),
  // The seller said an unsure printing guess (see CardRow) is right.
  versionOk: field(() => false, bool),
  // A card's new first candidate (another printing, a name search, "use as
  // is") not yet written into the saved scan. The server moves it there and
  // drops it from the saved state.
  picks: field<Candidate | null>(none, v => v === null || typeof (v as Candidate)?.name === 'string'),
  // The prices the photo was finished with (added to its post and downloaded
  // or shared), so what buyers saw on Facebook: one per card, null for a card
  // with no price. They count only while lockedAt is set.
  locked: field<LockedPrice | null>(none, v => v === null || (
    Number.isFinite((v as LockedPrice)?.price) && (v as LockedPrice).price > 0
    && Number.isFinite((v as LockedPrice).usd) && Number.isFinite((v as LockedPrice).mult)
    && typeof (v as LockedPrice).manual === 'boolean')),
};

export type CardField = keyof typeof FIELDS;
const CARD_FIELDS = Object.keys(FIELDS) as CardField[];

// One card's entries, as an edit patches them.
export type CardState = { [K in CardField]: ReturnType<typeof FIELDS[K]['fresh']> };

type Columns = { [K in CardField]: CardState[K][] };

export type ScanUiState = Columns & {
  // When the photo was finished. Unset (or null after Edit prices): its prices
  // follow the seller's edits again.
  lockedAt?: string | null;
  // Raised on every save so the server ignores a save that arrives after a
  // newer one. Not a per-card field.
  rev?: number;
};

const perField = (entry: (k: CardField) => unknown[]): Columns => Object.fromEntries(CARD_FIELDS.map(k => [k, entry(k)])) as Columns;
const fresh = (k: CardField, card: DetectedCard) => (FIELDS[k].fresh as (c: DetectedCard) => unknown)(card);

// Per-card state for a scan nobody has edited yet: foil and quantity seeded
// from Gemini's guesses, no overrides.
export const freshState = (cards: DetectedCard[]): ScanUiState => perField(k => cards.map(c => fresh(k, c)));

// The state with one more card at the end, seeded like a fresh one.
export const withCard = <S extends ScanUiState>(state: S, card: DetectedCard): S =>
  ({ ...state, ...perField(k => [...state[k], fresh(k, card)]) });

export function editCardState<S extends ScanUiState>(state: S, idx: number, patch: Partial<CardState>): S {
  const out: Record<string, unknown> = { ...state };
  for (const k of Object.keys(patch) as CardField[]) {
    if (!(k in FIELDS)) continue;
    out[k] = (state[k] as unknown[]).map((cur, i) => (i === idx ? patch[k] : cur));
  }
  return out as S;
}

// What is saved to the server (its rev is added when queued): the per-card
// fields alone, off a Batch or any state.
export const uiStateOf = (s: ScanUiState): ScanUiState => ({ ...perField(k => s[k]), lockedAt: s.lockedAt ?? null });

// A scan's saved per-card state, made safe to use: one entry per card, each
// valid entry kept and anything missing or malformed (another device saved
// before a card was framed, an older version, a bad write) taken from
// freshState. Its rev is kept if it is an integer.
export function normalizeUiState(raw: unknown, cards: DetectedCard[]): ScanUiState {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const state = freshState(cards);
  if (Number.isInteger(saved.rev)) state.rev = saved.rev as number;
  if (typeof saved.lockedAt === 'string' && saved.lockedAt) state.lockedAt = saved.lockedAt;
  for (const k of CARD_FIELDS) {
    const arr = saved[k];
    if (!Array.isArray(arr)) continue;
    (state[k] as unknown[]).forEach((_, i, out) => { if (i < arr.length && FIELDS[k].valid(arr[i])) out[i] = arr[i]; });
  }
  return state;
}

export interface CardRowData {
  card: DetectedCard;
  sel: Candidate;
  origIdx: number;
  removed: boolean;
  sold: boolean;          // removed because it sold before: covered on the photo
  isFoil: boolean;
  isManual: boolean;
  needsPrice: boolean;
  usd: number;
  mult: number;
  globalMult: number;
  hasMultOverride: boolean;
  autoPrice: number;
  qty: number;
  unitPrice: number;
  hasOverride: boolean;
  // The USD price the seller typed for the card (see PriceOverride); null for none or an RM price.
  ownUsd: number | null;
  lineTotal: number;
  source: PriceSource;
  pillOffset: PillOffset | null;
}

// Each card's pricing, quantity and foil row from the scan's cards and the
// seller's per-card edits (a Batch is one).
export function computeCardData(cards: DetectedCard[], batch: ScanUiState, settings: Settings): CardRowData[] {
  return cards.map((c, origIdx) => {
    const sel = c.candidates[0] || ({} as never);
    const isManual = !!sel._manual;
    const isFoil = batch.isFoil[origIdx] ?? false;
    const removed = !!batch.removed[origIdx];
    const sold = removed && !!batch.sold[origIdx];
    const usd = isFoil ? (sel.usd_foil || sel.usd || 0) : (sel.usd || 0);
    const globalMult = isFoil ? settings.multFoil : settings.multNormal;
    const multRaw = batch.multOverride[origIdx];
    const hasMultOverride = multRaw != null && !isNaN(multRaw);
    const mult = hasMultOverride ? (multRaw as number) : globalMult;
    const qty = Math.max(1, batch.quantity[origIdx] || 1);
    // A box holding only "." (or nothing) is no price yet, not RM0.
    const own = parseOverride(batch.priceOverride[origIdx]);
    const hasOverride = own != null;
    // CK is the only price source. If the chosen side has no CK row we don't
    // auto-price — the user must enter manually. Skipping applyRounding here
    // is what bypasses the RM 1 floor and surfaces "needs price" so we never
    // ship a fake RM 1 sticker on something we couldn't actually look up.
    const ckSourceMatched = isFoil
      ? sel.price_source_foil === 'cardkingdom'
      : sel.price_source_normal === 'cardkingdom';
    const autoPrice = ckSourceMatched ? applyRounding(usd * mult, settings) : 0;
    const needsPrice = !hasOverride && (isManual || !ckSourceMatched);
    const ownUsd = own?.unit === 'usd' ? own.amount : null;
    const unitPrice = own ? (ownUsd != null ? applyRounding(ownUsd * mult, settings) : own.amount) : needsPrice ? NaN : autoPrice;
    const lineTotal = isFinite(unitPrice) ? unitPrice * qty : 0;
    // A finished photo keeps the prices buyers saw, whatever CK or the
    // multipliers do since.
    const source = isManual
      ? 'manual'
      : (isFoil
        ? (sel.price_source_foil || 'none')
        : (sel.price_source_normal || 'none')) as CardRowData['source'];
    const row: CardRowData = {
      card: c, sel, origIdx, removed, sold,
      isFoil, isManual, needsPrice,
      usd, mult, globalMult, hasMultOverride,
      autoPrice, qty, unitPrice, hasOverride, ownUsd, lineTotal, source,
      pillOffset: batch.pillOffset?.[origIdx] ?? null,
    };
    // A finished photo keeps the prices buyers saw, whatever CK or the
    // multipliers do since.
    const lock = batch.lockedAt ? batch.locked[origIdx] : null;
    if (!lock) return row;
    return {
      ...row, needsPrice: false, usd: lock.usd, mult: lock.mult,
      autoPrice: lock.manual ? autoPrice : lock.price, unitPrice: lock.price,
      hasOverride: lock.manual, ownUsd: null, lineTotal: lock.price * qty,
      source: lock.manual ? 'manual' : 'cardkingdom',
    };
  });
}

export function correctionFor(batch: Batch, idx: number, picked?: Candidate): Correction | null {
  const card = batch.response?.cards[idx];
  const shown = card?.candidates[0]?.scryfall_id ?? '';
  const scryfallId = picked ? picked.scryfall_id : shown;
  if (batch.scanId == null || !card || !scryfallId) return null;
  return { scanId: batch.scanId, cardId: card.id, scryfallId, kind: !picked || scryfallId === shown ? 'confirm' : 'pick' };
}

// The prices to lock a photo at when it is finished: each kept card's price
// as it stands, and how it was worked out.
export function lockPrices(cards: CardRowData[]): (LockedPrice | null)[] {
  return cards.map(cd => (cd.removed || !(cd.unitPrice > 0) ? null
    : { price: cd.unitPrice, usd: cd.usd, mult: cd.mult, manual: cd.hasOverride }));
}
