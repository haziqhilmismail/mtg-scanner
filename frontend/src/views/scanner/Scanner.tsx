import { POSTS } from '../../routes.ts';
import { Claims, type ClaimsProps } from '../Claims.tsx';
import { PricingPage } from '../PricingPage.tsx';
import { useScannerArea, type Area, type ScannerProps } from './area.tsx';
import { PhotoPage } from './PhotoPage.tsx';
import { PostHead } from './PostHead.tsx';
import { PostPage } from './PostPage.tsx';
import { PostsPage } from './PostsPage.tsx';

type Props = ScannerProps & { claims: Omit<ClaimsProps, 'folder' | 'area'> };

// Posts, and under each post its Photos and Claims parts, a photo or its
// pricing, by URL.
export function Scanner({ claims, ...props }: Props) {
  const area = useScannerArea(props);
  const { route, openFolder } = area;
  const claimsFolder = props.active && route.page === 'claims' && openFolder?.postId != null ? openFolder : null;
  // The post's two parts share its head; keyed so a rename draft stays with its post.
  const onPart = props.active && openFolder && (route.page === 'post' || claimsFolder);
  return (
    <>
      {onPart ? <PostHead key={openFolder.key} area={area} folder={openFolder} part={claimsFolder ? 'claims' : 'photos'} /> : null}
      {/* Always mounted: back on Claims, it shows at once instead of loading again. */}
      <Claims folder={claimsFolder} area={area} {...claims} />
      {props.active && !claimsFolder ? <ScannerPage area={area} /> : null}
    </>
  );
}

function ScannerPage({ area }: { area: Area }) {
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
