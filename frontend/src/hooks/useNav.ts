import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { formatRoute, parseRoute, POSTS, type Route } from '../routes.ts';

// Where the user is. The URL is the source of truth: every page has its own
// path, so the browser's Back, a reload and a copied link all land on it.
const fromLocation = () => parseRoute(location.pathname, location.search) ?? POSTS;
const same = (a: Route, b: Route) => formatRoute(a) === formatRoute(b);

export function useNav() {
  const [route, setRoute] = useState<Route>(fromLocation);
  const routeRef = useRef(route);

  const commit = useCallback((next: Route, push: boolean) => {
    routeRef.current = next;
    if (push) history.pushState(null, '', formatRoute(next));
    else history.replaceState(null, '', formatRoute(next));
    setRoute(next);
  }, []);

  useEffect(() => {
    // An unknown path shows Posts, and the address bar says so.
    const url = formatRoute(routeRef.current);
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
    // useBackClose adds entries with the page's own URL while a popup is
    // open; they parse to the same page and change nothing here.
    const onPop = () => {
      const next = fromLocation();
      if (same(next, routeRef.current)) return;
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // A new page: its own history entry.
  const go = useCallback((next: Route) => { if (!same(next, routeRef.current)) commit(next, true); }, [commit]);

  // The same page, changed in place (the next photo, another post on
  // Claims) or a page whose subject is gone: no new entry.
  const replace = useCallback((next: Route) => commit(next, false), [commit]);

  // Where the user is now, for code that resumes after awaiting the user.
  const current = useCallback(() => routeRef.current, []);

  return { route, go, replace, current };
}

export type NavStore = ReturnType<typeof useNav>;

const NavContext = createContext<NavStore | null>(null);
export const NavProvider = NavContext.Provider;

export function useNavStore(): NavStore {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNavStore needs a NavProvider');
  return nav;
}
