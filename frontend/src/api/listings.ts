// Decimal values come back as strings (Pydantic Decimal serialization).

import { fetchJson } from './http.ts';

export type ListingStatus = 'active' | 'archived';

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
  unit_price_myr: string;
  qty_total?: number;
  notes?: string | null;
  post_ids?: number[];
  // The photo the card was added from, and where on it.
  scan_id?: number | null;
  bbox?: number[] | null;
}

export const fetchListings = (status?: ListingStatus) =>
  fetchJson<Listing[]>('GET', `/api/listings${status ? `?status=${status}` : ''}`);
export const createListing = (payload: ListingCreatePayload) => fetchJson<Listing>('POST', '/api/listings', payload);
export const updateListing = (id: number, payload: Partial<ListingCreatePayload> & { status?: ListingStatus }) =>
  fetchJson<Listing>('PATCH', `/api/listings/${id}`, payload);
export const deleteListing = (id: number) => fetchJson<void>('DELETE', `/api/listings/${id}`);
