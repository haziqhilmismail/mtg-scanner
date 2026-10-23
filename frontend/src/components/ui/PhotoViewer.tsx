import { useState, type ReactNode } from 'react';
import { Icon } from '../Icon.tsx';
import { Modal } from './Modal.tsx';
import { Segmented } from './Segmented.tsx';

export interface ViewerImage {
  src: string;
  alt: string;
  label?: string;  // with two images: the switch above them ("Your card", "Matched card")
}

interface PhotoViewerProps {
  open: boolean;
  onClose: () => void;
  images: ViewerImage[];  // one photo, or the two a card tile compares
  label: string;  // names the viewer, e.g. "Photo 2, full screen"
  closeLabel: string;
  flipLabel?: string;  // with two images, what a click on the image does
  start?: number;
  children?: ReactNode;  // a caption under the image
}

// Full screen and always dark, the image in the middle, the round close
// button at the bottom where a thumb reaches it. With two images, a click
// on the image flips to the other one.
export function PhotoViewer({ open, onClose, label, ...body }: PhotoViewerProps) {
  return (
    <Modal open={open} onClose={onClose} className="ui-viewer" data-theme="dark" aria-label={label}>
      <ViewerBody label={label} onClose={onClose} {...body} />
    </Modal>
  );
}

// Mounted per opening, so each one starts at `start`.
function ViewerBody({ images, label, closeLabel, flipLabel, start = 0, onClose, children }: Omit<PhotoViewerProps, 'open'>) {
  const [at, setAt] = useState(start);
  const image = images[at];
  const two = images.length === 2;
  return (
    <>
      {two && images.every(i => i.label) ? (
        <Segmented
          aria-label={label}
          value={String(at)}
          onChange={v => setAt(Number(v))}
          options={images.map((img, i) => ({ value: String(i), label: img.label }))}
        />
      ) : null}
      {two ? (
        <button type="button" className="ui-viewer-media" aria-label={flipLabel} onClick={() => setAt(1 - at)}>
          <img key={at} src={image.src} alt={image.alt} />
        </button>
      ) : (
        <div className="ui-viewer-media"><img src={image.src} alt={image.alt} /></div>
      )}
      {children}
      <button type="button" className="ui-viewer-close" aria-label={closeLabel} onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
    </>
  );
}
