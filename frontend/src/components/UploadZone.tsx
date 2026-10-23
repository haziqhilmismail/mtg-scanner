import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pastedImages, popupOpen } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';

interface Props {
  // Paste only reaches the tab that is showing.
  active: boolean;
  onFiles: (files: File[]) => void;
  t: T;
  // Inside a post the photos are the point, so the zone shrinks to one row.
  compact?: boolean;
  // Shown between the heading and the drop area (the new post's kind).
  children?: ReactNode;
}

export function UploadZone({ active, onFiles, t, compact, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string>('');

  const filterFiles = useCallback((fl: FileList | File[]) => {
    return Array.from(fl).filter(
      f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name),
    );
  }, []);

  const dispatch = useCallback((fl: FileList | File[]) => {
    const files = filterFiles(fl);
    if (!files.length) {
      setStatus(t('drop_no_images'));
      return;
    }
    setStatus('');
    onFiles(files);
  }, [filterFiles, onFiles, t]);

  // Drag-and-drop
  useEffect(() => {
    const node = dropRef.current;
    if (!node) return;

    const enter = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter.current++;
      setDragOver(true);
    };
    const over = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const leave = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); }
    };
    const drop = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      dragCounter.current = 0; setDragOver(false);
      if (e.dataTransfer?.files?.length) dispatch(e.dataTransfer.files);
    };

    node.addEventListener('dragenter', enter);
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);

    const winOver = (e: DragEvent) => e.preventDefault();
    const winDrop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', winOver);
    window.addEventListener('drop', winDrop);

    return () => {
      node.removeEventListener('dragenter', enter);
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
      window.removeEventListener('dragover', winOver);
      window.removeEventListener('drop', winDrop);
    };
  }, [dispatch]);

  // Paste (Ctrl/Cmd+V from clipboard)
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      if (popupOpen()) return;
      const files = pastedImages(e);
      if (!files.length) return;
      e.preventDefault();
      // Brief drop-zone flash for feedback
      setDragOver(true);
      setTimeout(() => setDragOver(false), 240);
      dispatch(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [active, dispatch]);

  return (
    <section className={`panel ${compact ? 'upload-compact' : ''}`}>
      {compact ? null : <h2>{t('upload_title')}</h2>}
      {children}
      <div
        ref={dropRef}
        className={`drop ${dragOver ? 'dragover' : ''}`}
        role="button"
        tabIndex={0}
        onClick={e => { e.preventDefault(); inputRef.current?.click(); }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); }
        }}
      >
        <Icon name="photo" size={compact ? 22 : 34} className="drop-icon" />
        <strong>{compact ? t('drop_add_more') : t('drop_strong')}</strong>
        {compact ? null : (
          <>
            <p>{t('drop_sub')}</p>
            <p className="drop-photo-tip">{t('drop_photo_tip')}</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          if (e.target.files?.length) dispatch(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="status">{status}</div>
    </section>
  );
}
