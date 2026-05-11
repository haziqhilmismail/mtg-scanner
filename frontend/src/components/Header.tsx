import type { AuthUser } from '../api/auth.ts';
import type { Lang, Theme } from '../types.ts';

interface Props {
  title: string;
  sub: string;
  healthLabel: string;
  healthState: 'ok' | 'err' | null;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  theme: Theme;
  onThemeToggle: () => void;
  // Only shown when Google auth is enabled on the backend. In solo mode both
  // are undefined and the sign-out chip stays hidden.
  user?: AuthUser | null;
  onSignOut?: () => void;
}

export function Header({
  title, sub, healthLabel, healthState,
  lang, onLangChange, theme, onThemeToggle,
  user, onSignOut,
}: Props) {
  return (
    <header className="masthead">
      <div>
        <h1>{title}</h1>
        <div className="sub">
          {sub} ·{' '}
          <span className={`health ${healthState ?? ''}`}>{healthLabel}</span>
        </div>
      </div>
      <div className="header-controls">
        <div className="lang-toggle" role="tablist" aria-label="Language">
          <button
            type="button"
            className={lang === 'en' ? 'active' : ''}
            aria-pressed={lang === 'en'}
            onClick={() => onLangChange('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={lang === 'ms' ? 'active' : ''}
            aria-pressed={lang === 'ms'}
            onClick={() => onLangChange('ms')}
          >
            MS
          </button>
        </div>
        <button
          className="icon-btn"
          type="button"
          onClick={onThemeToggle}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        {user && onSignOut ? (
          <div className="user-chip" title={user.email}>
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="user-avatar" referrerPolicy="no-referrer" />
            ) : (
              <span className="user-avatar placeholder">{(user.name || user.email)[0]?.toUpperCase()}</span>
            )}
            <span className="user-name">{user.name || user.email}</span>
            <button type="button" className="signout-btn" onClick={onSignOut} aria-label="Sign out">
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
