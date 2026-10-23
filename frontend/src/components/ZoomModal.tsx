import { useEffect } from 'react';
import { useBackClose } from '../hooks/useBackClose.ts';

interface Props {
  src: string | null;
  caption: string;
  onClose: () => void;
}

export function ZoomModal({ src, caption, onClose }: Props) {
  useBackClose(!!src, onClose);
  // Esc to close
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div className="zoom-modal open" onClick={onClose}>
      <div className="zoom-backdrop" />
      <img className="zoom-image" src={src} alt="" />
      {caption ? <div className="zoom-caption">{caption}</div> : null}
    </div>
  );
}
