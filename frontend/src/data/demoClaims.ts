// The sign-in page's Claims demo: invented buyers commenting on the sample
// photo. The page is public, so never real names, accounts or QR codes.

import type { Payment } from '../api.ts';
import type { T } from '../i18n/index.ts';
import { paymentLines } from '../utils.ts';
import { DEMO_CARDS, type DemoCard } from './demoScan.ts';

export interface DemoComment {
  name: string;
  text: string;
  time: string;
  cards: DemoCard[];  // none: the comment is not a claim
}

const card = (id: number) => DEMO_CARDS.find(c => c.id === id)!;

export const DEMO_COMMENTS: DemoComment[] = [
  { name: 'Aina', text: 'claim malakir rebirth', time: '3m', cards: [card(2)] },
  { name: 'Wei Jie', text: 'frantic search & pick your poison claim', time: '3m', cards: [card(1), card(3)] },
  { name: 'Hafiz', text: 'claim etali', time: '2m', cards: [card(4)] },
  { name: 'Mei Ling', text: 'etali still available?', time: '1m', cards: [] },
];

export const DEMO_PAYMENT: Payment = {
  bank_name: 'Maybank', bank_account_number: '0000 0000 0000', bank_account_holder: 'Your name',
  payment_note: 'Please provide your phone number', qr_version: null,
};

export const totalOf = (c: DemoComment) => c.cards.reduce((sum, d) => sum + d.rmPrice, 0);

// The message Claims copies for a buyer, built to DESIGN.md section 8.
export function demoMessage(c: DemoComment, t: T): string {
  const lines = c.cards.map(d => `${d.name} — $${d.ckRetailUsd.toFixed(2)} × ${d.multiplier} → RM${d.rmPrice}`);
  return [c.name, ...lines, '', `*${t('total')}: RM${totalOf(c)}*`, '', ...paymentLines(DEMO_PAYMENT, t)].join('\n');
}
