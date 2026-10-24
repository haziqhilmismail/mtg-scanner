// Where the user is, as the URL says it. Pure: parse and format only.
// A folder is a post's key, 'p<id>', or 'unfiled' for photos with no post.
export type Route =
  | { page: 'posts' }
  | { page: 'post'; folder: string }
  | { page: 'photo'; folder: string; scanId: number }
  | { page: 'pricing'; folder: string }
  | { page: 'claims'; folder: string | null }
  | { page: 'profile' }
  | { page: 'profile-pricing' };

export const POSTS: Route = { page: 'posts' };
export const UNFILED = 'unfiled';

// The folder of a post, or of the photos with no post.
export const folderOf = (postId: number | null) => (postId == null ? UNFILED : `p${postId}`);

const segmentOf = (folder: string) => (folder === UNFILED ? UNFILED : folder.slice(1));
const folderFromSegment = (segment: string) =>
  segment === UNFILED ? UNFILED : /^\d+$/.test(segment) ? 'p' + segment : null;

// The folder a route is about, if any.
export const routeFolder = (r: Route): string | null => ('folder' in r ? r.folder : null);

// null for a path that is no page of the app.
export function parseRoute(pathname: string, search = ''): Route | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return POSTS;
  if (parts[0] === 'claims' && parts.length === 1) {
    // A post it can't read is left out rather than refusing the page.
    const post = new URLSearchParams(search).get('post');
    return { page: 'claims', folder: post == null ? null : folderFromSegment(post) };
  }
  if (parts[0] === 'profile') {
    if (parts.length === 1) return { page: 'profile' };
    return parts.length === 2 && parts[1] === 'pricing' ? { page: 'profile-pricing' } : null;
  }
  if (parts[0] !== 'posts' || parts.length < 2) return null;
  const folder = folderFromSegment(parts[1]);
  if (!folder) return null;
  if (parts.length === 2) return { page: 'post', folder };
  if (parts.length === 3 && parts[2] === 'pricing') return { page: 'pricing', folder };
  if (parts.length === 4 && parts[2] === 'photos' && /^\d+$/.test(parts[3])) {
    return { page: 'photo', folder, scanId: Number(parts[3]) };
  }
  return null;
}

export function formatRoute(r: Route): string {
  switch (r.page) {
    case 'posts': return '/';
    case 'post': return `/posts/${segmentOf(r.folder)}`;
    case 'photo': return `/posts/${segmentOf(r.folder)}/photos/${r.scanId}`;
    case 'pricing': return `/posts/${segmentOf(r.folder)}/pricing`;
    case 'claims': return r.folder == null ? '/claims' : `/claims?post=${segmentOf(r.folder)}`;
    case 'profile': return '/profile';
    case 'profile-pricing': return '/profile/pricing';
  }
}
