import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../types.ts';
import { legacyPricing } from './legacy.ts';

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
