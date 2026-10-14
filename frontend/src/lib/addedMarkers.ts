// Which cards of each scan were already added to the checklist, so a refresh
// doesn't silently re-enable Add-all and create duplicate listings. Kept per
// user (several accounts can share a browser) and per server scan id (the
// client-side batch id changes on every load).

type Added = Record<number, Record<number, number>>;  // scan id → card index → listing id

const prefix = (userId: number | null) => `mtg.scanner.added.${userId}.`;

export function loadAdded(userId: number | null): Added {
  const p = prefix(userId);
  const out: Added = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(p)) continue;
      const scanId = parseInt(key.slice(p.length), 10);
      if (isNaN(scanId)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      out[scanId] = JSON.parse(raw);
    }
  } catch { /* corrupted entries are ignored */ }
  return out;
}

export function saveAdded(userId: number | null, scanId: number, slice: Record<number, number>) {
  try { localStorage.setItem(prefix(userId) + scanId, JSON.stringify(slice)); }
  catch { /* quota / disabled storage — silent */ }
}

// Forget the markers of this user's scans that no longer exist.
export function forgetAddedExcept(userId: number | null, scanIds: Set<number | null>) {
  const p = prefix(userId);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(p) && !scanIds.has(Number(key.slice(p.length)))) localStorage.removeItem(key);
    }
  } catch { /* storage disabled */ }
}
