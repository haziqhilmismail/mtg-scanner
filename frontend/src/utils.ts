import type { Settings } from './types.ts';

export function fmt2(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function applyRounding(price: number, settings: Settings): number {
  let p = Number(price) || 0;
  const mode = settings.rounding;
  if (mode !== 'none') {
    const [direction, stepStr] = mode.split('_');
    const step = parseFloat(stepStr);
    if (direction === 'up') p = Math.ceil(p / step) * step;
    else if (direction === 'down') p = Math.floor(p / step) * step;
    else p = Math.round(p / step) * step;
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

export function formatMyrWithFoil(price: number, isFoil: boolean, settings: Settings): string {
  const base = formatMyr(price, settings);
  if (isFoil && settings.foilStyle === 'suffix') return base + 'F';
  return base;
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

export function rarityKey(rarity: string | undefined | null): string {
  const r = (rarity || '').toLowerCase();
  if (r === 'common' || r === 'uncommon' || r === 'rare' || r === 'mythic') return r;
  if (r) return 'special';
  return '';
}
