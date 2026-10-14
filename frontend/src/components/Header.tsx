import type { AuthUser } from '../api/auth.ts';
import type { Appearance, Lang } from '../types.ts';
import { AppMenu } from './AppMenu.tsx';
import type { T } from '../hooks/useLang.ts';

interface Props {
  title: string;
  healthLabel: string;
  healthState: 'ok' | 'err' | null;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
  t: T;
  // Only shown when Google auth is enabled on the backend. In solo mode both
  // are undefined and the account rows stay hidden.
  user?: AuthUser | null;
  onSignOut?: () => void;
  onRedeemVoucher?: () => void;
}

export function Header({
  title, healthLabel, healthState,
  lang, onLangChange, appearance, onAppearanceChange, t,
  user, onSignOut, onRedeemVoucher,
}: Props) {
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <h1 className="app-bar-title">{title}</h1>
        <div className="app-bar-actions">
          {/* The dot alone would rely on colour, so the label sits beside it
              on wide screens and in the menu on narrow ones. */}
          <span className={`bar-status ${healthState ?? ''}`} title={healthLabel}>
            <span className={`status-dot ${healthState ?? ''}`} aria-hidden="true" />
            <span className="bar-status-label">{healthLabel}</span>
          </span>
          <AppMenu
            lang={lang}
            onLangChange={onLangChange}
            appearance={appearance}
            onAppearanceChange={onAppearanceChange}
            t={t}
            status={{ label: healthLabel, state: healthState }}
            user={user}
            onSignOut={onSignOut}
            onRedeemVoucher={onRedeemVoucher}
          />
        </div>
      </div>
    </header>
  );
}
