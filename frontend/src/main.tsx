import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { installGlobalBugReporter } from './lib/bugReporter.ts';
import './styles.css';

// Capture window.onerror + unhandledrejection before React mounts — that way
// even a crash during initial render gets reported.
installGlobalBugReporter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
