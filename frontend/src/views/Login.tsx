// The sign-in page: the pitch with Google's button on the first screen, a
// sample post to try (its Photos, then its Claims, as in the app), the four
// steps of a post, and the button again. Language and
// appearance come from App, so a choice made here carries on after sign-in.

import { useEffect, useRef, useState } from 'react';
import { DemoFindClaims } from '../components/demo/DemoFindClaims.tsx';
import { DemoScan } from '../components/demo/DemoScan.tsx';
import { SignedOutHeader } from '../components/Header.tsx';
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

// A post's life, and the part of the post each step happens on.
const STEPS = [['photos', 'post_photos'], ['share', 'post_photos'], ['claims', 'nav_claims'], ['collect', 'nav_claims']] as const;

export function Login({ clientId, onCredential, error, lang, setLang, t, appearance, setAppearance }: Props) {
  const [demo, setDemo] = useState<'photos' | 'claims'>('photos');
  const gis = useGis(clientId, onCredential);
  // The scan's results run long on a phone: the Claims demo starts at its top.
  const toClaims = () => { setDemo('claims'); document.getElementById('signin-try-title')?.scrollIntoView(); };
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
              aria-label={t('post_parts')} value={demo} onChange={setDemo}
              options={[{ value: 'photos', label: `1 · ${t('post_photos')}` }, { value: 'claims', label: `2 · ${t('nav_claims')}` }]}
            />
            {demo === 'photos' ? <DemoScan onNext={toClaims} /> : <DemoFindClaims />}
            <p className="signin-note">{t('lp_demo_foot')}</p>
          </section>

          <section className="signin-what" aria-labelledby="signin-what-title">
            <h2 id="signin-what-title" className="signin-h2">{t('lp_how')}</h2>
            <ol className="ui-list signin-steps">
              {STEPS.map(([key, part], i) => (
                <li key={key} className="signin-step">
                  <span className="signin-step-n" aria-hidden="true">{i + 1}</span>
                  <span className="signin-step-text">
                    <strong>{t(`lp_step_${key}_head`)}</strong>
                    <span>{t(`lp_step_${key}_body`)}</span>
                    <span className="ui-chip">{t('lp_step_on', { part: t(part) })}</span>
                  </span>
                </li>
              ))}
            </ol>
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
