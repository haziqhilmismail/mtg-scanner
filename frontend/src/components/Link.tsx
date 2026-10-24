import type { AnchorHTMLAttributes } from 'react';
import { useNavStore } from '../hooks/useNav.ts';
import { formatRoute, type Route } from '../routes.ts';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: Route;
  // Change the page in place instead of adding a history entry.
  replace?: boolean;
}

// A link to a page of the app. A plain left click moves within the app; a
// middle click, a modifier key or "copy link" use the href like any link.
export function Link({ to, replace, onClick, ...rest }: Props) {
  const nav = useNavStore();
  return (
    <a
      href={formatRoute(to)}
      onClick={e => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        (replace ? nav.replace : nav.go)(to);
      }}
      {...rest}
    />
  );
}
