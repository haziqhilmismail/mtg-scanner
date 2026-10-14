import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteScan as apiDeleteScan,
  fetchScans,
  SCANS_PAGE,
  relookup as apiRelookup,
  saveScanState,
  scanImage,
  type SavedScan,
  moveScans as apiMoveScans,
} from '../api.ts';
import { OutOfCreditsError } from '../api/http.ts';
import type { Batch, Candidate, DetectedCard, PillOffset, RelookupMsg, ScanUiState } from '../types.ts';
import { freshState, generateBatchId, normalizeUiState } from '../utils.ts';
import type { T } from './useLang.ts';

// Older versions kept per-card UI state in localStorage under this key; it is
// uploaded to the scan's ui_state once and then removed.
const STATE_KEY = (scanId: number) => `mtg.batchstate.${scanId}`;
const SAVE_DELAY_MS = 800;
// Scanner.tsx remembers per scan which cards went to the checklist.
export const ADDED_STORAGE_PREFIX = 'mtg.scanner.added.';

// Tombstones: scan IDs the user has asked to delete but whose backend DELETE
// hasn't been confirmed yet. Survives reload so a refresh-mid-clear can't
// cause deleted scans to reappear, and so the unsent deletes get retried.
const TOMBSTONE_KEY = 'mtg.scan_tombstones';
const SCAN_CONCURRENCY = 3;

function readTombstones(): Set<number> {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is number => typeof n === 'number'));
  } catch {
    return new Set();
  }
}

function writeTombstones(s: Set<number>) {
  try {
    if (s.size === 0) localStorage.removeItem(TOMBSTONE_KEY);
    else localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // quota / disabled — best effort
  }
}

function addTombstones(ids: number[]) {
  if (!ids.length) return;
  const s = readTombstones();
  ids.forEach(id => s.add(id));
  writeTombstones(s);
}

function removeTombstones(ids: number[]) {
  if (!ids.length) return;
  const s = readTombstones();
  let changed = false;
  ids.forEach(id => { if (s.delete(id)) changed = true; });
  if (changed) writeTombstones(s);
}

// Delete a saved scan. Tombstoned until the server confirms, so a failed
// delete is retried by the rehydration effect on the next mount.
async function deleteSaved(sid: number) {
  addTombstones([sid]);
  try {
    await apiDeleteScan(sid);
    removeTombstones([sid]);
  } catch { /* tombstone persists */ }
}

// What is saved to the server for a batch.
function uiStateOf(b: Batch): ScanUiState {
  return {
    isFoil: b.isFoil,
    priceOverride: b.priceOverride,
    quantity: b.quantity,
    multOverride: b.multOverride,
    removed: b.removed,
    pillOffset: b.pillOffset,
  };
}

// Older versions kept per-card edits in this browser; upload that copy once
// to a scan that has none on the server (and use it), then forget it.
function uploadLegacyState(saved: SavedScan) {
  if (saved.ui_state) return;
  const key = STATE_KEY(saved.scan_id);
  let local: unknown = null;
  try { local = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* corrupt: ignore */ }
  if (!local) return;
  const state = normalizeUiState(local, saved.cards);
  saved.ui_state = state;
  saveScanState(saved.scan_id, state).then(
    () => { try { localStorage.removeItem(key); } catch { /* ignore */ } },
    () => { /* kept; uploaded on the next load */ },
  );
}

function batchFromSavedScan(saved: SavedScan): Batch {
  const n = saved.cards.length;
  return {
    id: `s${saved.scan_id}`,
    scanId: saved.scan_id,
    postId: saved.post_id ?? null,
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
    relookupBusy: new Array(n).fill(false),
    relookupMsg: new Array(n).fill(null),
  };
}

export function useScanner() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  // Latest batches, for work that finishes after they changed.
  const batchesRef = useRef(batches);
  batchesRef.current = batches;

  // Per-card edits go to the server: the last state seen per batch (the
  // first one seen is what the server already has), the states waiting to be
  // sent, and the timer that sends them once edits pause.
  const lastSavedRef = useRef<Map<string, string>>(new Map());
  const unsavedRef = useRef<Map<number, ScanUiState>>(new Map());
  const saveTimerRef = useRef<number | undefined>(undefined);

  // Send every waiting state. A failed one stays waiting and goes with the
  // next edit's save, unless a newer state for that scan is already waiting.
  const flushSaves = useCallback((keepalive = false) => {
    clearTimeout(saveTimerRef.current);
    const waiting = unsavedRef.current;
    for (const [scanId, state] of waiting) {
      waiting.delete(scanId);
      saveScanState(scanId, state, keepalive).catch((e: Error & { status?: number }) => {
        if (e.status !== 404 && !waiting.has(scanId)) waiting.set(scanId, state);
      });
    }
  }, []);

  // Leaving or hiding the page (phones rarely fire unload) sends what's waiting.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushSaves(true); };
    const onPageHide = () => flushSaves(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushSaves]);

  // Initial rehydration from backend, a page at a time, newest first. Each
  // page shows as it arrives; loadingSaved stays true until the last one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Honour tombstones: scans the user previously deleted but whose
      // backend DELETE never confirmed (e.g. refresh-mid-clear, backend
      // --reload kicked in, network blip). Filter them out of the UI and
      // fire the DELETE again so they're actually gone next time.
      const tombstones = readTombstones();
      const serverIds = new Set<number>();
      try {
        for (let before: number | undefined; ;) {
          const page = await fetchScans(before);
          if (cancelled) return;
          page.forEach(s => serverIds.add(s.scan_id));
          const kept = page.filter(s => !tombstones.has(s.scan_id));
          kept.forEach(uploadLegacyState);
          // Older pages go in front: newest is at the END of the array
          // (matches "append on upload" UX).
          setBatches(prev => [...kept.reverse().map(batchFromSavedScan), ...prev]);
          if (page.length < SCANS_PAGE) break;
          before = page[page.length - 1].scan_id;
        }
      } catch {
        if (!cancelled) setLoadingSaved(false);
        return;
      }

      const stillAlive = Array.from(tombstones).filter(id => serverIds.has(id));
      stillAlive.forEach(id => {
        apiDeleteScan(id).then(
          () => removeTombstones([id]),
          () => { /* keep tombstone; retried next mount */ },
        );
      });

      // GC tombstones for IDs the server no longer has (the previous
      // DELETE actually succeeded, we just never got to clear them).
      const orphanTombstones = Array.from(tombstones).filter(id => !serverIds.has(id));
      removeTombstones(orphanTombstones);

      // Drop "added" markers of scans that are gone (kept for any scanned
      // since this load started).
      batchesRef.current.forEach(b => b.scanId != null && serverIds.add(b.scanId));
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key?.startsWith(ADDED_STORAGE_PREFIX) && !serverIds.has(Number(key.slice(ADDED_STORAGE_PREFIX.length)))) {
            localStorage.removeItem(key);
          }
        }
      } catch { /* storage disabled */ }
      setLoadingSaved(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Queue a save for every finished batch whose per-card state changed.
  useEffect(() => {
    let changed = false;
    for (const b of batches) {
      if (b.status !== 'done' || !b.scanId) continue;
      const state = uiStateOf(b);
      const fingerprint = JSON.stringify(state);
      const last = lastSavedRef.current.get(b.id);
      if (last === fingerprint) continue;
      lastSavedRef.current.set(b.id, fingerprint);
      if (last === undefined) continue;
      unsavedRef.current.set(b.scanId, state);
      changed = true;
    }
    if (changed) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(flushSaves, SAVE_DELAY_MS);
    }
  }, [batches, flushSaves]);

  const patchBatch = useCallback((id: string, patch: Partial<Batch>) => {
    setBatches(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const updateCardArray = useCallback(
    <K extends keyof Batch, V>(batchId: string, field: K, idx: number, value: V) => {
      setBatches(prev =>
        prev.map(b => {
          if (b.id !== batchId) return b;
          const arr = [...(b[field] as unknown as V[])];
          arr[idx] = value;
          return { ...b, [field]: arr } as Batch;
        }),
      );
    },
    [],
  );

  // Scans run a few at a time: each one mostly waits on Gemini (~6 s), so
  // running them side by side cuts a 10-photo drop from ~70 s to ~25 s. Three
  // stays under the server's 30-scans-a-minute limit. One shared queue, so a
  // second drop while the first is running joins it instead of doubling up.
  const scanQueue = useRef<Array<() => Promise<void>>>([]);
  const scansRunning = useRef(0);
  // Photos deleted while still waiting or scanning: a waiting one is never
  // sent, a running one is deleted on the server as soon as it is saved.
  const removedWhileScanning = useRef<Set<string>>(new Set());
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const pumpScanQueue = useCallback(() => {
    while (scansRunning.current < SCAN_CONCURRENCY && scanQueue.current.length) {
      const job = scanQueue.current.shift()!;
      scansRunning.current += 1;
      job().finally(() => {
        scansRunning.current -= 1;
        // Clear the bar once the whole run is finished.
        setScanProgress(p => (!p || p.done + 1 >= p.total ? null : { ...p, done: p.done + 1 }));
        pumpScanQueue();
      });
    }
  }, []);

  const addFiles = useCallback(async (files: File[], postId: number | null = null) => {
    if (!files.length) return;
    // Front-load every dropped file as a 'scanning' stub so the tab strip
    // shows all N immediately. Without this, sequential awaits below mean
    // file N+1's tab only appears once N finishes, which looks like
    // "only 1 file uploaded" to the user.
    const queued = files.map(file => ({
      file,
      id: generateBatchId(),
    }));
    const stubs: Batch[] = queued.map(({ file, id }) => ({
      id,
      scanId: null,
      postId,
      filename: file.name,
      status: 'scanning',
      response: null,
      isFoil: [], priceOverride: [], quantity: [],
      multOverride: [], removed: [], pillOffset: [],
      relookupBusy: [], relookupMsg: [],
    }));
    setBatches(prev => [...prev, ...stubs]);

    setScanProgress(p => ({ done: p?.done ?? 0, total: (p?.total ?? 0) + queued.length }));
    scanQueue.current.push(...queued.map(({ file, id }) => async () => {
      if (removedWhileScanning.current.has(id)) return;
      try {
        const resp = await scanImage(file, postId);
        const n = resp.cards.length;
        // Server-side scan_id is what we'll persist UI state against
        const scanId = (resp as unknown as { scan_id?: number }).scan_id ?? null;
        if (removedWhileScanning.current.has(id)) {
          if (scanId != null) deleteSaved(scanId);
          return;
        }
        // Moved to another post while scanning: file it there on the server too.
        const movedTo = batchesRef.current.find(b => b.id === id)?.postId;
        if (scanId != null && movedTo !== undefined && movedTo !== postId) {
          apiMoveScans([scanId], movedTo).catch(() => patchBatch(id, { postId }));
        }
        patchBatch(id, {
          status: 'done',
          scanId,
          response: resp,
          ...freshState(resp.cards),
          relookupBusy: new Array(n).fill(false),
          relookupMsg: new Array(n).fill(null),
        });
      } catch (e) {
        patchBatch(id, {
          status: 'error',
          error: (e as Error).message,
          outOfCredits: e instanceof OutOfCreditsError,
        });
      }
    }));
    pumpScanQueue();
  }, [patchBatch, pumpScanQueue]);

  const toggleFoil = useCallback((batchId: string, idx: number) => {
    setBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        const arr = [...b.isFoil];
        arr[idx] = !arr[idx];
        return { ...b, isFoil: arr };
      }),
    );
  }, []);

  const setAllFoil = useCallback((batchId: string, foil: boolean) => {
    setBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        return {
          ...b,
          isFoil: b.isFoil.map((cur, i) => (b.removed[i] ? cur : foil)),
        };
      }),
    );
  }, []);

  const setPriceOverride = useCallback(
    (batchId: string, idx: number, v: string | null) =>
      updateCardArray(batchId, 'priceOverride', idx, v),
    [updateCardArray],
  );

  const setQuantity = useCallback(
    (batchId: string, idx: number, qty: number) =>
      updateCardArray(batchId, 'quantity', idx, Math.max(1, qty | 0)),
    [updateCardArray],
  );

  const stepQuantity = useCallback((batchId: string, idx: number, delta: number) => {
    setBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        const arr = [...b.quantity];
        arr[idx] = Math.max(1, (arr[idx] || 1) + delta);
        return { ...b, quantity: arr };
      }),
    );
  }, []);

  const setMultOverride = useCallback(
    (batchId: string, idx: number, v: number | null) =>
      updateCardArray(batchId, 'multOverride', idx, v),
    [updateCardArray],
  );

  const stepMult = useCallback(
    (batchId: string, idx: number, delta: number, globalMult: number) => {
      setBatches(prev =>
        prev.map(b => {
          if (b.id !== batchId) return b;
          const arr = [...b.multOverride];
          const cur = arr[idx] != null ? arr[idx]! : globalMult;
          const next = Math.max(0, +(cur + delta).toFixed(2));
          arr[idx] = Math.abs(next - globalMult) < 1e-9 ? null : next;
          return { ...b, multOverride: arr };
        }),
      );
    },
    [],
  );

  const setRemoved = useCallback(
    (batchId: string, idx: number, removed: boolean) =>
      updateCardArray(batchId, 'removed', idx, removed),
    [updateCardArray],
  );

  const setPillOffset = useCallback(
    (batchId: string, idx: number, offset: PillOffset | null) =>
      updateCardArray(batchId, 'pillOffset', idx, offset),
    [updateCardArray],
  );

  // Append a user-framed card (from the framing tool in BatchPreview's expand
  // mode). Pushes onto every parallel array so indices stay aligned. Seeded
  // foil=false, qty=1 unless the backend hint says otherwise.
  const appendFramedCard = useCallback((batchId: string, card: DetectedCard) => {
    setBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId || !b.response) return b;
        const cards = [...b.response.cards, card];
        const sel = card.candidates[0];
        const isManual = !!sel?._manual;
        return {
          ...b,
          response: { ...b.response, cards },
          isFoil: [...b.isFoil, card.gemini?.is_foil ?? false],
          // Manual stubs have no auto-price; UI flags via the existing
          // _manual banner and forces a price override.
          priceOverride: [...b.priceOverride, null],
          quantity: [...b.quantity, Math.max(1, card.gemini?.quantity || 1)],
          multOverride: [...b.multOverride, null],
          removed: [...b.removed, false],
          pillOffset: [...b.pillOffset, null],
          relookupBusy: [...b.relookupBusy, false],
          relookupMsg: [...b.relookupMsg, isManual
            ? { type: 'err', text: 'no match — type a name to look it up', action: 'use as-is' }
            : null],
        } satisfies Batch;
      }),
    );
  }, []);

  const restoreAll = useCallback((batchId: string) => {
    setBatches(prev =>
      prev.map(b => (b.id === batchId ? { ...b, removed: b.removed.map(() => false) } : b)),
    );
  }, []);

  const setRelookupMsg = useCallback(
    (batchId: string, idx: number, msg: RelookupMsg | null) =>
      updateCardArray(batchId, 'relookupMsg', idx, msg),
    [updateCardArray],
  );

  // Swap the entire cards array — used by the per-scan "↻ Refresh prices"
  // flow, which gets a fully re-enriched cards[] from the backend. Parent
  // card fields (bbox, corners) are preserved server-side; only candidate
  // pricing fields change. User overrides (priceOverride / multOverride /
  // isFoil) live in the batch state, not in `response`, so they survive.
  const replaceAllCards = useCallback((batchId: string, cards: DetectedCard[]) => {
    setBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId || !b.response) return b;
        return { ...b, response: { ...b.response, cards } };
      }),
    );
  }, []);

  const replaceCandidate = useCallback((batchId: string, idx: number, c: Candidate) => {
    setBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        if (!b.response) return b;
        const cards = b.response.cards.map((card, i) =>
          i === idx ? { ...card, candidates: [c, ...card.candidates.slice(1)] } : card,
        );
        const priceOverride = [...b.priceOverride];
        priceOverride[idx] = null;
        return { ...b, response: { ...b.response, cards }, priceOverride };
      }),
    );
  }, []);

  const relookupByName = useCallback(
    async (batchId: string, idx: number, name: string, t: T) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setRelookupMsg(batchId, idx, { type: 'err', text: t('msg_type_name_first') });
        return;
      }
      updateCardArray(batchId, 'relookupBusy', idx, true);
      setRelookupMsg(batchId, idx, { type: 'busy', text: t('msg_searching') });
      try {
        const summary = await apiRelookup(trimmed);
        replaceCandidate(batchId, idx, { ...summary, _lookup_failed: false, _manual: false });
        updateCardArray(batchId, 'relookupBusy', idx, false);
        setRelookupMsg(batchId, idx, { type: 'ok', text: t('msg_updated', { name: summary.name }) });
        setTimeout(() => {
          setBatches(prev =>
            prev.map(b => {
              if (b.id !== batchId) return b;
              const arr = [...b.relookupMsg];
              if (arr[idx]?.type === 'ok') arr[idx] = null;
              return { ...b, relookupMsg: arr };
            }),
          );
        }, 2500);
      } catch (e) {
        updateCardArray(batchId, 'relookupBusy', idx, false);
        const err = e as Error & { status?: number };
        if (err.status === 404) {
          setRelookupMsg(batchId, idx, {
            type: 'err',
            text: t('msg_not_found'),
            action: t('msg_use_asis_action'),
          });
        } else {
          setRelookupMsg(batchId, idx, { type: 'err', text: t('msg_lookup_failed', { err: err.message }) });
        }
      }
    },
    [replaceCandidate, setRelookupMsg, updateCardArray],
  );

  const useAsIs = useCallback(
    (batchId: string, idx: number, name: string, t: T) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setRelookupMsg(batchId, idx, { type: 'err', text: t('msg_type_name_then_asis') });
        return;
      }
      const stub: Candidate = {
        scryfall_id: '', name: trimmed,
        set: '', set_name: '', collector_number: '', rarity: '',
        usd: 0, usd_foil: 0,
        image_url: '', scryfall_uri: '',
        price_source_normal: 'manual', price_source_foil: 'manual',
        ck_url_normal: '', ck_url_foil: '',
        _lookup_failed: false, _manual: true,
      };
      replaceCandidate(batchId, idx, stub);
      updateCardArray(batchId, 'relookupBusy', idx, false);
      setRelookupMsg(batchId, idx, { type: 'ok', text: t('msg_now_manual') });
    },
    [replaceCandidate, setRelookupMsg, updateCardArray],
  );

  // File photos under another post (or unfile them). Optimistic: the gallery
  // regroups at once; if the server refuses, they go back where they were.
  const moveBatches = useCallback(async (ids: string[], postId: number | null) => {
    const before = new Map(batches.filter(b => ids.includes(b.id)).map(b => [b.id, b.postId]));
    setBatches(prev => prev.map(b => (before.has(b.id) ? { ...b, postId } : b)));
    const scanIds = batches.filter(b => before.has(b.id) && b.scanId != null).map(b => b.scanId as number);
    if (!scanIds.length) return;
    try {
      await apiMoveScans(scanIds, postId);
    } catch (e) {
      setBatches(prev => prev.map(b => (before.has(b.id) ? { ...b, postId: before.get(b.id) ?? null } : b)));
      throw e;
    }
  }, [batches]);

  const removeBatch = useCallback(async (id: string) => {
    const b = batches.find(x => x.id === id);
    setBatches(prev => prev.filter(x => x.id !== id));
    if (b?.scanId) {
      unsavedRef.current.delete(b.scanId);
      await deleteSaved(b.scanId);
    } else if (b) {
      removedWhileScanning.current.add(id);
    }
  }, [batches]);

  return {
    batches,
    loadingSaved,
    addFiles,
    scanProgress,
    removeBatch,
    moveBatches,
    toggleFoil,
    setAllFoil,
    setPriceOverride,
    setQuantity,
    stepQuantity,
    setMultOverride,
    stepMult,
    setRemoved,
    setPillOffset,
    appendFramedCard,
    restoreAll,
    relookupByName,
    useAsIs,
    replaceCandidate,
    replaceAllCards,
    setRelookupMsg,
  };
}

export type ScannerStore = ReturnType<typeof useScanner>;
