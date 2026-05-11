import type { Health } from '../api.ts';
import type { LabelPosition, FoilStyle, RoundingMode, Settings } from '../types.ts';

interface Props {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
  health: Health | null;
}

export function SettingsPanel({ settings, update, t, health }: Props) {
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
    <section className="panel">
      <h2>
        <span className="step-num">1</span>
        <span>{t('settings_title')}</span>
      </h2>
      <div className="settings">
        <label>
          <span>{t('mult_normal')}</span>
          <input
            type="number" step="0.1" min="0"
            value={settings.multNormal}
            onChange={e => update('multNormal', parseFloat(e.target.value) || 0)}
          />
        </label>
        <label>
          <span>{t('mult_foil')}</span>
          <input
            type="number" step="0.1" min="0"
            value={settings.multFoil}
            onChange={e => update('multFoil', parseFloat(e.target.value) || 0)}
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
          <select
            value={settings.rounding}
            onChange={e => update('rounding', e.target.value as RoundingMode)}
          >
            <option value="none">{t('round_none')}</option>
            <option value="nearest_0.5">{t('round_n50')}</option>
            <option value="up_0.5">{t('round_u50')}</option>
            <option value="down_0.5">{t('round_d50')}</option>
            <option value="nearest_1">{t('round_n1')}</option>
            <option value="up_1">{t('round_u1')}</option>
            <option value="down_1">{t('round_d1')}</option>
          </select>
        </label>
        <label>
          <span>{t('min_price')}</span>
          <input
            type="number" step="0.5" min="0"
            value={settings.minPrice}
            onChange={e => update('minPrice', parseFloat(e.target.value) || 0)}
          />
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
    </section>
  );
}
