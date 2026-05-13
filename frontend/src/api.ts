// Typed wrappers over the FastAPI backend. Vite proxies /api/* to localhost:8000
// in dev (see vite.config.ts).

import { authHeaders } from './api/auth.ts';
import type { Candidate, ScanResponse } from './types.ts';

export interface Health {
  ok: boolean;
  model?: string;
  gemini_error?: string;
  cardkingdom_cards?: number;
  cardkingdom_error?: string;
}

export async function fetchHealth(): Promise<Health> {
  const r = await fetch('/api/health');
  if (!r.ok) throw new Error(`Health check failed: ${r.status}`);
  return (await r.json()) as Health;
}

export interface SavedScan extends ScanResponse {
  scan_id: number;
  filename: string;
  created_at: string | null;
}

// Loads all saved scans (most-recent first) for rehydration after a page refresh.
export async function fetchScans(limit = 30): Promise<SavedScan[]> {
  const r = await fetch(`/api/scans?limit=${limit}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`fetchScans failed: ${r.status}`);
  return (await r.json()) as SavedScan[];
}

export async function deleteScan(id: number): Promise<void> {
  const r = await fetch(`/api/scans/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new Error(`deleteScan failed: ${r.status}`);
}

export async function scanImage(file: File): Promise<ScanResponse> {
  const fd = new FormData();
  fd.append('image', file);
  const r = await fetch('/api/scan', { method: 'POST', body: fd, headers: authHeaders() });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Scan failed: ${r.status} ${t.slice(0, 200)}`);
  }
  return (await r.json()) as ScanResponse;
}

export async function relookup(name: string, set?: string): Promise<Candidate> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ name, set }));
  const r = await fetch('/api/relookup', { method: 'POST', body: fd, headers: authHeaders() });
  if (!r.ok) {
    const err = new Error(`Relookup failed: ${r.status}`);
    (err as Error & { status?: number }).status = r.status;
    throw err;
  }
  return (await r.json()) as Candidate;
}

export async function fetchPrintings(name: string): Promise<{ name: string; printings: Candidate[] }> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ name }));
  const r = await fetch('/api/printings', { method: 'POST', body: fd, headers: authHeaders() });
  if (!r.ok) {
    const err = new Error(`Printings lookup failed: ${r.status}`);
    (err as Error & { status?: number }).status = r.status;
    throw err;
  }
  return (await r.json()) as { name: string; printings: Candidate[] };
}

export interface ExportPayload {
  image_id: string;
  cards: Array<{
    bbox: [number, number, number, number];
    corners?: [number, number][];  // 4-point quad (TL,TR,BR,BL) when classical-refined
    is_foil: boolean;
    label_override: string;
    // Per-card pill offset in source-image pixels, set by dragging the pill in
    // the preview. Both fields default to 0 when undefined.
    pill_dx?: number;
    pill_dy?: number;
  }>;
  show_outlines: boolean;
  label_position: 'top' | 'bottom' | 'center';
}

// Minimal payload to add a scanned card to the checklist. The full schema lives
// in api/checklist.ts; this is the subset the scanner sends.
export interface AddListingPayload {
  name: string;
  scryfall_id?: string | null;
  set_code?: string | null;
  set_name?: string | null;
  collector_number?: string | null;
  rarity?: string | null;
  is_foil: boolean;
  image_url?: string | null;
  ck_url?: string | null;
  unit_price_myr: string;  // Decimal as string
  qty_total: number;
  notes?: string | null;
  post_ids?: number[];
}

export async function addToChecklist(payload: AddListingPayload): Promise<{ id: number }> {
  const r = await fetch('/api/listings', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Add to checklist failed: ${r.status} ${t.slice(0, 200)}`);
  }
  return (await r.json()) as { id: number };
}

export async function exportImage(payload: ExportPayload): Promise<Blob> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  const r = await fetch('/api/export', { method: 'POST', body: fd, headers: authHeaders() });
  if (!r.ok) throw new Error(`Export failed: ${r.status}`);
  return await r.blob();
}
