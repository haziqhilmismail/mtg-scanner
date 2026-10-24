import type { T } from '../hooks/useLang.ts';
import { Dialog } from './ui/Dialog.tsx';

// The DuitNow QR. Put the image in public/ and set this to its path, e.g. '/donate-qr.png'.
const QR_SRC: string | null = null;

interface Props {
  open: boolean;
  onClose: () => void;
  // Opened by the app after a save, not from Profile: thank first, offer a way out.
  asking?: boolean;
  t: T;
}

// A voluntary tip jar: the app stays free whether or not anyone pays.
export function SupportSheet({ open, onClose, asking, t }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(asking ? 'support_ask_title' : 'support_title')}
      closeLabel={t('voucher_close')}
      footer={<button type="button" className="ui-btn ui-btn--primary" onClick={onClose}>{t(asking ? 'support_later' : 'voucher_close')}</button>}
    >
      <p className="support-body">{t('support_sub')}</p>
      {QR_SRC ? (
        <img className="support-qr" src={QR_SRC} alt={t('support_qr_alt')} />
      ) : (
        <div className="support-qr support-qr-empty">{t('support_qr_soon')}</div>
      )}
    </Dialog>
  );
}
