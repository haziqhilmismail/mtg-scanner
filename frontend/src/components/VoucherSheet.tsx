import { useEffect, useRef, useState } from 'react';
import { redeemVoucher } from '../api.ts';
import type { Credits } from '../types.ts';
import type { T } from '../hooks/useLang.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  // Called with the new balance after a voucher is accepted.
  onRedeemed: (credits: Credits) => void;
  t: T;
}

type Status = 'idle' | 'sending' | 'done';

// One field, one job: type a voucher code, get more scans.
export function VoucherSheet({ open, onClose, onRedeemed, t }: Props) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [granted, setGranted] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Start fresh each time the sheet opens. Kept apart from the key listener
  // below: that one re-subscribes whenever the parent re-renders, and must
  // not wipe the "redeemed" message when it does.
  useEffect(() => {
    if (!open) return;
    setCode(''); setStatus('idle'); setError(''); setGranted('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (!code.trim() || status !== 'idle') return;
    setStatus('sending'); setError('');
    try {
      const res = await redeemVoucher(code);
      setGranted(
        res.granted.reset && !res.granted.unlimited && !res.granted.credits
          ? t('voucher_granted_reset', { n: res.credits.limit })
          : res.granted.unlimited
          ? (res.granted.unlimited_days
            ? t('voucher_granted_unlimited_days', { n: res.granted.unlimited_days })
            : t('voucher_granted_unlimited'))
          : t('voucher_granted_credits', { n: res.granted.credits }),
      );
      setStatus('done');
      onRedeemed(res.credits);
    } catch (e) {
      const reason = (e as Error & { code?: string }).code;
      setError(t(reason ? `voucher_err_${reason}` : 'voucher_err_network'));
      setStatus('idle');
    }
  };

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voucher-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="feedback-head">
          <h2 id="voucher-title">{t('voucher_title')}</h2>
          <button type="button" className="feedback-close" onClick={onClose} aria-label={t('voucher_close')}>×</button>
        </div>
        {status === 'done' ? (
          <>
            <p className="voucher-success" role="status">{granted}</p>
            <div className="feedback-foot">
              <button type="button" className="accent" onClick={onClose}>{t('voucher_done')}</button>
            </div>
          </>
        ) : (
          <form onSubmit={e => { e.preventDefault(); submit(); }} className="voucher-form">
            <p className="feedback-sub">{t('voucher_sub')}</p>
            <input
              ref={inputRef}
              className="voucher-input"
              type="text"
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
              placeholder="MTG-XXXX-XXXX-XXXX"
              aria-label={t('voucher_title')}
              aria-invalid={!!error}
              autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
              maxLength={32}
              disabled={status === 'sending'}
            />
            {error ? <p className="feedback-error" role="alert">{error}</p> : null}
            <div className="feedback-foot">
              <button type="submit" className="accent" disabled={!code.trim() || status === 'sending'}>
                {status === 'sending' ? t('voucher_sending') : t('voucher_redeem')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
