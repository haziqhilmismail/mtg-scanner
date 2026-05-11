import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../types.ts';

const STORAGE_KEY = 'mtg.settings';
const VERSION_KEY = 'mtg.settings.v';
const CURRENT_VERSION = 2;

// Load + migrate persisted settings.
// v1 -> v2: labelPosition default changed from 'bottom' to 'center'.
// Users who explicitly chose 'top' or 'center' keep their pick; only the leftover
// 'bottom' (the old default) is bumped to the new default.
function loadInitial(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...DEFAULT_SETTINGS, ...parsed };
    const version = parseInt(localStorage.getItem(VERSION_KEY) || '1', 10) || 1;
    if (version < 2 && parsed.labelPosition === 'bottom') {
      merged.labelPosition = 'center';
    }
    try {
      localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION));
    } catch {
      // ignore quota errors
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota errors
    }
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  return { settings, update };
}
