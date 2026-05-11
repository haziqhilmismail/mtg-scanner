import { useEffect } from 'react';

interface Props {
  src: string | null;
  caption: string;
  onClose: () => void;
}

export function ZoomModal({ src, caption, onClose }: Props) {
  // Esc to close
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
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
