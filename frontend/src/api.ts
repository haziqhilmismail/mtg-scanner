// Typed wrappers over the FastAPI backend. Vite proxies /api/* to localhost:8000
// in dev (see vite.config.ts).

import { authHeaders, authToken } from './api/auth.ts';
import type { Candidate, DetectedCard, ScanResponse } from './types.ts';

export interface Health {
  ok: boolean;
  model?: string;
  gemini_error?: string;
  cardkingdom_cards?: number;
  cardkingdom_error?: string;
  // Unix epoch seconds — file mtime of ck_index.db. Frontend formats
  // relative ("2h ago") so users can decide when to manually refresh.
  cardkingdom_refreshed_at?: number;
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

// <img src=…> can't send Authorization headers, so scan pictures carry the
// session JWT in the query string (same as post images).
function scanImageUrl(path: string, params: Record<string, string | number> = {}): string {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const t = authToken.get();
  if (t) q.set('token', t);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

// Loads all saved scans (most-recent first) for rehydration after a page refresh.
//
// Asks for the list without its embedded pictures (`lite=1`) and points each
// picture at its own URL instead. With 30 scans the embedded version is ~22 MB
// in one response, and nothing showed until all of it arrived; this way the
// list is ~0.3 MB and the browser fetches only the pictures on screen, then
// keeps them cached.
export async function fetchScans(limit = 30): Promise<SavedScan[]> {
  const r = await fetch(`/api/scans?limit=${limit}&lite=1`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`fetchScans failed: ${r.status}`);
  const scans = (await r.json()) as SavedScan[];
  return scans.map(s => {
    // A server that predates `lite` ignores it and still embeds the pictures.
    if (s.image_b64) return s;
    const base = `/api/scans/${s.scan_id}`;
    return {
      ...s,
      image_b64: scanImageUrl(`${base}/preview`),
      thumb_url: scanImageUrl(`${base}/preview`, { w: 160 }),
      cards: s.cards.map(c => ({ ...c, crop_b64: scanImageUrl(`${base}/crops/${c.id}`) })),
    };
  });
}

export async function deleteScan(id: number): Promise<void> {
  const r = await fetch(`/api/scans/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new Error(`deleteScan failed: ${r.status}`);
}

// Re-runs CK price enrichment for every candidate in a saved scan.
// Cheap (local SQLite lookups, no Gemini, no network to CK). Used by the
// per-scan "↻ Refresh prices" button to pick up freshly-pulled CK data
// without re-scanning the image.
export interface RelookupPricesResponse extends SavedScan {
  updated: number;
}
export async function relookupScanPrices(scanId: number): Promise<RelookupPricesResponse> {
  const r = await fetch(`/api/scans/${scanId}/relookup-prices`, {
    method: 'POST', headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`relookupScanPrices failed: ${r.status}`);
  return (await r.json()) as RelookupPricesResponse;
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

// Scan-credit balance, as returned by GET /api/credits and alongside each scan.
export interface Credits {
  enforced: boolean;          // false in solo mode: nothing is limited
  unlimited: boolean;
  limit: number;              // free scans per rolling 30 days
  used: number;               // free scans used in the current window
  bonus: number;              // extra scans from vouchers; don't expire
  remaining: number | null;   // free + extra left; null when unlimited
  next_free_at: string | null; // when the oldest free scan drops out of the window
}

export class OutOfCreditsError extends Error {
  credits: Credits | null;
  constructor(credits: Credits | null) {
    super('Out of scan credits');
    this.credits = credits;
  }
}

export async function fetchCredits(): Promise<Credits> {
  const r = await fetch('/api/credits', { headers: authHeaders() });
  if (!r.ok) throw new Error(`Credits failed: ${r.status}`);
  return (await r.json()) as Credits;
}

export interface RedeemResult {
  granted: { credits: number; unlimited: boolean; unlimited_days: number | null; reset?: boolean };
  credits: Credits;
}

// Rejects with an Error carrying `.code`: invalid | expired | used_up |
// already_redeemed | rate_limited.
export async function redeemVoucher(code: string): Promise<RedeemResult> {
  const r = await fetch('/api/vouchers/redeem', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ code }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const err = new Error(`Redeem failed: ${r.status}`) as Error & { code?: string };
    err.code = r.status === 429 ? 'rate_limited' : body?.detail?.code;
    throw err;
  }
  return (await r.json()) as RedeemResult;
}

export async function scanImage(file: File): Promise<ScanResponse> {
  const upload = await downscaleForScan(file);
  const fd = new FormData();
  fd.append('image', upload);
  const r = await fetch('/api/scan', { method: 'POST', body: fd, headers: authHeaders() });
  if (r.status === 402) {
    const body = await r.json().catch(() => null);
    throw new OutOfCreditsError(body?.detail?.credits ?? null);
  }
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
  // Multiplier on the auto-scaled base font size (default 1.0).
  font_scale?: number;
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

// One export payload plus the source filename, used to name its entry in the
// bulk-export zip.
export interface ExportAllImage extends ExportPayload {
  filename: string;
}

// Render every batch's priced overlay server-side and download them as a single
// zip. The backend skips any image whose source bytes it can't find, so a stale
// id won't fail the whole archive.
export async function exportAllImages(images: ExportAllImage[]): Promise<Blob> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ images }));
  const r = await fetch('/api/export-all', { method: 'POST', body: fd, headers: authHeaders() });
  if (!r.ok) throw new Error(`Export all failed: ${r.status}`);
  return await r.blob();
}
