import type { Credits } from '../types.ts';
import { Icon } from './Icon.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pastedImages } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';

interface Props {
  onFiles: (files: File[]) => void;
  t: T;
  lang: string;
  // Scan-credit balance; null until loaded (and in solo mode it isn't enforced).
  credits: Credits | null;
  onEnterVoucher: () => void;
  // Inside a post the photos are the point, so the zone shrinks to one row.
  compact?: boolean;
}

export function UploadZone({ onFiles, t, lang, credits, onEnterVoucher, compact }: Props) {
  const limited = !!credits && credits.enforced && !credits.unlimited;
  const outOfCredits = limited && credits.remaining === 0;
  const nextBack = credits?.next_free_at
    ? new Date(credits.next_free_at).toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short' })
    : '';
  let balance = '';
  if (credits?.enforced && credits.unlimited) balance = t('credits_unlimited');
  else if (limited) {
    balance = t('credits_free_left', { n: Math.max(0, credits.limit - credits.used), limit: credits.limit });
    if (credits.bonus > 0) balance += ' ' + t('credits_plus_extra', { n: credits.bonus });
    if (credits.used > 0 && nextBack) balance += ' · ' + t('credits_next_back', { date: nextBack });
  }

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
    if (outOfCredits) return;
    const files = filterFiles(fl);
    if (!files.length) {
      setStatus(t('drop_no_images'));
      return;
    }
    setStatus('');
    onFiles(files);
  }, [filterFiles, onFiles, t, outOfCredits]);

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
  }, [dispatch]);

  return (
    <section className={`panel ${compact ? 'upload-compact' : ''}`}>
      {compact ? null : <h2>{t('upload_title')}</h2>}
      {outOfCredits ? (
        <div className="drop is-empty" ref={dropRef}>
          <strong>{t('credits_out_title')}</strong>
          <p>{nextBack ? t('credits_out_body', { date: nextBack, limit: credits.limit }) : t('credits_out_body_plain', { limit: credits.limit })}</p>
          <button type="button" className="accent" onClick={onEnterVoucher}>
            <Icon name="ticket" size={18} />{t('voucher_enter')}
          </button>
        </div>
      ) : (
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
      )}
      {balance && !outOfCredits ? <p className="credits-line">{balance}</p> : null}
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
