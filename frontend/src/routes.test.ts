import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRoute, parentOf, parseRoute, type Route } from './routes.ts';

test('every page round-trips through its URL', () => {
  const pages: Array<[Route, string]> = [
    [{ page: 'posts' }, '/'],
    [{ page: 'post', folder: 'p5' }, '/posts/5'],
    [{ page: 'post', folder: 'unfiled' }, '/posts/unfiled'],
    [{ page: 'photo', folder: 'p5', scanId: 12 }, '/posts/5/photos/12'],
    [{ page: 'photo', folder: 'unfiled', scanId: 3 }, '/posts/unfiled/photos/3'],
    [{ page: 'pricing', folder: 'p5' }, '/posts/5/pricing'],
    [{ page: 'claims', folder: null }, '/claims'],
    [{ page: 'claims', folder: 'p5' }, '/claims?post=5'],
    [{ page: 'claims', folder: 'unfiled' }, '/claims?post=unfiled'],
    [{ page: 'profile' }, '/profile'],
    [{ page: 'profile-pricing' }, '/profile/pricing'],
  ];
  for (const [route, url] of pages) {
    assert.equal(formatRoute(route), url);
    const [pathname, search = ''] = url.split('?');
    assert.deepEqual(parseRoute(pathname, search ? '?' + search : ''), route);
  }
});

test('unknown paths are no page', () => {
  for (const path of ['/posts', '/posts/abc', '/posts/5/photos', '/posts/5/photos/x', '/posts/5/edit', '/profile/x', '/claims/5', '/nope']) {
    assert.equal(parseRoute(path), null);
  }
});

test('a trailing slash and a bad post on Claims are tolerated', () => {
  assert.deepEqual(parseRoute('/posts/5/'), { page: 'post', folder: 'p5' });
  assert.deepEqual(parseRoute('/profile/'), { page: 'profile' });
  assert.deepEqual(parseRoute('/claims', '?post=abc'), { page: 'claims', folder: null });
});

test('the parent of a page', () => {
  assert.deepEqual(parentOf({ page: 'photo', folder: 'p5', scanId: 12 }), { page: 'post', folder: 'p5' });
  assert.deepEqual(parentOf({ page: 'pricing', folder: 'unfiled' }), { page: 'post', folder: 'unfiled' });
  assert.deepEqual(parentOf({ page: 'post', folder: 'p5' }), { page: 'posts' });
  assert.deepEqual(parentOf({ page: 'profile-pricing' }), { page: 'profile' });
  assert.equal(parentOf({ page: 'claims', folder: 'p5' }), null);
  assert.equal(parentOf({ page: 'posts' }), null);
});
