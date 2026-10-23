import { useEffect, useId, useRef, useState } from 'react';

const WIDTH = 280;
const EDGE = 8;

// An (i) next to a control: its text shows in a small bubble on hover with a
// mouse, and on tap on a phone (a tap anywhere else or Esc closes it).
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; below: boolean }>({ left: 0, below: false });
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  // Keep the bubble on screen: centred on the (i) where it fits, else pushed
  // in from the edge; under the (i) when there is no room above it.
  const measure = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(WIDTH, window.innerWidth - 2 * EDGE);
    const centre = r.left + r.width / 2;
    const start = Math.min(Math.max(centre - w / 2, EDGE), window.innerWidth - EDGE - w);
    setPlace({ left: start - r.left, below: r.top < 160 });
  };

  return (
    <span className={`info-tip ${open ? 'is-open' : ''}`} ref={ref} onPointerEnter={measure} onFocus={measure}>
      <button
        type="button" className="round-btn info-btn" aria-label={label}
        aria-expanded={open} aria-describedby={id}
        onClick={() => { measure(); setOpen(o => !o); }}
      >i</button>
      <span
        role="tooltip" id={id} className={`info-tip-bubble ${place.below ? 'is-below' : ''}`}
        style={{ left: place.left, width: `min(${WIDTH}px, calc(100vw - ${2 * EDGE}px))` }}
      >{text}</span>
    </span>
  );
}
