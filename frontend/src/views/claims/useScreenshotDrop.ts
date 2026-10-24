import { useEffect, useRef, useState } from 'react';
import { pastedImages } from '../../utils.ts';

// Screenshots pasted (Ctrl/⌘+V) or dragged in: a PC shortcut beside the
// button that chooses them, with nothing on screen until files are dragged
// over. `take` says whether they are wanted right now. While `enabled`, a
// file dropped when they are not still doesn't open in the tab.
// Returns whether wanted files are being dragged over, to show a drop overlay.
export function useScreenshotDrop(enabled: boolean, take: () => boolean, onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ take, onFiles });
  latest.current = { take, onFiles };

  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    let timer = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const hide = () => { depth = 0; clearTimeout(timer); setDragging(false); };
    // dragover repeats while files hover, so a pause in it also means they left.
    const show = () => { setDragging(latest.current.take()); clearTimeout(timer); timer = window.setTimeout(hide, 1000); };
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth += 1; show(); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) hide(); };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = latest.current.take() ? 'copy' : 'none';
      show();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      hide();
      if (latest.current.take()) latest.current.onFiles(Array.from(e.dataTransfer!.files));
    };
    const paste = (e: ClipboardEvent) => {
      const images = pastedImages(e);
      if (!images.length || !latest.current.take()) return;
      e.preventDefault();
      latest.current.onFiles(images);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      hide();
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
    };
  }, [enabled]);

  return dragging;
}
