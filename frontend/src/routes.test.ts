import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderOf, formatRoute, parseRoute, type Route } from './routes.ts';

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

test('a post id names its folder', () => {
  assert.equal(folderOf(5), 'p5');
  assert.equal(folderOf(null), 'unfiled');
  assert.equal(formatRoute({ page: 'post', folder: folderOf(5) }), '/posts/5');
});
