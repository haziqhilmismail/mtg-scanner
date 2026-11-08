import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initials } from './initials.ts';

test('initials for the avatar', () => {
  assert.equal(initials('Haziq Hilmi'), 'HH');
  assert.equal(initials('Jo'), 'J');
  assert.equal(initials('Muhammad Haziq bin Hilmi'), 'MH');
  assert.equal(initials('  ali@example.com '), 'A');
  assert.equal(initials('éva kovács'), 'ÉK');
  assert.equal(initials('🙂 Ali'), '🙂A');
  assert.equal(initials(''), '');
});
