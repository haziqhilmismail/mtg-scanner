import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthUser } from '../api/auth.ts';
import type { Appearance, Lang } from '../types.ts';
import { FeedbackModal } from './FeedbackModal.tsx';
import { Icon } from './Icon.tsx';
import type { T } from '../hooks/useLang.ts';

interface Props {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
  t: T;
  // Shown as a status row at the top of the menu when provided.
  status?: { label: string; state: 'ok' | 'err' | null };
  // Only set when Google auth is enabled on the backend.
  user?: AuthUser | null;
  onSignOut?: () => void;
  // Shown when scan credits apply to this account.
  onRedeemVoucher?: () => void;
  // Opens the default-pricing sheet; absent on the sign-in screen.
  onDefaultPricing?: () => void;
}

const LANGS: Lang[] = ['en', 'ms'];
const APPEARANCES: Appearance[] = ['auto', 'light', 'dark'];

// The "More" menu: display preferences, feedback and the account, tucked
// behind one button so the bar stays clear for the content.
export function AppMenu({
  lang, onLangChange, appearance, onAppearanceChange, t, status, user, onSignOut, onRedeemVoucher, onDefaultPricing,
}: Props) {
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="app-menu" ref={rootRef}>
      <button
        type="button"
        className="bar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('menu_more')}
        title={t('menu_more')}
        onClick={() => setOpen(o => !o)}
      >
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt="" className="user-avatar" referrerPolicy="no-referrer" />
        ) : (
          <Icon name="more" size={22} />
        )}
      </button>

      {open ? (
        <div className="menu-popover" role="menu">
          {user ? (
            <div className="menu-account">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="user-avatar" referrerPolicy="no-referrer" />
              ) : (
                <span className="user-avatar placeholder">{(user.name || user.email)[0]?.toUpperCase()}</span>
              )}
              <div className="menu-account-text">
                <strong>{user.name || user.email}</strong>
                {user.name ? <span>{user.email}</span> : null}
              </div>
            </div>
          ) : null}

          {status ? (
            <div className="menu-status">
              <span className={`status-dot ${status.state ?? ''}`} aria-hidden="true" />
              <span>{status.label}</span>
            </div>
          ) : null}

          <div className="menu-group">
            <div className="menu-row">
              <span className="menu-row-label"><Icon name="globe" />{t('menu_language')}</span>
              <div className="segmented" role="group" aria-label={t('menu_language')}>
                {LANGS.map(l => (
                  <button
                    key={l} type="button"
                    className={lang === l ? 'active' : ''}
                    aria-pressed={lang === l}
                    onClick={() => onLangChange(l)}
                  >{l === 'en' ? 'English' : 'Melayu'}</button>
                ))}
              </div>
            </div>
            <div className="menu-row">
              <span className="menu-row-label"><Icon name="appearance" />{t('menu_appearance')}</span>
              <div className="segmented" role="group" aria-label={t('menu_appearance')}>
                {APPEARANCES.map(a => (
                  <button
                    key={a} type="button"
                    className={appearance === a ? 'active' : ''}
                    aria-pressed={appearance === a}
                    onClick={() => onAppearanceChange(a)}
                  >{t(`appearance_${a}`)}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="menu-group">
            {onDefaultPricing ? (
              <button
                type="button" role="menuitem" className="menu-item"
                onClick={() => { setOpen(false); onDefaultPricing(); }}
              >
                <Icon name="tag" />{t('menu_default_pricing')}
              </button>
            ) : null}
            {onRedeemVoucher ? (
              <button
                type="button" role="menuitem" className="menu-item"
                onClick={() => { setOpen(false); onRedeemVoucher(); }}
              >
                <Icon name="ticket" />{t('voucher_title')}
              </button>
            ) : null}
            <button
              type="button" role="menuitem" className="menu-item"
              onClick={() => { setOpen(false); setFeedbackOpen(true); }}
            >
              <Icon name="feedback" />{t('feedback_open')}
            </button>
            {user && onSignOut ? (
              <button
                type="button" role="menuitem" className="menu-item destructive"
                onClick={() => { setOpen(false); onSignOut(); }}
              >
                <Icon name="signout" />{t('menu_sign_out')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Portalled to <body>: the app bar's backdrop filter would otherwise
          become the containing block for this fixed-position sheet. */}
      {createPortal(
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} t={t} />,
        document.body,
      )}
    </div>
  );
}
