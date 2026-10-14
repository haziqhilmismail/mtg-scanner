import type { Batch, CardRowData, Settings } from './types.ts';

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

export function generateBatchId(): string {
  return 'b' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// Short relative time ("just now", "5m ago", "2h ago", "3d ago"). Used for
// the CK pricelist freshness chip in the masthead, but generic enough that
// any other "when was this last updated" indicator can reuse it.
type TFn = (k: string, vars?: Record<string, string | number>) => string;
export function formatRelativeTime(epochSeconds: number, t: TFn): string {
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
    const overrideRaw = batch.priceOverride[origIdx];
    const hasOverride = overrideRaw != null && overrideRaw !== '';
    // CK is the only price source. If the chosen side has no CK row we don't
    // auto-price — the user must enter manually. Skipping applyRounding here
    // is what bypasses the RM 1 floor and surfaces "needs price" so we never
    // ship a fake RM 1 sticker on something we couldn't actually look up.
    const ckSourceMatched = isFoil
      ? sel.price_source_foil === 'cardkingdom'
      : sel.price_source_normal === 'cardkingdom';
    const autoPrice = ckSourceMatched ? applyRounding(usd * mult, settings) : 0;
    const needsPrice = !hasOverride && (isManual || !ckSourceMatched);
    const unitPrice = hasOverride
      ? (parseFloat(overrideRaw as string) || 0)
      : needsPrice ? NaN : autoPrice;
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
