import { useEffect, useState } from 'react';
import type { CardRowData, RelookupMsg, Settings } from '../types.ts';
import { fmt2 } from '../utils.ts';

interface Props {
  cd: CardRowData;
  msg: RelookupMsg | null;
  busy: boolean;
  settings: Settings;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onPriceChange: (v: string | null) => void;
  onClearOverride: () => void;
  onBrowsePrintings: () => void;
  onFind: (name: string) => void;
  onUseAsIs: (name: string) => void;
}

export function AdjustPanel({
  cd, msg, busy, settings, t,
  onPriceChange, onClearOverride,
  onBrowsePrintings, onFind, onUseAsIs,
}: Props) {
  // Name input — controlled, but resets when the underlying candidate changes
  // (e.g., user picked a different printing, or scanner found a different match)
  const [nameInput, setNameInput] = useState(cd.sel.name || '');
  useEffect(() => {
    setNameInput(cd.sel.name || '');
  }, [cd.sel.name, cd.sel.scryfall_id]);

  // Price input — controlled, syncs to external clears/overrides
  const overrideValue = cd.hasOverride
    ? (isFinite(cd.unitPrice) ? String(cd.unitPrice) : '')
    : '';
  const [priceInput, setPriceInput] = useState(overrideValue);
  useEffect(() => {
    setPriceInput(overrideValue);
  }, [overrideValue]);

  let priceWrapClass = 'price-input-wrap';
  if (cd.needsPrice) priceWrapClass += ' required';
  else if (cd.hasOverride) priceWrapClass += ' set';

  const asisUrgent = msg?.type === 'err' && !cd.isManual;

  return (
    <div className="adjust">
      <div className="adjust-title">{t('adjust')}</div>

      <div className="adjust-block">
        <label className="adjust-label">
          {cd.needsPrice ? t('price_required') : t('price_override')}
        </label>
        <div className="adjust-row">
          <div className={priceWrapClass}>
            <span className="prefix">{settings.currencyLabel || 'RM'}</span>
            <input
              type="number" inputMode="decimal" step="0.5" min="0"
              placeholder={cd.isManual ? t('enter_your_price') : t('auto_price', { n: fmt2(cd.autoPrice) })}
              value={priceInput}
              autoFocus={cd.needsPrice}
              onChange={e => {
                const v = e.target.value;
                setPriceInput(v);
                const trimmed = v.trim();
                onPriceChange(trimmed === '' ? null : trimmed);
              }}
            />
          </div>
          <button
            type="button"
            className="clear-btn"
            disabled={!cd.hasOverride}
            onClick={onClearOverride}
            title="Clear"
          >×</button>
        </div>
      </div>

      <div className="adjust-block">
        <label className="adjust-label">{t('wrong_printing')}</label>
        <div className="adjust-row">
          <button
            type="button"
            className="printings-btn"
            disabled={cd.isManual || !cd.sel.name}
            onClick={onBrowsePrintings}
          >
            <span className="glyph">▦</span> {t('browse_printings')}
          </button>
        </div>
      </div>

      <div className="adjust-block">
        <label className="adjust-label">{t('wrong_card')}</label>
        <div className="adjust-row">
          <input
            className="relookup-input"
            type="text"
            placeholder={t('type_card_name')}
            value={nameInput}
            disabled={busy}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onFind(nameInput);
              }
            }}
          />
          <button
            type="button"
            className={`relookup-btn ${busy ? 'busy' : ''}`}
            disabled={busy}
            onClick={() => onFind(nameInput)}
          >
            {busy ? t('looking_up') : t('find')}
          </button>
          <button
            type="button"
            className={`asis-btn ${asisUrgent ? 'urgent' : ''}`}
            disabled={busy}
            onClick={() => onUseAsIs(nameInput)}
          >
            {t('use_asis')}
          </button>
        </div>
        <AdjustMsg msg={msg} onAction={() => onUseAsIs(nameInput)} />
        <div className="adjust-hint">{t('relookup_hint')}</div>
      </div>
    </div>
  );
}

function AdjustMsg({ msg, onAction }: { msg: RelookupMsg | null; onAction: () => void }) {
  if (!msg) return <div className="adjust-msg">&nbsp;</div>;
  return (
    <div className={`adjust-msg ${msg.type}`}>
      {msg.text}
      {msg.action ? (
        <button type="button" className="inline-action" onClick={onAction}>{msg.action}</button>
      ) : null}
    </div>
  );
}
