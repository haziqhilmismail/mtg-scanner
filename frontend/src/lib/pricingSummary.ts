import type { T } from '../i18n/index.ts';
import type { Settings } from '../types.ts';

// "×2.8 · Foil ×3 · Round up to RM 1"
export function pricingSummary(s: Settings, t: T): string {
  const step = `${s.currencyLabel.trim() || 'RM'} ${Number.isInteger(s.roundStep) ? s.roundStep : s.roundStep.toFixed(2)}`;
  return `×${s.multNormal} · ${t('foil_on')} ×${s.multFoil} · ${t(`round_summary_${s.roundDirection}`, { step })}`;
}
