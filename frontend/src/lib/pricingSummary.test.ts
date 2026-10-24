import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translate } from '../i18n/index.ts';
import { DEFAULT_SETTINGS } from '../types.ts';
import { pricingSummary } from './pricingSummary.ts';

const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);

test('the summary names both multipliers and the rounding', () => {
  assert.equal(pricingSummary({ ...DEFAULT_SETTINGS, multNormal: 2.5, multFoil: 2.8 }, en), '×2.5 · Foil ×2.8 · Round up to RM 1');
  assert.equal(pricingSummary({ ...DEFAULT_SETTINGS, roundDirection: 'nearest', roundStep: 0.5 }, en), '×2.8 · Foil ×3 · Round to the nearest RM 0.50');
  assert.equal(pricingSummary({ ...DEFAULT_SETTINGS, roundDirection: 'none' }, en), '×2.8 · Foil ×3 · No rounding');
});
