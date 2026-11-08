import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storage } from './storage.ts';

// Node has no localStorage, as a browser with storage disabled has none.
test('without storage, reads give their fallback and writes are dropped', () => {
  assert.equal(storage.get('mtg.x'), null);
  assert.deepEqual(storage.getJson('mtg.x', { a: 1 }), { a: 1 });
  assert.deepEqual(storage.keys(), []);
  storage.set('mtg.x', '1'); storage.setJson('mtg.x', [1]); storage.remove('mtg.x');
  assert.equal(storage.get('mtg.x'), null);
});

test('a corrupt value reads as the fallback', () => {
  globalThis.localStorage = { getItem: () => '{not json', setItem() {}, removeItem() {}, key: () => null, clear() {}, length: 0 } as Storage;
  try {
    assert.equal(storage.getJson('mtg.x', 7), 7);
    assert.equal(storage.get('mtg.x'), '{not json');
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
