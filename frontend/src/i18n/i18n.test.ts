import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as claims from './claims.ts';
import { plural, translate, type T } from './index.ts';
import * as login from './login.ts';
import * as photo from './photo.ts';
import * as profile from './profile.ts';
import * as posts from './posts.ts';
import * as scanner from './scanner.ts';
import * as settings from './settings.ts';
import * as shell from './shell.ts';

const AREAS = { shell, scanner, posts, photo, claims, settings, profile, login };

test('no key lives in two area files', () => {
  const keys = Object.values(AREAS).flatMap(a => Object.keys(a.en));
  const seen = new Set<string>();
  const twice = keys.filter(k => seen.size === seen.add(k).size);
  assert.deepEqual(twice, []);
});

test('translate reads the merged dictionary', () => {
  assert.equal(translate('en', 'nav_claims'), 'Claims');
  assert.equal(translate('ms', 'nav_claims'), 'Tuntutan');
  assert.equal(translate('en', 'post_photos_count', { n: 3 }), '3 photos');
});

test('plural picks the _one twin for 1 and writes thousands with commas', () => {
  const en: T = (k, v) => translate('en', k, v);
  const ms: T = (k, v) => translate('ms', k, v);
  assert.equal(plural(en, 'post_cards', 1), '1 card');
  assert.equal(plural(en, 'post_cards', 1240), '1,240 cards');
  assert.equal(plural(ms, 'post_cards', 1240), '1,240 kad');
});
