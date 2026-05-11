import type { CardRowData } from '../types.ts';

interface Props {
  cd: CardRowData;
  t: (k: string, vars?: Record<string, string | number>) => string;
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
  return (
    <div className="row-controls">
      <div className="qty-row">
        <span>{t('qty')}</span>
        <button type="button" className="qty-btn" onClick={() => onQtyStep(-1)} aria-label="−">−</button>
        <input
          className="qty-input"
          type="number" min="1" step="1"
          value={cd.qty}
          onChange={e => onQtyChange(parseInt(e.target.value) || 1)}
        />
        <button type="button" className="qty-btn" onClick={() => onQtyStep(1)} aria-label="+">+</button>
      </div>
      <div className={`mult-row ${cd.hasMultOverride ? 'set' : ''}`}>
        <span>{t('mult')}</span>
        <button type="button" className="qty-btn" onClick={() => onMultStep(-0.1)} aria-label="−">−</button>
        <input
          className="mult-input"
          type="number" min="0" step="0.1"
          value={cd.mult.toFixed(1)}
          title={cd.hasMultOverride ? `override (global: ${cd.globalMult})` : 'global default'}
          onChange={e => {
            const v = e.target.value.trim();
            const parsed = parseFloat(v);
            if (v === '' || isNaN(parsed)) {
              onMultChange(null);
            } else if (Math.abs(parsed - cd.globalMult) < 1e-9) {
              onMultChange(null);
            } else {
              onMultChange(parsed);
            }
          }}
        />
        <button type="button" className="qty-btn" onClick={() => onMultStep(0.1)} aria-label="+">+</button>
        {cd.hasMultOverride ? (
          <button
            type="button"
            className="mult-clear"
            title={t('mult_clear_title')}
            aria-label="Clear"
            onClick={onMultClear}
          >×</button>
        ) : null}
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
