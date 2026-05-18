import { useEffect, useState } from 'react';

// Controlled decimal input synced with a numeric value.
//
// The naive pattern (`value={n}` + `onChange = parseFloat(...)`) breaks the
// moment the user types ".". parseFloat("2.") is 2; the number flows back
// into `value` as "2"; the trailing dot is gone before the next keystroke.
// This hook keeps the raw text local so intermediate strings like "2.",
// "0.", or "" can exist while typing, and only pushes a clean number to
// the owner when the text actually parses.
//
// External updates to `value` (e.g. another input mutating settings) sync
// back into the text only when the current text doesn't already represent
// that number — so an in-progress "2." doesn't get clobbered mid-keystroke.
export function useDecimalInput(
  value: number,
  // null = the box is empty / unparseable. Consumer decides what that means
  // (zero for settings, "use global default" for the per-card multiplier, …).
  onCommit: (v: number | null) => void,
) {
  const [text, setText] = useState<string>(() => String(value));

  useEffect(() => {
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed) && Math.abs(parsed - value) < 1e-9) return;
    setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onChange = (raw: string) => {
    // Allow digits + a single decimal point; drop everything else.
    const cleaned = raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    setText(cleaned);
    if (cleaned === '' || cleaned === '.') {
      onCommit(null);
      return;
    }
    const parsed = parseFloat(cleaned);
    if (Number.isFinite(parsed)) onCommit(parsed);
  };

  return { text, onChange };
}
