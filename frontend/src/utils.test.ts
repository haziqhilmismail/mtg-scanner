import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Batch, type Candidate, type DetectedCard } from './types.ts';
import { computeCardData, correctionFor, freshState, lockPrices } from './lib/scanState.ts';
import { dueForSupportAsk, initials, sortScreenshots, paymentLines } from './utils.ts';
import type { T } from './i18n/index.ts';
import { priceFormula } from './views/claims/model.ts';
import { overrideText, parseOverride } from './lib/money.ts';

test('a price box holding only "." is no price, not RM0', () => {
  const sel = { name: 'X', usd: 10, price_source_normal: 'cardkingdom' } as Candidate;
  const cards = [{ candidates: [sel] } as DetectedCard];
  const state = { ...freshState(cards), priceOverride: ['.'] };
  const settings = { ...DEFAULT_SETTINGS, multNormal: 3 };
  assert.equal(computeCardData(cards, state, settings)[0].unitPrice, 30);
  assert.equal(computeCardData(cards, { ...state, priceOverride: ['12.5'] }, settings)[0].unitPrice, 12.5);
});

test('the tip-jar popup waits for the third save, then asks once a month', () => {
  const day = 24 * 3600 * 1000;
  assert.equal(dueForSupportAsk(2, null, 100 * day), false);
  assert.equal(dueForSupportAsk(3, null, 100 * day), true);
  assert.equal(dueForSupportAsk(9, 100 * day, 129 * day), false);
  assert.equal(dueForSupportAsk(9, 100 * day, 130 * day), true);
});

test('payment details become the lines under a buyer message, empty parts left out', () => {
  const t = ((key: string, v?: Record<string, string>) => `${key}:${v?.account ?? ''}`) as unknown as T;
  const full = { bank_name: 'Maybank', bank_account_number: '1234', bank_account_holder: 'Nurul Huda', payment_note: 'Send your name.', qr_version: null };
  assert.deepEqual(paymentLines(full, t), ['pay_copy_account:Maybank 1234 (Nurul Huda)', 'Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: '' }, t), ['pay_copy_account:1234 (Nurul Huda)', 'Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: '', bank_account_number: '' }, t), ['pay_copy_account:(Nurul Huda)', 'Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: ' ', bank_account_number: '', bank_account_holder: '' }, t), ['Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: '', bank_account_number: '', bank_account_holder: '', payment_note: '' }, t), []);
  assert.deepEqual(paymentLines(null, t), []);
});

test('a finished photo keeps its prices and their working whatever changes after', () => {
  const sel = { name: 'X', usd: 3.6, price_source_normal: 'cardkingdom' } as Candidate;
  const cards = [{ candidates: [sel] } as DetectedCard, { candidates: [sel] } as DetectedCard];
  const state = { ...freshState(cards), priceOverride: [null, '7'], quantity: [1, 2] };
  const posted = { ...DEFAULT_SETTINGS, multNormal: 2.5, roundDirection: 'up' as const, roundStep: 1 as const };
  const finished = { ...state, locked: lockPrices(computeCardData(cards, state, posted)), lockedAt: '2026-10-23T12:00:00Z' };
  // CK moves and the multiplier changes after posting.
  const moved = [{ candidates: [{ ...sel, usd: 9 }] } as DetectedCard, { candidates: [{ ...sel, usd: 9 }] } as DetectedCard];
  const [ck, typed] = computeCardData(moved, finished, { ...posted, multNormal: 4 });
  assert.equal(ck.unitPrice, 9);
  assert.deepEqual(priceFormula(ck, 9), { usd: 3.6, mult: 2.5 });
  assert.deepEqual([typed.unitPrice, typed.lineTotal], [7, 14]);
  assert.equal(priceFormula(typed, 7), null);
  // Edit prices: the lock no longer counts, so prices follow again.
  assert.equal(computeCardData(moved, { ...finished, lockedAt: null }, { ...posted, multNormal: 4 })[0].unitPrice, 36);
});

test('comment screenshots go to the photo they show, else the one before', () => {
  const seen = (sure: number | null, guess: number | null = null) => ({ sure, guess });
  // Photo 3 with its comments, two scrolls of comments, photo 5 (a guess between look-alikes), then comments.
  assert.deepEqual(sortScreenshots([seen(3), seen(null), seen(null), seen(null, 5), seen(null)], null, 0), [
    { scanId: 3, by: 'found' }, { scanId: 3, by: 'follows' }, { scanId: 3, by: 'follows' },
    { scanId: 5, by: 'guess' }, { scanId: 5, by: 'follows' },
  ]);
  // Comments only, nothing before: every photo. Added later: they follow what is there.
  assert.deepEqual(sortScreenshots([seen(null), seen(null)], null, 0), [{ scanId: 0, by: 'none' }, { scanId: 0, by: 'none' }]);
  assert.deepEqual(sortScreenshots([seen(null)], 7, 0), [{ scanId: 7, by: 'follows' }]);
});

test('initials for the avatar', () => {
  assert.equal(initials('Haziq Hilmi'), 'HH');
  assert.equal(initials('Jo'), 'J');
  assert.equal(initials('Muhammad Haziq bin Hilmi'), 'MH');
  assert.equal(initials('  ali@example.com '), 'A');
  assert.equal(initials('éva kovács'), 'ÉK');
  assert.equal(initials('🙂 Ali'), '🙂A');
  assert.equal(initials(''), '');
});

test("the seller's own price: RM is kept as typed, USD still gets the multiplier and rounding", () => {
  assert.deepEqual(parseOverride('15.50'), { unit: 'rm', amount: 15.5 });
  assert.deepEqual(parseOverride('usd:4.5'), { unit: 'usd', amount: 4.5 });
  assert.equal(parseOverride('.'), null);
  assert.equal(parseOverride('usd:'), null);
  assert.equal(parseOverride(null), null);
  assert.equal(overrideText({ unit: 'usd', amount: 4.5 }), 'usd:4.5');
  assert.equal(overrideText({ unit: 'rm', amount: 15.5 }), '15.5');
  assert.equal(overrideText(null), null);

  const sel = { name: 'X', usd: 4.99, price_source_normal: 'cardkingdom' } as Candidate;
  const card = (x: number) => ({ candidates: [sel], bbox: [x, 0, 5, 5] } as DetectedCard);
  const cards = [card(0), card(10), card(20)];
  const state = { ...freshState(cards), priceOverride: ['usd:4.5', '15.50', null], quantity: [1, 2, 1], multOverride: [null, null, 3] };
  const [usd, rm, auto] = computeCardData(cards, state, { ...DEFAULT_SETTINGS, multNormal: 2.5, roundDirection: 'up', roundStep: 1, minPrice: 1 });
  assert.deepEqual([usd.unitPrice, usd.hasOverride, usd.ownUsd, usd.autoPrice], [12, true, 4.5, 13]);   // 4.5 × 2.5 = 11.25, up to 12
  assert.deepEqual([rm.unitPrice, rm.lineTotal, rm.ownUsd], [15.5, 31, null]);
  assert.deepEqual([auto.unitPrice, auto.hasOverride, auto.ownUsd], [15, false, null]);                // 4.99 × 3 = 14.97, up to 15
});

const shown = (scanId: number | null = 7, sid = 'aaa'): Batch => {
  const cards = [{ id: 5, candidates: [{ scryfall_id: sid } as Candidate] } as DetectedCard];
  return {
    id: 'b', scanId, postId: null, position: null, listed: [], filename: '', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards }, ...freshState(cards),
  };
};

test('"Looks right" confirms the printing the card shows, under the card\'s own id', () => {
  assert.deepEqual(correctionFor(shown(), 0), { scanId: 7, cardId: 5, scryfallId: 'aaa', kind: 'confirm' });
});

test('a pick of another printing changes the card; a pick of the shown printing confirms it', () => {
  assert.deepEqual(correctionFor(shown(), 0, { scryfall_id: 'bbb' } as Candidate), { scanId: 7, cardId: 5, scryfallId: 'bbb', kind: 'pick' });
  assert.deepEqual(correctionFor(shown(), 0, { scryfall_id: 'aaa' } as Candidate), { scanId: 7, cardId: 5, scryfallId: 'aaa', kind: 'confirm' });
  assert.deepEqual(correctionFor(shown(7, ''), 0, { scryfall_id: 'bbb' } as Candidate), { scanId: 7, cardId: 5, scryfallId: 'bbb', kind: 'pick' });
});

test('nothing is reported for an unsaved photo, a missing card, or no printing', () => {
  assert.equal(correctionFor(shown(null), 0), null);
  assert.equal(correctionFor(shown(), 3), null);
  assert.equal(correctionFor(shown(7, ''), 0), null);
  assert.equal(correctionFor(shown(), 0, { scryfall_id: '' } as Candidate), null);
});
