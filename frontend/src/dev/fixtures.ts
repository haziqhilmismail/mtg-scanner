// The datasets behind the dev data toggle (break-ui): the worst case a real
// seller can produce, an empty account, one of everything, and many of
// everything. Values come from /tmp/redesign/worst-case.md: made-up people,
// example.com links, fake account numbers. The repo is public.

import type { AuthConfig } from '../api/auth.ts';
import type { Payment } from '../api.ts';
import { DEFAULT_SETTINGS, type Settings } from '../types.ts';
import type { TestData } from './mode.ts';
import {
  addClaim, addPhoto, ago, AVATAR_PICTURE, missing, newFixture, newPost, SAMPLE_CARDS,
  type CardSpec, type ClaimComment, type Fixture, type Photo, type Picture,
} from './store.ts';

// No real account has this id, so per-user localStorage keys stay apart.
const SELLER_ID = 9001;
const CONFIG: AuthConfig = { auth_enabled: true, google_client_id: 'test-data.apps.googleusercontent.com' };
const MODEL = 'yolo11n-obb + dinov3-vits16 + pp-ocr';
const DEFAULT_PRICING: Settings = { ...DEFAULT_SETTINGS, multNormal: 2.5, multFoil: 2.8 };
const LIVE: Settings = { ...DEFAULT_PRICING, priceMode: 'live' };
// Every pricing setting at an unusual value the form still allows.
const ODD_PRICING: Settings = {
  ...DEFAULT_PRICING, multNormal: 2.75, multFoil: 3.25, currencyLabel: 'MYR', showCents: true,
  roundDirection: 'nearest', roundStep: 0.5, minPrice: 0.5, labelFontScale: 1.5, foilStyle: 'gold',
};
const inDays = (days: number) => new Date(Date.now() + days * 86400e3).toISOString();
// Health's cardkingdom_refreshed_at is Unix time in seconds.
const refreshedHoursAgo = (hours: number) => Date.now() / 1000 - hours * 3600;

type Pooled = Pick<CardSpec, 'name' | 'set' | 'setName' | 'number' | 'rarity' | 'usd' | 'usdFoil' | 'crop'>;
const card = (name: string, set: string, setName: string, number: string, rarity: string, usd: number, usdFoil?: number, crop?: string): Pooled =>
  ({ name, set, setName, number, rarity, usd, usdFoil, crop });

// Real cards at plausible Card Kingdom prices, for the photos filled in bulk.
const POOL: Pooled[] = [
  card('Sol Ring', 'LTC', 'Tales of Middle-earth Commander', '284', 'uncommon', 1.49, 3.99),
  card('Arcane Signet', 'CLB', "Commander Legends: Battle for Baldur's Gate", '297', 'common', 0.99, 2.49),
  card('Lord Skitter, Sewer King', 'WOE', 'Wilds of Eldraine', '97', 'rare', 4.99, 4.49),
  card('Kenrith, the Returned King', 'ELD', 'Throne of Eldraine', '303', 'mythic', 1.99, 4.99),
  card('Swords to Plowshares', 'STA', 'Strixhaven Mystical Archive', '10', 'uncommon', 2.99, 5.99),
  card('Lightning Bolt', '2X2', 'Double Masters 2022', '117', 'uncommon', 1.99, 4.49),
  card('Counterspell', 'MH2', 'Modern Horizons 2', '267', 'uncommon', 0.99, 2.99),
  card('Cultivate', 'M21', 'Core Set 2021', '177', 'common', 0.35, 1.49),
  card('Rhystic Study', 'WOT', 'Wilds of Eldraine: Enchanting Tales', '18', 'mythic', 39.99, 49.99),
  card('Smothering Tithe', 'RNA', 'Ravnica Allegiance', '22', 'rare', 24.99, 34.99),
  card('The One Ring', 'LTR', 'The Lord of the Rings: Tales of Middle-earth', '246', 'mythic', 59.99, 79.99),
  card('Esper Sentinel', 'MH2', 'Modern Horizons 2', '12', 'rare', 12.99, 19.99),
  card('Path to Exile', 'CON', 'Conflux', '15', 'uncommon', 2.49, 9.99),
  card('Brainstorm', 'C21', 'Commander 2021', '115', 'common', 0.49, 1.99),
  card('Thought Vessel', 'C21', 'Commander 2021', '260', 'common', 0.79, 1.99),
  card('Llanowar Elves', 'DMU', 'Dominaria United', '168', 'common', 0.25, 0.79),
  card('Birds of Paradise', 'M12', 'Magic 2012', '165', 'rare', 6.99, 24.99),
  card('Swan Song', 'THS', 'Theros', '65', 'rare', 6.99, 24.99),
  card('Victimize', 'TSR', 'Time Spiral Remastered', '139', 'uncommon', 1.49, 2.99, '/demo/claims-victimize.jpg'),
  card('Dark Petition', 'ORI', 'Magic Origins', '90', 'rare', 4.49, 9.99, '/demo/claims-dark-petition.jpg'),
  card('Delay', 'TSR', 'Time Spiral Remastered', '61', 'uncommon', 2.99, 5.49, '/demo/claims-delay.jpg'),
  card('Silundi Vision', 'ZNR', 'Zendikar Rising', '80', 'uncommon', 0.25, 0.99, '/demo/claims-silundi-vision.jpg'),
  card('Slip Out the Back', 'SNC', 'Streets of New Capenna', '62', 'uncommon', 1.99, 3.49, '/demo/claims-slip-out-the-back.jpg'),
  card('The Arkenstone', 'LTC', 'Tales of Middle-earth Commander', '58', 'rare', 3.99, 14.99, '/demo/claims-arkenstone.jpg'),
  card('Mana Crypt', '2XM', 'Double Masters', '270', 'mythic', 199.99, 299.99),
  card('Command Tower', 'C21', 'Commander 2021', '263', 'common', 0.25, 0.99),
];
const pool = (name: string) => POOL.find(c => c.name === name)!;
const poolCards = (start: number, n: number, extra: (i: number) => Partial<CardSpec> = () => ({})): CardSpec[] =>
  Array.from({ length: n }, (_, i) => ({ ...POOL[(start + i) % POOL.length], ...extra(i) }));

const PICTURES: Picture[] = ['landscape', 'portrait', 'square'];
const pad = (n: number) => String(n).padStart(2, '0');
// Phone camera, WhatsApp and pasted names, numbered so they differ.
const fileName = (k: number) => [
  `IMG_20251024_2216${pad(k % 60)}_HDR.jpg`,
  `WhatsApp Image 2026-10-24 at 21.${pad(15 + (k % 40))}.03 (${k}).jpeg`,
  `pasted-2026-10-23T17-${pad(k % 60)}-37.png`,
][k % 3];
const NO_PAYMENT: Payment = { bank_name: '', bank_account_number: '', bank_account_holder: '', payment_note: '', qr_version: null };

// ---------- worst case ----------

const SITI = 'Siti Nur Aisyah Az-Zahra binti Wan Ahmad Fauzi';
const AIMAN = 'Muhammad Aiman Hakim bin Mohd Zulkifli';
const HAFIZ = '  Hafiz   Rahman ';
const LONGEST_NAME = 'Our Market Research Shows That Players Like Really Long Card Names So We Made This Card to Have the Absolute Longest Card Name Ever Elemental';
const LONG_COMMENT = 'Boss nak claim yang ni semua kalau masih ada: Sol Ring x2, Arcane Signet, Lord Skitter, Kenrith, Rhystic Study (yang foil tu), The One Ring, Esper Sentinel, Smothering Tithe, Swords to Plowshares x2, Path to Exile, Counterspell x3, Brainstorm x4 dengan Command Tower. Kalau Mana Crypt tu boleh kurang sikit saya ambil terus. Boleh COD Shah Alam Seksyen 7 hari Sabtu lepas Zohor? Kalau tak boleh, pos pun ok, saya bayar postage. Nanti saya transfer terus lepas boss confirm harga semua sekali, resit saya hantar dalam chat. Terima kasih boss, lama dah cari Rhystic foil ni, akhirnya jumpa jugak!! 🙏🙏';
const WORST_COMMENTS: ClaimComment[] = [
  { buyer: SITI, text: 'Nak Sol Ring 2, PM boss 🙏' },
  { buyer: 'Tan Wei Jie', text: 'Lord Skitter x1 + Kenrith pls, COD Shah Alam ok?' },
  { buyer: 'K', text: 'dibs' },
  { buyer: HAFIZ, text: '' },
  { buyer: AIMAN, text: LONG_COMMENT },
];

// Photo 1 of the worst post: one problem per tile, in the first tiles.
const WORST_PHOTO: CardSpec[] = [
  { name: LONGEST_NAME, set: 'UNH', setName: 'Unhinged', number: '117', rarity: 'common', usd: 0.25, usdFoil: 1.99, unsure: true, confidence: 0.62 },
  { name: 'Asmoranomardicadaistinaculdacar', set: 'MH2', setName: 'Modern Horizons 2', number: '186', rarity: 'rare', usd: 4.99, usdFoil: 7.49, foil: true, inPost: true },
  { name: 'Delver of Secrets // Insectile Aberration', set: 'PLST', setName: 'The List', number: 'DMU-156', rarity: 'common', usd: 0.25, usdFoil: 0.99, qty: 4, price: '15.50', crop: missing('crop.jpg') },
  { name: 'Fire // Ice', set: '40K', setName: 'Warhammer 40,000 Commander', number: '321a', rarity: 'uncommon' },
  { name: "Lim-Dûl's Vault", set: 'CLB', setName: "Commander Legends: Battle for Baldur's Gate", number: '734', rarity: 'uncommon', usd: 0.49, confidence: 0.41 },
  { name: 'Æther Vial', set: 'SLD', setName: 'Secret Lair Drop', number: '★412', rarity: 'special', usdFoil: 1299.99, foil: true, inPost: true },
  { name: 'Ach! Hans, Run!', set: 'UNH', setName: 'Unhinged', number: '116', rarity: 'rare', usd: 4.99, usdFoil: 24.99, removed: true },
  { name: 'Opt', set: 'XLN', setName: 'Ixalan', number: '65', rarity: 'common', usd: 0.01, usdFoil: 0.25, qty: 12 },
  { ...pool('Lord Skitter, Sewer King'), inPost: true },
  { name: 'Sol Ring', set: 'LTR', setName: 'Universes Beyond: The Lord of the Rings: Tales of Middle-earth', number: '1000', rarity: 'uncommon', usd: 1.49, usdFoil: 3.99, qty: 4, inPost: true },
  { ...pool('Kenrith, the Returned King'), inPost: true },
  { name: 'Shivan Dragon', set: 'PLST', setName: 'The List', number: 'M10-154', rarity: '', usd: 0.99, usdFoil: 2.99, matchImage: '' },
  { ...pool('Arcane Signet'), mult: 3.5, inPost: true },
  { ...pool('The One Ring'), inPost: true },
  { ...pool('Rhystic Study'), foil: true },
  pool('Command Tower'),
];

function worst(): Fixture {
  const f = newFixture({
    config: CONFIG,
    me: {
      id: SELLER_ID, email: 'wan.muhammad.amirul.asyraf.wan.ismail@example.com',
      name: 'Wan Muhammad Amirul Asyraf bin Wan Ismail', avatar_url: missing('avatar.jpg'),
      image_token: '', pricing: DEFAULT_PRICING, seller_name: 'Wan Muhammad Amirul Asyraf bin Wan Ismail',
    },
    health: { ok: false, model: MODEL, cardkingdom_error: 'Card Kingdom price list download failed: HTTP 503 Service Unavailable' },
    credits: { enforced: true, unlimited: false, limit: 50, used: 50, bonus: 1284, remaining: 1284, next_free_at: inDays(12) },
    payment: {
      bank_name: 'Bank Kerjasama Rakyat Malaysia Berhad (Bank Rakyat)', bank_account_number: '1234567890123456',
      bank_account_holder: 'WAN MUHAMMAD AMIRUL ASYRAF BIN WAN ISMAIL',
      payment_note: 'Bayar dalam 24 jam ya 🙏 Lepas bayar, hantar resit dengan nama FB anda dekat sini.\nCOD Shah Alam / Subang Jaya (Sabtu & Ahad sahaja). Pos RM8 Semenanjung, RM12 Sabah & Sarawak.\nKad semua dalam sleeve + toploader. Check gambar betul-betul sebelum claim, tiada refund lepas kad sampai. Terima kasih!',
      qr_version: '1793000000000000000',
    },
    comments: WORST_COMMENTS,
  });
  const post = (title: string | null, pricing: Settings | null, hoursAgo: number, status: 'active' | 'archived' = 'active') =>
    newPost(f, { title, pricing, status, created_at: ago(hoursAgo) });
  const big = post('Jumaat malam: Commander staples, foils & bulk rares (part 2 of 3)', null, 27);
  const live = post('22 Oct, 4:11 pm', LIVE, 31);
  const mh3 = post('MH3 🔥 singles', ODD_PRICING, 41);
  const clearance = post('<b>Clearance</b> & 50% off', null, 51);
  const tiny = post('A', null, 81);
  post('Friday Post', null, 100);
  const archived = [post('Friday Post', null, 300, 'archived'), post('19 Oct, 9:02 pm', null, 400, 'archived'), post(null, null, 500, 'archived')];

  // Photos oldest first, so the newest post holds the newest scans and leads the list.
  archived.forEach((p, i) => {
    for (let k = 0; k <= i % 2; k++) addPhoto(f, p, { file: fileName(i * 2 + k), picture: PICTURES[k], cards: poolCards(i * 6 + k, 3, () => ({ inPost: true })), finished: true, hoursAgo: 500 - i * 100 - k });
  });
  const a = addPhoto(f, tiny, { file: 'a.jpg', picture: 'square', cards: [{ ...WORST_PHOTO[7], qty: 1, inPost: true }], hoursAgo: 80 });
  addPhoto(f, null, { file: 'IMG_20251024_221530_HDR (1).jpg', picture: 'portrait', cards: poolCards(2, 1), hoursAgo: 60 });
  addPhoto(f, null, { file: 'pasted-2026-10-23T17-05-37 (1).png', picture: 'strip', cards: poolCards(20, 5), hoursAgo: 59 });
  addPhoto(f, clearance, { file: 'WhatsApp Image 2026-10-24 at 21.15.03.jpeg', picture: 'portrait', cards: [], hoursAgo: 50 });
  addPhoto(f, clearance, { file: 'IMG_20251022_120000.jpg', picture: 'landscape', cards: poolCards(5, 3, () => ({ usd: undefined, usdFoil: undefined })), hoursAgo: 49 });
  addPhoto(f, mh3, { file: 'IMG_20251023_193301.jpg', picture: 'landscape', cards: poolCards(0, 60, i => ({ foil: i % 7 === 0, inPost: i % 4 !== 0 })), hoursAgo: 40 });
  const livePhotos = [6, 9, 4, 12].map((n, k) => addPhoto(f, live, {
    file: fileName(k + 10), picture: (['landscape', 'portrait', 'square', 'landscape'] as const)[k],
    cards: poolCards(8 + k * 4, n, i => ({ inPost: true, qty: i % 4 === 0 ? 3 : 1 })), hoursAgo: 30 - k * 0.2,
  }));

  const counts = [1, 16, 3, 9, 12, 5, 16, 2];
  const photos: Photo[] = [
    addPhoto(f, big, { file: 'IMG_20251024_221530_HDR.jpg', picture: 'landscape', cards: WORST_PHOTO, hoursAgo: 26 }),
    addPhoto(f, big, { file: 'WhatsApp Image 2026-10-24 at 21.15.03 (2).jpeg', picture: 'portrait', cards: poolCards(4, 9), finished: true, hoursAgo: 25.9 }),
    addPhoto(f, big, { file: 'pasted-2026-10-23T17-05-37.png', picture: 'strip', cards: poolCards(13, 16, i => ({ inPost: i < 8, qty: i === 2 ? 4 : 1 })), hoursAgo: 25.8 }),
    addPhoto(f, big, { file: 'a.jpg', picture: 'broken', cards: poolCards(18, 4), hoursAgo: 25.7 }),
    addPhoto(f, big, { file: 'IMG_20251024_221602_HDR.jpg', picture: 'sample', cards: SAMPLE_CARDS.map(c => ({ ...c, inPost: true })), hoursAgo: 25.6 }),
  ];
  for (let k = 5; k < 47; k++) {
    photos.push(addPhoto(f, big, {
      file: fileName(k), picture: PICTURES[k % 3], finished: k % 5 === 0, hoursAgo: 25.5 - k * 0.2,
      cards: poolCards(k * 5, counts[k % 8], i => ({ inPost: k % 3 === 0 || (k % 3 === 1 && i % 2 === 0) })),
    }));
  }

  const [p1, p2, p3, , p5, g0, g1, g2] = photos;
  addClaim(f, {
    buyer: SITI, phone: '+60 12-345 6789', note: WORST_COMMENTS[0].text, hoursAgo: 12,
    lines: [[p1, 9, 2], [p1, 1], [p1, 13], [p2, 0], [p2, 1], [p2, 2], [p2, 3], [p3, 0], [p3, 2, 3], [p3, 3], [p5, 0], [p5, 1], [g0, 0], [g1, 0], [g1, 1]],
  });
  addClaim(f, { buyer: 'Tan Wei Jie', note: WORST_COMMENTS[1].text, paid: true, hoursAgo: 11.5, lines: [[p1, 8], [p1, 10]] });
  addClaim(f, { buyer: 'Tan Wei Jie', paid: true, done: true, archived: true, hoursAgo: 11.4, lines: [[g2, 0]] });
  addClaim(f, { buyer: '陈伟杰', phone: '0123456789', paid: true, done: true, hoursAgo: 11, lines: [[p1, 12]] });
  addClaim(f, { buyer: 'K', note: 'dibs', hoursAgo: 10.5, lines: [[p1, 7]] });
  addClaim(f, { buyer: 'K', cancelled: true, hoursAgo: 10.4, lines: [[p1, 15]] });
  // Handed over before paying.
  addClaim(f, { buyer: 'Kavitha a/p Subramaniam', phone: '+60 11-2345 6789', done: true, hoursAgo: 10, lines: [[p1, 4], [p2, 4], [p2, 5]] });
  addClaim(f, { buyer: AIMAN, note: LONG_COMMENT, paid: true, hoursAgo: 9.5, lines: [[p1, 5], [p3, 4], [p3, 5]] });
  addClaim(f, { buyer: AIMAN, hoursAgo: 9, lines: [[p3, 6]] });
  addClaim(f, { buyer: 'Aina 🌸', paid: true, done: true, hoursAgo: 8.5, lines: [[p1, 14]] });
  addClaim(f, { buyer: HAFIZ, note: '', hoursAgo: 8, lines: [[p5, 2]] });
  addClaim(f, { buyer: 'ahmad_shah.92', paid: true, hoursAgo: 7.5, lines: [[p2, 6], [p2, 7]] });

  addClaim(f, { buyer: SITI, sent: true, hoursAgo: 6, lines: [[livePhotos[0], 0], [livePhotos[1], 2]] });
  addClaim(f, { buyer: 'Aina 🌸', hoursAgo: 5.5, lines: [[livePhotos[0], 1]] });
  addClaim(f, { buyer: 'ahmad_shah.92', sent: true, paid: true, done: true, hoursAgo: 5, lines: [[livePhotos[2], 0], [livePhotos[3], 4, 2]] });
  addClaim(f, { buyer: 'Jo', paid: true, hoursAgo: 79, lines: [[a, 0]] });
  return f;
}

// ---------- one of everything ----------

function one(): Fixture {
  const f = newFixture({
    config: CONFIG,
    me: { id: SELLER_ID, email: 'nurul.huda@example.com', name: 'Nurul Huda', avatar_url: AVATAR_PICTURE, image_token: '', pricing: DEFAULT_PRICING, seller_name: 'Nurul Huda' },
    health: { ok: true, model: MODEL, cardkingdom_cards: 1, cardkingdom_refreshed_at: refreshedHoursAgo(1) },
    credits: { enforced: true, unlimited: false, limit: 50, used: 49, bonus: 0, remaining: 1, next_free_at: inDays(1) },
    payment: { bank_name: 'CIMB', bank_account_number: '1234567890', bank_account_holder: 'NURUL HUDA', payment_note: 'Send the receipt here after paying', qr_version: '1793000000000000001' },
    comments: [{ buyer: 'Tan Wei Jie', text: 'Claim Lord Skitter' }],
  });
  const post = newPost(f, { title: 'Friday Post', pricing: null, created_at: ago(5) });
  const photo = addPhoto(f, post, { file: 'IMG_20251024_221530_HDR.jpg', picture: 'landscape', cards: [{ ...pool('Lord Skitter, Sewer King'), inPost: true }], hoursAgo: 5 });
  addClaim(f, { buyer: 'Tan Wei Jie', phone: '0123456789', note: 'Claim Lord Skitter', hoursAgo: 4, lines: [[photo, 0]] });
  return f;
}

// ---------- many of everything ----------

const THEMES = ['Friday Post', 'Commander staples', 'MH3 🔥 singles', 'Bulk rares RM5 each', 'Foils & bulk rares', 'Precon pulls', 'Sunday clearance'];
const FIRST_NAMES = ['Ahmad', 'Nur', 'Siti', 'Muhammad', 'Lim', 'Tan', 'Wong', 'Kavitha', 'Arun', 'Farah', 'Hafiz', 'Aina', 'Daniel', 'Mei Ling', 'Raj'];
const LAST_NAMES = ['Faiz', 'Izzati', 'Aisyah', 'Hakim', 'Jia Hui', 'Wei Jie', 'Kok Leong', 'Subramaniam', 'Kumar', 'Nabila', 'Rahman', 'Zulkifli'];
const PHONES = ['+60 12-345 6789', undefined, '0123456789', '+60 11-2345 6789'];
// The title the app gives a post made from a drop: its date and time.
const autoTitle = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600e3)
  .toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function many(): Fixture {
  const f = newFixture({
    config: CONFIG,
    me: { id: SELLER_ID, email: 'lim.wei.ming@example.com', name: 'Lim Wei Ming', avatar_url: AVATAR_PICTURE, image_token: '', pricing: DEFAULT_PRICING, seller_name: 'Lim Wei Ming' },
    health: { ok: true, model: MODEL, cardkingdom_cards: 99334, cardkingdom_refreshed_at: refreshedHoursAgo(72) },
    credits: { enforced: true, unlimited: true, limit: 50, used: 12, bonus: 0, remaining: null, next_free_at: inDays(20) },
    // Bank details but no DuitNow QR.
    payment: { ...NO_PAYMENT, bank_name: 'Maybank', bank_account_number: '1234567890', bank_account_holder: 'LIM WEI MING', payment_note: 'Send the receipt here after paying' },
    comments: [
      { buyer: 'Ahmad Faiz', text: 'Claim Sol Ring' },
      { buyer: 'Nur Izzati', text: 'Arcane Signet + Lord Skitter' },
      { buyer: 'Lim Jia Hui', text: 'nak Kenrith' },
    ],
  });
  const posts = Array.from({ length: 120 }, (_, i) => newPost(f, {
    title: i % 2 ? autoTitle(24 * i + 30) : THEMES[(i / 2) % THEMES.length], pricing: i % 6 === 5 ? LIVE : null,
    status: i >= 100 ? 'archived' : 'active', created_at: ago(24 * i + 30),
  }));
  // Photos oldest first, so newer posts hold newer scans.
  for (let i = 119; i >= 1; i--) {
    for (let k = 0; k <= i % 4; k++) {
      addPhoto(f, posts[i], {
        file: fileName(i + k), picture: PICTURES[(i + k) % 3], finished: i % 9 === 0, hoursAgo: 24 * i + 29 - k,
        cards: poolCards(i * 3 + k, 1 + ((i + k) % 9), j => ({ inPost: (i + j) % 3 !== 0 })),
      });
    }
    if (i === 60) for (let k = 0; k < 5; k++) addPhoto(f, null, { file: fileName(200 + k), picture: PICTURES[k % 3], cards: poolCards(k, 2), hoursAgo: 24 * 60 - k });
  }
  // The newest post: 47 photos, the first with 60 cards, and every buyer's claims.
  const big = Array.from({ length: 47 }, (_, k) => addPhoto(f, posts[0], {
    file: fileName(k), picture: PICTURES[k % 3], hoursAgo: 28 - k * 0.2,
    cards: poolCards(k * 7, k === 0 ? 60 : 12, i => ({ foil: (k + i) % 11 === 0, qty: (k + i) % 13 === 0 ? 4 : 1 })),
  }));
  const claimable = big.flatMap(p => p.scan.cards.map((_, i): [Photo, number] => [p, i]));
  for (let b = 0, next = 0; b < 150; b++) {
    const n = 1 + (b % 4);
    addClaim(f, {
      buyer: `${FIRST_NAMES[b % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(b / FIRST_NAMES.length)]}`,
      phone: PHONES[b % PHONES.length], paid: b % 3 > 0, done: b % 3 === 2, hoursAgo: 18 - b * 0.1,
      lines: claimable.slice(next, next += n),
    });
  }
  return f;
}

// ---------- empty ----------

const empty = (): Fixture => newFixture({
  config: CONFIG,
  me: { id: SELLER_ID, email: 'farah@example.com', name: 'Farah', avatar_url: null, image_token: '', pricing: null, seller_name: 'Farah' },
  health: { ok: true, model: MODEL },
  credits: { enforced: true, unlimited: false, limit: 50, used: 0, bonus: 0, remaining: 50, next_free_at: null },
  payment: NO_PAYMENT,
  comments: [],
});

const DATASETS: Record<TestData, () => Fixture> = { worst, empty, one, many };

export const buildFixture = (mode: TestData): Fixture => DATASETS[mode]();
