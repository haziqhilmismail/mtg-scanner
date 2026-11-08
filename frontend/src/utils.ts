import type { CardRowData } from './lib/scanState.ts';
import type { Batch, Settings } from './types.ts';
import type { Credits } from './api/credits.ts';
import type { T } from './i18n/index.ts';
import type { Payment } from './api/payment.ts';
import { dateLocale } from './lib/browser.ts';
import { pillLabel } from './lib/money.ts';
import { isLive } from './lib/pricing.ts';

export const cardName = (cd: CardRowData, t: T) => cd.sel.name || t('unknown_card');

// What a card's label on the photo says ('' = no label), on screen and in the
// exported image alike. A live-price post prints only what CK won't decide:
// an RM price set on the card, or the card's own multiplier. There a foil
// card always says so with F, whatever the foil mark setting: with no price
// on the photo, nothing else tells a buyer it is the foil.
export function photoLabel(cd: CardRowData, settings: Settings): string {
  if (isLive(settings)) {
    if (cd.hasOverride && Number.isFinite(cd.unitPrice)) return pillLabel(cd, { ...settings, foilStyle: cd.isFoil ? 'suffix' : settings.foilStyle });
    const own = cd.hasMultOverride ? `CK ×${cd.mult}` : '';
    return !cd.isFoil ? own : own ? `${own} · F` : 'F';
  }
  if (cd.needsPrice || !Number.isFinite(cd.unitPrice)) return '';
  return pillLabel(cd, settings);
}

// Whether a card's label on the photo is the gold foil pill, on screen and in the exported image alike.
export const goldPill = (cd: { isFoil: boolean }, settings: Settings) => cd.isFoil && settings.foilStyle === 'gold';

// CK's working search URL — matches what their site emits when you submit the
// top search bar. `?search=header` is CK's "search context" param;
// `filter[name]=...` is the actual query. Brackets are pre-encoded so any
// intermediate proxy/normalization sees a stable URL.
export function ckSearchUrl(name: string): string {
  if (!name) return '';
  return `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(name)}`;
}

// A card's identity on its photo: listings record the bbox they came from.
export const bboxKey = (bbox: number[]) => bbox.join(',');

export function notAdded(batch: Batch, cards: CardRowData[]): CardRowData[] {
  return cards.filter(cd => !cd.removed && cd.unitPrice > 0 && !batch.listed.includes(bboxKey(cd.card.bbox)));
}

// A failed scan of a photo picked in this session can run again. Saved scans
// loaded from the server have no file.
export function canRetry(b: Batch): b is Batch & { file: File } {
  return b.status === 'error' && b.file != null;
}

// What a scanned card becomes on the checklist. One function for adding a
// card, adding a whole photo and saving claims, so they can't drift apart.
// With no direct CK product URL the listing gets a CK search-by-name link.
export function listingFields(cd: CardRowData) {
  const sel = cd.sel;
  const ck = (cd.isFoil ? (sel.ck_url_foil || sel.ck_url_normal) : (sel.ck_url_normal || sel.ck_url_foil))
    || ckSearchUrl(sel.name || '');
  return {
    name: sel.name || '(unknown)',
    scryfall_id: sel.scryfall_id || null,
    set_code: sel.set || null,
    set_name: sel.set_name || null,
    collector_number: sel.collector_number || null,
    rarity: sel.rarity || null,
    is_foil: cd.isFoil,
    image_url: sel.image_url || null,
    ck_url: ck || null,
    unit_price_myr: cd.unitPrice.toFixed(2),
    qty_total: cd.qty,
  };
}

// A photo still scanning (or failed before saving) has no scanId yet and counts as newest; `|| 0` ties two of them.
const newestFirst = (a: Batch, b: Batch) => (b.scanId ?? Infinity) - (a.scanId ?? Infinity) || 0;

// A post's photos in the order the seller gave them (their order on
// Facebook): placed ones first, then the rest oldest scan first, unsaved last.
const lastIfNull = (v: number | null) => v ?? Number.MAX_SAFE_INTEGER;
export const byPostOrder = (a: Batch, b: Batch) =>
  lastIfNull(a.position) - lastIfNull(b.position) || lastIfNull(a.scanId) - lastIfNull(b.scanId);

// "Photo N": each saved photo's number in its post, the same on every page.
export function photoNumbers(batches: Batch[]): Map<string, number> {
  const byPost = new Map<number | null, Batch[]>();
  for (const b of batches) if (b.scanId != null) byPost.set(b.postId, [...(byPost.get(b.postId) ?? []), b]);
  const out = new Map<string, number>();
  for (const list of byPost.values()) [...list].sort(byPostOrder).forEach((b, i) => out.set(b.id, i + 1));
  return out;
}

export const PHOTO_SORTS = {
  post: byPostOrder,
  newest: newestFirst,
  oldest: (a: Batch, b: Batch) => newestFirst(b, a),
  name: (a: Batch, b: Batch) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }) || newestFirst(a, b),
};
export type PhotoSort = keyof typeof PHOTO_SORTS;

export const sortPhotos = <T extends { batch: Batch }>(items: T[], sort: PhotoSort) =>
  [...items].sort((a, b) => PHOTO_SORTS[sort](a.batch, b.batch));

// For thumbnails (the printings grid, a card's match image) prefer the small
// variant — 146x204 JPEGs are ~12KB vs ~80KB for normal, which avoids stutter
// when a card has 50+ printings.
export function smallScryfallImage(url: string): string {
  if (!url) return url;
  return url.replace('/normal/', '/small/').replace('/large/', '/small/');
}

// The match images a photo's card rows show (CardRow), so they can be loaded ahead.
export const matchThumbs = (batch: Batch): string[] =>
  (batch.response?.cards ?? []).map(c => c.candidates[0]?.image_url).filter((u): u is string => !!u).map(smallScryfallImage);

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function generateBatchId(): string {
  return 'b' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// Short relative time ("just now", "5m ago", "2h ago", "3d ago").
export function formatRelativeTime(epochSeconds: number, t: T): string {
  const diffMs = Date.now() - epochSeconds * 1000;
  if (diffMs < 0) return t('relative_now');  // clock skew → "just now"
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('relative_now');
  if (diffMin < 60) return t('relative_min', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('relative_hr', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  return t('relative_day', { n: diffDay });
}

export function rarityKey(rarity: string | undefined | null): string {
  const r = (rarity || '').toLowerCase();
  if (r === 'common' || r === 'uncommon' || r === 'rare' || r === 'mythic') return r;
  if (r) return 'special';
  return '';
}

// When the oldest free scan comes back, as a short date ('' if none is due).
export function nextFreeDate(credits: Credits | null, lang: string): string {
  return credits?.next_free_at
    ? new Date(credits.next_free_at).toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'short' })
    : '';
}

// The seller's payment details as lines under a buyer's message
// (DESIGN.md section 8): "Payment: {bank} {number} ({name})", then the note.
// Empty parts are left out; nothing filled in gives no lines.
export function paymentLines(p: Payment | null, t: T): string[] {
  if (!p) return [];
  const holder = p.bank_account_holder.trim();
  const account = [p.bank_name.trim(), p.bank_account_number.trim(), holder && `(${holder})`].filter(Boolean).join(' ');
  return [account && t('pay_copy_account', { account }), p.payment_note.trim()].filter(Boolean);
}

// Whether saving claims should end with the tip-jar popup: from the third
// save on, at most once every 30 days, so a regular seller is asked about
// once a month and a first-time one not at all.
export const SUPPORT_ASK_AFTER_SAVES = 3;
export function dueForSupportAsk(saves: number, askedAt: number | null, now: number): boolean {
  return saves >= SUPPORT_ASK_AFTER_SAVES && (askedAt == null || now - askedAt >= 30 * 24 * 3600 * 1000);
}

// The balance line under Find Claims ('' when credits don't apply).
export function creditsLine(credits: Credits | null, t: T, lang: string): string {
  if (!credits?.enforced) return '';
  if (credits.unlimited) return t('credits_unlimited');
  let line = t('credits_free_left', { n: Math.max(0, credits.limit - credits.used), limit: credits.limit });
  if (credits.bonus > 0) line += ' ' + t('credits_plus_extra', { n: credits.bonus.toLocaleString() });
  const nextBack = nextFreeDate(credits, lang);
  if (credits.used > 0 && nextBack) line += ' · ' + t('credits_next_back', { date: nextBack });
  return line;
}

// Why there are no claim reads left and when the next one returns.
export function creditsOutText(credits: Credits, t: T, lang: string): string {
  const date = nextFreeDate(credits, lang);
  return date ? t('credits_out_body', { date, limit: credits.limit }) : t('credits_out_body_plain', { limit: credits.limit });
}

// How a comment screenshot got its photo: the seller picked it, the app saw
// the photo in it (sure, or a best guess between look-alike photos), or it
// follows the screenshot before (comments scrolled past the photo).
// 'none': no photo in it and none before, so it goes with every photo.
export type SortedBy = 'picked' | 'found' | 'guess' | 'follows' | 'none';

// Which photo each screenshot, in the order taken, is about. Each has the
// photo the app saw in it (`sure`) or its best guess (`guess`), either may be
// null; `before` is the photo of the screenshot already there ahead of them,
// and `unknown` is what a screenshot gets when nothing says which photo.
export function sortScreenshots<P>(seen: Array<{ sure: P | null; guess: P | null }>, before: P | null, unknown: P): Array<{ scanId: P; by: SortedBy }> {
  let last = before;
  return seen.map(({ sure, guess }) => {
    if (sure != null) { last = sure; return { scanId: sure, by: 'found' as const }; }
    if (guess != null) { last = guess; return { scanId: guess, by: 'guess' as const }; }
    return last != null ? { scanId: last, by: 'follows' as const } : { scanId: unknown, by: 'none' as const };
  });
}

// The letters that stand in for a missing avatar: the first letter of the
// first and last words, as a person writes them, one letter for one word.
// Segmenter keeps an emoji or an accented letter whole.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string) => ('Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(w)][0]?.segment
    : [...w][0]) ?? '';
  const picks = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picks.map(w => first(w).toLocaleUpperCase()).join('');
}
