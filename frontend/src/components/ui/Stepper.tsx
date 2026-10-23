import type { ReactNode } from 'react';
import { Icon } from '../Icon.tsx';
import { stepValue } from './stepValue.ts';

interface Common {
  value: number;
  onChange: (value: number) => void;
  label: string;  // names the group: "Quantity", "Multiplier"
  decrementLabel: string;
  incrementLabel: string;
  min?: number;
  max?: number;
  step?: number;  // 1 for quantities, 0.1 for the multiplier
  format?: (value: number) => ReactNode;  // what the middle shows, e.g. v => `×${v.toFixed(1)}`
}

// At `min`, the minus turns into a red trash button that calls onRemove.
export type StepperProps = Common & (
  | { onRemove: () => void; removeLabel: string }
  | { onRemove?: never; removeLabel?: never }
);

export function Stepper({ value, onChange, label, decrementLabel, incrementLabel, min = -Infinity, max = Infinity, step = 1, format = String, onRemove, removeLabel }: StepperProps) {
  const remove = onRemove != null && value <= min;
  return (
    <div role="group" aria-label={label} className="ui-stepper">
      <button
        type="button"
        className={remove ? 'ui-stepper-btn ui-stepper-btn--remove' : 'ui-stepper-btn'}
        aria-label={remove ? removeLabel : decrementLabel}
        disabled={!remove && value <= min}
        onClick={() => (remove ? onRemove() : onChange(stepValue(value, -1, step, min, max)))}
      >
        <Icon name={remove ? 'trash' : 'minus'} size={18} />
      </button>
      <span className="ui-stepper-value" aria-live="polite">{format(value)}</span>
      <button
        type="button"
        className="ui-stepper-btn"
        aria-label={incrementLabel}
        disabled={value >= max}
        onClick={() => onChange(stepValue(value, 1, step, min, max))}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
