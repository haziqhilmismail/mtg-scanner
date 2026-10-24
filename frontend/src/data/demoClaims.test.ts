import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translate } from '../i18n/index.ts';
import { DEFAULT_SETTINGS } from '../types.ts';
import { applyRounding } from '../utils.ts';
import { DEMO_COMMENTS, demoMessage } from './demoClaims.ts';
import { DEMO_CARDS } from './demoScan.ts';

const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);

test('a demo buyer gets the section 8 message, character for character', () => {
  const weiJie = DEMO_COMMENTS.find(c => c.name === 'Wei Jie')!;
  assert.equal(demoMessage(weiJie, en), [
    'Wei Jie',
    'Frantic Search — $1.79 × 2.8 → RM6',
    'Pick Your Poison — $0.35 × 2.8 → RM1',
    '',
    '*Total: RM7*',
    '',
    'Payment: Maybank 0000 0000 0000 (Your name)',
    'Please provide your phone number',
  ].join('\n'));
});

test('every demo price is what the app would charge at that multiplier', () => {
  assert.deepEqual(
    DEMO_CARDS.map(c => `${c.name}: RM${applyRounding(c.ckRetailUsd * c.multiplier, DEFAULT_SETTINGS)}`),
    DEMO_CARDS.map(c => `${c.name}: RM${c.rmPrice}`),
  );
});
