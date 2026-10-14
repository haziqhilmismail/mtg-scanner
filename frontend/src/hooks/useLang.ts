import { useCallback } from 'react';
import { translate } from '../i18n.ts';
import { usePersistedState } from './usePersistedState.ts';
import type { Lang } from '../types.ts';

export type T = (k: string, vars?: Record<string, string | number>) => string;

export function useLang() {
  const [lang, setLang] = usePersistedState<Lang>('mtg.lang', 'en');
  const t = useCallback<T>(
    (key, vars) => translate(lang, key, vars),
    [lang],
  );
  return { lang, setLang, t };
}
