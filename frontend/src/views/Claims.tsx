// Claims: who wants which card on a post, what they owe, and the message
// each buyer is sent.
//
// Facebook gives no way to read a group's comments, so the seller brings the
// thread in as screenshots (Add comments). Each buyer then has a card with
// their cards, Copy message, and where they stand: Unpaid, Paid or Done.
// Status changes and Remove buyer show at once and offer Undo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { paymentApi, relookupScanPrices, type Payment } from '../api.ts';
import {
  buyersApi, listingsApi, ordersApi, salesApi,
  type Buyer, type Listing, type Order, type OrderItem, type Post, type SentLine,
} from '../api/checklist.ts';
import type { CardRef, Photo } from '../components/ClaimPickers.tsx';
import { Icon } from '../components/Icon.tsx';
import { Link } from '../components/Link.tsx';
import { SlipsSheet } from '../components/SlipsSheet.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { SupportSheet } from '../components/SupportSheet.tsx';
import { Select } from '../components/ui/Field.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { useToast } from '../components/ui/Toast.tsx';
import { usePersistedState } from '../hooks/usePersistedState.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { T } from '../hooks/useLang.ts';
import { UNFILED } from '../routes.ts';
import type { Batch, CardRowData, Credits } from '../types.ts';
import { byPostOrder, computeCardData, dueForSupportAsk, photoNumbers, popupOpen } from '../utils.ts';
import { AddComments } from './claims/AddComments.tsx';
import { BuyerCard } from './claims/BuyerCard.tsx';
import { BuyerDialog } from './claims/BuyerDialog.tsx';
import {
  buyerGroups, buyerMessage, claimedCounts, claimTotals, CLAIM_SORTS, counted, PAY_STATES, priceFormula, rm, sortGroups, stampsFor,
  type BuyerGroup, type ClaimSort, type Line, type PayState, type Stamps, type StatusMove,
} from './claims/model.ts';
import { ClaimSteps, HowDialog, Money } from './claims/parts.tsx';
import { useScreenshotDrop } from './claims/useScreenshotDrop.ts';

interface Props {
  // The page is showing (Scanner and Claims stay mounted, so switching doesn't reload).
  active: boolean;
  scanner: ScannerStore;
  pricing: PricingStore;
  t: T;
  lang: string;
  // The open post, from the URL (?post=).
  folderKey: string | null;
  onFolderChange: (key: string) => void;
  // Claim-read balance; null until loaded. onCredits takes the new one after each read.
  credits: Credits | null;
  onCredits: (credits: Credits) => void;
  onEnterVoucher: () => void;
  // How buyers pay, added under every message.
  payment: Payment | null;
}

const ORDINALS = ['1st', '2nd', '3rd'];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;

// Where each card sits, in words a comment might use ("top left", "the third
// one"), for Find claims. Cards are put into rows by their vertical centres,
// then ordered left to right; the count goes row by row, the way people read.
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

export function Claims({ active, scanner, pricing: { pricingFor, listPosts }, t, lang, folderKey, onFolderChange, credits, onCredits, onEnterVoucher, payment }: Props) {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  const reload = useCallback(async () => {
    try {
      const [p, l, o, b] = await Promise.all([listPosts(), listingsApi.list(), ordersApi.list(true), buyersApi.list()]);
      setPosts(p); setListings(l); setOrders(o); setBuyers(b); setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    }
    setLoaded(true);
  }, [listPosts]);
  // Refreshed each time the page shows, so changes made on Scanner are current.
  useEffect(() => { if (active) reload(); }, [active, reload]);

  // ---------- which post ----------
  // Posts with saved photos, newest first; archived ones under their own group.
  const postsById = useMemo(() => new Map(posts.map(p => [p.id, p])), [posts]);
  const keyOfBatch = useCallback((b: Batch) => (b.postId != null && postsById.has(b.postId) ? `p${b.postId}` : UNFILED), [postsById]);
  const postOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const b of scanner.batches) {
      if (b.scanId != null && b.response) count.set(keyOfBatch(b), (count.get(keyOfBatch(b)) ?? 0) + 1);
    }
    return [...count].reverse().map(([key, n]) => {
      const post = key === UNFILED ? undefined : postsById.get(Number(key.slice(1)));
      const title = post ? post.title || `#${post.id}` : t('scans_unfiled');
      return { key, title, label: `${title} · ${counted(t, 'claims_photos', n)}`, archived: post?.status === 'archived' };
    });
  }, [scanner.batches, keyOfBatch, postsById, t]);
  const activeKey = postOptions.some(o => o.key === folderKey)
    ? folderKey : (postOptions.find(o => !o.archived) ?? postOptions[0])?.key ?? null;
  const postTitle = postOptions.find(o => o.key === activeKey)?.title ?? '';
  const postId = activeKey && activeKey !== UNFILED ? Number(activeKey.slice(1)) : null;
  // Every photo here is the open post's, so one pricing prices them all.
  const settings = pricingFor(postId);
  const cents = settings.showCents;
  const live = settings.priceMode === 'live';

  // ---------- what can be claimed ----------
  const photos = useMemo<Photo[]>(() => {
    if (!activeKey) return [];
    const numbers = photoNumbers(scanner.batches);
    return scanner.batches
      .filter(b => b.scanId != null && b.response && keyOfBatch(b) === activeKey)
      .sort(byPostOrder)
      .map((batch, at) => {
        const index = numbers.get(batch.id) ?? at + 1;
        const visible = computeCardData(batch, settings).filter(cd => !cd.removed);
        const where = describePositions(visible);
        return {
          batch, index,
          cards: visible.map(cd => ({
            key: `${batch.scanId}:${cd.card.id}`, scanId: batch.scanId as number, photo: index,
            filename: batch.filename, cd, position: where.get(cd.origIdx) ?? '',
          })),
        };
      });
  }, [scanner.batches, activeKey, keyOfBatch, settings]);

  // ---------- the claims on this post ----------
  const scanIds = useMemo(() => new Set(photos.map(p => p.batch.scanId as number)), [photos]);
  const listingsById = useMemo(() => new Map(listings.map(l => [l.id, l])), [listings]);
  // The scanned card a listing stands for: same photo, same box.
  const cardOf = useCallback((i: OrderItem): CardRef | undefined => {
    const l = listingsById.get(i.listing_id);
    if (!l || l.scan_id == null || !l.bbox) return undefined;
    const box = l.bbox.join(',');
    return photos.find(p => p.batch.scanId === l.scan_id)?.cards.find(c => c.cd.card.bbox.join(',') === box);
  }, [listingsById, photos]);
  const inPost = useCallback((i: OrderItem) => {
    const l = listingsById.get(i.listing_id);
    return !!l && ((l.scan_id != null && scanIds.has(l.scan_id)) || (postId != null && l.post_ids.includes(postId)));
  }, [listingsById, scanIds, postId]);
  // A live-price post: a buyer not sent their prices yet pays the card's
  // price today; once sent, what they were told. Otherwise the saved price.
  const lineOf = useCallback((i: OrderItem, o: Order): Line => {
    const card = cardOf(i);
    const pending = live && !o.prices_sent_at;
    const today = card?.cd.unitPrice;
    const each = pending && today != null && Number.isFinite(today) && today > 0 ? today : Number(i.unit_price_myr);
    return { id: i.id, name: i.name_snapshot, qty: i.qty, each, formula: card ? priceFormula(card.cd, each) : null, photo: card?.photo ?? null, live: pending };
  }, [cardOf, live]);
  const groups = useMemo(() => buyerGroups(orders, buyers, inPost, lineOf), [orders, buyers, inPost, lineOf]);
  const claimedBy = useMemo(() => claimedCounts(orders, buyers, i => cardOf(i)?.key), [orders, buyers, cardOf]);
  const totals = claimTotals(groups);

  const [storedSort, setSort] = usePersistedState<ClaimSort>('mtg.claims.sort', 'claimed');
  const sort = CLAIM_SORTS.includes(storedSort) ? storedSort : 'claimed';
  const [filter, setFilter] = useState<'all' | PayState>('all');
  const shown = useMemo(() => sortGroups(groups, sort).filter(g => filter === 'all' || g.state === filter), [groups, sort, filter]);

  // ---------- dialogs ----------
  const [howOpen, setHowOpen] = useState(false);
  const [slipsOpen, setSlipsOpen] = useState(false);
  const [buyerId, setBuyerId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [session, setSession] = useState(0);    // a new Add comments starts afresh
  const [incoming, setIncoming] = useState<{ id: number; files: File[] } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [newSince, setNewSince] = useState<Set<number> | null>(null);   // buyers before the last Add
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportAsk, setSupportAsk] = usePersistedState<{ saves: number; askedAt: number | null }>('mtg.claims.supportAsk', { saves: 0, askedAt: null });
  // Another post: nothing from the last one carries over.
  const [shownKey, setShownKey] = useState(activeKey);
  if (shownKey !== activeKey) {
    setShownKey(activeKey); setFilter('all'); setCopiedId(null); setNewSince(null); setSession(s => s + 1); setAddOpen(false);
  }

  const startAdd = useCallback((files?: File[]) => {
    // The URL names the post from here on, so a scan finishing on a newer
    // post can't swap the post under the open dialog.
    if (activeKey && activeKey !== folderKey) onFolderChange(activeKey);
    setHowOpen(false);
    setSession(s => s + 1);
    setIncoming(files?.length ? { id: Date.now(), files } : null);
    setAddOpen(true);
  }, [activeKey, folderKey, onFolderChange]);
  const pageDragging = useScreenshotDrop(active, () => photos.length > 0 && !popupOpen(), startAdd);

  const closeAdd = (hadWork: boolean) => {
    setAddOpen(false);
    if (hadWork) toast(t('claims_toast_closed'), { undoLabel: t('claims_undo'), onUndo: () => setAddOpen(true) });
  };
  const added = async (n: number) => {
    setNewSince(new Set(groups.map(g => g.buyerId)));
    setAddOpen(false);
    setFilter('all');
    await reload();
    toast(counted(t, 'claims_toast_added', n));
    // The tip-jar ask; see dueForSupportAsk for how often.
    const saves = supportAsk.saves + 1, now = Date.now();
    const ask = dueForSupportAsk(saves, supportAsk.askedAt, now);
    setSupportAsk({ saves, askedAt: ask ? now : supportAsk.askedAt });
    if (ask) setSupportOpen(true);
  };

  // ---------- acting on a buyer ----------
  // Changes show at once; their requests run one after another, so an Undo
  // can't overtake the change it undoes. A failed one reloads the truth.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const queue = useCallback((job: () => Promise<unknown>) => {
    writes.current = writes.current.then(job).catch(() => { toast(t('claims_save_failed')); return reload(); });
  }, [toast, t, reload]);
  const stamp = useCallback((changes: Map<number, Stamps>) => {
    setOrders(prev => prev.map(o => (changes.has(o.id) ? { ...o, ...changes.get(o.id) } : o)));
    queue(async () => { for (const [id, s] of changes) await ordersApi.update(id, s); });
  }, [queue]);
  const move = useCallback((g: BuyerGroup, to: StatusMove) => {
    const now = new Date().toISOString();
    const changed = g.orders.filter(o => {
      const s = stampsFor(o, to, now);
      return s.paid_at !== o.paid_at || s.delivered_at !== o.delivered_at;
    });
    if (!changed.length) return;
    stamp(new Map(changed.map(o => [o.id, stampsFor(o, to, now)])));
    const said = to === 'unpaid' ? 'claims_toast_unpaid' : to === 'done' ? 'claims_toast_done' : g.state === 'done' ? 'claims_toast_back' : 'claims_toast_paid';
    toast(t(said, { name: g.name.trim() }), {
      undoLabel: t('claims_undo'),
      onUndo: () => stamp(new Map(changed.map(o => [o.id, { paid_at: o.paid_at, delivered_at: o.delivered_at }]))),
    });
  }, [stamp, toast, t]);
  const cancelOrders = useCallback((ids: number[], cancelled: boolean) => {
    setOrders(prev => prev.map(o => (ids.includes(o.id) ? { ...o, status: cancelled ? 'cancelled' : 'claimed' } : o)));
    queue(async () => { for (const id of ids) await (cancelled ? ordersApi.cancel(id) : ordersApi.restore(id)); });
  }, [queue]);
  const remove = (g: BuyerGroup) => {
    const ids = g.orders.map(o => o.id);
    setBuyerId(null);
    cancelOrders(ids, true);
    toast(t('claims_toast_removed', { name: g.name.trim() }), { undoLabel: t('claims_undo'), onUndo: () => cancelOrders(ids, false) });
  };
  const savePhone = async (g: BuyerGroup, phone: string) => {
    try {
      const saved = await buyersApi.update(g.buyerId, { phone: phone || null });
      setBuyers(prev => prev.map(b => (b.id === saved.id ? saved : b)));
      return true;
    } catch {
      toast(t('claims_save_failed'));
      return false;
    }
  };

  // Copied for a live post: the buyer has their prices now, and they stay.
  const markSent = async (g: BuyerGroup) => {
    if (!live) return true;
    let all = true;
    for (const o of g.orders) {
      if (o.prices_sent_at) continue;
      const items = g.lines.filter(l => o.items.some(i => i.id === l.id)).map(l => ({ id: l.id, unit_price_myr: l.each.toFixed(2) }));
      try {
        const saved = await ordersApi.setPrices(o.id, items, true);
        setOrders(prev => prev.map(x => (x.id === saved.id ? saved : x)));
      } catch { all = false; /* stays an estimate: copying again sends it */ }
    }
    return all;
  };
  // What was sent, kept as sales records: each line's price is read from the
  // order on the server, the page adds how the card was priced (PRIVACY.md).
  const recordSales = (g: BuyerGroup) => {
    const lines: SentLine[] = g.orders.flatMap(o => o.items.filter(inPost)).map(i => {
      const cd = cardOf(i)?.cd;
      return {
        order_item_id: i.id,
        app_usd: cd && cd.usd > 0 ? cd.usd.toFixed(2) : null,
        app_mult: cd && cd.mult > 0 ? cd.mult.toFixed(3) : null,
        price_kind: !cd ? null : cd.isManual ? 'manual' : cd.hasOverride ? 'override' : 'auto',
      };
    });
    // Best effort: a lost call is made up the next time the message is copied.
    salesApi.record('copy', postId, settings.priceMode, lines).catch(() => {});
  };
  const messageOf = (g: BuyerGroup) => buyerMessage(g.name, g.lines, payment, cents, t);
  const copy = async (g: BuyerGroup) => {
    try { await navigator.clipboard.writeText(messageOf(g)); } catch { toast(t('claims_copy_failed')); return; }
    setCopiedId(g.buyerId);
    if (await markSent(g)) recordSales(g);
  };
  const resend = async (g: BuyerGroup) => {
    try {
      for (const o of g.orders) {
        if (!o.prices_sent_at) continue;
        const saved = await ordersApi.unsendPrices(o.id);
        setOrders(prev => prev.map(x => (x.id === saved.id ? saved : x)));
      }
    } catch {
      toast(t('claims_save_failed'));
    }
  };

  // The QR, fetched ahead: a phone lets a tap copy or share only at once,
  // not after a download.
  const [qrFile, setQrFile] = useState<File | null>(null);
  useEffect(() => {
    setQrFile(null);
    if (!payment?.qr_version) return;
    let current = true;
    fetch(paymentApi.qrUrl(payment.qr_version))
      .then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => { if (current) setQrFile(new File([b], 'duitnow-qr.png', { type: 'image/png' })); }, () => { /* no QR button */ });
    return () => { current = false; };
  }, [payment?.qr_version]);
  // Phones share the image; elsewhere it goes on the clipboard.
  const shareQr = !!qrFile && matchMedia('(pointer: coarse)').matches && !!navigator.canShare?.({ files: [qrFile] });
  const qrAction = shareQr ? 'share' : qrFile && typeof ClipboardItem !== 'undefined' ? 'copy' : null;
  const sendQr = async () => {
    if (!qrFile) return;
    if (shareQr) { await navigator.share({ files: [qrFile] }).catch(() => { /* closed */ }); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': qrFile })]);
      toast(t('claims_toast_qr'));
    } catch {
      toast(t('claims_copy_failed'));
    }
  };

  // Live post: today's CK prices for its photos, put on every buyer not sent theirs yet.
  const [refreshing, setRefreshing] = useState(false);
  const refreshPrices = async () => {
    setRefreshing(true);
    try {
      const fresh = new Map<number, CardRowData[]>();
      for (const p of photos) {
        const res = await relookupScanPrices(p.batch.scanId as number);
        scanner.replaceAllCards(p.batch.id, res.cards);
        fresh.set(p.batch.scanId as number, computeCardData({ ...p.batch, response: { ...p.batch.response!, cards: res.cards } }, settings));
      }
      for (const o of groups.flatMap(g => g.orders)) {
        if (o.prices_sent_at) continue;
        const items = o.items.flatMap(i => {
          const l = listingsById.get(i.listing_id);
          const cd = l?.scan_id != null && l.bbox ? fresh.get(l.scan_id)?.find(c => c.card.bbox.join(',') === l.bbox!.join(',')) : undefined;
          return cd && Number.isFinite(cd.unitPrice) && cd.unitPrice > 0 ? [{ id: i.id, unit_price_myr: cd.unitPrice.toFixed(2) }] : [];
        });
        if (!items.length) continue;
        const saved = await ordersApi.setPrices(o.id, items);
        setOrders(prev => prev.map(x => (x.id === saved.id ? saved : x)));
      }
    } catch {
      toast(t('claims_save_failed'));
    } finally {
      setRefreshing(false);
    }
  };

  // ---------- render ----------
  // Another page is showing: keep the state, render nothing.
  if (!active) return null;
  if (!loaded || (scanner.loadingSaved && scanner.batches.length === 0)) return <Spinner label={t('ck_loading')} />;

  const buyer = groups.find(g => g.buyerId === buyerId) ?? null;
  const counts = { all: groups.length, unpaid: 0, paid: 0, done: 0 };
  for (const g of groups) counts[g.state] += 1;
  const sentOn = (g: BuyerGroup) => (g.orders.every(o => o.prices_sent_at)
    ? new Date(g.orders.map(o => o.prices_sent_at!).sort().at(-1)!).toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short' })
    : null);
  const qrFor = (name: string) => (qrAction ? t(qrAction === 'share' ? 'claims_share_qr_for' : 'claims_copy_qr_for', { name: name.trim() }) : null);
  const archived = postOptions.filter(o => o.archived);
  const paidShare = totals.claimed > 0 ? totals.paid / totals.claimed : 0;
  const addButton = (
    <button type="button" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block" aria-haspopup="dialog" disabled={!photos.length} onClick={() => startAdd()}>
      <Icon name="plus" size={20} />{t('claims_add')}
    </button>
  );
  const steps = (
    <>
      <h2 className="ui-section-title claims-steps-title">{t('claims_how')}</h2>
      <ClaimSteps cards />
    </>
  );

  return (
    <div className="claims">
      <div className="claims-head">
        <h1 className="page-title">{t('nav_claims')}</h1>
        <button type="button" className="ui-btn" aria-haspopup="dialog" onClick={() => setHowOpen(true)}><Icon name="help" size={18} />{t('claims_how')}</button>
      </div>
      {loadError ? <p className="claims-load-error" role="alert">{t('ck_backend_error', { err: loadError })}</p> : null}

      {!postOptions.length ? (
        <div className="claims-layout is-empty">
          <div className="claims-side">
            <section className="ui-card claims-empty">
              <span className="claims-empty-icon" aria-hidden="true"><Icon name="chat" size={24} /></span>
              <h2 className="claims-empty-title">{t('claims_empty_title')}</h2>
              <p>{t('claims_no_posts_text')}</p>
              <Link to={{ page: 'posts' }} className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block">{t('claims_go_scanner')}</Link>
            </section>
          </div>
          <div className="claims-main">{steps}</div>
        </div>
      ) : (
        <div className={groups.length ? 'claims-layout' : 'claims-layout is-empty'}>
          <div className="claims-side">
            <Select label={t('claims_post')} value={activeKey ?? ''} onChange={e => onFolderChange(e.target.value)}>
              {postOptions.filter(o => !o.archived).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              {archived.length ? (
                <optgroup label={t('claims_archived')}>
                  {archived.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </optgroup>
              ) : null}
            </Select>
            {groups.length ? (
              <section className="ui-card claims-totals" aria-label={t('claims_to_collect')}>
                <div className="claims-totals-row">
                  <p className="claims-total">
                    <span className="claims-total-label">{t('claims_to_collect')}</span>
                    <span className="claims-big" aria-live="polite"><Money value={totals.toCollect} live={totals.live.toCollect} cents={cents} /></span>
                  </p>
                  <p className="claims-total is-paid">
                    <span className="claims-total-label">{t('claims_state_paid')}</span>
                    <span className="claims-paid" aria-live="polite"><Money value={totals.paid} live={totals.live.paid} cents={cents} /></span>
                  </p>
                </div>
                <div className="claims-bar" aria-hidden="true"><span style={{ width: `${Math.round(paidShare * 100)}%` }} /></div>
                <p className="claims-totals-meta">
                  {[counted(t, 'claims_buyers', groups.length), counted(t, 'claims_cards', totals.cards),
                    t('claims_claimed', { amount: `${totals.live.claimed ? '≈' : ''}${rm(totals.claimed, cents)}` })].join(' · ')}
                </p>
                {live ? <p className="claims-totals-meta">{t('claims_live_note')}</p> : null}
                {addButton}
                <div className="claims-totals-more">
                  <button type="button" className="ui-btn" aria-haspopup="dialog" onClick={() => setSlipsOpen(true)}><Icon name="print" size={18} />{t('claims_slips')}</button>
                  {live ? (
                    <button type="button" className="ui-btn" disabled={refreshing} onClick={refreshPrices}>
                      <Icon name="refresh" size={18} />{refreshing ? t('claims_refreshing') : t('claims_refresh')}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="ui-card claims-empty">
                <span className="claims-empty-icon" aria-hidden="true"><Icon name="chat" size={24} /></span>
                <h2 className="claims-empty-title">{t('claims_empty_title')}</h2>
                <p>{t('claims_empty_text')}</p>
                {addButton}
              </section>
            )}
          </div>

          <div className="claims-main">
            {groups.length ? (
              <>
                <div className="ui-section-head claims-buyers-head">
                  <h2 className="ui-section-title">{t('claims_buyers_title')} <span className="ui-count">· {groups.length.toLocaleString('en-MY')}</span></h2>
                  <label className="claims-sort">
                    <span>{t('claims_sort')}</span>
                    <span className="ui-select">
                      <select value={sort} onChange={e => setSort(e.target.value as ClaimSort)}>
                        {CLAIM_SORTS.map(s => <option key={s} value={s}>{t(`claims_sort_${s}`)}</option>)}
                      </select>
                      <Icon name="chevronUpDown" size={14} className="ui-select-icon" />
                    </span>
                  </label>
                </div>
                <Segmented
                  aria-label={t('claims_show')} className="claims-filter" value={filter} onChange={setFilter}
                  options={(['all', ...PAY_STATES] as const).map(s => ({
                    value: s,
                    label: <>{t(s === 'all' ? 'claims_filter_all' : `claims_state_${s}`)} <span className="claims-filter-n">{counts[s].toLocaleString('en-MY')}</span></>,
                  }))}
                />
                {shown.length ? (
                  <div className="claims-buyers">
                    {shown.map(g => (
                      <BuyerCard
                        key={g.buyerId} group={g} cents={cents} showPhotos={photos.length > 1}
                        isNew={!!newSince && !newSince.has(g.buyerId)} copied={copiedId === g.buyerId} qrLabel={qrFor(g.name)}
                        onOpen={() => setBuyerId(g.buyerId)} onCopy={() => copy(g)} onQr={sendQr} onMove={to => move(g, to)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="ui-card claims-none">{t(`claims_none_${filter}`)}</p>
                )}
              </>
            ) : steps}
          </div>
        </div>
      )}

      {pageDragging ? <div className="claims-drop" aria-hidden="true"><span><Icon name="plus" size={20} />{t('claims_drop_page')}</span></div> : null}
      <HowDialog open={howOpen} onClose={() => setHowOpen(false)} onAdd={photos.length ? () => startAdd() : undefined} />
      <AddComments
        key={session} open={addOpen} onClose={closeAdd} onSaved={added} incoming={incoming}
        photos={photos} postId={postId} postTitle={postTitle} claimedBy={claimedBy} settings={settings}
        credits={credits} onCredits={onCredits} onEnterVoucher={onEnterVoucher} lang={lang}
      />
      <BuyerDialog
        open={buyerId != null} onClose={() => setBuyerId(null)} group={buyer}
        message={buyer ? messageOf(buyer) : ''} cents={cents} live={live} sentOn={buyer ? sentOn(buyer) : null}
        hasPayment={!!payment && !!(payment.bank_name || payment.bank_account_number || payment.bank_account_holder || payment.payment_note)}
        qrLabel={qrAction ? t(qrAction === 'share' ? 'claims_share_qr' : 'claims_copy_qr') : null}
        onCopy={() => buyer && copy(buyer)} onQr={sendQr} onStatus={to => buyer && move(buyer, to)}
        onSavePhone={phone => (buyer ? savePhone(buyer, phone) : Promise.resolve(false))}
        onRemove={() => buyer && remove(buyer)} onResend={() => buyer && resend(buyer)}
      />
      <SlipsSheet
        open={slipsOpen} onClose={() => setSlipsOpen(false)} postTitle={postTitle}
        buyers={groups.map(g => ({ id: g.buyerId, name: g.name, phone: g.phone }))}
      />
      <SupportSheet open={supportOpen} onClose={() => setSupportOpen(false)} asking t={t} />
    </div>
  );
}
