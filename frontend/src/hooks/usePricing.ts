import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMe, saveDefaultPricing } from '../api/auth.ts';
import { postsApi, type Post } from '../api/checklist.ts';
import { defaultToUpload, LEGACY_KEY, LEGACY_VERSION_KEY, legacyPricing, resolvePricing } from '../lib/pricing.ts';
import type { Settings } from '../types.ts';

// Edits are saved this long after the last change.
const SAVE_DELAY_MS = 600;

interface State {
  // The user's default pricing; null = none set (the built-in default applies).
  userDefault: Settings | null;
  // Each post's own pricing, from the server's post lists; null = follows the default.
  posts: Record<number, Settings | null>;
}

// What gets saved: a post's pricing, or (null) the user's default.
type Target = number | null;

function readLegacy(): Settings | null {
  try { return legacyPricing(localStorage.getItem(LEGACY_KEY), localStorage.getItem(LEGACY_VERSION_KEY)); } catch { return null; }
}

function forgetLegacy() {
  try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(LEGACY_VERSION_KEY); } catch { /* ignore */ }
}

// Pricing per post plus the user's default, kept on the server. Edits show at
// once and are saved shortly after; leaving the page sends them straight away.
export function usePricing() {
  // Until /me answers, the browser's old pricing (if any) stands in for the default.
  const [state, setState] = useState<State>(() => ({ userDefault: readLegacy(), posts: {} }));
  const stateRef = useRef(state);
  const set = useCallback((next: State) => { stateRef.current = next; setState(next); }, []);
  const [notice, setNotice] = useState<string | null>(null);

  // Edits waiting to be sent, and saves on their way (one per target at a
  // time, so an older save can't land after a newer one).
  const pending = useRef(new Map<Target, Settings>());
  const inFlight = useRef(new Set<Target>());
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback((final = false) => {
    window.clearTimeout(timer.current);
    for (const [target, pricing] of [...pending.current]) {
      if (inFlight.current.has(target) && !final) continue;
      pending.current.delete(target);
      inFlight.current.add(target);
      (target == null ? saveDefaultPricing(pricing, final) : postsApi.update(target, { pricing }, final))
        .catch(() => setNotice('pricing_save_failed'))
        .finally(() => {
          inFlight.current.delete(target);
          if (pending.current.has(target)) flush();
        });
    }
  }, []);

  const queue = useCallback((target: Target, pricing: Settings, delay = SAVE_DELAY_MS) => {
    pending.current.set(target, pricing);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(), delay);
  }, [flush]);

  const busy = (target: Target) => pending.current.has(target) || inFlight.current.has(target);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush]);

  // The default from the server. If it has none, the browser's old pricing
  // becomes it, once; the browser's copy goes when the server has one.
  useEffect(() => {
    fetchMe().then(me => {
      const upload = defaultToUpload(me.pricing, readLegacy());
      if (!busy(null)) set({ ...stateRef.current, userDefault: upload ?? me.pricing ?? null });
      if (upload) saveDefaultPricing(upload).then(forgetLegacy, () => { /* tried again next visit */ });
      else if (me.pricing != null) forgetLegacy();
    }, () => { /* offline: the stand-in default stays */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Post lists from the server bring each post's pricing; a post with an
  // edit not yet saved keeps the edit.
  const learn = useCallback((list: Post[]) => {
    const posts = { ...stateRef.current.posts };
    for (const p of list) if (!busy(p.id)) posts[p.id] = p.pricing ?? null;
    set({ ...stateRef.current, posts });
  }, [set]);

  // THE answer to "what pricing does this post's (or, for null, an unfiled
  // photo's) photos use". Every price, total and export goes through it.
  // Cached per state, so a post's pricing keeps its identity between renders.
  const pricingFor = useMemo(() => {
    const cache = new Map<number | null, Settings>();
    return (postId: number | null): Settings => {
      let p = cache.get(postId);
      if (!p) cache.set(postId, p = resolvePricing(postId != null ? state.posts[postId] : null, state.userDefault));
      return p;
    };
  }, [state]);

  // Change one setting of a post's pricing, or (null) of the default.
  const update = useCallback(<K extends keyof Settings>(target: Target, key: K, value: Settings[K]) => {
    const cur = stateRef.current;
    const next = { ...resolvePricing(target != null ? cur.posts[target] : null, cur.userDefault), [key]: value };
    set(target != null ? { ...cur, posts: { ...cur.posts, [target]: next } } : { ...cur, userDefault: next });
    queue(target, next);
  }, [set, queue]);

  // A post's pricing becomes the default, saved straight away.
  const makeDefault = useCallback((postId: number) => {
    const cur = stateRef.current;
    const pricing = resolvePricing(cur.posts[postId], cur.userDefault);
    set({ ...cur, userDefault: pricing });
    queue(null, pricing, 0);
  }, [set, queue]);

  const clearNotice = useCallback(() => setNotice(null), []);

  // Send waiting edits now (signing out: before the token goes).
  const flushNow = useCallback(() => flush(true), [flush]);

  return { pricingFor, update, makeDefault, learn, flush: flushNow, notice, clearNotice };
}

export type PricingStore = ReturnType<typeof usePricing>;
