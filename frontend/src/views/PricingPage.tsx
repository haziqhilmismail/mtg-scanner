import { useState } from 'react';
import { Breadcrumbs, type Crumb } from '../components/Breadcrumbs.tsx';
import { Icon } from '../components/Icon.tsx';
import { PricingExample } from '../components/SettingsPanel.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Select, TextField } from '../components/ui/Field.tsx';
import { RadioCards } from '../components/ui/RadioCards.tsx';
import { StickyBar } from '../components/ui/StickyBar.tsx';
import { useToast } from '../components/ui/Toast.tsx';
import type { T } from '../hooks/useLang.ts';
import { useNavStore } from '../hooks/useNav.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import { formulaLine, priceField, pricingSummary, roundingKey, ROUNDINGS, roundingText, samePricing, type PriceField } from '../lib/pricing.ts';
import type { Route } from '../routes.ts';
import type { FoilStyle, LabelPosition, PriceMode, Settings } from '../types.ts';

interface Props {
  // The post whose pricing this is; null for the default that new posts start with.
  postId: number | null;
  postTitle?: string;
  crumbs: Crumb[];
  // Where Cancel and Save lead when there is no page to go back to.
  parent: Route;
  pricing: PricingStore;
  t: T;
}

// A post's pricing, or the default for new posts, as a form: nothing is saved
// until Save, which sends it all at once.
export function PricingPage({ postId, postTitle, crumbs, parent, pricing, t }: Props) {
  const title = postId == null ? t('menu_default_pricing') : t('settings_title');
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <h1 className="page-title">{title}</h1>
      <p className="pricing-sub">{postId == null ? t('pricing_default_sub') : t('pricing_sub_post', { post: postTitle ?? '' })}</p>
      {pricing.pricingKnown(postId)
        // Keyed: another post's pricing starts a fresh draft.
        ? <PricingForm key={postId ?? 'default'} postId={postId} parent={parent} pricing={pricing} t={t} />
        : <Spinner />}
    </>
  );
}

const SIZES = [['0.85', 'font_scale_small'], ['1', 'font_scale_default'], ['1.25', 'font_scale_large'], ['1.5', 'font_scale_xlarge']];
const TEXT_FIELDS: PriceField[] = ['multNormal', 'multFoil', 'minPrice'];

function PricingForm({ postId, parent, pricing, t }: Omit<Props, 'postTitle' | 'crumbs'>) {
  const nav = useNavStore();
  const toast = useToast();
  const saved = pricing.pricingFor(postId);
  // The draft: every setting, with the numbers as typed.
  const [values, setValues] = useState<Settings>(saved);
  const [typed, setTyped] = useState(() => Object.fromEntries(TEXT_FIELDS.map(f => [f, String(saved[f])])) as Record<PriceField, string>);
  const [alsoDefault, setAlsoDefault] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setValues(v => ({ ...v, [key]: value }));

  const numbers = Object.fromEntries(TEXT_FIELDS.map(f => [f, priceField(f, typed[f], saved)])) as Record<PriceField, number | null>;
  const invalid = TEXT_FIELDS.some(f => numbers[f] == null);
  // What the page shows: the typed numbers, or the saved ones while a field is wrong.
  const next: Settings = { ...values, ...Object.fromEntries(TEXT_FIELDS.map(f => [f, numbers[f] ?? saved[f]])) };
  const defaults = pricing.pricingFor(null);
  const matchesDefault = postId != null && samePricing(next, defaults);
  const dirty = invalid || !samePricing(next, saved) || (alsoDefault && !matchesDefault);
  const live = values.priceMode === 'live';

  // Back to where the seller came from: the post, a photo, or Profile.
  const leave = () => (history.length > 1 ? history.back() : nav.replace(parent));
  const save = () => {
    pricing.save(postId, next, alsoDefault && !matchesDefault);
    toast(t('pricing_saved_toast'));
    leave();
  };

  const field = (f: PriceField, label: string, prefix: string, inputMode: 'decimal' | 'numeric', error: string) => (
    <TextField
      label={label} prefix={prefix} inputMode={inputMode} autoComplete="off" value={typed[f]}
      error={numbers[f] == null ? error : undefined}
      onChange={e => setTyped(v => ({ ...v, [f]: e.target.value }))}
    />
  );
  const roundings = ROUNDINGS.some(r => roundingKey(r) === roundingKey(values)) ? ROUNDINGS : [...ROUNDINGS, values];

  return (
    <>
      <div className="pricing-layout">
        <section className="ui-card pricing-card pricing-kind" aria-labelledby="pricing-kind">
          <h2 id="pricing-kind" className="ui-card-title">{t('pricing_kind_title')}</h2>
          <RadioCards
            aria-labelledby="pricing-kind" value={values.priceMode} onChange={(v: PriceMode) => set('priceMode', v)}
            options={(['photo', 'live'] as const).map(v => ({ value: v, title: t(`kind_${v}`), description: t(`kind_${v}_desc`) }))}
          />
          <PricingExample settings={next} t={t} />
        </section>

        <div className="pricing-fields">
          <section className="ui-card pricing-card" aria-labelledby="pricing-price">
            <h2 id="pricing-price" className="ui-card-title">{t('pricing_price_title')}</h2>
            <div className="pricing-grid">
              {field('multNormal', t('mult_normal'), '×', 'decimal', t('mult_error'))}
              {field('multFoil', t('mult_foil'), '×', 'decimal', t('mult_error'))}
              <Select
                label={t('round_prices')} value={roundingKey(values)}
                onChange={e => {
                  const r = roundings.find(o => roundingKey(o) === e.target.value)!;
                  setValues(v => ({ ...v, roundDirection: r.roundDirection, roundStep: r.roundStep }));
                }}
              >
                {roundings.map(r => <option key={roundingKey(r)} value={roundingKey(r)}>{roundingText(r, next, t, 'option')}</option>)}
              </Select>
              {field('minPrice', t('min_price'), values.currencyLabel.trim() || 'RM', 'numeric', t('min_error'))}
            </div>
            <p className="pricing-formula">{formulaLine(next, t)}</p>
          </section>

          <section className="ui-card pricing-card" aria-labelledby="pricing-labels">
            <h2 id="pricing-labels" className="ui-card-title">{t('pricing_labels_title')}</h2>
            {live ? <p className="pricing-note">{t('pricing_labels_live')}</p> : (
              <>
                <p className="pricing-note">{t('pricing_labels_sub')}</p>
                <div className="pricing-grid">
                  <Select label={t('label_position')} value={values.labelPosition} onChange={e => set('labelPosition', e.target.value as LabelPosition)}>
                    {(['center', 'top', 'bottom'] as const).map(p => <option key={p} value={p}>{t(`pos_${p}`)}</option>)}
                  </Select>
                  <Select label={t('label_font_size')} value={String(values.labelFontScale)} onChange={e => set('labelFontScale', Number(e.target.value))}>
                    {SIZES.some(([v]) => v === String(values.labelFontScale)) ? null : <option value={String(values.labelFontScale)}>×{values.labelFontScale}</option>}
                    {SIZES.map(([v, key]) => <option key={v} value={v}>{t(key)}</option>)}
                  </Select>
                  <Select label={t('foil_mark')} value={values.foilStyle} onChange={e => set('foilStyle', e.target.value as FoilStyle)}>
                    <option value="suffix">{t('foil_mark_suffix')}</option>
                    <option value="gold">{t('foil_mark_none')}</option>
                  </Select>
                  <TextField label={t('currency_label')} value={values.currencyLabel} maxLength={4} autoComplete="off" onChange={e => set('currencyLabel', e.target.value)} />
                </div>
                <Checkbox
                  label={t('show_currency', { cur: values.currencyLabel.trim() || 'RM' })}
                  checked={values.showCurrency} onChange={e => set('showCurrency', e.target.checked)}
                />
                <Checkbox label={t('show_cents')} checked={values.showCents} onChange={e => set('showCents', e.target.checked)} />
              </>
            )}
            <Checkbox
              label={t('show_outlines')} hint={t('show_outlines_hint')}
              checked={values.showOutlines} onChange={e => set('showOutlines', e.target.checked)}
            />
          </section>

          {postId != null ? (
            matchesDefault ? (
              <p className="pricing-default is-same"><Icon name="check" size={16} />{t('pricing_matches_default')}</p>
            ) : (
              <div className="ui-card pricing-card pricing-default">
                <Checkbox
                  label={t('pricing_also_default')}
                  hint={t('pricing_also_default_hint', { summary: `${t(`kind_${defaults.priceMode}`)} · ${pricingSummary(defaults, t)}` })}
                  checked={alsoDefault} onChange={e => setAlsoDefault(e.target.checked)}
                />
              </div>
            )
          ) : null}
        </div>
      </div>

      <StickyBar>
        <span className={`ui-sticky-status${invalid ? ' is-warn' : ''}`} aria-live="polite">
          {!dirty ? '' : invalid ? t('pricing_fix_red') : t('pricing_unsaved')}
        </span>
        <button type="button" className="ui-btn ui-btn--ink" onClick={leave}>{t('cancel')}</button>
        <button type="button" className="ui-btn ui-btn--primary" disabled={!dirty || invalid} onClick={save}>{t('pricing_save')}</button>
      </StickyBar>
    </>
  );
}
