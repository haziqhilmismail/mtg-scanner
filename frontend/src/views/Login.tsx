// Sign-in screen. Renders Google's official button via the GIS library so we
// inherit Google's branding rules + accessibility for free. Only mounted when
// the backend reports auth_enabled=true and we have no valid session.

import { useEffect, useRef } from 'react';

interface Props {
  clientId: string;
  onCredential: (credential: string) => void;
  error?: string | null;
  busy?: boolean;
}

export function Login({ clientId, onCredential, error, busy }: Props) {
  const btnRef = useRef<HTMLDivElement | null>(null);

  // Initialize GIS + render the button. The script tag in index.html loads it
  // async, so we poll briefly for `window.google` rather than racing the load.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    const tryInit = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        // GIS still loading — retry after a tick. Capped at ~5s of polling.
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
        // Empty first so re-renders don't stack buttons
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
    <div className="login-screen">
      <div className="login-card">
        <div className="login-mark">♠</div>
        <h1 className="login-title">Pasar Malam MTG Scanner</h1>
        <p className="login-sub">Sign in with Google to load your stock and orders.</p>

        <div className="login-google" ref={btnRef} aria-busy={busy ? 'true' : 'false'} />

        {error ? <div className="login-error">{error}</div> : null}

        <p className="login-foot">
          We only use your Google account for sign-in. No password to remember,
          nothing is posted to your profile.
        </p>
      </div>
    </div>
  );
}
