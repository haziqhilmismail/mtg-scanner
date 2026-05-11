import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { setsApi, type SetEntry } from '../../api/checklist.ts';

interface Props {
  // What the user typed OR the picked set's name (preferred display)
  value: string;
  onChange: (entry: { code: string | null; name: string | null }) => void;
  placeholder?: string;
  // i18n
  loadingLabel?: string;
  errorLabel?: string;
}

// Combined set code+name picker. Fetches Scryfall's set list once (cached
// at the api layer + 6h server-side cache), filters in-memory, and renders
// suggestions in a popover. Free-typing is allowed — if the user types a
// name that doesn't match anything, we treat it as a literal set_name with
// no code.
export function SetPicker({ value, onChange, placeholder, loadingLabel, errorLabel }: Props) {
  const [sets, setSets] = useState<SetEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState(0);
  const listId = useId();
  // Blur is debounced (so mousedown on a suggestion can fire before the popup
  // hides). If the user re-focuses inside that window, cancel the pending close
  // — otherwise focused=false fires *after* onFocus, locking the popup shut.
  const blurTimer = useRef<number | null>(null);
  const openPicker = () => {
    if (blurTimer.current !== null) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    setFocused(true);
  };
  const closePicker = () => {
    blurTimer.current = window.setTimeout(() => {
      setFocused(false);
      blurTimer.current = null;
    }, 120);
  };
  useEffect(() => () => {
    if (blurTimer.current !== null) clearTimeout(blurTimer.current);
  }, []);

  useEffect(() => {
    let alive = true;
    setsApi.list().then(
      s => { if (alive) setSets(s); },
      e => { if (alive) setErr((e as Error).message); },
    );
    return () => { alive = false; };
  }, []);

  // Suggestions: prefix match on code first, then substring on name. Cap to 12.
  const suggestions = useMemo(() => {
    if (!sets) return [];
    const q = value.trim().toLowerCase();
    if (!q) return sets.slice(0, 12);
    const codeMatch: SetEntry[] = [];
    const nameMatch: SetEntry[] = [];
    for (const s of sets) {
      if (s.code.startsWith(q)) codeMatch.push(s);
      else if (s.name.toLowerCase().includes(q)) nameMatch.push(s);
      if (codeMatch.length + nameMatch.length >= 50) break;
    }
    return [...codeMatch, ...nameMatch].slice(0, 12);
  }, [sets, value]);

  // Reset hover index when the suggestion set changes
  useEffect(() => { setHover(0); }, [suggestions.length]);

  const pick = (s: SetEntry) => {
    onChange({ code: s.code, name: s.name });
    setFocused(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!focused || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHover(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHover(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = suggestions[hover];
      if (picked) pick(picked);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div className="set-picker">
      <input
        type="text"
        role="combobox"
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange({ code: null, name: e.target.value })}
        onFocus={openPicker}
        onBlur={closePicker}
        onKeyDown={onKeyDown}
      />
      {focused && (
        <div className="set-picker-pop" id={listId} role="listbox">
          {sets === null && !err ? (
            <div className="set-picker-empty">{loadingLabel || 'Loading sets…'}</div>
          ) : err ? (
            <div className="set-picker-empty">{errorLabel || err}</div>
          ) : suggestions.length === 0 ? (
            <div className="set-picker-empty">— no match — keep typing or leave free-text</div>
          ) : (
            suggestions.map((s, i) => (
              <button
                key={s.code}
                type="button"
                role="option"
                aria-selected={i === hover}
                className={`set-picker-row${i === hover ? ' hover' : ''}`}
                onMouseEnter={() => setHover(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              >
                <span className="code">{s.code.toUpperCase()}</span>
                <span className="name">{s.name}</span>
                {s.released_at ? <span className="released">{s.released_at}</span> : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
