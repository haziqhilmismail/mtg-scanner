// A card's printing (DESIGN.md section 4, "Version line"): set code, collector
// number, set name. An unknown number reads "#?".

import type { Candidate } from '../types.ts';

type Printing = Partial<Pick<Candidate, 'set' | 'collector_number' | 'set_name'>>;

const codeOf = (p: Printing) => (p.set || '?').toUpperCase();
const numberOf = (p: Printing) => `#${p.collector_number || '?'}`;

export const printingText = (p: Printing, withName = false) =>
  [`${codeOf(p)} · ${numberOf(p)}`, withName ? p.set_name : ''].filter(Boolean).join(' · ');

// `none` stands in for the chip when the card has no printing.
export function VersionLine({ p, rarity, none, className }: { p: Printing; rarity?: string; none?: string; className?: string }) {
  return (
    <span className={className ? `version-line ${className}` : 'version-line'}>
      <span className="set-badge">
        {rarity ? <span className={`rarity ${rarity}`} /> : null}
        {p.set ? <>{codeOf(p)}<span className="cn">{numberOf(p)}</span></> : none}
      </span>
      {p.set && p.set_name ? <span className="set-name">{p.set_name}</span> : null}
    </span>
  );
}
