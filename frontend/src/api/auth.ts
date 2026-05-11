// Auth: typed wrappers + a localStorage-backed token reader used by every
// other API helper. Token is read fresh on each request so logout is
// instantaneous (no in-memory copy to invalidate).

const TOKEN_KEY = 'mtg.auth.token';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface AuthConfig {
  auth_enabled: boolean;
  google_client_id: string;
}

export const authToken = {
  get: (): string | null => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (token: string) => {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  },
  clear: () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

// Builds a Headers object pre-populated with the session token when present.
// Other API helpers (api.ts, api/checklist.ts) thread this through their fetches.
export function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const t = authToken.get();
  if (t) h.set('Authorization', `Bearer ${t}`);
  return h;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const r = await fetch('/api/auth/config');
  if (!r.ok) throw new Error(`Auth config fetch failed: ${r.status}`);
  return (await r.json()) as AuthConfig;
}

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  const r = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!r.ok) {
    let detail = `Login failed: ${r.status}`;
    try {
      const j = await r.json();
      if (j.detail) detail = j.detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return (await r.json()) as AuthResponse;
}

export async function fetchMe(): Promise<AuthUser> {
  const r = await fetch('/api/auth/me', { headers: authHeaders() });
  if (!r.ok) throw new Error(`fetchMe failed: ${r.status}`);
  return (await r.json()) as AuthUser;
}
