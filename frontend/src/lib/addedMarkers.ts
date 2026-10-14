// Which cards of each scan were already added to the checklist, so a refresh
// doesn't silently re-enable Add-all and create duplicate listings. Kept per
// user (several accounts can share a browser) and per server scan id (the
// client-side batch id changes on every load).

type Added = Record<number, Record<number, number>>;  // scan id → card index → listing id

const prefix = (userId: number | null) => `mtg.scanner.added.${userId}.`;

// A marker, or null (and the key removed) if it is corrupt.
function read(key: string): Record<number, number> | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '');
    if (v && typeof v === 'object') return v;
  } catch { /* corrupt */ }
  try { localStorage.removeItem(key); } catch { /* storage disabled */ }
  return null;
}

function keys(): string[] {
  try { return Object.keys(localStorage); } catch { return []; }
}

export function loadAdded(userId: number | null): Added {
  const p = prefix(userId);
  const out: Added = {};
  for (const key of keys()) {
    if (!key.startsWith(p)) continue;
    const v = read(key);
    if (v) out[Number(key.slice(p.length))] = v;
  }
  return out;
}

export function saveAdded(userId: number | null, scanId: number, slice: Record<number, number>) {
  try { localStorage.setItem(prefix(userId) + scanId, JSON.stringify(slice)); }
  catch { /* quota / disabled storage — silent */ }
}

// Take over the markers older versions kept without a user
// (`mtg.scanner.added.<scan id>`) for these scans of this user; with `prune`
// (once all of them are known), also forget this user's markers of scans that
// no longer exist. Unowned markers of other scans are left for the account
// they belong to. Says whether any marker was taken over.
export function settleAdded(userId: number | null, scanIds: Set<number | null>, prune: boolean): boolean {
  const p = prefix(userId);
  let took = false;
  for (const key of keys()) {
    const old = /^mtg\.scanner\.added\.(\d+)$/.exec(key);
    if (old && scanIds.has(Number(old[1]))) {
      const v = read(key);
      if (v) saveAdded(userId, Number(old[1]), { ...v, ...read(p + old[1]) });
      try { localStorage.removeItem(key); } catch { /* storage disabled */ }
      took = true;
    } else if (prune && key.startsWith(p) && !scanIds.has(Number(key.slice(p.length)))) {
      try { localStorage.removeItem(key); } catch { /* storage disabled */ }
    }
  }
  return took;
}
