import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeMenu } from './placeMenu.ts';

const phone = { width: 375, height: 667 };

test('a button at the right edge opens the menu under it, right edges lined up', () => {
  const p = placeMenu({ left: 323, top: 60, width: 44, height: 44 }, { width: 260, height: 150 }, phone);
  assert.deepEqual(p, { left: 107, top: 108, origin: '238px 0px' });
});

test('a button near the bottom opens the menu over it', () => {
  const p = placeMenu({ left: 16, top: 600, width: 44, height: 44 }, { width: 200, height: 150 }, phone);
  assert.deepEqual(p, { left: 16, top: 446, origin: '22px 150px' });
});

test('a menu wider than the room to the right is pushed back inside the screen', () => {
  const p = placeMenu({ left: 150, top: 60, width: 44, height: 44 }, { width: 300, height: 100 }, phone);
  assert.deepEqual(p, { left: 67, top: 108, origin: '105px 0px' });
});

test('with little room either way it opens on the roomier side and stays on screen', () => {
  const short = { width: 375, height: 300 };
  const p = placeMenu({ left: 16, top: 100, width: 44, height: 44 }, { width: 200, height: 250 }, short);
  assert.deepEqual(p, { left: 16, top: 42, origin: '22px 0px' });
});
