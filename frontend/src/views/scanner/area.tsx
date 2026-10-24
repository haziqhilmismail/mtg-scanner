import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { relookupScanPrices, type ExportPayload, type Health } from '../../api.ts';
import { listingsApi, postsApi, type Post } from '../../api/checklist.ts';
import { useDialog } from '../../components/DialogProvider.tsx';
import { countText, summarise, type BatchSummary } from '../../components/ScanGallery.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import type { T } from '../../hooks/useLang.ts';
import type { NavStore } from '../../hooks/useNav.ts';
import { readStored, writeStored } from '../../hooks/usePersistedState.ts';
import type { PricingStore } from '../../hooks/usePricing.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';
import { migrateAdded } from '../../lib/addedMarkers.ts';
import { photoFileName } from '../../lib/photoFiles.ts';
import { folderOf, POSTS, routeFolder, UNFILED } from '../../routes.ts';
import type { Batch, PriceMode, Settings } from '../../types.ts';
import { computeCardData, downloadBlob, listingFields, lockPrices, notAdded, photoLabel, photoNumbers, popupOpen, type PhotoSort } from '../../utils.ts';
import { renderFile, type ExportJob } from './exportFiles.ts';

// One post's worth of scans. `postId` null is the Unfiled photos.
export interface Folder {
  key: string;
  postId: number | null;
  title: string;
  archived: boolean;    // hidden from the posts list (shown under Archived)
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

// What the exported photo of a batch shows, or null for a batch that hasn't
// finished scanning. Foil prices are always on a gold pill (DESIGN.md §7),
// outlines follow the setting on every post, and a live post's photo carries
// only the labels CK won't decide (see photoLabel).
function buildExportPayload(batch: Batch, settings: Settings): ExportPayload | null {
  if (!batch.response) return null;
  // A card added by hand has no spot on the photo, so it gets no label there.
  const visible = computeCardData(batch, settings).filter(cd => !cd.removed && cd.card.bbox_source !== 'user');
  return {
    image_id: batch.response.image_id,
    show_outlines: settings.showOutlines,
    label_position: settings.labelPosition,
    font_scale: settings.labelFontScale,
    cards: visible.map(cd => ({
      bbox: cd.card.bbox,
      corners: cd.card.corners,
      is_foil: cd.isFoil,
      label_override: photoLabel(cd, settings),
    })),
  };
}

// A key press that belongs to a field or to an open popup, not to the page.
export function keyTaken(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return true;
  return popupOpen();
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
// photo, and finishing, exporting, moving and deleting photos and posts.
export function useScannerArea({ scanner, nav: { route, go, replace, current }, pricing, health, t, lang }: ScannerProps) {
  const dialog = useDialog();
  const toast = useToast();
  const { pricingFor, listPosts, createPost } = pricing;

  // Every post, archived ones too, so their photos don't fall into Unfiled.
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
  // a tap, not after the wait to render them. key: the photo's id.
  const [ready, setReady] = useState<{ key: string; files: File[] } | null>(null);
  const [finishing, setFinishing] = useState<string | null>(null);

  // "Photo N" for every saved photo: its place in its post's order.
  const numbers = useMemo(() => photoNumbers(scanner.batches), [scanner.batches]);
  const postsById = useMemo(() => new Map(posts.map(p => [p.id, p])), [posts]);
  const postTitle = useCallback((p: Post) => p.title || `#${p.id}`, []);
  const folderTitle = useCallback((postId: number | null) => {
    const post = postId != null ? postsById.get(postId) : undefined;
    return post ? postTitle(post) : t('posts_unfiled');
  }, [postsById, postTitle, t]);

  // A saved photo's labelled image as a file to share or download: "Friday
  // Post - Photo 07.jpg". null while it is still scanning.
  const exportJob = useCallback((batch: Batch): ExportJob | null => {
    const n = numbers.get(batch.id);
    const payload = buildExportPayload(batch, pricingFor(batch.postId));
    if (n == null || !payload) return null;
    const count = scanner.batches.filter(b => b.postId === batch.postId && numbers.has(b.id)).length;
    return { payload, name: photoFileName(folderTitle(batch.postId), n, count, t) };
  }, [numbers, pricingFor, scanner.batches, folderTitle, t]);

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
    const ok = await dialog.confirm({ title: t('finish_explain_title'), message: t('finish_explain_msg'), okLabel: t('finish_explain_ok'), cancelLabel: t('cancel') });
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
    const job = exportJob(batch);
    if (finishing || !job) return;
    setFinishing(batch.id); setReady(null);
    try {
      deliver(batch.id, [await renderFile(job)]);
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, exportJob, deliver, failedAlert]);

  const editPrices = useCallback(async (batch: Batch) => {
    const ok = await dialog.confirm({ title: t('edit_prices_title'), message: t('edit_prices_msg'), okLabel: t('edit_prices_ok'), cancelLabel: t('cancel') });
    if (ok) { scanner.unlockBatch(batch.id); setReady(null); }
  }, [dialog, t, scanner.unlockBatch]);

  // Finish (or, on a live post, add) all of a post's photos.
  const runFinishAll = useCallback(async (key: string, targets: Batch[], postId: number | null) => {
    if (finishing || targets.length === 0) return;
    setFinishing(key); setReady(null);
    try {
      let failed = 0;
      let skipped = 0;
      for (const b of targets) {
        const result = await finishCore(b, postId);
        if (result === 'unpriced') skipped += 1;
        else failed += result;
      }
      await alertFailed(failed);
      if (skipped) await dialog.alert({ title: t('finish_needs_price_title'), message: t('finish_all_skipped', { n: skipped }) });
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, finishCore, alertFailed, dialog, t, failedAlert]);

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
  // The photo order of the post page; kept from one post to the next.
  const [sort, setSort] = useState<PhotoSort>('post');

  const pickerPosts = useMemo(() => posts.filter(p => p.status !== 'archived'), [posts]);

  // Every post, newest first as the server lists them, each with its photos
  // (a post may have none yet), then the photos in no post (or in a post
  // this page doesn't know), as the Unfiled folder.
  const folders = useMemo<Folder[]>(() => {
    const byKey = new Map<string, Folder>(posts.map(p => [folderOf(p.id), {
      key: folderOf(p.id), postId: p.id, title: postTitle(p), archived: p.status === 'archived', items: [], needs: 0, total: 0,
    }]));
    const unfiled: Folder = { key: UNFILED, postId: null, title: t('posts_unfiled'), archived: false, items: [], needs: 0, total: 0 };
    for (const b of scanner.batches) {
      const f = byKey.get(folderOf(b.postId)) ?? unfiled;
      const sum = summarise(b, pricingFor(f.postId));
      f.items.push(sum);
      f.needs += sum.needs;
      f.total += sum.total;
    }
    return unfiled.items.length ? [...byKey.values(), unfiled] : [...byKey.values()];
  }, [scanner.batches, posts, postTitle, pricingFor, t]);

  // The open post. It may have no photos yet (just created, or all deleted).
  const openFolder = useMemo<Folder | null>(() => {
    if (folderKey == null) return null;
    return folders.find(f => f.key === folderKey)
      ?? (folderKey === UNFILED ? { key: UNFILED, postId: null, title: t('posts_unfiled'), archived: false, items: [], needs: 0, total: 0 } : null);
  }, [folderKey, folders, t]);

  // A post that no longer exists (deleted elsewhere): back to the list
  // rather than an empty screen.
  useEffect(() => {
    if (folderKey != null && postsLoaded && !scanner.loadingSaved && !openFolder && photoId == null) {
      replace(POSTS);
    }
  }, [folderKey, postsLoaded, scanner.loadingSaved, openFolder, photoId, replace]);

  // The posts list leaves archived posts out; they wait in their own section.
  const liveFolders = useMemo(() => folders.filter(f => f.postId != null && !f.archived), [folders]);
  const archivedFolders = useMemo(() => folders.filter(f => f.archived), [folders]);
  const unfiledFolder = folders.find(f => f.postId == null) ?? null;
  const loading = !postsLoaded || (scanner.loadingSaved && scanner.batches.length === 0);

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

  // True once the photos are in the other post.
  const moveTo = useCallback(async (ids: string[], postId: number | null) => {
    try {
      await scanner.moveBatches(ids, postId);
    } catch {
      await dialog.alert({ title: t('alert_error_title'), message: t('scans_move_failed') });
      return false;
    }
    toast(t('photos_moved_toast', { post: folderTitle(postId) }));
    return true;
  }, [scanner, dialog, toast, folderTitle, t]);

  // Asks first; true once the photos are gone.
  const deletePhotos = useCallback(async (ids: string[]) => {
    if (!ids.length) return false;
    const one = ids.length === 1;
    const ok = await dialog.confirm({
      title: one ? t('photos_delete_title_one') : t('photos_delete_title', { n: ids.length }),
      message: t('scans_delete_msg'),
      okLabel: one ? t('photos_delete_ok_one') : t('photos_delete_ok', { n: ids.length }),
      cancelLabel: t('cancel'),
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

  // Archiving hides a post without losing anything; restoring brings it back.
  // Either one says so with an Undo, unless it is the undo itself.
  const setArchived = useCallback(async (folder: Folder, archived: boolean, undoable = true) => {
    if (folder.postId == null) return;
    const status = archived ? 'archived' : 'active';
    setPosts(prev => prev.map(p => (p.id === folder.postId ? { ...p, status } : p)));
    try {
      await postsApi.update(folder.postId, { status });
    } catch (e) {
      await refreshPosts();
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
      return;
    }
    // Still on the post: the user may have left it meanwhile.
    if (archived && routeFolder(current()) === folder.key) go(POSTS);
    const message = t(archived ? 'post_archived_toast' : 'post_restored_toast');
    toast(message, undoable ? { undoLabel: t('posts_undo'), onUndo: () => setArchived(folder, !archived, false) } : undefined);
  }, [dialog, toast, refreshPosts, current, go, t]);

  // Deleting a post takes its photos with it. The server refuses while any
  // of its cards are still claimed, so no buyer's claim is lost silently:
  // then archiving is offered instead.
  const deletePost = useCallback(async (folder: Folder) => {
    if (folder.postId == null) return;
    const photos = folder.items.length;
    const cards = folder.items.reduce((n, s) => n + s.cards, 0);
    const ok = await dialog.confirm({
      title: t('delete_post_title', { name: folder.title }),
      message: photos
        ? t('delete_post_body', { photos: countText(t, 'post_photos_count', photos), cards: countText(t, 'post_cards', cards) })
        : t('delete_post_body_empty'),
      okLabel: t('delete_post'),
      cancelLabel: t('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await postsApi.remove(folder.postId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status !== 409) {
        await dialog.alert({ title: t('alert_error_title'), message: err.message });
      } else if (await dialog.confirm({
        title: t('delete_post_claimed_title', { name: folder.title }),
        message: t('delete_post_claimed_body'),
        okLabel: t('archive_post'),
        cancelLabel: t('cancel'),
      })) {
        await setArchived(folder, true);
      }
      return;
    }
    for (const s of folder.items) await scanner.removeBatch(s.batch.id);
    if (routeFolder(current()) === folder.key) replace(POSTS);
    await refreshPosts();
    toast(t('post_deleted_toast'));
  }, [dialog, toast, scanner, current, replace, refreshPosts, setArchived, t]);

  return {
    scanner, pricing, pricingFor, health, t, lang, route, go, replace,
    loading, postsById, pickerPosts, postTitle,
    liveFolders, archivedFolders, unfiledFolder, openFolder, activeBatch, numbers,
    sharePhone, ready, finishing, share, finishPhoto, deliverPhoto, editPrices, explainFinish, runFinishAll, exportJob,
    refreshScanPrices, deletePhotos, renamePost, setArchived, deletePost, moveTo, startPost,
    sort, setSort, openPhoto, liveNavIds, navIndex, step,
  };
}

export type Area = ReturnType<typeof useScannerArea>;
