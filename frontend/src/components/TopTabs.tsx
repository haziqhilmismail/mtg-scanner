import { Icon } from './Icon.tsx';

interface Props {
  view: 'scanner' | 'checklist';
  onChange: (v: 'scanner' | 'checklist') => void;
  scannerLabel: string;
  checklistLabel: string;
}

// Top-level navigation. One element, two placements: a floating tab bar at
// the bottom on compact widths, a segmented control in the top bar on wide
// ones (see .tab-bar in styles.css).
export function TopTabs({ view, onChange, scannerLabel, checklistLabel }: Props) {
  const tabs = [
    { id: 'scanner', label: scannerLabel, icon: 'scan' },
    { id: 'checklist', label: checklistLabel, icon: 'checklist' },
  ] as const;
  return (
    <nav className="tab-bar" aria-label="Section">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          className={view === tab.id ? 'active' : ''}
          aria-current={view === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          <Icon name={tab.icon} size={24} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
