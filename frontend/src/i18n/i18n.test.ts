import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS, translate } from './index.ts';

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
