import { Icon } from '../../components/Icon.tsx';
import { useT } from '../../hooks/useLang.ts';
import { counted, type BuyerGroup, type StatusMove } from './model.ts';
import { ClaimLines, Money, StatusLine } from './parts.tsx';

// Cards shown on a buyer card; the rest open with the buyer, so no buyer card
// grows past two rows.
const SHOWN = 2;

interface Props {
  group: BuyerGroup;
  isNew: boolean;
  copied: boolean;
  cents: boolean;
  showPhotos: boolean;       // the post has several photos, so each line names its photo
  qrLabel: string | null;    // null: no DuitNow QR to send
  onOpen: () => void;
  onCopy: () => void;
  onQr: () => void;
  onMove: (move: StatusMove) => void;
}

// One buyer: their first cards with how each price was made, then Copy
// message, the QR and the next status. A Done buyer has Not done instead.
export function BuyerCard({ group: g, isNew, copied, cents, showPhotos, qrLabel, onOpen, onCopy, onQr, onMove }: Props) {
  const t = useT();
  const more = g.lines.length - SHOWN;
  return (
    <article className={`claims-buyer is-${g.state}`}>
      <div className="claims-buyer-head">
        <button type="button" className="claims-buyer-open" aria-haspopup="dialog" onClick={onOpen}>
          <span className="claims-buyer-name">
            <span className="claims-buyer-name-text">{g.name}</span>
            {isNew ? <span className="ui-chip ui-chip--accent">{t('claims_new')}</span> : null}
          </span>
          <StatusLine group={g} />
        </button>
        <span className="claims-buyer-total"><Money value={g.total} live={g.live} cents={cents} /></span>
      </div>
      <ClaimLines lines={g.lines.slice(0, SHOWN)} cents={cents} showPhotos={showPhotos} />
      {more > 0 ? (
        <button type="button" className="ui-btn ui-btn--plain claims-buyer-more" aria-haspopup="dialog" onClick={onOpen}>{counted(t, 'claims_see_more', more)}</button>
      ) : null}
      {g.state === 'done' ? (
        <div className="claims-buyer-actions claims-buyer-done">
          <span className="claims-buyer-done-text"><Icon name="check" size={16} />{t('claims_done_line')}</span>
          <button type="button" className="ui-btn ui-btn--plain" onClick={() => onMove('paid')}>{t('claims_not_done')}</button>
        </div>
      ) : (
        <div className="claims-buyer-actions">
          <button type="button" className={copied ? 'ui-btn claims-copy is-copied' : 'ui-btn claims-copy'} onClick={onCopy}>
            <Icon name={copied ? 'check' : 'copy'} size={17} />{copied ? t('claims_copied') : t('claims_copy')}
          </button>
          {qrLabel ? (
            <button type="button" className="ui-icon-btn claims-qr" aria-label={qrLabel} onClick={onQr}><Icon name="qr" size={19} /></button>
          ) : null}
          {g.state === 'unpaid' ? (
            <button type="button" className="ui-btn claims-mark-paid" onClick={() => onMove('markPaid')}>{t('claims_mark_paid')}</button>
          ) : (
            <button type="button" className="ui-btn" onClick={() => onMove('done')}>{t('claims_mark_done')}</button>
          )}
        </div>
      )}
    </article>
  );
}
