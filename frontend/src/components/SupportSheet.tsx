import { useEffect } from 'react';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

// The DuitNow QR. Put the image in public/ and set this to its path, e.g. '/donate-qr.png'.
const QR_SRC: string | null = null;

interface Props {
  open: boolean;
  onClose: () => void;
  // Opened by the app after a save, not from the menu: thank first, offer a way out.
  asking?: boolean;
  t: T;
}

// A voluntary tip jar: the app stays free whether or not anyone pays.
export function SupportSheet({ open, onClose, asking, t }: Props) {
  useBackClose(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="feedback-head">
          <h2 id="support-title">{t(asking ? 'support_ask_title' : 'support_title')}</h2>
          <button type="button" className="feedback-close" onClick={onClose} aria-label={t('voucher_close')}>×</button>
        </div>
        <p className="feedback-sub">{t('support_sub')}</p>
        {QR_SRC ? (
          <img className="support-qr" src={QR_SRC} alt={t('support_qr_alt')} />
        ) : (
          <div className="support-qr support-qr-empty">{t('support_qr_soon')}</div>
        )}
        <div className="feedback-foot">
          <button type="button" className="accent" onClick={onClose}>{t(asking ? 'support_later' : 'voucher_done')}</button>
        </div>
      </div>
    </div>
  );
}
