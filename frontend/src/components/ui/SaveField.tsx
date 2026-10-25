import { useId, useState } from 'react';
import { useT } from '../../hooks/useLang.ts';
import { TextField } from './Field.tsx';

export interface SaveFieldProps {
  saved: string;
  onSave: (value: string) => Promise<boolean>;
  label: string;
  saveLabel: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  inputMode?: 'tel';
  maxLength: number;
  autoComplete: string;
}

// One detail, saved with its own button: nothing saves as you type.
export function SaveField({ saved, onSave, label, saveLabel, placeholder, hint, required, inputMode, maxLength, autoComplete }: SaveFieldProps) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState(saved);
  // A new saved value (the server's, after a save) replaces what is typed.
  const [base, setBase] = useState(saved);
  if (saved !== base) { setBase(saved); setValue(saved); }
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const changed = value.trim() !== saved && !(required && !value.trim());
  return (
    <form
      className="save-field"
      onSubmit={async e => {
        e.preventDefault();
        if (!changed || busy) return;
        setBusy(true);
        const ok = await onSave(value.trim());
        setBusy(false);
        setJustSaved(ok);
      }}
    >
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="ui-label">{label}</label>
      <div className="save-field-row">
        <TextField
          id={`${id}-input`} aria-labelledby={`${id}-label`} inputMode={inputMode} autoComplete={autoComplete} maxLength={maxLength}
          placeholder={placeholder} hint={hint} value={value}
          onChange={e => { setValue(e.target.value); setJustSaved(false); }}
        />
        <button type="submit" className="ui-btn" disabled={!changed || busy}>
          {justSaved && value.trim() === saved ? t('field_saved') : saveLabel}
        </button>
      </div>
    </form>
  );
}
