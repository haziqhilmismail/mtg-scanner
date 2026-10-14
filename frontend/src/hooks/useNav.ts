import { useCallback, useEffect, useRef, useState } from 'react';
import { readStored, writeStored } from './usePersistedState.ts';

// 'checklist' is the page Claims replaced; still reachable from a link at the
// bottom of Claims for anyone with stock or orders in it.
export type View = 'scanner' | 'claims' | 'checklist';

// Where the user is: the tab, the open post (gallery folder key, shared with
// Claims) and the open photo. Every level is its own browser history entry,
// so the browser's and the phone's back and forward move between them.
// `up`: the entry was pushed from its parent level, so going up is going back.
export interface Nav { view: View; folder: string | null; photo: string | null; up?: boolean }

const TAB_KEY = 'mtg.tab';
const FOLDER_KEY = 'mtg.scans.folder';

function parentOf(n: Nav): Nav | null {
  if (n.view === 'checklist') return { ...n, view: 'claims' };
  if (n.view !== 'scanner') return null;
  if (n.photo != null) return { ...n, photo: null };
  if (n.folder != null) return { ...n, folder: null };
  return null;
}

const same = (a: Nav | null, b: Nav | null) =>
  !!a && !!b && a.view === b.view && a.folder === b.folder && a.photo === b.photo;

const isNav = (s: unknown): s is Nav => !!s && typeof s === 'object' && 'view' in s;

// A reload keeps the entry's own state; a fresh visit opens the last tab and
// post, as remembered in localStorage (the open photo isn't remembered).
function initial(): Nav {
  if (isNav(history.state)) return history.state;
  return { view: readStored<View>(TAB_KEY, 'scanner'), folder: readStored<string | null>(FOLDER_KEY, null), photo: null };
}

export function useNav() {
  const [nav, setNav] = useState<Nav>(initial);
  const navRef = useRef(nav);
  // A history.back() of up() not yet arrived: another up() would go two levels.
  const goingBack = useRef(false);

  const commit = useCallback((next: Nav, push: boolean) => {
    navRef.current = next;
    if (push) history.pushState(next, '');
    else history.replaceState(next, '');
    setNav(next);
  }, []);

  useEffect(() => {
    // The entry the app opened on gets its state, so coming back to it works.
    history.replaceState(navRef.current, '');
    const onPop = (e: PopStateEvent) => {
      const next = isNav(e.state) ? e.state : { view: 'scanner' as const, folder: null, photo: null };
      navRef.current = next;
      goingBack.current = false;
      setNav(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    writeStored(TAB_KEY, nav.view);
    writeStored(FOLDER_KEY, nav.folder);
  }, [nav.view, nav.folder]);

  // A new level: its own history entry.
  const go = useCallback((patch: Partial<Nav>) => {
    const cur = navRef.current;
    const next = { ...cur, ...patch };
    if (same(next, cur)) return;
    commit({ ...next, up: same(parentOf(next), cur) }, true);
  }, [commit]);

  // The same level, changed in place (next photo, the post a photo is filed
  // under, a correction): no new entry.
  const replace = useCallback((patch: Partial<Nav>) => {
    const cur = navRef.current;
    const next = { ...cur, ...patch };
    commit({ ...next, up: !!cur.up && same(parentOf(next), parentOf(cur)) }, false);
  }, [commit]);

  // Up one level, for the in-page back buttons and Esc: back through history
  // when the entry below is the parent, else the parent replaces this entry.
  const up = useCallback(() => {
    const cur = navRef.current;
    const parent = parentOf(cur);
    if (!parent || goingBack.current) return;
    if (cur.up) { goingBack.current = true; history.back(); }
    else commit({ ...parent, up: false }, false);
  }, [commit]);

  // Where the user is now, for code that resumes after awaiting the user.
  const current = useCallback(() => navRef.current, []);

  return { nav, go, replace, up, current };
}

export type NavStore = ReturnType<typeof useNav>;
