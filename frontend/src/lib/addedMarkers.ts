// Older versions remembered which cards were added to the checklist in
// localStorage, as scan id → card index → listing id, under
// `mtg.scanner.added.<user id>.<scan id>` (before that, without the user id).
// Listings now record their photo on the server. This ties each remembered
// listing to its photo there, then forgets the marker.

import { listingsApi } from '../api/checklist.ts';
import type { Batch } from '../types.ts';

const MARKER = /^mtg\.scanner\.added\.(?:[^.]+\.)?(\d+)$/;

// Markers of scans not in `batches` (another account's) are left alone. A
// marker whose listing is gone is dropped; one that fails otherwise is kept
// for the next load, and its card still shows as added so Add can't
// duplicate it meanwhile.
export async function migrateAdded(batches: Batch[], onListed: (batchId: string, bbox: number[]) => void) {
  let keys: string[];
  try { keys = Object.keys(localStorage); } catch { return; }
  for (const key of keys) {
    const scanId = Number(MARKER.exec(key)?.[1]);
    const batch = batches.find(b => b.scanId === scanId);
    if (!batch?.response) continue;
    let marker: Record<string, number> = {};
    try { marker = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { /* corrupt: drop it */ }
    let keep = false;
    for (const [idx, listingId] of Object.entries(marker)) {
      const card = batch.response.cards[Number(idx)];
      if (!card || typeof listingId !== 'number') continue;
      try {
        await listingsApi.update(listingId, { scan_id: scanId, bbox: card.bbox });
        onListed(batch.id, card.bbox);
      } catch (e) {
        if ((e as { status?: number }).status !== 404) { keep = true; onListed(batch.id, card.bbox); }
      }
    }
    if (!keep) try { localStorage.removeItem(key); } catch { /* storage disabled */ }
  }
}
