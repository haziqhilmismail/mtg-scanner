// Decimal values come back as strings (Pydantic Decimal serialization).

import { fetchJson } from './http.ts';

export type OrderStatus = 'claimed' | 'cancelled';

export interface OrderItem {
  id: number;
  order_id: number;
  listing_id: number;
  qty: number;
  unit_price_myr: string;
  line_total_myr: string;
  name_snapshot: string;
  set_snapshot: string | null;
  created_at: string;
}

export interface Order {
  id: number;
  user_id: number;
  buyer_id: number;
  status: OrderStatus;
  paid_at: string | null;
  delivered_at: string | null;
  archived_at: string | null;
  // Live-price posts: when the buyer was sent their prices (then they stay).
  prices_sent_at: string | null;
  total_myr: string;
  dropoff_method: string | null;
  dropoff_address: string | null;
  notes: string | null;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
}

export const fetchOrders = (includeArchived = false) =>
  fetchJson<Order[]>('GET', `/api/orders${includeArchived ? '?include_archived=true' : ''}`);
export const updateOrder = (id: number, payload: { paid_at?: string | null; delivered_at?: string | null; dropoff_method?: string | null; dropoff_address?: string | null; notes?: string | null }) =>
  fetchJson<Order>('PATCH', `/api/orders/${id}`, payload);
// Live-price posts: today's prices on an order not sent yet; `sent` fixes them.
export const setOrderPrices = (id: number, items: Array<{ id: number; unit_price_myr: string }>, sent = false) =>
  fetchJson<Order>('PUT', `/api/orders/${id}/prices`, { items, sent });
export const unsendOrderPrices = (id: number) => fetchJson<Order>('DELETE', `/api/orders/${id}/prices-sent`);
export const cancelOrder = (id: number) => fetchJson<Order>('POST', `/api/orders/${id}/cancel`);
// Undoes cancel; the paid and dropped-off times are kept.
export const restoreOrder = (id: number) => fetchJson<Order>('POST', `/api/orders/${id}/restore`);
