import { Icon } from '../Icon.tsx';
import { useState } from 'react';
import { postsApi, type Listing, type Post } from '../../api/checklist.ts';
import { LISTING_SORTS, sortListings, upgradeScryfallImage, type ListingSort } from '../../utils.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';
import type { PricingStore } from '../../hooks/usePricing.ts';
import { PostForm } from './PostForm.tsx';
import { StockPickerDialog } from './StockPickerDialog.tsx';
import type { T } from '../../hooks/useLang.ts';

interface Props {
  posts: Post[];
  listings: Listing[];
  reload: () => void;
  onCreateOrder?: (l: Listing) => void;
  createPost: PricingStore['createPost'];
  t: T;
}

// Posts grouped panel. Each post is its own card showing image, FB link,
// totals, and the listings inside. Each post has "+ Add cards (bulk)" so
// users can paste a Moxfield list once and have N listings created at once.
export function PostsView({ posts, listings, reload, onCreateOrder, createPost, t }: Props) {
  const dialog = useDialog();
  const [showNewPost, setShowNewPost] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [pickerPost, setPickerPost] = useState<Post | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');

  // Split active+inactive from archived so the user opens an explicit tab to
  // see archived posts. This keeps the default view focused on what's currently sellable.
  const activePosts = posts.filter(p => p.status !== 'archived');
  const archivedPosts = posts.filter(p => p.status === 'archived');
  const tabPosts = tab === 'active' ? activePosts : archivedPosts;

  // Group listings by post id — a listing can appear under multiple posts now,
  // so we walk post_ids and push the listing into each matching bucket.
  const byPost = new Map<number, Listing[]>();
  for (const l of listings) {
    for (const pid of l.post_ids) {
      const arr = byPost.get(pid) ?? [];
      arr.push(l);
      byPost.set(pid, arr);
    }
  }

  return (
    <div>
      <div className="list-toolbar">
        <h3>{t('ck_posts_heading', { n: activePosts.length })}</h3>
        <div className="spacer" />
        {!showNewPost && !editing && (
          <button onClick={() => setShowNewPost(true)}><Icon name="plus" size={18} />{t('ck_post_new_btn')}</button>
        )}
      </div>

      {/* Tab strip — Archived tab only renders when there's anything to show */}
      {archivedPosts.length > 0 ? (
        <div className="post-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={`post-tab${tab === 'active' ? ' active' : ''}`}
            onClick={() => setTab('active')}
          >{t('ck_posts_tab_active')} <span className="count">{activePosts.length}</span></button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'archived'}
            className={`post-tab${tab === 'archived' ? ' active' : ''}`}
            onClick={() => setTab('archived')}
          >{t('ck_posts_tab_archived')} <span className="count">{archivedPosts.length}</span></button>
        </div>
      ) : null}

      {showNewPost && (
        <PostForm
          initial={null}
          onCancel={() => setShowNewPost(false)}
          onSaved={() => { setShowNewPost(false); reload(); }}
          createPost={createPost}
          t={t}
        />
      )}

      {editing && (
        <PostForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
          createPost={createPost}
          t={t}
        />
      )}

      {tabPosts.length === 0 && !showNewPost ? (
        <div className="checklist-empty" style={{ padding: 30 }}>
          <div className="sub">
            {tab === 'archived' ? t('ck_posts_empty_archived') : t('ck_posts_empty')}
          </div>
        </div>
      ) : (
        <div className="posts-list">
          {tabPosts.map(p => {
            const ls = byPost.get(p.id) ?? [];
            return (
              <PostCard
                key={p.id}
                post={p}
                listings={ls}
                onEdit={() => setEditing(p)}
                onImport={() => setPickerPost(p)}
                onDelete={async () => {
                  const ok = await dialog.confirm({
                    title: t('ck_post_delete_title'),
                    message: t('ck_post_delete_confirm', { title: p.title || `#${p.id}` }),
                    okLabel: t('ck_post_action_delete'),
                    destructive: true,
                  });
                  if (!ok) return;
                  try { await postsApi.remove(p.id); reload(); }
                  catch (e) { await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message }); }
                }}
                onCreateOrder={onCreateOrder}
                reload={reload}
                t={t}
              />
            );
          })}
        </div>
      )}

      {pickerPost && (
        <StockPickerDialog
          post={pickerPost}
          allListings={listings}
          onClose={() => setPickerPost(null)}
          onSaved={() => { setPickerPost(null); reload(); }}
          t={t}
        />
      )}
    </div>
  );
}

function PostCard({
  post, listings, onEdit, onImport, onDelete, onCreateOrder, reload, t,
}: {
  post: Post;
  listings: Listing[];
  onEdit: () => void;
  onImport: () => void;
  onDelete: () => void;
  onCreateOrder?: (l: Listing) => void;
  reload: () => void;
  t: T;
}) {
  const dialog = useDialog();
  const zoom = useImageZoom();
  const [expanded, setExpanded] = useState(listings.length > 0 && listings.length <= 6);
  const [sort, setSort] = useState<ListingSort>('newest');
  const imgSrc = post.has_image ? postsApi.imageUrl(post.id) : null;
  const isInactive = post.status === 'inactive';
  const isArchived = post.status === 'archived';

  const setStatus = async (next: 'active' | 'inactive' | 'archived') => {
    try { await postsApi.update(post.id, { status: next }); reload(); }
    catch (e) { await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message }); }
  };

  return (
    <article className={`post-card status-${post.status}`}>
      <header>
        <div className="left">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt=""
              className="zoomable"
              onClick={() => zoom.open(imgSrc, post.title || `#${post.id}`)}
            />
          ) : <div className="placeholder">?</div>}
        </div>
        <div className="meta">
          <h4>
            {post.title || `${t('ck_post_anon')} #${post.id}`}
            <span className={`post-status-pill status-${post.status}`}>{t(`ck_post_status_${post.status}`)}</span>
          </h4>
          {post.fb_url ? (
            <a href={post.fb_url} target="_blank" rel="noreferrer" className="fb-link">
              {post.fb_url.replace(/^https?:\/\//, '')}
            </a>
          ) : null}
          {post.note ? <p className="note">{post.note}</p> : null}
          <div className="stats">
            <span>{t('ck_post_stat_cards', { n: post.total_qty })}</span>
            <span>·</span>
            <span>RM{post.total_value_myr}</span>
            {post.active_listing_count !== post.listing_count ? (
              <>
                <span>·</span>
                <span style={{ color: 'var(--ink-soft)' }}>
                  {t('ck_post_stat_active', { active: post.active_listing_count, total: post.listing_count })}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="actions">
          {!isArchived && <button className="ghost" onClick={onImport}>{t('ck_post_action_pick_stock')}</button>}
          {!isArchived && <button className="ghost" onClick={onEdit}>{t('ck_post_action_edit')}</button>}
          {post.status === 'active' && (
            <button className="ghost" onClick={() => setStatus('inactive')}>{t('ck_post_action_set_inactive')}</button>
          )}
          {isInactive && (
            <>
              <button className="ghost" onClick={() => setStatus('active')}>{t('ck_post_action_set_active')}</button>
              <button className="ghost" onClick={() => setStatus('archived')}>{t('ck_post_action_archive')}</button>
            </>
          )}
          {isArchived && (
            <button className="ghost" onClick={() => setStatus('inactive')}>{t('ck_post_action_unarchive')}</button>
          )}
          <button className="ghost" onClick={onDelete}>{t('ck_post_action_delete')}</button>
        </div>
      </header>

      <button
        type="button"
        className="post-toggle"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? '▾' : '▸'} {t(expanded ? 'ck_post_collapse' : 'ck_post_expand', { n: listings.length })}
      </button>

      {expanded && (
        <div className="post-listings">
          {listings.length > 1 && (
            <label className="post-sort">
              <span>{t('ck_post_sort')}</span>
              <select value={sort} onChange={e => setSort(e.target.value as ListingSort)}>
                {(Object.keys(LISTING_SORTS) as ListingSort[]).map(s => (
                  <option key={s} value={s}>{t(`ck_post_sort_${s}`)}</option>
                ))}
              </select>
            </label>
          )}
          {listings.length === 0 ? (
            <div style={{ fontSize: 13,
              color: 'var(--ink-soft)', padding: 14, textAlign: 'center',
            }}>{t('ck_post_no_cards')}</div>
          ) : sortListings(listings, sort).map(l => {
            const archived = l.status === 'archived';
            return (
              <div key={l.id} className={`post-listing-row${archived ? ' archived' : ''}`}>
                {l.image_url ? (
                  <img
                    src={l.image_url}
                    alt=""
                    loading="lazy"
                    className="zoomable"
                    onClick={() => zoom.open(upgradeScryfallImage(l.image_url!), l.name)}
                  />
                ) : <div className="placeholder">?</div>}
                <div className="info">
                  <div className="name">
                    {l.name}
                    {l.is_foil ? <span style={{ color: 'var(--gold)', marginLeft: 4 }}>· FOIL</span> : null}
                    {archived ? <span className="archived-mark">{t('ck_badge_archived')}</span> : null}
                  </div>
                  <div className="sub">
                    {l.set_code ? <span>{l.set_code.toUpperCase()}</span> : null}
                    {l.collector_number ? <span>·#{l.collector_number}</span> : null}
                    <span>·×{l.qty_total}</span>
                  </div>
                </div>
                <div className="price">RM{l.unit_price_myr}</div>
                {onCreateOrder && !archived ? (
                  <button className="compact" onClick={() => onCreateOrder(l)}>
                    <Icon name="plus" size={14} />{t('ck_create_order')}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
