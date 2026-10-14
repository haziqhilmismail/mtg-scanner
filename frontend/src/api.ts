// Typed wrappers over the FastAPI backend. Vite proxies /api/* to localhost:8000
// in dev (see vite.config.ts).

import { imageUrl, request } from './api/auth.ts';
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
  return (await request('/api/health')).json();
}

export interface SavedScan extends ScanResponse {
  scan_id: number;
  // The post this photo is filed under; null = unfiled.
  post_id?: number | null;
  filename: string;
  created_at: string | null;
}

// One page of saved scans, newest first: the SCANS_PAGE newest with an id
// below `before` (or the newest overall). A page shorter than SCANS_PAGE is
// the last one.
//
// Asks for the list without its embedded pictures (`lite=1`) and points each
// picture at its own URL instead. With 30 scans the embedded version is ~22 MB
// in one response, and nothing showed until all of it arrived; this way the
// list is ~0.3 MB and the browser fetches only the pictures on screen, then
// keeps them cached.
export const SCANS_PAGE = 500;

export async function fetchScans(before?: number): Promise<SavedScan[]> {
  const url = `/api/scans?lite=1&limit=${SCANS_PAGE}${before != null ? `&before=${before}` : ''}`;
  const scans = (await (await request(url)).json()) as SavedScan[];
  return scans.map(s => {
    // A server that predates `lite` ignores it and still embeds the pictures.
    if (s.image_b64) return s;
    const base = `/api/scans/${s.scan_id}`;
    // v= keeps a reused scan id from showing a cached older picture.
    const v = s.created_at;
    return {
      ...s,
      image_b64: imageUrl(`${base}/preview`, { v }),
      thumb_url: imageUrl(`${base}/preview`, { w: 480, v }),
      cards: s.cards.map(c => ({ ...c, crop_b64: imageUrl(`${base}/crops/${c.id}`, { v }) })),
    };
  });
}

export async function deleteScan(id: number): Promise<void> {
  await request(`/api/scans/${id}`, { method: 'DELETE' });
}

// Re-runs CK price enrichment for every candidate in a saved scan.
// Cheap (local SQLite lookups, no Gemini, no network to CK). Used by the
// per-scan "↻ Refresh prices" button to pick up freshly-pulled CK data
// without re-scanning the image.
export interface RelookupPricesResponse extends SavedScan {
  updated: number;
}
export async function relookupScanPrices(scanId: number): Promise<RelookupPricesResponse> {
  return (await request(`/api/scans/${scanId}/relookup-prices`, { method: 'POST' })).json();
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

// File scans under a post, or unfile them with postId = null.
export async function moveScans(scanIds: number[], postId: number | null): Promise<void> {
  await request('/api/scans/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scan_ids: scanIds, post_id: postId }),
  });
}

export async function fetchCredits(): Promise<Credits> {
  return (await request('/api/credits')).json();
}

export interface RedeemResult {
  granted: { credits: number; unlimited: boolean; unlimited_days: number | null; reset?: boolean };
  credits: Credits;
}

// Rejects with an Error carrying `.code`: invalid | expired | used_up |
// already_redeemed | rate_limited.
export async function redeemVoucher(code: string): Promise<RedeemResult> {
  try {
    return await (await request('/api/vouchers/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })).json();
  } catch (e) {
    const err = e as Error & { status?: number; detail?: { code?: string }; code?: string };
    err.code = err.status === 429 ? 'rate_limited' : err.detail?.code;
    throw err;
  }
}

// `postId` files the photo under that post; null leaves it unfiled.
export async function scanImage(file: File, postId: number | null = null): Promise<ScanResponse> {
  const upload = await downscaleForScan(file);
  const fd = new FormData();
  fd.append('image', upload);
  if (postId != null) fd.append('post_id', String(postId));
  return (await request('/api/scan', { method: 'POST', body: fd })).json();
}

export async function relookup(name: string, set?: string): Promise<Candidate> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ name, set }));
  return (await request('/api/relookup', { method: 'POST', body: fd })).json();
}

export async function fetchPrintings(name: string): Promise<{ name: string; printings: Candidate[] }> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ name }));
  return (await request('/api/printings', { method: 'POST', body: fd })).json();
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
  return (await request(`/api/scans/${scanId}/frame-card`, { method: 'POST', body: fd })).json();
}

export async function exportImage(payload: ExportPayload): Promise<Blob> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  return (await request('/api/export', { method: 'POST', body: fd })).blob();
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
  return (await request('/api/export-all', { method: 'POST', body: fd })).blob();
}

// ---------- Claims: read a comment thread, draft who claimed what ----------

export interface ClaimPage {
  text: string;              // the thread as read from the screenshot
  scan_id: number | null;    // which photo the screenshot shows, when it could tell
}

// OCR screenshots of a comment thread. `scanIds` are the photos each
// screenshot might be showing; the server says which, when it can tell.
export async function readClaimScreenshots(files: File[], scanIds: number[]): Promise<ClaimPage[]> {
  const fd = new FormData();
  files.forEach(f => fd.append('images', f));
  fd.append('scan_ids', scanIds.join(','));
  const r = await request('/api/claims/read', { method: 'POST', body: fd });
  return ((await r.json()) as { pages: ClaimPage[] }).pages;
}

export interface CataloguePhoto {
  scan_id: number;
  label: string;
  cards: Array<{ card_id: number; name: string; set_code: string; price: string; foil: boolean; position: string }>;
}

export interface ClaimDraft {
  buyer: string;
  comment: string;
  unclear: string;
  items: Array<{ scan_id: number; card_id: number; qty: number; said: string; unclear: string }>;
}

export async function parseClaims(text: string, photos: CataloguePhoto[]): Promise<ClaimDraft[]> {
  const r = await request('/api/claims/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, photos }),
  });
  return ((await r.json()) as { claims: ClaimDraft[] }).claims;
}

export interface ConfirmClaim {
  buyer: string;
  note?: string | null;
  items: Array<{
    scan_id: number; card_id: number; bbox: number[]; name: string;
    scryfall_id?: string | null; set_code?: string | null; set_name?: string | null;
    collector_number?: string | null; rarity?: string | null; is_foil: boolean;
    image_url?: string | null; ck_url?: string | null;
    unit_price_myr: string; qty_total: number; qty: number;
  }>;
}

export async function confirmClaims(postId: number | null, claims: ConfirmClaim[]): Promise<void> {
  await request('/api/claims/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ post_id: postId, claims }),
  });
}
