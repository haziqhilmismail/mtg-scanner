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
