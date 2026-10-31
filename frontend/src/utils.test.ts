import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Batch, type Candidate, type CardRowData, type DetectedCard, type RoundDirection, type RoundStep } from './types.ts';
import { applyRounding, computeCardData, correctionFor, dueForSupportAsk, fmt2, formatMyr, initials, lockPrices, matchThumbs, overrideText, parseOverride, readPrice, sortScreenshots, paymentLines, normalizeUiState, notAdded, photoLabel, photoNumbers, sortPhotos, type PhotoSort } from './utils.ts';
import type { T } from './i18n/index.ts';
import { priceFormula } from './views/claims/model.ts';

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

test('a price box holding only "." is no price, not RM0', () => {
  const sel = { name: 'X', usd: 10, price_source_normal: 'cardkingdom' } as Candidate;
  const batch: Batch = {
    id: 'b', scanId: 1, postId: null, position: null, listed: [], filename: '', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards: [{ candidates: [sel] } as DetectedCard] },
    isFoil: [false], priceOverride: ['.'], quantity: [1], multOverride: [null], removed: [false], sold: [false], pillOffset: [null], versionOk: [false], picks: [null], locked: [null],
    relookupBusy: [false], relookupMsg: [null],
  };
  const settings = { ...DEFAULT_SETTINGS, multNormal: 3 };
  assert.equal(computeCardData(batch, settings)[0].unitPrice, 30);
  batch.priceOverride = ['12.5'];
  assert.equal(computeCardData(batch, settings)[0].unitPrice, 12.5);
});

test('saved per-card state is fitted to the cards, entry by entry', () => {
  const card = (is_foil: boolean, quantity?: number) => ({ gemini: { is_foil, quantity } } as DetectedCard);
  const cards = [card(false), card(true, 2), card(false)];
  // Saved by a device that knew two cards, with one bad entry of each kind.
  const saved = {
    isFoil: [true, 'yes'],
    priceOverride: ['5', 7],
    quantity: [0, 3, 4, 9],
    multOverride: [null, 2.5],
    removed: 'no',
    pillOffset: [{ dx: 1, dy: 2 }, { dx: 'x', dy: 0 }],
    picks: [{ name: 'Sol Ring', set: 'c21' }, 'Sol Ring', { set: 'c21' }],
    locked: [{ price: 9, usd: 3.6, mult: 2.5, manual: false }, { price: 0, usd: 1, mult: 1, manual: false }, 'x'],
    lockedAt: '2026-10-23T12:00:00Z',
    rev: 1700000000000,
  };
  assert.deepEqual(normalizeUiState(saved, cards), {
    isFoil: [true, true, false],
    priceOverride: ['5', null, null],
    quantity: [1, 3, 4],
    multOverride: [null, 2.5, null],
    removed: [false, false, false], sold: [false, false, false],
    pillOffset: [{ dx: 1, dy: 2 }, null, null],
    versionOk: [false, false, false],
    picks: [{ name: 'Sol Ring', set: 'c21' }, null, null],
    locked: [{ price: 9, usd: 3.6, mult: 2.5, manual: false }, null, null],
    lockedAt: '2026-10-23T12:00:00Z',
    rev: 1700000000000,
  });
  assert.deepEqual(normalizeUiState(null, [card(true)]).isFoil, [true]);
  assert.equal('rev' in normalizeUiState({ rev: '5' }, []), false);
  assert.equal('rev' in normalizeUiState({ rev: 1.5 }, []), false);
});

test('a photo still has to add its priced, kept cards that are not listed', () => {
  const sel = { name: 'X', usd: 10, price_source_normal: 'cardkingdom' } as Candidate;
  const card = (x: number) => ({ candidates: [sel], bbox: [x, 0, 5, 5] } as DetectedCard);
  const batch: Batch = {
    id: 'b', scanId: 1, postId: 7, position: null, listed: ['0,0,5,5'], filename: '', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards: [card(0), card(10), card(20), card(30)] },
    isFoil: [false, false, false, false], priceOverride: [null, null, null, '0'], quantity: [1, 1, 1, 1],
    multOverride: [null, null, null, null], removed: [false, false, true, false], sold: [false, false, false, false], pillOffset: [null, null, null, null],
    versionOk: [false, false, false, false], picks: [null, null, null, null], locked: [null, null, null, null], relookupBusy: [], relookupMsg: [],
  };
  // Listed, not added, removed, priced at zero.
  assert.deepEqual(notAdded(batch, computeCardData(batch, DEFAULT_SETTINGS)).map(cd => cd.origIdx), [1]);
});

test("a post's photos sort newest or oldest with unsaved ones newest, or by name in number order with ties newest first", () => {
  const items = ([
    ['IMG_10.jpg', 3],
    ['img_2.jpg', 1],
    ['IMG_2.JPG', 4],
    ['Opt.jpg', null],
    ['Bolt.jpg', null],
    ['IMG_9.jpg', 2],
  ] as const).map(([filename, scanId], i) => ({ batch: { id: String(i), filename, scanId } as Batch }));
  const ids = (sort: PhotoSort) => sortPhotos(items, sort).map(s => s.batch.id).join(',');
  assert.equal(ids('newest'), '3,4,2,0,5,1');
  assert.equal(ids('oldest'), '1,5,0,2,3,4');
  assert.equal(ids('name'), '4,2,1,5,0,3');
});

test('match thumbnails are the small image of each top candidate, without the empty ones', () => {
  const card = (image_url?: string) => ({ candidates: image_url === undefined ? [] : [{ image_url } as Candidate] } as unknown as DetectedCard);
  const batch = { response: { cards: [
    card('https://cards.scryfall.io/normal/front/a/b/ab.jpg?1'),
    card(''),
    card(),
    card('https://cards.scryfall.io/large/front/c/d/cd.jpg?2'),
  ] } } as Batch;
  assert.deepEqual(matchThumbs(batch), [
    'https://cards.scryfall.io/small/front/a/b/ab.jpg?1',
    'https://cards.scryfall.io/small/front/c/d/cd.jpg?2',
  ]);
  assert.deepEqual(matchThumbs({ response: null } as Batch), []);
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
  const batch: Batch = {
    id: 'b', scanId: 1, postId: null, position: null, listed: [], filename: '', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards: [{ candidates: [sel] } as DetectedCard, { candidates: [sel] } as DetectedCard] },
    isFoil: [false, false], priceOverride: [null, '7'], quantity: [1, 2], multOverride: [null, null], removed: [false, false], sold: [false, false],
    pillOffset: [null, null], versionOk: [false, false], picks: [null, null], locked: [null, null], relookupBusy: [], relookupMsg: [],
  };
  const posted = { ...DEFAULT_SETTINGS, multNormal: 2.5, roundDirection: 'up' as const, roundStep: 1 as const };
  const finished = { ...batch, locked: lockPrices(computeCardData(batch, posted)), lockedAt: '2026-10-23T12:00:00Z' };
  // CK moves and the multiplier changes after posting.
  finished.response = { ...batch.response!, cards: [{ candidates: [{ ...sel, usd: 9 }] } as DetectedCard, { candidates: [{ ...sel, usd: 9 }] } as DetectedCard] };
  const [ck, typed] = computeCardData(finished, { ...posted, multNormal: 4 });
  assert.equal(ck.unitPrice, 9);
  assert.deepEqual(priceFormula(ck, 9), { usd: 3.6, mult: 2.5 });
  assert.deepEqual([typed.unitPrice, typed.lineTotal], [7, 14]);
  assert.equal(priceFormula(typed, 7), null);
  // Edit prices: the lock no longer counts, so prices follow again.
  assert.equal(computeCardData({ ...finished, lockedAt: null }, { ...posted, multNormal: 4 })[0].unitPrice, 36);
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

test('photos are numbered in the order the seller gave them, then oldest scan first', () => {
  const b = (id: string, postId: number | null, scanId: number | null, position: number | null) => ({ id, postId, scanId, position, filename: id } as Batch);
  const batches = [b('new', 1, 9, null), b('c', 1, 3, 0), b('a', 1, 1, 2), b('b', 1, 2, 1), b('scanning', 1, null, null), b('other', 2, 4, null)];
  assert.deepEqual([...photoNumbers(batches)].sort(), [['a', 3], ['b', 2], ['c', 1], ['new', 4], ['other', 1]]);
  const ids = sortPhotos(batches.filter(x => x.postId === 1).map(batch => ({ batch })), 'post').map(s => s.batch.id);
  assert.deepEqual(ids, ['c', 'b', 'a', 'new', 'scanning']);
});

test('a live-price photo labels only what CK does not decide', () => {
  const cd = (o: Partial<CardRowData>) => ({ unitPrice: 9, isFoil: false, qty: 1, needsPrice: false, hasOverride: false, hasMultOverride: false, mult: 2.5, ...o } as CardRowData);
  const s = { ...DEFAULT_SETTINGS, showCurrency: true, currencyLabel: 'RM', showCents: false };
  const live = { ...s, priceMode: 'live' as const };
  assert.equal(photoLabel(cd({}), s), 'RM9');                                   // price on photo: every card
  assert.equal(photoLabel(cd({}), live), '');                                   // live, post rate: nothing
  assert.equal(photoLabel(cd({ hasOverride: true, unitPrice: 12 }), live), 'RM12');
  assert.equal(photoLabel(cd({ hasMultOverride: true, mult: 3 }), live), 'CK ×3');
  // Live: a foil card always carries F, whatever the foil mark setting.
  const gold = { ...live, foilStyle: 'gold' as const };
  assert.equal(photoLabel(cd({ isFoil: true }), gold), 'F');
  assert.equal(photoLabel(cd({ isFoil: true, hasOverride: true, unitPrice: 12 }), gold), 'RM12F');
  assert.equal(photoLabel(cd({ isFoil: true, hasMultOverride: true, mult: 3 }), gold), 'CK ×3 · F');
  assert.equal(photoLabel(cd({ needsPrice: true, unitPrice: NaN }), s), '');
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
  const batch: Batch = {
    id: 'b', scanId: 1, postId: null, position: null, listed: [], filename: '', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards: [card(0), card(10), card(20)] },
    isFoil: [false, false, false], priceOverride: ['usd:4.5', '15.50', null], quantity: [1, 2, 1], multOverride: [null, null, 3],
    removed: [false, false, false], sold: [false, false, false], pillOffset: [null, null, null], versionOk: [false, false, false], picks: [null, null, null],
    locked: [null, null, null], relookupBusy: [], relookupMsg: [],
  };
  const [usd, rm, auto] = computeCardData(batch, { ...DEFAULT_SETTINGS, multNormal: 2.5, roundDirection: 'up', roundStep: 1, minPrice: 1 });
  assert.deepEqual([usd.unitPrice, usd.hasOverride, usd.ownUsd, usd.autoPrice], [12, true, 4.5, 13]);   // 4.5 × 2.5 = 11.25, up to 12
  assert.deepEqual([rm.unitPrice, rm.lineTotal, rm.ownUsd], [15.5, 31, null]);
  assert.deepEqual([auto.unitPrice, auto.hasOverride, auto.ownUsd], [15, false, null]);                // 4.99 × 3 = 14.97, up to 15
});

test('a typed price is a number above 0 with at most two decimals, or nothing', () => {
  assert.deepEqual(['15', '15.50', '1,240', ' 12 ', '.5', '15.'].map(readPrice), [15, 15.5, 1240, 12, 0.5, 15]);
  assert.equal(readPrice(''), null);
  assert.equal(readPrice('   '), null);
  assert.deepEqual(['0', '0.00', 'abc', '15.555', '1.2.3', '-5', 'RM15'].map(readPrice), Array(7).fill('invalid'));
});

const shown = (scanId: number | null = 7, sid = 'aaa'): Batch => ({
  id: 'b', scanId, postId: null, position: null, listed: [], filename: '', status: 'done',
  response: { image_id: '', image_b64: '', width: 0, height: 0, cards: [{ id: 5, candidates: [{ scryfall_id: sid } as Candidate] } as DetectedCard] },
  isFoil: [false], priceOverride: [null], quantity: [1], multOverride: [null], removed: [false], sold: [false], pillOffset: [null], versionOk: [false], picks: [null], locked: [null],
  relookupBusy: [false], relookupMsg: [null],
});

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
