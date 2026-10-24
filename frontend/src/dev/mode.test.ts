import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickMode } from './mode.ts';

test('?data= in the URL picks the mode, over the tab\'s last choice', () => {
  assert.equal(pickMode('?data=worst', 'many'), 'worst');
  assert.equal(pickMode('?post=3&data=empty', null), 'empty');
});

test('a URL without ?data= keeps the tab\'s last choice', () => {
  assert.equal(pickMode('?post=3', 'many'), 'many');
});

test('an unknown mode is ignored, and nothing chosen means live', () => {
  assert.equal(pickMode('?data=bogus', 'one'), 'one');
  assert.equal(pickMode('?data=Worst', null), 'live');
  assert.equal(pickMode('', 'bogus'), 'live');
  assert.equal(pickMode('', null), 'live');
});
