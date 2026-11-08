// Priced photos rendered by the server: one PNG, or every photo in a zip.

import type { LabelPosition } from '../types.ts';
import { request } from './http.ts';

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
  // Cards sold on an earlier post: covered on a repost's photo.
  covers?: Array<{ bbox: [number, number, number, number]; corners?: [number, number][] }>;
  show_outlines: boolean;
  label_position: LabelPosition;
  // Multiplier on the auto-scaled base font size (default 1.0).
  font_scale?: number;
}

export async function exportImage(payload: ExportPayload): Promise<Blob> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  return (await request('/api/export', { method: 'POST', body: fd })).blob();
}

// One export payload plus the source filename, used to name its entry in the zip.
export interface ExportAllImage extends ExportPayload {
  filename: string;
}

// The backend skips any image whose source bytes it can't find, so a stale
// id won't fail the whole archive.
export async function exportAllImages(images: ExportAllImage[]): Promise<Blob> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ images }));
  return (await request('/api/export-all', { method: 'POST', body: fd })).blob();
}
