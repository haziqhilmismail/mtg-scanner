// Auth: typed wrappers + a localStorage-backed token reader used by every
// other API helper. Token is read fresh on each request so logout is
// instantaneous (no in-memory copy to invalidate).

import type { Credits } from '../api.ts';

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
export function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const t = authToken.get();
  if (t) h.set('Authorization', `Bearer ${t}`);
  return h;
}

export class OutOfCreditsError extends Error {
  credits: Credits | null;
  constructor(credits: Credits | null) {
    super('Out of scan credits');
    this.credits = credits;
  }
}

// Every API call goes through here. A failed response throws an Error whose
// message carries the status and the server's detail, with `.status` and the
// raw `.detail` attached for callers that branch on them. 402 is always
// "out of scan credits".
export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: authHeaders(init.headers) });
  if (r.ok) return r;
  const text = await r.text().catch(() => '');
  let detail: unknown = text.slice(0, 200);
  try { detail = JSON.parse(text).detail; } catch { /* not JSON: keep the text */ }
  if (r.status === 402) {
    throw new OutOfCreditsError((detail as { credits?: Credits } | undefined)?.credits ?? null);
  }
  const msg = `${init.method ?? 'GET'} ${url} → ${r.status}${typeof detail === 'string' && detail ? `: ${detail}` : ''}`;
  throw Object.assign(new Error(msg), { status: r.status, detail });
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  return (await request('/api/auth/config')).json();
}

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  return (await request('/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  })).json();
}

export async function fetchMe(): Promise<AuthUser> {
  return (await request('/api/auth/me')).json();
}
