import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteScan as apiDeleteScan,
  fetchScans,
  relookup as apiRelookup,
  scanImage,
  type SavedScan,
} from '../api.ts';
import type { Batch, Candidate, RelookupMsg } from '../types.ts';
import { generateBatchId } from '../utils.ts';

// Per-card UI state is persisted to localStorage under `mtg.batchstate.{scanId}`.
// We strip the heavy `response` blob — that lives on the server and comes back
// via GET /api/scans on every page load.
interface PersistedBatchState {
  isFoil: boolean[];
  priceOverride: (string | null)[];
  quantity: number[];
  multOverride: (number | null)[];
  removed: boolean[];
}

const STATE_KEY = (scanId: number) => `mtg.batchstate.${scanId}`;

function persistBatch(b: Batch) {
  if (!b.scanId) return;
  const payload: PersistedBatchState = {
    isFoil: b.isFoil,
    priceOverride: b.priceOverride,
    quantity: b.quantity,
    multOverride: b.multOverride,
    removed: b.removed,
  };
  try {
    localStorage.setItem(STATE_KEY(b.scanId), JSON.stringify(payload));
  } catch {
    // localStorage quota or disabled — ignore, state just won't survive refresh
  }
}

function loadPersistedState(scanId: number, cardCount: number): PersistedBatchState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY(scanId));
    if (!raw) return null;
    const p = JSON.parse(raw) as PersistedBatchState;
    // Only trust the saved state if the array lengths still match the scan;
    // protects against schema drift / partial saves
    if (p.isFoil?.length !== cardCount) return null;
    return p;
  } catch {
    return null;
  }
}

function batchFromSavedScan(saved: SavedScan): Batch {
  const n = saved.cards.length;
  const id = `s${saved.scan_id}`;
  const persisted = loadPersistedState(saved.scan_id, n);
  return {
    id,
    scanId: saved.scan_id,
    filename: saved.filename,
    status: 'done',
    response: {
      image_id: saved.image_id,
      image_b64: saved.image_b64,
      width: saved.width,
      height: saved.height,
      cards: saved.cards,
    },
    isFoil: persisted?.isFoil ?? new Array(n).fill(false),
    priceOverride: persisted?.priceOverride ?? new Array(n).fill(null),
    quantity: persisted?.quantity ?? new Array(n).fill(1),
    multOverride: persisted?.multOverride ?? new Array(n).fill(null),
    removed: persisted?.removed ?? new Array(n).fill(false),
    relookupBusy: new Array(n).fill(false),
    relookupMsg: new Array(n).fill(null),
  };
}

export function useScanner() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);

  // Track which batches have been persisted this render — avoids re-writing
  // localStorage for batches whose state hasn't changed.
  const lastPersistedRef = useRef<Map<string, string>>(new Map());

  // Initial rehydration from backend
  useEffect(() => {
    let cancelled = false;
    fetchScans().then(
      saved => {
        if (cancelled) return;
        // Reverse so newest is at the END of the array (matches "append on upload" UX);
        // pick the most-recent as active.
        const ordered = [...saved].reverse();
        const seeded = ordered.map(batchFromSavedScan);
        setBatches(seeded);
        setActiveBatchId(seeded[seeded.length - 1]?.id ?? null);
        setLoadingSaved(false);
      },
      () => {
        if (cancelled) return;
        setLoadingSaved(false);
      },
    );
    return () => { cancelled = true; };
  }, []);

  // Persist on every state change (cheap — localStorage write per batch)
  useEffect(() => {
    for (const b of batches) {
      if (b.status !== 'done' || !b.scanId) continue;
      const fingerprint = JSON.stringify([b.isFoil, b.priceOverride, b.quantity, b.multOverride, b.removed]);
      if (lastPersistedRef.current.get(b.id) === fingerprint) continue;
      persistBatch(b);
      lastPersistedRef.current.set(b.id, fingerprint);
    }
  }, [batches]);

  const patchBatch = useCallback((id: string, patch: Partial<Batch>) => {
    setBatches(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const updateCardArray = useCallback(
    <K extends keyof Batch, T>(batchId: string, field: K, idx: number, value: T) => {
      setBatches(prev =>
        prev.map(b => {
          if (b.id !== batchId) return b;
          const arr = [...(b[field] as unknown as T[])];
          arr[idx] = value;
          return { ...b, [field]: arr } as Batch;
        }),
      );
    },
    [],
  );

  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const id = generateBatchId();
      const stub: Batch = {
        id,
        scanId: null,
        filename: file.name,
        status: 'scanning',
        response: null,
        isFoil: [], priceOverride: [], quantity: [],
        multOverride: [], removed: [],
        relookupBusy: [], relookupMsg: [],
      };
      setBatches(prev => [...prev, stub]);
      setActiveBatchId(id);

      try {
        const resp = await scanImage(file);
        const n = resp.cards.length;
        // Server-side scan_id is what we'll persist UI state against
        const scanId = (resp as unknown as { scan_id?: number }).scan_id ?? null;
        patchBatch(id, {
          status: 'done',
          scanId,
          response: resp,
          isFoil: resp.cards.map(() => false),
          priceOverride: new Array(n).fill(null),
          // Seed quantity from Gemini's stack-detection hint (capped at 1+); user can adjust per row
          quantity: resp.cards.map(c => Math.max(1, c.gemini?.quantity || 1)),
          multOverride: new Array(n).fill(null),
          removed: new Array(n).fill(false),
          relookupBusy: new Array(n).fill(false),
          relookupMsg: new Array(n).fill(null),
        });
      } catch (e) {
        patchBatch(id, { status: 'error', error: (e as Error).message });
      }
    }
  }, [patchBatch]);

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
    async (batchId: string, idx: number, name: string, t: (k: string, v?: Record<string, string | number>) => string) => {
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
    (batchId: string, idx: number, name: string, t: (k: string, v?: Record<string, string | number>) => string) => {
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

  const clearAll = useCallback(async () => {
    const toDelete = batches.filter(b => b.scanId).map(b => b.scanId as number);
    setBatches([]);
    setActiveBatchId(null);
    for (const sid of toDelete) {
      try {
        localStorage.removeItem(STATE_KEY(sid));
        await apiDeleteScan(sid);
      } catch {
        // ignore; backend or storage may already be gone
      }
    }
  }, [batches]);

  const removeBatch = useCallback(async (id: string) => {
    const b = batches.find(x => x.id === id);
    setBatches(prev => prev.filter(x => x.id !== id));
    setActiveBatchId(prev => {
      if (prev !== id) return prev;
      const remaining = batches.filter(x => x.id !== id);
      return remaining[0]?.id ?? null;
    });
    if (b?.scanId) {
      try {
        localStorage.removeItem(STATE_KEY(b.scanId));
        await apiDeleteScan(b.scanId);
      } catch {
        // Backend may already be gone; ignore
      }
    }
  }, [batches]);

  return {
    batches,
    activeBatchId,
    setActiveBatchId,
    loadingSaved,
    addFiles,
    removeBatch,
    clearAll,
    toggleFoil,
    setAllFoil,
    setPriceOverride,
    setQuantity,
    stepQuantity,
    setMultOverride,
    stepMult,
    setRemoved,
    restoreAll,
    relookupByName,
    useAsIs,
    replaceCandidate,
    setRelookupMsg,
  };
}

export type ScannerStore = ReturnType<typeof useScanner>;
