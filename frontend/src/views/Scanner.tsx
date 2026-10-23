import { Icon } from '../components/Icon.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportAllImages, exportImage, frameCard, relookupScanPrices, type ExportAllImage, type ExportPayload, type Health } from '../api.ts';
import { listingsApi, postsApi, type Post } from '../api/checklist.ts';
import type { NavStore } from '../hooks/useNav.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import { migrateAdded } from '../lib/addedMarkers.ts';
import type { Batch, Candidate, PriceMode, Settings } from '../types.ts';
import { byPostOrder, computeCardData, downloadBlob, formatMyr, listingFields, lockPrices, matchThumbs, notAdded, PHOTO_SORTS, photoLabel, photoNumbers, sortPhotos, type PhotoSort } from '../utils.ts';
import { readStored, writeStored } from '../hooks/usePersistedState.ts';
import { POSTS, routeFolder, UNFILED } from '../routes.ts';

// One post's worth of scans in the gallery. `postId` null is the Unfiled group.
interface Folder {
  key: string;
  postId: number | null;
  title: string;
  archived: boolean;    // hidden from the posts list (shown under Archived) and from Claims
  items: BatchSummary[];
  needs: number;
  total: number;
}

import { ActiveBatchView } from '../components/ActiveBatchView.tsx';
import { AddAllChecklistModal } from '../components/AddAllChecklistModal.tsx';
import { useDialog } from '../components/DialogProvider.tsx';
import { PrintingsModal } from '../components/PrintingsModal.tsx';
import { PhotoTile, PostTile, summarise, type BatchSummary } from '../components/ScanGallery.tsx';
import { PricingRow } from '../components/SettingsPanel.tsx';
import { Breadcrumbs } from '../components/Breadcrumbs.tsx';
import { PricingPage } from './PricingPage.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { UploadZone } from '../components/UploadZone.tsx';
import type { T } from '../hooks/useLang.ts';

interface Props {
  // The tab is showing (both tabs stay mounted, so switching doesn't reload).
  active: boolean;
  scanner: ScannerStore;
  // Which post, photo or pricing page is open: the URL (see useNav).
  nav: NavStore;
  // Pricing per post and the default; pricingFor() prices every photo.
  pricing: PricingStore;
  health: Health | null;
  t: T;
  lang: string;
}

// Build the /api/export payload for one batch (shared by single-batch export and
// the bulk "Export all" zip). Returns null for batches that haven't finished
// scanning yet (no response).
function buildExportPayload(batch: Batch, settings: Settings): ExportPayload | null {
  if (!batch.response) return null;
  const cardData = computeCardData(batch, settings);
  // A live-price post's photo carries only the labels CK won't decide (see photoLabel).
  const live = settings.priceMode === 'live';
  // A card added by hand has no spot on the photo, so it gets no label there.
  const visible = cardData.filter(cd => !cd.removed && cd.card.bbox_source !== 'user' && (!live || photoLabel(cd, settings)));
  const data = batch.response;
  return {
    image_id: data.image_id,
    show_outlines: settings.showOutlines && !live,
    label_position: settings.labelPosition,
    font_scale: settings.labelFontScale,
    cards: visible.map(cd => {
      const label = photoLabel(cd, settings);
      return {
        bbox: cd.card.bbox,
        corners: cd.card.corners,
        is_foil: cd.isFoil && settings.foilStyle === 'gold',
        label_override: label,
      };
    }),
  };
}

export function Scanner({ active, scanner, nav: { route, go, replace, current }, pricing, health, t, lang }: Props) {
  const dialog = useDialog();
  const { pricingFor, listPosts, createPost } = pricing;
  const [printingsCtx, setPrintingsCtx] = useState<{ batchId: string; idx: number } | null>(null);

  // Posts double as the gallery's folders: every scan is filed under one (or
  // is unfiled), and that same post is where its cards go on the checklist.
  // Archived posts are loaded too so their photos don't fall into Unfiled.
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  // Once every saved photo has loaded, tie cards added by older versions
  // (remembered only on this device) to their photo on the server.
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || scanner.loadingSaved) return;
    migrated.current = true;
    migrateAdded(scanner.batches, scanner.markListed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.loadingSaved]);

  const refreshPosts = useCallback(async () => {
    try {
      setPosts(await listPosts());
    }
    catch { /* offline or auth error — ignore, picker just stays empty */ }
    setPostsLoaded(true);
  }, [listPosts]);

  useEffect(() => { refreshPosts(); }, [refreshPosts]);

  // Core add-all: push every visible, priced card of a batch that is not on
  // the checklist yet, each tied to the photo so deleting the photo takes it
  // off again. Returns how many cards failed.
  const addBatchCore = useCallback(async (batch: Batch, postId: number | null) => {
    if (!batch.response || batch.scanId == null) return 0;
    let failed = 0;
    for (const cd of notAdded(batch, computeCardData(batch, pricingFor(batch.postId)))) {
      try {
        await listingsApi.create({
          ...listingFields(cd),
          scan_id: batch.scanId,
          bbox: cd.card.bbox,
          post_ids: postId != null ? [postId] : [],
        });
        scanner.markListed(batch.id, cd.card.bbox);
      } catch (e) {
        console.error('Add failed for', cd.sel.name, e);
        failed += 1;
      }
    }
    return failed;
  }, [pricingFor, scanner.markListed]);

  const alertFailed = useCallback(async (failed: number) => {
    if (failed) await dialog.alert({ title: t('alert_error_title'), message: t('bulk_add_failed', { n: failed }) });
  }, [dialog, t]);

  // ---------- Finishing a photo ----------
  // Finish = the prices are final: they lock at what buyers will see (so
  // claims sell at them) and the cards go on the post. The priced image is a
  // separate step, downloaded or (on a phone) handed to the share sheet
  // (Facebook, WhatsApp, Save to Photos). Edit prices unlocks it again.
  const sharePhone = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
    && matchMedia('(pointer: coarse)').matches;
  // Images rendered and waiting for a tap: a phone only shares straight after
  // a tap, not after the wait to render them. key: the photo's or post's id.
  const [ready, setReady] = useState<{ key: string; files: File[] } | null>(null);
  const [finishing, setFinishing] = useState<string | null>(null);

  const renderImage = useCallback(async (batch: Batch): Promise<File | null> => {
    const payload = buildExportPayload(batch, pricingFor(batch.postId));
    if (!payload) return null;
    const name = numbered(batch).replace(/\.[^.]+$/, '') + '_priced.png';
    return new File([await exportImage(payload)], name, { type: 'image/png' });
  }, [pricingFor]);

  const deliver = useCallback((key: string, files: File[]) => {
    if (sharePhone && navigator.canShare({ files })) setReady({ key, files });
    else files.forEach(f => downloadBlob(f, f.name));
  }, [sharePhone]);

  const share = useCallback(async () => {
    if (!ready) return;
    try { await navigator.share({ files: ready.files }); setReady(null); } catch { /* cancelled: keep them ready */ }
  }, [ready]);

  // What Finish does, said once before the first time.
  const explainFinish = useCallback(async () => {
    if (readStored('mtg.finish.explained', false)) return true;
    const ok = await dialog.confirm({ title: t('finish_explain_title'), message: t('finish_explain_msg'), okLabel: t('finish_explain_ok') });
    if (ok) writeStored('mtg.finish.explained', true);
    return ok;
  }, [dialog, t]);

  // Lock a photo's prices (unless locked already) and put its cards on the
  // post. 'unpriced' (and nothing done) while a kept card has no price;
  // otherwise how many cards failed to add.
  const finishCore = useCallback(async (batch: Batch, postId: number | null): Promise<'unpriced' | number> => {
    const settings = pricingFor(batch.postId);
    // Live price: the cards go on the post; prices stay live until each buyer is sent theirs.
    if (settings.priceMode === 'live') return addBatchCore(batch, postId);
    const cards = computeCardData(batch, settings);
    if (cards.some(cd => !cd.removed && !(cd.unitPrice > 0))) return 'unpriced';
    if (!batch.lockedAt) scanner.lockBatch(batch.id, lockPrices(cards));
    return addBatchCore(batch, postId);
  }, [pricingFor, scanner.lockBatch, addBatchCore]);

  const failedAlert = useCallback(async (e: unknown) => {
    await dialog.alert({ title: t('alert_error_title'), message: t('finish_failed', { err: (e as Error).message }) });
  }, [dialog, t]);

  const finishPhoto = useCallback(async (batch: Batch) => {
    const live = pricingFor(batch.postId).priceMode === 'live';
    if (finishing || batch.scanId == null || (!live && !(await explainFinish()))) return;
    setFinishing(batch.id); setReady(null);
    try {
      const result = await finishCore(batch, batch.postId);
      if (result === 'unpriced') {
        await dialog.alert({ title: t('finish_needs_price_title'), message: t('finish_needs_price') });
        return;
      }
      await alertFailed(result);
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, pricingFor, explainFinish, finishCore, dialog, t, alertFailed, failedAlert]);

  // A finished photo's priced image, downloaded or shared whenever the seller
  // likes (now, later, again for a re-post): its prices stay locked.
  const deliverPhoto = useCallback(async (batch: Batch) => {
    if (finishing) return;
    setFinishing(batch.id); setReady(null);
    try {
      const file = await renderImage(batch);
      if (file) deliver(batch.id, [file]);
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, renderImage, deliver, failedAlert]);

  const editPrices = useCallback(async (batch: Batch) => {
    const ok = await dialog.confirm({ title: t('edit_prices_title'), message: t('edit_prices_msg'), okLabel: t('edit_prices_ok') });
    if (ok) { scanner.unlockBatch(batch.id); setReady(null); }
  }, [dialog, t, scanner.unlockBatch]);

  // Finish all of a post's photos. Unfiled photos ask which post first
  // (`finishTargets` holds them while that picker is open).
  const [finishTargets, setFinishTargets] = useState<{ key: string; batches: Batch[] } | null>(null);
  const runFinishAll = useCallback(async (key: string, targets: Batch[], postId: number | null) => {
    setFinishTargets(null);
    if (finishing || targets.length === 0) return;
    setFinishing(key); setReady(null);
    try {
      let failed = 0;
      const done: Batch[] = [];
      for (const b of targets) {
        const result = await finishCore(b, postId);
        if (result !== 'unpriced') { failed += result; done.push(b); }
      }
      await alertFailed(failed);
      if (done.length < targets.length) {
        await dialog.alert({ title: t('finish_needs_price_title'), message: t('finish_all_skipped', { n: targets.length - done.length }) });
      }
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, finishCore, alertFailed, dialog, t, failedAlert]);

  // The priced images of a post's finished photos: one zip on a PC, one share
  // on a phone.
  const deliverFolder = useCallback(async (key: string, batches: Batch[]) => {
    // In post order, so Facebook gets them (and the zip lists them) as Photo 1, 2, 3.
    // A photo-priced post sends only finished (locked) photos; a live one, all.
    const done = batches.filter(b => (b.lockedAt || pricingFor(b.postId).priceMode === 'live') && b.response).sort(byPostOrder);
    if (finishing || !done.length) return;
    setFinishing(key); setReady(null);
    try {
      if (sharePhone) {
        const files: File[] = [];
        for (const b of done) { const f = await renderImage(b); if (f) files.push(f); }
        deliver(key, files);
      } else {
        const images = done
          .map(b => { const p = buildExportPayload(b, pricingFor(b.postId)); return p ? { ...p, filename: numbered(b) } as ExportAllImage : null; })
          .filter((x): x is ExportAllImage => x !== null);
        downloadBlob(await exportAllImages(images), 'mtg_prices.zip');
      }
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, sharePhone, renderImage, deliver, pricingFor, failedAlert]);

  // Re-fetch CK prices for an already-saved scan. Cheap on the backend
  // (local SQLite lookups, no Gemini, no network out). Returns the updated
  // cards array which we swap into the batch's response in-place so user
  // overrides (manual prices, foil toggles, qty) survive untouched.
  const refreshScanPrices = useCallback(async (batch: Batch) => {
    if (batch.scanId == null) return;
    try {
      const result = await relookupScanPrices(batch.scanId);
      scanner.replaceAllCards(batch.id, result.cards);
    } catch (e) {
      await dialog.alert({
        title: t('alert_error_title'),
        message: 'Refresh failed: ' + (e as Error).message,
      });
    }
  }, [scanner, dialog, t]);

  // ---------- Gallery navigation ----------
  // Three levels: all posts → one post's photos → one photo, each with its
  // own URL (see useNav).
  const folderKey = route.page === 'post' || route.page === 'photo' || route.page === 'pricing' ? route.folder : null;
  // The open photo, found by its scan id: a photo scanned this session keeps
  // its own batch id, so the URL names the scan.
  const activeBatch = route.page === 'photo' ? (scanner.batches.find(b => b.scanId === route.scanId) ?? null) : null;
  const photoId = activeBatch?.id ?? null;
  // The photos Prev/Next step through, fixed when a photo is opened so the
  // order doesn't shift under you as you fix things.
  const [navIds, setNavIds] = useState<string[]>([]);
  const [sort, setSort] = useState<PhotoSort>('post');
  const [reordering, setReordering] = useState(false);
  // "Photo N" for every saved photo: its place in its post's order.
  const numbers = useMemo(() => photoNumbers(scanner.batches), [scanner.batches]);
  const numbered = (b: Batch, n = numbers.get(b.id)) => (n != null ? `${String(n).padStart(2, '0')}_${b.filename}` : b.filename);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const postsById = useMemo(() => new Map(posts.map(p => [p.id, p])), [posts]);
  const pickerPosts = useMemo(() => posts.filter(p => p.status !== 'archived'), [posts]);
  const postTitle = useCallback(
    (p: Post) => p.title || `#${p.id}`,
    [],
  );

  const folders = useMemo<Folder[]>(() => {
    const byKey = new Map<string, Folder>();
    for (const b of scanner.batches) {
      const post = b.postId != null ? postsById.get(b.postId) : undefined;
      const key = post ? `p${post.id}` : UNFILED;
      let f = byKey.get(key);
      if (!f) {
        f = {
          key, postId: post?.id ?? null, title: post ? postTitle(post) : t('scans_unfiled'),
          archived: post?.status === 'archived', items: [], needs: 0, total: 0,
        };
        byKey.set(key, f);
      }
      const sum = summarise(b, pricingFor(b.postId));
      f.items.push(sum);
      f.needs += sum.needs;
      f.total += sum.total;
    }
    // Newest activity first; a post that is still scanning counts as newest.
    const newest = (f: Folder) => Math.max(...f.items.map(i => i.batch.scanId ?? Infinity));
    return [...byKey.values()].sort((a, b) => newest(b) - newest(a));
  }, [scanner.batches, postsById, postTitle, pricingFor, t]);

  // The open post. It may have no photos yet (just created, or all deleted).
  const openFolder = useMemo<Folder | null>(() => {
    if (folderKey == null) return null;
    const found = folders.find(f => f.key === folderKey);
    if (found) return found;
    if (folderKey === UNFILED) return { key: UNFILED, postId: null, title: t('scans_unfiled'), archived: false, items: [], needs: 0, total: 0 };
    const post = postsById.get(Number(folderKey.slice(1)));
    return post
      ? { key: folderKey, postId: post.id, title: postTitle(post), archived: post.status === 'archived', items: [], needs: 0, total: 0 }
      : null;
  }, [folderKey, folders, postsById, postTitle, t]);

  // A remembered post that no longer exists (deleted on the checklist): go
  // back to the list rather than show an empty screen.
  useEffect(() => {
    if (folderKey != null && postsLoaded && !scanner.loadingSaved && !openFolder && photoId == null) {
      replace(POSTS);
    }
  }, [folderKey, postsLoaded, scanner.loadingSaved, openFolder, photoId, replace]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((s: BatchSummary) => !q || s.haystack.includes(q), [q]);
  const folderLive = openFolder != null && pricingFor(openFolder.postId).priceMode === 'live';
  const visibleItems = useMemo(
    () => sortPhotos((openFolder?.items ?? []).filter(matches), sort),
    [openFolder, matches, sort],
  );
  // The open post's saved photos in post order, for reordering.
  const postOrdered = useMemo(
    () => (openFolder?.items ?? []).map(s => s.batch).filter(b => b.scanId != null).sort(byPostOrder),
    [openFolder],
  );
  const moveInOrder = useCallback(async (i: number, by: -1 | 1) => {
    const ids = postOrdered.map(b => b.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    try { await scanner.orderBatches(ids); } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [postOrdered, scanner.orderBatches, dialog, t]);
  // Leaving the post ends reordering.
  useEffect(() => { setReordering(false); }, [folderKey]);
  // The posts list leaves archived posts out; they wait in their own section.
  const liveFolders = useMemo(() => folders.filter(f => !f.archived), [folders]);
  const archivedFolders = useMemo(() => folders.filter(f => f.archived), [folders]);
  const [showArchived, setShowArchived] = useState(false);

  const postGrid = (list: Folder[]) => (
    <div className="gallery-grid">
      {list.map(f => (
        <PostTile
          key={f.key}
          title={f.title}
          covers={f.items.flatMap(i => (i.batch.response ? [i.batch.response.thumb_url ?? i.batch.response.image_b64] : []))}
          photos={f.items.length}
          needs={f.items.filter(i => i.needs > 0).length}
          pending={f.items.filter(i => i.pending > 0).length}
          total={f.total}
          settings={pricingFor(f.postId)}
          t={t}
          to={{ page: 'post', folder: f.key }}
        />
      ))}
    </div>
  );

  const goTo = useCallback((key: string) => go({ page: 'post', folder: key }), [go]);

  // Another post (opened, or come back to through history) starts unfiltered.
  useEffect(() => {
    setQuery('');
    setSelecting(false);
    setSelected(new Set());
  }, [folderKey]);

  // The tile is a link to the photo; this keeps the order it was opened in.
  const openPhoto = useCallback((ids: string[]) => {
    setNavIds(ids);
    setSelecting(false);
    window.scrollTo({ top: 0 });
  }, []);

  // A photo URL with no such photo (deleted, or not this user's), once every
  // saved photo has loaded: its post takes the entry's place.
  useEffect(() => {
    if (route.page === 'photo' && !activeBatch && !scanner.loadingSaved) replace({ page: 'post', folder: route.folder });
  }, [route, activeBatch, scanner.loadingSaved, replace]);

  // Reached through history (or a reload) rather than a tile, a photo steps
  // through its post in gallery order.
  const stepIds = photoId != null && navIds.includes(photoId) ? navIds : (openFolder?.items.map(s => s.batch.id) ?? []);
  // Only a saved photo has a page of its own.
  const liveNavIds = stepIds.filter(id => scanner.batches.some(b => b.id === id && b.scanId != null));
  const navIndex = photoId ? liveNavIds.indexOf(photoId) : -1;
  const step = useCallback((delta: number) => {
    const next = scanner.batches.find(b => b.id === liveNavIds[navIndex + delta]);
    if (next?.scanId != null && folderKey != null) { replace({ page: 'photo', folder: folderKey, scanId: next.scanId }); window.scrollTo({ top: 0 }); }
  }, [liveNavIds, navIndex, replace, scanner.batches, folderKey]);

  // Warm the cache with the next and previous photos' match images, so a step shows them at once.
  const neighbourThumbs = (navIndex < 0 ? [] : [liveNavIds[navIndex - 1], liveNavIds[navIndex + 1]])
    .flatMap(id => { const b = scanner.batches.find(x => x.id === id); return b ? matchThumbs(b) : []; })
    .join('\n');
  useEffect(() => {
    for (const src of neighbourThumbs.split('\n')) if (src) new Image().src = src;
  }, [neighbourThumbs]);

  // Keyboard shortcuts (never while typing in a field, or under a dialog):
  //   one photo   ← / → previous / next photo, Esc back to the post
  //   a post      arrows move between tiles (Enter opens), Esc back to posts
  //   a post      / jumps to its search
  // Only while this tab is showing: the Claims tab is mounted beside it.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector('.dlg-shade, .modal.open, .zoom-modal.open, .feedback-overlay, .modal-shade, .preview-cell.expanded, .menu-popover')) return;

      if (photoId != null) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        else if (e.key === 'Escape' && folderKey != null) go({ page: 'post', folder: folderKey });
        return;
      }
      if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('.scan-search input');
        if (search) { e.preventDefault(); search.focus(); }
        return;
      }
      if (e.key === 'Escape' && folderKey != null) {
        if (selecting) { setSelecting(false); setSelected(new Set()); }
        else go(POSTS);
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('.gallery-grid .scan-tile'));
      if (!tiles.length) return;
      const at = tiles.indexOf(document.activeElement as HTMLElement);
      // Tiles sharing the first one's top edge make up a row.
      const cols = tiles.filter(tile => tile.offsetTop === tiles[0].offsetTop).length || 1;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key] ?? 0;
      const next = at < 0 ? 0 : at + delta;
      if (next < 0 || next >= tiles.length) return;
      e.preventDefault();
      tiles[next].focus();
      tiles[next].scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, photoId, step, folderKey, selecting, go]);

  // Swipe left/right on the photo's header to step, like a photo roll. Kept
  // to the header so it can't fight dragging a price pill or scrolling a row.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // New photos: inside a post they join it; from the top level a drop starts
  // a new post named for the moment, of the kind picked above the drop area
  // (the default pricing's kind unless the seller picks the other), and opens it.
  const defaultType = pricingFor(null).priceMode;
  const [pickedType, setPickedType] = useState<PriceMode | null>(null);
  const newType = pickedType ?? defaultType;
  const startPost = useCallback(async (files: File[], priceMode: PriceMode) => {
    let postId: number | null = null;
    try {
      const title = new Date().toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      });
      const post = await createPost({ title }, priceMode);
      postId = post.id;
      await refreshPosts();
    } catch { /* couldn't create the post: the photos are still scanned, unfiled */ }
    scanner.addFiles(files, postId);
    goTo(postId != null ? `p${postId}` : UNFILED);
  }, [scanner, lang, refreshPosts, goTo, createPost]);
  const onFiles = useCallback(async (files: File[]) => {
    if (openFolder) scanner.addFiles(files, openFolder.postId);
    else startPost(files, newType);
  }, [openFolder, scanner, startPost, newType]);

  const moveTo = useCallback(async (ids: string[], postId: number | null) => {
    try {
      await scanner.moveBatches(ids, postId);
    } catch {
      await dialog.alert({ title: t('alert_error_title'), message: t('scans_move_failed') });
    }
  }, [scanner, dialog, t]);

  const deletePhotos = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const ok = await dialog.confirm({
      title: ids.length === 1 ? t('scans_delete_title_one') : t('scans_delete_title', { n: ids.length }),
      message: t('scans_delete_msg'),
      okLabel: t('scans_delete'),
      destructive: true,
    });
    if (!ok) return;
    // Deleting the open photo: its post takes the entry's place, so none is
    // left for it. Asked after the confirm: the user may have moved on.
    const cur = current();
    if (cur.page === 'photo' && ids.some(id => scanner.batches.find(b => b.id === id)?.scanId === cur.scanId)) {
      replace({ page: 'post', folder: cur.folder });
    }
    for (const id of ids) await scanner.removeBatch(id);
    setSelected(new Set());
    setSelecting(false);
  }, [dialog, scanner, current, replace, t]);

  // Renaming a post: click its name on the post page and type. Enter or
  // clicking away saves, Esc cancels. null = not editing.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const saveTitle = useCallback(async (folder: Folder) => {
    const title = (titleDraft ?? '').trim();
    setTitleDraft(null);
    if (folder.postId == null || !title || title === folder.title) return;
    // Show the new name at once; put the old one back if the server says no.
    setPosts(prev => prev.map(p => (p.id === folder.postId ? { ...p, title } : p)));
    try {
      await postsApi.update(folder.postId, { title });
    } catch (e) {
      await refreshPosts();
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [titleDraft, dialog, refreshPosts, t]);

  // Archiving hides a post without losing anything; unarchiving brings it back.
  const setArchived = useCallback(async (folder: Folder, archived: boolean) => {
    if (folder.postId == null) return;
    const status = archived ? 'archived' : 'active';
    setPosts(prev => prev.map(p => (p.id === folder.postId ? { ...p, status } : p)));
    try {
      await postsApi.update(folder.postId, { status });
      // Still on the post: the user may have left it meanwhile.
      if (archived && routeFolder(current()) === folder.key) go(POSTS);
    } catch (e) {
      await refreshPosts();
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [dialog, refreshPosts, current, go, t]);

  // Deleting a post takes its photos with it. The server refuses while any
  // of its cards are still claimed, so no buyer's claim is lost silently.
  const deletePost = useCallback(async (folder: Folder) => {
    if (folder.postId == null) return;
    const ok = await dialog.confirm({
      title: t('scans_delete_post'),
      message: t('scans_delete_post_msg', {
        name: folder.title,
        photos: folder.items.length === 1 ? t('scans_photo_one') : t('scans_photos', { n: folder.items.length }),
      }),
      okLabel: t('scans_delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await postsApi.remove(folder.postId);
    } catch (e) {
      const err = e as Error & { status?: number };
      await dialog.alert({ title: t('alert_error_title'), message: err.status === 409 ? t('scans_delete_post_claimed') : err.message });
      return;
    }
    for (const s of folder.items) await scanner.removeBatch(s.batch.id);
    if (routeFolder(current()) === folder.key) replace(POSTS);
    await refreshPosts();
  }, [dialog, scanner, current, replace, refreshPosts, t]);

  const finishFolder = useCallback(async (folder: Folder) => {
    const targets = folder.items.map(s => s.batch).filter(b => b.response && b.scanId != null);
    if (targets.length === 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('bulk_add_all_none') });
      return;
    }
    const live = pricingFor(folder.postId).priceMode === 'live';
    if (!live && !(await explainFinish())) return;
    if (folder.postId == null) { setFinishTargets({ key: folder.key, batches: targets }); return; }
    const ok = await dialog.confirm({
      title: t(live ? 'live_add_all_title' : 'finish_all_confirm_title'),
      message: t(live ? 'live_add_all_msg' : 'finish_all_confirm_msg', { n: targets.length, post: folder.title }),
      okLabel: t(live ? 'live_add_all' : 'finish_all_confirm_ok'),
    });
    if (ok) runFinishAll(folder.key, targets, folder.postId);
  }, [dialog, pricingFor, explainFinish, runFinishAll, t]);

  const onBrowsePrintings = (idx: number) => {
    if (!activeBatch) return;
    setPrintingsCtx({ batchId: activeBatch.id, idx });
  };

  // A card the scan missed: the seller names it, picks its version, then
  // drags its price label onto it (the label starts in the middle of the photo).
  const addMissingCard = useCallback(async (batch: Batch) => {
    if (batch.scanId == null || !batch.response) return;
    const name = await dialog.prompt({ title: t('add_card_title'), message: t('add_card_msg'), placeholder: 'Sol Ring', okLabel: t('add_card_ok') });
    if (!name?.trim()) return;
    const { width: w, height: h } = batch.response;
    const cw = Math.round(Math.min(w, h) * 0.18), ch = Math.round(cw * 1.395);
    const x = Math.round((w - cw) / 2), y = Math.round((h - ch) / 2);
    try {
      const card = await frameCard(batch.scanId, [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]], true);
      const idx = batch.response.cards.length;
      scanner.appendFramedCard(batch.id, card);
      await scanner.relookupByName(batch.id, idx, name, t);
      await dialog.alert({ title: t('add_card_title'), message: t('add_card_next') });
      setPrintingsCtx({ batchId: batch.id, idx });
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [dialog, scanner, t]);

  const onPickPrinting = (printing: Candidate) => {
    if (!printingsCtx) return;
    scanner.replaceCandidate(printingsCtx.batchId, printingsCtx.idx, {
      ...printing,
      _lookup_failed: false,
      _manual: false,
    });
    // The seller chose this printing, so the "check the version" notice is answered.
    scanner.confirmVersion(printingsCtx.batchId, printingsCtx.idx);
    scanner.setRelookupMsg(printingsCtx.batchId, printingsCtx.idx, {
      type: 'ok',
      text: t('modal_switched', { name: printing.set_name || printing.set || '' }),
    });
    setPrintingsCtx(null);
  };

  const printingsBatch = printingsCtx ? scanner.batches.find(b => b.id === printingsCtx.batchId) : undefined;
  const printingsCardName = (() => {
    if (!printingsCtx) return '';
    const b = scanner.batches.find(b => b.id === printingsCtx.batchId);
    return b?.response?.cards[printingsCtx.idx]?.candidates[0]?.name || '';
  })();

  const printingsCurrentSid = (() => {
    if (!printingsCtx) return '';
    const b = scanner.batches.find(b => b.id === printingsCtx.batchId);
    return b?.response?.cards[printingsCtx.idx]?.candidates[0]?.scryfall_id || '';
  })();

  const loading = (scanner.loadingSaved || !postsLoaded) && scanner.batches.length === 0;
  const progress = scanner.scanProgress ? (
    <div className="scan-progress">
      <div
        className="scan-progress-track"
        role="progressbar"
        aria-label={t('scan_progress', scanner.scanProgress)}
        aria-valuemin={0}
        aria-valuemax={scanner.scanProgress.total}
        aria-valuenow={scanner.scanProgress.done}
      >
        <div
          className="scan-progress-fill"
          style={{ width: `${(scanner.scanProgress.done / scanner.scanProgress.total) * 100}%` }}
        />
      </div>
      <span className="scan-progress-label" aria-live="polite">
        {t('scan_progress', scanner.scanProgress)}
      </span>
    </div>
  ) : null;
  const searchField = (
    <label className="scan-search">
      <Icon name="search" size={18} />
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('scans_search')}
        aria-label={t('scans_search')}
      />
    </label>
  );
  const upload = (
    <UploadZone
      active={active}
      onFiles={onFiles}
      t={t}
      compact={openFolder != null}
    >
      {openFolder ? null : (
        <div className="post-type-row new-post-type">
          <span className="post-type-label">{t('post_type_title')}</span>
          <div className="segmented" role="group" aria-label={t('post_type_title')}>
            {(['photo', 'live'] as const).map(mode => (
              <button key={mode} type="button" className={newType === mode ? 'active' : ''} aria-pressed={newType === mode} onClick={() => setPickedType(mode)}>
                {t(`post_type_${mode}`)}
                {mode === defaultType ? <span className="post-type-default">{t('post_type_default')}</span> : null}
              </button>
            ))}
          </div>
          <p>{t(`post_type_${newType}_desc`)}</p>
        </div>
      )}
    </UploadZone>
  );
  // A post's pricing (for unfiled photos, the default itself): its summary,
  // linking to its page. Shown once that pricing is known.
  const pricingTitle = (folder: Folder) => (folder.postId == null ? t('menu_default_pricing') : t('settings_title'));
  const pricingPanel = (folder: Folder) => pricing.pricingKnown(folder.postId) && (
    <PricingRow title={pricingTitle(folder)} settings={pricingFor(folder.postId)} t={t} to={{ page: 'pricing', folder: folder.key }} />
  );

  return (
    <>
      {activeBatch ? (
        /* ---------- One photo ---------- */
        <section>
          <div
            className="photo-nav"
            onTouchStart={e => { swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
            onTouchEnd={e => {
              const from = swipeStart.current; swipeStart.current = null;
              if (!from) return;
              const dx = e.changedTouches[0].clientX - from.x;
              const dy = e.changedTouches[0].clientY - from.y;
              if (Math.abs(dx) > 60 && Math.abs(dy) < 40) step(dx < 0 ? 1 : -1);
            }}
          >
            <Breadcrumbs items={[
              { label: t('scans_title'), to: POSTS },
              ...(openFolder ? [{ label: openFolder.title, to: { page: 'post' as const, folder: openFolder.key } }] : []),
              { label: numbers.has(activeBatch.id)
                ? t('crumbs_photo', { n: numbers.get(activeBatch.id)!, total: [...numbers.keys()].filter(id => scanner.batches.find(b => b.id === id)?.postId === activeBatch.postId).length })
                : t('crumbs_photo_one') },
            ]} />
            <span className="photo-nav-steps">
              <button
                type="button" className="round-btn"
                aria-label={t('scans_prev')} title={`${t('scans_prev')} (←)`}
                disabled={navIndex <= 0}
                onClick={() => step(-1)}
              ><Icon name="chevronLeft" size={18} /></button>
              <button
                type="button" className="round-btn"
                aria-label={t('scans_next')} title={`${t('scans_next')} (→)`}
                disabled={navIndex < 0 || navIndex >= liveNavIds.length - 1}
                onClick={() => step(1)}
              ><Icon name="chevronRight" size={18} /></button>
              <button
                type="button" className="round-btn destructive"
                aria-label={t('scans_delete_photo')} title={t('scans_delete_photo')}
                onClick={() => deletePhotos([activeBatch.id])}
              ><Icon name="trash" size={18} /></button>
            </span>
          </div>
          <ActiveBatchView
            photoNumber={numbers.get(activeBatch.id) ?? null}
            live={pricingFor(activeBatch.postId).priceMode === 'live'}
            batch={activeBatch}
            settings={pricingFor(activeBatch.postId)}
            scanner={scanner}
            t={t}
            onBrowsePrintings={onBrowsePrintings}
            postTitle={activeBatch.postId != null && postsById.has(activeBatch.postId) ? postTitle(postsById.get(activeBatch.postId)!) : null}
            sharePhone={sharePhone}
            busy={finishing === activeBatch.id}
            shareReady={ready?.key === activeBatch.id ? ready.files.length : 0}
            onFinish={() => finishPhoto(activeBatch)}
            onDeliver={() => deliverPhoto(activeBatch)}
            onShare={share}
            onEditPrices={() => editPrices(activeBatch)}
            onRefreshPrices={() => refreshScanPrices(activeBatch)}
            onAddCard={() => addMissingCard(activeBatch)}
          />
          {/* The same previous / next as the top, so a long card list needn't scroll back. */}
          <nav className="photo-steps-bottom" aria-label={t('scans_title')}>
            {(['prev', 'next'] as const).map(dir => {
              const at = navIndex + (dir === 'prev' ? -1 : 1);
              const id = navIndex >= 0 ? liveNavIds[at] : undefined;
              const n = id ? numbers.get(id) : undefined;
              return (
                <button key={dir} type="button" className={`photo-step ${dir}`} disabled={!id} onClick={() => step(dir === 'prev' ? -1 : 1)}>
                  {dir === 'prev' ? <Icon name="chevronLeft" size={18} /> : null}
                  <span>
                    <span className="photo-step-dir">{t(dir === 'prev' ? 'scans_prev' : 'scans_next')}</span>
                    {n ? <strong>{t('photo_n', { n })}</strong> : null}
                  </span>
                  {dir === 'next' ? <Icon name="chevronRight" size={18} /> : null}
                </button>
              );
            })}
          </nav>
        </section>
      ) : route.page === 'pricing' && openFolder ? (
        /* ---------- A post's pricing ---------- */
        <PricingPage
          postId={openFolder.postId}
          title={pricingTitle(openFolder)}
          crumbs={[{ label: t('scans_title'), to: POSTS }, { label: openFolder.title, to: { page: 'post', folder: openFolder.key } }, { label: t('crumbs_pricing') }]}
          pricing={pricing}
          health={health}
          t={t}
        />
      ) : openFolder ? (
        /* ---------- One post's photos ---------- */
        <>
          <div className="photo-nav">
            <Breadcrumbs items={[{ label: t('scans_title'), to: POSTS }, { label: openFolder.title }]} />
          </div>
          <div className="review-head">
            <div className={`review-title post-title ${titleDraft != null ? 'is-editing' : ''}`}>
              {openFolder.postId == null ? (
                <h2>{openFolder.title}</h2>
              ) : titleDraft != null ? (
                <input
                  className="title-edit"
                  type="text"
                  value={titleDraft}
                  aria-label={t('scans_rename_title')}
                  maxLength={255}
                  autoFocus
                  onFocus={e => e.target.select()}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => saveTitle(openFolder)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); saveTitle(openFolder); }
                    if (e.key === 'Escape') { e.preventDefault(); setTitleDraft(null); }
                  }}
                />
              ) : (
                <h2>
                  <button
                    type="button" className="title-btn"
                    title={t('scans_rename')}
                    onClick={() => setTitleDraft(openFolder.title)}
                  >
                    <span>{openFolder.title}</span>
                    <Icon name="edit" size={16} />
                  </button>
                </h2>
              )}
            </div>
            {openFolder.total > 0 ? (
              <span className="all-scans-total">
                <span className="label">{openFolder.items.length === 1 ? t('scans_photo_one') : t('scans_photos', { n: openFolder.items.length })}</span>
                <span className="value">{formatMyr(openFolder.total, pricingFor(openFolder.postId))}</span>
              </span>
            ) : null}
            {openFolder.items.some(s => s.batch.response) || openFolder.postId != null ? (
              <span className="review-actions">
                {ready?.key === openFolder.key ? (
                  <button className="accent" onClick={share}>
                    <Icon name="share" size={18} />{t('share_n_photos', { n: ready.files.length })}
                  </button>
                ) : (
                  <>
                    {folderLive ? (
                      openFolder.items.some(s => s.pending > 0) ? (
                        <button className="accent" disabled={finishing != null} onClick={() => finishFolder(openFolder)}>
                          <Icon name="addList" size={18} />{finishing === openFolder.key ? t('finish_busy') : t('live_add_all')}
                        </button>
                      ) : null
                    ) : openFolder.items.some(s => s.batch.response && !s.batch.lockedAt) ? (
                      <button className="accent" disabled={finishing != null} onClick={() => finishFolder(openFolder)}>
                        <Icon name="lock" size={18} />{finishing === openFolder.key ? t('finish_busy') : t('finish_all')}
                      </button>
                    ) : null}
                    {(folderLive ? openFolder.items.some(s => s.batch.response) : openFolder.items.some(s => s.batch.lockedAt)) ? (
                      <button disabled={finishing != null} onClick={() => deliverFolder(openFolder.key, openFolder.items.map(s => s.batch))}>
                        <Icon name={sharePhone ? 'share' : 'download'} size={18} />{t(sharePhone ? 'share_all' : 'download_all')}
                      </button>
                    ) : null}
                  </>
                )}
                {openFolder.postId != null ? (
                  <>
                    <button className="ghost" onClick={() => setArchived(openFolder, !openFolder.archived)}>
                      <Icon name="archive" size={18} />{openFolder.archived ? t('scans_unarchive') : t('scans_archive')}
                    </button>
                    <button className="ghost destructive" onClick={() => deletePost(openFolder)}>
                      <Icon name="trash" size={18} />{t('scans_delete_post')}
                    </button>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          {openFolder.archived ? (
            <p className="archived-note"><Icon name="archive" size={16} />{t('scans_archived_note')}</p>
          ) : null}
          {upload}
          {pricingPanel(openFolder)}
          {progress}
          <h3 className="level-label">
            {t('scans_photos_label')}{openFolder.items.length ? <span className="meta"> · {openFolder.items.length}</span> : null}
          </h3>
          {openFolder.items.length > 0 ? (
            <div className="gallery-bar">
              {selecting ? (
                <>
                  <span className="gallery-bar-count">{t('scans_n_selected', { n: selected.size })}</span>
                  <select
                    className="gallery-move"
                    value=""
                    disabled={selected.size === 0}
                    aria-label={t('scans_move_to')}
                    onChange={async e => {
                      const v = e.target.value;
                      if (!v) return;
                      await moveTo([...selected], v === UNFILED ? null : Number(v));
                      setSelected(new Set());
                      setSelecting(false);
                    }}
                  >
                    <option value="">{t('scans_move_to')}</option>
                    {pickerPosts.filter(p => p.id !== openFolder.postId).map(p => (
                      <option key={p.id} value={p.id}>{postTitle(p)}</option>
                    ))}
                    {openFolder.postId != null ? <option value={UNFILED}>{t('scans_unfiled')}</option> : null}
                  </select>
                  <button className="destructive" disabled={selected.size === 0} onClick={() => deletePhotos([...selected])}>
                    <Icon name="trash" size={18} />{t('scans_delete')}
                  </button>
                  <button className="ghost" onClick={() => { setSelecting(false); setSelected(new Set()); }}>{t('scans_select_done')}</button>
                </>
              ) : (
                <>
                  {searchField}
                  <select className="gallery-sort" value={sort} aria-label={t('scans_sort')} onChange={e => setSort(e.target.value as PhotoSort)}>
                    {(Object.keys(PHOTO_SORTS) as PhotoSort[]).map(k => (
                      <option key={k} value={k}>{t(`scans_sort_${k}`)}</option>
                    ))}
                  </select>
                  <InfoTip label={t('post_order_info_title')} text={t('post_order_info')} />
                  <button className="ghost" onClick={() => setReordering(true)}>{t('scans_reorder')}</button>
                  <button className="ghost" onClick={() => setSelecting(true)}>{t('scans_select')}</button>
                </>
              )}
            </div>
          ) : null}
          {reordering ? (
            /* Post order as a list: move a photo up or down, saved at once. */
            <div className="reorder-list">
              <p className="claims-hint">{t('scans_reorder_hint')}</p>
              {postOrdered.map((b, i) => (
                <div className="reorder-row" key={b.id}>
                  <span className="reorder-num">{i + 1}</span>
                  {b.response ? <img src={b.response.thumb_url ?? b.response.image_b64} alt="" /> : null}
                  <span className="reorder-name">
                    <strong>{t('photo_n', { n: i + 1 })}</strong>
                    <span>{b.filename}</span>
                  </span>
                  <button type="button" className="round-btn" aria-label={t('scans_move_up')} disabled={i === 0} onClick={() => moveInOrder(i, -1)}>
                    <Icon name="chevronUp" size={18} />
                  </button>
                  <button type="button" className="round-btn" aria-label={t('scans_move_down')} disabled={i === postOrdered.length - 1} onClick={() => moveInOrder(i, 1)}>
                    <Icon name="chevronDown" size={18} />
                  </button>
                </div>
              ))}
              <div className="claims-actions">
                <span className="spacer" />
                <button type="button" className="accent" onClick={() => setReordering(false)}>{t('scans_select_done')}</button>
              </div>
            </div>
          ) : openFolder.items.length === 0 ? (
            <p className="gallery-empty">{t('scans_empty_post')}</p>
          ) : visibleItems.length === 0 ? (
            <p className="gallery-empty">{q ? t('scans_no_matches') : t('scans_none_to_fix')}</p>
          ) : (
            <div className="gallery-grid">
              {visibleItems.map(s => (
                <PhotoTile
                  key={s.batch.id}
                  summary={s}
                  number={numbers.get(s.batch.id) ?? null}
                  settings={pricingFor(s.batch.postId)}
                  t={t}
                  selecting={selecting}
                  selected={selected.has(s.batch.id)}
                  to={s.batch.scanId != null ? { page: 'photo', folder: openFolder.key, scanId: s.batch.scanId } : null}
                  onOpen={() => openPhoto(visibleItems.map(v => v.batch.id))}
                  onToggle={() => setSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(s.batch.id)) next.delete(s.batch.id); else next.add(s.batch.id);
                    return next;
                  })}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        /* ---------- All posts ---------- */
        <>
          {upload}
          {progress}
          {loading ? (
            <Spinner label={t('scanner_loading_saved')} />
          ) : liveFolders.length === 0 && archivedFolders.length === 0 ? (
            <p className="gallery-empty">{t('scans_empty')}</p>
          ) : (
            <>
              <div className="review-head">
                <div className="review-title"><h2>{t('scans_title')}</h2></div>
              </div>
              {liveFolders.length ? postGrid(liveFolders) : <p className="gallery-empty">{t('scans_empty')}</p>}
              {archivedFolders.length ? (
                <>
                  <button
                    type="button" className="ghost archived-toggle"
                    aria-expanded={showArchived} onClick={() => setShowArchived(v => !v)}
                  >
                    <Icon name="archive" size={18} />
                    {t('scans_archived')} · {archivedFolders.length}
                    <Icon name={showArchived ? 'chevronDown' : 'chevronRight'} size={16} />
                  </button>
                  {showArchived ? postGrid(archivedFolders) : null}
                </>
              ) : null}
            </>
          )}
        </>
      )}


      {finishTargets && (
        <AddAllChecklistModal
          count={finishTargets.batches.length}
          posts={pickerPosts}
          onClose={() => setFinishTargets(null)}
          onConfirm={(postId) => runFinishAll(finishTargets.key, finishTargets.batches, postId)}
          t={t}
        />
      )}

      <PrintingsModal
        open={!!printingsCtx}
        cardName={printingsCardName}
        currentSid={printingsCurrentSid}
        onClose={() => setPrintingsCtx(null)}
        onSelect={onPickPrinting}
        busy={!!printingsBatch?.relookupBusy[printingsCtx!.idx]}
        msg={printingsBatch?.relookupMsg[printingsCtx!.idx] ?? null}
        onFind={name => printingsCtx && scanner.relookupByName(printingsCtx.batchId, printingsCtx.idx, name, t)}
        onUseAsIs={name => { if (printingsCtx) { scanner.useAsIs(printingsCtx.batchId, printingsCtx.idx, name, t); setPrintingsCtx(null); } }}
        t={t}
      />
    </>
  );
}
