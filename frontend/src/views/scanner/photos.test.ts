import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Batch, type Candidate, type DetectedCard } from '../../types.ts';
import type { CardRowData } from '../../lib/scanState.ts';
import { matchThumbs, photoLabel, photoNumbers, sortPhotos, type PhotoSort } from './photos.ts';

test("a post's photos sort newest or oldest with unsaved ones newest, or by name in number order with ties newest first", () => {
  const items = ([
    ['IMG_10.jpg', 3],
    ['img_2.jpg', 1],
    ['IMG_2.JPG', 4],
    ['Opt.jpg', null],
    ['Bolt.jpg', null],
    ['IMG_9.jpg', 2],
  ] as const).map(([filename, scanId], i) => ({ batch: { id: String(i), filename, scanId } as Batch }));
  const ids = (sort: PhotoSort) => sortPhotos(items, sort).map(s => s.batch.id).join(',');
  assert.equal(ids('newest'), '3,4,2,0,5,1');
  assert.equal(ids('oldest'), '1,5,0,2,3,4');
  assert.equal(ids('name'), '4,2,1,5,0,3');
});

test('match thumbnails are the small image of each top candidate, without the empty ones', () => {
  const card = (image_url?: string) => ({ candidates: image_url === undefined ? [] : [{ image_url } as Candidate] } as unknown as DetectedCard);
  const batch = { response: { cards: [
    card('https://cards.scryfall.io/normal/front/a/b/ab.jpg?1'),
    card(''),
    card(),
    card('https://cards.scryfall.io/large/front/c/d/cd.jpg?2'),
  ] } } as Batch;
  assert.deepEqual(matchThumbs(batch), [
    'https://cards.scryfall.io/small/front/a/b/ab.jpg?1',
    'https://cards.scryfall.io/small/front/c/d/cd.jpg?2',
  ]);
  assert.deepEqual(matchThumbs({ response: null } as Batch), []);
});

test('photos are numbered in the order the seller gave them, then oldest scan first', () => {
  const b = (id: string, postId: number | null, scanId: number | null, position: number | null) => ({ id, postId, scanId, position, filename: id } as Batch);
  const batches = [b('new', 1, 9, null), b('c', 1, 3, 0), b('a', 1, 1, 2), b('b', 1, 2, 1), b('scanning', 1, null, null), b('other', 2, 4, null)];
  assert.deepEqual([...photoNumbers(batches)].sort(), [['a', 3], ['b', 2], ['c', 1], ['new', 4], ['other', 1]]);
  const ids = sortPhotos(batches.filter(x => x.postId === 1).map(batch => ({ batch })), 'post').map(s => s.batch.id);
  assert.deepEqual(ids, ['c', 'b', 'a', 'new', 'scanning']);
});

test('a live-price photo labels only what CK does not decide', () => {
  const cd = (o: Partial<CardRowData>) => ({ unitPrice: 9, isFoil: false, qty: 1, needsPrice: false, hasOverride: false, hasMultOverride: false, mult: 2.5, ...o } as CardRowData);
  const s = { ...DEFAULT_SETTINGS, showCurrency: true, currencyLabel: 'RM', showCents: false };
  const live = { ...s, priceMode: 'live' as const };
  assert.equal(photoLabel(cd({}), s), 'RM9');                                   // price on photo: every card
  assert.equal(photoLabel(cd({}), live), '');                                   // live, post rate: nothing
  assert.equal(photoLabel(cd({ hasOverride: true, unitPrice: 12 }), live), 'RM12');
  assert.equal(photoLabel(cd({ hasMultOverride: true, mult: 3 }), live), 'CK ×3');
  // Live: a foil card always carries F, whatever the foil mark setting.
  const gold = { ...live, foilStyle: 'gold' as const };
  assert.equal(photoLabel(cd({ isFoil: true }), gold), 'F');
  assert.equal(photoLabel(cd({ isFoil: true, hasOverride: true, unitPrice: 12 }), gold), 'RM12F');
  assert.equal(photoLabel(cd({ isFoil: true, hasMultOverride: true, mult: 3 }), gold), 'CK ×3 · F');
  assert.equal(photoLabel(cd({ needsPrice: true, unitPrice: NaN }), s), '');
});
