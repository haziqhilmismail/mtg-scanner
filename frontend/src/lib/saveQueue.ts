import type { ScanUiState } from '../types.ts';

// Sends each scan's per-card state to the server. Every state sent carries a
// rev higher than any before it for that scan, and the server ignores a lower
// one, so saves may overlap and arrive in any order.

// One scan: the fingerprint of the latest state seen (the first one seen is
// what the server already has), the rev given to the latest queued state, the
// latest state the server has not confirmed, and whether it has been sent.
type Slot = { latest: string; rev: number; unsaved: ScanUiState | null; sent: boolean };

// Saves in flight at once, outside a final flush, so hundreds of edited scans
// don't all go at once.
export const MAX_IN_FLIGHT = 4;

export function createSaveQueue(
  send: (scanId: number, state: ScanUiState, final: boolean) => Promise<void>,
  // A save landed: the scan's old-browser copy can go.
  saved: (scanId: number) => void,
  // A save failed and should be tried again later.
  retry: () => void,
  // The server refused a save, so that edit is lost.
  refused: (scanId: number) => void,
) {
  const slots = new Map<number, Slot>();
  let inFlight = 0;

  // Next rev: past the loaded one even if this clock is behind the device that saved it.
  const queue = (slot: Slot, state: ScanUiState) => {
    slot.rev = Math.max(Date.now(), slot.rev + 1);
    slot.unsaved = { ...state, rev: slot.rev };
    slot.sent = false;
  };

  const api = {
    // A scan's current state (without rev), and the rev it was loaded with.
    // Says whether it is a change to save.
    update(scanId: number, state: ScanUiState, loadedRev = 0): boolean {
      const fingerprint = JSON.stringify(state);
      const slot = slots.get(scanId);
      if (!slot) {
        slots.set(scanId, { latest: fingerprint, rev: loadedRev, unsaved: null, sent: false });
        return false;
      }
      if (slot.latest === fingerprint) return false;
      slot.latest = fingerprint;
      queue(slot, state);
      return true;
    },

    // A scan whose loaded state the server doesn't have yet (an old-browser copy).
    seed(scanId: number, state: ScanUiState) {
      const slot: Slot = { latest: JSON.stringify(state), rev: 0, unsaved: null, sent: false };
      queue(slot, state);
      slots.set(scanId, slot);
    },

    forget: (scanId: number) => slots.delete(scanId),
    clear: () => slots.clear(),

    // Send every unsaved state not already sent, up to MAX_IN_FLIGHT at a
    // time; each one that ends sends the next. A final flush (leaving the
    // page, signing out) sends all of them, those already on their way too,
    // since the page may not live to see them land. A failed save is retried
    // while it is still the scan's latest, unless the server refused it.
    flush(final = false) {
      for (const [scanId, slot] of slots) {
        const state = slot.unsaved;
        if (!state || (slot.sent && !final)) continue;
        if (!final && inFlight >= MAX_IN_FLIGHT) return;
        slot.sent = true;
        inFlight++;
        send(scanId, state, final).then(
          () => {
            if (slot.unsaved === state) slot.unsaved = null;
            saved(scanId);
          },
          (e: Error & { status?: number }) => {
            // Superseded, or forgotten since (deleted, signed out).
            if (slot.unsaved !== state || slots.get(scanId) !== slot) return;
            // Refused (gone, too big, signed out): sending it again won't help.
            const s = e.status ?? 0;
            if (s >= 400 && s < 500 && s !== 408 && s !== 429) { slot.unsaved = null; refused(scanId); return; }
            slot.sent = false;
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
