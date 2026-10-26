import type { AuthUser } from '../api/auth.ts';
import { useT } from '../hooks/useLang.ts';
import { POSTS, type Route } from '../routes.ts';
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

// The bar before sign-in: the mark and the name, with nothing to open yet.
export function SignedOutHeader() {
  const t = useT();
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="scan" size={17} /></span>
          <span className="brand-name">{t('app_title')}</span>
        </span>
      </div>
    </header>
  );
}

// The top bar of every page: the mark and name, which open Posts, the
// prices status on wide screens, and the avatar that opens Profile. Photos
// and Claims are tabs on each post, not here.
export function Header({ route, healthLabel, healthState, user }: Props) {
  const t = useT();
  const onProfile = route.page === 'profile' || route.page === 'profile-pricing';
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <Link className="brand" to={POSTS} aria-label={t('app_title')}>
          <span className="brand-mark" aria-hidden="true"><Icon name="scan" size={17} /></span>
          <span className="brand-name">{t('app_title')}</span>
        </Link>
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
