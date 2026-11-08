import { createContext, useCallback, useContext } from 'react';
import { translate, type Key, type T } from '../i18n/index.ts';
import { KEY } from '../lib/storage.ts';
import { usePersistedState } from './usePersistedState.ts';
import type { Lang } from '../types.ts';

export type { Key, T };

export function useLang() {
  const [lang, setLang] = usePersistedState<Lang>(KEY.lang, 'en');
  const t = useCallback<T>(
    (key, vars) => translate(lang, key, vars),
    [lang],
  );
  return { lang, setLang, t };
}

const TContext = createContext<T>((key, vars) => translate('en', key, vars));

// App provides its t; a component under it can call useT() instead of
// taking a t prop.
export const TProvider = TContext.Provider;
export const useT = () => useContext(TContext);
