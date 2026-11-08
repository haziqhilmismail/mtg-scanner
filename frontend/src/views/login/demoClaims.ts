// The sign-in page's Claims demo: invented buyers commenting on the sample
// photo. The page is public, so never real names, accounts or QR codes.

import type { Payment } from '../../api/payment.ts';
import type { T } from '../../i18n/index.ts';
import { buyerMessage } from '../claims/model.ts';
import { DEMO_CARDS, DEMO_MULT, demoPrice, type DemoCard } from '../../data/demoScan.ts';

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

export const totalOf = (c: DemoComment) => c.cards.reduce((sum, d) => sum + demoPrice(d), 0);

export const demoMessage = (c: DemoComment, t: T) => buyerMessage(c.name, c.cards.map(d => ({
  id: d.id, name: d.name, qty: 1, each: demoPrice(d), formula: { usd: d.ckRetailUsd, mult: DEMO_MULT },
  photo: null, crop: null, live: false,
})), DEMO_PAYMENT, false, t);
