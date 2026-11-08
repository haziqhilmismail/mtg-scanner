import { useState } from 'react';
import type { AuthUser } from '../api/auth.ts';
import { Icon } from './Icon.tsx';
import { initials } from './initials.ts';

export function Avatar({ user, className = '' }: { user: AuthUser | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const photo = user?.avatar_url;
  if (photo && photo !== failed) {
    return <img className={`avatar ${className}`} src={photo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(photo)} />;
  }
  const name = user?.name || user?.email || '';
  return (
    <span className={`avatar ${className}`} aria-hidden="true">
      {name ? initials(name) : <Icon name="person" size={18} />}
    </span>
  );
}
