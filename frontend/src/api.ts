// Typed wrappers over the FastAPI backend. Vite proxies /api/* to localhost:8000
// in dev (see vite.config.ts).

import { authHeaders } from './api/auth.ts';
import type { Candidate, DetectedCard, ScanResponse } from './types.ts';

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

// Phone photos are usually 12 MP (~4032×3024). Gemini bills per ~768px image
// tile, the backend's classical detector materialises several float32/int32
// arrays at full resolution (Sobel gx/gy, label image), and the upload itself
// is multi-MB on phone data — all three hurt. Cards stay easily detectable at
// 2000 px on the long edge. We resize before POST: saves Gemini tokens, cuts
// backend memory pressure on the 512 MB Fly VM, and shrinks the upload.
//
// HEIC: createImageBitmap works on Safari/iOS (the main pasar-malam path) and
// fails on Chrome/Firefox/Edge. On failure we silently pass the original
// through — the backend's pillow-heif still handles it.
const SCAN_MAX_EDGE = 2000;
const SCAN_JPEG_QUALITY = 0.92;

async function downscaleForScan(file: File): Promise<File> {
  // Tiny files (FB-pasted images, already-downscaled crops) skip the round-trip.
  if (file.size < 500 * 1024) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= SCAN_MAX_EDGE) {
    bitmap.close();
    return file;
  }

  const scale = SCAN_MAX_EDGE / longest;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', SCAN_JPEG_QUALITY);
  });
  if (!blob) return file;

  const base = file.name.replace(/\.[^.]+$/, '') || 'scan';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

export async function scanImage(file: File): Promise<ScanResponse> {
  const upload = await downscaleForScan(file);
  const fd = new FormData();
  fd.append('image', upload);
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

// Frame a missed card. User draws a rectangle in BatchPreview expand mode;
// the backend warps that quad, pHashes it, and returns either a fully-named
// card (CK-priced) or a manual stub the user will rename.
//
// `skipIdentify=true` is the "just add a blank row" path — bypasses pHash and
// returns an empty manual card the user fills in via the row's edit controls.
export async function frameCard(
  scanId: number,
  corners: [number, number][],
  skipIdentify = false,
): Promise<DetectedCard> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ corners, skip_identify: skipIdentify }));
  const r = await fetch(`/api/scans/${scanId}/frame-card`, {
    method: 'POST', body: fd, headers: authHeaders(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Frame card failed: ${r.status} ${t.slice(0, 200)}`);
  }
  return (await r.json()) as DetectedCard;
}

export async function exportImage(payload: ExportPayload): Promise<Blob> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  const r = await fetch('/api/export', { method: 'POST', body: fd, headers: authHeaders() });
  if (!r.ok) throw new Error(`Export failed: ${r.status}`);
  return await r.blob();
}
