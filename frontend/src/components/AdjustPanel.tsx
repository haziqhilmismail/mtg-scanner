import { Icon } from './Icon.tsx';
import { useEffect, useState } from 'react';
import type { CardRowData, RelookupMsg, Settings } from '../types.ts';
import { applyRounding, fmt2 } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';

interface Props {
  cd: CardRowData;
  msg: RelookupMsg | null;
  busy: boolean;
  settings: Settings;
  t: T;
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

  // Price input — controlled. The literal text in the box is `priceInput`;
  // what unit that text is in is `priceMode`. The stored override
  // (`cd.priceOverride`) is *always* the final RM, regardless of how it was
  // entered. Mode is sticky — it only resets when the card changes, never
  // because typing caused the stored override to update.
  //   - 'rm'  → input is the final RM; stored verbatim (no rounding)
  //   - 'usd' → input is a USD price; stored as applyRounding(usd × mult)
  const [priceInput, setPriceInput] = useState(
    cd.hasOverride && isFinite(cd.unitPrice) ? String(cd.unitPrice) : '',
  );
  const [priceMode, setPriceMode] = useState<'rm' | 'usd'>('rm');

  // Reset both when the user selects a different card.
  useEffect(() => {
    setPriceInput(cd.hasOverride && isFinite(cd.unitPrice) ? String(cd.unitPrice) : '');
    setPriceMode('rm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cd.origIdx]);

  // If something outside the panel clears the override (e.g. the × button
  // or restoring a removed card), wipe the input too — but don't sync on
  // value changes, since that would clobber the USD value the user is typing.
  useEffect(() => {
    if (!cd.hasOverride) setPriceInput('');
  }, [cd.hasOverride]);

  const commitPrice = (rawInput: string, mode: 'rm' | 'usd') => {
    const trimmed = rawInput.trim();
    if (trimmed === '') { onPriceChange(null); return; }
    if (mode === 'usd') {
      const usd = parseFloat(trimmed);
      if (isNaN(usd)) return;
      const rm = applyRounding(usd * cd.mult, settings);
      onPriceChange(String(rm));
    } else {
      onPriceChange(trimmed);
    }
  };

  // Toggling mode clears the input + the stored override, so the value the
  // user types next is interpreted as the new unit and nothing carries over
  // from the previous mode.
  const switchMode = (newMode: 'rm' | 'usd') => {
    if (newMode === priceMode) return;
    setPriceMode(newMode);
    setPriceInput('');
    onPriceChange(null);
  };

  const [open, setOpen] = useState(false);
  let priceWrapClass = 'price-input-wrap';
  if (cd.needsPrice) priceWrapClass += ' required';
  else if (cd.hasOverride) priceWrapClass += ' set';

  const asisUrgent = msg?.type === 'err' && !cd.isManual;

  // Corrections are the exception, not the rule, so they stay folded until
  // asked for — unless this card needs a price or a lookup just reported back.
  const showBody = open || cd.needsPrice || !!msg || busy;

  return (
    <div className={`adjust ${showBody ? 'is-open' : ''}`}>
      <button
        type="button"
        className="adjust-toggle"
        aria-expanded={showBody}
        onClick={() => setOpen(o => !o)}
      >
        <span>{t('adjust')}</span>
        <Icon name="chevronDown" size={16} className="disclosure-chevron" />
      </button>
      {showBody ? (
      <>

      <div className="adjust-block">
        <label className="adjust-label">
          {cd.needsPrice ? t('price_required') : t('price_override')}
        </label>
        <div className="adjust-row">
          <div className="price-mode-toggle" role="group" aria-label={t('price_mode_label')}>
            <button
              type="button"
              className={`mode-btn ${priceMode === 'rm' ? 'active' : ''}`}
              onClick={() => switchMode('rm')}
              title={t('price_mode_rm_title')}
            >RM</button>
            <button
              type="button"
              className={`mode-btn ${priceMode === 'usd' ? 'active' : ''}`}
              onClick={() => switchMode('usd')}
              title={t('price_mode_usd_title')}
            >USD</button>
          </div>
          <div className={priceWrapClass}>
            <span className="prefix">{priceMode === 'usd' ? 'USD' : (settings.currencyLabel || 'RM')}</span>
            <input
              /* type="text" + inputMode="decimal" gets us the numeric keyboard
                 on mobile without the desktop spinner buttons, and — crucial
                 here — kills the trackpad/wheel side-scroll changing the value. */
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              placeholder={
                priceMode === 'usd'
                  ? t('enter_usd_price')
                  : cd.isManual
                    ? t('enter_your_price')
                    : t('auto_price', { n: fmt2(cd.autoPrice) })
              }
              value={priceInput}
              autoFocus={cd.needsPrice}
              onChange={e => {
                // Strip everything except digits and a single decimal point;
                // commits the cleaned value in the active mode.
                const cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                setPriceInput(cleaned);
                commitPrice(cleaned, priceMode);
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
            {t('browse_printings')}
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
      </>
      ) : null}
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
