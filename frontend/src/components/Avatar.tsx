import type { AuthUser } from '../api/auth.ts';
import { initials } from '../utils.ts';
import { Icon } from './Icon.tsx';

// The Google photo, or the person's initials; a plain person in solo mode.
export function Avatar({ user, className = '' }: { user: AuthUser | null; className?: string }) {
  if (user?.avatar_url) {
    return <img className={`avatar ${className}`} src={user.avatar_url} alt="" referrerPolicy="no-referrer" />;
  }
  const name = user?.name || user?.email || '';
  return (
    <span className={`avatar ${className}`} aria-hidden="true">
      {name ? initials(name) : <Icon name="person" size={18} />}
    </span>
  );
}
