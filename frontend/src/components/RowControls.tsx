import { Icon } from './Icon.tsx';
import type { CardRowData } from '../types.ts';
import { useDecimalInput } from '../hooks/useDecimalInput.ts';
import type { T } from '../hooks/useLang.ts';

interface Props {
  cd: CardRowData;
  t: T;
  onQtyChange: (qty: number) => void;
  onQtyStep: (delta: number) => void;
  onMultChange: (mult: number | null) => void;
  onMultStep: (delta: number) => void;
  onMultClear: () => void;
  onFoilToggle: () => void;
}

// QTY pill, MULT pill (with red accent when overridden), foil toggle
export function RowControls({
  cd, t,
  onQtyChange, onQtyStep,
  onMultChange, onMultStep, onMultClear,
  onFoilToggle,
}: Props) {
  // Local string state so the user can type a "." without it getting eaten
  // mid-keystroke. Empty box → null = "use global default", matches the
  // pre-refactor behaviour exactly.
  const multInput = useDecimalInput(cd.mult, (v) => {
    if (v === null) onMultChange(null);
    else if (Math.abs(v - cd.globalMult) < 1e-9) onMultChange(null);
    else onMultChange(v);
  }, cd.globalMult);
  // Quantity: whole numbers, and an empty box means 1.
  const qtyInput = useDecimalInput(cd.qty, (v) => onQtyChange(v == null ? 1 : Math.max(1, Math.round(v))), 1);

  return (
    <div className="row-controls">
      <div className="qty-row">
        <span>{t('qty')}</span>
        <button type="button" className="qty-btn" onClick={() => onQtyStep(-1)} aria-label={`${t('qty')} −`}><Icon name="minus" size={16} /></button>
        <input
          className="qty-input"
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={qtyInput.text}
          placeholder={qtyInput.placeholder}
          aria-label={t('qty')}
          onChange={e => qtyInput.onChange(e.target.value.replace(/\D/g, ''))}
        />
        <button type="button" className="qty-btn" onClick={() => onQtyStep(1)} aria-label={`${t('qty')} +`}><Icon name="plus" size={16} /></button>
      </div>
      <div className={`mult-row ${cd.hasMultOverride ? 'set' : ''}`}>
        <span>{t('mult')}</span>
        <button type="button" className="qty-btn" onClick={() => onMultStep(-0.1)} aria-label={`${t('mult')} −`}><Icon name="minus" size={16} /></button>
        <input
          className="mult-input"
          type="text" inputMode="decimal"
          value={multInput.text}
          placeholder={multInput.placeholder}
          aria-label={t('mult')}
          title={cd.hasMultOverride ? `override (global: ${cd.globalMult})` : 'global default'}
          onChange={e => multInput.onChange(e.target.value)}
        />
        <button type="button" className="qty-btn" onClick={() => onMultStep(0.1)} aria-label={`${t('mult')} +`}><Icon name="plus" size={16} /></button>
        {/* Always render so the row width is constant — otherwise toggling an
            override widens the row by ~28px and bumps the foil button to the
            next line via flex-wrap on .row-controls. */}
        <button
          type="button"
          className="mult-clear"
          title={t('mult_clear_title')}
          aria-label="Clear"
          onClick={onMultClear}
          tabIndex={cd.hasMultOverride ? 0 : -1}
          style={cd.hasMultOverride ? undefined : { visibility: 'hidden' }}
        >×</button>
      </div>
      <button
        type="button"
        className={`toggle ${cd.isFoil ? 'active' : ''}`}
        onClick={onFoilToggle}
      >
        {cd.isFoil ? t('foil_on') : t('foil_off')}
      </button>
    </div>
  );
}
