import type { T } from '../i18n/index.ts';
import { stepText } from './money.ts';
import { DEFAULT_SETTINGS, type Settings } from '../types.ts';

// Pricing is the Settings object. The server keeps it as opaque JSON: one per
// post (null = follow the default) and one per user (the default, null =
// none yet). Missing keys (an older shape) fall back to DEFAULT_SETTINGS.

// The pricing a post's photos are priced with. Unfiled photos pass null.
export function resolvePricing(
  postPricing: Partial<Settings> | null | undefined,
  userDefault: Partial<Settings> | null,
): Settings {
  return { ...DEFAULT_SETTINGS, ...(postPricing ?? userDefault ?? {}) };
}

// What the page knows: the user's default (null = none set, the built-in
// default applies) and each post's own pricing (null = follows the default).
export interface PricingState {
  userDefault: Settings | null;
  // Posts from the server's post lists (and posts made here).
  posts: Record<number, Settings | null>;
}

// Whether a post's (or, for null, the default's) pricing is known. Unknown,
// its prices show the default, but it can't be edited: a save replaces the
// whole pricing, so it would wipe the fields the server has and this page
// doesn't. The default comes with /me, so it is always known.
export const pricingKnown = (s: PricingState, postId: number | null) => postId == null || postId in s.posts;

// The state with a post's (or, for null, the default's) whole pricing
// replaced, and the default too when asked; null while that pricing isn't known.
export function savePricing(s: PricingState, postId: number | null, pricing: Settings, alsoDefault: boolean): PricingState | null {
  if (!pricingKnown(s, postId)) return null;
  const next = postId != null ? { ...s, posts: { ...s.posts, [postId]: pricing } } : { ...s, userDefault: pricing };
  return alsoDefault ? { ...next, userDefault: pricing } : next;
}

// A live post prices each card when its buyer's total is sent, not on the photo.
export const isLive = (s: Pick<Settings, 'priceMode'>) => s.priceMode === 'live';

// Whether two pricings price and label photos the same.
export const samePricing = (a: Settings, b: Settings) =>
  (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every(k => a[k] === b[k]);

// The roundings applyRounding does, in the order the Rounding dropdown lists them.
type Rounding = Pick<Settings, 'roundDirection' | 'roundStep'>;
export const ROUNDINGS: Rounding[] = [
  ...(['up', 'nearest', 'down'] as const).flatMap(roundDirection => ([1, 0.5, 0.1] as const).map(roundStep => ({ roundDirection, roundStep }))),
  { roundDirection: 'none', roundStep: 1 },
];
export const roundingKey = (r: Rounding) => (r.roundDirection === 'none' ? 'none' : `${r.roundDirection} ${r.roundStep}`);

// A rounding in words: as a summary ("Round up to RM 1"), a dropdown option
// ("Up to RM 1"), or a clause of the formula ("rounded up to the nearest RM 1").
export const roundingText = (r: Rounding, s: Settings, t: T, form: 'summary' | 'option' | 'formula') =>
  t(`round_${form}_${r.roundDirection}`, { step: stepText(r.roundStep, s) });

// "×2.5 · Foil ×2.8 · Round up to RM 1"
export const pricingSummary = (s: Settings, t: T) =>
  `×${s.multNormal} · ${t('foil_on')} ×${s.multFoil} · ${roundingText(s, s, t, 'summary')}`;

// "Final price = Card Kingdom retail USD × multiplier, rounded up to the nearest RM 1, never below RM 1."
export const formulaLine = (s: Settings, t: T) => [
  t('formula_start'),
  roundingText(s, s, t, 'formula'),
  s.minPrice > 0 ? t('formula_min', { min: stepText(s.minPrice, s) }) : '',
].filter(Boolean).join(', ') + '.';

// The pricing fields typed as text, each with what it accepts: a multiplier
// from 1 to 5, a whole minimum price from 0 to 50.
const decimal = (lo: number, hi: number) => (text: string) => {
  const v = /^(\d+\.?\d*|\.\d+)$/.test(text.trim()) ? Number(text) : NaN;
  return v >= lo && v <= hi ? v : null;
};
const PRICE_FIELDS = {
  multNormal: decimal(1, 5),
  multFoil: decimal(1, 5),
  minPrice: (text: string) => (/^\d+$/.test(text.trim()) ? decimal(0, 50)(text) : null),
};
export type PriceField = keyof typeof PRICE_FIELDS;

// A field's number as typed, or null when it doesn't accept it. The saved
// value passes as it is: an older one (×0.8, RM 0.50) needs no fixing before
// other changes can be saved.
export const priceField = (field: PriceField, text: string, saved: Settings): number | null =>
  (text.trim() === String(saved[field]) ? saved[field] : PRICE_FIELDS[field](text));
