import { useEffect, useRef, useState } from 'react';
import { pastedImages, popupOpen } from '../utils.ts';

// The photos among some files (HEIC from an iPhone often has no type).
export const photosOf = (files: FileList | File[]) => Array.from(files).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

// Photos dragged onto the page or pasted (Ctrl/⌘+V) go to onFiles: a
// convenience on a computer, with nothing on screen for it until files are
// dragged over the page (then `dragging` is true, for a hint of where they
// go). A drop with no photos in it calls onFiles with none. Ignored while a
// popup is open over the page.
export function usePhotoDrop(onFiles: (photos: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFiles);
  latest.current = onFiles;

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

  return dragging;
}
