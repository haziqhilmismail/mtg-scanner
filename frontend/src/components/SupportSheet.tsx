import { useState } from 'react';
import { apiUrl } from '../api/http.ts';
import type { T } from '../hooks/useLang.ts';
import { Dialog } from './ui/Dialog.tsx';

// The DuitNow QR, kept on the server (data/support_qr.png), not in this public repo.
const QR_SRC = apiUrl('/api/support-qr');

interface Props {
  open: boolean;
  onClose: () => void;
  // Opened by the app after a save, not from Profile: thank first, offer a way out.
  asking?: boolean;
  t: T;
}

// A voluntary tip jar: the app stays free whether or not anyone pays.
export function SupportSheet({ open, onClose, asking, t }: Props) {
  const [noQr, setNoQr] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(asking ? 'support_ask_title' : 'support_title')}
      closeLabel={t('voucher_close')}
      footer={<button type="button" className="ui-btn ui-btn--primary" onClick={onClose}>{t(asking ? 'support_later' : 'voucher_close')}</button>}
    >
      <p className="support-body">{t('support_sub')}</p>
      {!noQr ? (
        <img className="support-qr" src={QR_SRC} alt={t('support_qr_alt')} onError={() => setNoQr(true)} />
      ) : (
        <div className="support-qr support-qr-empty">{t('support_qr_soon')}</div>
      )}
    </Dialog>
  );
}
