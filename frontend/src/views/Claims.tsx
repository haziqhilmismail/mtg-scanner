// Claims: who wants which card.
//
// Facebook gives no way to read a group's comments, so the seller brings the
// thread in as screenshots (or pasted text). The server works out which photo
// each screenshot shows and reads its comments; Gemini then matches comments
// to cards. Nothing is saved until the seller has checked the drafts, and
// anything the reader was unsure about is left for the seller to settle.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  confirmClaims, parseClaims, readClaimScreenshots,
  type CataloguePhoto, type ConfirmClaim,
} from '../api.ts';
import {
  buyersApi, listingsApi, ordersApi, postsApi,
  type Buyer, type Listing, type Order, type Post,
} from '../api/checklist.ts';
import { OutOfCreditsError } from '../api/auth.ts';
import {
  CardPicker, CardTile, PhotoPicker, photoThumb,
  type CardRef, type CardStatus, type Photo,
} from '../components/ClaimPickers.tsx';
import { useDialog } from '../components/DialogProvider.tsx';
import { Icon } from '../components/Icon.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { usePersistedState } from '../hooks/usePersistedState.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Batch, CardRowData, Settings } from '../types.ts';
import { computeCardData, formatMyr, formatMyrWithFoil, listingFields, pastedImages } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';

interface Props {
  scanner: ScannerStore;
  settings: Settings;
  t: T;
  onOpenOldChecklist: () => void;
}

const UNFILED = 'unfiled';

// hint: the photo the comment is about, when known, so its cards come first.
interface DraftItem { key: string | null; qty: number; said: string; unclear: string; hint: number | null }
interface Draft { buyer: string; comment: string; unclear: string; items: DraftItem[] }
// scanId: the photo the comments are about; 'all' = several photos; null =
// not known yet, which the seller must settle before claims are looked for.
// found: the app saw the photo in the screenshot itself.
// suggest: the photo of the screenshot before, offered as a likely answer.
interface Page {
  name: string; text: string; src: string | null;
  scanId: number | 'all' | null; found: boolean; suggest: number | null;
}

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

export function Claims({ scanner, settings, t, onOpenOldChecklist }: Props) {
  const dialog = useDialog();
  const [posts, setPosts] = useState<Post[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  // Shared with the Scans gallery, so both pages open on the same post.
  const [folderKey, setFolderKey] = usePersistedState<string | null>('mtg.scans.folder', null);
  const [helpOpen, setHelpOpen] = usePersistedState('mtg.claims.help', true);

  const reload = useCallback(async () => {
    try {
      const [p, l, o, b] = await Promise.all([
        postsApi.list(true), listingsApi.list(), ordersApi.list(true), buyersApi.list(),
      ]);
      setPosts(p); setListings(l); setOrders(o); setBuyers(b); setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    }
    setLoaded(true);
  }, []);
  useEffect(() => { reload(); }, [reload]);

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

  // ---------- what can be claimed ----------
  const photos = useMemo<Photo[]>(() => {
    if (!activeKey) return [];
    return scanner.batches
      .filter(b => b.scanId != null && b.response && keyOfBatch(b) === activeKey)
      .map((batch, i) => {
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
    setStage('reading'); setError(''); setIntakeKey(activeKey);
    try {
      const read = await readClaimScreenshots(images, photos.map(p => p.batch.scanId as number));
      // A screenshot of comments alone (scrolled past the photo) is left for
      // the seller to place; the photo of the one before is offered first.
      const prev = stage === 'review' ? pages[pages.length - 1]?.scanId : null;
      let last: number | null = typeof prev === 'number' ? prev : null;
      const next: Page[] = read.map((pg, i) => {
        const found = pg.scan_id != null && photos.some(p => p.batch.scanId === pg.scan_id);
        const page: Page = {
          name: images[i].name || `screenshot ${i + 1}`, text: pg.text,
          src: URL.createObjectURL(images[i]),
          scanId: found ? pg.scan_id : onlyPhoto, found, suggest: found ? null : last,
        };
        if (found) last = pg.scan_id;
        return page;
      });
      setPages(prev => (stage === 'review' ? [...prev, ...next] : next));
      setStage('review');
    } catch (e) {
      setError((e as Error).message);
      setStage(pages.length ? 'review' : 'idle');
    }
  }, [photos, stage, pages, onlyPhoto, activeKey]);

  // Ctrl/⌘+V of a screenshot anywhere on the page (PC: Win+Shift+S, then paste).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (stage !== 'idle' && stage !== 'review') return;
      const files = pastedImages(e);
      if (!files.length) return;
      e.preventDefault();
      readFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [stage, readFiles]);

  const findClaims = useCallback(async () => {
    const filled = pages.filter(pg => pg.text.trim());
    if (!filled.length || filled.some(pg => pg.scanId == null)) return;
    setStage('parsing'); setError('');
    try {
      // Screenshots of the same photo are read as one thread, in order, so
      // "top left" means that photo. Pages about several photos are read
      // against the whole post, and anything ambiguous comes back as a question.
      const order: Array<number | 'all' | null> = [];
      const text = new Map<number | 'all' | null, string[]>();
      for (const pg of filled) {
        if (!text.has(pg.scanId)) { text.set(pg.scanId, []); order.push(pg.scanId); }
        text.get(pg.scanId)!.push(pg.text.trim());
      }
      const found: Draft[] = [];
      for (const scanId of order) {
        const subset = typeof scanId === 'number' ? photos.filter(p => p.batch.scanId === scanId) : photos;
        const got = await parseClaims(text.get(scanId)!.join('\n\n'), catalogue(subset.length ? subset : photos));
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
      }
      setDrafts(found);
      setStage('drafts');
    } catch (e) {
      // Working out claims costs a scan credit; out of them, say so the way
      // the upload area does.
      setError(e instanceof OutOfCreditsError
        ? t('credits_out_title') + (e.credits ? `. ${t('credits_out_body_plain', { limit: e.credits.limit })}` : '')
        : (e as Error).message);
      setStage('review');
    }
  }, [pages, photos, catalogue, cardsByKey, scanIds, t]);

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
    } catch (e) {
      setError((e as Error).message);
      setStage('drafts');
    }
  }, [ready, cardsByKey, postId, reload, clearIntake]);

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
    }
    await reload();
    setStateSaving(false);
  }, [dialog, reload, t]);

  const removeClaim = useCallback(async (name: string, os: Order[]) => {
    const ok = await dialog.confirm({
      title: t('claims_remove_title'),
      message: t('claims_remove_msg', { name }),
      okLabel: t('claims_remove_ok'),
      destructive: true,
    });
    if (!ok) return;
    for (const o of os) await ordersApi.cancel(o.id).catch(() => { /* reload shows what's left */ });
    await reload();
  }, [dialog, reload, t]);

  const itemLine = useCallback((i: Order['items'][number]) => {
    const card = cardOfListing(listingsById.get(i.listing_id));
    const where = card && photos.length > 1 ? `${t('claims_photo_short', { n: card.photo })} · ` : '';
    return `${where}${i.name_snapshot}${i.qty > 1 ? ` ×${i.qty}` : ''}`;
  }, [cardOfListing, listingsById, photos.length, t]);

  const [copied, setCopied] = useState<number | null>(null);
  const copySummary = useCallback(async (g: (typeof groups)[number]) => {
    const lines = g.items.map(i => `${itemLine(i)} — ${formatMyr(Number(i.line_total_myr), settings)}`);
    const text = [g.name, ...lines, `${t('total')}: ${formatMyr(g.total, settings)}`].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(g.buyerId);
      setTimeout(() => setCopied(c => (c === g.buyerId ? null : c)), 1500);
    } catch { /* clipboard blocked: nothing to do */ }
  }, [itemLine, settings, t]);

  // ---------- render ----------
  if (!loaded || (scanner.loadingSaved && scanner.batches.length === 0)) {
    return <Spinner label={t('ck_loading')} />;
  }

  const help = (
    <section className={`panel disclosure ${helpOpen ? 'is-open' : ''}`}>
      <button
        type="button" className="disclosure-head"
        aria-expanded={helpOpen} aria-controls="claims-help"
        onClick={() => setHelpOpen(o => !o)}
      >
        <span className="disclosure-text">
          <span className="disclosure-title">{t('claims_help_title')}</span>
          {!helpOpen ? <span className="disclosure-summary">{t('claims_help_summary')}</span> : null}
        </span>
        <Icon name="chevronDown" className="disclosure-chevron" />
      </button>
      {helpOpen ? (
        <div id="claims-help" className="disclosure-body claims-help">
          <ol>
            <li><strong>{t('claims_help_1_head')}</strong> {t('claims_help_1')}</li>
            <li><strong>{t('claims_help_2_head')}</strong> {t('claims_help_2')}</li>
            <li><strong>{t('claims_help_3_head')}</strong> {t('claims_help_3')}</li>
            <li><strong>{t('claims_help_4_head')}</strong> {t('claims_help_4')}</li>
          </ol>
          <p className="claims-help-eg-title">{t('claims_help_eg_title')}</p>
          <div className="claims-eg">
            {[1, 2, 3, 4, 5].map(n => (
              <div className="claims-eg-row" key={n}>
                <span className="claims-eg-comment">
                  <strong>{t(`claims_eg_${n}_who`)}</strong>
                  <span>{t(`claims_eg_${n}_says`)}</span>
                </span>
                <Icon name="chevronRight" size={16} />
                <span className={`claims-eg-result ${n >= 4 ? 'is-soft' : ''}`}>{t(`claims_eg_${n}_gives`)}</span>
              </div>
            ))}
          </div>
          <p className="claims-help-tip">{t('claims_help_tip')}</p>
        </div>
      ) : null}
    </section>
  );

  if (!postOptions.length) {
    return (
      <>
        <div className="review-head"><div className="review-title"><h2>{t('nav_claims')}</h2></div></div>
        {help}
        <p className="gallery-empty">{t('claims_no_posts')}</p>
        <p className="claims-old"><button type="button" className="link-btn" onClick={onOpenOldChecklist}>{t('claims_old_checklist')}</button></p>
      </>
    );
  }

  const busy = stage === 'reading' || stage === 'parsing' || stage === 'saving';

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
            <select value={activeKey ?? ''} disabled={busy} onChange={e => { clearIntake(); setError(''); setFolderKey(e.target.value); }}>
              {postOptions.map(o => <option key={o.key} value={o.key}>{o.title}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {loadError ? <div className="form-error">{t('ck_backend_error', { err: loadError })}</div> : null}
      {help}

      <div className="claims-work">
        {/* ---------- bring comments in ---------- */}
        <section className="panel claims-intake">
          <h2>{t('claims_add_title')}</h2>
          {stage === 'idle' || stage === 'reading' ? (
            <>
              <div
                className="drop"
                role="button" tabIndex={0}
                onClick={() => !busy && fileRef.current?.click()}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fileRef.current?.click(); } }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if (!busy) readFiles(Array.from(e.dataTransfer.files)); }}
              >
                <Icon name="feedback" size={34} className="drop-icon" />
                <strong>{stage === 'reading' ? t('claims_reading') : t('claims_drop_strong')}</strong>
                <p>{t('claims_drop_sub')}</p>
              </div>
              <div className="claims-alt">
                <button
                  type="button" className="ghost" disabled={busy}
                  onClick={() => {
                    setPages([{ name: t('claims_pasted'), text: '', src: null, scanId: onlyPhoto, found: false, suggest: null }]);
                    setStage('review'); setIntakeKey(activeKey);
                  }}
                >{t('claims_paste_instead')}</button>
              </div>
            </>
          ) : null}

          {stage === 'review' || stage === 'parsing' ? (
            <>
              <p className="claims-hint">{t('claims_review_hint')}</p>
              {pages.map((pg, pi) => {
                const setPhoto = (v: number | 'all') => setPages(prev => prev.map((p, i) => (i === pi ? { ...p, scanId: v } : p)));
                const shown = photos.find(p => p.batch.scanId === pg.scanId);
                return (
                  <div className={`claims-page ${pg.scanId == null ? 'is-open' : ''}`} key={pi}>
                    <div className="claims-page-head">
                      {pg.src ? (
                        <a className="claims-page-shot" href={pg.src} target="_blank" rel="noreferrer" title={t('claims_view_screenshot')}>
                          <img src={pg.src} alt={t('claims_view_screenshot')} />
                        </a>
                      ) : null}
                      <span className="claims-page-name">{pg.name}</span>
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
                      <>
                        {pg.found && shown ? (
                          <p className="claims-note is-ok"><Icon name="check" size={14} />{t('claims_page_found', { photo: t('claims_photo_short', { n: shown.index }) })}</p>
                        ) : pg.scanId == null ? (
                          <p className="claims-note"><Icon name="warning" size={14} />{t('claims_page_pick')}</p>
                        ) : null}
                        <PhotoPicker photos={photos} value={pg.scanId} suggest={pg.suggest} onPick={setPhoto} t={t} />
                      </>
                    ) : null}
                    <textarea
                      value={pg.text}
                      rows={Math.min(12, Math.max(4, pg.text.split('\n').length + 1))}
                      placeholder={t('claims_text_placeholder')}
                      aria-label={t('claims_text_label', { name: pg.name })}
                      onChange={e => setPages(prev => prev.map((p, i) => (i === pi ? { ...p, text: e.target.value } : p)))}
                    />
                  </div>
                );
              })}
              {pages.some(pg => pg.text.trim() && pg.scanId == null) ? (
                <p className="claims-note"><Icon name="warning" size={14} />{t('claims_pick_photos_first')}</p>
              ) : null}
              <div className="claims-actions">
                <button type="button" className="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Icon name="plus" size={16} />{t('claims_add_more')}
                </button>
                <span className="spacer" />
                <button type="button" className="ghost" disabled={busy} onClick={clearIntake}>{t('claims_discard')}</button>
                <button
                  type="button" className="accent" onClick={findClaims}
                  disabled={busy || !pages.some(p => p.text.trim()) || pages.some(p => p.text.trim() && p.scanId == null)}
                >
                  {stage === 'parsing' ? t('claims_finding') : t('claims_find')}
                </button>
              </div>
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

        {/* ---------- every card in the post, beside the comments ---------- */}
        <aside className="panel claims-inventory" aria-label={t('claims_inventory_title')}>
          <h2>{t('claims_inventory_title')}</h2>
          <p className="claims-hint">{t('claims_inventory_hint')}</p>
          {photos.map(p => (
            <div className="inv-photo" key={p.batch.id}>
              <div className="inv-photo-head">
                <img src={photoThumb(p)} alt="" loading="lazy" decoding="async" />
                <span>
                  <strong>{t('claims_photo_short', { n: p.index })}</strong>
                  <span className="meta">{t('claims_inv_count', { n: p.cards.length })}</span>
                </span>
              </div>
              <div className="card-grid">
                {p.cards.map(c => <CardTile key={c.key} card={c} price={priceOf(c)} status={statusOf(c)} />)}
              </div>
            </div>
          ))}
          <p className="claims-hint inv-foot">{t('claims_inv_removed_hint')}</p>
        </aside>

        {/* ---------- who has claimed what ---------- */}
        <div className="claims-claimed">
          <div className="review-head">
            <div className="review-title">
              <h2>{t('claims_list_title')}</h2>
              <span className="meta">{groups.length}</span>
            </div>
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
              {groups.map(g => (
                <div className={`claim-row is-${g.state}`} key={g.buyerId}>
                  <div className="claim-row-main">
                    <span className="claim-row-name">{g.name}</span>
                    <span className="claim-row-total">{formatMyr(g.total, settings)}</span>
                  </div>
                  <ul className="claim-row-items">
                    {g.items.map(i => (
                      <li key={i.id}>
                        <span>{itemLine(i)}</span>
                        <span>{formatMyr(Number(i.line_total_myr), settings)}</span>
                      </li>
                    ))}
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
                      <Icon name={copied === g.buyerId ? 'check' : 'copy'} size={16} />
                      {copied === g.buyerId ? t('claims_copied') : t('claims_copy')}
                    </button>
                    <button
                      type="button" className="round-btn destructive"
                      aria-label={t('claims_remove_title')} title={t('claims_remove_title')}
                      onClick={() => removeClaim(g.name, g.orders)}
                    ><Icon name="trash" size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="claims-old">
        <button type="button" className="link-btn" onClick={onOpenOldChecklist}>{t('claims_old_checklist')}</button>
      </p>
    </>
  );
}
