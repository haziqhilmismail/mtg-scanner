import { useEffect, useRef, useState } from 'react';
import type { T } from '../hooks/useLang.ts';
import { photosOf } from '../lib/photoFiles.ts';
import { pastedImages, popupOpen } from '../utils.ts';
import { Icon } from './Icon.tsx';
import { useToast } from './ui/Toast.tsx';

const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

// Photos dragged onto the page or pasted (Ctrl/⌘+V) go to onPhotos: a
// convenience on a computer, with nothing on screen for it until files are
// dragged over the page (then a quiet overlay says where they go). Ignored
// while a popup is open over the page.
export function PhotoDrop({ label, onPhotos, t }: { label: string; onPhotos: (photos: File[]) => void; t: T }) {
  const toast = useToast();
  const [dragging, setDragging] = useState(false);
  const take = (photos: File[]) => (photos.length ? onPhotos(photos) : toast(t('drop_no_photos')));
  const latest = useRef(take);
  latest.current = take;

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed; the drag has
    // left the window when they even out.
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth += 1;
      setDragging(!popupOpen());
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // Never let the browser open the photo in place of the app.
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (!popupOpen()) latest.current(photosOf(e.dataTransfer?.files ?? []));
    };
    const paste = (e: ClipboardEvent) => {
      if (popupOpen()) return;
      const photos = pastedImages(e);
      if (!photos.length) return;
      e.preventDefault();
      latest.current(photos);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
    };
  }, []);

  return dragging ? <div className="drop-hint" aria-hidden="true"><span><Icon name="photo" size={28} />{label}</span></div> : null;
}
