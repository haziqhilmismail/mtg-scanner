import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type RoundDirection, type RoundStep, type Settings } from '../types.ts';

const STORAGE_KEY = 'mtg.settings';
const VERSION_KEY = 'mtg.settings.v';
const CURRENT_VERSION = 3;

// Load + migrate persisted settings.
// v1 -> v2: labelPosition default changed from 'bottom' to 'center'.
// v2 -> v3: `rounding: RoundingMode` (e.g. 'up_1') split into `roundDirection`
// + `roundStep`. Old combined value is parsed and dropped.
function loadInitial(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings> & { rounding?: string };
    const { rounding: legacyRounding, ...rest } = parsed;
    const merged: Settings = { ...DEFAULT_SETTINGS, ...rest };
    const version = parseInt(localStorage.getItem(VERSION_KEY) || '1', 10) || 1;
    if (version < 2 && parsed.labelPosition === 'bottom') {
      merged.labelPosition = 'center';
    }
    if (version < 3 && typeof legacyRounding === 'string') {
      // Old format: 'none' | '{up|down|nearest}_{0.5|1}'
      if (legacyRounding === 'none') {
        merged.roundDirection = 'none';
      } else {
        const [dir, stepStr] = legacyRounding.split('_');
        const VALID_DIRS: RoundDirection[] = ['up', 'down', 'nearest'];
        const VALID_STEPS: RoundStep[] = [0.1, 0.5, 1];
        if (VALID_DIRS.includes(dir as RoundDirection)) {
          merged.roundDirection = dir as RoundDirection;
        }
        const stepNum = parseFloat(stepStr) as RoundStep;
        if (VALID_STEPS.includes(stepNum)) {
          merged.roundStep = stepNum;
        }
      }
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
