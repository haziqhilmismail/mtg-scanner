import { useId, type HTMLAttributes, type ReactNode } from 'react';
import type { GroupNamed, NativeName } from './named.ts';

export interface RadioCardOption<V extends string> {
  value: V;
  title: ReactNode;
  description?: ReactNode;
}

// Name the group with aria-labelledby (the section's h2) or aria-label.
export type RadioCardsProps<V extends string> = GroupNamed & Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | NativeName> & {
  value: V;
  onChange: (value: V) => void;
  options: RadioCardOption<V>[];
};

export function RadioCards<V extends string>({ value, onChange, options, className, ...group }: RadioCardsProps<V>) {
  const id = useId();
  return (
    <div role="radiogroup" className={className ? `ui-radio-cards ${className}` : 'ui-radio-cards'} {...group}>
      {options.map((o, i) => (
        <label key={o.value} className="ui-radio-card">
          <input
            type="radio"
            className="ui-radio"
            name={id}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            aria-labelledby={`${id}-${i}`}
            aria-describedby={o.description ? `${id}-${i}-desc` : undefined}
          />
          <span className="ui-radio-card-text">
            <span id={`${id}-${i}`} className="ui-radio-card-title">{o.title}</span>
            {o.description ? <span id={`${id}-${i}-desc`} className="ui-radio-card-desc">{o.description}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}
