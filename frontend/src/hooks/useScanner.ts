import { useCallback, useEffect, useRef, useState } from 'react';
import { relookup as apiRelookup } from '../api/catalogue.ts';
import { deleteScan as apiDeleteScan, fetchScans, SCANS_PAGE, saveScanState, scanImage, type SavedScan, moveScans as apiMoveScans, orderScans as apiOrderScans, recordCorrection } from '../api/scans.ts';
import type { Credits } from '../api/credits.ts';
import { OutOfCreditsError, statusOf } from '../api/http.ts';
import type { Key } from '../i18n/index.ts';
import { forgetLocalBatchState, keepSharedTombstones, localBatchState, sharedTombstones } from '../lib/legacy.ts';
import { correctionFor, editCardState, freshState, normalizeUiState, uiStateOf, withCard, type CardState, type LockedPrice, type ScanUiState } from '../lib/scanState.ts';
import { KEY, readTombstones, writeTombstones } from '../lib/storage.ts';
import type { Batch, Candidate, DetectedCard } from '../types.ts';
import { bboxKey, canRetry, generateBatchId } from '../utils.ts';
import { RETRY_MS, useSaveQueue } from './useSaveQueue.ts';

const SAVE_DELAY_MS = 800;
const SCAN_CONCURRENCY = 3;

// Tombstones: scan IDs the user has asked to delete but whose backend DELETE
// hasn't been confirmed yet. Survives reload so a refresh-mid-clear can't
// cause deleted scans to reappear, and so the unsent deletes get retried.
function addTombstones(key: string, ids: number[]) {
  if (!ids.length) return;
  const s = readTombstones(key);
  ids.forEach(id => s.add(id));
  writeTombstones(key, s);
}

function removeTombstones(key: string, ids: number[]) {
  if (!ids.length) return;
  const s = readTombstones(key);
  let changed = false;
  ids.forEach(id => { if (s.delete(id)) changed = true; });
  if (changed) writeTombstones(key, s);
}

// Delete a saved scan. Tombstoned until the server confirms, so a failed
// delete is retried by the rehydration effect on the next mount.
async function deleteSaved(key: string, sid: number) {
  addTombstones(key, [sid]);
  try {
    await apiDeleteScan(sid);
    removeTombstones(key, [sid]);
  } catch { /* tombstone persists */ }
}

function batchFromSavedScan(saved: SavedScan): Batch {
  return {
    id: `s${saved.scan_id}`,
    scanId: saved.scan_id,
    postId: saved.post_id ?? null,
    position: saved.position ?? null,
    listed: (saved.listed ?? []).map(bboxKey),
    filename: saved.filename,
    status: 'done',
    response: {
      image_id: saved.image_id,
      image_b64: saved.image_b64,
      thumb_url: saved.thumb_url,
      width: saved.width,
      height: saved.height,
      cards: saved.cards,
    },
    ...normalizeUiState(saved.ui_state, saved.cards),
  };
}

// signOut is called if the server no longer knows the session. onCredits gets
// the balance each scan answers with (a scan may cost a credit).
export function useScanner(userId: number | null, signOut: () => void, onCredits: (credits: Credits) => void) {
  const tombKey = KEY.tombstones(userId);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [notice, setNotice] = useState<Key | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  // Latest batches, for work that finishes after they changed. Every change
  // goes through commit, so the ref is never behind.
  const batchesRef = useRef(batches);
  const commit = useCallback((fn: (prev: Batch[]) => Batch[]) => {
    batchesRef.current = fn(batchesRef.current);
    setBatches(batchesRef.current);
  }, []);

  // Per-card edits go to the server through the save queue. The server
  // orders a scan's saves by rev, so they may overlap.
  const { queue: saves, later: flushLater, flush: flushSaves } = useSaveQueue<number, ScanUiState>(
    (scanId, state, final, rev) => saveScanState(scanId, { ...state, rev }, final),
    scanId => {
      forgetLocalBatchState(scanId);
      // The server has written the picks into the scan; sending them again would only rewrite it.
      if (!saves.busy(scanId)) commit(prev => prev.map(b => (b.scanId === scanId && b.picks.some(Boolean) ? { ...b, picks: b.picks.map(() => null) } : b)));
    },
    () => setNotice('scans_save_failed'),
  );

  // Initial rehydration from backend, a page at a time, newest first. Each
  // page shows as it arrives; loadingSaved stays true until the last one. A
  // page that fails is retried (e.g. during a redeploy) after saying so; if
  // the session is gone, the user is signed out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Tombstoned scans are hidden and deleted again. The tombstones every
      // user shared are honoured too; this user takes over those that are its scans.
      const old = sharedTombstones();
      const tombstones = new Set([...readTombstones(tombKey), ...old]);
      const serverIds = new Set<number>();
      for (let before: number | undefined, told = false; ;) {
        let page: SavedScan[];
        try {
          page = await fetchScans(before);
        } catch (e) {
          if (cancelled) return;
          if (statusOf(e) === 401) return signOut();
          if (!told) setNotice('scans_load_failed');
          told = true;
          await new Promise(r => setTimeout(r, RETRY_MS));
          if (cancelled) return;
          continue;
        }
        if (cancelled) return;
        page.forEach(s => serverIds.add(s.scan_id));
        const kept = page.filter(s => !tombstones.has(s.scan_id));
        let seeded = false;
        const loaded = kept.reverse().map(s => {
          const local = s.ui_state ? null : localBatchState(s.scan_id);
          if (!local) return batchFromSavedScan(s);
          const b = batchFromSavedScan({ ...s, ui_state: local });
          saves.save(s.scan_id, uiStateOf(b));
          seeded = true;
          return b;
        });
        // Older pages go in front: newest is at the END of the array
        // (matches "append on upload" UX). A photo already in the list stays
        // once, so loading again (e.g. the effect re-running) can't double it.
        commit(prev => {
          const have = new Set(prev.map(b => b.scanId));
          return [...loaded.filter(b => !have.has(b.scanId)), ...prev];
        });
        if (seeded) flushLater(SAVE_DELAY_MS);
        if (page.length < SCANS_PAGE) break;
        before = page[page.length - 1].scan_id;
      }

      // Still on the server: delete again (which tombstones it under this
      // user). Gone: the earlier DELETE worked, we just never got to clear
      // its tombstone.
      keepSharedTombstones(Array.from(old).filter(id => !serverIds.has(id)));
      tombstones.forEach(id => serverIds.has(id) && deleteSaved(tombKey, id));
      removeTombstones(tombKey, Array.from(tombstones).filter(id => !serverIds.has(id)));
      setLoadingSaved(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, tombKey, signOut, saves]);

  useEffect(() => {
    let changed = false;
    for (const b of batches) {
      if (b.status === 'done' && b.scanId && saves.update(b.scanId, uiStateOf(b), b.rev)) changed = true;
    }
    if (changed) flushLater(SAVE_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, saves]);

  const patchBatch = useCallback((id: string, patch: Partial<Batch>) => {
    commit(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const editCard = useCallback((batchId: string, idx: number, patch: Partial<CardState>) => {
    commit(prev => prev.map(b => (b.id === batchId ? editCardState(b, idx, patch) : b)));
  }, []);

  // Scans run three at a time: each one mostly waits on Gemini (~6 s), so
  // running them side by side cuts a 10-photo drop from ~70 s to ~25 s. One
  // shared queue, so a second drop while the first is running joins it
  // instead of doubling up.
  const scanQueue = useRef<Array<() => Promise<void>>>([]);
  const scansRunning = useRef(0);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const pumpScanQueue = useCallback(() => {
    while (scansRunning.current < SCAN_CONCURRENCY && scanQueue.current.length) {
      const job = scanQueue.current.shift()!;
      scansRunning.current += 1;
      job().finally(() => {
        scansRunning.current -= 1;
        setScanProgress(p => (!p || p.done + 1 >= p.total ? null : { ...p, done: p.done + 1 }));
        pumpScanQueue();
      });
    }
  }, []);

  // Queue one photo's scan, filed under postId. Used by a new drop and by a
  // retry, so the scan runs the same way both times.
  const queueScan = useCallback((id: string, file: File, postId: number | null) => {
    // The batch list is the only record of what happened to a photo while it
    // waited or scanned: gone means deleted, another postId means moved.
    const current = () => batchesRef.current.find(b => b.id === id);
    scanQueue.current.push(async () => {
      if (!current()) return;
      try {
        const resp = await scanImage(file, postId);
        onCredits(resp.credits);
        const scanId = resp.scan_id;
        const b = current();
        if (!b) {
          deleteSaved(tombKey, scanId);
          return;
        }
        if (b.postId !== postId) {
          apiMoveScans([scanId], b.postId).catch(() => {
            patchBatch(id, { postId });
            setNotice('scans_move_failed');
          });
        }
        patchBatch(id, {
          status: 'done',
          // Only a failed scan needs the photo again; let the memory go.
          file: undefined,
          scanId,
          response: resp,
          ...freshState(resp.cards),
        });
      } catch (e) {
        if (e instanceof OutOfCreditsError && e.credits) onCredits(e.credits);
        patchBatch(id, {
          status: 'error',
          error: (e as Error).message,
          outOfCredits: e instanceof OutOfCreditsError,
        });
      }
    });
  }, [onCredits, patchBatch, tombKey]);

  const addFiles = useCallback(async (files: File[], postId: number | null = null) => {
    if (!files.length) return;
    // Every dropped photo shows at once, before its turn in the scan queue, so
    // a big drop doesn't look like only one photo went in.
    const stubs: Batch[] = files.map(file => ({
      id: generateBatchId(),
      scanId: null,
      postId,
      position: null,
      listed: [],
      filename: file.name,
      file,
      status: 'scanning',
      response: null,
      ...freshState([]),
    }));
    commit(prev => [...prev, ...stubs]);

    setScanProgress(p => ({ done: p?.done ?? 0, total: (p?.total ?? 0) + stubs.length }));
    stubs.forEach((b, i) => queueScan(b.id, files[i], postId));
    pumpScanQueue();
  }, [commit, pumpScanQueue, queueScan]);

  const retryBatches = useCallback((ids: string[]) => {
    const retry = batchesRef.current.filter(canRetry).filter(b => ids.includes(b.id));
    if (!retry.length) return;
    const again = new Set(retry.map(b => b.id));
    commit(prev => prev.map(b => (again.has(b.id)
      ? { ...b, status: 'scanning', error: undefined, outOfCredits: undefined }
      : b)));
    setScanProgress(p => ({ done: p?.done ?? 0, total: (p?.total ?? 0) + retry.length }));
    retry.forEach(b => queueScan(b.id, b.file, b.postId));
    pumpScanQueue();
  }, [commit, pumpScanQueue, queueScan]);

  const setAllFoil = useCallback((batchId: string, foil: boolean) => {
    commit(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        return {
          ...b,
          isFoil: b.isFoil.map((cur, i) => (b.removed[i] ? cur : foil)),
        };
      }),
    );
  }, []);

  // Removed or restored by hand: no longer a card sold on an earlier post,
  // so it is never covered on the photo.
  const setRemoved = useCallback(
    (batchId: string, idx: number, removed: boolean) => editCard(batchId, idx, { removed, sold: false }),
    [editCard],
  );

  // The photo is finished (on its post and downloaded or shared): its prices
  // stay what buyers saw until the seller chooses Edit prices.
  const lockBatch = useCallback((batchId: string, locked: (LockedPrice | null)[]) => {
    const at = new Date().toISOString();
    commit(prev => prev.map(b => (b.id === batchId ? { ...b, locked, lockedAt: at } : b)));
  }, []);
  const unlockBatch = useCallback((batchId: string) => {
    commit(prev => prev.map(b => (b.id === batchId ? { ...b, locked: b.locked.map(() => null), lockedAt: null } : b)));
  }, []);

  const markListed = useCallback((batchId: string, bbox: number[]) => {
    const key = bboxKey(bbox);
    commit(prev => prev.map(b => (b.id === batchId && !b.listed.includes(key) ? { ...b, listed: [...b.listed, key] } : b)));
  }, []);

  const unmarkListed = useCallback((batchId: string, bbox: number[]) => {
    const key = bboxKey(bbox);
    commit(prev => prev.map(b => (b.id === batchId ? { ...b, listed: b.listed.filter(k => k !== key) } : b)));
  }, []);

  const looksRight = useCallback((batchId: string, idx: number) => {
    editCard(batchId, idx, { versionOk: true });
    const batch = batchesRef.current.find(b => b.id === batchId);
    const answer = batch && correctionFor(batch, idx);
    if (answer) recordCorrection(answer);
  }, [editCard]);

  // A card the seller framed by hand (see PhotoPage's Add card) joins the photo's cards.
  const appendFramedCard = useCallback((batchId: string, card: DetectedCard) => {
    commit(prev => prev.map(b => (b.id !== batchId || !b.response ? b
      : withCard({ ...b, response: { ...b.response, cards: [...b.response.cards, card] } }, card))));
  }, []);

  // The cards as Refresh prices answers them: the server keeps each card's
  // bbox and corners and changes only candidate prices. The seller's edits
  // live in the per-card state, not in `response`, so they survive.
  const replaceAllCards = useCallback((batchId: string, cards: DetectedCard[]) => {
    commit(prev =>
      prev.map(b => {
        if (b.id !== batchId || !b.response) return b;
        // Picks are cleared once saved, so one still here has not reached the server's cards yet.
        const picked = cards.map((card, i) => (b.picks[i] ? { ...card, candidates: [b.picks[i]!, ...card.candidates.slice(1)] } : card));
        return { ...b, response: { ...b.response, cards: picked } };
      }),
    );
  }, []);

  const replaceCandidate = useCallback((batchId: string, idx: number, c: Candidate) => {
    commit(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        if (!b.response) return b;
        const cards = b.response.cards.map((card, i) =>
          i === idx ? { ...card, candidates: [c, ...card.candidates.slice(1)] } : card,
        );
        return editCardState({ ...b, response: { ...b.response, cards } }, idx, { priceOverride: null, picks: c });
      }),
    );
  }, []);

  const pickPrinting = useCallback((batchId: string, idx: number, printing: Candidate) => {
    const before = batchesRef.current.find(b => b.id === batchId);
    const answer = before && correctionFor(before, idx, printing);
    replaceCandidate(batchId, idx, { ...printing, _lookup_failed: false, _manual: false });
    // The seller chose this printing, so the "check the version" notice is answered.
    editCard(batchId, idx, { versionOk: true });
    if (answer) recordCorrection(answer);
  }, [editCard, replaceCandidate]);

  // Another card by name: the match found becomes the card's; rejects as the lookup does.
  const relookupByName = useCallback(async (batchId: string, idx: number, name: string) => {
    const summary = await apiRelookup(name);
    replaceCandidate(batchId, idx, { ...summary, _lookup_failed: false, _manual: false });
    return summary;
  }, [replaceCandidate]);

  // The name as typed, priced by hand.
  const useAsIs = useCallback((batchId: string, idx: number, name: string) => {
    replaceCandidate(batchId, idx, {
      scryfall_id: '', name,
      set: '', set_name: '', collector_number: '', rarity: '',
      usd: 0, usd_foil: 0,
      image_url: '', scryfall_uri: '',
      price_source_normal: 'manual', price_source_foil: 'manual',
      ck_url_normal: '', ck_url_foil: '',
      _lookup_failed: false, _manual: true,
    });
  }, [replaceCandidate]);

  // File photos under another post (or unfile them). Optimistic: the gallery
  // regroups at once; if the server refuses, they go back where they were.
  const moveBatches = useCallback(async (ids: string[], postId: number | null) => {
    const moving = batchesRef.current.filter(b => ids.includes(b.id));
    const before = new Map(moving.map(b => [b.id, b.postId]));
    // Into another post: after its photos, until placed (as the server does).
    commit(prev => prev.map(b => (before.has(b.id) ? { ...b, postId, position: null } : b)));
    const scanIds = moving.filter(b => b.scanId != null).map(b => b.scanId as number);
    if (!scanIds.length) return;
    try {
      await apiMoveScans(scanIds, postId);
    } catch (e) {
      commit(prev => prev.map(b => (before.has(b.id) ? { ...b, postId: before.get(b.id) ?? null } : b)));
      throw e;
    }
  }, []);

  // A post's photos in a new order (`ids`, Photo 1 first): saved at once,
  // put back if the server says no.
  const orderBatches = useCallback(async (ids: string[]) => {
    const was = new Map(batchesRef.current.map(b => [b.id, b.position]));
    const place = new Map(ids.map((id, i) => [id, i]));
    commit(prev => prev.map(b => (place.has(b.id) ? { ...b, position: place.get(b.id)! } : b)));
    const scanIds = ids.map(id => batchesRef.current.find(b => b.id === id)?.scanId).filter((s): s is number => s != null);
    try {
      await apiOrderScans(scanIds);
    } catch (e) {
      commit(prev => prev.map(b => (place.has(b.id) ? { ...b, position: was.get(b.id) ?? null } : b)));
      throw e;
    }
  }, []);

  // The photos leave the list in one update, then their deletes run side by
  // side. A photo still waiting or scanning has no scan id yet; its scan job
  // sees it gone from the list and deletes what the server saved.
  const removeBatches = useCallback(async (ids: string[]) => {
    const gone = new Set(ids);
    const scanIds = batchesRef.current.flatMap(b => (gone.has(b.id) && b.scanId ? [b.scanId] : []));
    commit(prev => prev.filter(b => !gone.has(b.id)));
    scanIds.forEach(sid => saves.forget(sid));
    await Promise.all(scanIds.map(sid => deleteSaved(tombKey, sid)));
  }, [tombKey]);

  // Photos saved by another route (a repost's copies), shown as they come.
  const addSaved = useCallback((scans: SavedScan[]) => {
    commit(prev => [...prev, ...scans.map(batchFromSavedScan)]);
  }, [commit]);

  return {
    batches,
    loadingSaved,
    // Send unsaved edits now (before signing out).
    flush: () => flushSaves(true),
    notice,
    clearNotice,
    addFiles,
    retryBatches,
    lockBatch,
    unlockBatch,
    scanProgress,
    removeBatches,
    addSaved,
    moveBatches,
    orderBatches,
    editCard,
    setAllFoil,
    setRemoved,
    looksRight,
    markListed,
    unmarkListed,
    appendFramedCard,
    relookupByName,
    useAsIs,
    pickPrinting,
    replaceAllCards,
  };
}

export type ScannerStore = ReturnType<typeof useScanner>;
