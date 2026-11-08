// Money as the app works it out and writes it: rounding, the seller's own
// price, and every way an amount is shown.

import type { Settings } from '../types.ts';

// Amounts read the same in every browser, "1,240.50", whatever its locale.
const AMOUNT = [0, 2].map(d => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

export function fmt2(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return '—';
  return AMOUNT[1].format(Number(n));
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

// The label a price field and a rounding step carry; RM when the seller left it blank.
export const currencyOf = (s: Pick<Settings, 'currencyLabel'>) => s.currencyLabel.trim() || 'RM';

type MoneyStyle = Pick<Settings, 'currencyLabel' | 'showCurrency' | 'showCents'> & Partial<Pick<Settings, 'foilStyle'>>;

// A price as the app writes it: "RM13", "RM1,240", and "RM13F" for a foil
// when the foil mark is the F suffix. Cents show when Show cents is on, and
// always when the price has them (a price the seller typed, or a rounding
// step under RM 1): hiding them would show a price nobody pays.
export function formatMyr(price: number, settings: MoneyStyle, isFoil = false): string {
  const n = Number(price);
  let text: string;
  if (isNaN(n)) {
    text = settings.showCurrency ? `${currencyOf(settings)} —` : '—';
  } else {
    // To the cent first, so float noise (1.0000000001) is no cents.
    const cents = !Number.isInteger(Math.round(n * 100) / 100);
    const formatted = AMOUNT[settings.showCents || cents ? 1 : 0].format(n);
    text = settings.showCurrency ? `${currencyOf(settings)}${formatted}` : formatted;
  }
  return isFoil && settings.foilStyle === 'suffix' ? text + 'F' : text;
}

// What is printed on a card's price pill: "RM58", "RM58 ×2". One function so
// the on-screen preview and the exported image can't drift apart.
export function pillLabel(
  cd: { unitPrice: number; isFoil: boolean; qty: number },
  settings: Settings,
): string {
  const unit = formatMyr(cd.unitPrice, settings, cd.isFoil);
  return cd.qty > 1 ? `${unit} ×${cd.qty}` : unit;
}

// A live price is today's: it carries ≈ until the buyer's total is sent
// (DESIGN.md section 7). As text, for a sentence: "auto ≈RM13".
export const approxText = (amount: string, live: boolean) => (live ? `≈${amount}` : amount);

// A rounding step or minimum as the settings text writes it ("RM 1", "RM 0.50"), not a price.
export const stepText = (n: number, s: Settings) => `${currencyOf(s)} ${Number.isInteger(n) ? n : n.toFixed(2)}`;

// A card's own price, as priceOverride stores it: RM as typed ("15.5"), or a
// USD price the multiplier and rounding still apply to ("usd:4.5"). Versions
// before USD prices read "usd:" as no price of the seller's own, and keep it.
export interface PriceOverride { unit: 'rm' | 'usd'; amount: number }
const USD_OVERRIDE = 'usd:';

export function parseOverride(raw: string | null | undefined): PriceOverride | null {
  const usd = !!raw?.startsWith(USD_OVERRIDE);
  const amount = parseFloat((usd ? raw!.slice(USD_OVERRIDE.length) : raw) ?? '');
  return Number.isNaN(amount) ? null : { unit: usd ? 'usd' : 'rm', amount };
}

export const overrideText = (o: PriceOverride | null): string | null =>
  (o ? `${o.unit === 'usd' ? USD_OVERRIDE : ''}${o.amount}` : null);

// A price box as typed: empty (no price of the seller's own), a price above
// 0, or not a price. Commas and spaces are how people write 1,240.
export function readPrice(text: string): number | null | 'invalid' {
  const clean = text.replace(/[,\s]/g, '');
  if (!clean) return null;
  if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(clean)) return 'invalid';
  const n = Number(clean);
  return n > 0 ? n : 'invalid';
}
