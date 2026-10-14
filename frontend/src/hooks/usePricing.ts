import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMe, saveDefaultPricing } from '../api/auth.ts';
import { postsApi, type PostCreatePayload } from '../api/checklist.ts';
import {
  defaultToUpload, editPricing, LEGACY_KEY, LEGACY_VERSION_KEY, legacyPricing, pricingKnown, resolvePricing, type PricingState,
} from '../lib/pricing.ts';
import type { Settings } from '../types.ts';
import { useSaveQueue } from './useSaveQueue.ts';

// Edits are saved this long after the last change.
const SAVE_DELAY_MS = 600;

// What gets saved: a post's pricing, or the user's default.
type Target = number | 'default';

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
  const [state, setState] = useState<PricingState>(() => ({ userDefault: readLegacy(), defaultKnown: false, posts: {} }));
  const stateRef = useRef(state);
  const set = useCallback((next: PricingState) => { stateRef.current = next; setState(next); }, []);
  const [notice, setNotice] = useState<string | null>(null);

  // A clock ticked by every request and every save that settles. Per target,
  // the tick since which the server has had what this page shows (Infinity
  // while an edit is unsaved): an answer asked for before then is stale.
  const clock = useRef(0);
  const settledAt = useRef(new Map<Target, number>());
  const settle = (target: Target) => {
    if (!saves.queue.busy(target)) settledAt.current.set(target, ++clock.current);
  };
  const fresh = (target: Target, askedAt: number) => (settledAt.current.get(target) ?? 0) < askedAt;

  // One save per target at a time: the server keeps whichever lands last.
  const saves = useSaveQueue<Target, Settings>(
    (target, pricing, final) => (target === 'default'
      ? saveDefaultPricing(pricing, final)
      : postsApi.update(target, { pricing }, final).then(() => undefined)),
    target => { settle(target); if (target === 'default') forgetLegacy(); },
    target => { settle(target); setNotice('pricing_save_failed'); },
    { ordered: true },
  );

  const save = useCallback((target: Target, pricing: Settings, delay = SAVE_DELAY_MS) => {
    settledAt.current.set(target, Infinity);
    saves.queue.save(target, pricing);
    saves.later(delay);
  }, [saves]);

  // The default from the server. If it has none, the browser's old pricing
  // becomes it, once; the browser's copy goes when the server has one.
  // Resolves to whether the default is known.
  const meAnswer = useRef<Promise<boolean>>(Promise.resolve(false));
  useEffect(() => {
    const askedAt = ++clock.current;
    meAnswer.current = fetchMe().then(me => {
      // Made a post's pricing meanwhile: that becomes the default.
      if (!fresh('default', askedAt)) { set({ ...stateRef.current, defaultKnown: true }); return true; }
      const upload = defaultToUpload(me.pricing, readLegacy());
      set({ ...stateRef.current, userDefault: upload ?? me.pricing, defaultKnown: true });
      if (upload) save('default', upload, 0);
      else if (me.pricing != null) forgetLegacy();
      return true;
    }, () => false /* offline: the stand-in default stays */);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every post, archived too, from the server. Each brings its pricing,
  // unless edited here since it was asked for.
  const listPosts = useCallback(async () => {
    const askedAt = ++clock.current;
    const list = await postsApi.list(true);
    const posts = { ...stateRef.current.posts };
    for (const p of list) if (fresh(p.id, askedAt)) posts[p.id] = p.pricing;
    set({ ...stateRef.current, posts });
    return list;
  }, [set]);

  // Every new post starts with a copy of the default, once it is known, so
  // changing the default later doesn't reprice it. Not known (offline): the
  // post follows the default.
  const createPost = useCallback(async (payload: Omit<PostCreatePayload, 'pricing'>) => {
    const known = await meAnswer.current;
    const post = await postsApi.create({ ...payload, pricing: known ? resolvePricing(null, stateRef.current.userDefault) : null });
    set({ ...stateRef.current, posts: { ...stateRef.current.posts, [post.id]: post.pricing } });
    return post;
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

  // Whether a post is priced the same as the default.
  const isDefault = useCallback(
    (postId: number) => JSON.stringify(pricingFor(postId)) === JSON.stringify(pricingFor(null)),
    [pricingFor],
  );

  // Whether a post's (or, for null, the default's) pricing can be edited yet.
  const isKnown = useCallback((postId: number | null) => pricingKnown(state, postId), [state]);

  // Change one setting of a post's pricing, or (null) of the default. Ignored
  // until that pricing is known.
  const update = useCallback(<K extends keyof Settings>(postId: number | null, key: K, value: Settings[K]) => {
    const edit = editPricing(stateRef.current, postId, key, value);
    if (!edit) return;
    set(edit.state);
    save(postId ?? 'default', edit.pricing);
  }, [set, save]);

  // A post's pricing becomes the default, saved straight away.
  const makeDefault = useCallback((postId: number) => {
    const cur = stateRef.current;
    if (!pricingKnown(cur, postId)) return;
    const pricing = resolvePricing(cur.posts[postId], cur.userDefault);
    set({ ...cur, userDefault: pricing });
    save('default', pricing, 0);
  }, [set, save]);

  const clearNotice = useCallback(() => setNotice(null), []);

  // Send waiting edits now (signing out: before the token goes).
  const flush = useCallback(() => saves.flush(true), [saves]);

  return { pricingFor, pricingKnown: isKnown, isDefault, update, makeDefault, listPosts, createPost, flush, notice, clearNotice };
}

export type PricingStore = ReturnType<typeof usePricing>;
