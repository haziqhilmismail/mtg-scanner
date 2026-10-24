import { useId, useState } from 'react';
import { redeemVoucher } from '../api.ts';
import type { Credits } from '../types.ts';
import type { T } from '../hooks/useLang.ts';
import { TextField } from './ui/Field.tsx';
import { Dialog } from './ui/Dialog.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  // Called with the new balance after a voucher is accepted.
  onRedeemed: (credits: Credits) => void;
  t: T;
}

// One field, one job: type a voucher code, get more claim reads.
export function VoucherSheet({ open, onClose, onRedeemed, t }: Props) {
  const formId = useId();
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [granted, setGranted] = useState('');

  const submit = async () => {
    if (!code.trim() || sending) return;
    setSending(true); setError('');
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
      onRedeemed(res.credits);
    } catch (e) {
      const reason = (e as Error & { code?: string }).code;
      setError(t(reason ? `voucher_err_${reason}` : 'voucher_err_network'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onExited={() => { setCode(''); setError(''); setGranted(''); }}
      title={t('voucher_title')}
      closeLabel={t('voucher_close')}
      footer={granted ? (
        <button type="button" className="ui-btn ui-btn--primary" onClick={onClose}>{t('voucher_close')}</button>
      ) : (
        <>
          <button type="button" className="ui-btn ui-btn--ink" onClick={onClose}>{t('cancel')}</button>
          <button type="submit" form={formId} className="ui-btn ui-btn--primary" disabled={!code.trim() || sending}>
            {t(sending ? 'voucher_sending' : 'voucher_redeem')}
          </button>
        </>
      )}
    >
      {granted ? (
        <p className="voucher-granted" role="status">{granted}</p>
      ) : (
        <form id={formId} onSubmit={e => { e.preventDefault(); submit(); }}>
          <TextField
            label={t('voucher_sub')}
            error={error || undefined}
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
            placeholder="MTG-XXXX-XXXX-XXXX"
            autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
            maxLength={32}
            data-autofocus=""
          />
        </form>
      )}
    </Dialog>
  );
}
