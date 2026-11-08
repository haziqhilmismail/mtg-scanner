import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deletePost as apiDeletePost, type Post, repostPost, updatePost } from '../../api/posts.ts';
import { statusOf } from '../../api/http.ts';
import { useDialog } from '../../components/DialogProvider.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { useT, type T } from '../../hooks/useLang.ts';
import type { NavStore } from '../../hooks/useNav.ts';
import type { PricingStore } from '../../hooks/usePricing.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';
import { plural } from '../../i18n/index.ts';
import { dateLocale } from '../../lib/browser.ts';
import type { RepostPhoto } from '../../lib/repost.ts';
import { folderOf, POSTS, routeFolder, UNFILED } from '../../routes.ts';
import type { PriceMode } from '../../types.ts';
import { photoStatus, type PhotoStatus } from './status.ts';

// One post's worth of scans. `postId` null is the Unfiled photos.
export interface Folder {
  key: string;
  postId: number | null;
  title: string;
  archived: boolean;    // hidden from the posts list (shown under Archived)
  // Buyers with claims on the post, and how many still have to pay.
  buyers: number;
  unpaid: number;
  paid: number;         // RM buyers have paid
  items: PhotoStatus[];
}

const emptyUnfiled = (t: T): Folder => ({
  key: UNFILED, postId: null, title: t('posts_unfiled'), archived: false, buyers: 0, unpaid: 0, paid: 0, items: [],
});

interface Props {
  scanner: ScannerStore;
  nav: NavStore;
  pricing: PricingStore;
}

export function usePosts({ scanner, nav: { route, go, replace, current }, pricing }: Props) {
  const { lang, t } = useT();
  const dialog = useDialog();
  const toast = useToast();
  const { pricingFor, listPosts, createPost } = pricing;

  // Every post, archived ones too, so their photos don't fall into Unfiled.
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  const refreshPosts = useCallback(async () => {
    try {
      setPosts(await listPosts());
    }
    catch { /* offline or auth error: the list stays as it was */ }
    setPostsLoaded(true);
  }, [listPosts]);

  // Read once at the start, then again on each arrival at Posts, so its
  // claim counts are current.
  const onPosts = route.page === 'posts';
  const postsRead = useRef(false);
  useEffect(() => {
    if (postsRead.current && !onPosts) return;
    postsRead.current = true;
    refreshPosts();
  }, [refreshPosts, onPosts]);

  const postsById = useMemo(() => new Map(posts.map(p => [p.id, p])), [posts]);
  const postTitle = useCallback((p: Post) => p.title || `#${p.id}`, []);
  const folderTitle = useCallback((postId: number | null) => {
    const post = postId != null ? postsById.get(postId) : undefined;
    return post ? postTitle(post) : t('posts_unfiled');
  }, [postsById, postTitle, t]);

  // Three levels: all posts → one post's photos → one photo, each with its
  // own URL (see useNav).
  const folderKey = routeFolder(route);
  // The open photo, found by its scan id: a photo scanned this session keeps
  // its own batch id, so the URL names the scan.
  const activeBatch = route.page === 'photo' ? (scanner.batches.find(b => b.scanId === route.scanId) ?? null) : null;
  const photoId = activeBatch?.id ?? null;

  const pickerPosts = useMemo(() => posts.filter(p => p.status !== 'archived'), [posts]);

  // Every post, newest first as the server lists them, each with its photos
  // (a post may have none yet), then the photos in no post (or in a post
  // this page doesn't know), as the Unfiled folder.
  const folders = useMemo<Folder[]>(() => {
    const byKey = new Map<string, Folder>(posts.map(p => [folderOf(p.id), {
      key: folderOf(p.id), postId: p.id, title: postTitle(p), archived: p.status === 'archived',
      buyers: p.buyer_count, unpaid: p.unpaid_buyer_count, paid: Number(p.paid_myr), items: [],
    }]));
    const unfiled = emptyUnfiled(t);
    for (const b of scanner.batches) {
      const f = byKey.get(folderOf(b.postId)) ?? unfiled;
      f.items.push(photoStatus(b, pricingFor(f.postId)));
    }
    return unfiled.items.length ? [...byKey.values(), unfiled] : [...byKey.values()];
  }, [scanner.batches, posts, postTitle, pricingFor, t]);

  // The open post. It may have no photos yet (just created, or all deleted).
  const openFolder = useMemo<Folder | null>(() => {
    if (folderKey == null) return null;
    return folders.find(f => f.key === folderKey)
      ?? (folderKey === UNFILED ? emptyUnfiled(t) : null);
  }, [folderKey, folders, t]);

  // A post that no longer exists (deleted elsewhere): back to the list
  // rather than an empty screen.
  useEffect(() => {
    if (folderKey != null && postsLoaded && !scanner.loadingSaved && !openFolder && photoId == null) {
      replace(POSTS);
    }
  }, [folderKey, postsLoaded, scanner.loadingSaved, openFolder, photoId, replace]);

  // The posts list leaves archived posts out; they wait in their own section.
  const liveFolders = useMemo(() => folders.filter(f => f.postId != null && !f.archived), [folders]);
  const archivedFolders = useMemo(() => folders.filter(f => f.archived), [folders]);
  const unfiledFolder = folders.find(f => f.postId == null) ?? null;
  const loading = !postsLoaded || (scanner.loadingSaved && scanner.batches.length === 0);

  // A photo URL with no such photo (deleted, or not this user's), once every
  // saved photo has loaded: its post takes the entry's place.
  useEffect(() => {
    if (route.page === 'photo' && !activeBatch && !scanner.loadingSaved) replace({ page: 'post', folder: route.folder });
  }, [route, activeBatch, scanner.loadingSaved, replace]);

  // New photos from the top level start a new post named for the moment, of
  // the kind the seller picked, and open it.
  const startPost = useCallback(async (files: File[], priceMode: PriceMode) => {
    let postId: number | null = null;
    try {
      const title = new Date().toLocaleString(dateLocale(lang), {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      });
      const post = await createPost({ title }, priceMode);
      postId = post.id;
      await refreshPosts();
    } catch { /* couldn't create the post: the photos are still scanned, unfiled */ }
    scanner.addFiles(files, postId);
    go({ page: 'post', folder: folderOf(postId) });
  }, [scanner, lang, refreshPosts, go, createPost]);

  // True once the photos are in the other post.
  const moveTo = useCallback(async (ids: string[], postId: number | null) => {
    try {
      await scanner.moveBatches(ids, postId);
    } catch {
      await dialog.alert({ title: t('alert_error_title'), message: t('scans_move_failed') });
      return false;
    }
    toast(t('photos_moved_toast', { post: folderTitle(postId) }));
    return true;
  }, [scanner, dialog, toast, folderTitle, t]);

  // Asks first; true once the photos are gone.
  const deletePhotos = useCallback(async (ids: string[]) => {
    if (!ids.length) return false;
    const ok = await dialog.confirm({
      title: plural(t, 'photos_delete_title', ids.length),
      message: t('scans_delete_msg'),
      okLabel: plural(t, 'photos_delete_ok', ids.length),
      destructive: true,
    });
    if (!ok) return false;
    // Deleting the open photo: its post takes the entry's place, so none is
    // left for it. Asked after the confirm: the user may have moved on.
    const cur = current();
    if (cur.page === 'photo' && ids.some(id => scanner.batches.find(b => b.id === id)?.scanId === cur.scanId)) {
      replace({ page: 'post', folder: cur.folder });
    }
    // Gone from the list at once; a failed delete is retried on the next visit.
    void scanner.removeBatches(ids);
    return true;
  }, [dialog, scanner, current, replace, t]);

  const renamePost = useCallback(async (folder: Folder, title: string) => {
    if (folder.postId == null || !title || title === folder.title) return;
    setPosts(prev => prev.map(p => (p.id === folder.postId ? { ...p, title } : p)));
    try {
      await updatePost(folder.postId, { title });
    } catch (e) {
      await refreshPosts();
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [dialog, refreshPosts, t]);

  // Archiving hides a post without losing anything; restoring brings it back.
  // Either one says so with an Undo, unless it is the undo itself.
  const setArchived = useCallback(async (folder: Folder, archived: boolean, undoable = true) => {
    if (folder.postId == null) return;
    const status = archived ? 'archived' : 'active';
    setPosts(prev => prev.map(p => (p.id === folder.postId ? { ...p, status } : p)));
    try {
      await updatePost(folder.postId, { status });
    } catch (e) {
      await refreshPosts();
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
      return;
    }
    // Still on the post: the user may have left it meanwhile.
    if (archived && routeFolder(current()) === folder.key) go(POSTS);
    const message = t(archived ? 'post_archived_toast' : 'post_restored_toast');
    toast(message, undoable ? { undoLabel: t('undo'), onUndo: () => setArchived(folder, !archived, false) } : undefined);
  }, [dialog, toast, refreshPosts, current, go, t]);

  // Deleting a post takes its photos with it. The server refuses while any
  // of its cards are still claimed, so no buyer's claim is lost silently:
  // then archiving is offered instead.
  const deletePost = useCallback(async (folder: Folder) => {
    if (folder.postId == null) return;
    const photos = folder.items.length;
    const cards = folder.items.reduce((n, s) => n + s.cards, 0);
    const ok = await dialog.confirm({
      title: t('delete_post_title', { name: folder.title }),
      message: photos
        ? t('delete_post_body', { photos: plural(t, 'photos', photos), cards: plural(t, 'cards', cards) })
        : t('delete_post_body_empty'),
      okLabel: t('delete_post'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiDeletePost(folder.postId);
    } catch (e) {
      if (statusOf(e) !== 409) {
        await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
      } else if (await dialog.confirm({
        title: t('delete_post_claimed_title', { name: folder.title }),
        message: t('delete_post_claimed_body'),
        okLabel: t('archive_post'),
      })) {
        await setArchived(folder, true);
      }
      return;
    }
    void scanner.removeBatches(folder.items.map(s => s.batch.id));
    if (routeFolder(current()) === folder.key) replace(POSTS);
    await refreshPosts();
    toast(t('post_deleted_toast'));
  }, [dialog, toast, scanner, current, replace, refreshPosts, setArchived, t]);

  // A new post of a post's photos with the sold cards covered (lib/repost.ts),
  // then open it.
  const repost = useCallback(async (folder: Folder, title: string, photos: RepostPhoto[], newPrices: boolean) => {
    if (folder.postId == null) return false;
    try {
      const { post, scans } = await repostPost(folder.postId, title, photos, newPrices);
      scanner.addSaved(scans);
      await refreshPosts();
      go({ page: 'post', folder: folderOf(post.id) });
      toast(t('repost_done_toast'));
      return true;
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
      return false;
    }
  }, [scanner, refreshPosts, go, toast, dialog, t]);

  return {
    loading, postsById, pickerPosts, postTitle, folderTitle, refreshPosts,
    liveFolders, archivedFolders, unfiledFolder, openFolder, activeBatch,
    moveTo, deletePhotos, renamePost, setArchived, deletePost, repost, startPost,
  };
}

export type Posts = ReturnType<typeof usePosts>;
