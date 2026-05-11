import { useEffect } from 'react';
import { usePersistedState } from './usePersistedState.ts';
import type { Theme } from '../types.ts';

export function useTheme() {
  const [theme, setTheme] = usePersistedState<Theme>('mtg.theme', 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  };
}
