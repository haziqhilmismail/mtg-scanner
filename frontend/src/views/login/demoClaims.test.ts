import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translate, type T } from '../../i18n/index.ts';
import { DEMO_COMMENTS, demoMessage } from './demoClaims.ts';
import { DEMO_CARDS, demoPrice } from '../../data/demoScan.ts';

const en: T = (k, v) => translate('en', k, v);

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

test('the demo cards are priced at the default multiplier, rounded up to RM 1', () => {
  assert.deepEqual(DEMO_CARDS.map(c => `${c.name}: RM${demoPrice(c)}`), [
    'Frantic Search: RM6', 'Malakir Rebirth // Malakir Mire: RM56', 'Pick Your Poison: RM1', 'Etali, Primal Storm: RM5',
  ]);
});
