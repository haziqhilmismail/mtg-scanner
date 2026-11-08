import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type RoundDirection, type RoundStep } from '../types.ts';
import { applyRounding, fmt2, formatMyr, pillLabel, readPrice } from './money.ts';

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

test('money reads the same in every browser: commas for thousands, cents only when they count', () => {
  const s = { ...DEFAULT_SETTINGS, showCurrency: true, currencyLabel: 'RM', showCents: false };
  assert.equal(formatMyr(13, s), 'RM13');
  assert.equal(formatMyr(12480, s), 'RM12,480');
  assert.equal(formatMyr(15.5, s), 'RM15.50');                                   // a typed price keeps its cents
  assert.equal(formatMyr(13, { ...s, showCents: true }), 'RM13.00');
  assert.equal(formatMyr(12480, { ...s, showCents: true }), 'RM12,480.00');
  assert.equal(fmt2(1299.99), '1,299.99');
  assert.equal(fmt2(0.01), '0.01');
});

test('a typed price is a number above 0 with at most two decimals, or nothing', () => {
  assert.deepEqual(['15', '15.50', '1,240', ' 12 ', '.5', '15.'].map(readPrice), [15, 15.5, 1240, 12, 0.5, 15]);
  assert.equal(readPrice(''), null);
  assert.equal(readPrice('   '), null);
  assert.deepEqual(['0', '0.00', 'abc', '15.555', '1.2.3', '-5', 'RM15'].map(readPrice), Array(7).fill('invalid'));
});

test('a foil price carries F only when the foil mark is the F suffix', () => {
  const s = { ...DEFAULT_SETTINGS, showCurrency: true, currencyLabel: 'RM', showCents: false };
  assert.equal(formatMyr(13, { ...s, foilStyle: 'suffix' }, true), 'RM13F');
  assert.equal(formatMyr(13, { ...s, foilStyle: 'suffix' }), 'RM13');
  assert.equal(formatMyr(13, { ...s, foilStyle: 'gold' }, true), 'RM13');
  assert.equal(formatMyr(NaN, { ...s, foilStyle: 'suffix' }, true), 'RM —F');
  assert.equal(pillLabel({ unitPrice: 58, isFoil: true, qty: 2 }, { ...s, foilStyle: 'suffix' }), 'RM58F ×2');
});
