import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SavedScan } from '../api.ts';
import type { Buyer, Listing, Order, Post } from '../api/checklist.ts';
import { fakeBackend } from './backend.ts';
import { buildFixture } from './fixtures.ts';
import type { TestData } from './mode.ts';

// The fake backend as the app reaches it: requests in, responses out.
function api(mode: TestData) {
  const answer = fakeBackend(buildFixture(mode));
  const send = (method: string, path: string, body?: unknown) => answer(new Request(`http://app.test${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const get = async <T>(path: string): Promise<T> => (await send('GET', path)).json();
  const all = async () => ({
    posts: await get<Post[]>('/api/posts?include_archived=true'),
    scans: await get<SavedScan[]>('/api/scans?lite=1&limit=500'),
    listings: await get<Listing[]>('/api/listings'),
    orders: await get<Order[]>('/api/orders?include_archived=true'),
    buyers: await get<Buyer[]>('/api/buyers'),
  });
  return { send, get, all };
}

test('many: 120 posts, one with 47 photos, a photo with 60 cards, 150 buyers', async () => {
  const { posts, scans, buyers } = await api('many').all();
  const photosPerPost = posts.map(p => scans.filter(s => s.post_id === p.id).length);
  assert.equal(posts.length, 120);
  assert.equal(Math.max(...photosPerPost), 47);
  assert.equal(Math.max(...scans.map(s => s.cards.length)), 60);
  assert.equal(buyers.length, 150);
});

test('one: exactly one of everything, every count at 1', async () => {
  const { get, all } = api('one');
  const { posts, scans, listings, orders, buyers } = await all();
  assert.deepEqual(
    [posts.length, scans.length, scans[0].cards.length, listings.length, orders.length, orders[0].items.length, orders[0].items[0].qty, buyers.length],
    [1, 1, 1, 1, 1, 1, 1, 1],
  );
  assert.equal((await get<{ cardkingdom_cards: number }>('/api/health')).cardkingdom_cards, 1);
  assert.equal((await get<{ remaining: number }>('/api/credits')).remaining, 1);
});

test('empty: no posts, no claims, no payment details', async () => {
  const { get, all } = api('empty');
  const { posts, scans, orders, buyers } = await all();
  assert.deepEqual([posts.length, scans.length, orders.length, buyers.length], [0, 0, 0, 0]);
  assert.deepEqual(await get('/api/payment'), { bank_name: '', bank_account_number: '', bank_account_holder: '', payment_note: '', qr_version: null });
});

test('every claim points at its buyer, a listing, and a card on a photo of a post', async () => {
  for (const mode of ['worst', 'one', 'many'] as const) {
    const { posts, scans, listings, orders, buyers } = await api(mode).all();
    const cardAt = (l: Listing | undefined) => scans.find(s => s.scan_id === l?.scan_id)?.cards.find(c => c.bbox.join() === l?.bbox?.join());
    const orphans = orders.flatMap(o => [
      ...(buyers.some(b => b.id === o.buyer_id) ? [] : [`order ${o.id}: no buyer`]),
      ...o.items.flatMap(i => (cardAt(listings.find(l => l.id === i.listing_id)) ? [] : [`order ${o.id}: no card for listing ${i.listing_id}`])),
    ]);
    const homeless = scans.filter(s => s.post_id != null && !posts.some(p => p.id === s.post_id)).map(s => s.scan_id);
    assert.deepEqual([mode, orphans, homeless], [mode, [], []]);
  }
});

test('worst: the avatar, one photo and one card picture are broken links', () => {
  const f = buildFixture('worst');
  const broken = [...f.images].filter(([, url]) => url.startsWith('/api/no-such-image/')).map(([path]) => path.replace(/\d+/g, 'N'));
  assert.deepEqual(broken.sort(), ['/api/scans/N/crops/N', '/api/scans/N/preview']);
  assert.equal(f.me.avatar_url, '/api/no-such-image/avatar.jpg');
});

test('the scan list comes newest first, a page at a time, without its pictures', async () => {
  const { get } = api('worst');
  const first = await get<SavedScan[]>('/api/scans?lite=1&limit=2');
  const next = await get<SavedScan[]>(`/api/scans?lite=1&limit=2&before=${first[1].scan_id}`);
  assert.deepEqual([...first, ...next].map(s => s.scan_id), [700061, 700060, 700059, 700058]);
  assert.deepEqual([first[0].image_b64, first[0].cards[0].crop_b64], ['', '']);
});

test('a write changes what the next read returns', async () => {
  const { send, get } = api('one');
  const [post] = await get<Post[]>('/api/posts');
  const saved: Post = await (await send('PATCH', `/api/posts/${post.id}`, { title: '  Raya sale  ', status: 'archived' })).json();
  assert.deepEqual([saved.title, saved.status], ['Raya sale', 'archived']);
  assert.deepEqual(await get('/api/posts'), []);
  assert.equal((await get<Post[]>('/api/posts?include_archived=true'))[0].title, 'Raya sale');
});

test('saving a photo\'s edits keeps them, and a picked printing becomes the card\'s match', async () => {
  const { send, get } = api('one');
  const [scan] = await get<SavedScan[]>('/api/scans?lite=1&limit=500');
  const pick = { ...scan.cards[0].candidates[0], set: 'PLST', collector_number: 'WOE-97' };
  const state = { isFoil: [true], priceOverride: ['15.50'], quantity: [2], multOverride: [null], removed: [false], pillOffset: [null], versionOk: [false], locked: [null], lockedAt: null, rev: 5 };
  assert.equal((await send('PATCH', `/api/scans/${scan.scan_id}/state`, { state: { ...state, picks: [pick] } })).status, 204);
  const [saved] = await get<SavedScan[]>('/api/scans?lite=1&limit=500');
  assert.deepEqual(saved.ui_state, state);
  assert.deepEqual([saved.cards[0].candidates[0].set, saved.cards[0].candidates[0].collector_number], ['PLST', 'WOE-97']);
});

test('saving claims finds or makes the buyer and the listing, and makes the order', async () => {
  const { send, get } = api('one');
  const [scan] = await get<SavedScan[]>('/api/scans?lite=1&limit=500');
  const card = scan.cards[0];
  const item = { scan_id: scan.scan_id, card_id: card.id, bbox: card.bbox, name: 'Lord Skitter, Sewer King', is_foil: false, unit_price_myr: '13.00', qty_total: 1, qty: 1 };
  const res = await send('POST', '/api/claims/confirm', { post_id: scan.post_id, claims: [{ buyer: ' Jo ', note: 'dibs', items: [item] }] });
  assert.equal(res.status, 201);
  const [order]: Order[] = await get('/api/orders');
  const buyers: Buyer[] = await get('/api/buyers');
  assert.deepEqual(
    [buyers.find(b => b.id === order.buyer_id)?.fb_name, order.notes, order.total_myr, order.items[0].listing_id],
    ['Jo', 'dibs', '13.00', 1],
  );
  assert.deepEqual(buyers.map(b => [b.fb_name, b.total_orders_count]), [['Jo', 1], ['Tan Wei Jie', 1]]);
});

test('a route with no test data answers 404', async () => {
  assert.equal((await api('worst').send('GET', '/api/posts/1/image')).status, 404);
});

test('a post with an open claim is not deleted, as on the server; once the claim is cancelled it is', async () => {
  const { send, get } = api('one');
  const [post] = await get<Post[]>('/api/posts');
  const [order] = await get<Order[]>('/api/orders');
  assert.equal((await send('DELETE', `/api/posts/${post.id}`)).status, 409);
  await send('POST', `/api/orders/${order.id}/cancel`);
  assert.equal((await send('DELETE', `/api/posts/${post.id}`)).status, 204);
  assert.deepEqual(await get<Post[]>('/api/posts'), []);
});
