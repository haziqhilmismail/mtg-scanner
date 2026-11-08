// Everything the app keeps in this browser, under one list of keys. Storage
// can be disabled, full, or hold a corrupt value, so no read or write throws:
// a read gives its fallback and a write is dropped.

export const KEY = {
  authToken: 'mtg.auth.token',
  imageToken: 'mtg.auth.image_token',
  lang: 'mtg.lang',
  appearance: 'mtg.appearance',
  claimsSort: 'mtg.claims.sort',
  supportAsk: 'mtg.claims.supportAsk',
  finishExplained: 'mtg.finish.explained',
  // Scan ids the user deleted whose server DELETE is not confirmed yet. Per
  // user, so another account signing in here doesn't clear them. (The dev
  // fixtures start their scan ids high so they never meet a real one here.)
  tombstones: (userId: number | null) => `mtg.scan_tombstones.${userId}`,
};

const safe = <T>(read: () => T, fallback: T): T => {
  try { return read(); } catch { return fallback; }
};

export const storage = {
  get: (key: string): string | null => safe(() => localStorage.getItem(key), null),
  set: (key: string, value: string): void => safe(() => localStorage.setItem(key, value), undefined),
  remove: (key: string): void => safe(() => localStorage.removeItem(key), undefined),
  keys: (): string[] => safe(() => Object.keys(localStorage), []),
  // A JSON value; `fallback` when missing or unreadable.
  getJson: <T>(key: string, fallback: T): T => safe(() => {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw) as T;
  }, fallback),
  setJson: (key: string, value: unknown): void => storage.set(key, JSON.stringify(value)),
};

// A set of scan ids (KEY.tombstones and the shared key before it), kept as a
// JSON array; anything else stored there reads as empty.
export function readTombstones(key: string): Set<number> {
  const ids = storage.getJson<unknown>(key, []);
  return new Set(Array.isArray(ids) ? ids.filter((n): n is number => typeof n === 'number') : []);
}
export const writeTombstones = (key: string, s: Set<number>) => (s.size === 0 ? storage.remove(key) : storage.setJson(key, Array.from(s)));
