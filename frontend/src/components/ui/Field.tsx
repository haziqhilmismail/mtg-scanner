import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from '../Icon.tsx';
import type { Named, NativeName } from './named.ts';

// The field sets id, aria-invalid and aria-describedby from hint and error.
type Owned = 'className' | 'aria-invalid' | 'aria-describedby' | NativeName;
type FieldProps = Named & {
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;  // on the wrapper, for layout
};

function useField(id: string | undefined, hint: ReactNode, error: ReactNode) {
  const auto = useId();
  const base = id ?? auto;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const control = {
    id: base,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
  };
  return { control, hintId, errorId };
}

function Shell({ label, hint, error, className, ids, children }: { label?: string; hint?: ReactNode; error?: ReactNode; className?: string; ids: ReturnType<typeof useField>; children: ReactNode }) {
  return (
    <div className={className ? `ui-field ${className}` : 'ui-field'}>
      {label ? <label className="ui-label" htmlFor={ids.control.id}>{label}</label> : null}
      {children}
      {hint ? <p id={ids.hintId} className="ui-hint">{hint}</p> : null}
      {error ? <p id={ids.errorId} className="ui-error">{error}</p> : null}
    </div>
  );
}

export type TextFieldProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, Owned | 'prefix' | 'type'> & {
  type?: 'text' | 'search';  // never "number": ask for a keypad with inputMode
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function TextField({ label, hint, error, className, prefix, suffix, id, ...input }: TextFieldProps) {
  const ids = useField(id, hint, error);
  return (
    <Shell label={label} hint={hint} error={error} className={className} ids={ids}>
      <div className={error ? 'ui-input ui-input--invalid' : 'ui-input'}>
        {prefix != null ? <span className="ui-affix">{prefix}</span> : null}
        <input type="text" className="ui-input-el" {...input} {...ids.control} />
        {suffix != null ? <span className="ui-affix">{suffix}</span> : null}
      </div>
    </Shell>
  );
}

export type TextAreaProps = FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, Owned>;

export function TextArea({ label, hint, error, className, id, ...textarea }: TextAreaProps) {
  const ids = useField(id, hint, error);
  return (
    <Shell label={label} hint={hint} error={error} className={className} ids={ids}>
      <textarea className="ui-textarea" {...textarea} {...ids.control} />
    </Shell>
  );
}

export type SelectProps = FieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, Owned>;

export function Select({ label, hint, error, className, id, children, ...select }: SelectProps) {
  const ids = useField(id, hint, error);
  return (
    <Shell label={label} hint={hint} error={error} className={className} ids={ids}>
      <div className={error ? 'ui-select ui-select--invalid' : 'ui-select'}>
        <select {...select} {...ids.control}>{children}</select>
        <Icon name="chevronUpDown" size={14} className="ui-select-icon" />
      </div>
    </Shell>
  );
}
