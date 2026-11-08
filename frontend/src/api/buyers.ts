import { fetchJson } from './http.ts';

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

export const fetchBuyers = () => fetchJson<Buyer[]>('GET', '/api/buyers');
export const updateBuyer = (id: number, payload: Partial<BuyerCreatePayload>) =>
  fetchJson<Buyer>('PATCH', `/api/buyers/${id}`, payload);
