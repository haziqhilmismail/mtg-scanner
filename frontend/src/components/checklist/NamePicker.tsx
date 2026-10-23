import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cardNamesApi } from '../../api/checklist.ts';

interface Props {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  loadingLabel?: string;
  errorLabel?: string;
  autoFocus?: boolean;
}

// Scryfall card-name autocomplete styled identically to SetPicker. Filters
// the cached ~30k-name catalog client-side and shows up to 12 suggestions.
// Free-typing is allowed — picker doesn't force the user onto a Scryfall name.
// Catalog fetch is deferred until the user actually types, so the ~30k-name
// list doesn't get pulled on every form mount.
export function NamePicker({ value, onChange, placeholder, loadingLabel, errorLabel, autoFocus }: Props) {
  const [names, setNames] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState(0);
  const listId = useId();
  const query = value.trim();
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

  // Lazy fetch: only pull the catalog once the user has typed something. The
  // request is cached in cardNamesApi so subsequent typings reuse the result.
  useEffect(() => {
    if (!query || names !== null || err) return;
    let alive = true;
    cardNamesApi.list().then(
      n => { if (alive) setNames(n); },
      e => { if (alive) setErr((e as Error).message); },
    );
    return () => { alive = false; };
  }, [query, names, err]);

  // Match strategy: prefix first, substring second, capped at 12 so the
  // popover stays compact. Empty query → no suggestions (catalog not loaded).
  const suggestions = useMemo(() => {
    if (!names) return [];
    const q = query.toLowerCase();
    if (!q) return [];
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const n of names) {
      const lower = n.toLowerCase();
      if (lower.startsWith(q)) prefix.push(n);
      else if (lower.includes(q)) contains.push(n);
      if (prefix.length + contains.length >= 40) break;
    }
    return [...prefix, ...contains].slice(0, 12);
  }, [names, query]);

  useEffect(() => { setHover(0); }, [suggestions.length]);

  const pick = (n: string) => {
    onChange(n);
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
        autoFocus={autoFocus}
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={openPicker}
        onBlur={closePicker}
        onKeyDown={onKeyDown}
      />
      {focused && query.length > 0 && (
        <div className="set-picker-pop" id={listId} role="listbox">
          {names === null && !err ? (
            <div className="set-picker-empty">{loadingLabel || 'Loading card names…'}</div>
          ) : err ? (
            <div className="set-picker-empty">{errorLabel || err}</div>
          ) : suggestions.length === 0 ? (
            <div className="set-picker-empty">— no match — keep typing or leave free-text</div>
          ) : (
            suggestions.map((n, i) => (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={i === hover}
                className={`set-picker-row${i === hover ? ' hover' : ''}`}
                onMouseEnter={() => setHover(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(n); }}
              >
                <span className="name" style={{ flex: 1 }}>{n}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
