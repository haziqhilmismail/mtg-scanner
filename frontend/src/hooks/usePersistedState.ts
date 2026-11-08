import { useEffect, useState } from 'react';
import { storage } from '../lib/storage.ts';

export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => storage.getJson(key, initial));
  useEffect(() => storage.setJson(key, value), [key, value]);
  return [value, setValue];
}
