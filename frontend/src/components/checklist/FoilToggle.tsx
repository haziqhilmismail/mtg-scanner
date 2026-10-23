interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  foilLabel: string;
  nonFoilLabel: string;
  size?: 'sm' | 'md';
}

// Large square toggle replacing the native checkbox. State is visible at a
// glance: gold pill + checkmark when foil is on, plain otherwise.
export function FoilToggle({ value, onChange, foilLabel, nonFoilLabel, size = 'md' }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`foil-toggle${value ? ' on' : ''}${size === 'sm' ? ' sm' : ''}`}
    >
      <span className="indicator">{value ? '✓' : '◯'}</span>
      <span className="text">{value ? foilLabel : nonFoilLabel}</span>
    </button>
  );
}
