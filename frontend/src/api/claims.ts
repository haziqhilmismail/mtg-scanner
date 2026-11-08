import type { Credits } from './credits.ts';
import { request } from './http.ts';

export interface ClaimPage {
  text: string;              // the thread as read from the screenshot
  scan_id: number | null;    // which photo the screenshot shows, when it is sure
  guess: number | null;      // its best guess when a look-alike photo scored nearly as well
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

// `skipped`: the comments read as no claim, as "Name: words".
export async function parseClaims(
  text: string, photos: CataloguePhoto[],
): Promise<{ claims: ClaimDraft[]; skipped: string[]; credits: Credits }> {
  return (await request('/api/claims/parse', { method: 'POST', json: { text, photos } })).json();
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
  await request('/api/claims/confirm', { method: 'POST', json: { post_id: postId, claims } });
}
