import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { Buyer } from '../../api/checklist.ts';
import type { T } from '../../hooks/useLang.ts';

interface Props {
  buyers: Buyer[];
  value: string;
  onChange: (value: string) => void;
  // Fires only when the user explicitly picks an existing buyer (click /
  // Enter on a suggestion). Lets the parent pre-fill the URL/phone fields
  // from the picked buyer's record. Free-typing a new name doesn't trigger
  // this — it just updates `value` via onChange.
  onPick: (buyer: Buyer) => void;
  placeholder?: string;
  required?: boolean;
  // Compact mode: each row shows the buyer name only. Used inside the
  // kanban inline editor where the popover is narrow. Disambiguation
  // between two same-name buyers happens after the pick — URL/phone auto-
  // fill into the surrounding form so the user can see which record they
  // landed on.
  compact?: boolean;
  t: T;
}

/**
 * Buyer-name combobox styled to match SetPicker. Filters in-memory against
 * the existing buyer list (prefix on name, substring fallback), highlights
 * past-orders count, and supports keyboard navigation.
 *
 * Replaces the previous `<input list>` + `<datalist>` combo — Chrome's
 * native datalist UI feels out of place against the custom popovers we use
 * for sets / printings / card names.
 */
export function BuyerNamePicker({
  buyers, value, onChange, onPick, placeholder, required, compact, t,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState(0);
  const listId = useId();
  // Debounce blur so a mousedown on a suggestion fires before the popup hides.
  // useRef instead of raw setTimeout — re-focusing within the window cancels
  // the close, otherwise the popup races shut after onFocus.
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

  // Suggestions: prefix match on name first, then substring. Past buyers
  // with more orders bubble up within each group so frequent customers are
  // surfaced sooner.
  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    const byOrders = (a: Buyer, b: Buyer) =>
      (b.total_orders_count ?? 0) - (a.total_orders_count ?? 0);
    if (!q) return [...buyers].sort(byOrders).slice(0, 12);
    const prefix: Buyer[] = [];
    const substr: Buyer[] = [];
    for (const b of buyers) {
      const name = b.fb_name.toLowerCase();
      if (name.startsWith(q)) prefix.push(b);
      else if (name.includes(q)) substr.push(b);
    }
    prefix.sort(byOrders); substr.sort(byOrders);
    return [...prefix, ...substr].slice(0, 12);
  }, [buyers, value]);

  useEffect(() => { setHover(0); }, [suggestions.length]);

  const pick = (b: Buyer) => {
    onChange(b.fb_name);
    onPick(b);
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
      // Only intercept Enter when there's something to pick. A free-typed
      // new name should still let the parent's form submission run.
      if (suggestions.length > 0) {
        e.preventDefault();
        const picked = suggestions[hover];
        if (picked) pick(picked);
      }
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div className={`buyer-name-picker${compact ? ' compact' : ''}`}>
      <input
        type="text"
        role="combobox"
        aria-expanded={focused && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={openPicker}
        onBlur={closePicker}
        onKeyDown={onKeyDown}
        style={required && !value.trim() ? {
          borderColor: 'var(--warn)',
          boxShadow: '0 0 0 3px rgba(184,68,42,.18)',
        } : undefined}
      />
      {focused && suggestions.length > 0 ? (
        <div className="buyer-name-picker-pop" id={listId} role="listbox">
          {suggestions.map((b, i) => {
            const count = b.total_orders_count ?? 0;
            return (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={i === hover}
                className={`buyer-name-picker-row${i === hover ? ' hover' : ''}`}
                onMouseEnter={() => setHover(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(b); }}
              >
                <span className="name">{b.fb_name}</span>
                {/* Phone + past-orders count only in the wide popup. In the
                    kanban inline editor the popover is narrow, so we trust
                    the post-pick URL/phone auto-fill to confirm which
                    record the user landed on. */}
                {!compact && b.phone ? <span className="phone">{b.phone}</span> : null}
                {!compact ? (
                  <span className="count">
                    {t(count === 1 ? 'ck_buyer_orders_count' : 'ck_buyer_orders_count_plural', { n: count })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
