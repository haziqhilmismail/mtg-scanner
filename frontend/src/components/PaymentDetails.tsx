import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { paymentApi, type Payment } from '../api.ts';
import { useT } from '../hooks/useLang.ts';
import { changesOf, draftOf, hasDetails, NO_PAYMENT, previewOf, type PaymentDraft, type PaymentFields } from '../lib/paymentDraft.ts';
import { paymentLines, pastedImages, popupOpen } from '../utils.ts';
import { useDialog } from './DialogProvider.tsx';
import { Icon } from './Icon.tsx';
import { TextArea, TextField } from './ui/Field.tsx';
import { useToast } from './ui/Toast.tsx';

const MAX_QR_BYTES = 8 * 1024 * 1024;  // the server's limit

const qrBlob = (version: string) =>
  fetch(paymentApi.qrUrl(version)).then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))));

interface Props {
  payment: Payment | null;  // null until loaded
  // App's copy, which the messages on Claims use.
  setPayment: (payment: Payment) => void;
}

export function PaymentDetails({ payment, setPayment }: Props) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loaded = payment != null;
  useEffect(() => {
    if (loaded) return;
    let live = true;
    setFailed(false);
    paymentApi.get().then(p => { if (live) setPayment(p); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [loaded, attempt, setPayment]);

  if (payment) return <PaymentForm saved={payment} setPayment={setPayment} />;
  return (
    <section className="ui-card pay" aria-label={t('pay_title')} aria-busy={!failed}>
      <h2 className="ui-card-title">{t('pay_title')}</h2>
      {failed ? (
        <div className="pay-load">
          <p className="ui-error" role="alert">{t('pay_load_failed')}</p>
          <button type="button" className="ui-btn" onClick={() => setAttempt(a => a + 1)}>{t('pay_retry')}</button>
        </div>
      ) : <p className="pay-sub">{t('pay_loading')}</p>}
    </section>
  );
}

// The form is a draft: nothing reaches the server until Save. A new QR is
// uploaded on Save too, not when it is picked.
function PaymentForm({ saved, setPayment }: { saved: Payment; setPayment: (payment: Payment) => void }) {
  const t = useT();
  const toast = useToast();
  const dialog = useDialog();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => draftOf(saved));
  const [base, setBase] = useState(saved);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'deleting'>('idle');
  const [error, setError] = useState('');
  const [qrError, setQrError] = useState('');
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // The saved details changed outside this form (Undo, a load): a draft with
  // no edits of its own follows them.
  if (saved !== base) {
    setBase(saved);
    if (!changesOf(base, draft)) setDraft(draftOf(saved));
  }

  const changes = changesOf(saved, draft);
  const saving = status === 'saving';
  const busy = saving || status === 'deleting';
  const edit = (next: (d: PaymentDraft) => PaymentDraft) => { setDraft(next); setStatus('idle'); setError(''); };
  const setField = (key: keyof PaymentFields) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    edit(d => ({ ...d, fields: { ...d.fields, [key]: value } }));
  };

  const pickQr = useCallback((file: File) => {
    if (file.size > MAX_QR_BYTES) { setQrError(t('pay_qr_too_big')); return; }
    setQrError('');
    setDraft(d => ({ ...d, qr: { kind: 'new', file, url: URL.createObjectURL(file) } }));
    setStatus('idle'); setError('');
  }, [t]);
  const removeQr = () => { setQrError(''); edit(d => ({ ...d, qr: saved.qr_version ? { kind: 'removed' } : { kind: 'saved' } })); };

  const newQrUrl = draft.qr.kind === 'new' ? draft.qr.url : null;
  useEffect(() => () => { if (newQrUrl) URL.revokeObjectURL(newQrUrl); }, [newQrUrl]);

  // Ctrl/⌘+V of a QR image anywhere on the page, as with photos. Pasted text
  // still goes into the fields.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const [file] = pastedImages(e);
      if (!file || popupOpen()) return;
      e.preventDefault();
      pickQr(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pickQr]);

  // Closing the tab with unsaved edits asks first, like any web form.
  useEffect(() => {
    if (!changes) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [changes]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!changes || busy) return;
    const sent = draft;
    setStatus('saving'); setError('');
    try {
      let next = saved;
      if (changes.fields) setPayment(next = await paymentApi.save(changes.fields));
      if (changes.qr === 'upload' && sent.qr.kind === 'new') setPayment(next = await paymentApi.uploadQr(sent.qr.file));
      if (changes.qr === 'delete') setPayment(next = await paymentApi.deleteQr());
      setDraft(d => (d === sent ? draftOf(next) : d));
      setStatus('saved');
      toast(t('pay_saved_toast'));
    } catch (err) {
      const code = (err as { status?: number }).status;
      setStatus('idle');
      setError(t(code === 400 ? 'pay_qr_unreadable' : code === 413 ? 'pay_qr_too_big' : 'pay_save_failed'));
    }
  };

  // Deletes at once, and Undo puts everything back, as Undo does on the other
  // pages. The server keeps the QR as a square PNG, so the same file uploaded
  // again gives the same picture.
  const deleteAll = async () => {
    const before = saved;
    setStatus('deleting'); setError(''); setQrError('');
    try {
      const qr = before.qr_version ? await qrBlob(before.qr_version) : null;
      await Promise.all([paymentApi.save(draftOf(NO_PAYMENT).fields), qr ? paymentApi.deleteQr() : null]);
      setPayment(NO_PAYMENT);
      setDraft(draftOf(NO_PAYMENT));
      toast(t('pay_deleted_toast'), { undoLabel: t('pay_undo'), onUndo: () => restore(before, qr) });
    } catch {
      // Show what the server still has, so a failed delete isn't taken for done.
      setPayment(await paymentApi.get().catch(() => before));
      dialog.alert({ title: t('alert_error_title'), message: t('pay_delete_failed') });
    } finally {
      setStatus('idle');
    }
  };

  // Undo can come after the seller left Profile, so it writes only App's copy.
  const restore = async (before: Payment, qr: Blob | null) => {
    try {
      let next = await paymentApi.save(draftOf(before).fields);
      if (qr) next = await paymentApi.uploadQr(new File([qr], 'duitnow-qr.png', { type: 'image/png' }));
      setPayment(next);
    } catch {
      setPayment(await paymentApi.get().catch(() => NO_PAYMENT));
      dialog.alert({ title: t('alert_error_title'), message: t('pay_restore_failed') });
    }
  };

  const qrSrc = newQrUrl ?? (draft.qr.kind === 'saved' && saved.qr_version ? paymentApi.qrUrl(saved.qr_version) : null);
  const preview = paymentLines(previewOf(draft), t);

  return (
    <section className="ui-card pay" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="ui-card-title">{t('pay_title')}</h2>
      <p className="pay-sub">{t('pay_sub')}</p>
      <button
        type="button" className="ui-btn ui-btn--plain pay-privacy-btn"
        aria-expanded={privacyOpen} aria-controls={`${id}-privacy`}
        onClick={() => setPrivacyOpen(o => !o)}
      >{t('pay_privacy_title')}</button>
      {privacyOpen ? <p id={`${id}-privacy`} className="pay-privacy">{t('pay_privacy_note')}</p> : null}

      <form className="pay-form" onSubmit={save}>
        <div className="pay-grid">
          <div className="pay-col">
            <TextField label={t('pay_bank')} value={draft.fields.bank_name} onChange={setField('bank_name')} placeholder={t('pay_bank_placeholder')} maxLength={64} autoComplete="off" />
            <TextField label={t('pay_account_number')} value={draft.fields.bank_account_number} onChange={setField('bank_account_number')} placeholder={t('pay_account_number_placeholder')} maxLength={32} inputMode="numeric" autoComplete="off" />
            <TextField label={t('pay_account_holder')} value={draft.fields.bank_account_holder} onChange={setField('bank_account_holder')} placeholder={t('pay_account_holder_placeholder')} maxLength={255} autoComplete="off" />
            <TextArea label={t('pay_note')} value={draft.fields.payment_note} onChange={setField('payment_note')} placeholder={t('pay_note_placeholder')} maxLength={500} rows={2} />
          </div>

          <div className="pay-col">
            <div
              className="ui-field" role="group" aria-labelledby={`${id}-qr`}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
                if (file) pickQr(file);
              }}
            >
              <span id={`${id}-qr`} className="ui-label">{t('pay_qr')}</span>
              <div className="pay-qr">
                {qrSrc ? (
                  <img
                    className="pay-qr-img" src={qrSrc} alt={t('support_qr_alt')}
                    onError={() => { if (newQrUrl) { setQrError(t('pay_qr_unreadable')); edit(d => ({ ...d, qr: { kind: 'saved' } })); } }}
                  />
                ) : <span className="pay-qr-img pay-qr-empty" aria-hidden="true"><Icon name="plus" size={24} /></span>}
                <div className="pay-qr-actions">
                  <button type="button" className="ui-btn" onClick={() => fileRef.current?.click()}>{t(qrSrc ? 'pay_qr_replace' : 'pay_qr_upload')}</button>
                  {qrSrc ? <button type="button" className="ui-btn ui-btn--plain" onClick={removeQr}>{t('pay_qr_remove')}</button> : null}
                </div>
              </div>
              {qrError ? <p className="ui-error" role="alert">{qrError}</p> : null}
              <p className="ui-hint">{t('pay_qr_help')}</p>
              <p className="ui-hint pay-qr-paste">{t('pay_qr_paste')}</p>
              <input
                ref={fileRef} type="file" accept="image/*" hidden
                onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickQr(file); }}
              />
            </div>

            <div>
              <span className="pay-preview-label">{t('pay_buyers_see')}</span>
              <p className={preview.length ? 'pay-preview' : 'pay-preview is-empty'}>{preview.length ? preview.join('\n') : t('pay_preview_empty')}</p>
            </div>
          </div>
        </div>

        {error ? <p className="ui-error pay-error" role="alert">{error}</p> : null}
        <div className="pay-foot">
          <button type="button" className="ui-btn ui-btn--danger pay-delete" disabled={!hasDetails(saved) || busy} onClick={deleteAll}>
            {t('pay_delete_all')}
          </button>
          <button type="submit" className="ui-btn ui-btn--primary pay-save" disabled={!changes || busy}>
            {t(saving ? 'pay_saving' : status === 'saved' && !changes ? 'pay_saved' : 'pay_save')}
          </button>
        </div>
      </form>
    </section>
  );
}
