import { useState, type ReactNode } from 'react';
import { Icon } from '../Icon.tsx';
import { Modal } from './Modal.tsx';
import { Segmented } from './Segmented.tsx';

export interface ViewerImage {
  src: string;
  alt: string;
}

// One side of a card tile's pair; `label` names it on the switch above ("Your card").
export type ViewerSide = ViewerImage & { label: string };

type Common = {
  open: boolean;
  onClose: () => void;
  label: string;  // names the viewer, e.g. "Photo 2, full screen"
  closeLabel: string;
  children?: ReactNode;
};

// One photo, the pair a card tile compares (a click on the image flips it),
// or other media that fills the same space, such as a photo with its labels.
export type PhotoViewerProps = Common & (
  | { image: ViewerImage }
  | { media: ReactNode }
  | { pair: [ViewerSide, ViewerSide]; flipLabel: string; start?: 0 | 1 }
);

export function PhotoViewer(props: PhotoViewerProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} className="ui-viewer" data-theme="dark" aria-label={props.label}>
      <ViewerBody {...props} />
    </Modal>
  );
}

function ViewerBody(props: PhotoViewerProps) {
  const [at, setAt] = useState<number>('pair' in props ? props.start ?? 0 : 0);
  const media = 'pair' in props ? (
    <>
      <Segmented
        aria-label={props.label}
        value={String(at)}
        onChange={v => setAt(Number(v))}
        options={props.pair.map((side, i) => ({ value: String(i), label: side.label }))}
      />
      <button type="button" className="ui-viewer-media" aria-label={props.flipLabel} onClick={() => setAt(1 - at)}>
        <img key={at} src={props.pair[at].src} alt={props.pair[at].alt} />
      </button>
    </>
  ) : (
    <div className="ui-viewer-media">{'media' in props ? props.media : <img src={props.image.src} alt={props.image.alt} />}</div>
  );
  return (
    <>
      {media}
      {props.children}
      <button type="button" className="ui-viewer-close" aria-label={props.closeLabel} onClick={props.onClose}>
        <Icon name="close" size={20} />
      </button>
    </>
  );
}
