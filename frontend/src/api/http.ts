// Every request goes through request(), which sends the session token. The
// tokens are read fresh from localStorage each time, so signing out takes
// effect at once (no in-memory copy to invalidate).

import type { Credits } from '../types.ts';

// Where the API lives. The real site calls the Cloudflare Tunnel straight,
// which skips the hop through the Vercel rewrite. Everywhere else (Vercel
// previews, the dev server) stays on the same-site /api route, because the
// backend's CORS list only has the real site.
const API_BASE = typeof location !== 'undefined' && location.hostname === 'mtg.haziqhilmi.com'
  ? 'https://api.haziqhilmi.com' : '';
export const apiUrl = (path: string) => API_BASE + path;

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

// Set by the dev test-data harness (src/dev/harness.ts) to point image routes
// at its own pictures. Never set in a production build.
export const fixtureImages: { urlFor?: (path: string) => string } = {};

// URL for an image route, with the image token (empty in solo mode) and any
// non-empty params in the query string.
export function imageUrl(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  if (fixtureImages.urlFor) return fixtureImages.urlFor(path);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  const t = imageToken.get();
  if (t) q.set('token', t);
  const qs = q.toString();
  return apiUrl(qs ? `${path}?${qs}` : path);
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
// message is the server's detail (or "HTTP <status>"), fit to show the user,
// with `.status` and the raw `.detail` attached for callers that branch on
// them. 402 is always "out of scan credits".
export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(apiUrl(url), { ...init, headers: authHeaders(init.headers) });
  if (r.ok) return r;
  const text = await r.text().catch(() => '');
  let detail: unknown;
  try { detail = JSON.parse(text).detail; } catch { /* not JSON (e.g. a proxy's error page) */ }
  if (r.status === 402) {
    throw new OutOfCreditsError((detail as { credits?: Credits } | undefined)?.credits ?? null);
  }
  const msg = typeof detail === 'string' && detail ? detail : `HTTP ${r.status}`;
  throw Object.assign(new Error(msg), { status: r.status, detail });
}
