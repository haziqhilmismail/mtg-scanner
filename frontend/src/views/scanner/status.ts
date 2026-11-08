// What still needs doing on a photo and on a post, worked out once for the
// posts list, the post page, its photo rows and the photo page.

import type { Batch, Settings } from '../../types.ts';
import { bboxKey, isLive, notAdded } from '../../utils.ts';
import { computeCardData } from '../../lib/scanState.ts';

export interface PhotoStatus {
  batch: Batch;
  cards: number;        // visible (not removed) cards
  total: number;        // priced value of the visible cards
  unpriced: number;     // visible cards with no price yet
  pending: number;      // priced cards not added to the post's card list yet
  inPost: number;       // visible cards on the post's card list
  unpricedOut: number;  // visible cards not on the list that can't go on without a price
  // Saved and still waiting on the seller: on a live post, cards not in the
  // post yet; on a price-on-photo post, prices not locked by Finish.
  waits: boolean;
  names: string[];      // the visible cards' names, for search
}

export function photoStatus(batch: Batch, settings: Settings): PhotoStatus {
  const visible = batch.response ? computeCardData(batch.response.cards, batch, settings).filter(cd => !cd.removed) : [];
  const inPost = (cd: (typeof visible)[number]) => batch.listed.includes(bboxKey(cd.card.bbox));
  const pending = notAdded(batch, visible).length;
  const saved = !!batch.response && batch.scanId != null;
  return {
    batch,
    cards: visible.length,
    total: visible.reduce((sum, cd) => sum + cd.lineTotal, 0),
    unpriced: visible.filter(cd => cd.needsPrice).length,
    pending,
    inPost: visible.filter(inPost).length,
    unpricedOut: visible.filter(cd => !inPost(cd) && !(cd.unitPrice > 0)).length,
    waits: saved && (isLive(settings) ? pending > 0 : !batch.lockedAt),
    names: visible.map(cd => cd.sel.name || ''),
  };
}

export interface PostStatus {
  cards: number;
  total: number;
  unpriced: number;     // cards with no price, over every photo
  priced: number;
  toFix: number;        // cards with no price, plus each photo whose scan failed
  scanning: number;     // photos still scanning
  saved: number;        // photos saved with their cards
  waiting: PhotoStatus[];
  pending: number;      // cards of the waiting photos not in the post yet
}

export function postStatus(photos: PhotoStatus[]): PostStatus {
  const sum = (pick: (s: PhotoStatus) => number) => photos.reduce((n, s) => n + pick(s), 0);
  const waiting = photos.filter(s => s.waits);
  const unpriced = sum(s => s.unpriced);
  const cards = sum(s => s.cards);
  return {
    cards,
    total: sum(s => s.total),
    unpriced,
    priced: cards - unpriced,
    toFix: unpriced + photos.filter(s => s.batch.status === 'error').length,
    scanning: photos.filter(s => s.batch.status === 'scanning').length,
    saved: photos.filter(s => s.batch.response && s.batch.scanId != null).length,
    waiting,
    pending: waiting.reduce((n, s) => n + s.pending, 0),
  };
}
