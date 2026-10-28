// The dev data harness (break-ui): when a data mode is on, the app's API
// calls are answered from test data instead of the backend, and the toggle
// that picks the mode shows. main.tsx loads it in dev builds only, before the
// app renders, so even the first request is answered.

import { apiUrl, authToken, fixtureImages } from '../api/http.ts';
import { fakeBackend } from './backend.ts';
import { mountToggle } from './DataToggle.tsx';
import { buildFixture } from './fixtures.ts';
import { MODE_KEY, pickMode } from './mode.ts';
import { pictureAt } from './store.ts';

// Stands in for a session token, so the app opens signed in as the test
// seller. Only set when there is no real one; cleared on the way back to live.
const TEST_TOKEN = 'test-data';

export function installHarness(): void {
  const mode = pickMode(location.search, sessionStorage.getItem(MODE_KEY));
  sessionStorage.setItem(MODE_KEY, mode);
  mountToggle(mode);
  if (mode === 'live') {
    if (authToken.get() === TEST_TOKEN) authToken.clear();
    return;
  }
  const fixture = buildFixture(mode);
  const answer = fakeBackend(fixture);
  // Every API call goes through fetch: request() and the few direct calls
  // (the bug reporter, the QR download) alike.
  const realFetch = window.fetch.bind(window);
  const apiOrigin = new URL(apiUrl('/'), location.href).origin;
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    // The support QR is real even in test data, like its <img>: it is public, and not in this repo.
    if (url.origin !== apiOrigin || !url.pathname.startsWith('/api/') || url.pathname === '/api/support-qr') return realFetch(input, init);
    return answer(input instanceof Request ? input : new Request(url, init));
  };
  // <img> tags don't use fetch: their image routes point at fixture pictures.
  fixtureImages.urlFor = path => pictureAt(fixture, path);
  if (!authToken.get()) authToken.set(TEST_TOKEN);
}
