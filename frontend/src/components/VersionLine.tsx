// A card's printing (DESIGN.md section 4, "Version line"): set code, collector
// number, set name. An unknown number reads "#?".

interface Printing {
  set?: string | null;
  collector_number?: string | null;
  set_name?: string | null;
}

// As text: "MH3 · #123", or with the set name "MH3 · #123 · Modern Horizons 3".
export const printingText = (p: Printing, withName = false) =>
  [`${(p.set || '?').toUpperCase()} · #${p.collector_number || '?'}`, withName ? p.set_name : ''].filter(Boolean).join(' · ');

// As the line under a card's name: a [● CODE #cn] chip, then the set name.
// `none` stands in for the chip when the card has no printing.
export function VersionLine({ p, rarity, none, className }: { p: Printing; rarity?: string; none?: string; className?: string }) {
  return (
    <span className={className ? `version-line ${className}` : 'version-line'}>
      <span className="set-badge">
        {rarity ? <span className={`rarity ${rarity}`} /> : null}
        {p.set ? <>{p.set.toUpperCase()}<span className="cn">#{p.collector_number || '?'}</span></> : none}
      </span>
      {p.set && p.set_name ? <span className="set-name">{p.set_name}</span> : null}
    </span>
  );
}
