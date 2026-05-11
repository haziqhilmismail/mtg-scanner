import { useEffect, useState } from 'react';

// Like useState but persists to localStorage under the given key.
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      // ignore parse errors and fall back to initial
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota/storage errors
    }
  }, [key, value]);

  return [value, setValue];
}
