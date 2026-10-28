import { useEffect, useState } from 'react';
import { apiUrl } from '../api/http.ts';
import type { T } from '../hooks/useLang.ts';
import { downloadBlob } from '../utils.ts';
import { Icon } from './Icon.tsx';
import { Dialog } from './ui/Dialog.tsx';

// The DuitNow QR, kept on the server (data/support_qr.png), not in this public repo.
const QR_SRC = apiUrl('/api/support-qr');

// iOS saves a download to Files, where a bank app can't pick it up; its share
// sheet has Save Image, which puts it in Photos. Android saves a download to
// the gallery's Download album.
const IOS = typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

interface Props {
  open: boolean;
  onClose: () => void;
  // Opened by the app after a save, not from Profile: thank first.
  asking?: boolean;
  t: T;
}

// A voluntary tip jar: the app stays free whether or not anyone pays.
export function SupportSheet({ open, onClose, asking, t }: Props) {
  const [noQr, setNoQr] = useState(false);
  // Fetched ahead, so Save can share inside the tap: browsers drop a share
  // once the tap is a moment old.
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (!open || file) return;
    let current = true;
    fetch(QR_SRC)
      .then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => { if (current) setFile(new File([b], 'duitnow-qr.png', { type: 'image/png' })); }, () => { /* no Save button */ });
    return () => { current = false; };
  }, [open, file]);
  const save = () => {
    if (!file) return;
    if (IOS && navigator.canShare?.({ files: [file] })) navigator.share({ files: [file] }).catch(() => { /* closed */ });
    else downloadBlob(file, file.name);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(asking ? 'support_ask_title' : 'support_title')}
      closeLabel={t('voucher_close')}
      footer={<button type="button" className="ui-btn ui-btn--primary" onClick={onClose}>{t('support_later')}</button>}
    >
      <p className="support-body">{t('support_sub')}</p>
      {!noQr ? (
        <>
          <img className="support-qr" src={QR_SRC} alt={t('support_qr_alt')} onError={() => setNoQr(true)} />
          {file ? (
            <button type="button" className="ui-btn support-save" onClick={save}><Icon name="download" size={17} />{t('support_save')}</button>
          ) : null}
        </>
      ) : (
        <div className="support-qr support-qr-empty">{t('support_qr_soon')}</div>
      )}
    </Dialog>
  );
}
