import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepValue } from './stepValue.ts';

test('a decimal step lands on the decimal, not on float noise', () => {
  assert.equal(stepValue(2.5, 1, 0.1), 2.6);
  assert.equal(stepValue(0.2, 1, 0.1), 0.3);
  assert.equal(stepValue(2.6, -1, 0.1), 2.5);
});

test('whole steps for quantities', () => {
  assert.equal(stepValue(3, -1), 2);
  assert.equal(stepValue(3, 1), 4);
});

test('the value stays within min and max', () => {
  assert.equal(stepValue(1, -1, 1, 1, 99), 1);
  assert.equal(stepValue(4.95, 1, 0.1, 1, 5), 5);
  assert.equal(stepValue(1.05, -1, 0.1, 1, 5), 1);
});
