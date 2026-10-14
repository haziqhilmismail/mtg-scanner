import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../types.ts';
import { defaultToUpload, legacyPricing, resolvePricing } from './pricing.ts';

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
