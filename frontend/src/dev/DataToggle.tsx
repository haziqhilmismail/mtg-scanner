// The dev data toggle: a segmented control fixed at the bottom centre that
// picks the data the app's API calls answer with (harness.ts). It renders in
// its own React root, inside a shadow root on <body>, so neither the app's
// tree nor its CSS reaches it.

import { createRoot } from 'react-dom/client';
import { MODE_KEY, type DataMode } from './mode.ts';

const SEGMENTS: Array<[DataMode, string]> = [
  ['live', 'Live'], ['worst', 'Worst case'], ['empty', 'Empty'], ['one', 'One'], ['many', 'Many'],
];

const CSS = `
div { display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: #d4d4d8; box-shadow: 0 1px 4px rgb(0 0 0 / 0.25); }
button { all: unset; padding: 7px 10px; border-radius: 7px; color: #3f3f46; font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; white-space: nowrap; cursor: pointer; }
button[aria-pressed='true'] { background: #fff; color: #18181b; box-shadow: 0 1px 2px rgb(0 0 0 / 0.2); }
button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
`;

// The URL carries the mode for a reload or a shared link, the tab's
// sessionStorage for a navigation that drops the query.
function choose(mode: DataMode) {
  sessionStorage.setItem(MODE_KEY, mode);
  const url = new URL(location.href);
  url.searchParams.set('data', mode);
  history.replaceState(history.state, '', url);
  location.reload();
}

function DataToggle({ mode }: { mode: DataMode }) {
  return (
    <>
      <style>{CSS}</style>
      <div role="group" aria-label="Test data">
        {SEGMENTS.map(([m, label]) => (
          <button key={m} type="button" aria-pressed={m === mode} onClick={() => m !== mode && choose(m)}>{label}</button>
        ))}
      </div>
    </>
  );
}

export function mountToggle(mode: DataMode) {
  const host = document.createElement('dev-data-toggle');
  host.style.cssText = 'all: initial; position: fixed; left: 50%; bottom: calc(8px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 2147483647;';
  document.body.append(host);
  createRoot(host.attachShadow({ mode: 'open' })).render(<DataToggle mode={mode} />);
}
