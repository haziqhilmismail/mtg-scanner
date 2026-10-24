import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pausableTimer } from './pausableTimer.ts';

function harness(ms: number) {
  let t = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const fired: number[] = [];
  const timer = pausableTimer(ms, () => fired.push(t), {
    now: () => t,
    setTimeout: (fn, wait) => { due.set(next, { at: t + wait, fn }); return next++; },
    clearTimeout: id => { due.delete(id as number); },
  });
  const advance = (by: number) => {
    t += by;
    for (const [id, d] of [...due]) if (d.at <= t) { due.delete(id); d.fn(); }
  };
  return { timer, advance, fired };
}

test('fires once its time has run', () => {
  const { advance, fired } = harness(2200);
  advance(2199);
  assert.deepEqual(fired, []);
  advance(1);
  assert.deepEqual(fired, [2200]);
});

test('time spent held does not count', () => {
  const { timer, advance, fired } = harness(3000);
  advance(1000);
  timer.hold('pointer');
  advance(60_000);
  assert.deepEqual(fired, []);
  timer.release('pointer');
  advance(2000);
  assert.deepEqual(fired, [63_000]);
});

test('goes on only when every hold is released', () => {
  const { timer, advance, fired } = harness(3000);
  timer.hold('pointer');
  timer.hold('hidden');
  timer.release('pointer');
  advance(10_000);
  assert.deepEqual(fired, []);
  timer.release('hidden');
  advance(3000);
  assert.deepEqual(fired, [13_000]);
});

test('a release after it fired, or after stop, starts nothing', () => {
  const fired = harness(1000);
  fired.advance(1000);
  fired.timer.hold('focus');
  fired.timer.release('focus');
  fired.advance(5000);
  assert.deepEqual(fired.fired, [1000]);

  const stopped = harness(1000);
  stopped.timer.hold('pointer');
  stopped.timer.stop();
  stopped.timer.release('pointer');
  stopped.advance(5000);
  assert.deepEqual(stopped.fired, []);
});
