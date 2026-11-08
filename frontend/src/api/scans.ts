import type { ScanUiState } from '../lib/scanState.ts';
import type { Correction, DetectedCard } from '../types.ts';
import type { Credits } from './credits.ts';
import { imageUrl, request } from './http.ts';

// A photo and its cards, as the app shows them (Batch.response).
export interface ScanPicture {
  image_id: string;
  // What goes in <img src>: a data: URL straight after a scan, or a
  // /api/scans/{id}/preview URL for scans loaded from the server.
  image_b64: string;
  // Small version of the same picture for the scan strip, when there is one.
  thumb_url?: string;
  width: number;
  height: number;
  cards: DetectedCard[];
}

// A saved scan as the server lists it (scan_out in backend/app/services/scans.py).
export interface SavedScan extends ScanPicture {
  scan_id: number;
  // The post this photo is filed under; null = unfiled.
  post_id?: number | null;
  position?: number | null;
  filename: string;
  created_at: string | null;
  // Whatever was last saved; checked by normalizeUiState before use.
  ui_state: unknown;
  // The bbox of each of its cards that is on the checklist.
  listed?: number[][];
}

// What /api/scan answers: the scan just saved, and the balance after it.
export interface ScanResponse extends SavedScan {
  credits: Credits;
}

export const SCANS_PAGE = 500;

// One page of saved scans, newest first: the SCANS_PAGE newest with an id
// below `before` (or the newest overall). A page shorter than SCANS_PAGE is
// the last one. The server caps a page at 500 (routers/scans.py list_scans).
//
// Asks for the list without its embedded pictures (`lite=1`) and points each
// picture at its own URL instead. With 30 scans the embedded version is ~22 MB
// in one response, and nothing showed until all of it arrived; this way the
// list is ~0.3 MB and the browser fetches only the pictures on screen, then
// keeps them cached.
export async function fetchScans(before?: number): Promise<SavedScan[]> {
  const url = `/api/scans?lite=1&limit=${SCANS_PAGE}${before != null ? `&before=${before}` : ''}`;
  const scans = (await (await request(url)).json()) as SavedScan[];
  return scans.map(withPictureUrls);
}

export function withPictureUrls<S extends SavedScan>(s: S): S {
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
}

export async function saveScanState(id: number, state: ScanUiState, keepalive = false): Promise<void> {
  await request(`/api/scans/${id}/state`, { method: 'PATCH', keepalive, json: { state } });
}

// The seller's answer about a card's printing, kept as training data. Fire and forget.
export function recordCorrection({ scanId, cardId, scryfallId, kind }: Correction): void {
  request(`/api/scans/${scanId}/cards/${cardId}/correction`, {
    method: 'PUT', keepalive: true, json: { scryfall_id: scryfallId, kind },
  }).catch(() => {});
}

export async function deleteScan(id: number): Promise<void> {
  await request(`/api/scans/${id}`, { method: 'DELETE' });
}

// Today's Card Kingdom prices for every candidate in a saved scan, without
// scanning the picture again. `updated`: how many candidates changed.
export async function relookupScanPrices(scanId: number): Promise<SavedScan & { updated: number }> {
  return (await request(`/api/scans/${scanId}/relookup-prices`, { method: 'POST' })).json();
}

// Phone photos are usually 12 MP (~4032×3024). Gemini bills per ~768px image
// tile, the backend's classical detector materialises several float32/int32
// arrays at full resolution (Sobel gx/gy, label image), and the upload itself
// is multi-MB on phone data — all three hurt. Cards stay easily detectable at
// 2000 px on the long edge, so the photo is resized before the POST.
//
// HEIC: createImageBitmap works on Safari/iOS (the main pasar-malam path) and
// fails on Chrome/Firefox/Edge. On failure the original goes through as it
// is; the backend's pillow-heif still handles it.
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

// `postId` files the photo under that post; null leaves it unfiled.
export async function scanImage(file: File, postId: number | null = null): Promise<ScanResponse> {
  const upload = await downscaleForScan(file);
  const fd = new FormData();
  fd.append('image', upload);
  if (postId != null) fd.append('post_id', String(postId));
  return (await request('/api/scan', { method: 'POST', body: fd })).json();
}

// Save a post's photo order: the first is Photo 1.
export async function orderScans(scanIds: number[]): Promise<void> {
  await request('/api/scans/order', { method: 'PUT', json: { scan_ids: scanIds } });
}

// File scans under a post, or unfile them with postId = null.
export async function moveScans(scanIds: number[], postId: number | null): Promise<void> {
  await request('/api/scans/move', { method: 'POST', json: { scan_ids: scanIds, post_id: postId } });
}

// Frame a missed card: the server answers with a blank manual card at those corners.
export async function frameCard(scanId: number, corners: [number, number][]): Promise<DetectedCard> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ corners }));
  return (await request(`/api/scans/${scanId}/frame-card`, { method: 'POST', body: fd })).json();
}
