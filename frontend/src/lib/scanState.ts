// A scan's per-card edits, saved on the server as the scan's ui_state so every
// device sees the same prices. Parallel arrays, one entry per card, each
// defined once in FIELDS: its value for a card nobody edited yet and what a
// stored entry must look like. The stored key names are read by the backend
// (rev, lockedAt, locked[].price, picks), so renaming one needs a data migration.

import type { Candidate, DetectedCard } from '../types.ts';

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
