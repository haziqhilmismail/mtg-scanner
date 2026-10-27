import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Listing, Order } from '../api/checklist.ts';
import type { Batch, DetectedCard } from '../types.ts';
import { freshState } from '../utils.ts';
import { repostPlan } from './repost.ts';

const card = (x: number) => ({ id: x, bbox: [x * 100, 0, 80, 110] }) as unknown as DetectedCard;

const photo = (scanId: number, cards: DetectedCard[], edits: Partial<Batch> = {}): Batch => ({
  id: `s${scanId}`, scanId, postId: 7, position: null, listed: [], filename: '', status: 'done',
  response: { image_id: String(scanId), image_b64: '', width: 1000, height: 800, cards },
  ...freshState(cards), lockedAt: '2026-10-20T10:00:00Z',
  relookupBusy: [], relookupMsg: [],
  ...edits,
});

const listing = (id: number, scanId: number, x: number) => ({ id, scan_id: scanId, bbox: [x * 100, 0, 80, 110] }) as Listing;
const order = (status: Order['status'], items: Array<[number, number]>) =>
  ({ status, items: items.map(([listing_id, qty]) => ({ listing_id, qty })) }) as Order;

test('a repost covers the cards sold out, keeps the copies left, and skips a photo with nothing left', () => {
  const cards = [card(0), card(1), card(2), card(3)];
  const first = photo(1, cards, { quantity: [1, 4, 1, 1], removed: [false, false, true, false] });
  const soldOut = photo(2, [card(0)]);
  const listings = [listing(10, 1, 0), listing(11, 1, 1), listing(12, 2, 0), listing(13, 1, 3)];
  const orders = [
    order('claimed', [[10, 1], [11, 1]]),
    order('claimed', [[11, 1], [12, 1]]),
    order('cancelled', [[13, 1]]),          // a cancelled claim holds nothing
  ];

  const plan = repostPlan([first, soldOut], listings, orders);

  assert.equal(plan.length, 1);
  const [{ scanId, state, left, sold }] = plan;
  assert.deepEqual({ scanId, left, sold }, { scanId: 1, left: 3, sold: 1 });
  assert.deepEqual(state.removed, [true, false, true, false]);
  assert.deepEqual(state.sold, [true, false, false, false]);   // card 2 was removed before, not sold
  assert.deepEqual(state.quantity, [1, 2, 1, 1]);
  assert.equal(state.lockedAt, null);                          // a new post is not finished yet
  assert.deepEqual(state.locked, [null, null, null, null]);
  // The post's own photos are left as they were.
  assert.deepEqual(first.removed, [false, false, true, false]);
  assert.deepEqual(first.quantity, [1, 4, 1, 1]);
});
