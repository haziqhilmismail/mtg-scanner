// A stand-in for the FastAPI backend that answers from a Fixture in memory:
// reads come from it, writes change it (so the next read agrees), and nothing
// goes over the network. It has a route for every call the app's pages make,
// returning what the real one does (backend/app/routers/, main.py); any other
// call answers 404 (a read) or 204 (a write) and warns in the console.

import type { CataloguePhoto, ConfirmClaim, Payment, SavedScan } from '../api.ts';
import type { Buyer, BuyerCreatePayload, Listing, ListingCreatePayload, Order, Post, PostUpdatePayload } from '../api/checklist.ts';
import type { Candidate, DetectedCard, ScanUiState, Settings } from '../types.ts';
import {
  addPhoto, ago, buyerFor, drawnCard, newListing, newOrder, newPost, pictureAt, SAMPLE_CARDS, type Fixture,
} from './store.ts';

type Params = Record<string, string>;
type Handler = (c: { params: Params; req: Request; url: URL }) => Response | Promise<Response>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });
const file = (bytes: BlobPart, type: string) => new Response(new Blob([bytes], { type }), { headers: { 'content-type': type } });
const notFound = (detail: string) => json({ detail }, 404);
// The slow routes take about as long as the real ones, so their busy states show.
const slow = () => new Promise(r => setTimeout(r, 1500));
const flag = (url: URL, name: string) => ['1', 'true'].includes(url.searchParams.get(name) ?? '');
const route = (pattern: string) => new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
// A multipart field the client sends as a JSON string.
const formJson = async (req: Request, field: string) => JSON.parse(String((await req.formData()).get(field) ?? '{}'));

// A 1x1 PNG, a zip with nothing in it, and a blank A4 page: the shapes of the
// rendered photo, the photo zip and the slips PDF.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mM4ceIEAAS0Alko01LsAAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
const EMPTY_ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
const BLANK_PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

// The printings offered for any name: the long set names of the worst case.
const PRINTINGS = [
  ['LTR', 'Universes Beyond: The Lord of the Rings: Tales of Middle-earth', '1000', 'mythic', 4.99, 9.99],
  ['CLB', "Commander Legends: Battle for Baldur's Gate", '734', 'uncommon', 0.25, 0.99],
  ['40K', 'Warhammer 40,000 Commander', '321a', 'rare', 1.49, 3.49],
  ['PLST', 'The List', 'DMU-156', 'common', 0.25, 0],
] as const;

export function fakeBackend(f: Fixture): (req: Request) => Promise<Response> {
  const find = <T extends { id: number }>(rows: T[], id: string) => rows.find(r => r.id === Number(id));
  const scanOf = (id: string) => f.scans.find(s => s.scan_id === Number(id));
  const committed = (listingId: number) => f.orders
    .filter(o => o.status !== 'cancelled')
    .flatMap(o => o.items).filter(i => i.listing_id === listingId).reduce((n, i) => n + i.qty, 0);

  // The counts the server works out when it lists rows.
  const postRead = (p: Post): Post => {
    const ls = f.listings.filter(l => l.post_ids.includes(p.id));
    return {
      ...p, listing_count: ls.length, active_listing_count: ls.filter(l => l.status === 'active').length,
      total_qty: ls.reduce((n, l) => n + l.qty_total, 0),
      total_value_myr: ls.reduce((n, l) => n + l.qty_total * Number(l.unit_price_myr), 0).toFixed(2),
    };
  };
  const listingRead = (l: Listing): Listing => ({ ...l, qty_committed: committed(l.id), qty_available: Math.max(0, l.qty_total - committed(l.id)) });
  const buyerRead = (b: Buyer): Buyer => {
    const os = f.orders.filter(o => o.buyer_id === b.id);
    return { ...b, total_orders_count: os.length, open_orders_count: os.filter(o => o.status !== 'cancelled' && !(o.paid_at && o.delivered_at)).length };
  };
  // A scan as GET /api/scans sends it: `lite` leaves the pictures out (the
  // client then asks the image routes, which imageUrl() points at fixture
  // pictures); without it they come embedded, as from relookup-prices.
  const scanRead = (s: SavedScan, lite: boolean): SavedScan => ({
    ...s,
    image_b64: lite ? '' : pictureAt(f, `/api/scans/${s.scan_id}/preview`),
    cards: lite ? s.cards : s.cards.map(c => ({ ...c, crop_b64: pictureAt(f, `/api/scans/${s.scan_id}/crops/${c.id}`) })),
    listed: f.listings.flatMap(l => (l.scan_id === s.scan_id && l.bbox && l.status !== 'archived' ? [l.bbox] : [])),
  });
  const touch = <T extends { updated_at: string }>(row: T, changes: NoInfer<Partial<T>>) => Object.assign(row, changes, { updated_at: ago(0) });
  const allCandidates = () => f.scans.flatMap(s => s.cards.map(c => c.candidates[0]));
  const blankCandidate = (name: string, set = ''): Candidate => ({
    scryfall_id: '', name, set, set_name: '', collector_number: '', rarity: '', usd: 0, usd_foil: 0,
    image_url: '', scryfall_uri: '', price_source_normal: 'none', price_source_foil: 'none',
  });

  const routes: Array<[method: string, path: RegExp, handle: Handler]> = [
    ['GET', route('/api/auth/config'), () => json(f.config)],
    ['GET', route('/api/auth/me'), () => json(f.me)],
    ['PUT', route('/api/auth/me/pricing'), async ({ req }) => {
      const { pricing }: { pricing: Settings } = await req.json();
      f.me.pricing = pricing;
      return noContent();
    }],
    ['GET', route('/api/health'), () => json(f.health)],
    ['GET', route('/api/credits'), () => json(f.credits)],
    ['POST', route('/api/vouchers/redeem'), () => {
      f.credits = { ...f.credits, bonus: f.credits.bonus + 20, remaining: f.credits.unlimited ? null : (f.credits.remaining ?? 0) + 20 };
      return json({ granted: { credits: 20, unlimited: false, unlimited_days: null, reset: false }, credits: f.credits });
    }],
    ['POST', route('/api/bug'), () => json({ id: 1 }, 202)],

    ['GET', route('/api/payment'), () => json(f.payment)],
    ['PUT', route('/api/payment'), async ({ req }) => {
      const body: Omit<Payment, 'qr_version'> = await req.json();
      for (const k of ['bank_name', 'bank_account_number', 'bank_account_holder', 'payment_note'] as const) f.payment[k] = body[k].trim();
      return json(f.payment);
    }],
    ['PUT', route('/api/payment/qr'), async ({ req }) => {
      const image = (await req.formData()).get('image');
      if (image instanceof Blob) f.images.set('/api/payment/qr', URL.createObjectURL(image));
      f.payment.qr_version = String(Date.now());
      return json(f.payment);
    }],
    ['DELETE', route('/api/payment/qr'), () => { f.payment.qr_version = null; return json(f.payment); }],

    ['GET', route('/api/posts'), ({ url }) => json(f.posts
      .filter(p => flag(url, 'include_archived') || p.status !== 'archived')
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(postRead))],
    ['POST', route('/api/posts'), async ({ req }) => {
      const form = await req.formData();
      const title = String(form.get('title') ?? '').trim() || null;
      const pricing = form.get('pricing');
      return json(postRead(newPost(f, { title, pricing: typeof pricing === 'string' ? JSON.parse(pricing) : null })), 201);
    }],
    ['PATCH', route('/api/posts/:id'), async ({ params: { id }, req }) => {
      const post = find(f.posts, id);
      if (!post) return notFound('Post not found');
      const body: PostUpdatePayload = await req.json();
      // Text fields: blank becomes null, as the server stores it.
      for (const k of ['title', 'fb_url', 'note'] as const) if (k in body) body[k] = body[k]?.trim() || null;
      return json(postRead(touch(post, body)));
    }],
    ['DELETE', route('/api/posts/:id'), ({ params: { id } }) => {
      f.posts = f.posts.filter(p => p.id !== Number(id));
      f.scans.forEach(s => { if (s.post_id === Number(id)) s.post_id = null; });
      return noContent();
    }],

    ['GET', route('/api/scans'), ({ url }) => {
      const before = Number(url.searchParams.get('before') ?? Infinity);
      const limit = Number(url.searchParams.get('limit') ?? 30);
      return json(f.scans.filter(s => s.scan_id < before).sort((a, b) => b.scan_id - a.scan_id).slice(0, limit).map(s => scanRead(s, flag(url, 'lite'))));
    }],
    ['POST', route('/api/scan'), async ({ req }) => {
      await slow();
      const form = await req.formData();
      const image = form.get('image');
      // Whatever the photo, the scan finds the sample photo's four cards.
      const { scan } = addPhoto(f, find(f.posts, String(form.get('post_id'))) ?? null, {
        file: image instanceof File ? image.name : 'upload.jpg', picture: 'sample', cards: SAMPLE_CARDS, hoursAgo: 0,
      });
      const { listed: _, ...response } = scanRead(scan, false);
      return json({ ...response, credits: f.credits });
    }],
    ['PATCH', route('/api/scans/:id/state'), async ({ params: { id }, req }) => {
      const scan = scanOf(id);
      if (!scan) return notFound('Scan not found');
      const { state: { picks, ...state } }: { state: ScanUiState } = await req.json();
      // A picked printing replaces the card's first candidate, as on the server.
      picks.forEach((pick, i) => { if (pick && scan.cards[i]) scan.cards[i].candidates = [pick, ...scan.cards[i].candidates.slice(1)]; });
      scan.ui_state = state;
      return noContent();
    }],
    ['POST', route('/api/scans/move'), async ({ req }) => {
      const { scan_ids, post_id }: { scan_ids: number[]; post_id: number | null } = await req.json();
      f.scans.forEach(s => { if (scan_ids.includes(s.scan_id)) Object.assign(s, { post_id, position: null }); });
      return noContent();
    }],
    ['PUT', route('/api/scans/order'), async ({ req }) => {
      const { scan_ids }: { scan_ids: number[] } = await req.json();
      scan_ids.forEach((id, position) => { const s = scanOf(String(id)); if (s) s.position = position; });
      return noContent();
    }],
    ['DELETE', route('/api/scans/:id'), ({ params: { id } }) => {
      const claimed = new Set(f.orders.filter(o => o.status !== 'cancelled').flatMap(o => o.items.map(i => i.listing_id)));
      f.scans = f.scans.filter(s => s.scan_id !== Number(id));
      f.listings = f.listings.filter(l => l.scan_id !== Number(id) || claimed.has(l.id));
      return noContent();
    }],
    ['POST', route('/api/scans/:id/relookup-prices'), ({ params: { id } }) => {
      const scan = scanOf(id);
      if (!scan) return notFound('Scan not found');
      const { listed: _, ...read } = scanRead(scan, false);
      return json({ ...read, updated: scan.cards.length });
    }],
    ['POST', route('/api/scans/:id/frame-card'), async ({ params: { id }, req }) => {
      const scan = scanOf(id);
      if (!scan) return notFound('Scan not found');
      const corners: Array<[number, number]> = (await formJson(req, 'payload')).corners;
      const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
      const [x, y] = [Math.min(...xs), Math.min(...ys)];
      const card: DetectedCard = {
        id: Math.max(-1, ...scan.cards.map(c => c.id)) + 1, bbox: [x, y, Math.max(...xs) - x, Math.max(...ys) - y], corners,
        crop_b64: drawnCard(''), bbox_source: 'user', name_source: 'gemini', name_confidence: null,
        gemini: { name: '', set_code: '', collector_number: '', is_foil: false, quantity: 1 },
        candidates: [{ ...blankCandidate(''), _lookup_failed: true, _manual: true, price_source_normal: 'manual', price_source_foil: 'manual' }],
      };
      scan.cards.push({ ...card, crop_b64: '' });
      f.images.set(`/api/scans/${scan.scan_id}/crops/${card.id}`, card.crop_b64);
      return json(card);
    }],
    ['POST', route('/api/relookup'), async ({ req }) => {
      const { name, set } = await formJson(req, 'payload');
      return json(allCandidates().find(c => c.name.toLowerCase() === String(name).toLowerCase()) ?? blankCandidate(name, String(set ?? '').toUpperCase()));
    }],
    ['POST', route('/api/printings'), async ({ req }) => {
      const { name } = await formJson(req, 'payload');
      const known = allCandidates().filter(c => c.name.toLowerCase() === String(name).toLowerCase()).slice(0, 1);
      const image = known[0]?.image_url ?? '';
      return json({
        name,
        printings: [...known, ...PRINTINGS.map(([set, set_name, collector_number, rarity, usd, usd_foil]): Candidate => ({
          ...blankCandidate(name, set), scryfall_id: `test-printing-${set}-${collector_number}`.toLowerCase(), set_name, collector_number, rarity, usd, usd_foil, image_url: image,
          price_source_normal: 'cardkingdom', price_source_foil: usd_foil ? 'cardkingdom' : 'none',
        }))],
      });
    }],
    ['POST', route('/api/export'), async () => { await slow(); return file(PNG, 'image/png'); }],
    ['POST', route('/api/export-all'), async () => { await slow(); return file(EMPTY_ZIP, 'application/zip'); }],

    ['GET', route('/api/listings'), ({ url }) => json(f.listings
      .filter(l => !url.searchParams.get('status') || l.status === url.searchParams.get('status'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(listingRead))],
    ['POST', route('/api/listings'), async ({ req }) => {
      const { bbox, notes: _, ...body }: ListingCreatePayload = await req.json();
      return json(newListing(f, {
        scryfall_id: null, set_code: null, set_name: null, collector_number: null, rarity: null, is_foil: false,
        image_url: null, ck_url: null, qty_total: 1, scan_id: null, post_ids: [], ...body,
        bbox: bbox?.length === 4 ? [bbox[0], bbox[1], bbox[2], bbox[3]] : null,
      }), 201);
    }],
    ['PATCH', route('/api/listings/:id'), async ({ params: { id }, req }) => {
      const listing = find(f.listings, id);
      const body: Partial<Listing> = await req.json();
      return listing ? json(touch(listing, body)) : notFound('Listing not found');
    }],
    ['DELETE', route('/api/listings/:id'), ({ params: { id } }) => {
      const listing = find(f.listings, id);
      if (listing) touch(listing, { status: 'archived' });
      return noContent();
    }],

    ['GET', route('/api/orders'), ({ url }) => json(f.orders
      .filter(o => flag(url, 'include_archived') || !o.archived_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)))],
    ['PATCH', route('/api/orders/:id'), async ({ params: { id }, req }) => {
      const order = find(f.orders, id);
      const body: Partial<Order> = await req.json();
      return order ? json(touch(order, body)) : notFound('Order not found');
    }],
    ['POST', route('/api/orders/:id/:action'), ({ params: { id, action } }) => {
      const order = find(f.orders, id);
      if (!order) return notFound('Order not found');
      const changes: Record<string, Partial<Order>> = {
        'mark-paid': { paid_at: order.paid_at ?? ago(0) },
        'mark-delivered': { delivered_at: order.delivered_at ?? ago(0) },
        cancel: { status: 'cancelled' },
        restore: { status: 'claimed' },
        archive: { archived_at: order.archived_at ?? ago(0) },
        unarchive: { archived_at: null },
      };
      return changes[action] ? json(touch(order, changes[action])) : notFound('Not Found');
    }],
    ['PUT', route('/api/orders/:id/prices'), async ({ params: { id }, req }) => {
      const order = find(f.orders, id);
      if (!order) return notFound('Order not found');
      const { items, sent }: { items: Array<{ id: number; unit_price_myr: string }>; sent: boolean } = await req.json();
      for (const item of order.items) {
        const price = items.find(p => p.id === item.id)?.unit_price_myr;
        if (price != null) Object.assign(item, { unit_price_myr: price, line_total_myr: (Number(price) * item.qty).toFixed(2) });
      }
      const total = order.items.reduce((n, i) => n + Number(i.line_total_myr), 0).toFixed(2);
      return json(touch(order, { total_myr: total, ...(sent ? { prices_sent_at: ago(0) } : {}) }));
    }],
    ['DELETE', route('/api/orders/:id/prices-sent'), ({ params: { id } }) => {
      const order = find(f.orders, id);
      return order ? json(touch(order, { prices_sent_at: null })) : notFound('Order not found');
    }],

    // By name, in SQLite's byte order: capitals before small letters.
    ['GET', route('/api/buyers'), () => json([...f.buyers]
      .sort((a, b) => (a.fb_name < b.fb_name ? -1 : a.fb_name > b.fb_name ? 1 : 0)).map(buyerRead))],
    ['PATCH', route('/api/buyers/:id'), async ({ params: { id }, req }) => {
      const buyer = find(f.buyers, id);
      const body: Partial<BuyerCreatePayload> = await req.json();
      return buyer ? json(touch(buyer, body)) : notFound('Buyer not found');
    }],

    ['POST', route('/api/claims/read'), async ({ req }) => {
      await slow();
      const form = await req.formData();
      const ids = String(form.get('scan_ids') ?? '').split(',').filter(Boolean).map(Number);
      const thread = f.comments.map((c, i) => `${c.buyer}\n${c.text}\nLike   Reply   ${i + 1}h`).join('\n');
      // The first screenshot shows a photo for sure, the second only maybe.
      return json({ pages: form.getAll('images').map((_, i) => ({ text: thread, scan_id: i === 0 ? ids[0] ?? null : null, guess: i === 1 ? ids[1] ?? null : null })) });
    }],
    ['POST', route('/api/claims/parse'), async ({ req }) => {
      await slow();
      const { photos }: { photos: CataloguePhoto[] } = await req.json();
      const cards = photos.flatMap(p => p.cards.map(c => ({ scan_id: p.scan_id, card_id: c.card_id, said: c.name })));
      // Each comment claims the next card; a comment with no text claims nothing it can name.
      // The second buyer spells their card another way, and one question is read as no claim.
      const claims = cards.length ? f.comments.map((c, i) => ({
        buyer: c.buyer, comment: c.text, unclear: c.text ? '' : 'The comment has no text: say which card, or remove it',
        items: c.text ? [{ ...cards[i % cards.length], said: i === 1 ? cards[i % cards.length].said.slice(0, -1) : cards[i % cards.length].said, qty: i === 0 ? 2 : 1, unclear: '' }] : [],
      })) : [];
      const skipped = claims.length ? [`${f.comments[0].buyer.trim()}: Ada lagi boss?`] : [];
      return json({ claims, skipped, credits: f.credits });
    }],
    ['POST', route('/api/claims/confirm'), async ({ req }) => {
      const { post_id, claims }: { post_id: number | null; claims: ConfirmClaim[] } = await req.json();
      // As the server does: a listing per scanned card (same photo, box and
      // finish), made the first time it is claimed, and an order per comment.
      const orders = claims.map(claim => newOrder(f, buyerFor(f, claim.buyer.trim()), claim.items.map(item => {
        const { qty, card_id: _, bbox: [x, y, w, h], ...fields } = item;
        const listing = f.listings.find(l => l.scan_id === item.scan_id && l.bbox?.join() === item.bbox.join() && l.is_foil === item.is_foil)
          ?? newListing(f, {
            scryfall_id: null, set_code: null, set_name: null, collector_number: null, rarity: null, image_url: null, ck_url: null,
            ...fields, bbox: [x, y, w, h], post_ids: post_id != null ? [post_id] : [],
          });
        return { listing, qty, unit: Number(item.unit_price_myr) };
      }), { notes: claim.note ?? null }));
      return json(orders, 201);
    }],
    ['POST', route('/api/sales'), async ({ req }) => {
      const { lines }: { lines: unknown[] } = await req.json();
      return json({ recorded: lines.length }, 201);
    }],
    ['POST', route('/api/slips'), async () => { await slow(); return file(BLANK_PDF, 'application/pdf'); }],

  ];

  return async req => {
    const url = new URL(req.url);
    for (const [method, path, handle] of routes) {
      const match = method === req.method ? path.exec(url.pathname) : null;
      if (!match) continue;
      // An unexpected error is a 500, as on the server.
      try {
        return await handle({ params: match.groups ?? {}, req, url });
      } catch (e) {
        console.error('[test data]', req.method, url.pathname, e);
        return json({ detail: 'Internal server error' }, 500);
      }
    }
    console.warn(`[test data] no fixture for ${req.method} ${url.pathname}`);
    return req.method === 'GET' ? notFound(`No test data for ${url.pathname}`) : noContent();
  };
}
