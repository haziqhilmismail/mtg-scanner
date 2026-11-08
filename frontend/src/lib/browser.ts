import { useEffect, useRef, useState } from 'react';

// Dates in the app's language: "24 Okt" or "24 Oct".
export const dateLocale = (lang: string) => (lang === 'ms' ? 'ms-MY' : 'en-MY');

// A touch screen as the main pointer: a phone or tablet, which has a camera
// and a share sheet.
export const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const canShareFiles = (files: File[]) => typeof navigator !== 'undefined' && !!navigator.canShare?.({ files });

// The seller's DuitNow QR picture as a file to share, copy or save.
export const fetchQrFile = (url: string) => fetch(url)
  .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then(b => new File([b], 'duitnow-qr.png', { type: 'image/png' }));

// Whether a popup is open over the page: a paste then belongs to it, not
// to the page's drop area behind it.
export const popupOpen = () => !!document.querySelector('dialog[open], [role="menu"]');

// A key press that belongs to a field or to an open popup, not to the page.
export function keyTaken(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return true;
  return popupOpen();
}

// The images in a paste (Ctrl/⌘+V), named for when they were pasted.
export function pastedImages(e: ClipboardEvent): File[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return Array.from(e.clipboardData?.items ?? [])
    .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    .map(i => i.getAsFile())
    .filter((f): f is File => !!f)
    .map(f => new File([f], `pasted-${stamp}.${(f.type.split('/')[1] || 'png').split('+')[0]}`, { type: f.type }));
}

// Files dragged onto the page or images pasted (Ctrl/⌘+V): a shortcut on a
// computer, with nothing on screen until files are dragged over. `take` says
// whether they are wanted right now. While `enabled`, a file dropped when
// they are not still doesn't open in the tab. A drop zone of its own (one
// that cancels the dragover) is left alone. Returns whether wanted files are
// being dragged over, to show a drop overlay.
export function useFileDrop(enabled: boolean, take: () => boolean, onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ take, onFiles });
  latest.current = { take, onFiles };

  useEffect(() => {
    if (!enabled) return;
    // dragenter and dragleave fire for every element crossed; the drag has
    // left the window when they even out.
    let depth = 0;
    let timer = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const hide = () => { depth = 0; clearTimeout(timer); setDragging(false); };
    // dragover repeats while files hover, so a pause in it also means they left.
    const show = () => { setDragging(latest.current.take()); clearTimeout(timer); timer = window.setTimeout(hide, 1000); };
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth += 1; show(); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) hide(); };
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = latest.current.take() ? 'copy' : 'none';
      show();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      hide();
      if (e.defaultPrevented) return;
      // Never let the browser open the file in place of the app.
      e.preventDefault();
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

// Saves a file the app made, as the browser downloads one.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
