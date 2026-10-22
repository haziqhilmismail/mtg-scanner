// API + state types shared across components.

export type RoundDirection = 'none' | 'up' | 'down' | 'nearest';
export type RoundStep = 0.1 | 0.5 | 1;

export type LabelPosition = 'top' | 'bottom' | 'center';
export type FoilStyle = 'gold' | 'suffix';
export type Lang = 'en' | 'ms';
export type Theme = 'light' | 'dark';
export type Appearance = 'auto' | Theme;
export type PriceSource = 'cardkingdom' | 'none' | 'manual';

export interface Settings {
  multNormal: number;
  multFoil: number;
  currencyLabel: string;
  labelPosition: LabelPosition;
  showOutlines: boolean;
  showCurrency: boolean;
  showCents: boolean;
  // Two-axis rounding: pick direction first, then the step. Direction 'none'
  // disables rounding entirely (step is ignored).
  roundDirection: RoundDirection;
  roundStep: RoundStep;
  minPrice: number;
  foilStyle: FoilStyle;
  // Multiplier on the auto-scaled label font (preview pill + exported PNG).
  // Base font is max(22, min(W,H) × 0.03) — this scales that result.
  labelFontScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  multNormal: 2.8,
  multFoil: 3,
  currencyLabel: 'RM',
  labelPosition: 'center',
  showOutlines: false,
  showCurrency: true,
  showCents: false,
  roundDirection: 'up',
  roundStep: 1,
  minPrice: 1,
  foilStyle: 'gold',
  labelFontScale: 1,
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
  // Which pipeline produced the bbox. Gemini always does the *naming*; the
  // optional classical detector can refine the box when it confidently
  // matches a card-shaped blob (see backend/services/classical_detector.py).
  // 'user' marks a card the user framed by hand in expand mode after the
  // detector merged or missed it.
  bbox_source?: 'classical' | 'gemini' | 'user' | 'detector';
  // Which pipeline NAMED the card. 'gemini' means the cloud model named it;
  // 'title' / 'embedding' come from the local scanner (SCANNER_BACKEND=local):
  // the card's title was read and matched, or only its image was.
  name_source?: 'gemini' | 'title' | 'embedding';
  // Local scanner only: cosine similarity (0..1), higher is better.
  name_confidence?: number | null;
  // Local scanner only. 'ocr' = set + collector number were read off the card,
  // so the printing is pinned. 'embedding' = the collector line was
  // unreadable and the printing is a best visual guess — ask the user.
  version_source?: 'ocr' | 'embedding';
  gemini: GeminiHint;
  candidates: Candidate[];
}

export interface ScanResponse {
  image_id: string;
  // What goes in <img src>: a data: URL straight after a scan, or a
  // /api/scans/{id}/preview URL for scans loaded from the server.
  image_b64: string;
  // Small version of the same picture for the scan strip, when there is one.
  thumb_url?: string;
  width: number;
  height: number;
  cards: DetectedCard[];
}

export interface RelookupMsg {
  type: 'ok' | 'err' | 'busy';
  text: string;
  action?: string;
}

// Per-card draggable pill offset. The pill default position is derived from
// the bbox + the global label-position setting; this offset (in source image
// pixels) is added on top so the user can pull the pill onto the card when
// the detector's bbox drifted. Null means no override (use the default).
export interface PillOffset {
  dx: number;
  dy: number;
}

// A scan's per-card edits, saved on the server as the scan's ui_state so
// every device sees the same prices. Parallel arrays, one entry per card.
export interface ScanUiState {
  isFoil: boolean[];
  priceOverride: (string | null)[];
  quantity: number[];
  multOverride: (number | null)[];
  removed: boolean[];
  pillOffset: (PillOffset | null)[];
  // The seller said an unsure printing guess (see CardRow) is right.
  versionOk: boolean[];
  // A card's new first candidate (another printing, a name search, "use as
  // is") not yet written into the saved scan. The server moves it there and
  // drops it from the saved state.
  picks: (Candidate | null)[];
  // Raised on every save so the server ignores a save that arrives after a
  // newer one. Not a per-card field.
  rev?: number;
}

export interface Batch extends ScanUiState {
  id: string;
  scanId: number | null;          // backend Scan.id once saved — null while scanning
  postId: number | null;          // the post this photo is filed under; null = unfiled
  listed: string[];               // bboxKey of each card on the checklist (added to the post)
  filename: string;
  // The photo picked in this session, kept until it scans so a failed scan
  // can be retried.
  file?: File;
  status: 'scanning' | 'done' | 'error';
  // Set with status 'error' when the server refused the scan for lack of
  // credits, so the UI can say that instead of showing a failure.
  outOfCredits?: boolean;
  response: ScanResponse | null;
  error?: string;
  // Per-card parallel arrays, like ScanUiState's: length ===
  // response.cards.length when status === 'done'
  relookupBusy: boolean[];
  relookupMsg: (RelookupMsg | null)[];
}

// Scan-credit balance, as returned by GET /api/credits and alongside each scan.
export interface Credits {
  enforced: boolean;          // false in solo mode: nothing is limited
  unlimited: boolean;
  limit: number;              // free scans per rolling 30 days
  used: number;               // free scans used in the current window
  bonus: number;              // extra scans from vouchers; don't expire
  remaining: number | null;   // free + extra left; null when unlimited
  next_free_at: string | null; // when the oldest free scan drops out of the window
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
  pillOffset: PillOffset | null;
}
