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

// A translate function bound to the current language (see useLang).
export type T = (k: string, vars?: Vars) => string;

const STRINGS: Record<Lang, Record<string, string>> = {
  en: { ...shell.en, ...scanner.en, ...posts.en, ...photo.en, ...claims.en, ...settings.en, ...profile.en, ...login.en },
  ms: { ...shell.ms, ...scanner.ms, ...posts.ms, ...photo.ms, ...claims.ms, ...settings.ms, ...profile.ms, ...login.ms },
};

export function translate(lang: Lang, key: string, vars?: Vars): string {
  let s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    }
  }
  return s;
}
