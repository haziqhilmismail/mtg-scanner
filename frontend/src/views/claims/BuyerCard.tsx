import { Icon } from '../../components/Icon.tsx';
import { useT } from '../../hooks/useLang.ts';
import { formulaText, type BuyerGroup, type Line, type StatusMove } from './model.ts';
import { Money, StatusLine } from './parts.tsx';

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

// One buyer: what they claimed with how each price was made, then Copy
// message, the QR and the next status. A Done buyer folds to one line.
export function BuyerCard({ group: g, isNew, copied, cents, showPhotos, qrLabel, onOpen, onCopy, onQr, onMove }: Props) {
  const t = useT();
  // "$4.49 × 2.5", or for several copies "$4.99 × 2.5 → RM13 each".
  const working = (l: Line) => (l.formula || l.qty > 1 ? (
    <span className="claims-line-working">
      {l.formula ? formulaText(l.formula) : null}
      {l.qty > 1 ? <>{l.formula ? ' → ' : ''}<Money value={l.each} live={l.live} cents={cents} /> {t('claims_copy_each')}</> : null}
    </span>
  ) : null);
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
      {g.state === 'done' ? (
        <div className="claims-buyer-done">
          <span className="claims-buyer-done-text"><Icon name="check" size={16} />{t('claims_done_line')}</span>
          <button type="button" className="ui-btn ui-btn--plain" onClick={() => onMove('paid')}>{t('claims_not_done')}</button>
        </div>
      ) : (
        <>
          <ul className="claims-lines">
            {g.lines.map(l => (
              <li key={l.id} className="claims-line">
                <span className="claims-line-text">
                  <span className="claims-line-name">
                    {showPhotos && l.photo ? `${t('claims_photo', { n: l.photo })} · ` : ''}{l.name}{l.qty > 1 ? ` ×${l.qty}` : ''}
                  </span>
                  {working(l)}
                </span>
                <span className="claims-line-total"><Money value={l.each * l.qty} live={l.live} cents={cents} /></span>
              </li>
            ))}
          </ul>
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
        </>
      )}
    </article>
  );
}
