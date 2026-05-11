import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  onFiles: (files: File[]) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

export function UploadZone({ onFiles, t }: Props) {
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
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      if (!items?.length) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type?.startsWith('image/')) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const ext = (blob.type.split('/')[1] || 'png').split('+')[0];
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          try {
            files.push(new File([blob], `pasted-${stamp}.${ext}`, { type: blob.type }));
          } catch {
            files.push(blob);
          }
        }
      }
      if (!files.length) return;
      e.preventDefault();
      // Brief drop-zone flash for feedback
      setDragOver(true);
      setTimeout(() => setDragOver(false), 240);
      dispatch(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [dispatch]);

  return (
    <section className="panel">
      <h2>
        <span className="step-num">2</span>
        <span>{t('upload_title')}</span>
      </h2>
      <div
        ref={dropRef}
        className={`drop ${dragOver ? 'dragover' : ''}`}
        onClick={e => { e.preventDefault(); inputRef.current?.click(); }}
      >
        <strong>{t('drop_strong')}</strong>
        <p>{t('drop_sub')}</p>
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
