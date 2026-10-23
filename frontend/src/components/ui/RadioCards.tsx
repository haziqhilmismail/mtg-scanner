import { useId, type HTMLAttributes, type ReactNode } from 'react';

export interface RadioCardOption<V extends string> {
  value: V;
  title: ReactNode;
  description?: ReactNode;  // what the choice does, in one line
}

export interface RadioCardsProps<V extends string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: V;
  onChange: (value: V) => void;
  options: RadioCardOption<V>[];
  // Name the group with aria-labelledby (the section's h2) or aria-label.
}

// A choice with consequences (Price on photo or Live price). Native radios
// inside the cards give the radio semantics, Tab and the arrow keys.
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
