// Small pieces the Claims page and its dialogs share.

import { useT } from '../../hooks/useLang.ts';
import { counted, rm, type BuyerGroup } from './model.ts';

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
