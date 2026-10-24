import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translate } from '../i18n/index.ts';
import { fileSafe, photoFileName } from './photoFiles.ts';

const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);

test('a labelled photo is named for its post and its place in it, padded so the files sort in post order', () => {
  assert.equal(photoFileName('Friday Post', 7, 47, en), 'Friday Post - Photo 07.jpg');
  assert.equal(photoFileName('Friday Post', 7, 9, en), 'Friday Post - Photo 7.jpg');
  assert.equal(photoFileName('Friday Post', 3, 120, en), 'Friday Post - Photo 003.jpg');
  assert.equal(photoFileName('Friday Post', 3, 2, (k, v) => translate('ms', k, v)), 'Friday Post - Foto 3.jpg');
});

test("a post's name loses only what file systems refuse", () => {
  assert.equal(fileSafe('Jumaat malam: Commander staples, foils & bulk rares (part 2 of 3)'), 'Jumaat malam_ Commander staples, foils & bulk rares (part 2 of 3)');
  assert.equal(fileSafe('<b>Clearance</b> & 50% off'), '_b_Clearance__b_ & 50% off');
  assert.equal(fileSafe('MH3 🔥 singles'), 'MH3 🔥 singles');
  assert.equal(fileSafe('  A\nB.  '), 'A B');
  assert.equal(fileSafe('...'), 'Post');
  assert.equal(Array.from(fileSafe('🔥'.repeat(100))).length, 80);
});
