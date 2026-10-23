import { useEffect, useRef, useState } from 'react';
import { createSaveQueue } from '../lib/saveQueue.ts';

export const RETRY_MS = 5000;

// A save queue (lib/saveQueue.ts) on a timer: `later(ms)` sends what's unsaved
// after ms, a failed save is tried again after RETRY_MS, and hiding or leaving
// the page (phones rarely fire unload) sends everything at once with
// keepalive. Unmounting (signing out) stops all saving.
export function useSaveQueue<K, V>(
  send: (key: K, value: V, final: boolean, rev: number) => Promise<void>,
  saved: (key: K) => void,
  refused: (key: K) => void,
  options: { ordered?: boolean } = {},
) {
  const timer = useRef<number | undefined>(undefined);
  const [saves] = useState(() => {
    const later = (ms: number) => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => queue.flush(), ms);
    };
    const queue = createSaveQueue(send, saved, () => later(RETRY_MS), refused, options);
    // Send now; final (leaving, signing out) also resends what is in flight.
    const flush = (final = false) => {
      clearTimeout(timer.current);
      queue.flush(final);
    };
    return { queue, later, flush };
  });

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') saves.flush(true); };
    const onPageHide = () => saves.flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(timer.current);
      saves.queue.clear();
    };
  }, [saves]);

  return saves;
}
