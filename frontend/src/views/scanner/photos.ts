// A post's photos as the scanner shows them: their order and numbers, the
// label on each card, and the thumbnails their card rows load.

import type { Batch, Settings } from '../../types.ts';
import { pillLabel } from '../../lib/money.ts';
import { isLive } from '../../lib/pricing.ts';
import type { CardRowData } from '../../lib/scanState.ts';

// A photo still scanning (or failed before saving) has no scanId yet and counts as newest; `|| 0` ties two of them.
const newestFirst = (a: Batch, b: Batch) => (b.scanId ?? Infinity) - (a.scanId ?? Infinity) || 0;

// A post's photos in the order the seller gave them (their order on
// Facebook): placed ones first, then the rest oldest scan first, unsaved last.
const lastIfNull = (v: number | null) => v ?? Number.MAX_SAFE_INTEGER;
export const byPostOrder = (a: Batch, b: Batch) =>
  lastIfNull(a.position) - lastIfNull(b.position) || lastIfNull(a.scanId) - lastIfNull(b.scanId);

// "Photo N": each saved photo's number in its post, the same on every page.
export function photoNumbers(batches: Batch[]): Map<string, number> {
  const byPost = new Map<number | null, Batch[]>();
  for (const b of batches) if (b.scanId != null) byPost.set(b.postId, [...(byPost.get(b.postId) ?? []), b]);
  const out = new Map<string, number>();
  for (const list of byPost.values()) [...list].sort(byPostOrder).forEach((b, i) => out.set(b.id, i + 1));
  return out;
}

export const PHOTO_SORTS = {
  post: byPostOrder,
  newest: newestFirst,
  oldest: (a: Batch, b: Batch) => newestFirst(b, a),
  name: (a: Batch, b: Batch) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }) || newestFirst(a, b),
};
export type PhotoSort = keyof typeof PHOTO_SORTS;

export const sortPhotos = <T extends { batch: Batch }>(items: T[], sort: PhotoSort) =>
  [...items].sort((a, b) => PHOTO_SORTS[sort](a.batch, b.batch));

// What a card's label on the photo says ('' = no label), on screen and in the
// exported image alike. A live-price post prints only what CK won't decide:
// an RM price set on the card, or the card's own multiplier. There a foil
// card always says so with F, whatever the foil mark setting: with no price
// on the photo, nothing else tells a buyer it is the foil.
export function photoLabel(cd: CardRowData, settings: Settings): string {
  if (isLive(settings)) {
    if (cd.hasOverride && Number.isFinite(cd.unitPrice)) return pillLabel(cd, { ...settings, foilStyle: cd.isFoil ? 'suffix' : settings.foilStyle });
    const own = cd.hasMultOverride ? `CK ×${cd.mult}` : '';
    return !cd.isFoil ? own : own ? `${own} · F` : 'F';
  }
  if (cd.needsPrice || !Number.isFinite(cd.unitPrice)) return '';
  return pillLabel(cd, settings);
}

// Whether a card's label on the photo is the gold foil pill, on screen and in the exported image alike.
export const goldPill = (cd: { isFoil: boolean }, settings: Settings) => cd.isFoil && settings.foilStyle === 'gold';

// For thumbnails (the printings grid, a card's match image) prefer the small
// variant — 146x204 JPEGs are ~12KB vs ~80KB for normal, which avoids stutter
// when a card has 50+ printings.
export function smallScryfallImage(url: string): string {
  if (!url) return url;
  return url.replace('/normal/', '/small/').replace('/large/', '/small/');
}

// The match images a photo's card rows show (CardRow), so they can be loaded ahead.
export const matchThumbs = (batch: Batch): string[] =>
  (batch.response?.cards ?? []).map(c => c.candidates[0]?.image_url).filter((u): u is string => !!u).map(smallScryfallImage);
