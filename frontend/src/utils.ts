import type { Batch, Candidate, CardRowData, Credits, DetectedCard, PillOffset, ScanUiState, Settings } from './types.ts';
import type { T } from './i18n.ts';

export function fmt2(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function applyRounding(price: number, settings: Settings): number {
  let p = Number(price) || 0;
  const dir = settings.roundDirection;
  if (dir !== 'none') {
    const step = settings.roundStep;
    // Multiply / divide via inverse to dodge FP noise on 0.1 / 0.5 steps —
    // 0.1 + 0.2 === 0.30000000000000004, etc.
    const inv = 1 / step;
    // Snap the product's own noise away before rounding: 12.5 × 4.4 is
    // 55.00000000000001, which would otherwise round "up" to 56.
    const x = Math.round(p * inv * 1e6) / 1e6;
    if (dir === 'up') p = Math.ceil(x) / inv;
    else if (dir === 'down') p = Math.floor(x) / inv;
    else p = Math.round(x) / inv;
  }
  if (p < settings.minPrice) p = settings.minPrice;
  return p;
}

// Format a numeric price as a display string.
//
// - `showCents: true`  → always 2 decimals ("RM21.00")
// - `showCents: false` → smart decimals:
//     - integer values render without decimals ("RM21")
//     - values with actual cents preserve them ("RM20.97")
//
// The smart-decimals behaviour matters for *user overrides*: when the user
// types `20.97`, they want to see `RM20.97`, not `RM21`. Auto-rounded prices
// from `applyRounding` end up as integers under the default `up_1` rounding
// so they still render cleanly without cents.
export function formatMyr(price: number, settings: Settings): string {
  const n = Number(price);
  if (isNaN(n)) {
    return settings.showCurrency ? `${settings.currencyLabel} —` : '—';
  }
  let decimals: number;
  if (settings.showCents) {
    decimals = 2;
  } else {
    // Round to the nearest cent to absorb tiny FP noise (e.g. 1.0000000001).
    const rounded = Math.round(n * 100) / 100;
    decimals = Number.isInteger(rounded) ? 0 : 2;
  }
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return settings.showCurrency ? `${settings.currencyLabel}${formatted}` : formatted;
}

// What is printed on a card's price pill: "RM58", "RM58 ×2". One function so
// the on-screen preview and the exported image can't drift apart.
export function pillLabel(
  cd: { unitPrice: number; isFoil: boolean; qty: number },
  settings: Settings,
): string {
  const unit = formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings);
  return cd.qty > 1 ? `${unit} ×${cd.qty}` : unit;
}

export function formatMyrWithFoil(price: number, isFoil: boolean, settings: Settings): string {
  const base = formatMyr(price, settings);
  if (isFoil && settings.foilStyle === 'suffix') return base + 'F';
  return base;
}

// CK's working search URL — matches what their site emits when you submit the
// top search bar. `?search=header` is CK's "search context" param;
// `filter[name]=...` is the actual query. Brackets are pre-encoded so any
// intermediate proxy/normalization sees a stable URL.
export function ckSearchUrl(name: string): string {
  if (!name) return '';
  return `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(name)}`;
}

// A card's identity on its photo: listings record the bbox they came from.
export const bboxKey = (bbox: number[]) => bbox.join(',');

// The cards a photo's Add would put on the checklist (visible and priced)
// that are not on it yet.
export function notAdded(batch: Batch, cards: CardRowData[]): CardRowData[] {
  return cards.filter(cd => !cd.removed && cd.unitPrice > 0 && !batch.listed.includes(bboxKey(cd.card.bbox)));
}

// A failed scan of a photo picked in this session can run again. Saved scans
// loaded from the server have no file.
export function canRetry(b: Batch): b is Batch & { file: File } {
  return b.status === 'error' && b.file != null;
}

// What a scanned card becomes on the checklist. One function for adding a
// card, adding a whole photo and saving claims, so they can't drift apart.
// With no direct CK product URL the listing gets a CK search-by-name link.
export function listingFields(cd: CardRowData) {
  const sel = cd.sel;
  const ck = (cd.isFoil ? (sel.ck_url_foil || sel.ck_url_normal) : (sel.ck_url_normal || sel.ck_url_foil))
    || ckSearchUrl(sel.name || '');
  return {
    name: sel.name || '(unknown)',
    scryfall_id: sel.scryfall_id || null,
    set_code: sel.set || null,
    set_name: sel.set_name || null,
    collector_number: sel.collector_number || null,
    rarity: sel.rarity || null,
    is_foil: cd.isFoil,
    image_url: sel.image_url || null,
    ck_url: ck || null,
    unit_price_myr: cd.unitPrice.toFixed(2),
    qty_total: cd.qty,
  };
}

// A photo still scanning (or failed before saving) has no scanId yet and counts as newest; `|| 0` ties two of them.
const newestFirst = (a: Batch, b: Batch) => (b.scanId ?? Infinity) - (a.scanId ?? Infinity) || 0;

export const PHOTO_SORTS = {
  newest: newestFirst,
  oldest: (a: Batch, b: Batch) => newestFirst(b, a),
  name: (a: Batch, b: Batch) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }) || newestFirst(a, b),
};
export type PhotoSort = keyof typeof PHOTO_SORTS;

export const sortPhotos = <T extends { batch: Batch }>(items: T[], sort: PhotoSort) =>
  [...items].sort((a, b) => PHOTO_SORTS[sort](a.batch, b.batch));

// Scryfall stores multiple sizes; for zoom we want the higher-res "large" variant
export function upgradeScryfallImage(url: string): string {
  if (!url) return url;
  return url.replace('/normal/', '/large/').replace('/small/', '/large/');
}

// For dense grids (the printings modal) prefer the small variant — 146x204
// JPEGs are ~30KB vs 125KB for normal, which avoids stutter when a card has
// 50+ printings.
export function smallScryfallImage(url: string): string {
  if (!url) return url;
  return url.replace('/normal/', '/small/').replace('/large/', '/small/');
}

// The images in a paste (Ctrl/⌘+V), named for when they were pasted.
export function pastedImages(e: ClipboardEvent): File[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return Array.from(e.clipboardData?.items ?? [])
    .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    .map(i => i.getAsFile())
    .filter((f): f is File => !!f)
    .map(f => new File([f], `pasted-${stamp}.${(f.type.split('/')[1] || 'png').split('+')[0]}`, { type: f.type }));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function generateBatchId(): string {
  return 'b' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// Short relative time ("just now", "5m ago", "2h ago", "3d ago"). Used for
// the CK pricelist freshness chip in the masthead, but generic enough that
// any other "when was this last updated" indicator can reuse it.
export function formatRelativeTime(epochSeconds: number, t: T): string {
  const diffMs = Date.now() - epochSeconds * 1000;
  if (diffMs < 0) return t('relative_now');  // clock skew → "just now"
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('relative_now');
  if (diffMin < 60) return t('relative_min', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('relative_hr', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  return t('relative_day', { n: diffDay });
}

export function rarityKey(rarity: string | undefined | null): string {
  const r = (rarity || '').toLowerCase();
  if (r === 'common' || r === 'uncommon' || r === 'rare' || r === 'mythic') return r;
  if (r) return 'special';
  return '';
}

// Derive per-card pricing/quantity/foil rows for a scanned batch. Pure transform —
// used by ActiveBatchView's render memo AND by Scanner's bulk handlers (which need
// to run "add to checklist" / "export" against batches that aren't currently active).
export function computeCardData(batch: Batch, settings: Settings): CardRowData[] {
  if (!batch.response) return [];
  return batch.response.cards.map((c, origIdx) => {
    const sel = c.candidates[0] || ({} as never);
    const isManual = !!sel._manual;
    const isFoil = batch.isFoil[origIdx] ?? false;
    const removed = !!batch.removed[origIdx];
    const usd = isFoil ? (sel.usd_foil || sel.usd || 0) : (sel.usd || 0);
    const globalMult = isFoil ? settings.multFoil : settings.multNormal;
    const multRaw = batch.multOverride[origIdx];
    const hasMultOverride = multRaw != null && !isNaN(multRaw);
    const mult = hasMultOverride ? (multRaw as number) : globalMult;
    const qty = Math.max(1, batch.quantity[origIdx] || 1);
    // A box holding only "." (or nothing) is no price yet, not RM0.
    const override = parseFloat(batch.priceOverride[origIdx] ?? '');
    const hasOverride = !isNaN(override);
    // CK is the only price source. If the chosen side has no CK row we don't
    // auto-price — the user must enter manually. Skipping applyRounding here
    // is what bypasses the RM 1 floor and surfaces "needs price" so we never
    // ship a fake RM 1 sticker on something we couldn't actually look up.
    const ckSourceMatched = isFoil
      ? sel.price_source_foil === 'cardkingdom'
      : sel.price_source_normal === 'cardkingdom';
    const autoPrice = ckSourceMatched ? applyRounding(usd * mult, settings) : 0;
    const needsPrice = !hasOverride && (isManual || !ckSourceMatched);
    const unitPrice = hasOverride ? override : needsPrice ? NaN : autoPrice;
    const lineTotal = isFinite(unitPrice) ? unitPrice * qty : 0;
    const source = isManual
      ? 'manual'
      : (isFoil
        ? (sel.price_source_foil || 'none')
        : (sel.price_source_normal || 'none')) as CardRowData['source'];
    return {
      card: c, sel, origIdx, removed,
      isFoil, isManual, needsPrice,
      usd, mult, globalMult, hasMultOverride,
      autoPrice, qty, unitPrice, hasOverride, lineTotal, source,
      pillOffset: batch.pillOffset?.[origIdx] ?? null,
    };
  });
}

// Per-card state for a scan nobody has edited yet: foil and quantity seeded
// from Gemini's guesses, no overrides.
export function freshState(cards: DetectedCard[]): ScanUiState {
  const n = cards.length;
  return {
    isFoil: cards.map(c => !!c.gemini?.is_foil),
    priceOverride: new Array(n).fill(null),
    quantity: cards.map(c => Math.max(1, c.gemini?.quantity || 1)),
    multOverride: new Array(n).fill(null),
    removed: new Array(n).fill(false),
    pillOffset: new Array(n).fill(null),
    versionOk: new Array(n).fill(false),
    picks: new Array(n).fill(null),
  };
}

const VALID: { [K in Exclude<keyof ScanUiState, 'rev'>]: (v: unknown) => boolean } = {
  isFoil: v => typeof v === 'boolean',
  priceOverride: v => v === null || typeof v === 'string',
  quantity: v => Number.isInteger(v) && (v as number) >= 1,
  multOverride: v => v === null || (Number.isFinite(v) && (v as number) >= 0),
  removed: v => typeof v === 'boolean',
  pillOffset: v => v === null || (Number.isFinite((v as PillOffset)?.dx) && Number.isFinite((v as PillOffset)?.dy)),
  versionOk: v => typeof v === 'boolean',
  picks: v => v === null || typeof (v as Candidate)?.name === 'string',
};

// A scan's saved per-card state, made safe to use: one entry per card, each
// valid entry kept and anything missing or malformed (another device saved
// before a card was framed, an older version, a bad write) taken from
// freshState. Its rev is kept if it is an integer.
export function normalizeUiState(raw: unknown, cards: DetectedCard[]): ScanUiState {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const state = freshState(cards);
  if (Number.isInteger(saved.rev)) state.rev = saved.rev as number;
  for (const k of Object.keys(VALID) as (keyof typeof VALID)[]) {
    const arr = saved[k];
    if (!Array.isArray(arr)) continue;
    (state[k] as unknown[]).forEach((_, i, out) => { if (i < arr.length && VALID[k](arr[i])) out[i] = arr[i]; });
  }
  return state;
}

// When the oldest free scan comes back, as a short date ('' if none is due).
export function nextFreeDate(credits: Credits | null, lang: string): string {
  return credits?.next_free_at
    ? new Date(credits.next_free_at).toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short' })
    : '';
}

// Why there are no scans left and when the next one returns: on the upload
// area, and in Claims, whose claim reading costs a scan.
export function creditsOutText(credits: Credits, t: T, lang: string): string {
  const date = nextFreeDate(credits, lang);
  return date ? t('credits_out_body', { date, limit: credits.limit }) : t('credits_out_body_plain', { limit: credits.limit });
}
