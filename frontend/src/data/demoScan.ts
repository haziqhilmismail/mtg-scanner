// Demo scan data used by the landing-page <DemoScan> walkthrough.
//
// Captured from a real /api/scan response. To re-capture with a different
// photo:
//   1. Save the photo to frontend/public/demo/sample-scan.jpg
//   2. Make sure its on-disk pixel dimensions match the EXIF-normalised
//      orientation (run it through ImageOps.exif_transpose if needed).
//   3. POST it to /api/scan and copy the response into DEMO_CARDS below
//      (bbox is [x, y, w, h] in pixels of the normalised image).
//   4. Update DEMO_IMAGE_W / DEMO_IMAGE_H to match.

export interface DemoCard {
  id: number;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic' | 'special';
  bbox: { x: number; y: number; w: number; h: number };
  ckRetailUsd: number;
  multiplier: number;
  rmPrice: number;
  foil: boolean;
  /** Hex accent used as a tint behind the placeholder face — ignored when a real photo is shown. */
  accent: string;
}

export const DEMO_IMAGE_W = 1729;
export const DEMO_IMAGE_H = 1729;

export const DEMO_IMAGE_URL = '/demo/sample-scan.jpg';

export const DEMO_CARDS: DemoCard[] = [
  {
    id: 1,
    name: 'Frantic Search',
    setName: 'Commander Masters',
    setCode: 'CMM',
    collectorNumber: '632',
    rarity: 'common',
    bbox: { x: 267, y: 27, w: 597, h: 832 },
    ckRetailUsd: 1.79,
    multiplier: 2.8,
    rmPrice: 6,
    foil: false,
    accent: '#3a6791',
  },
  {
    id: 2,
    name: 'Malakir Rebirth // Malakir Mire',
    setName: 'Zendikar Rising',
    setCode: 'ZNR',
    collectorNumber: '111',
    rarity: 'uncommon',
    bbox: { x: 864, y: 27, w: 597, h: 832 },
    ckRetailUsd: 19.99,
    multiplier: 2.8,
    rmPrice: 56,
    foil: false,
    accent: '#3a2c3f',
  },
  {
    id: 3,
    name: 'Pick Your Poison',
    setName: 'Secrets of Strixhaven Mystical Archive',
    setCode: 'SOA',
    collectorNumber: '55',
    rarity: 'uncommon',
    bbox: { x: 267, y: 874, w: 597, h: 835 },
    ckRetailUsd: 0.35,
    multiplier: 2.8,
    rmPrice: 1,
    foil: false,
    accent: '#3d5d2e',
  },
  {
    id: 4,
    name: 'Etali, Primal Storm',
    setName: 'Time Spiral Remastered',
    setCode: 'TSR',
    collectorNumber: '342',
    rarity: 'special',
    bbox: { x: 864, y: 874, w: 597, h: 835 },
    ckRetailUsd: 1.49,
    multiplier: 2.8,
    rmPrice: 5,
    foil: false,
    accent: '#8a2e1c',
  },
];
