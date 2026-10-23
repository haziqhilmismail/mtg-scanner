import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardRowData, Settings } from '../types.ts';
import { applyRounding, fmt2, formatMyrWithFoil } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

interface Props {
  cd: CardRowData;
  live: boolean;
  settings: Settings;
  t: T;
  onClose: () => void;
  onFoilToggle: () => void;
  onMultStep: (delta: number) => void;
  onMultClear: () => void;
  onPriceChange: (v: string | null) => void;
  onClearOverride: () => void;
}

// One card's price: its finish, its multiplier and an own price, with the
// price and how it was worked out at the top.
export function AdjustPanel({
  cd, live, settings, t, onClose,
  onFoilToggle, onMultStep, onMultClear, onPriceChange, onClearOverride,
}: Props) {
  useBackClose(true, onClose);
  // The box holds what was typed; `priceMode` says which unit it is in. The
  // stored override is always the final RM: 'usd' input is stored as
  // applyRounding(usd × mult).
  const [priceInput, setPriceInput] = useState(cd.hasOverride && isFinite(cd.unitPrice) ? String(cd.unitPrice) : '');
  const [priceMode, setPriceMode] = useState<'rm' | 'usd'>('rm');

  // Cleared from outside (the card's override removed): empty the box too.
  useEffect(() => { if (!cd.hasOverride) setPriceInput(''); }, [cd.hasOverride]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commitPrice = (raw: string, mode: 'rm' | 'usd') => {
    const trimmed = raw.trim();
    if (trimmed === '') { onPriceChange(null); return; }
    if (mode === 'usd') {
      const usd = parseFloat(trimmed);
      if (!isNaN(usd)) onPriceChange(String(applyRounding(usd * cd.mult, settings)));
    } else {
      onPriceChange(trimmed);
    }
  };
  // A new unit starts empty, so nothing typed in the old unit carries over.
  const switchMode = (mode: 'rm' | 'usd') => {
    if (mode === priceMode) return;
    setPriceMode(mode); setPriceInput(''); onPriceChange(null);
  };

  const set = [cd.sel.set?.toUpperCase(), cd.sel.collector_number ? `#${cd.sel.collector_number}` : '', cd.sel.set_name].filter(Boolean).join(' · ');
  const working = cd.isManual ? t('manual_set_price')
    : `USD ${fmt2(cd.usd)} × ${cd.mult} = RM ${fmt2(cd.usd * cd.mult)}${live ? `. ${t('tile_live_note')}` : ''}`;
  const finishes = [
    { foil: false, label: t('foil_off'), usd: cd.sel.usd },
    { foil: true, label: t('foil_on'), usd: cd.sel.usd_foil },
  ];

  return createPortal(
    <div className="feedback-overlay" onClick={onClose}>
      <div className="feedback-modal adjust-sheet" role="dialog" aria-modal="true" aria-labelledby={`adjust-title-${cd.origIdx}`} onClick={e => e.stopPropagation()}>
        <div className="feedback-head">
          <div>
            <h2 id={`adjust-title-${cd.origIdx}`}>{cd.sel.name || t('unknown_card')}</h2>
            {set ? <p className="adjust-set">{set}</p> : null}
          </div>
          <button type="button" className="feedback-close" onClick={onClose} aria-label={t('voucher_close')}>×</button>
        </div>

        <div className="adjust-summary">
          <span className={`tile-price ${cd.isFoil && settings.foilStyle === 'gold' ? 'foil' : ''}`}>
            {cd.needsPrice ? t('price_required') : <>{live && !cd.hasOverride ? <span className="tile-approx">~</span> : null}{formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings)}</>}
          </span>
          <span className="adjust-working">{working}</span>
        </div>

        {cd.isManual ? null : (
          <div className="adjust-block">
            <span className="adjust-label">{t('tile_finish')}</span>
            <div className="segmented adjust-finish" role="group" aria-label={t('tile_finish')}>
              {finishes.map(f => (
                <button
                  key={String(f.foil)} type="button" className={`${cd.isFoil === f.foil ? 'active' : ''} ${f.foil ? 'is-foil' : ''}`}
                  aria-pressed={cd.isFoil === f.foil} onClick={() => { if (cd.isFoil !== f.foil) onFoilToggle(); }}
                >
                  <strong>{f.label}</strong>
                  <span>{f.usd > 0 ? `USD ${fmt2(f.usd)}` : t('modal_no_normal')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {cd.isManual ? null : (
          <div className="adjust-block">
            <span className="adjust-label">
              {t('mult')}
              {cd.hasMultOverride
                ? <button type="button" className="link-btn" onClick={onMultClear}>{t('tile_mult_reset')}</button>
                : <span className="adjust-label-note">{t('tile_mult_default')}</span>}
            </span>
            <div className="adjust-stepper">
              <button type="button" aria-label={`${t('mult')} −`} onClick={() => onMultStep(-0.1)}>−</button>
              <span>×{cd.mult}</span>
              <button type="button" aria-label={`${t('mult')} +`} onClick={() => onMultStep(0.1)}>+</button>
            </div>
          </div>
        )}

        <div className="adjust-block">
          <span className="adjust-label">{cd.needsPrice ? t('price_required') : t('price_override')}</span>
          <div className="adjust-row">
            <div className="segmented price-mode-toggle" role="group" aria-label={t('price_mode_label')}>
              <button type="button" className={priceMode === 'rm' ? 'active' : ''} onClick={() => switchMode('rm')} title={t('price_mode_rm_title')}>RM</button>
              <button type="button" className={priceMode === 'usd' ? 'active' : ''} onClick={() => switchMode('usd')} title={t('price_mode_usd_title')}>USD</button>
            </div>
            <label className={`price-input-wrap ${cd.needsPrice ? 'required' : cd.hasOverride ? 'set' : ''}`}>
              <span className="prefix">{priceMode === 'usd' ? 'USD' : (settings.currencyLabel || 'RM')}</span>
              <input
                // Text, not number: a phone shows the number pad, and a scroll
                // over the box can't change the price.
                type="text" inputMode="decimal"
                placeholder={priceMode === 'usd' ? t('enter_usd_price') : cd.isManual ? t('enter_your_price') : t('auto_price', { n: fmt2(cd.autoPrice) })}
                value={priceInput}
                autoFocus={cd.needsPrice}
                onChange={e => {
                  const cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                  setPriceInput(cleaned);
                  commitPrice(cleaned, priceMode);
                }}
              />
            </label>
            {cd.hasOverride ? <button type="button" className="clear-btn" onClick={onClearOverride} aria-label={t('clear')}>×</button> : null}
          </div>
        </div>

        <div className="feedback-foot">
          <button type="button" className="accent" onClick={onClose}>{t('voucher_done')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
