import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { installGlobalBugReporter } from './lib/bugReporter.ts';
import './styles.css';

// Capture window.onerror + unhandledrejection before React mounts — that way
// even a crash during initial render gets reported.
installGlobalBugReporter();

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

// Dev builds load the test-data harness first (src/dev/), so even the first
// API call answers from the data picked. If it fails, the app stays blank
// rather than show live data under a test-data toggle. A production build has
// none of it.
if (import.meta.env.DEV) import('./dev/harness.ts').then(h => h.installHarness()).then(render);
else render();
