// Demo scan data used by the landing-page <DemoScan> walkthrough.
//
// PLACEHOLDER STATE: a stylised 2x2 SVG of fake card silhouettes ships inline
// as a data URL. When you have a real photo + real /api/scan response:
//   1. Save the photo to frontend/public/demo/sample-scan.jpg
//   2. Replace DEMO_IMAGE_URL with '/demo/sample-scan.jpg'
//   3. Update DEMO_IMAGE_W / DEMO_IMAGE_H to the real pixel dimensions
//   4. Replace DEMO_CARDS with the cards array from the real scan response
//      (keep bbox in PIXEL coords matching the new image).

export interface DemoCard {
  id: number;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic';
  bbox: { x: number; y: number; w: number; h: number };
  ckRetailUsd: number;
  multiplier: number;
  rmPrice: number;
  foil: boolean;
  /** Hex accent for the placeholder card face. Swap with image_url later. */
  accent: string;
}

export const DEMO_IMAGE_W = 1000;
export const DEMO_IMAGE_H = 1300;

// Inline 2x2 placeholder. Designed to look like a phone photo of a table of
// cards — wood-toned background, four card-shaped tiles with a colour hint.
// Swap with a real photo when ready.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1300" viewBox="0 0 1000 1300" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3a2c1f"/>
      <stop offset="100%" stop-color="#251a10"/>
    </linearGradient>
    <filter id="grain"><feTurbulence baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0.15  0 0 0 0 0.10  0 0 0 0 0.05  0 0 0 0.18 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <radialGradient id="cardW" cx="0.5" cy="0.35" r="0.85"><stop offset="0%" stop-color="#f6ecd2"/><stop offset="100%" stop-color="#cdb98a"/></radialGradient>
    <radialGradient id="cardU" cx="0.5" cy="0.35" r="0.85"><stop offset="0%" stop-color="#b4d4ea"/><stop offset="100%" stop-color="#3a6791"/></radialGradient>
    <radialGradient id="cardR" cx="0.5" cy="0.35" r="0.85"><stop offset="0%" stop-color="#e8a584"/><stop offset="100%" stop-color="#8a2e1c"/></radialGradient>
    <radialGradient id="cardG" cx="0.5" cy="0.35" r="0.85"><stop offset="0%" stop-color="#bdd3a3"/><stop offset="100%" stop-color="#3d5d2e"/></radialGradient>
  </defs>
  <rect width="1000" height="1300" fill="url(#wood)"/>
  <rect width="1000" height="1300" fill="url(#wood)" filter="url(#grain)" opacity="0.6"/>
  ${renderPlaceholderCard(80, 80, 'url(#cardW)', 'W')}
  ${renderPlaceholderCard(540, 80, 'url(#cardU)', 'U')}
  ${renderPlaceholderCard(80, 690, 'url(#cardR)', 'R')}
  ${renderPlaceholderCard(540, 690, 'url(#cardG)', 'G')}
</svg>`;

function renderPlaceholderCard(x: number, y: number, fill: string, glyph: string): string {
  // No top title-bar rect anymore — keeps the corner clean for the overlay's
  // numbered badge. The big mana glyph + bottom type-line strip are enough to
  // read as "card" while leaving the badge/box readable.
  return `<g transform="translate(${x} ${y})">
    <rect width="380" height="530" rx="22" ry="22" fill="#1c1612" opacity="0.55" transform="translate(8 12)"/>
    <rect width="380" height="530" rx="22" ry="22" fill="${fill}" stroke="#1c1612" stroke-width="6"/>
    <text x="190" y="320" text-anchor="middle" font-family="Fraunces, serif" font-size="160" font-weight="800" fill="#1c1612" opacity="0.55">${glyph}</text>
    <rect x="22" y="470" width="336" height="40" rx="6" ry="6" fill="#1c1612" opacity="0.22"/>
  </g>`;
}

export const DEMO_IMAGE_URL: string =
  'data:image/svg+xml;utf8,' + encodeURIComponent(PLACEHOLDER_SVG);

// Bboxes line up with the placeholder grid above. When swapping in a real
// scan, replace these with the bbox values from the /api/scan response.
export const DEMO_CARDS: DemoCard[] = [
  {
    id: 1,
    name: 'Wrath of God',
    setName: 'Seventh Edition',
    setCode: '7ED',
    collectorNumber: '54',
    rarity: 'rare',
    bbox: { x: 80, y: 80, w: 380, h: 530 },
    ckRetailUsd: 4.99,
    multiplier: 2.8,
    rmPrice: 14,
    foil: false,
    accent: '#cdb98a',
  },
  {
    id: 2,
    name: 'Counterspell',
    setName: 'Masters 25',
    setCode: 'A25',
    collectorNumber: '50',
    rarity: 'common',
    bbox: { x: 540, y: 80, w: 380, h: 530 },
    ckRetailUsd: 1.49,
    multiplier: 2.8,
    rmPrice: 5,
    foil: false,
    accent: '#3a6791',
  },
  {
    id: 3,
    name: 'Lightning Bolt',
    setName: 'Magic 2011',
    setCode: 'M11',
    collectorNumber: '149',
    rarity: 'common',
    bbox: { x: 80, y: 690, w: 380, h: 530 },
    ckRetailUsd: 1.99,
    multiplier: 3.0,
    rmPrice: 7,
    foil: true,
    accent: '#8a2e1c',
  },
  {
    id: 4,
    name: 'Llanowar Elves',
    setName: 'Dominaria',
    setCode: 'DOM',
    collectorNumber: '168',
    rarity: 'common',
    bbox: { x: 540, y: 690, w: 380, h: 530 },
    ckRetailUsd: 0.39,
    multiplier: 2.8,
    rmPrice: 2,
    foil: false,
    accent: '#3d5d2e',
  },
];
