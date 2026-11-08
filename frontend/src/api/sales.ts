import { fetchJson } from './http.ts';

// A buyer's summary was copied or shared: its lines are kept as sales records
// (price, card, how it was priced; nothing about the buyer). See PRIVACY.md.
export interface SentLine {
  order_item_id: number;
  app_usd: string | null;
  app_mult: string | null;
  price_kind: 'auto' | 'override' | 'manual' | null;
}
export const recordSales = (channel: 'copy' | 'share', postId: number | null, postType: 'photo' | 'live', lines: SentLine[]) =>
  fetchJson<{ recorded: number }>('POST', '/api/sales', { channel, post_id: postId, post_type: postType, lines }, true);
