import { useEffect } from 'react';
import type { Health } from '../api.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import { PricingFields } from './SettingsPanel.tsx';
import type { T } from '../hooks/useLang.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  pricing: PricingStore;
  health: Health | null;
  t: T;
}

// The user's default pricing: what new posts start with, and what unfiled
// photos and posts without their own pricing use.
export function PricingSheet({ open, onClose, pricing, health, t }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div
        className="feedback-modal pricing-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-sheet-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="feedback-head">
          <h2 id="pricing-sheet-title">{t('menu_default_pricing')}</h2>
          <button type="button" className="feedback-close" onClick={onClose} aria-label={t('voucher_close')}>×</button>
        </div>
        <p className="feedback-sub">{t('pricing_default_sub')}</p>
        <PricingFields
          settings={pricing.pricingFor(null)}
          update={(key, value) => pricing.update(null, key, value)}
          t={t}
          health={health}
        />
        <div className="feedback-foot">
          <button type="button" className="accent" onClick={onClose}>{t('voucher_done')}</button>
        </div>
      </div>
    </div>
  );
}
