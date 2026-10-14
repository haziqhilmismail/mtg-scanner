// Typed wrappers for the checklist endpoints (listings, buyers, orders).
// Decimal values come back as strings (Pydantic Decimal serialization).

import { imageUrl, request } from './http.ts';

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
}

export interface PostCreatePayload {
  title?: string | null;
  fb_url?: string | null;
  note?: string | null;
  image?: File | null;
}

export interface PostUpdatePayload {
  title?: string | null;
  fb_url?: string | null;
  note?: string | null;
  status?: PostStatus;
}

// ---------- Bulk import ----------
export interface BulkImportLineResult {
  raw: string;
  ok: boolean;
  error: string | null;
  listing_id: number | null;
  name: string | null;
  set_code: string | null;
  collector_number: string | null;
  is_foil: boolean;
  qty: number;
  unit_price_myr: string | null;
  image_url: string | null;
}

export interface BulkImportResult {
  created: number;
  skipped: number;
  lines: BulkImportLineResult[];
}

// ---------- Scryfall sets ----------
export interface SetEntry {
  code: string;
  name: string;
  released_at: string | null;
  set_type: string | null;
  icon_svg_uri: string | null;
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
  total_myr: string;
  dropoff_method: string | null;
  dropoff_address: string | null;
  notes: string | null;
  // Optional delivery-proof photo metadata. Bytes are fetched via
  // ordersApi.deliveryPhotoUrl(id) — auth via the image token in the URL.
  has_delivery_photo: boolean;
  delivery_photo_uploaded_at: string | null;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
}

export interface OrderItemPayload {
  listing_id: number;
  qty: number;
  unit_price_myr?: string;
}

export interface OrderCreatePayload {
  // Provide either `buyer_id` (existing buyer) or `buyer_fb_name` (lookup-or-create).
  // Backend resolves it to an existing buyer by case-insensitive FB name, or creates one.
  // `buyer_fb_url` and `buyer_phone` are written back onto the buyer only when
  // the stored field is still null — they don't overwrite existing data.
  buyer_id?: number;
  buyer_fb_name?: string;
  buyer_fb_url?: string | null;
  buyer_phone?: string | null;
  items: OrderItemPayload[];
  dropoff_method?: string | null;
  dropoff_address?: string | null;
  notes?: string | null;
}

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await request(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // 204 No Content
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

// ---------- Buyers ----------
export const buyersApi = {
  list: () => json<Buyer[]>('GET', '/api/buyers'),
  create: (payload: BuyerCreatePayload) => json<Buyer>('POST', '/api/buyers', payload),
  update: (id: number, payload: Partial<BuyerCreatePayload>) =>
    json<Buyer>('PATCH', `/api/buyers/${id}`, payload),
  remove: (id: number) => json<void>('DELETE', `/api/buyers/${id}`),
};

// ---------- Listings ----------
export const listingsApi = {
  list: (status?: ListingStatus) =>
    json<Listing[]>('GET', `/api/listings${status ? `?status=${status}` : ''}`),
  create: (payload: ListingCreatePayload) => json<Listing>('POST', '/api/listings', payload),
  update: (id: number, payload: Partial<ListingCreatePayload> & { status?: ListingStatus }) =>
    json<Listing>('PATCH', `/api/listings/${id}`, payload),
  archive: (id: number) => json<void>('DELETE', `/api/listings/${id}`),
  bulkImport: (text: string, post_id: number | null) =>
    json<BulkImportResult>('POST', '/api/listings/bulk-import', { text, post_id }),
};

// ---------- Orders ----------
export const ordersApi = {
  list: (includeArchived = false) =>
    json<Order[]>('GET', `/api/orders${includeArchived ? '?include_archived=true' : ''}`),
  create: (payload: OrderCreatePayload) => json<Order>('POST', '/api/orders', payload),
  update: (id: number, payload: { status?: OrderStatus; paid_at?: string | null; delivered_at?: string | null; dropoff_method?: string | null; dropoff_address?: string | null; notes?: string | null }) =>
    json<Order>('PATCH', `/api/orders/${id}`, payload),
  markPaid: (id: number) => json<Order>('POST', `/api/orders/${id}/mark-paid`),
  markDelivered: (id: number) => json<Order>('POST', `/api/orders/${id}/mark-delivered`),
  cancel: (id: number) => json<Order>('POST', `/api/orders/${id}/cancel`),
  archive: (id: number) => json<Order>('POST', `/api/orders/${id}/archive`),
  unarchive: (id: number) => json<Order>('POST', `/api/orders/${id}/unarchive`),
  uploadDeliveryPhoto: (id: number, image: File) =>
    postMultipart<Order>(`/api/orders/${id}/delivery-photo`, { image }),
  deleteDeliveryPhoto: (id: number) =>
    json<void>('DELETE', `/api/orders/${id}/delivery-photo`),
  // A cache-busting `v=` is appended so a freshly uploaded photo replaces the
  // cached version in the browser without a hard refresh.
  deliveryPhotoUrl: (id: number, version?: string | null) =>
    imageUrl(`/api/orders/${id}/delivery-photo`, { v: version }),
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
    }),
  update: (id: number, payload: PostUpdatePayload) =>
    json<Post>('PATCH', `/api/posts/${id}`, payload),
  uploadImage: (id: number, image: File) =>
    postMultipart<Post>(`/api/posts/${id}/image`, { image }),
  deleteImage: (id: number) => json<void>('DELETE', `/api/posts/${id}/image`),
  remove: (id: number) => json<void>('DELETE', `/api/posts/${id}`),
  imageUrl: (id: number) => imageUrl(`/api/posts/${id}/image`),
  // Replace the full set of stock items linked to this post (set-membership semantics).
  setListings: (id: number, listing_ids: number[]) =>
    json<Post>('PUT', `/api/posts/${id}/listings`, { listing_ids }),
};

// ---------- Scryfall sets (cached) ----------
let _setsCache: SetEntry[] | null = null;
let _setsPromise: Promise<SetEntry[]> | null = null;

export const setsApi = {
  list: async (): Promise<SetEntry[]> => {
    if (_setsCache) return _setsCache;
    if (_setsPromise) return _setsPromise;
    _setsPromise = json<SetEntry[]>('GET', '/api/sets')
      .then(data => {
        _setsCache = data;
        _setsPromise = null;
        return data;
      })
      .catch(e => { _setsPromise = null; throw e; });
    return _setsPromise;
  },
};

// ---------- Scryfall card-names catalog (cached) ----------
let _cardNamesCache: string[] | null = null;
let _cardNamesPromise: Promise<string[]> | null = null;

export const cardNamesApi = {
  list: async (): Promise<string[]> => {
    if (_cardNamesCache) return _cardNamesCache;
    if (_cardNamesPromise) return _cardNamesPromise;
    _cardNamesPromise = json<string[]>('GET', '/api/card-names')
      .then(data => {
        _cardNamesCache = data;
        _cardNamesPromise = null;
        return data;
      })
      .catch(e => { _cardNamesPromise = null; throw e; });
    return _cardNamesPromise;
  },
};
