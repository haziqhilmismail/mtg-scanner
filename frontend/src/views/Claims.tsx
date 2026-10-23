// Claims: who wants which card.
//
// Facebook gives no way to read a group's comments, so the seller brings the
// thread in as screenshots (or pasted text). The server works out which photo
// each screenshot shows and reads its comments; Gemini then matches comments
// to cards. Nothing is saved until the seller has checked the drafts, and
// anything the reader was unsure about is left for the seller to settle.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  confirmClaims, parseClaims, paymentApi, readClaimScreenshots, relookupScanPrices,
  type CataloguePhoto, type ConfirmClaim, type Payment,
} from '../api.ts';
import {
  buyersApi, listingsApi, ordersApi,
  type Buyer, type Listing, type Order, type Post,
} from '../api/checklist.ts';
import { OutOfCreditsError } from '../api/http.ts';
import {
  CardPicker, CardTile, photoThumb,
  type CardRef, type CardStatus, type Photo,
} from '../components/ClaimPickers.tsx';
import { useDialog } from '../components/DialogProvider.tsx';
import { Icon } from '../components/Icon.tsx';
import { DemoClaims } from '../components/demo/DemoClaims.tsx';
import { useImageZoom } from '../components/ImageZoomProvider.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { SlipsSheet } from '../components/SlipsSheet.tsx';
import { SupportSheet } from '../components/SupportSheet.tsx';
import { usePersistedState } from '../hooks/usePersistedState.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Batch, CardRowData, Credits } from '../types.ts';
import { byPostOrder, computeCardData, creditsLine, photoNumbers, creditsOutText, dueForSupportAsk, paymentLines, priceWorking, formatMyr, formatMyrWithFoil, listingFields, pastedImages, popupOpen, sortScreenshots, type SortedBy } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

interface Props {
  // The tab is showing (both tabs stay mounted, so switching doesn't reload).
  active: boolean;
  scanner: ScannerStore;
  pricing: PricingStore;
  t: T;
  lang: string;
  // The open post, shared with the Scans gallery so both pages open on it.
  folderKey: string | null;
  onFolderChange: (key: string) => void;
  // Claim-read balance; null until loaded. onCredits takes the new one after each read.
  credits: Credits | null;
  onCredits: (credits: Credits) => void;
  onEnterVoucher: () => void;
  // How buyers pay, added under every summary copied for a buyer.
  payment: Payment | null;
}

const UNFILED = 'unfiled';

// hint: the photo the comment is about, when known, so its cards come first.
interface DraftItem { key: string | null; qty: number; said: string; unclear: string; hint: number | null }
interface Draft { buyer: string; comment: string; unclear: string; items: DraftItem[] }
// scanId: the photo the comments are under ('all' = several photos, null =
// not sorted yet); by: how it got there, so a guess can be checked.
interface Page { name: string; text: string; src: string | null; scanId: number | 'all' | null; by: SortedBy }

type Stage = 'idle' | 'reading' | 'review' | 'parsing' | 'drafts' | 'saving';
type PayState = 'unpaid' | 'paid' | 'done';

const ORDINALS = ['1st', '2nd', '3rd'];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;

// Where each card sits, in words a comment might use ("top left", "the third
// one"). Cards are put into rows by their vertical centres, then ordered left
// to right; the running count goes row by row, the way people read.
function describePositions(cards: CardRowData[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!cards.length) return out;
  const boxes = cards.map(cd => {
    const [x, y, w, h] = cd.card.bbox;
    return { cd, cx: x + w / 2, cy: y + h / 2, h };
  }).sort((a, b) => a.cy - b.cy);
  const medianH = [...boxes].sort((a, b) => a.h - b.h)[Math.floor(boxes.length / 2)].h;
  const rows: Array<typeof boxes> = [];
  for (const b of boxes) {
    const row = rows[rows.length - 1];
    if (row && b.cy - row[0].cy < medianH * 0.5) row.push(b); else rows.push([b]);
  }
  let count = 0;
  rows.forEach(row => row.sort((a, b) => a.cx - b.cx));
  rows.forEach((row, r) => {
    row.forEach((b, c) => {
      count += 1;
      const vert = rows.length === 1 ? '' : r === 0 ? 'top' : r === rows.length - 1 ? 'bottom' : 'middle';
      const horiz = row.length === 1 ? '' : c === 0 ? 'left' : c === row.length - 1 ? 'right' : 'centre';
      const words = [vert, horiz].filter(Boolean).join(' ');
      out.set(b.cd.origIdx,
        `row ${r + 1} of ${rows.length}, ${ordinal(c + 1)} of ${row.length} from the left${words ? ` (${words})` : ''}, ${ordinal(count)} of ${boxes.length} overall`);
    });
  });
  return out;
}

function payState(orders: Order[]): PayState {
  if (orders.every(o => o.delivered_at)) return 'done';
  if (orders.every(o => o.paid_at || o.delivered_at)) return 'paid';
  return 'unpaid';
}

export function Claims({ active, scanner, pricing: { pricingFor, listPosts }, t, lang, folderKey, onFolderChange, credits, onCredits, onEnterVoucher, payment }: Props) {
  const dialog = useDialog();
  const zoom = useImageZoom();
  const [posts, setPosts] = useState<Post[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  // "How claims work" and "In This Post" are popups, opened from buttons.
  const [helpOpen, setHelpOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  useBackClose(helpOpen, () => setHelpOpen(false));
  useBackClose(postOpen, () => setPostOpen(false));

  const reload = useCallback(async () => {
    try {
      const [p, l, o, b] = await Promise.all([
        listPosts(), listingsApi.list(), ordersApi.list(true), buyersApi.list(),
      ]);
      setPosts(p); setListings(l); setOrders(o); setBuyers(b); setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    }
    setLoaded(true);
  }, [listPosts]);
  // Loaded once, then refreshed quietly each time the tab is shown again, so
  // stock or orders changed on the Scanner tab are current.
  useEffect(() => { if (active) reload(); }, [active, reload]);

  // ---------- which post ----------
  // Archived posts are left out altogether (null), not dropped into Unfiled.
  const postsById = useMemo(() => new Map(posts.map(p => [p.id, p])), [posts]);
  const keyOfBatch = useCallback((b: Batch) => {
    const post = b.postId != null ? postsById.get(b.postId) : undefined;
    if (!post) return UNFILED;
    return post.status === 'archived' ? null : `p${post.id}`;
  }, [postsById]);
  const postOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of scanner.batches) {
      if (b.scanId == null || !b.response) continue;
      const key = keyOfBatch(b);
      if (key && !seen.has(key)) {
        seen.set(key, key === UNFILED ? t('scans_unfiled') : (postsById.get(b.postId!)?.title || `#${b.postId}`));
      }
    }
    return [...seen.entries()].map(([key, title]) => ({ key, title })).reverse();
  }, [scanner.batches, keyOfBatch, postsById, t]);
  // An intake in progress stays on the post it started on, even if the
  // remembered post changes or a scan finishing elsewhere reorders the list.
  const [intakeKey, setIntakeKey] = useState<string | null>(null);
  const activeKey = intakeKey
    ?? (postOptions.some(o => o.key === folderKey) ? folderKey : (postOptions[0]?.key ?? null));
  const postId = activeKey && activeKey !== UNFILED ? Number(activeKey.slice(1)) : null;
  // Every photo here is the open post's (or unfiled), so one pricing prices them all.
  const settings = pricingFor(postId);

  // ---------- what can be claimed ----------
  const photos = useMemo<Photo[]>(() => {
    if (!activeKey) return [];
    // In post order, numbered as on every page (photoNumbers).
    const numbers = photoNumbers(scanner.batches);
    return scanner.batches
      .filter(b => b.scanId != null && b.response && keyOfBatch(b) === activeKey)
      .sort(byPostOrder)
      .map((batch, at) => {
        const i = (numbers.get(batch.id) ?? at + 1) - 1;
        const visible = computeCardData(batch, settings).filter(cd => !cd.removed);
        const where = describePositions(visible);
        return {
          batch, index: i + 1,
          cards: visible.map(cd => ({
            key: `${batch.scanId}:${cd.card.id}`,
            scanId: batch.scanId as number,
            photo: i + 1,
            filename: batch.filename,
            cd,
            position: where.get(cd.origIdx) ?? '',
          })),
        };
      });
  }, [scanner.batches, activeKey, keyOfBatch, settings]);
  const cardsByKey = useMemo(() => new Map(photos.flatMap(p => p.cards).map(c => [c.key, c])), [photos]);
  const photoLabel = useCallback(
    (p: Photo) => t('claims_photo_label', { n: p.index, name: p.batch.filename }),
    [t],
  );
  const priceOf = useCallback(
    (c: CardRef) => (Number.isFinite(c.cd.unitPrice) ? formatMyrWithFoil(c.cd.unitPrice, c.cd.isFoil, settings) : ''),
    [settings],
  );

  const catalogue = useCallback((subset: Photo[]): CataloguePhoto[] => subset.map(p => ({
    scan_id: p.batch.scanId as number,
    label: photoLabel(p),
    cards: p.cards.map(c => ({
      card_id: c.cd.card.id,
      name: c.cd.sel.name || '',
      set_code: c.cd.sel.set || '',
      price: Number.isFinite(c.cd.unitPrice) ? formatMyrWithFoil(c.cd.unitPrice, c.cd.isFoil, settings) : '',
      foil: c.cd.isFoil,
      position: c.position,
    })),
  })), [photoLabel, settings]);

  // ---------- existing claims for this post ----------
  const scanIds = useMemo(() => new Set(photos.map(p => p.batch.scanId as number)), [photos]);
  const listingsById = useMemo(() => new Map(listings.map(l => [l.id, l])), [listings]);
  // Which scanned card a stock listing stands for (same scan, same box).
  const cardOfListing = useCallback((l: Listing | undefined): CardRef | undefined => {
    if (!l || l.scan_id == null || !l.bbox) return undefined;
    const box = l.bbox.join(',');
    return photos.find(p => p.batch.scanId === l.scan_id)?.cards
      .find(c => c.cd.card.bbox.join(',') === box);
  }, [photos]);
  const inThisPost = useCallback((l: Listing | undefined) =>
    !!l && ((l.scan_id != null && scanIds.has(l.scan_id)) || (postId != null && l.post_ids.includes(postId))),
  [scanIds, postId]);

  const groups = useMemo(() => {
    const byBuyer = new Map<number, Order[]>();
    for (const o of orders) {
      if (o.status === 'cancelled' || o.archived_at) continue;
      if (!o.items.some(i => inThisPost(listingsById.get(i.listing_id)))) continue;
      byBuyer.set(o.buyer_id, [...(byBuyer.get(o.buyer_id) ?? []), o]);
    }
    return [...byBuyer.entries()].map(([buyerId, os]) => {
      const items = os.flatMap(o => o.items).filter(i => inThisPost(listingsById.get(i.listing_id)));
      return {
        buyerId,
        name: buyers.find(b => b.id === buyerId)?.fb_name ?? `#${buyerId}`,
        orders: os,
        items,
        total: items.reduce((sum, i) => sum + Number(i.line_total_myr), 0),
        state: payState(os),
        first: Math.min(...os.map(o => o.id)),
      };
    }).sort((a, b) => a.first - b.first);
  }, [orders, buyers, listingsById, inThisPost]);

  // The claimed list as the seller wants to read it: in claim order, by name,
  // or by photo (each buyer's lowest photo number, then name) to pack by photo.
  const [claimSort, setClaimSort] = usePersistedState<'claimed' | 'name' | 'photo'>('mtg.claims.sort', 'claimed');
  const shownGroups = useMemo(() => {
    const byName = (a: (typeof groups)[number], b: (typeof groups)[number]) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (claimSort === 'name') return [...groups].sort(byName);
    if (claimSort !== 'photo') return groups;
    const lowest = (g: (typeof groups)[number]) => Math.min(...g.items.map(i => cardOfListing(listingsById.get(i.listing_id))?.photo ?? Infinity));
    return [...groups].sort((a, b) => lowest(a) - lowest(b) || byName(a, b));
  }, [groups, claimSort, cardOfListing, listingsById]);

  // How many of each card are already spoken for, and by whom.
  const claimedBy = useMemo(() => {
    const out = new Map<string, { qty: number; names: string[] }>();
    for (const g of groups) {
      for (const i of g.items) {
        const card = cardOfListing(listingsById.get(i.listing_id));
        if (!card) continue;
        const cur = out.get(card.key) ?? { qty: 0, names: [] };
        cur.qty += i.qty;
        if (!cur.names.includes(g.name)) cur.names.push(g.name);
        out.set(card.key, cur);
      }
    }
    return out;
  }, [groups, cardOfListing, listingsById]);

  const totals = useMemo(() => ({
    all: groups.reduce((s, g) => s + g.total, 0),
    paid: groups.filter(g => g.state !== 'unpaid').reduce((s, g) => s + g.total, 0),
  }), [groups]);

  // ---------- bringing a thread in ----------
  const [stage, setStage] = useState<Stage>('idle');
  const [pages, setPages] = useState<Page[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [picking, setPicking] = useState<string | null>(null);  // `${draft}:${item}` whose card is being changed
  const [readingMore, setReadingMore] = useState(false);
  const [slipsOpen, setSlipsOpen] = useState(false);

  // Screenshots are shown from object URLs; let them go with the pages.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const clearIntake = useCallback(() => {
    pagesRef.current.forEach(pg => pg.src && URL.revokeObjectURL(pg.src));
    setPages([]); setDrafts([]); setPicking(null); setStage('idle'); setIntakeKey(null);
  }, []);
  useEffect(() => () => pagesRef.current.forEach(pg => pg.src && URL.revokeObjectURL(pg.src)), []);

  const onlyPhoto = photos.length === 1 ? (photos[0].batch.scanId as number) : null;

  const readFiles = useCallback(async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!images.length || !photos.length) return;
    // More screenshots while checking: the ones there stay on screen.
    const more = stage === 'review';
    if (more) setReadingMore(true); else setStage('reading');
    setError(''); setIntakeKey(activeKey);
    try {
      // The server looks for the photo in each screenshot: to sort it, and to
      // know which part holds the comments.
      const all = photos.map(p => p.batch.scanId as number);
      const read = await readClaimScreenshots(images, all);
      const ours = (id: number | null) => (id != null && all.includes(id) ? id : null);
      const seen = read.map(pg => ({ sure: ours(pg.scan_id), guess: ours(pg.guess) }));
      const before = stage === 'review' ? pages[pages.length - 1]?.scanId ?? null : null;
      // A one-photo post has nothing to sort.
      const sorted = onlyPhoto != null
        ? read.map(() => ({ scanId: onlyPhoto, by: 'picked' as const }))
        : sortScreenshots<number | 'all'>(seen, before);
      const next: Page[] = read.map((pg, i) => ({
        name: images[i].name || `screenshot ${i + 1}`, text: pg.text,
        src: URL.createObjectURL(images[i]), ...sorted[i],
      }));
      setPages(prev => (more ? [...prev, ...next] : next));
      setStage('review');
    } catch (e) {
      setError((e as Error).message);
      if (pages.length) setStage('review');
      else clearIntake();
    } finally {
      setReadingMore(false);
    }
  }, [photos, stage, pages, onlyPhoto, activeKey, clearIntake]);

  // Ctrl/⌘+V of a screenshot anywhere on the page (PC: Win+Shift+S, then paste).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!active || popupOpen() || (stage !== 'idle' && stage !== 'review')) return;
      const files = pastedImages(e);
      if (!files.length) return;
      e.preventDefault();
      readFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [active, stage, readFiles]);

  const findClaims = useCallback(async () => {
    const filled = pages.filter(pg => pg.text.trim()) as Array<Page & { scanId: number | 'all' }>;
    if (!filled.length || filled.some(pg => pg.scanId == null)) return;
    setStage('parsing'); setError('');
    try {
      // Screenshots of the same photo are read as one thread, in order, so
      // "top left" means that photo. Pages about several photos are read
      // against the whole post, and anything ambiguous comes back as a question.
      const order: Array<number | 'all'> = [];
      const text = new Map<number | 'all', string[]>();
      for (const pg of filled) {
        if (!text.has(pg.scanId)) { text.set(pg.scanId, []); order.push(pg.scanId); }
        text.get(pg.scanId)!.push(pg.text.trim());
      }
      const found: Draft[] = [];
      for (const scanId of order) {
        const subset = typeof scanId === 'number' ? photos.filter(p => p.batch.scanId === scanId) : photos;
        const { claims: got, credits: left } = await parseClaims(text.get(scanId)!.join('\n\n'), catalogue(subset.length ? subset : photos));
        for (const d of got) {
          found.push({
            buyer: d.buyer, comment: d.comment, unclear: d.unclear,
            items: d.items.map(i => {
              const key = `${i.scan_id}:${i.card_id}`;
              const hint = scanIds.has(i.scan_id) ? i.scan_id : (typeof scanId === 'number' ? scanId : null);
              return { key: cardsByKey.has(key) ? key : null, qty: Math.max(1, i.qty), said: i.said, unclear: i.unclear, hint };
            }),
          });
        }
        onCredits(left);
      }
      setDrafts(found);
      setStage('drafts');
    } catch (e) {
      // Each Gemini call to work out claims costs a credit.
      if (e instanceof OutOfCreditsError && e.credits) onCredits(e.credits);
      setError(e instanceof OutOfCreditsError
        ? t('credits_out_title') + (e.credits ? `. ${creditsOutText(e.credits, t, lang)}` : '')
        : (e as Error).message);
      setStage('review');
    }
  }, [pages, photos, catalogue, cardsByKey, scanIds, t, lang, onCredits]);

  // Cards claimed more times than there are copies, counting earlier claims
  // first: existing ones, then drafts top to bottom (first comment wins).
  const overClaimed = useMemo(() => {
    const used = new Map<string, number>();
    claimedBy.forEach((v, k) => used.set(k, v.qty));
    const out = new Set<string>();
    drafts.forEach((d, di) => d.items.forEach((it, ii) => {
      if (!it.key) return;
      const have = cardsByKey.get(it.key)?.cd.qty ?? 1;
      const after = (used.get(it.key) ?? 0) + it.qty;
      if (after > have) out.add(`${di}:${ii}`);
      used.set(it.key, after);
    }));
    return out;
  }, [drafts, claimedBy, cardsByKey]);

  const patchDraft = (di: number, patch: Partial<Draft>) =>
    setDrafts(prev => prev.map((d, i) => (i === di ? { ...d, ...patch } : d)));
  const patchItem = (di: number, ii: number, patch: Partial<DraftItem>) =>
    setDrafts(prev => prev.map((d, i) => (i !== di ? d : {
      ...d, items: d.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)),
    })));
  const removeItem = (di: number, ii: number) => {
    setPicking(null);
    setDrafts(prev => prev.map((d, i) => (i !== di ? d : { ...d, items: d.items.filter((_, j) => j !== ii) })));
  };

  // What the inventory and the pickers say about each card: who has it
  // already, and who the drafts on screen would give it to.
  const draftedBy = useMemo(() => {
    const out = new Map<string, string[]>();
    if (stage !== 'drafts' && stage !== 'saving') return out;
    for (const d of drafts) {
      for (const it of d.items) {
        if (!it.key) continue;
        const names = out.get(it.key) ?? [];
        const name = d.buyer.trim() || '?';
        if (!names.includes(name)) names.push(name);
        out.set(it.key, names);
      }
    }
    return out;
  }, [drafts, stage]);
  const statusOf = useCallback((c: CardRef): CardStatus => {
    const taken = claimedBy.get(c.key);
    const fresh = draftedBy.get(c.key);
    if (!taken && !fresh) return { text: t('claims_inv_free'), kind: 'free' };
    const left = c.cd.qty - (taken?.qty ?? 0);
    const parts: string[] = [];
    if (taken) parts.push(taken.names.join(', '));
    if (taken && left > 0 && c.cd.qty > 1) parts.push(t('claims_inv_left', { n: left, total: c.cd.qty }));
    if (fresh) parts.push(t('claims_inv_new', { names: fresh.join(', ') }));
    return { text: parts.join(' · '), kind: taken && left <= 0 ? 'taken' : 'part' };
  }, [claimedBy, draftedBy, t]);

  const ready = drafts.filter(d => d.items.length > 0);
  const unresolved = ready.some(d => !d.buyer.trim() || d.items.some(it => !it.key));
  const unpriced = ready.some(d => d.items.some(it => it.key && !Number.isFinite(cardsByKey.get(it.key)?.cd.unitPrice)));

  // The tip-jar popup after a save; see dueForSupportAsk for how often.
  const [supportAsk, setSupportAsk] = usePersistedState<{ saves: number; askedAt: number | null }>(
    'mtg.claims.supportAsk', { saves: 0, askedAt: null });
  const [supportOpen, setSupportOpen] = useState(false);

  const save = useCallback(async () => {
    setStage('saving'); setError('');
    const payload: ConfirmClaim[] = ready.map(d => ({
      buyer: d.buyer.trim(),
      note: d.comment || null,
      items: d.items.map(it => {
        const c = cardsByKey.get(it.key!)!;
        return { ...listingFields(c.cd), scan_id: c.scanId, card_id: c.cd.card.id, bbox: c.cd.card.bbox, qty: it.qty };
      }),
    }));
    try {
      await confirmClaims(postId, payload);
      await reload();
      clearIntake();
      const saves = supportAsk.saves + 1, now = Date.now();
      const ask = dueForSupportAsk(saves, supportAsk.askedAt, now);
      setSupportAsk({ saves, askedAt: ask ? now : supportAsk.askedAt });
      if (ask) setSupportOpen(true);
    } catch (e) {
      setError((e as Error).message);
      setStage('drafts');
    }
  }, [ready, cardsByKey, postId, reload, clearIntake, supportAsk, setSupportAsk]);

  // ---------- acting on saved claims ----------
  // Status buttons wait for a change to finish, so a second click can't
  // interleave its requests with the first.
  const [stateSaving, setStateSaving] = useState(false);
  const setState = useCallback(async (os: Order[], to: PayState) => {
    setStateSaving(true);
    try {
      for (const o of os) {
        if (to === 'unpaid') {
          if (o.paid_at || o.delivered_at) await ordersApi.update(o.id, { paid_at: null, delivered_at: null });
        } else {
          if (!o.paid_at) await ordersApi.markPaid(o.id);
          if (to === 'done' && !o.delivered_at) await ordersApi.markDelivered(o.id);
          if (to === 'paid' && o.delivered_at) await ordersApi.update(o.id, { delivered_at: null });
        }
      }
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    } finally {
      await reload();
      setStateSaving(false);
    }
  }, [dialog, reload, t]);

  const removeClaim = useCallback(async (name: string, os: Order[]) => {
    const ok = await dialog.confirm({
      title: t('claims_remove_title'),
      message: t('claims_remove_msg', { name }),
      okLabel: t('claims_remove_ok'),
      destructive: true,
    });
    if (!ok) return;
    setStateSaving(true);
    try {
      for (const o of os) await ordersApi.cancel(o.id).catch(() => { /* reload shows what's left */ });
      await reload();
    } finally {
      setStateSaving(false);
    }
  }, [dialog, reload, t]);

  const itemLine = useCallback((i: Order['items'][number]) => {
    const card = cardOfListing(listingsById.get(i.listing_id));
    const where = card && photos.length > 1 ? `${t('claims_photo_short', { n: card.photo })} · ` : '';
    return `${where}${i.name_snapshot}${i.qty > 1 ? ` ×${i.qty}` : ''}`;
  }, [cardOfListing, listingsById, photos.length, t]);

  // How an item's price was worked out ("$3.60 × 2.5 → RM9"), when that still
  // gives what the buyer is charged; shown in the list and in copied summaries.
  // Live-price post: an item of a buyer not sent prices yet costs its card's
  // price now (CK as last refreshed, the post's rate, any RM set on the card);
  // once sent, it keeps what the buyer was told. Otherwise the saved price.
  const live = settings.priceMode === 'live';
  const shortDate = (d: Date) => d.toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short' });
  const sentAt = useMemo(() => new Map(orders.map(o => [o.id, o.prices_sent_at])), [orders]);
  const unitNow = useCallback((i: Order['items'][number]) => {
    if (!live || sentAt.get(i.order_id)) return Number(i.unit_price_myr);
    const now = cardOfListing(listingsById.get(i.listing_id))?.cd.unitPrice;
    return now != null && isFinite(now) && now > 0 ? now : Number(i.unit_price_myr);
  }, [live, sentAt, cardOfListing, listingsById]);
  const totalNow = useCallback((g: (typeof groups)[number]) => g.items.reduce((sum, i) => sum + unitNow(i) * i.qty, 0), [unitNow]);

  const workingOf = useCallback((i: Order['items'][number]) => {
    const card = cardOfListing(listingsById.get(i.listing_id));
    return card ? priceWorking(card.cd, unitNow(i), settings) : null;
  }, [cardOfListing, listingsById, settings, unitNow]);

  // What a buyer is sent: each card with the working of its price (when it
  // still gives what they are charged), then the total on its own line in
  // *bold* (Messenger and WhatsApp show it bold), then how to pay. No photo
  // numbers: those mean nothing to the buyer.
  const summaryText = useCallback((g: (typeof groups)[number]) => {
    const lines = g.items.map(i => {
      const name = `${i.name_snapshot}${i.qty > 1 ? ` ×${i.qty}` : ''}`;
      const total = formatMyr(unitNow(i) * i.qty, settings);
      const working = workingOf(i);
      if (!working) return `${name} — ${total}`;
      return i.qty > 1 ? `${name} — ${working} ${t('claims_copy_each')} = ${total}` : `${name} — ${working}`;
    });
    const pay = paymentLines(payment, t);
    // Live prices say which day's CK they are: today's, or the day already sent.
    const sent = g.orders.map(o => o.prices_sent_at).find(Boolean);
    const day = live ? [t('live_priced_on', { date: shortDate(sent ? new Date(sent) : new Date()) })] : [];
    return [g.name, ...lines, '', `*${t('total')}: ${formatMyr(totalNow(g), settings)}*`, ...day, ...(pay.length ? ['', ...pay] : [])].join('\n');
  }, [workingOf, unitNow, totalNow, live, settings, t, payment]);

  // Copied or shared to the buyer: a live post's prices are now sent and stay.
  const markSent = useCallback(async (g: (typeof groups)[number]) => {
    if (!live) return;
    for (const o of g.orders) {
      if (o.prices_sent_at) continue;
      const items = o.items.filter(i => inThisPost(listingsById.get(i.listing_id))).map(i => ({ id: i.id, unit_price_myr: unitNow(i).toFixed(2) }));
      try {
        const saved = await ordersApi.setPrices(o.id, items, true);
        setOrders(prev => prev.map(x => (x.id === saved.id ? saved : x)));
      } catch { /* stays an estimate: copying again sends it */ }
    }
  }, [live, inThisPost, listingsById, unitNow]);
  const resend = useCallback(async (g: (typeof groups)[number]) => {
    for (const o of g.orders) {
      if (!o.prices_sent_at) continue;
      const saved = await ordersApi.unsendPrices(o.id);
      setOrders(prev => prev.map(x => (x.id === saved.id ? saved : x)));
    }
  }, []);

  // Live post: today's CK prices for its photos, put on every buyer not sent theirs yet.
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const refreshLivePrices = useCallback(async () => {
    setRefreshingPrices(true);
    try {
      const fresh = new Map<number, CardRowData[]>();
      for (const p of photos) {
        const res = await relookupScanPrices(p.batch.scanId as number);
        scanner.replaceAllCards(p.batch.id, res.cards);
        fresh.set(p.batch.scanId as number, computeCardData({ ...p.batch, response: { ...p.batch.response!, cards: res.cards } }, settings));
      }
      for (const g of groups) {
        for (const o of g.orders) {
          if (o.prices_sent_at) continue;
          const items = o.items.flatMap(i => {
            const l = listingsById.get(i.listing_id);
            const cd = l?.scan_id != null && l.bbox ? fresh.get(l.scan_id)?.find(c => c.card.bbox.join(',') === l.bbox!.join(',')) : undefined;
            return cd && isFinite(cd.unitPrice) && cd.unitPrice > 0 ? [{ id: i.id, unit_price_myr: cd.unitPrice.toFixed(2) }] : [];
          });
          if (!items.length) continue;
          const saved = await ordersApi.setPrices(o.id, items);
          setOrders(prev => prev.map(x => (x.id === saved.id ? saved : x)));
        }
      }
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    } finally {
      setRefreshingPrices(false);
    }
  }, [photos, scanner, settings, groups, listingsById, dialog, t]);

  // The QR, fetched ahead: a phone only lets a tap copy or share at once,
  // not after waiting on a download.
  const [qrFile, setQrFile] = useState<File | null>(null);
  useEffect(() => {
    setQrFile(null);
    if (!payment?.qr_version) return;
    let live = true;
    fetch(paymentApi.qrUrl(payment.qr_version))
      .then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => { if (live) setQrFile(new File([b], 'duitnow-qr.png', { type: 'image/png' })); }, () => { /* no QR buttons */ });
    return () => { live = false; };
  }, [payment?.qr_version]);
  // Phones get a Share button (the QR with the summary as its caption);
  // elsewhere the QR is a second copy.
  const canShareQr = !!qrFile && matchMedia('(pointer: coarse)').matches && !!navigator.canShare?.({ files: [qrFile], text: 'x' });
  const canCopyQr = !!qrFile && typeof ClipboardItem !== 'undefined';

  const [copied, setCopied] = useState<string | null>(null);
  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
  };
  const copySummary = useCallback(async (g: (typeof groups)[number]) => {
    try { await navigator.clipboard.writeText(summaryText(g)); flash(`${g.buyerId}:text`); } catch { return; /* clipboard blocked */ }
    await markSent(g);
  }, [summaryText, markSent]);
  const copyQr = useCallback(async (g: (typeof groups)[number]) => {
    if (!qrFile) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': qrFile })]); flash(`${g.buyerId}:qr`); } catch { /* clipboard blocked */ }
  }, [qrFile]);
  const shareWithQr = useCallback(async (g: (typeof groups)[number]) => {
    if (!qrFile) return;
    try { await navigator.share({ text: summaryText(g), files: [qrFile] }); } catch { return; /* cancelled */ }
    await markSent(g);
  }, [qrFile, summaryText, markSent]);

  // ---------- render ----------
  if (!loaded || (scanner.loadingSaved && scanner.batches.length === 0)) {
    return <Spinner label={t('ck_loading')} />;
  }

  const popup = (open: boolean, close: () => void, title: string, body: ReactNode) => (open ? createPortal(
    <div className="feedback-overlay" onClick={close}>
      <div className="feedback-modal claims-popup" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="feedback-head">
          <h2>{title}</h2>
          <button type="button" className="feedback-close" onClick={close} aria-label={t('voucher_close')}>×</button>
        </div>
        {body}
        <div className="feedback-foot">
          <button type="button" className="accent" onClick={close}>{t('voucher_done')}</button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null);

  const help = popup(helpOpen, () => setHelpOpen(false), t('claims_help_title'), (
    <div className="claims-help">
      <p className="claims-help-text">{t('claims_help_text')}</p>
      <DemoClaims t={t} />
    </div>
  ));
  const helpButton = (
    <button type="button" className="ghost" onClick={() => setHelpOpen(true)}>
      <Icon name="feedback" size={18} />{t('claims_help_title')}
    </button>
  );

  if (!postOptions.length) {
    return (
      <>
        <div className="review-head"><div className="review-title"><h2>{t('nav_claims')}</h2></div>{helpButton}</div>
        {help}
        <p className="gallery-empty">{t('claims_no_posts')}</p>
      </>
    );
  }

  const busy = stage === 'reading' || stage === 'parsing' || stage === 'saving' || readingMore;

  const balance = creditsLine(credits, t, lang);
  // Every photo of the post with its cards: what claims can point at. Only a
  // reference, nothing to pick here.
  const postRef = popup(postOpen, () => setPostOpen(false), t('claims_inventory_title'), (
    <div className="post-ref">
      {photos.map(p => (
        <section className="post-ref-photo" key={p.batch.id}>
          <h3>{t('claims_photo_short', { n: p.index })} <span className="meta">· {t('claims_inv_count', { n: p.cards.length })}</span></h3>
          <img src={photoThumb(p)} alt="" loading="lazy" decoding="async" />
          <div className="card-grid">
            {p.cards.map(c => <CardTile key={c.key} card={c} price={priceOf(c)} status={statusOf(c)} />)}
          </div>
        </section>
      ))}
      <p className="claims-hint inv-foot">{t('claims_inv_removed_hint')}</p>
    </div>
  ));
  const postButton = (
    <button type="button" className="ghost" onClick={() => setPostOpen(true)}>
      <Icon name="photo" size={18} />{t('claims_inventory_title')}
    </button>
  );

  const phoneOf = (buyerId: number) => buyers.find(b => b.id === buyerId)?.phone ?? '';
  const editPhone = async (buyerId: number, name: string) => {
    const value = await dialog.prompt({
      title: t('claims_phone_title', { name }), defaultValue: phoneOf(buyerId), placeholder: '012-345 6789', okLabel: t('pay_save'),
    });
    if (value == null) return;
    try {
      const saved = await buyersApi.update(buyerId, { phone: value.trim() || null });
      setBuyers(prev => prev.map(b => (b.id === buyerId ? saved : b)));
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  };

  // Where screenshots come in: drop, paste (Ctrl/⌘+V works anywhere on the
  // page) or tap to pick. Full size to start; smaller under the screenshots
  // being checked, so more can be added without leaving them.
  const dropArea = (compact: boolean) => (
    <>
      <div
        className={`drop ${compact ? 'drop-compact' : ''}`}
        role="button" tabIndex={0}
        onClick={() => !busy && fileRef.current?.click()}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (!busy) readFiles(Array.from(e.dataTransfer.files)); }}
      >
        <Icon name={compact ? 'plus' : 'feedback'} size={compact ? 22 : 34} className="drop-icon" />
        <strong>{stage === 'reading' || readingMore ? t('claims_reading') : t(compact ? 'claims_drop_more' : 'claims_drop_strong')}</strong>
        {compact ? null : <p>{t('claims_drop_sub')}</p>}
      </div>
    </>
  );

  // The screenshots under each photo, for the seller to check: not-sorted
  // ones first, then by photo, then "several photos".
  const sortGroups = (() => {
    const keys: Array<number | 'all' | null> = [];
    if (pages.some(pg => pg.scanId == null)) keys.push(null);
    photos.forEach(p => { if (pages.some(pg => pg.scanId === p.batch.scanId)) keys.push(p.batch.scanId as number); });
    if (pages.some(pg => pg.scanId === 'all')) keys.push('all');
    return keys.map(key => {
      const photo = typeof key === 'number' ? photos.find(p => p.batch.scanId === key) : undefined;
      return {
        key, photo,
        label: key == null ? t('claims_group_unsorted') : key === 'all' ? t('claims_several_photos') : t('claims_photo_short', { n: photo?.index ?? '' }),
        pages: pages.map((pg, pi) => ({ pg, pi })).filter(({ pg }) => pg.scanId === key),
      };
    });
  })();
  const unsorted = pages.filter(pg => pg.scanId == null && pg.text.trim()).length;

  return (
    <>
      <div className="review-head">
        {/* The post's name in full as the heading: a <select> can only ever
            show as much of a long name as fits on one line. */}
        <div className="review-title">
          <h2>{postOptions.find(o => o.key === activeKey)?.title ?? t('nav_claims')}</h2>
        </div>
        {postOptions.length > 1 ? (
          <label className="claims-post">
            <span>{t('claims_switch_post')}</span>
            {/* Switching post abandons a half-finished intake rather than mixing posts. */}
            <select value={activeKey ?? ''} disabled={busy} onChange={e => { clearIntake(); setError(''); onFolderChange(e.target.value); }}>
              {postOptions.map(o => <option key={o.key} value={o.key}>{o.title}</option>)}
            </select>
          </label>
        ) : null}
        <span className="claims-head-actions">{helpButton}{postButton}</span>
      </div>
      {loadError ? <div className="form-error">{t('ck_backend_error', { err: loadError })}</div> : null}
      {help}
      {postRef}

      <div className="claims-work">
        {/* ---------- bring comments in ---------- */}
        <section className="panel claims-intake">
          <h2>{t('claims_add_title')}</h2>
          {stage === 'idle' || stage === 'reading' ? (
            <>
              {photos.length > 1 ? <p className="claims-hint">{t('claims_drop_all_hint')}</p> : null}
              {dropArea(false)}
            </>
          ) : null}

          {stage === 'review' || stage === 'parsing' ? (
            <>
              <p className="claims-hint claims-review-hint">{t('claims_review_hint')} {postButton}</p>
              {sortGroups.map(g => (
                <div className={`sort-group ${g.key == null ? 'is-unsorted' : ''}`} key={String(g.key)}>
                  <div className="sort-group-head">
                    {g.photo ? (
                      <button
                        type="button" className="sort-photo"
                        aria-label={t('claims_view_photo', { photo: g.label })}
                        onClick={() => zoom.open(g.photo!.batch.response?.image_b64 ?? photoThumb(g.photo!), g.label)}
                      ><img src={photoThumb(g.photo)} alt="" /></button>
                    ) : null}
                    <span className="sort-group-title">
                      <strong>{g.label}</strong>
                      <span className="meta">{t('claims_group_count', { n: g.pages.length })}</span>
                    </span>
                  </div>
                  {g.pages.map(({ pg, pi }) => (
                    <div className="sort-shot" key={pi}>
                      {pg.src ? (
                        <button type="button" className="sort-shot-img" aria-label={t('claims_view_screenshot')} onClick={() => zoom.open(pg.src!, pg.name)}>
                          <img src={pg.src} alt="" />
                        </button>
                      ) : null}
                      <div className="sort-shot-body">
                        <div className="sort-shot-head">
{pg.src ? (
                          <span className={`sort-by is-${pg.by}`}>
                            <Icon name={pg.by === 'picked' || pg.by === 'found' ? 'check' : 'warning'} size={14} />
                            {t(`claims_sorted_${pg.by}`)}
                          </span>
                          ) : <span />}
                          <button
                            type="button" className="round-btn destructive"
                            aria-label={t('claims_page_remove')} title={t('claims_page_remove')}
                            onClick={() => {
                              if (pg.src) URL.revokeObjectURL(pg.src);
                              setPages(prev => prev.filter((_, i) => i !== pi));
                            }}
                          ><Icon name="close" size={16} /></button>
                        </div>
                        {photos.length > 1 ? (
                          <label className="sort-move">
                            <span>{t('claims_move_to')}</span>
                            <select
                              value={pg.scanId == null ? '' : String(pg.scanId)}
                              onChange={e => {
                                const v = e.target.value === 'all' ? 'all' as const : Number(e.target.value);
                                setPages(prev => prev.map((p, i) => (i === pi ? { ...p, scanId: v, by: 'picked' } : p)));
                              }}
                            >
                              <option value="" disabled>{t('claims_pick_photo')}</option>
                              {photos.map(p => <option key={p.batch.id} value={String(p.batch.scanId)}>{t('claims_photo_short', { n: p.index })}</option>)}
                              <option value="all">{t('claims_several_photos')}</option>
                            </select>
                          </label>
                        ) : null}
                        <textarea
                          value={pg.text}
                          rows={Math.min(12, Math.max(4, pg.text.split('\n').length + 1))}
                          placeholder={t('claims_text_placeholder')}
                          aria-label={t('claims_text_label', { name: pg.name })}
                          onChange={e => setPages(prev => prev.map((p, i) => (i === pi ? { ...p, text: e.target.value } : p)))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {unsorted > 0 ? (
                <p className="claims-note"><Icon name="warning" size={14} />{t('claims_unsorted_left', { n: unsorted })}</p>
              ) : null}
              {stage === 'review' ? dropArea(true) : null}
              <div className="claims-actions">
                <span className="spacer" />
                <button type="button" className="ghost" disabled={busy} onClick={clearIntake}>{t('claims_discard')}</button>
                <button
                  type="button" className="accent" onClick={findClaims}
                  disabled={busy || !pages.some(p => p.text.trim()) || unsorted > 0}
                >
                  {stage === 'parsing' ? t('claims_finding') : t('claims_find')}
                </button>
              </div>
              {balance ? (
                <p className="credits-line">
                  {balance}
                  {credits?.remaining === 0 ? (
                    <> · <button type="button" className="link-btn" onClick={onEnterVoucher}>{t('voucher_enter')}</button></>
                  ) : null}
                </p>
              ) : null}
            </>
          ) : null}

          {stage === 'drafts' || stage === 'saving' ? (
            <>
              {drafts.length === 0 ? (
                <p className="claims-hint">{t('claims_none_found')}</p>
              ) : (
                <p className="claims-hint">{t('claims_drafts_hint')}</p>
              )}
              {drafts.map((d, di) => (
                <div className="claim-draft" key={di}>
                  <div className="claim-draft-head">
                    <input
                      type="text" value={d.buyer}
                      aria-label={t('claims_buyer')} placeholder={t('claims_buyer')}
                      onChange={e => patchDraft(di, { buyer: e.target.value })}
                    />
                    <button
                      type="button" className="round-btn destructive"
                      aria-label={t('claims_draft_remove')} title={t('claims_draft_remove')}
                      onClick={() => setDrafts(prev => prev.filter((_, i) => i !== di))}
                    ><Icon name="trash" size={16} /></button>
                  </div>
                  {d.comment ? <p className="claim-quote">“{d.comment}”</p> : null}
                  {d.unclear ? <p className="claims-note"><Icon name="warning" size={14} />{d.unclear}</p> : null}
                  {d.items.map((it, ii) => {
                    const taken = it.key ? claimedBy.get(it.key) : undefined;
                    const card = it.key ? cardsByKey.get(it.key) : undefined;
                    const open = !card || picking === `${di}:${ii}`;
                    return (
                      <div className={`claim-item ${card ? '' : 'is-open'}`} key={ii}>
                        <div className="claim-item-row">
                          {card ? (
                            <div className="claim-item-card">
                              <CardTile card={card} price={priceOf(card)} />
                              {photos.length > 1 ? <span className="claim-item-photo">{t('claims_photo_short', { n: card.photo })}</span> : null}
                            </div>
                          ) : (
                            <p className="claims-note claim-item-q">
                              <Icon name="warning" size={14} />
                              {it.unclear || t('claims_which_card')}{it.said ? ` (“${it.said}”)` : ''}
                            </p>
                          )}
                          <label className="claim-qty">
                            <span>×</span>
                            <input
                              type="text" inputMode="numeric" value={it.qty}
                              aria-label={t('qty')}
                              onChange={e => patchItem(di, ii, { qty: Math.max(1, parseInt(e.target.value.replace(/\D/g, '')) || 1) })}
                            />
                          </label>
                          {card ? (
                            <button
                              type="button" className="ghost claim-change"
                              aria-expanded={open}
                              onClick={() => setPicking(open ? null : `${di}:${ii}`)}
                            >{t('claims_change_card')}</button>
                          ) : null}
                          <button
                            type="button" className="round-btn"
                            aria-label={t('claims_item_remove')} title={t('claims_item_remove')}
                            onClick={() => removeItem(di, ii)}
                          ><Icon name="close" size={16} /></button>
                        </div>
                        {open ? (
                          <CardPicker
                            photos={photos} hint={card ? card.scanId : it.hint} value={it.key}
                            priceOf={priceOf} statusOf={statusOf} photoLabel={photoLabel} t={t}
                            onPick={key => { patchItem(di, ii, { key, unclear: '' }); setPicking(null); }}
                          />
                        ) : overClaimed.has(`${di}:${ii}`) ? (
                          <p className="claims-note">
                            <Icon name="warning" size={14} />
                            {taken ? t('claims_taken_by', { names: taken.names.join(', ') }) : t('claims_taken_earlier')}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  <button
                    type="button" className="link-btn"
                    onClick={() => patchDraft(di, { items: [...d.items, { key: null, qty: 1, said: '', unclear: '', hint: null }] })}
                  >{t('claims_add_card')}</button>
                </div>
              ))}
              {unresolved ? <p className="claims-note"><Icon name="warning" size={14} />{t('claims_unresolved')}</p> : null}
              {!unresolved && unpriced ? <p className="claims-note"><Icon name="warning" size={14} />{t('claims_unpriced')}</p> : null}
              <div className="claims-actions">
                <button type="button" className="ghost" disabled={busy} onClick={() => { setPicking(null); setStage('review'); }}>{t('claims_back')}</button>
                <span className="spacer" />
                <button type="button" className="ghost" disabled={busy} onClick={clearIntake}>{t('claims_discard')}</button>
                <button type="button" className="accent" disabled={busy || ready.length === 0 || unresolved || unpriced} onClick={save}>
                  {stage === 'saving' ? t('ck_saving') : t('claims_save', { n: ready.length })}
                </button>
              </div>
            </>
          ) : null}

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <input
            ref={fileRef} type="file" multiple accept="image/*" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) readFiles(Array.from(e.target.files)); e.target.value = ''; }}
          />
        </section>


        {/* ---------- who has claimed what ---------- */}
        <div className="claims-claimed">
          <div className="review-head">
            <div className="review-title">
              <h2>{t('claims_list_title')}</h2>
              <span className="meta">{groups.length}</span>
            </div>
            {groups.length > 1 ? (
              <div className="segmented claim-sort" role="group" aria-label={t('claims_sort')}>
                {(['claimed', 'name', 'photo'] as const).map(k => (
                  <button key={k} type="button" className={claimSort === k ? 'active' : ''} aria-pressed={claimSort === k} onClick={() => setClaimSort(k)}>
                    {t(`claims_sort_${k}`)}
                  </button>
                ))}
              </div>
            ) : null}
            {live && groups.length ? (
              <button type="button" className="ghost" disabled={refreshingPrices} onClick={refreshLivePrices}>
                <Icon name="refresh" size={18} />{refreshingPrices ? t('scan_refresh_prices_busy') : t('scan_refresh_prices')}
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={() => setSlipsOpen(true)}>
              <Icon name="download" size={18} />{t('slips_title')}
            </button>
            {groups.length ? (
              <span className="all-scans-total">
                <span className="label">{t('claims_paid_of', { paid: formatMyr(totals.paid, settings) })}</span>
                <span className="value">{formatMyr(totals.all, settings)}</span>
              </span>
            ) : null}
          </div>
          {groups.length === 0 ? (
            <p className="gallery-empty">{t('claims_empty')}</p>
          ) : (
            <div className="claims-list">
              {shownGroups.map(g => (
                <div className={`claim-row is-${g.state}`} key={g.buyerId}>
                  <div className="claim-row-main">
                    <span className="claim-row-name">
                      {g.name}
                      {/* For drop-off slips; optional, so a missing one is just a button. */}
                      <button type="button" className="link-btn claim-row-phone" onClick={() => editPhone(g.buyerId, g.name)}>
                        {phoneOf(g.buyerId) || t('claims_add_phone')}
                      </button>
                    </span>
                    <span className="claim-row-total">{formatMyr(totalNow(g), settings)}</span>
                  </div>
                  {live ? (() => {
                    const sent = g.orders.length > 0 && g.orders.every(o => o.prices_sent_at);
                    const when = g.orders.map(o => o.prices_sent_at).find(Boolean);
                    return sent ? (
                      <p className="live-status is-sent">
                        <Icon name="check" size={14} />{t('live_sent', { date: shortDate(new Date(when!)) })}
                        <button type="button" className="link-btn" onClick={() => resend(g)}>{t('live_resend')}</button>
                      </p>
                    ) : (
                      <p className="live-status"><Icon name="bolt" size={14} />{t('live_estimate')}</p>
                    );
                  })() : null}
                  <ul className="claim-row-items">
                    {g.items.map(i => {
                      const working = workingOf(i);
                      return (
                        <li key={i.id}>
                          <span className="claim-item-name">
                            {itemLine(i)}
                            {working ? <span className="claim-item-working">{working}{i.qty > 1 ? ` ${t('claims_copy_each')}` : ''}</span> : null}
                          </span>
                          <span>{formatMyr(unitNow(i) * i.qty, settings)}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="claim-row-foot">
                    <div className="segmented" role="group" aria-label={t('claims_status')}>
                      {(['unpaid', 'paid', 'done'] as PayState[]).map(s => (
                        <button
                          key={s} type="button" disabled={stateSaving}
                          className={g.state === s ? 'active' : ''} aria-pressed={g.state === s}
                          onClick={() => g.state !== s && setState(g.orders, s)}
                        >{t(`claims_state_${s}`)}</button>
                      ))}
                    </div>
                    <span className="spacer" />
                    <button type="button" className="ghost" onClick={() => copySummary(g)}>
                      <Icon name={copied === `${g.buyerId}:text` ? 'check' : 'copy'} size={16} />
                      {copied === `${g.buyerId}:text` ? t('claims_copied') : t('claims_copy')}
                    </button>
                    {canShareQr ? (
                      <button type="button" className="ghost" onClick={() => shareWithQr(g)}>
                        <Icon name="share" size={16} />{t('claims_share_qr')}
                      </button>
                    ) : canCopyQr ? (
                      <button type="button" className="ghost" onClick={() => copyQr(g)}>
                        <Icon name={copied === `${g.buyerId}:qr` ? 'check' : 'copy'} size={16} />
                        {copied === `${g.buyerId}:qr` ? t('claims_copied') : t('claims_copy_qr')}
                      </button>
                    ) : null}
                    <button
                      type="button" className="round-btn destructive"
                      aria-label={t('claims_remove_title')} title={t('claims_remove_title')}
                      disabled={stateSaving}
                      onClick={() => removeClaim(g.name, g.orders)}
                    ><Icon name="trash" size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <SupportSheet open={supportOpen} onClose={() => setSupportOpen(false)} asking t={t} />
      <SlipsSheet
        open={slipsOpen} onClose={() => setSlipsOpen(false)} t={t}
        buyers={groups.map(g => ({ id: g.buyerId, name: g.name, phone: phoneOf(g.buyerId), done: g.state === 'done' }))}
      />
    </>
  );
}
