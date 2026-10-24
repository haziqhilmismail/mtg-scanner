import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translate } from '../i18n/index.ts';
import { DEFAULT_SETTINGS } from '../types.ts';
import {
  defaultToUpload, formulaLine, legacyPricing, priceField, pricingKnown, pricingSummary, resolvePricing, ROUNDINGS, roundingKey,
  roundingText, samePricing, savePricing,
} from './pricing.ts';

const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
const ms = (k: string, v?: Record<string, string | number>) => translate('ms', k, v);

const userDefault = { ...DEFAULT_SETTINGS, multNormal: 3.5 };
const post = { ...DEFAULT_SETTINGS, multNormal: 4 };

test("a post's own pricing wins, then the user's default, then the built-in default", () => {
  assert.equal(resolvePricing(post, userDefault).multNormal, 4);
  assert.equal(resolvePricing(null, userDefault).multNormal, 3.5);
  assert.equal(resolvePricing(undefined, userDefault).multNormal, 3.5);
  assert.deepEqual(resolvePricing(null, null), DEFAULT_SETTINGS);
});

test('keys missing from a saved pricing fall back to the built-in default', () => {
  assert.deepEqual(resolvePricing({ multFoil: 5 }, null), { ...DEFAULT_SETTINGS, multFoil: 5 });
});

test("the browser's old pricing is uploaded only when the server has no default", () => {
  assert.deepEqual(defaultToUpload(null, userDefault), userDefault);
  assert.deepEqual(defaultToUpload(undefined, userDefault), userDefault);
  assert.equal(defaultToUpload(post, userDefault), null);
  assert.equal(defaultToUpload(null, null), null);
});

test("the browser's old pricing is read and brought up to date", () => {
  assert.equal(legacyPricing(null, null), null);
  assert.equal(legacyPricing('not json', '3'), null);
  assert.equal(legacyPricing('null', '3'), null);
  assert.deepEqual(legacyPricing(JSON.stringify({ multNormal: 3 }), '3'), { ...DEFAULT_SETTINGS, multNormal: 3 });
  const v1 = legacyPricing(JSON.stringify({ labelPosition: 'bottom', rounding: 'nearest_0.5' }), null);
  assert.equal(v1?.labelPosition, 'center');
  assert.equal(v1?.roundDirection, 'nearest');
  assert.equal(v1?.roundStep, 0.5);
  assert.equal('rounding' in (v1 ?? {}), false);
  assert.equal(legacyPricing(JSON.stringify({ rounding: 'none' }), '2')?.roundDirection, 'none');
});

test("a post's pricing can be saved only once it is known, the default once /me has answered", () => {
  const s = { userDefault, defaultKnown: false, posts: { 7: post, 8: null } };
  assert.equal(pricingKnown(s, 9), false);
  assert.equal(pricingKnown(s, 8), true);
  assert.equal(pricingKnown(s, null), false);
  const next = { ...post, multFoil: 4.5 };
  assert.equal(savePricing(s, 9, next, false), null);
  assert.equal(savePricing(s, null, next, false), null);
  assert.deepEqual(savePricing(s, 8, next, false), { ...s, posts: { 7: post, 8: next } });
  // Also for new posts: the default becomes the same pricing.
  assert.deepEqual(savePricing(s, 7, next, true), { userDefault: next, defaultKnown: false, posts: { 7: next, 8: null } });
  assert.deepEqual(savePricing({ ...s, defaultKnown: true }, null, next, false)?.userDefault, next);
});

test('the pricing summary and the formula follow the settings, in both languages', () => {
  const s = { ...DEFAULT_SETTINGS, multNormal: 2.5, multFoil: 2.8 };
  assert.equal(pricingSummary(s, en), '×2.5 · Foil ×2.8 · Round up to RM 1');
  assert.equal(formulaLine(s, en), 'Final price = Card Kingdom retail USD × multiplier, rounded up to the nearest RM 1, never below RM 1.');
  const odd = { ...s, roundDirection: 'nearest' as const, roundStep: 0.5 as const, minPrice: 0, currencyLabel: 'MYR' };
  assert.equal(pricingSummary(odd, en), '×2.5 · Foil ×2.8 · Round to the nearest MYR 0.50');
  assert.equal(formulaLine(odd, en), 'Final price = Card Kingdom retail USD × multiplier, rounded to the nearest MYR 0.50.');
  assert.equal(formulaLine({ ...s, roundDirection: 'none', minPrice: 0.5 }, en), 'Final price = Card Kingdom retail USD × multiplier, never below RM 0.50.');
  assert.equal(formulaLine(s, ms), 'Harga akhir = harga runcit Card Kingdom dalam USD × pengganda, dibundarkan naik ke RM 1 terdekat, tidak kurang daripada RM 1.');
});

test('the Rounding dropdown offers every rounding the price code does, each with its own key', () => {
  const keys = ROUNDINGS.map(roundingKey);
  assert.equal(new Set(keys).size, 10);
  assert.equal(keys[0], roundingKey(DEFAULT_SETTINGS));
  assert.deepEqual(ROUNDINGS.map(r => roundingText(r, DEFAULT_SETTINGS, en, 'option')).slice(0, 4), ['Up to RM 1', 'Up to RM 0.50', 'Up to RM 0.10', 'Nearest RM 1']);
  assert.equal(roundingKey({ roundDirection: 'none', roundStep: 0.5 }), 'none');
});

test('the typed fields take a multiplier from 1 to 5 and a whole minimum price from 0 to 50', () => {
  const saved = { ...DEFAULT_SETTINGS, multNormal: 0.8, minPrice: 0.5 };
  assert.equal(priceField('multFoil', '2.75', saved), 2.75);
  assert.equal(priceField('multFoil', ' 5 ', saved), 5);
  assert.equal(priceField('multFoil', '2.', saved), 2);
  assert.deepEqual(['', '.', '0.9', '5.1', '2.5.1', 'x2', '-2'].filter(bad => priceField('multFoil', bad, saved) !== null), []);
  assert.equal(priceField('minPrice', '50', saved), 50);
  assert.equal(priceField('minPrice', '0', saved), 0);
  assert.deepEqual(['', '51', '1.5', '-1'].filter(bad => priceField('minPrice', bad, saved) !== null), []);
  // An older saved value stays as it is until it is changed.
  assert.equal(priceField('multNormal', '0.8', saved), 0.8);
  assert.equal(priceField('minPrice', '0.5', saved), 0.5);
  assert.equal(priceField('minPrice', '0.50', saved), null);
});

test('two pricings are the same only when every setting is', () => {
  assert.equal(samePricing({ ...DEFAULT_SETTINGS }, DEFAULT_SETTINGS), true);
  assert.equal(samePricing({ ...DEFAULT_SETTINGS, priceMode: 'live' }, DEFAULT_SETTINGS), false);
  assert.equal(samePricing({ ...DEFAULT_SETTINGS, showOutlines: true }, DEFAULT_SETTINGS), false);
});
