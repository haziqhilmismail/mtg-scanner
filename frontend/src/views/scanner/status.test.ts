import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshState } from '../../lib/scanState.ts';
import { DEFAULT_SETTINGS, type Batch, type Candidate, type DetectedCard } from '../../types.ts';
import { photoStatus, postStatus } from './status.ts';

const ck = { name: 'Sol Ring', usd: 2, price_source_normal: 'cardkingdom' } as Candidate;
const noCk = { name: 'Proxy', usd: 0, price_source_normal: 'none' } as Candidate;
const card = (x: number, sel: Candidate) => ({ candidates: [sel], bbox: [x, 0, 5, 5] } as DetectedCard);

// Four cards: one listed, one priced and not listed, one with no CK price, one removed.
function photo(o: Partial<Batch> = {}): Batch {
  const cards = [card(0, ck), card(10, ck), card(20, noCk), card(30, ck)];
  return {
    id: 'b', scanId: 1, postId: 7, position: null, listed: ['0,0,5,5'], filename: 'a.jpg', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards },
    ...freshState(cards), removed: [false, false, false, true],
    ...o,
  };
}

const photoMode = { ...DEFAULT_SETTINGS, priceMode: 'photo' as const, multNormal: 5 };
const live = { ...photoMode, priceMode: 'live' as const };

test("a photo's cards, total and what still waits on it", () => {
  const { batch, ...s } = photoStatus(photo(), photoMode);
  assert.equal(batch.id, 'b');
  assert.deepEqual(s, {
    cards: 3, total: 20, unpriced: 1, pending: 1, inPost: 1, unpricedOut: 1, waits: true,
    names: ['Sol Ring', 'Sol Ring', 'Proxy'],
  });
});

test('a price-on-photo photo stops waiting once Finish locks it; a live one once every priced card is in', () => {
  assert.equal(photoStatus(photo({ lockedAt: '2026-11-01T00:00:00Z' }), photoMode).waits, false);
  assert.equal(photoStatus(photo(), live).waits, true);
  assert.equal(photoStatus(photo({ listed: ['0,0,5,5', '10,0,5,5'] }), live).waits, false);
  // Not saved yet: nothing for the seller to do on it.
  assert.equal(photoStatus(photo({ scanId: null }), photoMode).waits, false);
});

test('a post adds up its photos; a failed scan is one more thing to fix', () => {
  const failed = photoStatus(photo({ id: 'f', scanId: null, status: 'error', response: null }), live);
  const scanning = photoStatus(photo({ id: 's', scanId: null, status: 'scanning', response: null }), live);
  const { waiting, ...s } = postStatus([photoStatus(photo(), live), failed, scanning]);
  assert.deepEqual(waiting.map(w => w.batch.id), ['b']);
  assert.deepEqual(s, { cards: 3, total: 20, unpriced: 1, priced: 2, toFix: 2, scanning: 1, saved: 1, pending: 1 });
});
