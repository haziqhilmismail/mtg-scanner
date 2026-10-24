// The store behind the fake backend (backend.ts): one seller's account,
// posts, photos and their cards, stock listings and buyers' claims, each row
// shaped exactly like the backend's response for it. fixtures.ts fills it
// with the helpers here, and the fake backend's writes use the same ones, so
// a claim saved in the browser is made the way the fixtures make theirs.

import type { AuthConfig, MeResponse } from '../api/auth.ts';
import type { Health, Payment, SavedScan } from '../api.ts';
import type { Buyer, Listing, Order, Post, PostStatus } from '../api/checklist.ts';
import { DEMO_CARDS, DEMO_IMAGE_H, DEMO_IMAGE_URL, DEMO_IMAGE_W } from '../data/demoScan.ts';
import { resolvePricing } from '../lib/pricing.ts';
import type { Batch, Candidate, Credits, DetectedCard, ScanUiState, Settings } from '../types.ts';
import { computeCardData, listingFields, lockPrices } from '../utils.ts';

export interface ClaimComment { buyer: string; text: string }

export interface Fixture {
  config: AuthConfig;
  me: MeResponse;
  health: Health;
  credits: Credits;
  payment: Payment;
  posts: Post[];
  scans: SavedScan[];
  listings: Listing[];
  orders: Order[];
  buyers: Buyer[];
  // The picture behind each image route the app builds with imageUrl(), such
  // as /api/scans/700001/preview or /api/payment/qr.
  images: Map<string, string>;
  // The comment thread the Claims intake "reads" from any screenshot.
  comments: ClaimComment[];
}

// The server's timestamps: UTC, to the second, without a zone.
export const ago = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString().slice(0, 19);

// A path under /api/ that no backend route matches, so the server answers
// 404: the broken pictures of the worst case.
export const missing = (what: string) => `/api/no-such-image/${what}`;

// The picture for an image route (imageUrl's path); a broken one if none.
export const pictureAt = (f: Fixture, path: string) => f.images.get(path) ?? missing('unknown.jpg');

const nextId = (rows: Array<{ id: number }>, first = 1) => Math.max(first - 1, ...rows.map(r => r.id)) + 1;

// Scan ids start high, so they never match a real scan's id in this
// browser's localStorage, where saved edits and delete tombstones are keyed by it.
const FIRST_SCAN_ID = 700001;

export function newFixture(account: Pick<Fixture, 'config' | 'me' | 'health' | 'credits' | 'payment' | 'comments'>): Fixture {
  return {
    ...account, posts: [], scans: [], listings: [], orders: [], buyers: [],
    images: new Map([['/api/payment/qr', QR_PICTURE]]),
  };
}

// ---------- pictures ----------

const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;

const hueOf = (name: string) => [...name].reduce((h, ch) => (h * 31 + ch.codePointAt(0)!) % 360, 7);

// A card drawn in a 63 x 88 box: a frame in the card's colour, art, text box.
const face = (hue: number) =>
  `<rect width="63" height="88" rx="3" fill="hsl(${hue} 30% 22%)"/><rect x="4" y="9" width="55" height="40" fill="hsl(${hue} 45% 55%)"/><rect x="4" y="53" width="55" height="29" fill="hsl(${hue} 20% 86%)"/>`;

export const drawnCard = (name: string) => svg(63, 88, face(hueOf(name)));

type Box = [number, number, number, number];

// The photo as drawn: a table with each card where the scanner found it.
const drawnPhoto = (w: number, h: number, boxes: Box[], names: string[]) => svg(w, h,
  `<rect width="${w}" height="${h}" fill="#d8d3c8"/>${boxes.map(([x, y, bw, bh], i) =>
    `<g transform="translate(${x} ${y}) scale(${bw / 63} ${bh / 88})">${face(hueOf(names[i]))}</g>`).join('')}`);

// Looks like a QR code, but its modules are random: it scans as nothing.
const QR_PICTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAK4AAACuAQAAAACHdwtDAAABJ0lEQVR42u2XMU4FMQxEX/BKlN4b/KNkb4a4WfYo3MApv2Q0FNn/KaB3AW6iuLLG4/G4iV/i84Vf42+kUQBYAB1fCPWsKbBLAizOnIdJijKoWjtw3W/CB7NtxU07N87XKOTJdr3zTXDfo7YSwcbJ3OHAxSydHUmBqXB20CNMWnMkqaaS6NKw6EnP9Y0qTIZJ6QISkp6uqu4kWFxo4FXdeWEepnG/La6ezFa3d3q6LFCQkD4o686QBj5w4Up6XSWy6LjwAeAjq3bxbPi7fRwXPsFWxxPoT6VdRqVSYwOTLomr4slz7yy/JBVp7MOzzbbNIyGh7bWebdz3E1fbCx11h25SrimGIp58p7d5WHR8vEYZJkvckr6+VuUKvu8dLrWv0ZP2f43+iC9QJ+l7pk0N4wAAAABJRU5ErkJggg==';

export const AVATAR_PICTURE = svg(96, 96, '<rect width="96" height="96" fill="hsl(200 45% 45%)"/><circle cx="48" cy="38" r="17" fill="hsl(200 30% 85%)"/><ellipse cx="48" cy="92" rx="32" ry="26" fill="hsl(200 30% 85%)"/>');

export type Picture = 'landscape' | 'portrait' | 'square' | 'strip' | 'sample' | 'broken';
const SIZES: Record<Exclude<Picture, 'sample'>, [number, number]> = {
  landscape: [2000, 1500], portrait: [1500, 2000], square: [1600, 1600], strip: [4000, 1000], broken: [2000, 1500],
};

// n card-shaped boxes in the rows-by-columns grid that leaves them biggest.
function layout(n: number, w: number, h: number): Box[] {
  let best = { cols: 1, rows: 1, ch: 0 };
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    const ch = Math.min(h / rows, (w / cols) * 88 / 63) * 0.88;
    if (ch > best.ch) best = { cols, rows, ch };
  }
  const { cols, rows, ch } = best, cw = ch * 63 / 88;
  return Array.from({ length: n }, (_, i) => [
    Math.round((i % cols) * (w / cols) + (w / cols - cw) / 2),
    Math.round(Math.floor(i / cols) * (h / rows) + (h / rows - ch) / 2),
    Math.round(cw), Math.round(ch),
  ]);
}

// ---------- posts ----------

export function newPost(f: Fixture, fields: { title: string | null; pricing: Settings | null; status?: PostStatus; created_at?: string }): Post {
  const at = fields.created_at ?? ago(0);
  const post: Post = {
    id: nextId(f.posts), user_id: f.me.id, title: fields.title, fb_url: null, note: null,
    status: fields.status ?? 'active', image_path: null, image_mime: null, created_at: at, updated_at: at,
    listing_count: 0, active_listing_count: 0, total_qty: 0, total_value_myr: '0.00', has_image: false,
    pricing: fields.pricing,
  };
  f.posts.push(post);
  return post;
}

// ---------- photos and cards ----------

export interface CardSpec {
  name: string;
  set: string;            // upper case, as Scryfall's code comes back
  setName: string;
  number: string;
  rarity: string;         // '' when Scryfall gave none
  usd?: number;           // Card Kingdom's price per finish; absent: CK has none
  usdFoil?: number;
  foil?: boolean;
  qty?: number;
  price?: string;         // the seller's own RM price, as typed
  mult?: number;          // the card's own multiplier
  removed?: boolean;
  unsure?: boolean;       // the scanner could not read the printing: "check" bar
  confidence?: number;    // how sure the scanner is of the name, 0..1
  inPost?: boolean;       // on the post's stock list
  crop?: string;          // the card cut from the photo; default: a drawn card
  matchImage?: string;    // Scryfall's picture of the match; default: the crop
}

function candidate(c: CardSpec, image: string): Candidate {
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ck = (usd: number | undefined, foil: string) => (usd != null ? `https://example.com/ck/${slug}${foil}` : undefined);
  return {
    scryfall_id: `test-${c.set.toLowerCase()}-${c.number}`,
    name: c.name, set: c.set, set_name: c.setName, collector_number: c.number, rarity: c.rarity,
    usd: c.usd ?? 0, usd_foil: c.usdFoil ?? 0,
    image_url: image,
    scryfall_uri: `https://example.com/scryfall/${c.set.toLowerCase()}/${c.number}`,
    price_source_normal: c.usd != null ? 'cardkingdom' : 'none',
    price_source_foil: c.usdFoil != null ? 'cardkingdom' : 'none',
    ck_url_normal: ck(c.usd, ''), ck_url_foil: ck(c.usdFoil, '-foil'),
    ck_retail_normal: c.usd ?? null, ck_retail_foil: c.usdFoil ?? null,
  };
}

function detected(c: CardSpec, id: number, bbox: Box, crop: string): DetectedCard {
  const [x, y, w, h] = bbox;
  const confidence = c.confidence ?? 0.93;
  return {
    id, bbox, corners: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], crop_b64: '',
    bbox_source: 'detector', name_source: confidence < 0.6 ? 'embedding' : 'title', name_confidence: confidence,
    version_source: c.unsure ? 'embedding' : 'ocr',
    gemini: { name: c.name, set_code: c.set.toLowerCase(), collector_number: c.number, is_foil: !!c.foil, quantity: c.qty ?? 1 },
    candidates: [candidate(c, c.matchImage ?? crop)],
  };
}

// The four cards really in /demo/sample-scan.jpg (CK lists them non-foil only).
export const SAMPLE_CARDS: CardSpec[] = DEMO_CARDS.map(d => ({
  name: d.name, set: d.setCode, setName: d.setName, number: d.collectorNumber, rarity: d.rarity, usd: d.ckRetailUsd,
}));

// A saved photo and the per-card edits saved with it (its ui_state when edited).
export interface Photo { scan: SavedScan; state: ScanUiState }

export interface PhotoSpec {
  file: string;
  picture: Picture;
  cards: CardSpec[];
  finished?: boolean;     // prices locked, as after Finish
  hoursAgo: number;
}

const pricingOf = (f: Fixture, postId: number | null | undefined) =>
  resolvePricing(postId != null ? f.posts.find(p => p.id === postId)?.pricing : null, f.me.pricing);

// Each card's price as the app works it out: the app's own computeCardData.
function cardPrices(f: Fixture, { scan, state }: Photo) {
  const batch: Batch = {
    ...state, id: `s${scan.scan_id}`, scanId: scan.scan_id, postId: scan.post_id ?? null,
    position: scan.position ?? null, listed: [], filename: scan.filename, status: 'done',
    response: { image_id: scan.image_id, image_b64: '', width: scan.width, height: scan.height, cards: scan.cards },
    relookupBusy: [], relookupMsg: [],
  };
  return computeCardData(batch, pricingOf(f, scan.post_id));
}

export function addPhoto(f: Fixture, post: Post | null, spec: PhotoSpec): Photo {
  const id = nextId(f.scans.map(s => ({ id: s.scan_id })), FIRST_SCAN_ID);
  const sample = spec.picture === 'sample';
  const [w, h] = spec.picture === 'sample' ? [DEMO_IMAGE_W, DEMO_IMAGE_H] : SIZES[spec.picture];
  // The sample photo's own cards where they are in it, while there are enough.
  const boxes = sample && spec.cards.length <= DEMO_CARDS.length
    ? DEMO_CARDS.map((d): Box => [d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h])
    : layout(spec.cards.length, w, h);
  const crops = spec.cards.map(c => c.crop ?? drawnCard(c.name));
  const names = spec.cards.map(c => c.name);
  f.images.set(`/api/scans/${id}/preview`, sample ? DEMO_IMAGE_URL
    : spec.picture === 'broken' ? missing('preview.jpg') : drawnPhoto(w, h, boxes, names));
  crops.forEach((crop, i) => f.images.set(`/api/scans/${id}/crops/${i}`, crop));

  const cards = spec.cards;
  const state: ScanUiState = {
    isFoil: cards.map(c => !!c.foil),
    priceOverride: cards.map(c => c.price ?? null),
    quantity: cards.map(c => c.qty ?? 1),
    multOverride: cards.map(c => c.mult ?? null),
    removed: cards.map(c => !!c.removed),
    pillOffset: cards.map(() => null),
    versionOk: cards.map(() => false),
    picks: cards.map(() => null),
    locked: cards.map(() => null),
    lockedAt: null,
    rev: 1,
  };
  const edited = spec.finished || cards.some(c => c.price != null || c.mult != null || c.removed);
  const scan: SavedScan = {
    image_id: String(id), scan_id: id, post_id: post?.id ?? null,
    position: post ? f.scans.filter(s => s.post_id === post.id).length : null,
    filename: spec.file, image_b64: '', width: w, height: h,
    cards: cards.map((c, i) => detected(c, i, boxes[i], crops[i])),
    created_at: ago(spec.hoursAgo),
    // A photo nobody edited has none: the app starts it from the scan.
    ui_state: edited ? state : null,
  };
  f.scans.push(scan);
  const photo = { scan, state };
  if (spec.finished) {
    state.locked = lockPrices(cardPrices(f, photo));
    state.lockedAt = new Date(Date.now() - spec.hoursAgo * 3600e3 + 600e3).toISOString();
  }
  // Finishing a photo puts every card kept on it into the post.
  cards.forEach((c, i) => { if (!c.removed && (c.inPost || spec.finished)) listingFor(f, photo, i); });
  return photo;
}

// ---------- stock and claims ----------

export function newListing(f: Fixture, fields: Omit<Listing, 'id' | 'user_id' | 'status' | 'notes' | 'created_at' | 'updated_at'>): Listing {
  const at = ago(0);
  const listing: Listing = { ...fields, id: nextId(f.listings), user_id: f.me.id, status: 'active', notes: null, created_at: at, updated_at: at };
  f.listings.push(listing);
  return listing;
}

// The stock listing behind a scanned card, made the first time the card is
// added to its post or claimed; null for a card with no price yet.
function listingFor(f: Fixture, photo: Photo, i: number): Listing | null {
  const { scan } = photo;
  const card = scan.cards[i];
  const found = f.listings.find(l => l.scan_id === scan.scan_id && l.bbox?.join() === card.bbox.join());
  if (found) return found;
  const cd = cardPrices(f, photo)[i];
  if (!(cd.unitPrice > 0)) return null;
  return newListing(f, { ...listingFields(cd), scan_id: scan.scan_id, bbox: card.bbox, post_ids: scan.post_id != null ? [scan.post_id] : [] });
}

// A buyer is known by their Facebook name, whatever its case (as on the server).
export function buyerFor(f: Fixture, name: string, phone: string | null = null): Buyer {
  const found = f.buyers.find(b => b.fb_name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const at = ago(0);
  const buyer: Buyer = {
    id: nextId(f.buyers), user_id: f.me.id, fb_name: name, fb_url: null, phone,
    default_dropoff_method: null, default_dropoff_address: null, notes: null, created_at: at, updated_at: at,
  };
  f.buyers.push(buyer);
  return buyer;
}

export function newOrder(
  f: Fixture, buyer: Buyer, lines: Array<{ listing: Listing; qty: number; unit: number }>, fields: Partial<Order> = {},
): Order {
  const id = nextId(f.orders);
  const at = fields.created_at ?? ago(0);
  let itemId = nextId(f.orders.flatMap(o => o.items)) - 1;
  const items = lines.map(({ listing, qty, unit }) => ({
    id: ++itemId, order_id: id, listing_id: listing.id, qty,
    unit_price_myr: unit.toFixed(2), line_total_myr: (unit * qty).toFixed(2),
    name_snapshot: listing.name, set_snapshot: listing.set_code, created_at: at,
  }));
  const order: Order = {
    id, user_id: f.me.id, buyer_id: buyer.id, status: 'claimed', paid_at: null, delivered_at: null,
    archived_at: null, prices_sent_at: null,
    total_myr: items.reduce((sum, i) => sum + Number(i.line_total_myr), 0).toFixed(2),
    dropoff_method: null, dropoff_address: null, notes: null, has_delivery_photo: false,
    delivery_photo_uploaded_at: null, items, created_at: at, updated_at: at, ...fields,
  };
  f.orders.push(order);
  return order;
}

export interface ClaimSpec {
  buyer: string;
  phone?: string;
  lines: Array<[photo: Photo, card: number, qty?: number]>;
  paid?: boolean;
  done?: boolean;         // handed over
  sent?: boolean;         // live post: the buyer was sent their prices
  archived?: boolean;
  cancelled?: boolean;
  note?: string;
  hoursAgo: number;
}

// One comment's claim: an order for the buyer with a line per card.
export function addClaim(f: Fixture, spec: ClaimSpec): Order {
  const at = ago(spec.hoursAgo), later = ago(spec.hoursAgo - 1);
  const lines = spec.lines.map(([photo, i, qty = 1]) => {
    const listing = listingFor(f, photo, i);
    if (!listing) throw new Error(`test data: ${photo.scan.filename} card ${i} has no price, so it can't be claimed`);
    return { listing, qty, unit: Number(listing.unit_price_myr) };
  });
  return newOrder(f, buyerFor(f, spec.buyer, spec.phone), lines, {
    status: spec.cancelled ? 'cancelled' : 'claimed',
    paid_at: spec.paid ? later : null,
    delivered_at: spec.done ? later : null,
    prices_sent_at: spec.sent ? later : null,
    archived_at: spec.archived ? later : null,
    notes: spec.note ?? null,
    created_at: at, updated_at: at,
  });
}
