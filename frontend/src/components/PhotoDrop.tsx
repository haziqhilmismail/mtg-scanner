import type { T } from '../hooks/useLang.ts';
import { popupOpen, useFileDrop } from '../lib/browser.ts';
import { photosOf } from '../lib/photoFiles.ts';
import { Icon } from './Icon.tsx';
import { useToast } from './ui/Toast.tsx';

// Photos dragged onto the page or pasted (Ctrl/⌘+V) go to onPhotos: a
// convenience on a computer, with nothing on screen for it until files are
// dragged over the page (then a quiet overlay says where they go). Ignored
// while a popup is open over the page.
export function PhotoDrop({ label, onPhotos, t }: { label: string; onPhotos: (photos: File[]) => void; t: T }) {
  const toast = useToast();
  const dragging = useFileDrop(true, () => !popupOpen(), files => {
    const photos = photosOf(files);
    if (photos.length) onPhotos(photos); else toast(t('drop_no_photos'));
  });
  return dragging ? <div className="drop-hint" aria-hidden="true"><span><Icon name="photo" size={28} />{label}</span></div> : null;
}
