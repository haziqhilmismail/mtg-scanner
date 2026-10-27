// A repost: a post's photos again, as a new post, for the cards still unsold.
// A card every copy of which is claimed is removed and marked sold, so its
// photo covers it; a card partly claimed keeps the copies left. Pure, so the
// dialog's counts and what the server is sent come from one rule.

import type { Listing, Order } from '../api/checklist.ts';
import type { Batch, ScanUiState } from '../types.ts';
import { bboxKey, uiStateOf } from '../utils.ts';

export interface RepostPhoto {
  scanId: number;
  state: ScanUiState;
  left: number;   // copies still for sale
  sold: number;   // cards covered as sold
}

// `batches`: the post's saved photos in post order. Returns the photos with a
// card left, in that order. Every claim not cancelled
// holds its copies, archived ones too, as on the Claims page.
export function repostPlan(batches: Batch[], listings: Listing[], orders: Order[]): RepostPhoto[] {
  const listingsById = new Map(listings.map(l => [l.id, l]));
  const claimed = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const i of o.items) {
      const l = listingsById.get(i.listing_id);
      if (l?.scan_id == null || !l.bbox) continue;
      const key = `${l.scan_id}:${bboxKey(l.bbox)}`;
      claimed.set(key, (claimed.get(key) ?? 0) + i.qty);
    }
  }

  const plan: RepostPhoto[] = [];
  for (const b of batches) {
    if (b.scanId == null || !b.response) continue;
    // A new post: nothing finished on it yet, so its prices follow the
    // seller's settings again.
    const state = {
      ...uiStateOf(b), lockedAt: null, locked: b.response.cards.map(() => null),
      quantity: [...b.quantity], removed: [...b.removed], sold: [...b.sold],
    };
    let left = 0;
    let sold = 0;
    b.response.cards.forEach((c, i) => {
      if (state.removed[i]) return;
      const qty = Math.max(1, state.quantity[i] || 1);
      const taken = claimed.get(`${b.scanId}:${bboxKey(c.bbox)}`) ?? 0;
      if (taken >= qty) {
        state.removed[i] = true;
        state.sold[i] = true;
        sold += 1;
      } else {
        state.quantity[i] = qty - taken;
        left += qty - taken;
      }
    });
    if (left) plan.push({ scanId: b.scanId, state, left, sold });
  }
  return plan;
}
