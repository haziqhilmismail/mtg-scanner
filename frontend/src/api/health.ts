import { request } from './http.ts';

// GET /api/health (backend/app/main.py health).
export interface Health {
  ok: boolean;
  model?: string;
  gemini_error?: string;
  scanner_error?: string;
  cardkingdom_cards?: number;
  cardkingdom_error?: string;
  // Unix epoch seconds: the file mtime of ck_index.db, shown as "2h ago" so
  // the seller can decide when to refresh prices.
  cardkingdom_refreshed_at?: number;
}

export async function fetchHealth(): Promise<Health> {
  return (await request('/api/health')).json();
}
