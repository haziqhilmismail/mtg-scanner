import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Link } from '../../components/Link.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { TextField } from '../../components/ui/Field.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useT } from '../../hooks/useLang.ts';
import { PAY_STATES, type BuyerGroup, type PayState } from './model.ts';
import { Money, StatusLine } from './parts.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  group: BuyerGroup | null;
  message: string;
  cents: boolean;
  hasPayment: boolean;
  qrLabel: string | null;     // null: no DuitNow QR to send
  live: boolean;              // a live-price post
  sentOn: string | null;      // live post: when this buyer was sent their prices
  onCopy: () => void;
  onQr: () => void;
  onStatus: (to: PayState) => void;
  onSavePhone: (phone: string) => Promise<boolean>;
  onRemove: () => void;
  onResend: () => void;
}

// Everything about one buyer: the exact message, the status, the number for
// the drop-off slip, and Remove buyer (with Undo on the page).
export function BuyerDialog({ open, onClose, group: g, message, cents, hasPayment, qrLabel, live, sentOn, onCopy, onQr, onStatus, onSavePhone, onRemove, onResend }: Props) {
  const t = useT();
  return (
    <Dialog
      open={open && !!g} onClose={onClose} className="claims-dialog claims-buyer-dialog" closeLabel={t('claims_close')}
      title={g?.name ?? ''}
      subtitle={g ? <><StatusLine group={g} /> · <Money value={g.total} live={g.live} cents={cents} /></> : null}
      footer={(
        <>
          {qrLabel ? <button type="button" className="ui-btn" onClick={onQr}><Icon name="qr" size={18} />{qrLabel}</button> : null}
          <button type="button" className="ui-btn ui-btn--primary" onClick={onCopy}><Icon name="copy" size={18} />{t('claims_copy')}</button>
        </>
      )}
    >
      {g ? (
        <>
          <p className="ui-label">{t('claims_message')}</p>
          <p className="claims-bubble">{message}</p>
          <p className="claims-foot-note">
            {hasPayment ? t('claims_pay_note') : t('claims_pay_none')}{' '}
            <Link to={{ page: 'profile' }}>{hasPayment ? t('claims_pay_edit') : t('claims_pay_add')}</Link>
          </p>
          {live ? (
            <p className="claims-foot-note">
              {sentOn ? <>{t('claims_sent', { date: sentOn })}{' '}<button type="button" className="claims-text-btn" onClick={onResend}>{t('claims_resend')}</button></> : t('claims_live_estimate')}
            </p>
          ) : null}
          <Segmented
            className="claims-dialog-status" label={t('claims_status')} value={g.state} onChange={onStatus}
            options={PAY_STATES.map(s => ({ value: s, label: t(`claims_state_${s}`) }))}
          />
          <PhoneField key={g.buyerId} saved={g.phone} onSave={onSavePhone} />
          <button type="button" className="ui-btn ui-btn--danger claims-remove" onClick={onRemove}>{t('claims_remove')}</button>
        </>
      ) : null}
    </Dialog>
  );
}

// The buyer's number, saved with its own button: nothing saves as you type.
function PhoneField({ saved, onSave }: { saved: string; onSave: (phone: string) => Promise<boolean> }) {
  const t = useT();
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const changed = value.trim() !== saved;
  return (
    <form
      className="claims-phone"
      onSubmit={async e => {
        e.preventDefault();
        if (!changed || busy) return;
        setBusy(true);
        const ok = await onSave(value.trim());
        setBusy(false);
        setJustSaved(ok);
      }}
    >
      <TextField
        label={t('claims_phone')} inputMode="tel" autoComplete="off" maxLength={32}
        placeholder={t('claims_phone_placeholder')} value={value}
        onChange={e => { setValue(e.target.value); setJustSaved(false); }}
      />
      <button type="submit" className="ui-btn" disabled={!changed || busy}>
        {justSaved && !changed ? t('claims_phone_saved') : t('claims_phone_save')}
      </button>
    </form>
  );
}
