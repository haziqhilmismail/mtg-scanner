import { useId, type HTMLAttributes, type ReactNode } from 'react';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
}

export interface SegmentedProps<V extends string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: V;
  onChange: (value: V) => void;
  options: SegmentedOption<V>[];
  label?: ReactNode;  // shown above; without one, pass aria-label
}

// Switches a view in place (the Claims filter, Your card | Matched card,
// Appearance). Never navigation, never a choice with consequences: those
// are links and RadioCards. Native radios carry the semantics and keys.
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
