import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as claims from './claims.ts';
import { plural, translate, type Key, type T } from './index.ts';
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

test('an English string and its Malay twin take the same placeholders, and translate fills each one', () => {
  const tokens = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
  const wrong: string[] = [];
  for (const area of Object.values(AREAS)) {
    for (const [key, text] of Object.entries(area.en)) {
      const names = tokens(text);
      const msNames = tokens((area.ms as Record<string, string>)[key]);
      if (names.join() !== msNames.join()) wrong.push(`${key}: en {${names}} / ms {${msNames}}`);
      const vars = Object.fromEntries(names.map(n => [n, `<${n}>`]));
      for (const lang of ['en', 'ms'] as const) {
        const out = translate(lang, key as Key, vars);
        if (names.some(n => !out.includes(`<${n}>`) || out.includes(`{${n}}`))) wrong.push(`${lang} ${key}: ${out}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
  assert.equal(translate('en', 'photos', { n: 3 }), '3 photos');
});

test('plural picks the _one twin for 1 and writes thousands with commas', () => {
  const en: T = (k, v) => translate('en', k, v);
  const ms: T = (k, v) => translate('ms', k, v);
  assert.equal(plural(en, 'cards', 1), '1 card');
  assert.equal(plural(en, 'cards', 1240), '1,240 cards');
  assert.equal(plural(ms, 'cards', 1240), '1,240 kad');
});
