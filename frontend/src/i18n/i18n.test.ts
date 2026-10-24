import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as claims from './claims.ts';
import { translate } from './index.ts';
import * as login from './login.ts';
import * as photo from './photo.ts';
import * as profile from './profile.ts';
import * as scanner from './scanner.ts';
import * as settings from './settings.ts';
import * as shell from './shell.ts';

const AREAS = { shell, scanner, photo, claims, settings, profile, login };

test('every area file has the same keys in English and Malay', () => {
  for (const area of Object.values(AREAS)) {
    assert.deepEqual([...Object.keys(area.ms)].sort(), [...Object.keys(area.en)].sort());
  }
});

test('no key lives in two area files', () => {
  const keys = Object.values(AREAS).flatMap(a => Object.keys(a.en));
  const seen = new Set<string>();
  const twice = keys.filter(k => seen.size === seen.add(k).size);
  assert.deepEqual(twice, []);
});

test('translate reads the merged dictionary', () => {
  assert.equal(translate('en', 'nav_claims'), 'Claims');
  assert.equal(translate('ms', 'nav_claims'), 'Tuntutan');
  assert.equal(translate('en', 'scans_photos', { n: 3 }), '3 photos');
  assert.equal(translate('ms', 'not_a_key'), 'not_a_key');
});
