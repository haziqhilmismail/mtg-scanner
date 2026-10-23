import type { AuthUser } from '../api/auth.ts';
import { useT } from '../hooks/useLang.ts';
import { POSTS, routeFolder, type Route } from '../routes.ts';
import { Avatar } from './Avatar.tsx';
import { Icon } from './Icon.tsx';
import { Link } from './Link.tsx';

interface Props {
  route: Route;
  healthLabel: string;
  healthState: 'ok' | 'err' | null;
  // null in solo mode, where nobody signs in.
  user: AuthUser | null;
}

// The top bar of every page: the mark, the Scanner and Claims tabs, the
// prices status on wide screens, and the avatar that opens Profile.
export function Header({ route, healthLabel, healthState, user }: Props) {
  const t = useT();
  const onProfile = route.page === 'profile' || route.page === 'profile-pricing';
  // A post, a photo and a post's pricing sit under Scanner; Profile has no tab.
  const tab = route.page === 'claims' ? 'claims' : onProfile ? null : 'scanner';
  const tabProps = (id: 'scanner' | 'claims') => ({
    className: `nav-tab ${tab === id ? 'is-on' : ''}`,
    'aria-current': tab === id ? ('page' as const) : undefined,
  });
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <Link className="brand" to={POSTS} aria-label={t('app_title')}>
          <span className="brand-mark" aria-hidden="true"><Icon name="scan" size={17} /></span>
          <span className="brand-name">{t('app_title')}</span>
        </Link>
        <nav className="nav-tabs" aria-label={t('nav_section')}>
          <Link to={POSTS} {...tabProps('scanner')}>{t('nav_scanner')}</Link>
          {/* Claims opens on the post the seller is looking at. */}
          <Link to={{ page: 'claims', folder: routeFolder(route) }} {...tabProps('claims')}>{t('nav_claims')}</Link>
        </nav>
        <div className="app-bar-actions">
          <span className={`bar-status ${healthState ?? ''}`}>
            <span className={`status-dot ${healthState ?? ''}`} aria-hidden="true" />
            {healthLabel}
          </span>
          <Link className="avatar-link" to={{ page: 'profile' }} aria-label={t('nav_profile')} aria-current={onProfile ? 'page' : undefined}>
            <Avatar user={user} />
          </Link>
        </div>
      </div>
    </header>
  );
}
