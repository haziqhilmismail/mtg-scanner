// One small line-icon set so every symbol shares a stroke weight and optical
// size, instead of mixing emoji and typographic glyphs. Icons are decorative
// by default (aria-hidden); the control that holds one carries the label.

const PATHS = {
  // viewfinder with a card inside
  scan: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9.5 8.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z',
  checklist: 'M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11.5 7H20M11.5 13H20M11.5 19H20',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.600 12 3Z',
  appearance: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 3v18M12 7.500a4.500 4.500 0 0 1 0 9',
  feedback: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.500 3.500V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  signout: 'M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h9',
  up: 'M12 19V5M6 11l6-6 6 6',
  download: 'M12 4v11M7.500 11l4.500 4.500 4.500-4.500M5 20h14',
  addList: 'M4 7h10M4 12h10M4 17h6M18 14v6M15 17h6',
  trash: 'M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M7 7l.800 11.200A2 2 0 0 0 9.800 20h4.400a2 2 0 0 0 2-1.800L17 7M10.500 11v5M13.500 11v5',
  search: 'M10.500 17a6.500 6.500 0 1 0 0-13 6.500 6.500 0 0 0 0 13ZM20 20l-4.800-4.800',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM5 15V5a1 1 0 0 1 1-1h10',
  pin: 'M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3A4 4 0 0 0 11 18.700l1-1',
  bolt: 'M13 3 5 13.500h6L10 21l8-10.500h-6L13 3Z',
  share: 'M12 15V4M8 7.500l4-4 4 4M6 11H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1',
  photo: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3 16l4.500-4.500 4 4 3-3L21 17M15.500 9.500h.01',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  refresh: 'M19 12a7 7 0 1 1-2.100-5M19 4v4h-4',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  warning: 'M12 4 2.500 20h19L12 4ZM12 10v4.500M12 17.500h.01',
  minus: 'M5 12h14',
  edit: 'M4 20h4l10.500-10.500a2.100 2.100 0 0 0-3-3L5 17v3ZM13.500 7.500l3 3',
  ticket: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8ZM14.500 6v2.500M14.500 11v2M14.500 15.500V18',
  wallet: 'M4 7.500A2.500 2.500 0 0 1 6.500 5H18v3M4 7.500V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.500A2.500 2.500 0 0 1 4 7.500ZM16 13.500h.01',
  lock: 'M8 11V8a4 4 0 0 1 8 0v3M6.500 11h11a1.500 1.500 0 0 1 1.500 1.500v6A1.500 1.500 0 0 1 17.500 20h-11A1.500 1.500 0 0 1 5 18.500v-6A1.500 1.500 0 0 1 6.500 11Z',
  heart: 'M12 20s-7.500-4.500-7.500-10A4.500 4.500 0 0 1 12 7a4.500 4.500 0 0 1 7.500 3c0 5.500-7.500 10-7.500 10Z',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  archive: 'M4 5h16v4H4V5ZM5.500 9v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9M10 13h4',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9ZM7.500 7.500h.01',
  external: 'M7 17 17 7M9 7h8v8',
  swap: 'M7 4 4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0',
} as const;

export type IconName = keyof typeof PATHS;

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 20, className }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 2.6 : 1.8}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
