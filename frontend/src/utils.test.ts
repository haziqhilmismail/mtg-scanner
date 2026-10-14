import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Batch, type Candidate, type DetectedCard, type RoundDirection, type RoundStep } from './types.ts';
import { applyRounding, computeCardData, normalizeUiState } from './utils.ts';

const round = (price: number, roundDirection: RoundDirection, roundStep: RoundStep, minPrice = 0) =>
  applyRounding(price, { ...DEFAULT_SETTINGS, roundDirection, roundStep, minPrice });

test('rounding up ignores float noise in the product', () => {
  assert.equal(round(12.5 * 4.4, 'up', 1), 55);      // 55.00000000000001
  assert.equal(round(0.2 * 3, 'up', 0.1), 0.6);      // 0.6000000000000001
  assert.equal(round(0.1 + 0.2, 'up', 0.1), 0.3);    // 0.30000000000000004
});

test('rounding up still rounds real fractions up', () => {
  assert.equal(round(55.01, 'up', 1), 56);
  assert.equal(round(10.2, 'up', 0.5), 10.5);
  assert.equal(round(0.61, 'up', 0.1), 0.7);
});

test('down and nearest', () => {
  assert.equal(round(12.5 * 4.4, 'down', 1), 55);
  assert.equal(round(55.99, 'down', 1), 55);
  assert.equal(round(0.7 * 3, 'down', 0.1), 2.1);    // 2.0999999999999996
  assert.equal(round(10.24, 'nearest', 0.5), 10);
  assert.equal(round(10.25, 'nearest', 0.5), 10.5);
});

test('no rounding, and the minimum price', () => {
  assert.equal(round(12.34, 'none', 1), 12.34);
  assert.equal(round(0.2, 'up', 1, 1), 1);
  assert.equal(round(0.2, 'up', 0.1, 1), 1);
});

test('a price box holding only "." is no price, not RM0', () => {
  const sel = { name: 'X', usd: 10, price_source_normal: 'cardkingdom' } as Candidate;
  const batch: Batch = {
    id: 'b', scanId: 1, postId: null, filename: '', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards: [{ candidates: [sel] } as DetectedCard] },
    isFoil: [false], priceOverride: ['.'], quantity: [1], multOverride: [null], removed: [false], pillOffset: [null],
    relookupBusy: [false], relookupMsg: [null],
  };
  const settings = { ...DEFAULT_SETTINGS, multNormal: 3 };
  assert.equal(computeCardData(batch, settings)[0].unitPrice, 30);
  batch.priceOverride = ['12.5'];
  assert.equal(computeCardData(batch, settings)[0].unitPrice, 12.5);
});

test('saved per-card state is fitted to the cards, entry by entry', () => {
  const card = (is_foil: boolean, quantity?: number) => ({ gemini: { is_foil, quantity } } as DetectedCard);
  const cards = [card(false), card(true, 2), card(false)];
  // Saved by a device that knew two cards, with one bad entry of each kind.
  const saved = {
    isFoil: [true, 'yes'],
    priceOverride: ['5', 7],
    quantity: [0, 3, 4, 9],
    multOverride: [null, 2.5],
    removed: 'no',
    pillOffset: [{ dx: 1, dy: 2 }, { dx: 'x', dy: 0 }],
  };
  assert.deepEqual(normalizeUiState(saved, cards), {
    isFoil: [true, true, false],
    priceOverride: ['5', null, null],
    quantity: [1, 3, 4],
    multOverride: [null, 2.5, null],
    removed: [false, false, false],
    pillOffset: [{ dx: 1, dy: 2 }, null, null],
  });
  assert.deepEqual(normalizeUiState(null, [card(true)]).isFoil, [true]);
});
