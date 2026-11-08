import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Batch, type Candidate, type DetectedCard } from '../types.ts';
import { computeCardData, editCardState, freshState, normalizeUiState, notAdded, uiStateOf, withCard } from './scanState.ts';

const card = (is_foil: boolean, quantity?: number) => ({ gemini: { is_foil, quantity } } as DetectedCard);

test('saved per-card state is fitted to the cards, entry by entry', () => {
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

// The backend reads rev, lockedAt, locked[].price and picks out of the stored
// JSON, and saved scans in the database hold these keys. A load and a save
// must give the stored JSON back as it was.
test('a stored ui_state in the current format round-trips unchanged', () => {
  const stored = {
    isFoil: [true, false],
    priceOverride: ['usd:4.5', null],
    quantity: [2, 1],
    multOverride: [null, 3],
    removed: [false, true],
    sold: [false, true],
    pillOffset: [{ dx: 3, dy: -4 }, null],
    versionOk: [true, false],
    picks: [null, { scryfall_id: 'x', name: 'Sol Ring', set: 'c21' } as Candidate],
    locked: [{ price: 12, usd: 4.5, mult: 2.5, manual: false }, null],
    lockedAt: '2026-10-23T12:00:00Z',
    rev: 41,
  };
  const loaded = normalizeUiState(JSON.parse(JSON.stringify(stored)), [card(false), card(false)]);
  assert.deepEqual(loaded, stored);
  const batch = { id: 'b', scanId: 1, status: 'done', ...loaded };
  assert.deepEqual({ ...uiStateOf(batch), rev: 41 }, stored);
  assert.deepEqual(Object.keys(uiStateOf(batch)).sort(), Object.keys(stored).filter(k => k !== 'rev').sort());
});

test('a fresh state follows the scan, a framed card joins it fresh, and an edit changes one card only', () => {
  const cards = [card(true, 3), card(false)];
  const state = freshState(cards);
  assert.deepEqual([state.isFoil, state.quantity, state.locked], [[true, false], [3, 1], [null, null]]);
  const more = withCard({ ...state, extra: 1 }, card(true));
  assert.deepEqual([more.isFoil, more.quantity, more.picks, more.extra], [[true, false, true], [3, 1, 1], [null, null, null], 1]);
  const edited = editCardState(more, 1, { quantity: 4, removed: true });
  assert.deepEqual([edited.quantity, edited.removed, more.quantity], [[3, 4, 1], [false, true, false], [3, 1, 1]]);
});

test('a photo still has to add its priced, kept cards that are not listed', () => {
  const sel = { name: 'X', usd: 10, price_source_normal: 'cardkingdom' } as Candidate;
  const card = (x: number) => ({ candidates: [sel], bbox: [x, 0, 5, 5] } as DetectedCard);
  const cards = [card(0), card(10), card(20), card(30)];
  const batch: Batch = {
    id: 'b', scanId: 1, postId: 7, position: null, listed: ['0,0,5,5'], filename: '', status: 'done',
    response: { image_id: '', image_b64: '', width: 0, height: 0, cards },
    ...freshState(cards), priceOverride: [null, null, null, '0'], removed: [false, false, true, false],
  };
  // Listed, not added, removed, priced at zero.
  assert.deepEqual(notAdded(batch, computeCardData(cards, batch, DEFAULT_SETTINGS)).map(cd => cd.origIdx), [1]);
});
