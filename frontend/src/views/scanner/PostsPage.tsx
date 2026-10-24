import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Link } from '../../components/Link.tsx';
import { countText, Mosaic, PostRow, thumbOf } from '../../components/ScanGallery.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { usePhotoDrop } from '../../hooks/usePhotoDrop.ts';
import { ScanProgress, type Area, type Folder } from './area.tsx';
import { NewPostDialog } from './NewPostDialog.tsx';

// Posts: every post as a row with + New post above, the photos in no post,
// and the archived posts behind their own heading.
export function PostsPage({ area }: { area: Area }) {
  const { t, scanner, pricingFor, loading, liveFolders, archivedFolders, unfiledFolder, startPost, setArchived } = area;
  const toast = useToast();
  const [newOpen, setNewOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const defaultKind = pricingFor(null).priceMode;
  // On a computer, photos dropped or pasted on the page start a post of the default kind.
  const dragging = usePhotoDrop(photos => (photos.length ? startPost(photos, defaultKind) : toast(t('drop_no_photos'))));

  const row = (f: Folder) => (
    <li key={f.key}>
      <PostRow title={f.title} items={f.items} total={f.total} settings={pricingFor(f.postId)} t={t} to={{ page: 'post', folder: f.key }} />
    </li>
  );

  return (
    <>
      <div className="posts-head">
        <h1 className="page-title">
          {t('scans_title')}{liveFolders.length ? <span className="ui-count"> · {liveFolders.length}</span> : null}
        </h1>
        <button type="button" className="ui-btn ui-btn--primary" aria-haspopup="dialog" onClick={() => setNewOpen(true)}>
          <Icon name="plus" size={18} />{t('new_post')}
        </button>
      </div>
      <ScanProgress progress={scanner.scanProgress} t={t} />
      {loading ? (
        <Spinner label={t('scanner_loading_saved')} />
      ) : (
        <>
          {liveFolders.length ? <ul className="ui-list postlist">{liveFolders.map(row)}</ul> : (
            <div className="posts-empty">
              <Icon name="photo" size={32} />
              <h2>{t('posts_empty_title')}</h2>
              <p>{t('posts_empty_body')}</p>
            </div>
          )}
          {liveFolders.some(f => pricingFor(f.postId).priceMode === 'live') ? <p className="posts-note">{t('posts_live_note')}</p> : null}
          {unfiledFolder ? (
            <ul className="ui-list postlist">
              <li>
                <Link className="ui-row postrow" to={{ page: 'post', folder: unfiledFolder.key }}>
                  <Mosaic srcs={unfiledFolder.items.flatMap(s => thumbOf(s.batch) ?? [])} photos={unfiledFolder.items.length} />
                  <span className="ui-row-main">
                    <span className="ui-row-title">{t('posts_unfiled')}</span>
                    <span className="ui-row-meta">
                      {countText(t, 'post_photos_count', unfiledFolder.items.length)} · {t('posts_unfiled_meta')}
                    </span>
                  </span>
                </Link>
              </li>
            </ul>
          ) : null}
          {archivedFolders.length ? (
            <section className="posts-archived">
              <button type="button" className="ui-btn ui-btn--plain posts-archived-toggle" aria-expanded={showArchived} onClick={() => setShowArchived(v => !v)}>
                <Icon name="archive" size={18} />
                <span>{t('posts_archived')} <span className="ui-count">· {archivedFolders.length}</span></span>
              </button>
              {showArchived ? (
                <ul className="ui-list postlist">
                  {archivedFolders.map(f => (
                    <li key={f.key} className="postrow-archived">
                      <PostRow title={f.title} items={f.items} total={f.total} settings={pricingFor(f.postId)} t={t} to={{ page: 'post', folder: f.key }} />
                      <button type="button" className="ui-btn" onClick={() => setArchived(f, false)}>{t('posts_restore')}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {dragging ? <div className="drop-hint" aria-hidden="true"><span><Icon name="photo" size={28} />{t('new_post_drop')}</span></div> : null}
      <NewPostDialog open={newOpen} onClose={() => setNewOpen(false)} defaultKind={defaultKind} onStart={startPost} t={t} />
    </>
  );
}
