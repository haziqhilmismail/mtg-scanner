import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addToChecklist, exportAllImages, exportImage, relookupScanPrices, type ExportAllImage, type ExportPayload, type Health } from '../api.ts';
import { postsApi, type Post } from '../api/checklist.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Batch, Candidate, Settings } from '../types.ts';
import { ckSearchUrl, computeCardData, formatMyr, formatMyrWithFoil } from '../utils.ts';
import { ActiveBatchView } from '../components/ActiveBatchView.tsx';
import { AddAllChecklistModal } from '../components/AddAllChecklistModal.tsx';
import { BatchTabStrip } from '../components/BatchTabStrip.tsx';
import { useDialog } from '../components/DialogProvider.tsx';
import { PrintingsModal } from '../components/PrintingsModal.tsx';
import { SettingsPanel } from '../components/SettingsPanel.tsx';
import { UploadZone } from '../components/UploadZone.tsx';
import { ZoomModal } from '../components/ZoomModal.tsx';

interface Props {
  scanner: ScannerStore;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  health: Health | null;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

const ADDED_STORAGE_PREFIX = 'mtg.scanner.added.';

// Persist "this card from this scan was already added" so a refresh doesn't
// silently re-enable Add-all and create duplicate listings on the next click.
// Keyed by server-side scanId (stable across reloads); the client-side
// batchId is regenerated on every load and can't be used here.
function loadAddedFromStorage(): Record<number, Record<number, number>> {
  const out: Record<number, Record<number, number>> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(ADDED_STORAGE_PREFIX)) continue;
      const scanId = parseInt(key.slice(ADDED_STORAGE_PREFIX.length), 10);
      if (isNaN(scanId)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      out[scanId] = JSON.parse(raw);
    }
  } catch { /* corrupted entries are ignored */ }
  return out;
}

function persistAddedSlice(scanId: number, slice: Record<number, number>) {
  try { localStorage.setItem(ADDED_STORAGE_PREFIX + scanId, JSON.stringify(slice)); }
  catch { /* quota / disabled storage — silent */ }
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
      const unitLabel = formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings);
      const label = cd.qty > 1 ? `${unitLabel} ×${cd.qty}` : unitLabel;
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

export function Scanner({ scanner, settings, updateSetting, health, t }: Props) {
  const dialog = useDialog();
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);
  const [printingsCtx, setPrintingsCtx] = useState<{ batchId: string; idx: number } | null>(null);

  // Post grouping state — which post each batch's cards get attached to when
  // added to the checklist. Map keyed by batch id so the choice survives
  // switching tabs between batches.
  const [posts, setPosts] = useState<Post[]>([]);
  const [postIdByBatch, setPostIdByBatch] = useState<Record<string, number | null>>({});

  // Tracks which scanned cards have already been pushed to the checklist.
  // Keyed by scanId (NOT batchId) so refresh-rehydrated batches keep their
  // "added" memory and re-running Add-all becomes a no-op instead of a
  // silent duplicate. Initialised eagerly from localStorage.
  const [addedByScanId, setAddedByScanId] = useState<Record<number, Record<number, number>>>(loadAddedFromStorage);

  // Synchronous re-entry guard for per-batch Add-all. A ref (not state)
  // because React state updates are async — a fast double-click can fire
  // the second handler before the first's setState propagates. Refs flip
  // synchronously and block the second call in the same JS tick.
  const addBatchInFlightRef = useRef<Set<string>>(new Set());

  const refreshPosts = useCallback(async () => {
    try { setPosts(await postsApi.list()); }
    catch { /* offline or auth error — ignore, picker just stays empty */ }
  }, []);

  useEffect(() => { refreshPosts(); }, [refreshPosts]);

  const markAdded = useCallback((scanId: number, origIdx: number, listingId: number) => {
    setAddedByScanId(prev => {
      const next = { ...prev, [scanId]: { ...(prev[scanId] || {}), [origIdx]: listingId } };
      persistAddedSlice(scanId, next[scanId]);
      return next;
    });
  }, []);

  // Which batch's add-all is currently running (drives the button's loading
  // state) and whether the page-level "add all images" bulk run is in flight.
  const [addingBatchId, setAddingBatchId] = useState<string | null>(null);
  const [addingAll, setAddingAll] = useState(false);

  // Core add-all: push every visible, priced card of a batch to the checklist.
  // No dedup against earlier adds — re-running intentionally re-adds (the user
  // asked to "always allow"). Accidental double-submits are prevented by the
  // button's busy state, not by skipping cards. markAdded still runs so the
  // per-card "added" badge stays informative.
  const addBatchCore = useCallback(async (batch: Batch, postId: number | null) => {
    if (!batch.response || batch.scanId == null) return;
    const cardData = computeCardData(batch, settings);
    const visible = cardData.filter(cd => !cd.removed);
    for (const cd of visible) {
      if (!isFinite(cd.unitPrice) || cd.unitPrice <= 0) continue;
      try {
        const ckDirect = cd.isFoil
          ? (cd.sel.ck_url_foil || cd.sel.ck_url_normal || '')
          : (cd.sel.ck_url_normal || cd.sel.ck_url_foil || '');
        const ck = ckDirect || ckSearchUrl(cd.sel.name || '');
        const result = await addToChecklist({
          name: cd.sel.name || '(unknown)',
          scryfall_id: cd.sel.scryfall_id || null,
          set_code: cd.sel.set || null,
          set_name: cd.sel.set_name || null,
          collector_number: cd.sel.collector_number || null,
          rarity: cd.sel.rarity || null,
          is_foil: cd.isFoil,
          image_url: cd.sel.image_url || null,
          ck_url: ck || null,
          unit_price_myr: cd.unitPrice.toFixed(2),
          qty_total: cd.qty,
          post_ids: postId != null ? [postId] : [],
        });
        markAdded(batch.scanId, cd.origIdx, result.id);
      } catch (e) {
        console.error('Add failed for', cd.sel.name, e);
      }
    }
  }, [settings, markAdded]);

  // Per-batch add-all handler. Synchronously gated by addBatchInFlightRef to
  // block same-tick double-clicks (state updates are async), and surfaces a
  // loading label via addingBatchId.
  const addBatchToChecklist = useCallback(async (batch: Batch, postId: number | null) => {
    if (batch.scanId == null) return;
    if (addBatchInFlightRef.current.has(batch.id)) return;
    addBatchInFlightRef.current.add(batch.id);
    setAddingBatchId(batch.id);
    try {
      await addBatchCore(batch, postId);
    } finally {
      addBatchInFlightRef.current.delete(batch.id);
      setAddingBatchId(null);
    }
  }, [addBatchCore]);

  // Page-level bulk: add every scanned image's cards to the checklist in one
  // go. Opening the picker modal lets the user choose a single post (or none)
  // to attach all of them to — distinct from each batch's own post grouping.
  const [addAllOpen, setAddAllOpen] = useState(false);

  const readyBatches = scanner.batches.filter(b => b.response && b.scanId != null);

  const openAddAll = useCallback(async () => {
    if (readyBatches.length === 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('bulk_add_all_none') });
      return;
    }
    setAddAllOpen(true);
  }, [readyBatches.length, dialog, t]);

  // Runs after the modal confirms. `postId` (null = no post) applies to every
  // image. Guarded by `addingAll` so the loading button can't re-trigger it.
  const runAddAll = useCallback(async (postId: number | null) => {
    setAddAllOpen(false);
    if (addingAll) return;
    const ready = scanner.batches.filter(b => b.response && b.scanId != null);
    if (ready.length === 0) return;
    setAddingAll(true);
    try {
      for (const b of ready) {
        await addBatchCore(b, postId);
      }
    } finally {
      setAddingAll(false);
    }
  }, [addingAll, scanner.batches, addBatchCore]);

  const exportBatch = useCallback(async (batch: Batch) => {
    const payload = buildExportPayload(batch, settings);
    if (!payload) return;
    try {
      const blob = await exportImage(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = batch.filename.replace(/\.[^.]+$/, '') + '_priced.png';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: 'Export failed: ' + (e as Error).message });
    }
  }, [settings, dialog, t]);

  // Bulk export: render every finished batch's priced overlay and download them
  // as a single zip. Guarded by `exportingAll` so a slow render (N images on the
  // 512 MB VM) can't be re-triggered mid-flight.
  const [exportingAll, setExportingAll] = useState(false);
  const exportAllBatches = useCallback(async () => {
    const images = scanner.batches
      .map(b => {
        const payload = buildExportPayload(b, settings);
        return payload ? { ...payload, filename: b.filename } as ExportAllImage : null;
      })
      .filter((x): x is ExportAllImage => x !== null);
    if (images.length === 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('export_all_none') });
      return;
    }
    setExportingAll(true);
    try {
      const blob = await exportAllImages(images);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mtg_prices.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: 'Export failed: ' + (e as Error).message });
    } finally {
      setExportingAll(false);
    }
  }, [scanner.batches, settings, dialog, t]);

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

  const activeBatch = scanner.batches.find(b => b.id === scanner.activeBatchId) ?? null;

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

  const counterText = (() => {
    if (!scanner.activeBatchId) return '';
    const idx = scanner.batches.findIndex(b => b.id === scanner.activeBatchId);
    if (idx < 0) return '';
    return t('batch_counter', { cur: idx + 1, total: scanner.batches.length });
  })();

  // Slice of addedByScanId for the currently-active batch — handed to
  // ActiveBatchView as `addedIdx`. Empty when the batch hasn't completed
  // scanning yet (no scanId yet) so the "+ Add" buttons stay clickable.
  const activeAddedSlice = (activeBatch?.scanId != null ? addedByScanId[activeBatch.scanId] : null) || {};

  // Running priced value across every scanned image. Recomputes whenever a
  // batch or the settings (incl. the price multiplier) change, so picking a new
  // multiplier updates this total and every per-image total together.
  const allScansTotal = useMemo(
    () => scanner.batches.reduce((sum, b) => {
      const total = computeCardData(b, settings)
        .filter(cd => !cd.removed)
        .reduce((s, cd) => s + (isFinite(cd.lineTotal) ? cd.lineTotal : 0), 0);
      return sum + total;
    }, 0),
    [scanner.batches, settings],
  );
  const hasExportable = scanner.batches.some(b => b.response);

  return (
    <>
      <SettingsPanel settings={settings} update={updateSetting} t={t} health={health} />
      <UploadZone onFiles={scanner.addFiles} t={t} />

      {scanner.batches.length > 0 && (
        <section>
          <div className="review-head">
            <h2><span className="step-num">3</span><span> {t('review_title')}</span></h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="meta">{counterText}</span>
              {hasExportable && (
                <span className="all-scans-total" title={t('all_scans_total')}>
                  <span className="label">Σ {t('all_scans_total')}</span>
                  <span className="value">{formatMyr(allScansTotal, settings)}</span>
                </span>
              )}
              {hasExportable && (
                <button
                  className="accent"
                  style={{ padding: '6px 12px', fontSize: 10 }}
                  disabled={addingAll || addingBatchId != null}
                  onClick={openAddAll}
                >{addingAll ? t('bulk_add_all_loading') : t('bulk_add_all_btn')}</button>
              )}
              {hasExportable && (
                <button
                  className="ghost"
                  style={{ padding: '6px 12px', fontSize: 10 }}
                  disabled={exportingAll}
                  onClick={exportAllBatches}
                >{exportingAll ? t('export_all_loading') : t('export_all_btn')}</button>
              )}
              {scanner.batches.length > 1 && (
                <button
                  className="ghost"
                  style={{ padding: '6px 12px', fontSize: 10 }}
                  onClick={async () => {
                    const ok = await dialog.confirm({
                      title: t('confirm_clear_all_title'),
                      message: t('confirm_clear_all_msg', { n: scanner.batches.length }),
                      okLabel: t('confirm_clear_all_ok'),
                      destructive: true,
                    });
                    if (ok) scanner.clearAll();
                  }}
                >× Clear all</button>
              )}
            </span>
          </div>

          <BatchTabStrip
            batches={scanner.batches}
            activeId={scanner.activeBatchId}
            settings={settings}
            onSelect={scanner.setActiveBatchId}
            onRemove={scanner.removeBatch}
            t={t}
          />
          {activeBatch ? (
            <ActiveBatchView
              batch={activeBatch}
              settings={settings}
              scanner={scanner}
              t={t}
              onZoom={(src, caption) => setZoom({ src, caption })}
              onBrowsePrintings={onBrowsePrintings}
              posts={posts}
              selectedPostId={postIdByBatch[activeBatch.id] ?? null}
              onSelectPost={(pid) => setPostIdByBatch(prev => ({ ...prev, [activeBatch.id]: pid }))}
              onPostsChanged={refreshPosts}
              addedIdx={activeAddedSlice}
              onMarkAdded={(origIdx, listingId) => {
                if (activeBatch.scanId != null) markAdded(activeBatch.scanId, origIdx, listingId);
              }}
              onAddAll={() => addBatchToChecklist(activeBatch, postIdByBatch[activeBatch.id] ?? null)}
              addAllBusy={addingBatchId === activeBatch.id || addingAll}
              onExport={() => exportBatch(activeBatch)}
              onRefreshPrices={() => refreshScanPrices(activeBatch)}
            />
          ) : null}
        </section>
      )}

      {addAllOpen && (
        <AddAllChecklistModal
          count={readyBatches.length}
          posts={posts}
          onClose={() => setAddAllOpen(false)}
          onConfirm={runAddAll}
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
      <ZoomModal
        src={zoom?.src ?? null}
        caption={zoom?.caption || ''}
        onClose={() => setZoom(null)}
      />
    </>
  );
}
