import { Icon } from '../components/Icon.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportAllImages, exportImage, relookupScanPrices, type ExportAllImage, type ExportPayload, type Health } from '../api.ts';
import { listingsApi, postsApi, type Post } from '../api/checklist.ts';
import type { NavStore } from '../hooks/useNav.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import { migrateAdded } from '../lib/addedMarkers.ts';
import type { Batch, Candidate, Credits, Settings } from '../types.ts';
import { computeCardData, downloadBlob, formatMyr, listingFields, matchThumbs, notAdded, PHOTO_SORTS, pillLabel, sortPhotos, type PhotoSort } from '../utils.ts';

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

const UNFILED = 'unfiled';
import { ActiveBatchView } from '../components/ActiveBatchView.tsx';
import { AddAllChecklistModal } from '../components/AddAllChecklistModal.tsx';
import { useDialog } from '../components/DialogProvider.tsx';
import { useImageZoom } from '../components/ImageZoomProvider.tsx';
import { PrintingsModal } from '../components/PrintingsModal.tsx';
import { PhotoTile, PostTile, summarise, type BatchSummary } from '../components/ScanGallery.tsx';
import { PricingFields, SettingsPanel } from '../components/SettingsPanel.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { UploadZone } from '../components/UploadZone.tsx';
import type { T } from '../hooks/useLang.ts';

interface Props {
  scanner: ScannerStore;
  // Which post and photo are open; each is a browser history entry.
  nav: NavStore;
  // Pricing per post and the default; pricingFor() prices every photo.
  pricing: PricingStore;
  health: Health | null;
  t: T;
  lang: string;
  credits: Credits | null;
  onEnterVoucher: () => void;
}

// Build the /api/export payload for one batch (shared by single-batch export and
// the bulk "Export all" zip). Returns null for batches that haven't finished
// scanning yet (no response).
function buildExportPayload(batch: Batch, settings: Settings): ExportPayload | null {
  if (!batch.response) return null;
  const cardData = computeCardData(batch, settings);
  const visible = cardData.filter(cd => !cd.removed);
  const data = batch.response;
  return {
    image_id: data.image_id,
    show_outlines: settings.showOutlines,
    label_position: settings.labelPosition,
    font_scale: settings.labelFontScale,
    cards: visible.map(cd => {
      const label = pillLabel(cd, settings);
      return {
        bbox: cd.card.bbox,
        corners: cd.card.corners,
        is_foil: cd.isFoil && settings.foilStyle === 'gold',
        label_override: label,
        pill_dx: cd.pillOffset?.dx,
        pill_dy: cd.pillOffset?.dy,
      };
    }),
  };
}

export function Scanner({ scanner, nav: { nav, go, replace, up, current }, pricing, health, t, lang, credits, onEnterVoucher }: Props) {
  const dialog = useDialog();
  const zoom = useImageZoom();
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

  // Synchronous re-entry guard for per-batch Add-all. A ref (not state)
  // because React state updates are async — a fast double-click can fire
  // the second handler before the first's setState propagates. Refs flip
  // synchronously and block the second call in the same JS tick.
  const addBatchInFlightRef = useRef<Set<string>>(new Set());

  const refreshPosts = useCallback(async () => {
    try {
      setPosts(await listPosts());
    }
    catch { /* offline or auth error — ignore, picker just stays empty */ }
    setPostsLoaded(true);
  }, [listPosts]);

  useEffect(() => { refreshPosts(); }, [refreshPosts]);

  // Which batch's add-all is currently running (drives the button's loading
  // state) and whether the page-level "add all images" bulk run is in flight.
  const [addingBatchId, setAddingBatchId] = useState<string | null>(null);
  const [addingAll, setAddingAll] = useState(false);

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

  // Per-batch add-all handler. Synchronously gated by addBatchInFlightRef to
  // block same-tick double-clicks (state updates are async), and surfaces a
  // loading label via addingBatchId.
  const addBatchToChecklist = useCallback(async (batch: Batch, postId: number | null) => {
    if (batch.scanId == null) return;
    if (addBatchInFlightRef.current.has(batch.id)) return;
    addBatchInFlightRef.current.add(batch.id);
    setAddingBatchId(batch.id);
    let failed = 0;
    try {
      failed = await addBatchCore(batch, postId);
    } finally {
      addBatchInFlightRef.current.delete(batch.id);
      setAddingBatchId(null);
    }
    await alertFailed(failed);
  }, [addBatchCore, alertFailed]);

  // Bulk add: push the cards of several photos to the checklist in one go.
  // Inside a post they go under that post (after a confirm); for unfiled
  // photos a picker asks which post, if any. `addAllTargets` holds the photos
  // while that picker is open.
  const [addAllTargets, setAddAllTargets] = useState<Batch[] | null>(null);

  const runAddAll = useCallback(async (targets: Batch[], postId: number | null) => {
    setAddAllTargets(null);
    if (addingAll || targets.length === 0) return;
    setAddingAll(true);
    let failed = 0;
    try {
      for (const b of targets) {
        failed += await addBatchCore(b, postId);
      }
    } finally {
      setAddingAll(false);
    }
    await alertFailed(failed);
  }, [addingAll, addBatchCore, alertFailed]);

  const exportBatch = useCallback(async (batch: Batch) => {
    const payload = buildExportPayload(batch, pricingFor(batch.postId));
    if (!payload) return;
    try {
      downloadBlob(await exportImage(payload), batch.filename.replace(/\.[^.]+$/, '') + '_priced.png');
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: 'Export failed: ' + (e as Error).message });
    }
  }, [pricingFor, dialog, t]);

  // Bulk export: render every finished batch's priced overlay and download them
  // as a single zip. Guarded by `exportingAll` so a slow render (N images on the
  // 512 MB VM) can't be re-triggered mid-flight.
  const [exportingAll, setExportingAll] = useState(false);
  const exportAllBatches = useCallback(async (batches: Batch[]) => {
    const images = batches
      .map(b => {
        const payload = buildExportPayload(b, pricingFor(b.postId));
        return payload ? { ...payload, filename: b.filename } as ExportAllImage : null;
      })
      .filter((x): x is ExportAllImage => x !== null);
    if (images.length === 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('export_all_none') });
      return;
    }
    setExportingAll(true);
    try {
      downloadBlob(await exportAllImages(images), 'mtg_prices.zip');
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: 'Export failed: ' + (e as Error).message });
    } finally {
      setExportingAll(false);
    }
  }, [pricingFor, dialog, t]);

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
  // Three levels: all posts → one post's photos → one photo, each a browser
  // history entry (see useNav).
  const folderKey = nav.folder;
  const photoId = nav.photo;
  // The photos Prev/Next step through, fixed when a photo is opened so the
  // order doesn't shift under you as you fix things.
  const [navIds, setNavIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'needs'>('all');
  const [sort, setSort] = useState<PhotoSort>('newest');
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
      replace({ folder: null });
    }
  }, [folderKey, postsLoaded, scanner.loadingSaved, openFolder, photoId, replace]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((s: BatchSummary) => !q || s.haystack.includes(q), [q]);
  const visibleItems = useMemo(
    () => sortPhotos((openFolder?.items ?? []).filter(s => (filter === 'needs' ? s.needs > 0 : true)).filter(matches), sort),
    [openFolder, filter, matches, sort],
  );
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
          onOpen={() => goTo(f.key)}
        />
      ))}
    </div>
  );

  const goTo = useCallback((key: string | null) => go({ folder: key, photo: null }), [go]);

  // Another post (opened, or come back to through history) starts unfiltered.
  useEffect(() => {
    setFilter('all');
    setQuery('');
    setSelecting(false);
    setSelected(new Set());
  }, [folderKey]);

  const openPhoto = useCallback((id: string, ids: string[]) => {
    setNavIds(ids);
    go({ photo: id });
    setSelecting(false);
    window.scrollTo({ top: 0 });
  }, [go]);

  const activeBatch = scanner.batches.find(b => b.id === photoId) ?? null;
  // An open photo that has gone (deleted), once every saved photo has
  // loaded: up to its post, back through history when that is the entry below.
  useEffect(() => {
    if (photoId != null && !activeBatch && !scanner.loadingSaved) up();
  }, [photoId, activeBatch, scanner.loadingSaved, up]);

  // Reached through history (or a reload) rather than a tile, a photo steps
  // through its post in gallery order.
  const stepIds = photoId != null && navIds.includes(photoId) ? navIds : (openFolder?.items.map(s => s.batch.id) ?? []);
  const liveNavIds = stepIds.filter(id => scanner.batches.some(b => b.id === id));
  const navIndex = photoId ? liveNavIds.indexOf(photoId) : -1;
  const step = useCallback((delta: number) => {
    const next = liveNavIds[navIndex + delta];
    if (next) { replace({ photo: next }); window.scrollTo({ top: 0 }); }
  }, [liveNavIds, navIndex, replace]);

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector('.dlg-shade, .modal.open, .zoom-modal.open, .feedback-overlay, .modal-shade, .preview-cell.expanded, .menu-popover')) return;

      if (photoId != null) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        else if (e.key === 'Escape') up();
        return;
      }
      if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('.scan-search input');
        if (search) { e.preventDefault(); search.focus(); }
        return;
      }
      if (e.key === 'Escape' && folderKey != null) {
        if (selecting) { setSelecting(false); setSelected(new Set()); }
        else up();
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
  }, [photoId, step, folderKey, selecting, up]);

  // Swipe left/right on the photo's header to step, like a photo roll. Kept
  // to the header so it can't fight dragging a price pill or scrolling a row.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // New photos: inside a post they join it; from the top level a drop starts
  // a new post named for the moment, and opens it.
  const onFiles = useCallback(async (files: File[]) => {
    if (openFolder) {
      scanner.addFiles(files, openFolder.postId);
      return;
    }
    let postId: number | null = null;
    try {
      const title = new Date().toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      });
      const post = await createPost({ title });
      postId = post.id;
      await refreshPosts();
    } catch { /* couldn't create the post: the photos are still scanned, unfiled */ }
    scanner.addFiles(files, postId);
    goTo(postId != null ? `p${postId}` : UNFILED);
  }, [openFolder, scanner, lang, refreshPosts, goTo, createPost]);

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
    // Deleting the open photo goes back to its post, so no entry is left for
    // it. Asked after the confirm: the user may have gone back meanwhile.
    const open = current().photo;
    if (open != null && ids.includes(open)) up();
    for (const id of ids) await scanner.removeBatch(id);
    setSelected(new Set());
    setSelecting(false);
  }, [dialog, scanner, current, up, t]);

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
      if (archived && current().folder === folder.key) up();
    } catch (e) {
      await refreshPosts();
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [dialog, refreshPosts, current, up, t]);

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
    if (current().folder === folder.key) up();
    await refreshPosts();
  }, [dialog, scanner, current, up, refreshPosts, t]);

  const addFolderToChecklist = useCallback(async (folder: Folder) => {
    const targets = folder.items.map(s => s.batch).filter(b => b.response && b.scanId != null);
    if (targets.length === 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('bulk_add_all_none') });
      return;
    }
    if (folder.postId == null) { setAddAllTargets(targets); return; }
    const ok = await dialog.confirm({
      title: t('scans_add_all_confirm_title'),
      message: t('scans_add_all_confirm_msg', { n: targets.length, post: folder.title }),
      okLabel: t('scans_add_all_confirm_ok'),
    });
    if (ok) runAddAll(targets, folder.postId);
  }, [dialog, runAddAll, t]);

  const onBrowsePrintings = (idx: number) => {
    if (!activeBatch) return;
    setPrintingsCtx({ batchId: activeBatch.id, idx });
  };

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
      onFiles={onFiles}
      t={t}
      lang={lang}
      credits={credits}
      onEnterVoucher={onEnterVoucher}
      compact={openFolder != null}
    />
  );
  // A post's pricing, which it can make the default; for unfiled photos
  // (null), the default itself. Shown once that pricing is known.
  const pricingPanel = (postId: number | null) => pricing.pricingKnown(postId) && (
    <SettingsPanel title={postId == null ? t('menu_default_pricing') : t('settings_title')} settings={pricingFor(postId)} t={t}>
      <PricingFields
        settings={pricingFor(postId)}
        update={(key, value) => pricing.update(postId, key, value)}
        t={t}
        health={health}
      />
      {postId != null ? (
        <div className="pricing-default-row">
          <button type="button" disabled={pricing.isDefault(postId)} onClick={() => pricing.makeDefault(postId)}>
            {pricing.isDefault(postId) ? t('pricing_is_default') : t('pricing_set_default')}
          </button>
        </div>
      ) : null}
    </SettingsPanel>
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
            <button type="button" className="ghost photo-nav-back" onClick={up}>
              <Icon name="chevronLeft" size={18} />
              <span>{openFolder?.title ?? t('scans_title')}</span>
            </button>
            <span className="photo-nav-count">
              {navIndex >= 0 ? t('scans_counter', { cur: navIndex + 1, total: liveNavIds.length }) : ''}
            </span>
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
          {pricingPanel(activeBatch.postId)}
          <ActiveBatchView
            batch={activeBatch}
            settings={pricingFor(activeBatch.postId)}
            scanner={scanner}
            t={t}
            onZoom={zoom.open}
            onBrowsePrintings={onBrowsePrintings}
            postTitle={activeBatch.postId != null && postsById.has(activeBatch.postId) ? postTitle(postsById.get(activeBatch.postId)!) : null}
            onAddAll={() => addBatchToChecklist(activeBatch, activeBatch.postId)}
            addAllBusy={addingBatchId === activeBatch.id || addingAll}
            onExport={() => exportBatch(activeBatch)}
            onRefreshPrices={() => refreshScanPrices(activeBatch)}
          />
        </section>
      ) : openFolder ? (
        /* ---------- One post's photos ---------- */
        <>
          <div className="photo-nav">
            <button type="button" className="ghost photo-nav-back" onClick={up}>
              <Icon name="chevronLeft" size={18} />
              <span>{t('scans_title')}</span>
            </button>
          </div>
          <div className="review-head">
            <div className={`review-title ${titleDraft != null ? 'is-editing' : ''}`}>
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
                {openFolder.items.some(s => s.batch.response) ? (
                  <>
                    <button className="accent" disabled={addingAll || addingBatchId != null} onClick={() => addFolderToChecklist(openFolder)}>
                      <Icon name="addList" size={18} />{addingAll ? t('bulk_add_all_loading') : t('bulk_add_all_btn')}
                    </button>
                    <button disabled={exportingAll} onClick={() => exportAllBatches(openFolder.items.map(s => s.batch))}>
                      <Icon name="download" size={18} />{exportingAll ? t('export_all_loading') : t('export_all_btn')}
                    </button>
                  </>
                ) : null}
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
          {pricingPanel(openFolder.postId)}
          {progress}
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
                  <div className="segmented gallery-filter" role="group" aria-label={t('scans_filter_needs')}>
                    <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                      {t('scans_filter_all')}
                    </button>
                    <button type="button" className={filter === 'needs' ? 'active' : ''} aria-pressed={filter === 'needs'} onClick={() => setFilter('needs')}>
                      {t('scans_filter_needs')}{openFolder.needs > 0 ? ` ${openFolder.items.filter(s => s.needs > 0).length}` : ''}
                    </button>
                  </div>
                  {searchField}
                  <select className="gallery-sort" value={sort} aria-label={t('scans_sort')} onChange={e => setSort(e.target.value as PhotoSort)}>
                    {(Object.keys(PHOTO_SORTS) as PhotoSort[]).map(k => (
                      <option key={k} value={k}>{t(`scans_sort_${k}`)}</option>
                    ))}
                  </select>
                  <button className="ghost" onClick={() => setSelecting(true)}>{t('scans_select')}</button>
                </>
              )}
            </div>
          ) : null}
          {openFolder.items.length === 0 ? (
            <p className="gallery-empty">{t('scans_empty_post')}</p>
          ) : visibleItems.length === 0 ? (
            <p className="gallery-empty">{q ? t('scans_no_matches') : t('scans_none_to_fix')}</p>
          ) : (
            <div className="gallery-grid">
              {visibleItems.map(s => (
                <PhotoTile
                  key={s.batch.id}
                  summary={s}
                  settings={pricingFor(s.batch.postId)}
                  t={t}
                  selecting={selecting}
                  selected={selected.has(s.batch.id)}
                  onOpen={() => openPhoto(s.batch.id, visibleItems.map(v => v.batch.id))}
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

      {addAllTargets && (
        <AddAllChecklistModal
          count={addAllTargets.length}
          posts={pickerPosts}
          onClose={() => setAddAllTargets(null)}
          onConfirm={(postId) => runAddAll(addAllTargets, postId)}
          t={t}
        />
      )}

      <PrintingsModal
        open={!!printingsCtx}
        cardName={printingsCardName}
        currentSid={printingsCurrentSid}
        onClose={() => setPrintingsCtx(null)}
        onSelect={onPickPrinting}
        t={t}
      />
    </>
  );
}
