import { useRef, useState } from 'react';

import { ordersApi, type Order } from '../../api/checklist.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';

type T = (k: string, vars?: Record<string, string | number>) => string;

interface Props {
  order: Order;
  onChange: () => void;
  t: T;
}

/**
 * Optional delivery-proof photo for an order that's been dropped off
 * (On credit or Done columns). Two states:
 *   - no photo → small "Add delivery photo" button + hidden file input
 *   - photo set → thumbnail + Copy / Replace / Remove actions
 *
 * Copy goes through a canvas re-encode so the clipboard always receives
 * image/png regardless of how the source was uploaded — broader browser
 * support than `image/jpeg` via `ClipboardItem`.
 */
export function DeliveryPhotoWidget({ order, onChange, t }: Props) {
  const dialog = useDialog();
  const zoom = useImageZoom();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'upload' | 'copy' | 'remove'>(null);
  const [copied, setCopied] = useState(false);

  const showError = (e: unknown) =>
    dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });

  const onPick = () => fileRef.current?.click();

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy('upload');
    try {
      await ordersApi.uploadDeliveryPhoto(order.id, file);
      onChange();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
      // Clear the input so picking the same file again still triggers onChange
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onRemove = async () => {
    const ok = await dialog.confirm({
      title: t('ck_dp_remove_title'),
      message: t('ck_dp_remove_msg'),
      okLabel: t('ck_dp_remove_btn'),
      destructive: true,
    });
    if (!ok) return;
    setBusy('remove');
    try {
      await ordersApi.deleteDeliveryPhoto(order.id);
      onChange();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    setBusy('copy');
    try {
      const url = ordersApi.deliveryPhotoUrl(order.id, order.delivery_photo_uploaded_at);
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

  if (!order.has_delivery_photo) {
    return (
      <div className="delivery-photo empty">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => onUpload(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="ghost dp-add"
          onClick={onPick}
          disabled={busy === 'upload'}
        >
          {busy === 'upload' ? t('ck_dp_uploading') : t('ck_dp_add')}
        </button>
      </div>
    );
  }

  const photoUrl = ordersApi.deliveryPhotoUrl(order.id, order.delivery_photo_uploaded_at);

  return (
    <div className="delivery-photo">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={e => onUpload(e.target.files?.[0] ?? null)}
      />
      <img
        className="dp-thumb zoomable"
        src={photoUrl}
        alt=""
        loading="lazy"
        onClick={() => zoom.open(photoUrl, t('ck_dp_zoom_caption'))}
      />
      <div className="dp-actions">
        <button type="button" className="ghost dp-btn" onClick={onCopy} disabled={busy !== null}>
          {copied ? t('ck_dp_copied') : busy === 'copy' ? t('ck_dp_copying') : t('ck_dp_copy')}
        </button>
        <button type="button" className="ghost dp-btn" onClick={onPick} disabled={busy !== null}>
          {busy === 'upload' ? t('ck_dp_uploading') : t('ck_dp_replace')}
        </button>
        <button type="button" className="ghost dp-btn dp-remove" onClick={onRemove} disabled={busy !== null}>
          {busy === 'remove' ? t('ck_dp_removing') : t('ck_dp_remove')}
        </button>
      </div>
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
