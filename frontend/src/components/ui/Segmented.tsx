import { useId, type HTMLAttributes, type ReactNode } from 'react';
import type { Named, NativeName } from './named.ts';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
}

// `label` is shown above the control.
export type SegmentedProps<V extends string> = Named & Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | NativeName> & {
  value: V;
  onChange: (value: V) => void;
  options: SegmentedOption<V>[];
};

export function Segmented<V extends string>({ value, onChange, options, label, className, ...group }: SegmentedProps<V>) {
  const id = useId();
  const control = (
    <div
      role="radiogroup"
      className={className ? `ui-seg ${className}` : 'ui-seg'}
      aria-labelledby={label ? `${id}-label` : undefined}
      {...group}
    >
      {options.map(o => (
        <label key={o.value} className="ui-seg-opt">
          <input type="radio" className="ui-seg-input" name={id} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
  if (!label) return control;
  return (
    <div className="ui-field">
      <span id={`${id}-label`} className="ui-label">{label}</span>
      {control}
    </div>
  );
}
