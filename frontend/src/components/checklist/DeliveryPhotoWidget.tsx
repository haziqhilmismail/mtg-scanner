import { useEffect, useRef, useState } from 'react';

import { ordersApi, type Order } from '../../api/checklist.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';
import { pastedImages } from '../../utils.ts';

type T = (k: string, vars?: Record<string, string | number>) => string;

interface Props {
  // One or more orders that share a single delivery-proof photo. Pass a
  // one-element array for individual order cards; pass the whole group for
  // collapsed GroupedCard. Uploads fan out to every order, deletes too —
  // the photo "belongs to the drop-off event", not any one order.
  orders: Order[];
  onChange: () => void;
  t: T;
}

/**
 * Optional delivery-proof photo for an order (or group of orders that were
 * dropped off together). Two states:
 *   - no photo on any order → "Add delivery photo" prompt
 *   - photo set on at least one order → thumbnail + Copy / Replace / Remove
 *
 * Display sources the photo from the first order that has one (single-order
 * cards have at most one; for groups, the chosen orders all carry the same
 * bytes since uploads fan out). Copy goes through a canvas re-encode so the
 * clipboard always receives image/png regardless of how the source was
 * uploaded — broader browser support than `image/jpeg` via `ClipboardItem`.
 */
export function DeliveryPhotoWidget({ orders, onChange, t }: Props) {
  const dialog = useDialog();
  const zoom = useImageZoom();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);
  const [busy, setBusy] = useState<null | 'upload' | 'copy' | 'remove'>(null);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Hover scopes the document-level paste listener so Ctrl/⌘+V only targets
  // *this* widget when the cursor is over its drop zone. Without scoping,
  // every order's widget would race to claim the paste.
  const [hovered, setHovered] = useState(false);

  const showError = (e: unknown) =>
    dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });

  const onPick = () => fileRef.current?.click();

  // Bucket orders that share the *same* logical photo by upload-timestamp
  // proximity. Fan-out uploads (single click on the group widget triggers
  // N sequential POSTs) land within ~1s of each other; separately uploaded
  // photos sit at distinct times. A 30-second window absorbs slow networks
  // while still keeping genuinely separate uploads as distinct buckets.
  //
  // Each bucket renders as one thumbnail; Copy / Replace / Remove on that
  // thumbnail scope to its own bucket so other buckets aren't disturbed.
  const FAN_OUT_WINDOW_MS = 30_000;
  const sortedWithPhoto = orders
    .filter(o => o.has_delivery_photo && o.delivery_photo_uploaded_at)
    .sort((a, b) =>
      new Date(a.delivery_photo_uploaded_at!).getTime()
      - new Date(b.delivery_photo_uploaded_at!).getTime()
    );
  const photoBuckets: Order[][] = [];
  for (const o of sortedWithPhoto) {
    const last = photoBuckets[photoBuckets.length - 1];
    const lastT = last
      ? new Date(last[last.length - 1].delivery_photo_uploaded_at!).getTime()
      : Number.NEGATIVE_INFINITY;
    const curT = new Date(o.delivery_photo_uploaded_at!).getTime();
    if (last && curT - lastT <= FAN_OUT_WINDOW_MS) {
      last.push(o);
    } else {
      photoBuckets.push([o]);
    }
  }
  const hasPhoto = photoBuckets.length > 0;

  const onUpload = async (file: File | null, target?: Order[]) => {
    if (!file) return;
    setBusy('upload');
    try {
      // Fan-out: upload the same file to every order in the target subset.
      // Defaults to *all* orders in the group so an initial upload (drop
      // zone, empty state) populates every order. Per-bucket Replace passes
      // a narrower subset so other buckets stay intact.
      const targets = target ?? orders;
      for (const o of targets) {
        await ordersApi.uploadDeliveryPhoto(o.id, file);
      }
      onChange();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
      // Clear the input so picking the same file again still triggers onChange
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Drag-and-drop on the empty dropzone. Bound conditionally — the drop
  // listeners only attach while no photo is set (the photo state renders a
  // <img> thumbnail instead and uses the Replace button to swap).
  useEffect(() => {
    if (hasPhoto) return;
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
      const f = Array.from(e.dataTransfer?.files ?? []).find(
        ff => ff.type.startsWith('image/') || /\.(heic|heif)$/i.test(ff.name),
      );
      if (f) onUpload(f);
    };
    node.addEventListener('dragenter', enter);
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragenter', enter);
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPhoto, orders.length]);

  // Paste — only while the dropzone is hovered, so each per-order widget
  // gets its own paste target instead of every widget racing for one event.
  useEffect(() => {
    if (hasPhoto || !hovered) return;
    const onPaste = (e: ClipboardEvent) => {
      const [file] = pastedImages(e);
      if (!file) return;
      e.preventDefault();
      onUpload(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPhoto, hovered, orders.length]);

  const onRemoveBucket = async (bucket: Order[]) => {
    const ok = await dialog.confirm({
      title: t('ck_dp_remove_title'),
      message: bucket.length > 1
        ? t('ck_dp_remove_msg_group', { n: bucket.length })
        : t('ck_dp_remove_msg'),
      okLabel: t('ck_dp_remove_btn'),
      destructive: true,
    });
    if (!ok) return;
    setBusy('remove');
    try {
      for (const o of bucket) {
        if (o.has_delivery_photo) {
          await ordersApi.deleteDeliveryPhoto(o.id);
        }
      }
      onChange();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  const onCopyBucket = async (bucket: Order[]) => {
    const head = bucket[0];
    if (!head) return;
    setBusy('copy');
    try {
      const url = ordersApi.deliveryPhotoUrl(head.id, head.delivery_photo_uploaded_at);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      const srcBlob = await resp.blob();
      // Re-encode to PNG via canvas so the clipboard receives image/png.
      // Browsers (esp. Safari) reject ClipboardItem with image/jpeg or HEIC.
      const pngBlob = await reencodeAsPng(srcBlob);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  // Per-bucket Replace: the next file pick targets only the bucket whose
  // Replace button was last clicked. Stored as a ref of order IDs so we
  // don't need a controlled-input dance.
  const replaceTargetRef = useRef<Order[] | null>(null);
  const onReplaceBucket = (bucket: Order[]) => {
    replaceTargetRef.current = bucket;
    onPick();
  };

  if (!hasPhoto) {
    return (
      <div className="delivery-photo empty">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => onUpload(e.target.files?.[0] ?? null)}
        />
        <div
          ref={dropRef}
          className={`dp-drop ${dragOver ? 'dragover' : ''} ${busy === 'upload' ? 'is-busy' : ''}`}
          onClick={onPick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); }
          }}
        >
          <strong>{busy === 'upload' ? t('ck_dp_uploading') : t('ck_dp_drop_strong')}</strong>
          <span className="dp-drop-sub">{t('ck_dp_drop_sub')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`delivery-photo${photoBuckets.length > 1 ? ' multi' : ''}`}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={e => {
          const file = e.target.files?.[0] ?? null;
          const target = replaceTargetRef.current;
          replaceTargetRef.current = null;
          onUpload(file, target ?? undefined);
        }}
      />
      {photoBuckets.map((bucket, i) => {
        const head = bucket[0];
        const photoUrl = ordersApi.deliveryPhotoUrl(head.id, head.delivery_photo_uploaded_at);
        return (
          <div className="delivery-photo-row" key={head.id}>
            <img
              className="dp-thumb zoomable"
              src={photoUrl}
              alt=""
              loading="lazy"
              onClick={() => zoom.open(photoUrl, t('ck_dp_zoom_caption'))}
            />
            <div className="dp-actions">
              <button
                type="button" className="ghost dp-btn"
                onClick={() => onCopyBucket(bucket)}
                disabled={busy !== null}
              >
                {copied && i === 0 ? t('ck_dp_copied')
                  : busy === 'copy' ? t('ck_dp_copying') : t('ck_dp_copy')}
              </button>
              <button
                type="button" className="ghost dp-btn"
                onClick={() => onReplaceBucket(bucket)}
                disabled={busy !== null}
              >
                {busy === 'upload' ? t('ck_dp_uploading') : t('ck_dp_replace')}
              </button>
              <button
                type="button" className="ghost dp-btn dp-remove"
                onClick={() => onRemoveBucket(bucket)}
                disabled={busy !== null}
              >
                {busy === 'remove' ? t('ck_dp_removing') : t('ck_dp_remove')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


async function reencodeAsPng(blob: Blob): Promise<Blob> {
  // Decoded via createImageBitmap so we don't depend on DOM <img> for non-HTML
  // formats (HEIC won't decode in Safari, but JPEG/PNG/WebP/GIF all do).
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error('Could not decode image for clipboard copy: ' + (e as Error).message);
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
  });
}
