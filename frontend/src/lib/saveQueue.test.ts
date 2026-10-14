import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanUiState } from '../types.ts';
import { createSaveQueue } from './saveQueue.ts';

// A state told apart by its quantity.
const st = (q: number) => ({ isFoil: [], priceOverride: [], quantity: [q], multOverride: [], removed: [], pillOffset: [] }) as ScanUiState;
const tick = () => new Promise(r => setTimeout(r, 0));
// Far past Date.now(), so revs are known values.
const LOADED = 1e15;

// A queue whose sends wait until the test settles them.
function harness() {
  const sends: { scanId: number; rev: number; q: number; final: boolean; ok: () => void; fail: (status: number) => void }[] = [];
  const saved: number[] = [];
  const refused: number[] = [];
  let retries = 0;
  const q = createSaveQueue(
    (scanId, state, final) => new Promise((res, rej) => sends.push({
      scanId, rev: state.rev!, q: state.quantity[0], final,
      ok: () => res(), fail: status => rej(Object.assign(new Error('x'), { status })),
    })),
    scanId => saved.push(scanId),
    () => { retries++; },
    scanId => refused.push(scanId),
  );
  return { q, sends, saved, refused, retries: () => retries };
}

test('rev rises by one from the loaded rev on every change', () => {
  const { q, sends } = harness();
  q.update(1, st(1), LOADED);
  assert.equal(q.update(1, st(1)), false);
  assert.equal(q.update(1, st(2)), true);
  q.flush();
  q.update(1, st(3));
  q.flush();
  assert.deepEqual(sends.map(s => [s.rev, s.q]), [[LOADED + 1, 2], [LOADED + 2, 3]]);
});

test('a final flush sends every unsaved state, including ones in flight', () => {
  const { q, sends } = harness();
  q.update(1, st(1), LOADED);
  q.update(2, st(1), LOADED);
  q.update(3, st(1), LOADED);
  q.update(1, st(2));
  q.update(2, st(2));
  q.flush();
  q.update(2, st(3));
  q.flush(true);
  assert.deepEqual(sends.map(s => [s.scanId, s.q, s.final]), [
    [1, 2, false], [2, 2, false],
    [1, 2, true], [2, 3, true],
  ]);
});

test('a late success of an older save leaves the newer state unsaved', async () => {
  const { q, sends } = harness();
  q.update(1, st(1), LOADED);
  q.update(1, st(2));
  q.flush();
  q.update(1, st(3));
  sends[0].ok();
  await tick();
  q.flush();
  assert.deepEqual(sends.map(s => [s.rev, s.q]), [[LOADED + 1, 2], [LOADED + 2, 3]]);
});

test('a seeded state is sent without an edit', () => {
  const { q, sends } = harness();
  q.seed(1, st(5));
  assert.equal(q.update(1, st(5)), false);
  q.flush();
  assert.deepEqual(sends.map(s => [s.scanId, s.q]), [[1, 5]]);
});

test('a failed save is retried, a refused one is dropped and reported', async () => {
  const { q, sends, saved, refused, retries } = harness();
  q.update(1, st(1), LOADED);
  q.update(2, st(1), LOADED);
  q.update(3, st(1), LOADED);
  q.update(1, st(2));
  q.update(2, st(2));
  q.update(3, st(2));
  q.flush();
  sends[0].fail(503);
  sends[1].fail(429);
  sends[2].fail(413);
  await tick();
  assert.equal(retries(), 2);
  q.flush();
  assert.deepEqual(sends.slice(3).map(s => s.scanId), [1, 2]);
  assert.deepEqual(saved, []);
  assert.deepEqual(refused, [3]);
});

test('at most 4 saves are in flight outside a final flush; each one ending sends the next', async () => {
  const { q, sends } = harness();
  for (let id = 1; id <= 6; id++) { q.update(id, st(1), LOADED); q.update(id, st(2)); }
  q.flush();
  q.flush();
  assert.deepEqual(sends.map(s => s.scanId), [1, 2, 3, 4]);
  sends[0].ok();
  await tick();
  assert.deepEqual(sends.map(s => s.scanId), [1, 2, 3, 4, 5]);
  q.flush(true);
  assert.deepEqual(sends.slice(5).map(s => [s.scanId, s.final]), [[2, true], [3, true], [4, true], [5, true], [6, true]]);
});
