// The sign-in page: the pitch with Google's button on the first screen, a
// demo to try, what the app does, and the button again. Language and
// appearance come from App, so a choice made here carries on after sign-in.

import { useEffect, useRef, useState } from 'react';
import { DemoFindClaims } from '../components/demo/DemoFindClaims.tsx';
import { DemoScan } from '../components/demo/DemoScan.tsx';
import { SignedOutHeader } from '../components/Header.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';
import { Preferences } from '../components/Preferences.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import type { T } from '../hooks/useLang.ts';
import type { Appearance, Lang } from '../types.ts';

interface Props {
  clientId: string;
  onCredential: (credential: string) => void;
  error?: string | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: T;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
}

type Gis = 'loading' | 'ready' | 'failed';
// How long Google's script gets before the page says it didn't load.
const GIS_WAIT_MS = 10000;

const FEATURES: Array<[IconName, string]> = [
  ['bolt', 'scan'], ['share', 'export'], ['feedback', 'claims'], ['print', 'slips'],
];

export function Login({ clientId, onCredential, error, lang, setLang, t, appearance, setAppearance }: Props) {
  const [demo, setDemo] = useState<'scan' | 'claims'>('scan');
  const gis = useGis(clientId, onCredential);
  const cta = <><GoogleButton gis={gis} /><p className="signin-note">{t('lp_cta_foot')}</p></>;

  return (
    <>
      <SignedOutHeader />
      <main className="wrap">
        <div className="signin">
          <section className="signin-hero" aria-labelledby="signin-title">
            <h1 id="signin-title" className="signin-title">{t('lp_title')}</h1>
            <p className="signin-tagline">{t('lp_tagline')}</p>
            <div className="signin-cta">
              {gis === 'failed' ? <p className="signin-error" role="alert">{t('lp_google_failed')}</p> : cta}
              {error ? <p className="signin-error" role="alert">{error}</p> : null}
            </div>
          </section>

          <section className="signin-try" aria-labelledby="signin-try-title">
            <h2 id="signin-try-title" className="signin-h2">{t('lp_try')}</h2>
            <Segmented
              aria-label={t('lp_demo_switch')} value={demo} onChange={setDemo}
              options={[{ value: 'scan', label: t('lp_demo_tab_scan') }, { value: 'claims', label: t('lp_demo_tab_claims') }]}
            />
            {demo === 'scan' ? <DemoScan /> : <DemoFindClaims />}
            <p className="signin-note">{t('lp_demo_foot')}</p>
          </section>

          <section className="signin-what" aria-labelledby="signin-what-title">
            <h2 id="signin-what-title" className="signin-h2">{t('lp_what')}</h2>
            <ul className="ui-list">
              {FEATURES.map(([icon, key]) => (
                <li key={key} className="signin-feature">
                  <span className="signin-feature-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
                  <span className="signin-feature-text">
                    <strong>{t(`lp_feat_${key}_head`)}</strong>
                    <span>{t(`lp_feat_${key}_body`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {gis === 'failed' ? null : <div className="signin-cta signin-again">{cta}</div>}

          <footer className="signin-foot">
            <div className="signin-prefs">
              <Preferences lang={lang} setLang={setLang} appearance={appearance} setAppearance={setAppearance} />
            </div>
            <div className="signin-links">
              <a href="/privacy.html">{t('privacy_link')}</a>
              <a href="https://github.com/haziqhilmismail" target="_blank" rel="noopener noreferrer">{t('lp_github')}</a>
            </div>
            <p className="signin-legal">{t('footer_right')}</p>
          </footer>
        </div>
      </main>
    </>
  );
}

// Waits for Google's script, then sets up sign-in once per client id.
function useGis(clientId: string, onCredential: (credential: string) => void): Gis {
  const [state, setState] = useState<Gis>('loading');
  const callback = useRef(onCredential);
  callback.current = onCredential;
  useEffect(() => {
    if (!clientId) { setState('failed'); return; }
    const started = Date.now();
    let timer = 0;
    const poll = () => {
      const id = window.google?.accounts?.id;
      if (id) {
        id.initialize({
          client_id: clientId,
          callback: resp => { if (resp?.credential) callback.current(resp.credential); },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        setState('ready');
      } else if (Date.now() - started > GIS_WAIT_MS) {
        setState('failed');
      } else {
        timer = window.setTimeout(poll, 100);
      }
    };
    poll();
    return () => clearTimeout(timer);
  }, [clientId]);
  return state;
}

// Google's own button, as wide as its slot (at most 400px, Google's limit),
// drawn again when the slot's width changes.
function GoogleButton({ gis }: { gis: Gis }) {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = slot.current;
    const id = window.google?.accounts.id;
    if (gis !== 'ready' || !el || !id) return;
    let drawn = 0;
    let timer = 0;
    const draw = () => {
      const width = Math.min(400, Math.floor(el.clientWidth));
      if (width === drawn) return;
      drawn = width;
      el.innerHTML = '';
      id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'left', width });
    };
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = window.setTimeout(draw, 150); });
    observer.observe(el);
    draw();
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [gis]);
  return <div ref={slot} className="signin-google" aria-busy={gis === 'loading'} />;
}
