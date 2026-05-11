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

export function formatMyr(price: number, settings: Settings): string {
  const decimals = settings.showCents ? 2 : 0;
  const n = Number(price);
  if (isNaN(n)) {
    return settings.showCurrency ? `${settings.currencyLabel} —` : '—';
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

export function generateBatchId(): string {
  return 'b' + Date.now() + Math.random().toString(36).slice(2, 6);
}

export function rarityKey(rarity: string | undefined | null): string {
  const r = (rarity || '').toLowerCase();
  if (r === 'common' || r === 'uncommon' || r === 'rare' || r === 'mythic') return r;
  if (r) return 'special';
  return '';
}
