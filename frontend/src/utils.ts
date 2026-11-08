import type { Credits } from './api/credits.ts';
import type { T } from './i18n/index.ts';
import type { Payment } from './api/payment.ts';
import { dateLocale } from './lib/browser.ts';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
