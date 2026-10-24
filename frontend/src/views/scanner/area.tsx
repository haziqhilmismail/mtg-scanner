import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportAllImages, exportImage, relookupScanPrices, type ExportAllImage, type ExportPayload, type Health } from '../../api.ts';
import { listingsApi, postsApi, type Post } from '../../api/checklist.ts';
import { useDialog } from '../../components/DialogProvider.tsx';
import { summarise, type BatchSummary } from '../../components/ScanGallery.tsx';
import type { T } from '../../hooks/useLang.ts';
import type { NavStore } from '../../hooks/useNav.ts';
import { readStored, writeStored } from '../../hooks/usePersistedState.ts';
import type { PricingStore } from '../../hooks/usePricing.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';
import { migrateAdded } from '../../lib/addedMarkers.ts';
import { folderOf, POSTS, routeFolder, UNFILED } from '../../routes.ts';
import type { Batch, CardRowData, PriceMode, Settings } from '../../types.ts';
import { bboxKey, byPostOrder, computeCardData, downloadBlob, goldPill, listingFields, lockPrices, notAdded, photoLabel, photoNumbers, popupOpen, type PhotoSort } from '../../utils.ts';

// One post's worth of scans in the gallery. `postId` null is the Unfiled group.
export interface Folder {
  key: string;
  postId: number | null;
  title: string;
  archived: boolean;    // hidden from the posts list (shown under Archived) and from Claims
  items: BatchSummary[];
  needs: number;
  total: number;
}

export interface ScannerProps {
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
        is_foil: goldPill(cd, settings),
        label_override: label,
      };
    }),
  };
}

// A key press that belongs to a field or to an open popup, not to the page.
export function keyTaken(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return true;
  return popupOpen();
}

// Arrow keys move the focus between the tiles of a grid (Enter opens one).
export function moveTileFocus(e: KeyboardEvent) {
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
}

// One step per photo finished, shown only while a run is going.
export function ScanProgress({ progress, t }: { progress: ScannerStore['scanProgress']; t: T }) {
  if (!progress) return null;
  return (
    <div className="scan-progress">
      <div
        className="scan-progress-track"
        role="progressbar"
        aria-label={t('scan_progress', progress)}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
      >
        <div className="scan-progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
      </div>
      <span className="scan-progress-label" aria-live="polite">{t('scan_progress', progress)}</span>
    </div>
  );
}

// What the Scanner pages share: the posts as folders, the open post and
// photo, and finishing, sharing, moving and deleting photos and posts.
export function useScannerArea({ scanner, nav: { route, go, replace, current }, pricing, health, t, lang }: ScannerProps) {
  const dialog = useDialog();
  const { pricingFor, listPosts, createPost } = pricing;

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

  // One card onto the checklist of a post, tied to its photo so deleting the
  // photo takes it off again.
  const addCard = useCallback(async (batch: Batch, cd: CardRowData, postId = batch.postId) => {
    await listingsApi.create({
      ...listingFields(cd),
      scan_id: batch.scanId,
      bbox: cd.card.bbox,
      post_ids: postId != null ? [postId] : [],
    });
    scanner.markListed(batch.id, cd.card.bbox);
  }, [scanner.markListed]);

  // Takes a card off its post's checklist, unless a buyer's claim holds it.
  const takeOutCard = useCallback(async (batch: Batch, cd: CardRowData): Promise<'claimed' | 'taken out'> => {
    const key = bboxKey(cd.card.bbox);
    // shortcut: reads every listing of the seller to find the card's own; ask the server for one scan's if that grows slow.
    const its = (await listingsApi.list('active')).filter(l => l.scan_id === batch.scanId && l.bbox && bboxKey(l.bbox) === key);
    if (its.some(l => (l.qty_committed ?? 0) > 0)) return 'claimed';
    for (const l of its) await listingsApi.remove(l.id);
    scanner.unmarkListed(batch.id, cd.card.bbox);
    return 'taken out';
  }, [scanner.unmarkListed]);

  // Core add-all: push every visible, priced card of a batch that is not on
  // the checklist yet. Returns how many cards failed.
  const addBatchCore = useCallback(async (batch: Batch, postId: number | null) => {
    if (!batch.response || batch.scanId == null) return 0;
    let failed = 0;
    for (const cd of notAdded(batch, computeCardData(batch, pricingFor(batch.postId)))) {
      try {
        await addCard(batch, cd, postId);
      } catch (e) {
        console.error('Add failed for', cd.sel.name, e);
        failed += 1;
      }
    }
    return failed;
  }, [pricingFor, addCard]);

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

  // "Photo N" for every saved photo: its place in its post's order.
  const numbers = useMemo(() => photoNumbers(scanner.batches), [scanner.batches]);
  const numbered = (b: Batch, n = numbers.get(b.id)) => (n != null ? `${String(n).padStart(2, '0')}_${b.filename}` : b.filename);

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

  // A photo's labelled image, downloaded whenever the seller likes (now,
  // later, again for a re-post). Sharing is the post's, for all its photos.
  const deliverPhoto = useCallback(async (batch: Batch) => {
    if (finishing) return;
    setFinishing(batch.id); setReady(null);
    try {
      const file = await renderImage(batch);
      if (file) downloadBlob(file, file.name);
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, renderImage, failedAlert]);

  const editPrices = useCallback(async (batch: Batch) => {
    const ok = await dialog.confirm({ title: t('edit_prices_title'), message: t('edit_prices_msg'), okLabel: t('edit_prices_ok') });
    if (ok) { scanner.unlockBatch(batch.id); setReady(null); }
  }, [dialog, t, scanner.unlockBatch]);

  // Finish all of a post's photos (the post page asks first).
  const runFinishAll = useCallback(async (key: string, targets: Batch[], postId: number | null) => {
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
    if (batch.scanId == null) return false;
    try {
      const result = await relookupScanPrices(batch.scanId);
      scanner.replaceAllCards(batch.id, result.cards);
      return true;
    } catch {
      await dialog.alert({ title: t('alert_error_title'), message: t('photo_refresh_failed') });
      return false;
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
  // The photo order of the post page; kept from one post to the next.
  const [sort, setSort] = useState<PhotoSort>('post');

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
      const key = folderOf(post?.id ?? null);
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

  // A post that no longer exists (deleted elsewhere): back to the list
  // rather than an empty screen.
  useEffect(() => {
    if (folderKey != null && postsLoaded && !scanner.loadingSaved && !openFolder && photoId == null) {
      replace(POSTS);
    }
  }, [folderKey, postsLoaded, scanner.loadingSaved, openFolder, photoId, replace]);

  // The posts list leaves archived posts out; they wait in their own section.
  const liveFolders = useMemo(() => folders.filter(f => !f.archived), [folders]);
  const archivedFolders = useMemo(() => folders.filter(f => f.archived), [folders]);
  const loading = (scanner.loadingSaved || !postsLoaded) && scanner.batches.length === 0;

  // The tile is a link to the photo; this keeps the order it was opened in.
  const openPhoto = useCallback((ids: string[]) => {
    setNavIds(ids);
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

  // New photos from the top level start a new post named for the moment, of
  // the kind the seller picked, and open it.
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
    go({ page: 'post', folder: folderOf(postId) });
  }, [scanner, lang, refreshPosts, go, createPost]);

  const moveTo = useCallback(async (ids: string[], postId: number | null) => {
    try {
      await scanner.moveBatches(ids, postId);
    } catch {
      await dialog.alert({ title: t('alert_error_title'), message: t('scans_move_failed') });
    }
  }, [scanner, dialog, t]);

  // Asks first; true once the photos are gone.
  const deletePhotos = useCallback(async (ids: string[]) => {
    if (!ids.length) return false;
    const ok = await dialog.confirm({
      title: ids.length === 1 ? t('scans_delete_title_one') : t('scans_delete_title', { n: ids.length }),
      message: t('scans_delete_msg'),
      okLabel: t('scans_delete'),
      destructive: true,
    });
    if (!ok) return false;
    // Deleting the open photo: its post takes the entry's place, so none is
    // left for it. Asked after the confirm: the user may have moved on.
    const cur = current();
    if (cur.page === 'photo' && ids.some(id => scanner.batches.find(b => b.id === id)?.scanId === cur.scanId)) {
      replace({ page: 'post', folder: cur.folder });
    }
    for (const id of ids) await scanner.removeBatch(id);
    return true;
  }, [dialog, scanner, current, replace, t]);

  const renamePost = useCallback(async (folder: Folder, title: string) => {
    if (folder.postId == null || !title || title === folder.title) return;
    // Show the new name at once; put the old one back if the server says no.
    setPosts(prev => prev.map(p => (p.id === folder.postId ? { ...p, title } : p)));
    try {
      await postsApi.update(folder.postId, { title });
    } catch (e) {
      await refreshPosts();
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [dialog, refreshPosts, t]);

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

  // A post's pricing is its own; unfiled photos use the default.
  const pricingTitle = (folder: Folder) => (folder.postId == null ? t('menu_default_pricing') : t('settings_title'));

  return {
    scanner, pricing, pricingFor, health, t, lang, route, go, replace,
    loading, postsById, pickerPosts, postTitle,
    liveFolders, archivedFolders, openFolder, activeBatch, numbers, pricingTitle,
    sharePhone, ready, finishing, share, finishPhoto, deliverPhoto, editPrices, explainFinish, runFinishAll, deliverFolder,
    addCard, takeOutCard, refreshScanPrices, deletePhotos, renamePost, setArchived, deletePost, moveTo, startPost,
    sort, setSort, openPhoto, liveNavIds, navIndex, step,
  };
}

export type Area = ReturnType<typeof useScannerArea>;
