// Decimal values come back as strings (Pydantic Decimal serialization).

import type { ScanUiState } from '../lib/scanState.ts';
import type { Settings } from '../types.ts';
import { fetchJson, request } from './http.ts';
import { withPictureUrls, type SavedScan } from './scans.ts';

export type PostStatus = 'active' | 'inactive' | 'archived';

export interface Post {
  id: number;
  user_id: number;
  title: string | null;
  fb_url: string | null;
  note: string | null;
  status: PostStatus;
  created_at: string;
  updated_at: string;
  listing_count: number;
  active_listing_count: number;
  total_qty: number;
  total_value_myr: string;
  // Buyers with claims on the post, and how many still have to pay.
  buyer_count: number;
  unpaid_buyer_count: number;
  paid_myr: string;        // RM buyers have paid for its claims
  // The post's own pricing; null = it follows the user's default.
  pricing: Settings | null;
}

export interface PostCreatePayload {
  title?: string | null;
  fb_url?: string | null;
  note?: string | null;
  pricing?: Settings | null;
}

export interface PostUpdatePayload {
  title?: string | null;
  fb_url?: string | null;
  note?: string | null;
  status?: PostStatus;
  pricing?: Settings | null;
}

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

export const fetchPosts = (includeArchived = false) =>
  fetchJson<Post[]>('GET', `/api/posts${includeArchived ? '?include_archived=true' : ''}`);
export const createPost = (payload: PostCreatePayload) =>
  postMultipart<Post>('/api/posts', {
    title: payload.title ?? undefined,
    fb_url: payload.fb_url ?? undefined,
    note: payload.note ?? undefined,
    pricing: payload.pricing ? JSON.stringify(payload.pricing) : undefined,
  });
export const updatePost = (id: number, payload: PostUpdatePayload, keepalive = false) =>
  fetchJson<Post>('PATCH', `/api/posts/${id}`, payload, keepalive);
export const deletePost = (id: number) => fetchJson<void>('DELETE', `/api/posts/${id}`);

// A new post of a post's photos, for the cards still unsold (see lib/repost.ts).
export async function repostPost(
  postId: number, title: string, photos: Array<{ scanId: number; state: ScanUiState }>, newPrices: boolean,
): Promise<{ post: Post; scans: SavedScan[] }> {
  const out = await fetchJson<{ post: Post; scans: SavedScan[] }>('POST', `/api/posts/${postId}/repost`, {
    title, new_prices: newPrices, photos: photos.map(p => ({ scan_id: p.scanId, state: p.state })),
  });
  return { post: out.post, scans: out.scans.map(withPictureUrls) };
}
