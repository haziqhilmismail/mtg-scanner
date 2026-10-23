import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { Health } from '../api.ts';
import type { LabelPosition, FoilStyle, RoundDirection, RoundStep, Settings } from '../types.ts';
import { useDecimalInput } from '../hooks/useDecimalInput.ts';
import { Icon } from './Icon.tsx';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

interface FieldsProps {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  t: T;
  health: Health | null;
}

// The fields of one pricing: a post's, or the user's default (see usePricing).
export function PricingFields({ settings, update, t, health }: FieldsProps) {
  // Decimal inputs need local string state so typing "2." doesn't get
  // round-tripped through Number and lose the trailing dot. Empty box → 0.
  const multNormal = useDecimalInput(settings.multNormal, v => update('multNormal', v ?? 0));
  const multFoil = useDecimalInput(settings.multFoil, v => update('multFoil', v ?? 0));
  const minPrice = useDecimalInput(settings.minPrice, v => update('minPrice', v ?? 0));
  // Only a CK problem shows here; prices that loaded fine need no note.
  const healthBadge = !health || health.cardkingdom_cards ? null
    : health.cardkingdom_error ? <span className="health-badge warn">{t('ck_error')}</span>
    : <span className="health-badge">{t('ck_not_loaded')}</span>;

  return (
    <>
      <div className="settings">
        <label>
          <span>{t('mult_normal')}</span>
          <input
            type="text" inputMode="decimal"
            value={multNormal.text}
            placeholder={multNormal.placeholder}
            onChange={e => multNormal.onChange(e.target.value)}
          />
        </label>
        <label>
          <span>{t('mult_foil')}</span>
          <input
            type="text" inputMode="decimal"
            value={multFoil.text}
            placeholder={multFoil.placeholder}
            onChange={e => multFoil.onChange(e.target.value)}
          />
        </label>
        <label>
          <span>{t('currency_label')}</span>
          <input
            type="text"
            value={settings.currencyLabel}
            onChange={e => update('currencyLabel', e.target.value)}
          />
        </label>
        <label>
          <span>{t('label_position')}</span>
          <select
            value={settings.labelPosition}
            onChange={e => update('labelPosition', e.target.value as LabelPosition)}
          >
            <option value="bottom">{t('pos_bottom')}</option>
            <option value="top">{t('pos_top')}</option>
            <option value="center">{t('pos_center')}</option>
          </select>
        </label>
        <label>
          <span>{t('foil_style')}</span>
          <select
            value={settings.foilStyle}
            onChange={e => update('foilStyle', e.target.value as FoilStyle)}
          >
            <option value="gold">{t('foil_style_gold')}</option>
            <option value="suffix">{t('foil_style_suffix')}</option>
          </select>
        </label>
        <label>
          <span>{t('round_prices')}</span>
          <div className="round-controls">
            <select
              value={settings.roundDirection}
              onChange={e => update('roundDirection', e.target.value as RoundDirection)}
            >
              <option value="none">{t('round_none')}</option>
              <option value="up">{t('round_dir_up')}</option>
              <option value="down">{t('round_dir_down')}</option>
              <option value="nearest">{t('round_dir_nearest')}</option>
            </select>
            {settings.roundDirection !== 'none' ? (
              <>
                <span className="round-controls-to">{t('round_to')}</span>
                <select
                  value={settings.roundStep}
                  onChange={e => update('roundStep', parseFloat(e.target.value) as RoundStep)}
                >
                  <option value="0.1">{t('round_step_10c')}</option>
                  <option value="0.5">{t('round_step_50c')}</option>
                  <option value="1">{t('round_step_1')}</option>
                </select>
              </>
            ) : null}
          </div>
        </label>
        <label>
          <span>{t('min_price')}</span>
          <input
            type="text" inputMode="decimal"
            value={minPrice.text}
            placeholder={minPrice.placeholder}
            onChange={e => minPrice.onChange(e.target.value)}
          />
        </label>
        <label>
          <span>{t('label_font_size')}</span>
          <select
            value={settings.labelFontScale}
            onChange={e => update('labelFontScale', parseFloat(e.target.value))}
          >
            <option value="0.85">{t('font_scale_small')}</option>
            <option value="1">{t('font_scale_default')}</option>
            <option value="1.25">{t('font_scale_large')}</option>
            <option value="1.5">{t('font_scale_xlarge')}</option>
          </select>
        </label>
      </div>
      <div className="checkbox-group">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showCurrency}
            onChange={e => update('showCurrency', e.target.checked)}
          />
          <span>{t('show_currency')}</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showCents}
            onChange={e => update('showCents', e.target.checked)}
          />
          <span>{t('show_cents')}</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showOutlines}
            onChange={e => update('showOutlines', e.target.checked)}
          />
          <span>{t('show_outlines')}</span>
        </label>
      </div>
      <p className="status">
        {t('formula_hint')} {healthBadge}
      </p>
    </>
  );
}

interface PanelProps {
  title: string;
  // For the one-line summary while folded.
  settings: Settings;
  t: T;
  children: ReactNode;
}

// A pricing behind one button with its summary; set once per market night,
// so the fields open in a popup only when someone wants to change them.
export function SettingsPanel({ title, settings, t, children }: PanelProps) {
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const roundSummary = settings.roundDirection === 'none'
    ? t('round_none')
    : `${t(`round_dir_${settings.roundDirection}`)} ${t('round_to')} ${settings.currencyLabel} ${settings.roundStep}`;
  const summary = `×${settings.multNormal} · ${t('foil_on')} ×${settings.multFoil} · ${roundSummary}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="pricing-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="tag" size={18} />
        <span className="pricing-button-text">
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        <span className="pricing-button-edit">{t('pricing_edit')}</span>
      </button>
      {open ? createPortal(
        <div className="feedback-overlay" onClick={() => setOpen(false)}>
          <div className="feedback-modal pricing-sheet" role="dialog" aria-modal="true" aria-labelledby="post-pricing-title" onClick={e => e.stopPropagation()}>
            <div className="feedback-head">
              <h2 id="post-pricing-title">{title}</h2>
              <button type="button" className="feedback-close" onClick={() => setOpen(false)} aria-label={t('voucher_close')}>×</button>
            </div>
            {children}
            <div className="feedback-foot">
              <button type="button" className="accent" onClick={() => setOpen(false)}>{t('voucher_done')}</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
