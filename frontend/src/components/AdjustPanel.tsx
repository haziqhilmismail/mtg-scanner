import { useId, useState } from 'react';
import type { T } from '../hooks/useLang.ts';
import type { Batch, CardRowData, Settings } from '../types.ts';
import { computeCardData, fmt2, formatMyr, overrideText, parseOverride, readPrice, type PriceOverride } from '../utils.ts';
import { Dialog } from './ui/Dialog.tsx';
import { TextField } from './ui/Field.tsx';
import { Segmented } from './ui/Segmented.tsx';
import { Stepper } from './ui/Stepper.tsx';

// What Save price writes back to the card: its finish, its own multiplier
// (null: the pricing's) and its own price (null: none, see PriceOverride).
export interface PriceEdit { isFoil: boolean; multOverride: number | null; priceOverride: string | null }

interface Draft { isFoil: boolean; multOverride: number | null; unit: PriceOverride['unit']; text: string }

interface Props {
  open: boolean;
  batch: Batch;
  idx: number;
  live: boolean;
  settings: Settings;
  t: T;
  onClose: () => void;
  onSave: (edit: PriceEdit) => void;
}

const MULT_MIN = 1;
const MULT_MAX = 5;
const asTyped = (n: number) => n.toFixed(Number.isInteger(n) ? 0 : 2);
const replaceAt = <V,>(arr: V[], i: number, v: V) => arr.map((x, j) => (j === i ? v : x));

// How the price was worked out, in one sentence: "USD 4.99 × 2.5 = RM12.48, rounded up."
function working(cd: CardRowData, usd: number, settings: Settings, t: T): string {
  const raw = usd * cd.mult;
  const sum = `USD ${fmt2(usd)} × ${cd.mult} = ${formatMyr(raw, { ...settings, showCents: true })}`;
  if (raw < settings.minPrice && cd.unitPrice === settings.minPrice) return t('ep_min', { sum, min: formatMyr(settings.minPrice, settings) });
  if (settings.roundDirection === 'none' || Math.abs(cd.unitPrice - raw) < 0.005) return t('ep_exact', { sum });
  return t(`ep_round_${settings.roundDirection}`, { sum });
}

// One card's price as a draft: its finish, its multiplier and a price of the
// seller's own, in RM (kept as typed) or USD (still multiplied and rounded).
// Nothing changes on the card until Save price.
export function AdjustPanel({ open, batch, idx, live, settings, t, onClose, onSave }: Props) {
  const ids = useId();
  const [draft, setDraft] = useState<Draft>(() => {
    const own = parseOverride(batch.priceOverride[idx]);
    return { isFoil: !!batch.isFoil[idx], multOverride: batch.multOverride[idx] ?? null, unit: own?.unit ?? 'rm', text: own ? asTyped(own.amount) : '' };
  });
  const price = readPrice(draft.text);
  const edit: PriceEdit = {
    isFoil: draft.isFoil,
    multOverride: draft.multOverride,
    priceOverride: overrideText(typeof price === 'number' ? { unit: draft.unit, amount: price } : null),
  };
  const cd = computeCardData({
    ...batch,
    isFoil: replaceAt(batch.isFoil, idx, edit.isFoil),
    multOverride: replaceAt(batch.multOverride, idx, edit.multOverride),
    priceOverride: replaceAt(batch.priceOverride, idx, edit.priceOverride),
  }, settings)[idx];
  if (!cd) return null;

  const name = cd.sel.name || t('unknown_card');
  const set = [cd.sel.set?.toUpperCase(), cd.sel.collector_number ? `#${cd.sel.collector_number}` : '', cd.sel.set_name].filter(Boolean).join(' · ');
  const defaultMult = draft.isFoil ? settings.multFoil : settings.multNormal;
  // A multiplier equal to the finish's own is no multiplier of the card's.
  const ownMult = (mult: number | null, foil = draft.isFoil) =>
    (mult != null && Math.abs(mult - (foil ? settings.multFoil : settings.multNormal)) < 1e-9 ? null : mult);
  const ckUsd = (foil: boolean) => (foil ? cd.sel.price_source_foil : cd.sel.price_source_normal) === 'cardkingdom' ? (foil ? cd.sel.usd_foil : cd.sel.usd) : 0;
  const finishLabel = (foil: boolean) => (
    <>
      <span className={foil ? 'photo-foil' : undefined}>{t(foil ? 'foil_on' : 'foil_off')}</span>
      <span className="ep-finish-usd">{ckUsd(foil) > 0 ? `USD ${fmt2(ckUsd(foil))}` : t('ep_no_price')}</span>
    </>
  );

  let summary: string;
  if (cd.needsPrice) summary = cd.isManual ? t('ep_manual') : t('ep_no_ck');
  else if (cd.ownUsd != null) summary = `${t('ep_yours_usd')} ${working(cd, cd.ownUsd, settings, t)}`;
  else if (cd.hasOverride) summary = cd.autoPrice > 0 ? t('ep_yours_rm', { auto: `${live ? '≈' : ''}${formatMyr(cd.autoPrice, settings)}` }) : t('ep_yours_rm_no_ck');
  else summary = working(cd, cd.usd, settings, t) + (live ? ` ${t('ep_live')}` : '');

  const placeholder = draft.unit === 'usd'
    ? (ckUsd(draft.isFoil) > 0 ? fmt2(ckUsd(draft.isFoil)) : '')
    : (cd.autoPrice > 0 ? t('ep_auto_placeholder', { n: asTyped(cd.autoPrice) }) : '');

  return (
    <Dialog
      open={open} onClose={onClose} closeLabel={t('voucher_close')}
      title={name} subtitle={set || undefined}
      className="edit-price"
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn--ink" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={price === 'invalid'} onClick={() => onSave(edit)}>{t('ep_save')}</button>
        </>
      )}
    >
      <div className="ep-summary" aria-live="polite">
        {cd.needsPrice ? <span className="ep-price is-needed">{t('photo_set_price')}</span> : (
          <span className={`ep-price${cd.isFoil ? ' is-foil' : ''}`}>
            {live && !cd.hasOverride ? <span className="photo-approx">≈</span> : null}{formatMyr(cd.unitPrice, settings)}
          </span>
        )}
        <p className="ep-working">{summary}</p>
      </div>

      {cd.isManual ? null : (
        <Segmented
          label={t('tile_finish')} className="ep-finish"
          value={draft.isFoil ? 'foil' : 'nonfoil'}
          onChange={v => setDraft(d => ({ ...d, isFoil: v === 'foil', multOverride: ownMult(d.multOverride, v === 'foil') }))}
          options={[{ value: 'nonfoil', label: finishLabel(false) }, { value: 'foil', label: finishLabel(true) }]}
        />
      )}

      {cd.isManual ? null : (
        <div className="ui-field ep-mult">
          <div className="ep-label-row">
            <span className="ui-label" id={`${ids}-mult`}>{t('mult')}</span>
            {draft.multOverride != null ? (
              <button type="button" className="ui-btn ui-btn--plain ep-reset" onClick={() => setDraft(d => ({ ...d, multOverride: null }))}>
                {t('ep_mult_reset', { mult: defaultMult })}
              </button>
            ) : <span className="ep-label-note">{t('tile_mult_default')}</span>}
          </div>
          <Stepper
            value={cd.mult} min={MULT_MIN} max={MULT_MAX} step={0.1} format={v => `×${v}`}
            label={t('mult')} decrementLabel={t('ep_mult_down')} incrementLabel={t('ep_mult_up')}
            onChange={v => setDraft(d => ({ ...d, multOverride: ownMult(v) }))}
          />
        </div>
      )}

      <div className="ui-field">
        <span className="ui-label" id={`${ids}-own`}>{t('ep_own_label')}</span>
        <div className="ep-own-row">
          <Segmented
            aria-label={t('ep_unit')} className="ep-unit"
            value={draft.unit} onChange={unit => setDraft(d => ({ ...d, unit }))}
            options={[{ value: 'rm', label: 'RM' }, { value: 'usd', label: 'USD' }]}
          />
          <TextField
            aria-labelledby={`${ids}-own`} className="ep-own-field"
            prefix={draft.unit === 'usd' ? 'USD' : settings.currencyLabel || 'RM'}
            inputMode="decimal" autoComplete="off" placeholder={placeholder}
            value={draft.text} onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
            error={price === 'invalid' ? t('ep_price_error') : undefined}
            {...(cd.needsPrice ? { 'data-autofocus': '' } : {})}
          />
        </div>
        <p className="ui-hint">{t(draft.unit === 'usd' ? 'ep_own_hint_usd' : 'ep_own_hint_rm')}</p>
      </div>
    </Dialog>
  );
}
