// Auth: typed wrappers + a localStorage-backed token reader used by every
// other API helper. Token is read fresh on each request so logout is
// instantaneous (no in-memory copy to invalidate).

import type { Credits } from '../api.ts';


export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  image_token?: string;
}

export interface AuthResponse {
  token: string;
  image_token?: string;
  user: AuthUser;
}

export interface AuthConfig {
  auth_enabled: boolean;
  google_client_id: string;
}

function storedToken(key: string) {
  return {
    get: (): string | null => {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set: (token: string) => {
      try { localStorage.setItem(key, token); } catch { /* ignore */ }
    },
    clear: () => {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

export const authToken = storedToken('mtg.auth.token');
// Image-only token: <img src> can't send headers, so pictures carry this in
// the URL. It can load images and nothing else, unlike the session token.
export const imageToken = storedToken('mtg.auth.image_token');

// URL for an image route, with the image token (empty in solo mode) and any
// non-empty params in the query string.
export function imageUrl(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  const t = imageToken.get();
  if (t) q.set('token', t);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

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
