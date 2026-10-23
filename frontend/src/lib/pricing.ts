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

// The state with one setting of a post's (or the default's) pricing changed,
// and the pricing to save; null while that pricing isn't known.
export function editPricing<K extends keyof Settings>(
  s: PricingState, postId: number | null, key: K, value: Settings[K],
): { state: PricingState; pricing: Settings } | null {
  if (!pricingKnown(s, postId)) return null;
  const pricing = { ...resolvePricing(postId != null ? s.posts[postId] : null, s.userDefault), [key]: value };
  const state = postId != null ? { ...s, posts: { ...s.posts, [postId]: pricing } } : { ...s, userDefault: pricing };
  return { state, pricing };
}
