import { useEffect, useState } from 'react';
import { usePersistedState } from './usePersistedState.ts';
import type { Appearance, Theme } from '../types.ts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

// The app follows the system appearance by default. `appearance` is the
// person's choice (auto / light / dark); `theme` is what's actually on screen.
export function useTheme() {
  const [appearance, setAppearance] = usePersistedState<Appearance>('mtg.appearance', 'auto');
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = appearance === 'auto' ? (systemDark ? 'dark' : 'light') : appearance;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Keep the browser chrome (address bar, status bar) in step with the page.
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#000000' : '#f2f2f7');
  }, [theme]);

  return { theme, appearance, setAppearance };
}
