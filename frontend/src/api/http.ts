// Every request goes through request(), which sends the session token. The
// tokens are read fresh from storage each time, so signing out takes effect
// at once (no in-memory copy to invalidate).

import { KEY, storage } from '../lib/storage.ts';
import type { Credits } from './credits.ts';

// Where the API lives. The real site calls the Cloudflare Tunnel straight,
// which skips the hop through the Vercel rewrite. Everywhere else (Vercel
// previews, the dev server) stays on the same-site /api route, because the
// backend's CORS list only has the real site.
const API_BASE = typeof location !== 'undefined' && location.hostname === 'mtg.haziqhilmi.com'
  ? 'https://api.haziqhilmi.com' : '';
export const apiUrl = (path: string) => API_BASE + path;

const storedToken = (key: string) => ({
  get: () => storage.get(key),
  set: (token: string) => storage.set(key, token),
  clear: () => storage.remove(key),
});

export const authToken = storedToken(KEY.authToken);
// Image-only token: <img src> can't send headers, so pictures carry this in
// the URL. It can load images and nothing else, unlike the session token.
export const imageToken = storedToken(KEY.imageToken);

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

export function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const t = authToken.get();
  if (t) h.set('Authorization', `Bearer ${t}`);
  return h;
}

// A response the server refused. The message is the server's detail (or
// "HTTP <status>"), fit to show the user; `detail` is the raw one.
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;
  constructor(message: string, status: number, detail: unknown = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  // The server's error code when its detail carries one, as the voucher route's does.
  get code(): string | undefined {
    return (this.detail as { code?: string } | null | undefined)?.code;
  }
}

// The status the server refused with; 0 for anything else (network, a bug).
export const statusOf = (e: unknown): number => (e instanceof ApiError ? e.status : 0);

// 402: the scan or claim read costs a credit the user does not have.
export class OutOfCreditsError extends ApiError {
  readonly credits: Credits | null;
  constructor(detail: unknown) {
    super('Out of scan credits', 402, detail);
    this.name = 'OutOfCreditsError';
    this.credits = (detail as { credits?: Credits } | null | undefined)?.credits ?? null;
  }
}

// Every API call goes through here. `json` is sent as the JSON body.
// `keepalive` lets a request finish while the page is closing.
export async function request(url: string, { json, ...init }: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = authHeaders(init.headers);
  if (json !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(json);
  }
  const r = await fetch(apiUrl(url), { ...init, headers });
  if (r.ok) return r;
  const text = await r.text().catch(() => '');
  let detail: unknown;
  try { detail = JSON.parse(text).detail; } catch { /* not JSON (e.g. a proxy's error page) */ }
  if (r.status === 402) throw new OutOfCreditsError(detail);
  throw new ApiError(typeof detail === 'string' && detail ? detail : `HTTP ${r.status}`, r.status, detail);
}

// A call whose answer is JSON, or nothing (204).
export async function fetchJson<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const r = await request(url, { method, json: body, keepalive });
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}
