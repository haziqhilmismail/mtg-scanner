// Data older versions of the app kept in the browser, and what each becomes
// now that the server keeps it. Each section says when it can be deleted. All
// four formats stopped being written on 14 and 15 Oct 2026; a browser that
// has not opened the app since then still holds them.

import { updateListing } from '../api/listings.ts';
import { statusOf } from '../api/http.ts';
import { DEFAULT_SETTINGS, type Batch, type RoundDirection, type RoundStep, type Settings } from '../types.ts';
import { readTombstones, storage, writeTombstones } from './storage.ts';

// ---- A scan's per-card edits, before they were saved on the scan ----------
// `mtg.batchstate.<scan id>`. A scan the server has no state for starts from
// it, the save queue uploads it, and it is removed once a save of that scan
// succeeds. Delete this once every browser that edited a scan before 14 Oct
// 2026 has opened the app since (say, from April 2027).

const batchStateKey = (scanId: number) => `mtg.batchstate.${scanId}`;
export const localBatchState = (scanId: number): unknown => storage.getJson(batchStateKey(scanId), null);
export const forgetLocalBatchState = (scanId: number) => storage.remove(batchStateKey(scanId));

// ---- Delete tombstones, before they were per user ------------------------
// `mtg.scan_tombstones`: scan ids deleted here whose server DELETE was not
// confirmed. Every user honours them and takes over those that are its scans;
// the rest stay for the next user. Delete this once no browser can hold a
// delete from before 14 Oct 2026 (say, from April 2027).

const OLD_TOMBSTONES = 'mtg.scan_tombstones';
export const sharedTombstones = () => readTombstones(OLD_TOMBSTONES);
export const keepSharedTombstones = (ids: number[]) => writeTombstones(OLD_TOMBSTONES, new Set(ids));

// ---- Pricing, before it moved to the server ------------------------------
// `mtg.settings` (+ `mtg.settings.v`): the browser's pricing. It becomes the
// user's default once, only when the server has none, and the browser's copy
// goes once the server has one. Delete this (and legacyPricing) once every
// browser that set a pricing before 14 Oct 2026 has opened the app since
// (say, from April 2027).

const LEGACY_PRICING = 'mtg.settings';
const LEGACY_PRICING_VERSION = 'mtg.settings.v';

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

// The browser's old pricing to make the default: only when the server has none.
export const pricingToUpload = (serverDefault: Settings | null | undefined): Settings | null =>
  (serverDefault == null ? legacyPricing(storage.get(LEGACY_PRICING), storage.get(LEGACY_PRICING_VERSION)) : null);
export const forgetLegacyPricing = () => { storage.remove(LEGACY_PRICING); storage.remove(LEGACY_PRICING_VERSION); };

// ---- Added-to-checklist markers, before listings knew their photo --------
// `mtg.scanner.added.<user id>.<scan id>` (before that, without the user id):
// scan id -> card index -> listing id. Listings now record their photo on the
// server. This ties each remembered listing to its photo there, then forgets
// the marker. Delete this once every browser that added cards before 15 Oct
// 2026 has opened the app since (say, from April 2027).

const MARKER = /^mtg\.scanner\.added\.(?:[^.]+\.)?(\d+)$/;

// Markers of scans not in `batches` (another account's) are left alone. A
// marker whose listing is gone is dropped; one that fails otherwise is kept
// for the next load, and its card still shows as added so Add can't
// duplicate it meanwhile.
export async function migrateAdded(batches: Batch[], onListed: (batchId: string, bbox: number[]) => void) {
  for (const key of storage.keys()) {
    const scanId = Number(MARKER.exec(key)?.[1]);
    const batch = batches.find(b => b.scanId === scanId);
    if (!batch?.response) continue;
    const marker = storage.getJson<Record<string, number> | null>(key, {}) ?? {};
    let keep = false;
    for (const [idx, listingId] of Object.entries(marker)) {
      const card = batch.response.cards[Number(idx)];
      if (!card || typeof listingId !== 'number') continue;
      try {
        await updateListing(listingId, { scan_id: scanId, bbox: card.bbox });
        onListed(batch.id, card.bbox);
      } catch (e) {
        if (statusOf(e) !== 404) { keep = true; onListed(batch.id, card.bbox); }
      }
    }
    if (!keep) storage.remove(key);
  }
}
