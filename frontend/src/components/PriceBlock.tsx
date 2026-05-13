import type { ReactNode } from 'react';
import type { CardRowData, Settings } from '../types.ts';
import { formatMyrWithFoil } from '../utils.ts';

interface Props {
  cd: CardRowData;
  settings: Settings;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onClearOverride: () => void;
  // Optional trailing content rendered inside `.price-block` so it joins the
  // same baseline-aligned flex row as the big RM number — used by CardRow to
  // place the "× N = RM total" subtotal inline (no new vertical line, no
  // sibling shift when qty toggles 1↔N).
  extra?: ReactNode;
}

// 3-state: "set price ↓" prompt (manual + no override) |
// strike-through auto + override + pill | plain auto price
export function PriceBlock({ cd, settings, t, onClearOverride, extra }: Props) {
  if (cd.needsPrice) {
    return (
      <div className="price-block">
        <span className="price-set-prompt">{t('set_price_prompt')}</span>
        {extra}
      </div>
    );
  }

  const useGold = cd.isFoil && settings.foilStyle === 'gold';
  const priceClass = useGold ? 'foil' : '';

  if (cd.hasOverride) {
    return (
      <div className="price-block">
        {cd.isManual ? null : (
          <span className="price-myr struck">
            {formatMyrWithFoil(cd.autoPrice, cd.isFoil, settings)}
          </span>
        )}
        <span className={`price-myr ${priceClass}`}>
          {formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings)}
        </span>
        <span className="override-pill">
          {cd.isManual ? t('manual_pill') : t('override_pill')}
          <button type="button" onClick={onClearOverride} aria-label="Clear">×</button>
        </span>
        {extra}
      </div>
    );
  }

  return (
    <div className="price-block">
      <span className={`price-myr ${priceClass}`}>
        {formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings)}
      </span>
      {extra}
    </div>
  );
}
