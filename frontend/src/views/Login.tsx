// Landing + sign-in screen. Two columns on desktop:
//   - Left: marketing copy, feature bullets, Google sign-in button (always visible)
//   - Right: tabbed interactive demo (scanner playback + order-tracker preview)
// Stacks vertically on mobile. The Google button is mounted via GIS, same as
// before — auth flow is unchanged. Owns its own useLang so the landing page
// can be browsed in EN or MS before the user signs in.

import { useEffect, useRef, useState } from 'react';
import { DemoChecklist } from '../components/demo/DemoChecklist.tsx';
import { DemoScan } from '../components/demo/DemoScan.tsx';
import { useLang } from '../hooks/useLang.ts';
import { useTheme } from '../hooks/useTheme.ts';

interface Props {
  clientId: string;
  onCredential: (credential: string) => void;
  error?: string | null;
  busy?: boolean;
}

type DemoTab = 'scan' | 'tracker';

export function Login({ clientId, onCredential, error, busy }: Props) {
  const btnRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<DemoTab>('scan');
  const { lang, setLang, t } = useLang();
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    const tryInit = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        setTimeout(tryInit, 100);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => { if (resp?.credential) onCredential(resp.credential); },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      if (btnRef.current) {
        btnRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(btnRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: 280,
        });
      }
    };
    tryInit();
    return () => { cancelled = true; };
  }, [clientId, onCredential]);

  return (
    <div className="landing">
      <div className="landing-grid">
        <section className="landing-pitch">
          <div className="landing-mark">♠</div>
          <h1 className="landing-title">{t('lp_title')}</h1>
          <p className="landing-tagline">{t('lp_tagline')}</p>

          <ul className="landing-features">
            <li>
              <span className="landing-feature-glyph">⚡</span>
              <div>
                <strong>{t('lp_feat_scan_head')}</strong>
                <span>{t('lp_feat_scan_body')}</span>
              </div>
            </li>
            <li>
              <span className="landing-feature-glyph">📋</span>
              <div>
                <strong>{t('lp_feat_track_head')}</strong>
                <span>{t('lp_feat_track_body')}</span>
              </div>
            </li>
            <li>
              <span className="landing-feature-glyph">📤</span>
              <div>
                <strong>{t('lp_feat_export_head')}</strong>
                <span>{t('lp_feat_export_body')}</span>
              </div>
            </li>
          </ul>

          <div className="landing-cta">
            <div className="landing-google" ref={btnRef} aria-busy={busy ? 'true' : 'false'} />
            <p className="landing-cta-foot">{t('lp_cta_foot')}</p>
            {error ? <div className="landing-error">{error}</div> : null}
          </div>
        </section>

        <section className="landing-demo" aria-label="Interactive demo">
          <div className="landing-demo-frame">
            <div className="landing-demo-bar">
              <div className="landing-demo-bar-dots" aria-hidden="true">
                <span /><span /><span />
              </div>
              <div className="landing-demo-bar-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={tab === 'scan'}
                  className={`landing-demo-tab ${tab === 'scan' ? 'is-active' : ''}`}
                  onClick={() => setTab('scan')}
                >
                  {t('lp_demo_tab_scan')}
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'tracker'}
                  className={`landing-demo-tab ${tab === 'tracker' ? 'is-active' : ''}`}
                  onClick={() => setTab('tracker')}
                >
                  {t('lp_demo_tab_tracker')}
                </button>
              </div>
              <span className="landing-demo-badge">{t('lp_demo_badge')}</span>
            </div>
            <div className="landing-demo-body">
              {tab === 'scan' ? <DemoScan t={t} /> : <DemoChecklist t={t} />}
            </div>
          </div>
          <p className="landing-demo-foot">{t('lp_demo_foot')}</p>
        </section>
      </div>

      <footer className="landing-footer">
        <a
          href="https://github.com/haziqhilmismail"
          target="_blank"
          rel="noopener noreferrer"
          className="landing-footer-link"
        >
          <svg className="landing-footer-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
          <span>github.com/haziqhilmismail</span>
        </a>
      </footer>

      <div className="float-controls" aria-label="Display settings">
        <div className="lang-toggle landing-lang" role="tablist" aria-label="Language">
          <button
            type="button"
            className={lang === 'en' ? 'active' : ''}
            aria-pressed={lang === 'en'}
            onClick={() => setLang('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={lang === 'ms' ? 'active' : ''}
            aria-pressed={lang === 'ms'}
            onClick={() => setLang('ms')}
          >
            MS
          </button>
        </div>
        <button
          className="icon-btn landing-theme"
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </div>
  );
}
