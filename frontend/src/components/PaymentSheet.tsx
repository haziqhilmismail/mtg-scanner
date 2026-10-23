import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';
import { paymentApi, type Payment } from '../api.ts';
import type { T } from '../hooks/useLang.ts';
import { pastedImages } from '../utils.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  payment: Payment | null;
  // Called with what the server saved, so copied summaries use it at once.
  onSaved: (payment: Payment) => void;
  t: T;
}

type Fields = Omit<Payment, 'qr_version'>;
const EMPTY: Fields = { bank_name: '', bank_account_number: '', bank_account_holder: '', payment_note: '' };

// How buyers pay: added under every summary the seller copies for a buyer.
export function PaymentSheet({ open, onClose, payment, onSaved, t }: Props) {
  useBackClose(open, onClose);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<(f: File) => void>(() => {});

  // Start from what is saved each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const { qr_version: _, ...rest } = payment ?? { ...EMPTY, qr_version: null };
    setFields(rest); setError(''); setSaved(false); setPrivacyOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Esc closes the privacy popup first, then the sheet.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (privacyOpen) setPrivacyOpen(false); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, privacyOpen]);

  // Ctrl/⌘+V of a QR image anywhere in the sheet, as with photos. Pasted
  // text still goes into the fields.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const [file] = pastedImages(e);
      if (!file) return;
      // Caught on window before the page's own paste handlers (Claims and
      // Scanner listen on document), so the QR doesn't land there too.
      e.preventDefault(); e.stopPropagation();
      uploadRef.current(file);
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [open]);

  if (!open) return null;

  const run = async (job: () => Promise<Payment>) => {
    setBusy(true); setError('');
    try { onSaved(await job()); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  const uploadQr = (f: File) => { if (!busy) run(() => paymentApi.uploadQr(f)); };
  uploadRef.current = uploadQr;
  const field = (key: keyof Fields, label: string, extra: { placeholder?: string; inputMode?: 'numeric' } = {}) => (
    <label className="payment-field">
      <span>{label}</span>
      <input
        type="text" value={fields[key]} maxLength={key === 'bank_name' ? 64 : key === 'bank_account_number' ? 32 : 255}
        onChange={e => { setFields(f => ({ ...f, [key]: e.target.value })); setSaved(false); }} {...extra}
      />
    </label>
  );

  const hasAny = !!payment && !!(payment.qr_version || payment.bank_name || payment.bank_account_number || payment.bank_account_holder || payment.payment_note);
  const save = () => run(() => paymentApi.save(fields)).then(ok => ok && setSaved(true));

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div className="feedback-modal payment-sheet" role="dialog" aria-modal="true" aria-labelledby="payment-title" onClick={e => e.stopPropagation()}>
        <div className="feedback-head">
          <h2 id="payment-title">{t('pay_title')}</h2>
          <button type="button" className="feedback-close" onClick={onClose} aria-label={t('voucher_close')}>×</button>
        </div>
        <p className="feedback-sub">
          {t('pay_sub')}{' '}
          <button type="button" className="link-btn" onClick={() => setPrivacyOpen(true)}>{t('pay_privacy_title')}</button>
        </p>

        <div className="payment-body">
          <form id="payment-form" className="payment-form" onSubmit={e => { e.preventDefault(); save(); }}>
            {field('bank_name', t('pay_bank'), { placeholder: 'Maybank' })}
            {field('bank_account_number', t('pay_account_number'), { inputMode: 'numeric' })}
            {field('bank_account_holder', t('pay_account_holder'))}
            <label className="payment-field">
              <span>{t('pay_note')}</span>
              <textarea
                rows={2} maxLength={500} value={fields.payment_note} placeholder={t('pay_note_placeholder')}
                onChange={e => { setFields(f => ({ ...f, payment_note: e.target.value })); setSaved(false); }}
              />
            </label>
          </form>

          {/* The QR saves on its own, as soon as it is added: pick, paste or drop. */}
          <div
            className="payment-qr"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/')); if (f) uploadQr(f); }}
          >
            <span className="payment-qr-label">{t('pay_qr')}</span>
            <div className="payment-qr-row">
              {payment?.qr_version ? (
                <img className="payment-qr-img" src={paymentApi.qrUrl(payment.qr_version)} alt={t('support_qr_alt')} />
              ) : (
                <button type="button" className="payment-qr-empty" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Icon name="plus" size={22} />
                  <span>{t('pay_qr_upload')}</span>
                </button>
              )}
              <div className="payment-qr-side">
                {payment?.qr_version ? (
                  <div className="payment-qr-actions">
                    <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>{t('pay_qr_replace')}</button>
                    <button type="button" className="ghost" disabled={busy} onClick={() => run(paymentApi.deleteQr)}>{t('pay_qr_remove')}</button>
                  </div>
                ) : <p className="payment-qr-hint">{t('pay_qr_none')}</p>}
                <p className="payment-qr-hint payment-qr-paste">{t('pay_qr_paste')}</p>
              </div>
            </div>
            <input
              ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadQr(f); }}
            />
          </div>
        </div>

        {error ? <p className="feedback-error" role="alert">{error}</p> : null}
        <div className="feedback-foot payment-foot">
          {/* Always there, so it doesn't pop up after a save; greyed out with nothing saved. */}
          <button
            type="button" className="ghost destructive payment-delete" disabled={busy || !hasAny}
            onClick={() => run(async () => { await paymentApi.save(EMPTY); return paymentApi.deleteQr(); }).then(ok => ok && setFields(EMPTY))}
          >{t('pay_delete_all')}</button>
          {saved ? <span className="feedback-success">{t('pay_saved')}</span> : null}
          <button type="submit" form="payment-form" className="accent" disabled={busy}>{t('pay_save')}</button>
        </div>
      </div>

      {privacyOpen ? createPortal(
        <div className="feedback-overlay payment-privacy-shade" onClick={e => { e.stopPropagation(); setPrivacyOpen(false); }}>
          <div className="feedback-modal payment-privacy" role="dialog" aria-modal="true" aria-labelledby="pay-privacy-title" onClick={e => e.stopPropagation()}>
            <div className="feedback-head">
              <h2 id="pay-privacy-title">{t('pay_privacy_title')}</h2>
              <button type="button" className="feedback-close" onClick={() => setPrivacyOpen(false)} aria-label={t('voucher_close')}>×</button>
            </div>
            <ul>
              <li>{t('pay_privacy_1')}</li>
              <li>{t('pay_privacy_2')}</li>
              <li>{t('pay_privacy_3')}</li>
              <li>{t('pay_privacy_4')}</li>
            </ul>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
