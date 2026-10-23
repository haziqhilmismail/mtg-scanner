// Sends values (a scan's per-card state, a post's pricing) to the server, one
// slot per key. Every value queued gets a rev higher than any before it for
// that key; where the server ignores a lower rev (scan states), saves may
// overlap and arrive in any order. Where it doesn't (`ordered`), a key's next
// save waits for the one in flight.

// One key: the fingerprint of the latest value seen (the first one seen is
// what the server already has), the rev given to the latest queued value, the
// latest value the server has not confirmed, how it has been sent (null: not
// yet), and how many of the key's saves are in flight.
type Slot<V> = { latest: string; rev: number; unsaved: V | null; sentWith: null | 'normal' | 'keepalive'; inFlight: number };

// Saves in flight at once, outside a final flush, so hundreds of edited scans
// don't all go at once.
export const MAX_IN_FLIGHT = 4;

export function createSaveQueue<K, V>(
  send: (key: K, value: V, final: boolean, rev: number) => Promise<void>,
  // A save landed (the key may have a newer value still unsaved).
  saved: (key: K) => void,
  // A save failed and should be tried again later.
  retry: () => void,
  // The server refused a save, so that edit is lost.
  refused: (key: K) => void,
  { ordered = false } = {},
) {
  const slots = new Map<K, Slot<V>>();
  let inFlight = 0;

  const add = (key: K, latest: string, rev: number) => {
    const s: Slot<V> = { latest, rev, unsaved: null, sentWith: null, inFlight: 0 };
    slots.set(key, s);
    return s;
  };

  // Next rev: past the loaded one even if this clock is behind the device that saved it.
  const queue = (s: Slot<V>, value: V) => {
    s.rev = Math.max(Date.now(), s.rev + 1);
    s.unsaved = value;
    s.sentWith = null;
  };

  const api = {
    // A key's current value, and the rev it was loaded with. The first value
    // seen for a key is what the server has. Says whether it is a change to save.
    update(key: K, value: V, loadedRev = 0): boolean {
      const fingerprint = JSON.stringify(value);
      const s = slots.get(key);
      if (!s) { add(key, fingerprint, loadedRev); return false; }
      if (s.latest === fingerprint) return false;
      s.latest = fingerprint;
      queue(s, value);
      return true;
    },

    // A value the server doesn't have yet: an old-browser copy, an edit.
    save(key: K, value: V) {
      const fingerprint = JSON.stringify(value);
      const s = slots.get(key) ?? add(key, fingerprint, 0);
      s.latest = fingerprint;
      queue(s, value);
    },

    // Whether the key has a value the server hasn't confirmed.
    busy: (key: K) => { const s = slots.get(key); return !!s && (s.unsaved != null || s.inFlight > 0); },

    forget: (key: K) => slots.delete(key),
    clear: () => slots.clear(),

    // Send every unsaved value not already sent, up to MAX_IN_FLIGHT at a
    // time; each one that ends sends the next. A final flush (leaving the
    // page, signing out) sends all of them, those already on their way too
    // unless sent with keepalive, since the page may not live to see them
    // land. A failed save is retried while it is still the key's latest,
    // unless the server refused it.
    flush(final = false) {
      for (const [key, s] of slots) {
        const value = s.unsaved;
        if (value == null || (s.sentWith && (!final || s.sentWith === 'keepalive'))) continue;
        // Final ignores order: a second save may overtake the one in flight and the
        // rev-less server keep the older, but dropping the edit on close is worse.
        if (!final && ordered && s.inFlight) continue;
        if (!final && inFlight >= MAX_IN_FLIGHT) return;
        s.sentWith = final ? 'keepalive' : 'normal';
        s.inFlight++;
        inFlight++;
        send(key, value, final, s.rev).then(
          () => {
            s.inFlight--;
            if (s.unsaved === value) s.unsaved = null;
            saved(key);
          },
          (e: Error & { status?: number }) => {
            s.inFlight--;
            // Superseded, or forgotten since (deleted, signed out).
            if (s.unsaved !== value || slots.get(key) !== s) return;
            // Refused (gone, too big, signed out): sending it again won't help.
            const status = e.status ?? 0;
            if (status >= 400 && status < 500 && status !== 408 && status !== 429) { s.unsaved = null; refused(key); return; }
            s.sentWith = null;
            retry();
            return true;
          },
        ).then(retrying => {
          inFlight--;
          // Not after a failure to retry: that waits for the retry.
          if (!retrying) api.flush();
        });
      }
    },
  };
  return api;
}
