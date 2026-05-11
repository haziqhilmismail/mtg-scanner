import { useCallback } from 'react';
import { translate } from '../i18n.ts';
import { usePersistedState } from './usePersistedState.ts';
import type { Lang } from '../types.ts';

export function useLang() {
  const [lang, setLang] = usePersistedState<Lang>('mtg.lang', 'en');
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
  return { lang, setLang, t };
}
