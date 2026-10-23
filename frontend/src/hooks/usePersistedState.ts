import { useEffect, useState } from 'react';

// A value kept in localStorage as JSON; `initial` when missing or unreadable.
export function readStored<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw) as T;
  } catch {
    // ignore parse errors and fall back to initial
  }
  return initial;
}

export function writeStored<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota/storage errors
  }
}

// Like useState but persists to localStorage under the given key.
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, initial));
  useEffect(() => writeStored(key, value), [key, value]);
  return [value, setValue];
}
