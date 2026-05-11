interface Props {
  view: 'scanner' | 'checklist';
  onChange: (v: 'scanner' | 'checklist') => void;
  scannerLabel: string;
  checklistLabel: string;
}

export function TopTabs({ view, onChange, scannerLabel, checklistLabel }: Props) {
  return (
    <nav className="top-tabs" role="tablist" aria-label="Section">
      <button
        type="button"
        className={view === 'scanner' ? 'active' : ''}
        aria-pressed={view === 'scanner'}
        onClick={() => onChange('scanner')}
      >
        {scannerLabel}
      </button>
      <button
        type="button"
        className={view === 'checklist' ? 'active' : ''}
        aria-pressed={view === 'checklist'}
        onClick={() => onChange('checklist')}
      >
        {checklistLabel}
      </button>
    </nav>
  );
}
