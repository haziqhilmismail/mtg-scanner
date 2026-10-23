import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fetchPrintings } from '../../api.ts';
import type { Candidate } from '../../types.ts';

interface Props {
  cardName: string;             // empty = nothing to fetch; show a hint instead
  // Current displayed text — set name picked, or whatever the user is typing.
  // We don't use this for filtering when the user hasn't typed; it just controls
  // the visible input value.
  value: string;
  onPick: (printing: Candidate) => void;
  onTextChange: (s: string) => void;
  placeholder?: string;
  loadingLabel?: string;
  emptyLabel?: string;          // shown when name has no Scryfall printings
}

// Card-scoped set picker. Loads every printing of `cardName` and lets the
// user pick one — each row shows the printing's actual image so a "wrong set"
// pick is obvious before saving. On pick, downstream forms get the full
// canonical record (set, cn, image_url, scryfall_id, rarity).
export function PrintingPicker({
  cardName, value, onPick, onTextChange,
  placeholder, loadingLabel, emptyLabel,
}: Props) {
  const [printings, setPrintings] = useState<Candidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
    }, 150);
  };
  useEffect(() => () => {
    if (blurTimer.current !== null) clearTimeout(blurTimer.current);
  }, []);

  // Re-fetch whenever the card name changes. We use exact-name search on the
  // backend so typos just yield an empty list — that's the right signal to
  // tell the user "no printings, type a set manually".
  useEffect(() => {
    let alive = true;
    const name = cardName.trim();
    if (!name) {
      setPrintings(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    fetchPrintings(name).then(
      (resp) => {
        if (!alive) return;
        setPrintings(resp.printings);
        setLoading(false);
      },
      (e) => {
        if (!alive) return;
        // 404 is the "no printings" case; the picker handles it as empty.
        if ((e as Error & { status?: number }).status === 404) {
          setPrintings([]);
        } else {
          setErr((e as Error).message);
        }
        setLoading(false);
      },
    );
    return () => { alive = false; };
  }, [cardName]);

  // Filter printings by what's currently in the input. If the input matches
  // the *picked* set name exactly we still show everything so the user can
  // browse the alternatives.
  const suggestions = useMemo(() => {
    if (!printings) return [];
    const q = value.trim().toLowerCase();
    if (!q) return printings.slice(0, 30);
    const matches: Candidate[] = [];
    for (const p of printings) {
      const code = (p.set || '').toLowerCase();
      const setName = (p.set_name || '').toLowerCase();
      const cn = (p.collector_number || '').toLowerCase();
      if (code.includes(q) || setName.includes(q) || cn.includes(q)) {
        matches.push(p);
      }
      if (matches.length >= 30) break;
    }
    return matches;
  }, [printings, value]);

  useEffect(() => { setHover(0); }, [suggestions.length]);

  const pick = (p: Candidate) => {
    onPick(p);
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
    <div className="set-picker printing-picker">
      <input
        type="text"
        role="combobox"
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={cardName.trim() ? placeholder : 'Type a card name above first…'}
        value={value}
        onChange={e => onTextChange(e.target.value)}
        onFocus={openPicker}
        onBlur={closePicker}
        onKeyDown={onKeyDown}
        disabled={!cardName.trim()}
      />
      {focused && cardName.trim() && (
        <div className="set-picker-pop printing-pop" id={listId} role="listbox">
          {loading ? (
            <div className="set-picker-empty">{loadingLabel || 'Loading printings from Scryfall…'}</div>
          ) : err ? (
            <div className="set-picker-empty">{err}</div>
          ) : suggestions.length === 0 ? (
            <div className="set-picker-empty">{emptyLabel || 'No printings on Scryfall — check the card name.'}</div>
          ) : (
            suggestions.map((p, i) => (
              <button
                key={`${p.scryfall_id || p.set + p.collector_number}-${i}`}
                type="button"
                role="option"
                aria-selected={i === hover}
                className={`printing-row${i === hover ? ' hover' : ''}`}
                onMouseEnter={() => setHover(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              >
                {p.image_url ? (
                  <img src={p.image_url} alt="" loading="lazy" className="printing-thumb" />
                ) : (
                  <div className="printing-thumb placeholder">?</div>
                )}
                <div className="printing-info">
                  <div className="line-1">
                    <span className="code">{(p.set || '').toUpperCase()}</span>
                    {p.collector_number ? <span className="cn">#{p.collector_number}</span> : null}
                    {p.rarity ? <span className={`rarity-dot rarity-${p.rarity}`} /> : null}
                  </div>
                  <div className="line-2">{p.set_name}</div>
                </div>
                {p.usd ? <span className="printing-price">${p.usd.toFixed(2)}</span> : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
