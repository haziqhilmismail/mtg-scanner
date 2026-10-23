import { useT } from '../hooks/useLang.ts';
import type { Route } from '../routes.ts';
import { Link } from './Link.tsx';

export interface Crumb {
  label: string;
  // The page it links to; the last crumb has none, it is this page.
  to?: Route;
}

// Posts / Friday Post / Photo 2: the pages above this one, as links.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const t = useT();
  return (
    <nav className="crumbs" aria-label={t('crumbs_label')}>
      {items.map((c, i) => (
        <span className="crumbs-item" key={i}>
          {i > 0 ? <span className="crumbs-sep" aria-hidden="true">/</span> : null}
          {c.to ? (
            <Link className="crumbs-link" to={c.to}>{c.label}</Link>
          ) : (
            <span className="crumbs-current" aria-current="page">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
