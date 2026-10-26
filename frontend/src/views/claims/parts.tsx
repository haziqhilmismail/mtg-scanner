// Small pieces the Claims page and its dialogs share.

import { hideBroken } from '../../components/ClaimPickers.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useImageZoom } from '../../components/ImageZoomProvider.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { useT } from '../../hooks/useLang.ts';
import { counted, formulaText, rm, type BuyerGroup, type Line } from './model.ts';

// An amount in RM; a live price not sent yet carries ≈ (DESIGN.md section 7).
export function Money({ value, live = false, cents }: { value: number; live?: boolean; cents: boolean }) {
  return <>{live ? <span className="claims-approx">≈</span> : null}{rm(value, cents)}</>;
}

// "● Unpaid · dropped off · 3 cards": the dot marks the status, the label names it.
export function StatusLine({ group }: { group: BuyerGroup }) {
  const t = useT();
  const words = [
    t(`claims_state_${group.state}`),
    group.droppedOff ? t('claims_dropped_off') : '',
    counted(t, 'claims_cards', group.cards),
  ].filter(Boolean).join(' · ');
  return <span className="claims-status"><span className={`claims-dot is-${group.state}`} aria-hidden="true" />{words}</span>;
}

// A buyer's cards, one row each: the card cut from the seller's photo (it
// opens large, and carries ×2 for two copies), the name, its photo, how the
// price was made, and the row's total. Every row is one height, so buyer
// cards line up.
export function ClaimLines({ lines, cents, showPhotos }: { lines: Line[]; cents: boolean; showPhotos: boolean }) {
  const t = useT();
  const zoom = useImageZoom();
  return (
    <ul className="claims-lines">
      {lines.map(l => {
        const { crop } = l;
        const many = l.qty > 1;
        const qty = many ? <span className="claims-line-qty">×{l.qty}</span> : null;
        return (
          <li key={l.id} className="claims-line">
            {crop ? (
              <button type="button" className="claims-line-pic" aria-label={t('claims_view_card', { name: l.name })} onClick={() => zoom.open(crop, l.name)}>
                <img src={crop} alt="" loading="lazy" decoding="async" onError={hideBroken} />{qty}
              </button>
            ) : <span className="claims-line-pic" aria-hidden="true"><Icon name="photo" size={18} />{qty}</span>}
            <span className="claims-line-text">
              <span className="claims-line-name">{l.name}{many ? <span className="ui-sr-only"> ×{l.qty}</span> : null}</span>
              {showPhotos && l.photo ? <span className="claims-line-working">{t('claims_photo', { n: l.photo })}</span> : null}
              {l.formula || many ? (
                <span className="claims-line-working">
                  {l.formula ? formulaText(l.formula) : null}
                  {many ? <>{l.formula ? ' → ' : ''}<Money value={l.each} live={l.live} cents={cents} /> {t('claims_copy_each')}</> : null}
                </span>
              ) : null}
            </span>
            <span className="claims-line-total"><Money value={l.each * l.qty} live={l.live} cents={cents} /></span>
          </li>
        );
      })}
    </ul>
  );
}

const STEPS = [1, 2, 3, 4] as const;

// The four steps of How claims work: inline on a post with no claims yet,
// and in the How claims work dialog.
export function ClaimSteps({ cards = false }: { cards?: boolean }) {
  const t = useT();
  return (
    <ol className={cards ? 'claims-steps is-cards' : 'claims-steps'}>
      {STEPS.map(n => (
        <li key={n} className="claims-step">
          <span className="claims-step-n" aria-hidden="true">{n}</span>
          <span className="claims-step-text">
            <strong>{t(`claims_step${n}_title`)}</strong>
            <span>{t(`claims_step${n}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// How claims work, any time after the first visit. `onAdd` is left out when
// there is nothing to claim yet.
export function HowDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd?: () => void }) {
  const t = useT();
  return (
    <Dialog
      open={open} onClose={onClose} className="claims-dialog" title={t('claims_how')} closeLabel={t('claims_close')}
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn--ink" onClick={onClose}>{t('claims_close')}</button>
          {onAdd ? <button type="button" className="ui-btn ui-btn--primary" onClick={onAdd}>{t('claims_add')}</button> : null}
        </>
      )}
    >
      <ClaimSteps />
    </Dialog>
  );
}
