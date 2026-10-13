import type { Health } from '../api.ts';
import type { LabelPosition, FoilStyle, RoundDirection, RoundStep, Settings } from '../types.ts';
import { useDecimalInput } from '../hooks/useDecimalInput.ts';
import { usePersistedState } from '../hooks/usePersistedState.ts';
import { Icon } from './Icon.tsx';

interface Props {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
  health: Health | null;
}

export function SettingsPanel({ settings, update, t, health }: Props) {
  // Decimal inputs need local string state so typing "2." doesn't get
  // round-tripped through Number and lose the trailing dot. Empty box → 0.
  const multNormal = useDecimalInput(settings.multNormal, v => update('multNormal', v ?? 0));
  const multFoil = useDecimalInput(settings.multFoil, v => update('multFoil', v ?? 0));
  const minPrice = useDecimalInput(settings.minPrice, v => update('minPrice', v ?? 0));
  // Pricing is set once per market night, so it stays folded away with a
  // one-line summary until someone wants to change it.
  const [open, setOpen] = usePersistedState('mtg.settingsOpen', false);
  const roundSummary = settings.roundDirection === 'none'
    ? t('round_none')
    : `${t(`round_dir_${settings.roundDirection}`)} ${t('round_to')} ${settings.currencyLabel} ${settings.roundStep}`;
  const summary = `×${settings.multNormal} · ${t('foil_on')} ×${settings.multFoil} · ${roundSummary}`;
  let healthBadge = (
    <span className="health-badge">{t('ck_checking')}</span>
  );
  if (health) {
    if (health.cardkingdom_cards) {
      healthBadge = (
        <span className="health-badge ok">
          {t('ck_loaded', { n: health.cardkingdom_cards.toLocaleString() })}
        </span>
      );
    } else if (health.cardkingdom_error) {
      healthBadge = <span className="health-badge warn">{t('ck_error')}</span>;
    } else {
      healthBadge = <span className="health-badge">{t('ck_not_loaded')}</span>;
    }
  }

  return (
    <section className={`panel disclosure ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={open}
        aria-controls="pricing-settings"
        onClick={() => setOpen(o => !o)}
      >
        <span className="disclosure-text">
          <span className="disclosure-title">{t('settings_title')}</span>
          {!open ? <span className="disclosure-summary">{summary}</span> : null}
        </span>
        <Icon name="chevronDown" className="disclosure-chevron" />
      </button>
      {open ? (
      <div id="pricing-settings" className="disclosure-body">
      <div className="settings">
        <label>
          <span>{t('mult_normal')}</span>
          <input
            type="text" inputMode="decimal"
            value={multNormal.text}
            onChange={e => multNormal.onChange(e.target.value)}
          />
        </label>
        <label>
          <span>{t('mult_foil')}</span>
          <input
            type="text" inputMode="decimal"
            value={multFoil.text}
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
      </div>
      ) : null}
    </section>
  );
}
