import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

export function Checkbox({ label, hint, className, ...input }: CheckboxProps) {
  const id = useId();
  return (
    <label className={className ? `ui-check ${className}` : 'ui-check'}>
      <input
        type="checkbox"
        aria-labelledby={hint ? `${id}-label` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...input}
      />
      <span className="ui-check-text">
        <span id={`${id}-label`} className="ui-check-label">{label}</span>
        {hint ? <span id={`${id}-hint`} className="ui-check-hint">{hint}</span> : null}
      </span>
    </label>
  );
}
