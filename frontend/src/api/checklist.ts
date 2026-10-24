// Typed wrappers for the checklist endpoints (listings, buyers, orders).
// Decimal values come back as strings (Pydantic Decimal serialization).

import type { Settings } from '../types.ts';
import { request } from './http.ts';

export type ListingStatus = 'active' | 'archived';
export type OrderStatus = 'claimed' | 'cancelled';
export type PostStatus = 'active' | 'inactive' | 'archived';

export interface Buyer {
  id: number;
  user_id: number;
  fb_name: string;
  fb_url: string | null;
  phone: string | null;
  default_dropoff_method: string | null;
  default_dropoff_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  open_orders_count?: number;
  total_orders_count?: number;
}

export interface BuyerCreatePayload {
  fb_name: string;
  fb_url?: string | null;
  phone?: string | null;
  default_dropoff_method?: string | null;
  default_dropoff_address?: string | null;
  notes?: string | null;
}

export interface Listing {
  id: number;
  user_id: number;
  scan_id: number | null;
  post_ids: number[];
  bbox: [number, number, number, number] | null;
  scryfall_id: string | null;
  name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  rarity: string | null;
  is_foil: boolean;
  image_url: string | null;
  ck_url: string | null;
  unit_price_myr: string;
  qty_total: number;
  status: ListingStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  qty_committed?: number;
  qty_available?: number;
}

export interface ListingCreatePayload {
  name: string;
  scryfall_id?: string | null;
  set_code?: string | null;
  set_name?: string | null;
  collector_number?: string | null;
  rarity?: string | null;
  is_foil?: boolean;
  image_url?: string | null;
  ck_url?: string | null;
  unit_price_myr: string;  // Decimal as string to avoid float drift
  qty_total?: number;
  notes?: string | null;
  post_ids?: number[];
  // The photo the card was added from, and where on it.
  scan_id?: number | null;
  bbox?: number[] | null;
}

// ---------- Posts ----------
export interface Post {
  id: number;
  user_id: number;
  title: string | null;
  fb_url: string | null;
  note: string | null;
  status: PostStatus;
  image_path: string | null;
  image_mime: string | null;
  created_at: string;
  updated_at: string;
  listing_count: number;
  active_listing_count: number;
  total_qty: number;
  total_value_myr: string;
  has_image: boolean;
  // The post's own pricing; null = it follows the user's default.
  pricing: Settings | null;
}

export interface PostCreatePayload {
  title?: string | null;
  fb_url?: string | null;
  note?: string | null;
  image?: File | null;
  pricing?: Settings | null;
}

export interface PostUpdatePayload {
  title?: string | null;
  fb_url?: string | null;
  note?: string | null;
  status?: PostStatus;
  pricing?: Settings | null;
}

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
  has_delivery_photo: boolean;
  delivery_photo_uploaded_at: string | null;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
}

async function json<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const r = await request(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
  });
  // 204 No Content
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

// ---------- Buyers ----------
export const buyersApi = {
  list: () => json<Buyer[]>('GET', '/api/buyers'),
  update: (id: number, payload: Partial<BuyerCreatePayload>) =>
    json<Buyer>('PATCH', `/api/buyers/${id}`, payload),
};

// ---------- Listings ----------
export const listingsApi = {
  list: (status?: ListingStatus) =>
    json<Listing[]>('GET', `/api/listings${status ? `?status=${status}` : ''}`),
  create: (payload: ListingCreatePayload) => json<Listing>('POST', '/api/listings', payload),
  update: (id: number, payload: Partial<ListingCreatePayload> & { status?: ListingStatus }) =>
    json<Listing>('PATCH', `/api/listings/${id}`, payload),
};

// ---------- Orders ----------
// A buyer's summary was copied or shared: its lines are kept as sales records
// (price, card, how it was priced; nothing about the buyer). See PRIVACY.md.
export interface SentLine {
  order_item_id: number;
  app_usd: string | null;
  app_mult: string | null;
  price_kind: 'auto' | 'override' | 'manual' | null;
}
export const salesApi = {
  record: (channel: 'copy' | 'share', postId: number | null, postType: 'photo' | 'live', lines: SentLine[]) =>
    json<{ recorded: number }>('POST', '/api/sales', { channel, post_id: postId, post_type: postType, lines }, true),
};

export const ordersApi = {
  list: (includeArchived = false) =>
    json<Order[]>('GET', `/api/orders${includeArchived ? '?include_archived=true' : ''}`),
  update: (id: number, payload: { status?: OrderStatus; paid_at?: string | null; delivered_at?: string | null; dropoff_method?: string | null; dropoff_address?: string | null; notes?: string | null }) =>
    json<Order>('PATCH', `/api/orders/${id}`, payload),
  markPaid: (id: number) => json<Order>('POST', `/api/orders/${id}/mark-paid`),
  // Live-price posts: today's prices on an order not sent yet; `sent` fixes them.
  setPrices: (id: number, items: Array<{ id: number; unit_price_myr: string }>, sent = false) =>
    json<Order>('PUT', `/api/orders/${id}/prices`, { items, sent }),
  unsendPrices: (id: number) => json<Order>('DELETE', `/api/orders/${id}/prices-sent`),
  markDelivered: (id: number) => json<Order>('POST', `/api/orders/${id}/mark-delivered`),
  cancel: (id: number) => json<Order>('POST', `/api/orders/${id}/cancel`),
  // Undoes cancel; the paid and dropped-off times are kept.
  restore: (id: number) => json<Order>('POST', `/api/orders/${id}/restore`),
};

// ---------- Posts ----------
async function postMultipart<T>(url: string, fields: Record<string, string | Blob | undefined | null>, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    fd.append(k, v);
  }
  const r = await request(url, { method, body: fd });
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export const postsApi = {
  list: (includeArchived = false) =>
    json<Post[]>('GET', `/api/posts${includeArchived ? '?include_archived=true' : ''}`),
  create: (payload: PostCreatePayload) =>
    postMultipart<Post>('/api/posts', {
      title: payload.title ?? undefined,
      fb_url: payload.fb_url ?? undefined,
      note: payload.note ?? undefined,
      image: payload.image ?? undefined,
      pricing: payload.pricing ? JSON.stringify(payload.pricing) : undefined,
    }),
  // `keepalive` lets the save finish as the page closes.
  update: (id: number, payload: PostUpdatePayload, keepalive = false) =>
    json<Post>('PATCH', `/api/posts/${id}`, payload, keepalive),
  remove: (id: number) => json<void>('DELETE', `/api/posts/${id}`),
};
