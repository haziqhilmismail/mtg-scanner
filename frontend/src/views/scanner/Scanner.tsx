import { useState } from 'react';
import { useT } from '../../hooks/useLang.ts';
import type { NavStore } from '../../hooks/useNav.ts';
import type { PricingStore } from '../../hooks/usePricing.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';
import { POSTS } from '../../routes.ts';
import { Claims, type ClaimsProps } from '../Claims.tsx';
import { PricingPage } from '../PricingPage.tsx';
import { PhotoPage } from './PhotoPage.tsx';
import { PostHead } from './PostHead.tsx';
import { PostPage } from './PostPage.tsx';
import { PostsPage } from './PostsPage.tsx';
import { usePhotoActions } from './usePhotoActions.ts';
import { usePosts } from './usePosts.ts';
import type { PhotoSort } from './photos.ts';

interface Props {
  // A post page is showing, not Profile (both stay mounted, so going back doesn't reload).
  active: boolean;
  scanner: ScannerStore;
  // Which post, photo or pricing page is open: the URL (see useNav).
  nav: NavStore;
  // Pricing per post and the default; pricingFor() prices every photo.
  pricing: PricingStore;
  claims: Pick<ClaimsProps, 'credits' | 'onCredits' | 'onEnterVoucher' | 'payment'>;
}

// Posts, and under each post its Photos and Claims parts, a photo or its
// pricing, by URL.
export function Scanner({ active, scanner, nav, pricing, claims }: Props) {
  const { t } = useT();
  const { pricingFor } = pricing;
  const posts = usePosts({ scanner, nav, pricing });
  const photos = usePhotoActions({ scanner, pricingFor, folderTitle: posts.folderTitle });
  // The photos Prev/Next step through, fixed when a photo is opened so the
  // order doesn't shift under you as you fix things.
  const [navIds, setNavIds] = useState<string[]>([]);
  // The photo order of the post page; kept from one post to the next.
  const [sort, setSort] = useState<PhotoSort>('post');

  const { route } = nav;
  const { openFolder, activeBatch } = posts;
  const claimsFolder = active && route.page === 'claims' && openFolder?.postId != null ? openFolder : null;
  // The post's two parts share its head; keyed so a rename draft stays with its post.
  const onPart = active && openFolder && (route.page === 'post' || claimsFolder);

  const page = () => {
    if (activeBatch) {
      return (
        <PhotoPage
          batch={activeBatch} scanner={scanner} pricingFor={pricingFor} nav={nav}
          posts={posts} photos={photos} navIds={navIds}
        />
      );
    }
    if (route.page === 'pricing' && openFolder) {
      // The unfiled photos (postId null) are priced with the default.
      return (
        <PricingPage
          postId={openFolder.postId}
          postTitle={openFolder.title}
          crumbs={[{ label: t('scans_title'), to: POSTS }, { label: openFolder.title, to: { page: 'post', folder: openFolder.key } }, { label: t('crumbs_pricing') }]}
          parent={{ page: 'post', folder: openFolder.key }}
          pricing={pricing}
        />
      );
    }
    // Keyed by post, so the search, the selection and a rename draft start
    // fresh on another post.
    if (openFolder) {
      return (
        <PostPage
          key={openFolder.key} folder={openFolder} scanner={scanner} pricing={pricing} go={nav.go}
          posts={posts} photos={photos} sort={sort} setSort={setSort}
          onOpenPhoto={ids => { setNavIds(ids); window.scrollTo({ top: 0 }); }}
        />
      );
    }
    return <PostsPage posts={posts} scanner={scanner} pricingFor={pricingFor} />;
  };

  return (
    <>
      {onPart ? <PostHead key={openFolder.key} posts={posts} folder={openFolder} part={claimsFolder ? 'claims' : 'photos'} /> : null}
      {/* Always mounted: back on Claims, it shows at once instead of loading again. */}
      <Claims
        folder={claimsFolder} scanner={scanner} pricingFor={pricingFor} refreshPosts={posts.refreshPosts}
        {...claims}
      />
      {active && !claimsFolder ? page() : null}
    </>
  );
}
