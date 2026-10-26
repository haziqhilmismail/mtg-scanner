import { Icon } from '../../components/Icon.tsx';
import { Link } from '../../components/Link.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { SaveField } from '../../components/ui/SaveField.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useT } from '../../hooks/useLang.ts';
import { counted, PAY_STATES, type BuyerGroup, type PayState } from './model.ts';
import { ClaimLines, Money, StatusLine } from './parts.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  group: BuyerGroup | null;
  message: string;
  cents: boolean;
  showPhotos: boolean;        // the post has several photos, so each line names its photo
  hasPayment: boolean;
  qrLabel: string | null;     // null: no DuitNow QR to send
  live: boolean;              // a live-price post
  sentOn: string | null;      // live post: when this buyer was sent their prices
  onCopy: () => void;
  onQr: () => void;
  onStatus: (to: PayState) => void;
  onSaveName: (name: string) => Promise<boolean>;
  onSavePhone: (phone: string) => Promise<boolean>;
  onRemove: () => void;
  onResend: () => void;
  onAddCard: () => void;      // a claim typed by hand, for this buyer
}

// Everything about one buyer: every card they claimed (with Add a card), the
// exact message, the status, their name, the number for the drop-off slip,
// and Remove buyer (with Undo on the page).
export function BuyerDialog({ open, onClose, group: g, message, cents, showPhotos, hasPayment, qrLabel, live, sentOn, onCopy, onQr, onStatus, onSaveName, onSavePhone, onRemove, onResend, onAddCard }: Props) {
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
          <p className="ui-label">{counted(t, 'claims_cards', g.cards)}</p>
          <ClaimLines lines={g.lines} cents={cents} showPhotos={showPhotos} />
          <button type="button" className="ui-btn ui-btn--plain claims-add-for" onClick={onAddCard}>
            <Icon name="plus" size={16} />{t('claims_add_for', { name: g.name.trim() })}
          </button>
          <p className="ui-label claims-message-label">{t('claims_message')}</p>
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
            label={t('claims_status')} value={g.state} onChange={onStatus}
            options={PAY_STATES.map(s => ({ value: s, label: t(`claims_state_${s}`) }))}
          />
          <SaveField
            key={`name-${g.buyerId}`} saved={g.name} onSave={onSaveName} required maxLength={255} autoComplete="off"
            label={t('claims_name')} saveLabel={t('claims_name_save')}
          />
          <SaveField
            key={`phone-${g.buyerId}`} saved={g.phone} onSave={onSavePhone} inputMode="tel" maxLength={32} autoComplete="off"
            label={t('claims_phone')} placeholder={t('claims_phone_placeholder')} saveLabel={t('claims_phone_save')}
          />
          <button type="button" className="ui-btn ui-btn--danger claims-remove" onClick={onRemove}>{t('claims_remove')}</button>
        </>
      ) : null}
    </Dialog>
  );
}
