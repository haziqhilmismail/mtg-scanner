import type { T } from '../i18n/index.ts';
import { DEFAULT_SETTINGS, type RoundDirection, type RoundStep, type Settings } from '../types.ts';

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

// Where the browser kept pricing before it moved to the server.
export const LEGACY_KEY = 'mtg.settings';
export const LEGACY_VERSION_KEY = 'mtg.settings.v';

// The browser's old saved pricing, brought up to date; null when there is none.
// v1 -> v2: labelPosition default changed from 'bottom' to 'center'.
// v2 -> v3: `rounding: RoundingMode` (e.g. 'up_1') split into `roundDirection`
// + `roundStep`. Old combined value is parsed and dropped.
export function legacyPricing(raw: string | null, versionRaw: string | null): Settings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings> & { rounding?: string };
    if (!parsed || typeof parsed !== 'object') return null;
    const { rounding: legacyRounding, ...rest } = parsed;
    const merged: Settings = { ...DEFAULT_SETTINGS, ...rest };
    const version = parseInt(versionRaw || '1', 10) || 1;
    if (version < 2 && parsed.labelPosition === 'bottom') merged.labelPosition = 'center';
    if (version < 3 && typeof legacyRounding === 'string') {
      // Old format: 'none' | '{up|down|nearest}_{0.5|1}'
      if (legacyRounding === 'none') {
        merged.roundDirection = 'none';
      } else {
        const [dir, stepStr] = legacyRounding.split('_');
        if ((['up', 'down', 'nearest'] as RoundDirection[]).includes(dir as RoundDirection)) {
          merged.roundDirection = dir as RoundDirection;
        }
        const step = parseFloat(stepStr) as RoundStep;
        if (([0.1, 0.5, 1] as RoundStep[]).includes(step)) merged.roundStep = step;
      }
    }
    return merged;
  } catch {
    return null;
  }
}

// The one-time move: the browser's old pricing becomes the default only when
// the server has none. Returns what to upload, or null.
export function defaultToUpload(serverDefault: Settings | null | undefined, legacy: Settings | null): Settings | null {
  return serverDefault == null ? legacy : null;
}

// What the page knows: the user's default (null = none set, the built-in
// default applies) and each post's own pricing (null = follows the default).
export interface PricingState {
  userDefault: Settings | null;
  // Whether /me has said what the default is.
  defaultKnown: boolean;
  // Posts from the server's post lists (and posts made here).
  posts: Record<number, Settings | null>;
}

// Whether a post's (or, for null, the default's) pricing is known. Unknown,
// its prices show the default, but it can't be edited: a save replaces the
// whole pricing, so it would wipe the fields the server has and this page doesn't.
export const pricingKnown = (s: PricingState, postId: number | null) =>
  postId == null ? s.defaultKnown : postId in s.posts;

// The state with a post's (or, for null, the default's) whole pricing
// replaced, and the default too when asked; null while that pricing isn't known.
export function savePricing(s: PricingState, postId: number | null, pricing: Settings, alsoDefault: boolean): PricingState | null {
  if (!pricingKnown(s, postId)) return null;
  const next = postId != null ? { ...s, posts: { ...s.posts, [postId]: pricing } } : { ...s, userDefault: pricing };
  return alsoDefault ? { ...next, userDefault: pricing } : next;
}

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

// An amount of the pricing's currency, as settings show it: "RM 1", "RM 0.50".
const money = (n: number, s: Settings) => `${s.currencyLabel.trim() || 'RM'} ${Number.isInteger(n) ? n : n.toFixed(2)}`;

// A rounding in words: as a summary ("Round up to RM 1"), a dropdown option
// ("Up to RM 1"), or a clause of the formula ("rounded up to the nearest RM 1").
export const roundingText = (r: Rounding, s: Settings, t: T, form: 'summary' | 'option' | 'formula') =>
  t(`round_${form}_${r.roundDirection}`, { step: money(r.roundStep, s) });

// "×2.5 · Foil ×2.8 · Round up to RM 1"
export const pricingSummary = (s: Settings, t: T) =>
  `×${s.multNormal} · ${t('foil_on')} ×${s.multFoil} · ${roundingText(s, s, t, 'summary')}`;

// "Final price = Card Kingdom retail USD × multiplier, rounded up to the nearest RM 1, never below RM 1."
export const formulaLine = (s: Settings, t: T) => [
  t('formula_start'),
  roundingText(s, s, t, 'formula'),
  s.minPrice > 0 ? t('formula_min', { min: money(s.minPrice, s) }) : '',
].filter(Boolean).join(', ') + '.';

// The pricing fields typed as text, each with what it accepts: a multiplier
// from 1 to 5, a whole minimum price from 0 to 50.
const decimal = (lo: number, hi: number) => (text: string) => {
  const v = /^(\d+\.?\d*|\.\d+)$/.test(text.trim()) ? Number(text) : NaN;
  return v >= lo && v <= hi ? v : null;
};
export const PRICE_FIELDS = {
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
