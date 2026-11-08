import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listingsApi } from '../../api/checklist.ts';
import type { ExportPayload } from '../../api/export.ts';
import { relookupScanPrices } from '../../api/scans.ts';
import { useDialog } from '../../components/DialogProvider.tsx';
import { useT } from '../../hooks/useLang.ts';
import type { PricingStore } from '../../hooks/usePricing.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';
import { migrateAdded } from '../../lib/legacy.ts';
import { photoFileName } from '../../lib/photoFiles.ts';
import { KEY, storage } from '../../lib/storage.ts';
import type { Batch, Settings } from '../../types.ts';
import { bboxKey, downloadBlob, goldPill, listingFields, notAdded, photoLabel, photoNumbers } from '../../utils.ts';
import { renderFile, type ExportJob } from './exportFiles.ts';
import { computeCardData, lockPrices, type CardRowData } from '../../lib/scanState.ts';
import { isLive } from '../../lib/pricing.ts';

// What the exported photo of a batch shows, or null for a batch that hasn't
// finished scanning. Foil prices are always on a gold pill (DESIGN.md §7),
// outlines follow the setting on every post, and a live post's photo carries
// only the labels CK won't decide (see photoLabel).
function buildExportPayload(batch: Batch, settings: Settings): ExportPayload | null {
  if (!batch.response) return null;
  // A card added by hand has no spot on the photo, so it gets no label there.
  const onPhoto = computeCardData(batch.response.cards, batch, settings).filter(cd => cd.card.bbox_source !== 'user');
  const visible = onPhoto.filter(cd => !cd.removed);
  return {
    image_id: batch.response.image_id,
    covers: onPhoto.filter(cd => cd.sold).map(cd => ({ bbox: cd.card.bbox, corners: cd.card.corners })),
    show_outlines: settings.showOutlines,
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

interface Props {
  scanner: ScannerStore;
  pricingFor: PricingStore['pricingFor'];
  // The name of the post a photo is in, for its exported file name.
  folderTitle: (postId: number | null) => string;
}

// What is done to a photo's cards: add them to the post or take them out,
// finish (lock the prices), refresh CK prices, and export the labelled image.
export function usePhotoActions({ scanner, pricingFor, folderTitle }: Props) {
  const { t } = useT();
  const dialog = useDialog();

  // Once every saved photo has loaded, tie cards added by older versions
  // (remembered only on this device) to their photo on the server.
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || scanner.loadingSaved) return;
    migrated.current = true;
    migrateAdded(scanner.batches, scanner.markListed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.loadingSaved]);

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
    for (const cd of notAdded(batch, computeCardData(batch.response.cards, batch, pricingFor(batch.postId)))) {
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

  // Finish = the prices are final: they lock at what buyers will see (so
  // claims sell at them) and the cards go on the post. The priced image is a
  // separate step, downloaded or (on a phone) shared from the post. Edit
  // prices unlocks it again.
  const [finishing, setFinishing] = useState<string | null>(null);

  // "Photo N" for every saved photo: its place in its post's order.
  const numbers = useMemo(() => photoNumbers(scanner.batches), [scanner.batches]);

  // A saved photo's labelled image as a file to share or download: "Friday
  // Post - Photo 07.jpg". null while it is still scanning.
  const exportJob = useCallback((batch: Batch): ExportJob | null => {
    const n = numbers.get(batch.id);
    const payload = buildExportPayload(batch, pricingFor(batch.postId));
    if (n == null || !payload) return null;
    const count = scanner.batches.filter(b => b.postId === batch.postId && numbers.has(b.id)).length;
    return { payload, name: photoFileName(folderTitle(batch.postId), n, count, t) };
  }, [numbers, pricingFor, scanner.batches, folderTitle, t]);

  // What Finish does, said once before the first time.
  const explainFinish = useCallback(async () => {
    if (storage.getJson(KEY.finishExplained, false)) return true;
    const ok = await dialog.confirm({ title: t('finish_explain_title'), message: t('finish_explain_msg'), okLabel: t('finish_explain_ok') });
    if (ok) storage.setJson(KEY.finishExplained, true);
    return ok;
  }, [dialog, t]);

  // Lock a photo's prices (unless locked already) and put its cards on the
  // post. 'unpriced' (and nothing done) while a kept card has no price;
  // otherwise how many cards failed to add.
  const finishCore = useCallback(async (batch: Batch, postId: number | null): Promise<'unpriced' | number> => {
    const settings = pricingFor(batch.postId);
    // Live price: the cards go on the post; prices stay live until each buyer is sent theirs.
    if (isLive(settings)) return addBatchCore(batch, postId);
    const cards = computeCardData(batch.response?.cards ?? [], batch, settings);
    if (cards.some(cd => !cd.removed && !(cd.unitPrice > 0))) return 'unpriced';
    if (!batch.lockedAt) scanner.lockBatch(batch.id, lockPrices(cards));
    return addBatchCore(batch, postId);
  }, [pricingFor, scanner.lockBatch, addBatchCore]);

  const failedAlert = useCallback(async (e: unknown) => {
    await dialog.alert({ title: t('alert_error_title'), message: t('finish_failed', { err: (e as Error).message }) });
  }, [dialog, t]);

  const finishPhoto = useCallback(async (batch: Batch) => {
    const live = isLive(pricingFor(batch.postId));
    if (finishing || batch.scanId == null || (!live && !(await explainFinish()))) return;
    setFinishing(batch.id);
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
    const job = exportJob(batch);
    if (finishing || !job) return;
    setFinishing(batch.id);
    try {
      const file = await renderFile(job);
      downloadBlob(file, file.name);
    } catch (e) { await failedAlert(e); } finally { setFinishing(null); }
  }, [finishing, exportJob, failedAlert]);

  const editPrices = useCallback(async (batch: Batch) => {
    const ok = await dialog.confirm({ title: t('edit_prices_title'), message: t('edit_prices_msg'), okLabel: t('edit_prices_ok') });
    if (ok) scanner.unlockBatch(batch.id);
  }, [dialog, t, scanner.unlockBatch]);

  const runFinishAll = useCallback(async (key: string, targets: Batch[], postId: number | null) => {
    if (finishing || targets.length === 0) return;
    setFinishing(key);
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
  // (local SQLite lookups, no Gemini, no network out). The cards come back
  // into the batch's response in place, so the seller's own prices, foil
  // and quantities stay.
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

  return {
    numbers, exportJob, finishing, finishPhoto, deliverPhoto, editPrices, explainFinish, runFinishAll,
    addCard, takeOutCard, refreshScanPrices,
  };
}

export type PhotoActions = ReturnType<typeof usePhotoActions>;
