// Auth state hook: resolves the server's auth config once on mount, then
// keeps the signed-in user in sync. When auth is disabled on the backend
// (solo mode), the hook reports auth_enabled=false and treats every request
// as authorized so the rest of the app stays unchanged.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  authToken,
  fetchAuthConfig,
  fetchMe,
  loginWithGoogle,
  type AuthConfig,
  type AuthResponse,
  type AuthUser,
} from '../api/auth.ts';

type Status = 'loading' | 'unauthenticated' | 'authenticated';

interface UseAuth {
  status: Status;
  config: AuthConfig | null;
  user: AuthUser | null;
  error: string | null;
  signInWithCredential: (credential: string) => Promise<void>;
  signOut: () => void;
}

export function useAuth(): UseAuth {
  const [status, setStatus] = useState<Status>('loading');
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against the StrictMode-double-mount firing two /me requests in dev.
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        const cfg = await fetchAuthConfig();
        setConfig(cfg);
        if (!cfg.auth_enabled) {
          // Solo mode — /api/auth/me returns the solo user without a token
          const me = await fetchMe();
          setUser(me);
          setStatus('authenticated');
          return;
        }
        // Auth enabled — if we have a stored token, validate it
        if (authToken.get()) {
          try {
            const me = await fetchMe();
            setUser(me);
            setStatus('authenticated');
            return;
          } catch {
            // Token expired / invalid → clear and fall through to login
            authToken.clear();
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
      const resp: AuthResponse = await loginWithGoogle(credential);
      authToken.set(resp.token);
      setUser(resp.user);
      setStatus('authenticated');
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }, []);

  const signOut = useCallback(() => {
    authToken.clear();
    setUser(null);
    setStatus('unauthenticated');
    // Hint to Google to disable auto-select on the next visit
    try { window.google?.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
  }, []);

  return { status, config, user, error, signInWithCredential, signOut };
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
