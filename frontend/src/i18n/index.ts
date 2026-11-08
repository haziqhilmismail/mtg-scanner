// English + Malay strings, merged from the area files. Strings with
// placeholders use {name} tokens.

import type { Lang } from '../types.ts';
import * as claims from './claims.ts';
import * as login from './login.ts';
import * as photo from './photo.ts';
import * as profile from './profile.ts';
import * as posts from './posts.ts';
import * as scanner from './scanner.ts';
import * as settings from './settings.ts';
import * as shell from './shell.ts';

type Vars = Record<string, string | number>;

const en = { ...shell.en, ...scanner.en, ...posts.en, ...photo.en, ...claims.en, ...settings.en, ...profile.en, ...login.en };

// Every message key; a typo or a deleted key is a type error at the call.
export type Key = keyof typeof en;

// The keys of a count in words, each with its "_one" twin: "3 cards", "1 card".
export type Counted = { [K in Key]: `${K}_one` extends Key ? K : never }[Key];

// A translate function bound to the current language (see useLang).
export type T = (k: Key, vars?: Vars) => string;

const STRINGS: Record<Lang, Record<Key, string>> = {
  en,
  ms: { ...shell.ms, ...scanner.ms, ...posts.ms, ...photo.ms, ...claims.ms, ...settings.ms, ...profile.ms, ...login.ms },
};

export const plural = (t: T, key: Counted, n: number, vars?: Vars) =>
  t(n === 1 ? `${key}_one` : key, { ...vars, n: n.toLocaleString('en-MY') });

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  let s = STRINGS[lang][key];
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    }
  }
  return s;
}
