// Frontend bug reporter. Captures only *unexpected* runtime errors:
//   - React render crashes (ErrorBoundary calls reportBug from componentDidCatch)
//   - `window.onerror` (sync exceptions outside React)
//   - `unhandledrejection` (a thrown Promise nobody caught)
//
// Expected error UI paths (fetch error toasts, validation messages) are NOT
// fed in here — those are already shown to the user and don't need to page
// the dev. The Telegram push is on the backend side; we just POST a report.

import { authHeaders } from '../api/http.ts';

const ENDPOINT = '/api/bug';
const MAX_STACK = 8_000;
const CLIENT_DEDUP_WINDOW_MS = 60_000;
const CLIENT_DEDUP_MAX = 50;

const _recent: Map<string, number> = new Map();

function _fingerprint(payload: { exception_type: string; message: string; stack?: string }): string {
  const stackHead = (payload.stack ?? '').split('\n').find(l => l.trim().startsWith('at '))?.slice(0, 200) ?? '';
  return `${payload.exception_type}|${payload.message.slice(0, 200)}|${stackHead}`;
}

function _suppressLocally(fp: string): boolean {
  const now = Date.now();
  // Sweep old entries opportunistically so the Map can't grow unbounded.
  if (_recent.size > CLIENT_DEDUP_MAX) {
    for (const [k, t] of _recent) {
      if (now - t > CLIENT_DEDUP_WINDOW_MS) _recent.delete(k);
    }
  }
  const last = _recent.get(fp);
  if (last !== undefined && now - last < CLIENT_DEDUP_WINDOW_MS) {
    _recent.set(fp, now);
    return true;
  }
  _recent.set(fp, now);
  return false;
}

export interface BugPayload {
  message: string;
  exception_type?: string;
  stack?: string;
  route?: string;
}

export async function reportBug(payload: BugPayload): Promise<void> {
  const body = {
    message: (payload.message || 'Unknown error').slice(0, 2000),
    exception_type: (payload.exception_type || 'Error').slice(0, 128),
    stack: payload.stack ? payload.stack.slice(0, MAX_STACK) : undefined,
    route: payload.route ?? (typeof window !== 'undefined' ? window.location.pathname : undefined),
  };
  const fp = _fingerprint(body);
  if (_suppressLocally(fp)) return;
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      keepalive: true,  // survive a tab close mid-error
    });
  } catch {
    // Reporting failed — nothing we can do. Don't recurse.
  }
}

let _installed = false;

export function installGlobalBugReporter(): void {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const err = event.error;
    reportBug({
      exception_type: err?.name || 'Error',
      message: err?.message || event.message || 'window.onerror',
      stack: err?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      reportBug({
        exception_type: reason.name || 'UnhandledRejection',
        message: reason.message || String(reason),
        stack: reason.stack,
      });
    } else {
      reportBug({
        exception_type: 'UnhandledRejection',
        message: typeof reason === 'string' ? reason : JSON.stringify(reason).slice(0, 500),
      });
    }
  });
}
