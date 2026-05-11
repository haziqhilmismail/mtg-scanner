import { useEffect, useRef, useState } from 'react';
import { postsApi, type Post } from '../../api/checklist.ts';

interface Props {
  initial: Post | null;
  onSaved: (p: Post) => void;
  onCancel: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

// Create or edit a Post. Image is pasted (Ctrl/⌘+V), drag-dropped, or chosen
// via the file input. We hold the file in state and upload on save so a
// canceled form doesn't leave orphaned bytes on disk.
export function PostForm({ initial, onSaved, onCancel, t }: Props) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [fbUrl, setFbUrl] = useState(initial?.fb_url ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initial?.has_image ? postsApi.imageUrl(initial.id) : null,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Generate/cleanup an object URL for the pending file so paste/drop previews
  useEffect(() => {
    if (!pendingImage) return;
    const url = URL.createObjectURL(pendingImage);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingImage]);

  // Global paste handler while this form is mounted — pasting a clipboard
  // image becomes the reminder image without a file picker round-trip.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            setPendingImage(f);
            e.preventDefault();
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setPendingImage(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) setPendingImage(f);
  };

  const removeImage = async () => {
    setPendingImage(null);
    if (initial?.has_image) {
      try { await postsApi.deleteImage(initial.id); }
      catch (e) { setErr((e as Error).message); return; }
    }
    setPreviewUrl(null);
  };

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      let saved: Post;
      if (isEdit && initial) {
        saved = await postsApi.update(initial.id, {
          title: title.trim() || null,
          fb_url: fbUrl.trim() || null,
          note: note.trim() || null,
        });
        if (pendingImage) {
          saved = await postsApi.uploadImage(initial.id, pendingImage);
        }
      } else {
        saved = await postsApi.create({
          title: title.trim() || null,
          fb_url: fbUrl.trim() || null,
          note: note.trim() || null,
          image: pendingImage,
        });
      }
      onSaved(saved);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-card">
      <h3>{isEdit ? t('ck_post_edit_title') : t('ck_post_new_title')}</h3>

      <div className="form-grid">
        <label className="full">
          <span>{t('ck_post_title')}</span>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('ck_post_title_placeholder')}
          />
        </label>
        <label className="full">
          <span>{t('ck_post_fb_url')}</span>
          <input
            value={fbUrl}
            onChange={e => setFbUrl(e.target.value)}
            placeholder="https://facebook.com/…"
          />
          <small className="field-notice">⚠ {t('ck_post_fb_url_notice')}</small>
        </label>
        <label className="full">
          <span>{t('ck_post_note')}</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} />
        </label>
      </div>

      <div
        ref={dropRef}
        className={`post-image-drop${previewUrl ? ' has-image' : ''}`}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        {previewUrl ? (
          <>
            <img src={previewUrl} alt="" />
            <div className="overlay">
              <span>{t('ck_post_image_replace_hint')}</span>
              <button type="button" className="ghost" onClick={(e) => { e.stopPropagation(); removeImage(); }}>
                {t('ck_post_image_remove')}
              </button>
            </div>
          </>
        ) : (
          <div className="empty">
            <strong>{t('ck_post_image_drop_strong')}</strong>
            <span>{t('ck_post_image_drop_sub')}</span>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onPickFile}
        />
      </div>

      {err ? <div className="form-error" style={{ marginTop: 10 }}>{err}</div> : null}

      <div className="form-actions">
        <button className="accent" disabled={busy} onClick={save}>
          {busy ? t('ck_saving') : (isEdit ? t('ck_post_save') : t('ck_post_create_btn'))}
        </button>
        <button className="ghost" disabled={busy} onClick={onCancel}>{t('ck_cancel')}</button>
      </div>
    </div>
  );
}
