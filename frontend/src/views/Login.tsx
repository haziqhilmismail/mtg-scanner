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
      <div className="landing-header">
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
      </div>

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
    </div>
  );
}
