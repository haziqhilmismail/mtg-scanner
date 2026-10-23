import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { PostTile } from '../../components/ScanGallery.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { UploadZone } from '../../components/UploadZone.tsx';
import type { PriceMode } from '../../types.ts';
import { keyTaken, moveTileFocus, ScanProgress, type Area, type Folder } from './area.tsx';

// Posts: every post as a tile, the archived ones behind a toggle, and the
// drop area that starts a new post.
export function PostsPage({ area }: { area: Area }) {
  const { t, scanner, pricingFor, loading, liveFolders, archivedFolders, startPost } = area;
  const [showArchived, setShowArchived] = useState(false);
  // A new post is of the kind picked above the drop area: the default
  // pricing's kind unless the seller picks the other.
  const defaultType = pricingFor(null).priceMode;
  const [pickedType, setPickedType] = useState<PriceMode | null>(null);
  const newType = pickedType ?? defaultType;

  // Arrows move between the tiles (Enter opens one).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (!keyTaken(e)) moveTileFocus(e); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const grid = (list: Folder[]) => (
    <div className="gallery-grid">
      {list.map(f => (
        <PostTile
          key={f.key}
          title={f.title}
          covers={f.items.flatMap(i => (i.batch.response ? [i.batch.response.thumb_url ?? i.batch.response.image_b64] : []))}
          photos={f.items.length}
          needs={f.items.filter(i => i.needs > 0).length}
          pending={f.items.filter(i => i.pending > 0).length}
          total={f.total}
          settings={pricingFor(f.postId)}
          t={t}
          to={{ page: 'post', folder: f.key }}
        />
      ))}
    </div>
  );

  return (
    <>
      <div className="review-head">
        <div className="review-title">
          <h1 className="page-title">
            {t('scans_title')}{liveFolders.length ? <span className="meta"> · {liveFolders.length}</span> : null}
          </h1>
        </div>
      </div>
      <UploadZone active onFiles={files => startPost(files, newType)} t={t}>
        <div className="post-type-row new-post-type">
          <span className="post-type-label">{t('post_type_title')}</span>
          <div className="segmented" role="group" aria-label={t('post_type_title')}>
            {(['photo', 'live'] as const).map(mode => (
              <button key={mode} type="button" className={newType === mode ? 'active' : ''} aria-pressed={newType === mode} onClick={() => setPickedType(mode)}>
                {t(`post_type_${mode}`)}
                {mode === defaultType ? <span className="post-type-default">{t('post_type_default')}</span> : null}
              </button>
            ))}
          </div>
          <p>{t(`post_type_${newType}_desc`)}</p>
        </div>
      </UploadZone>
      <ScanProgress progress={scanner.scanProgress} t={t} />
      {loading ? (
        <Spinner label={t('scanner_loading_saved')} />
      ) : (
        <>
          {liveFolders.length ? grid(liveFolders) : <p className="gallery-empty">{t('scans_empty')}</p>}
          {archivedFolders.length ? (
            <>
              <button
                type="button" className="ghost archived-toggle"
                aria-expanded={showArchived} onClick={() => setShowArchived(v => !v)}
              >
                <Icon name="archive" size={18} />
                {t('scans_archived')} · {archivedFolders.length}
                <Icon name={showArchived ? 'chevronDown' : 'chevronRight'} size={16} />
              </button>
              {showArchived ? grid(archivedFolders) : null}
            </>
          ) : null}
        </>
      )}
    </>
  );
}
