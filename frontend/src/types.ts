// API + state types shared across components.

export type RoundingMode =
  | 'none'
  | 'nearest_0.5' | 'up_0.5' | 'down_0.5'
  | 'nearest_1' | 'up_1' | 'down_1';

export type LabelPosition = 'top' | 'bottom' | 'center';
export type FoilStyle = 'gold' | 'suffix';
export type Lang = 'en' | 'ms';
export type Theme = 'light' | 'dark';
export type PriceSource = 'cardkingdom' | 'tcgplayer' | 'none' | 'manual';

export interface Settings {
  multNormal: number;
  multFoil: number;
  currencyLabel: string;
  labelPosition: LabelPosition;
  showOutlines: boolean;
  showCurrency: boolean;
  showCents: boolean;
  rounding: RoundingMode;
  minPrice: number;
  foilStyle: FoilStyle;
}

export const DEFAULT_SETTINGS: Settings = {
  multNormal: 2.8,
  multFoil: 3,
  currencyLabel: 'RM',
  labelPosition: 'center',
  showOutlines: false,
  showCurrency: true,
  showCents: false,
  rounding: 'up_1',
  minPrice: 1,
  foilStyle: 'gold',
};

export interface Candidate {
  scryfall_id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  usd: number;
  usd_foil: number;
  image_url: string;
  scryfall_uri: string;
  price_source_normal: PriceSource;
  price_source_foil: PriceSource;
  ck_url_normal?: string;
  ck_url_foil?: string;
  ck_retail_normal?: number | null;
  ck_retail_foil?: number | null;
  _lookup_failed?: boolean;
  _manual?: boolean;
}

export interface GeminiHint {
  name: string;
  set_code: string;
  collector_number: string;
  is_foil: boolean;
  quantity?: number;  // 1 normally, higher when Gemini detected a stack of N cards
}

export interface DetectedCard {
  id: number;
  bbox: [number, number, number, number]; // [x, y, w, h]
  corners: [number, number][];
  crop_b64: string;
  gemini: GeminiHint;
  candidates: Candidate[];
}

export interface ScanResponse {
  image_id: string;
  image_b64: string;
  width: number;
  height: number;
  cards: DetectedCard[];
}

export interface RelookupMsg {
  type: 'ok' | 'err' | 'busy';
  text: string;
  action?: string;
}

export interface Batch {
  id: string;
  scanId: number | null;          // backend Scan.id once saved — null while scanning
  filename: string;
  status: 'scanning' | 'done' | 'error';
  response: ScanResponse | null;
  error?: string;
  // Per-card parallel arrays, length === response.cards.length when status === 'done'
  isFoil: boolean[];
  priceOverride: (string | null)[];
  quantity: number[];
  multOverride: (number | null)[];
  removed: boolean[];
  relookupBusy: boolean[];
  relookupMsg: (RelookupMsg | null)[];
}

// Computed per-card row data used for rendering
export interface CardRowData {
  card: DetectedCard;
  sel: Candidate;
  origIdx: number;
  removed: boolean;
  isFoil: boolean;
  isManual: boolean;
  needsPrice: boolean;
  usd: number;
  mult: number;
  globalMult: number;
  hasMultOverride: boolean;
  autoPrice: number;
  qty: number;
  unitPrice: number;
  hasOverride: boolean;
  lineTotal: number;
  source: PriceSource;
}
