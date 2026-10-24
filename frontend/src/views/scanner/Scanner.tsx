import { POSTS } from '../../routes.ts';
import { PricingPage } from '../PricingPage.tsx';
import { useScannerArea, type ScannerProps } from './area.tsx';
import { PhotoPage } from './PhotoPage.tsx';
import { PostPage } from './PostPage.tsx';
import { PostsPage } from './PostsPage.tsx';

// The Scanner tab: Posts, one post, one photo or a post's pricing, by URL.
export function Scanner(props: ScannerProps) {
  const area = useScannerArea(props);
  // Another page is showing: keep the state, render nothing.
  if (!props.active) return null;
  const { route, openFolder, activeBatch, t } = area;
  if (activeBatch) return <PhotoPage area={area} batch={activeBatch} />;
  if (route.page === 'pricing' && openFolder) {
    // The unfiled photos (postId null) are priced with the default.
    return (
      <PricingPage
        postId={openFolder.postId}
        postTitle={openFolder.title}
        crumbs={[{ label: t('scans_title'), to: POSTS }, { label: openFolder.title, to: { page: 'post', folder: openFolder.key } }, { label: t('crumbs_pricing') }]}
        parent={{ page: 'post', folder: openFolder.key }}
        pricing={area.pricing}
        t={t}
      />
    );
  }
  // Keyed by post, so the search, the selection and a rename draft start
  // fresh on another post.
  if (openFolder) return <PostPage key={openFolder.key} area={area} folder={openFolder} />;
  return <PostsPage area={area} />;
}
