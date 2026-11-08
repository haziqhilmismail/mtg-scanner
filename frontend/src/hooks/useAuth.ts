// Auth state hook: resolves the server's auth config once on mount, then
// keeps the signed-in user in sync. When auth is disabled on the backend
// (solo mode), the hook reports auth_enabled=false and treats every request
// as authorized so the rest of the app stays unchanged.

import { useCallback, useEffect, useRef, useState } from 'react';
import { authToken, imageToken, statusOf } from '../api/http.ts';
import { fetchAuthConfig, fetchMe, loginWithGoogle, type AuthConfig, type MeResponse } from '../api/auth.ts';

type Status = 'loading' | 'unauthenticated' | 'authenticated';

// The signed-in user as /api/auth/me answers: who they are, their default
// pricing (null until one is set) and their seller name. Loaded once here;
// everything else reads it from this hook.
export type Me = Omit<MeResponse, 'image_token'>;

interface UseAuth {
  status: Status;
  config: AuthConfig | null;
  // Set whenever status is 'authenticated' (the solo user too).
  user: Me | null;
  error: string | null;
  signInWithCredential: (credential: string) => Promise<void>;
  signOut: () => void;
  setSellerName: (seller_name: string) => void;
}

export function useAuth(): UseAuth {
  const [status, setStatus] = useState<Status>('loading');
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [user, setUser] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against the StrictMode-double-mount firing two /me requests in dev.
  const bootstrapped = useRef(false);

  const loadMe = async () => {
    const { image_token, ...me } = await fetchMe();
    // The server hands out the same image token all week, so image URLs
    // (and the browser's cache of them) stay put between visits.
    imageToken.set(image_token);
    setUser(me);
    setStatus('authenticated');
  };

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        const cfg = await fetchAuthConfig();
        setConfig(cfg);
        // Solo mode — /api/auth/me returns the solo user without a token
        if (!cfg.auth_enabled) return await loadMe();
        // Auth enabled — if we have a stored token, validate it
        if (authToken.get()) {
          try {
            return await loadMe();
          } catch (e) {
            // Only a refused token signs out; a network error or a server
            // restart shows the error and keeps the session for next time.
            if (statusOf(e) !== 401) throw e;
            authToken.clear();
            imageToken.clear();
          }
        }
        setStatus('unauthenticated');
      } catch (e) {
        setError((e as Error).message);
        setStatus('unauthenticated');
      }
    })();
  }, []);

  const signInWithCredential = useCallback(async (credential: string) => {
    setError(null);
    try {
      const resp = await loginWithGoogle(credential);
      authToken.set(resp.token);
      await loadMe();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }, []);

  const signOut = useCallback(() => {
    authToken.clear();
    imageToken.clear();
    setUser(null);
    setStatus('unauthenticated');
    // Hint to Google to disable auto-select on the next visit
    try { window.google?.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
  }, []);

  const setSellerName = useCallback((seller_name: string) => setUser(u => u && { ...u, seller_name }), []);

  return { status, config, user, error, signInWithCredential, signOut, setSellerName };
}

// Minimal ambient declaration for the GIS global. We avoid pulling in
// @types/google.accounts (extra dep) and only type the surface we use.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (resp: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            el: HTMLElement,
            opts: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number;
            },
          ) => void;
          prompt: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}
