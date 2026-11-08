import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDialog } from '../../components/DialogProvider.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PhotoDrop } from '../../components/PhotoDrop.tsx';
import { Link } from '../../components/Link.tsx';
import { Select, TextField } from '../../components/ui/Field.tsx';
import { StickyBar } from '../../components/ui/StickyBar.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { photosOf } from '../../lib/photoFiles.ts';
import { pricingSummary, isLive } from '../../lib/pricing.ts';
import { POSTS, UNFILED, type Route } from '../../routes.ts';
import type { Batch, Settings } from '../../types.ts';
import { byPostOrder, PHOTO_SORTS, sortPhotos, type PhotoSort } from '../../utils.ts';
import { useT } from '../../hooks/useLang.ts';
import type { NavStore } from '../../hooks/useNav.ts';
import type { PricingStore } from '../../hooks/usePricing.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';
import { keyTaken } from '../../lib/browser.ts';
import { ScanProgress } from './ScanProgress.tsx';
import type { PhotoActions } from './usePhotoActions.ts';
import type { Folder, Posts } from './usePosts.ts';
import { PhotoList } from './PhotoList.tsx';
import { PostSummary } from './PostSummary.tsx';
import { usePostExport } from './usePostExport.ts';

// What the photo list is doing: showing the photos, ticking some, or
// moving them into a new order that is saved in one go.
type Mode =
  | { kind: 'normal' }
  | { kind: 'select'; selected: Set<string> }
  | { kind: 'reorder'; draft: string[] };
const NORMAL: Mode = { kind: 'normal' };

interface Props {
  folder: Folder;
  scanner: ScannerStore;
  pricing: PricingStore;
  go: NavStore['go'];
  posts: Posts;
  photos: PhotoActions;
  sort: PhotoSort;
  setSort: (sort: PhotoSort) => void;
  // A photo opened from the list: the order Prev and Next step through.
  onOpenPhoto: (ids: string[]) => void;
}

export function PostPage({ folder, scanner, pricing, go, posts, photos, sort, setSort, onOpenPhoto }: Props) {
  const { t } = useT();
  const { pickerPosts, postTitle, deletePhotos, moveTo } = posts;
  const { numbers, exportJob } = photos;
  const { pricingFor } = pricing;
  const dialog = useDialog();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>(NORMAL);
  const [saving, setSaving] = useState(false);
  const headId = useId();
  const searchId = useId();
  const addInput = useRef<HTMLInputElement>(null);

  const settings = pricingFor(folder.postId);
  const live = isLive(settings);
  const isPost = folder.postId != null;
  const q = query.trim().toLowerCase();
  // The saved photos in post order: what reorder moves and what exports.
  const saved = useMemo(() => folder.items.map(s => s.batch).filter(b => b.response && b.scanId != null).sort(byPostOrder), [folder]);
  // The labelled photos of some of them: a live post's every photo, a
  // price-on-photo post's finished ones (their prices are the ones claims use).
  const jobsOf = (batches: Batch[]) => batches.filter(b => live || b.lockedAt).flatMap(b => exportJob(b) ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shareJobs = useMemo(() => (isPost ? jobsOf(saved) : []), [isPost, saved, live, exportJob]);
  const exp = usePostExport(shareJobs, folder.title);
  const visible = useMemo(
    () => sortPhotos(folder.items.filter(s => !q || s.names.some(n => n.toLowerCase().includes(q))), sort),
    [folder, q, sort],
  );
  const selected = mode.kind === 'select' ? mode.selected : new Set<string>();
  const draft = mode.kind === 'reorder' ? mode.draft : [];
  const dirty = draft.join() !== saved.map(b => b.id).join();

  const addPhotos = (photos: File[]) => (photos.length ? scanner.addFiles(photos, folder.postId) : toast(t('drop_no_photos')));

  const endMode = () => setMode(NORMAL);
  const startSelect = () => { setQuery(''); setMode({ kind: 'select', selected: new Set() }); };
  const startReorder = () => setMode({ kind: 'reorder', draft: saved.map(b => b.id) });
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setMode({ kind: 'select', selected: next });
  };

  const move = (i: number, by: -1 | 1) => {
    const next = [...draft];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setMode({ kind: 'reorder', draft: next });
  };

  const saveOrder = async () => {
    setSaving(true);
    try {
      await scanner.orderBatches(draft);
      endMode();
      toast(t('reorder_saved'));
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    } finally { setSaving(false); }
  };

  // Keyboard: / jumps to the search; Esc ends a mode, or goes up to Posts.
  // Never while typing or under a popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyTaken(e)) return;
      if (e.key === '/' && mode.kind === 'normal') {
        const search = document.getElementById(searchId);
        if (search) { e.preventDefault(); search.focus(); }
      } else if (e.key === 'Escape') {
        if (mode.kind === 'normal') go(POSTS);
        else setMode(NORMAL);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode.kind, go, searchId]);

  const count = folder.items.length;
  const allSelected = count > 0 && selected.size === count;
  const chosenJobs = jobsOf(saved.filter(b => selected.has(b.id)));
  const moveTargets = pickerPosts.filter(p => p.id !== folder.postId);

  return (
    <>
      <div className="post-layout">
        <div className="post-side">
          {isPost && count ? <PostSummary photos={photos} settings={settings} folder={folder} quiet={mode.kind === 'reorder'} jobs={shareJobs} exp={exp} /> : null}
          <PostPricingRow pricing={pricing} folder={folder} />
        </div>

        <section className="post-main" aria-labelledby={headId}>
          <ScanProgress progress={scanner.scanProgress} />
          <div className="ui-section-head">
            <h2 className="ui-section-title" id={headId} aria-live={mode.kind === 'select' ? 'polite' : undefined}>
              {mode.kind === 'select' ? (selected.size ? t('photos_selected', { n: selected.size }) : t('photos_select_title'))
                : mode.kind === 'reorder' ? t('reorder_title')
                : <>{t('post_photos')}{count ? <span className="ui-count"> · {count}</span> : null}</>}
            </h2>
            <div className="ui-section-actions">
              {mode.kind === 'select' ? (
                <>
                  <button type="button" className="ui-btn ui-btn--plain" onClick={() => setMode({ kind: 'select', selected: new Set(allSelected ? [] : folder.items.map(s => s.batch.id)) })}>
                    {t(allSelected ? 'photos_select_none' : 'select_all')}
                  </button>
                  <button type="button" className="ui-btn ui-btn--ink" onClick={endMode}>{t('cancel')}</button>
                </>
              ) : mode.kind === 'normal' ? (
                <>
                  {count ? <button type="button" className="ui-btn ui-btn--plain" onClick={startSelect}>{t('post_select')}</button> : null}
                  <button type="button" className="ui-btn" onClick={() => addInput.current?.click()}>
                    <Icon name="plus" size={18} />{t('post_add_photos')}
                  </button>
                  <input
                    ref={addInput} type="file" accept="image/*" multiple hidden
                    onChange={e => { const photos = photosOf(e.target.files ?? []); e.target.value = ''; addPhotos(photos); }}
                  />
                </>
              ) : null}
            </div>
          </div>

          {mode.kind === 'reorder' ? <p className="photo-hint">{t('reorder_hint')}</p> : null}
          {mode.kind === 'normal' && count ? (
            <>
              <div className="photo-tools">
                <TextField
                  id={searchId} type="search" className="photo-search" aria-label={t('post_search')} placeholder={t('post_search')}
                  prefix={<Icon name="search" size={18} />} value={query} onChange={e => setQuery(e.target.value)}
                />
                <Select className="photo-sort" aria-label={t('post_sort')} value={sort} onChange={e => setSort(e.target.value as PhotoSort)}>
                  {(Object.keys(PHOTO_SORTS) as PhotoSort[]).map(k => <option key={k} value={k}>{t(`scans_sort_${k}`)}</option>)}
                </Select>
              </div>
              {isPost && sort === 'post' && !q && saved.length > 1 ? (
                <div className="photo-hint">
                  <span>{t('post_order_hint')}</span>
                  <button type="button" className="ui-btn ui-btn--plain" onClick={startReorder}>{t('post_reorder')}</button>
                </div>
              ) : null}
            </>
          ) : null}

          {!count ? (
            <p className="photos-empty">{t('post_no_photos')}</p>
          ) : mode.kind === 'normal' && !visible.length ? (
            <p className="photos-empty">{t('post_no_match', { q: query.trim() })}</p>
          ) : (
            <PhotoList
              items={mode.kind === 'reorder' ? draft.flatMap(id => folder.items.find(s => s.batch.id === id) ?? []) : visible}
              inPost={isPost}
              numbers={mode.kind === 'reorder' ? new Map(draft.map((id, i) => [id, i + 1])) : numbers}
              settings={settings}
              photoRoute={scanId => ({ page: 'photo', folder: folder.key, scanId })}
              mode={mode.kind === 'select' ? { kind: 'select', selected, onToggle: toggle }
                : mode.kind === 'reorder' ? { kind: 'reorder', onMove: move } : {
                kind: 'normal', query, showFile: sort === 'name',
                onOpen: () => onOpenPhoto(visible.map(s => s.batch.id)),
                onRetry: id => scanner.retryBatches([id]),
              }}
            />
          )}
        </section>
      </div>

      {mode.kind === 'select' ? (
        <StickyBar className="select-bar">
          <button type="button" className="ui-btn" disabled={!chosenJobs.length || exp.busy} onClick={() => exp.download(chosenJobs)}>
            <Icon name="download" size={18} />{t('photos_download')}
          </button>
          <span className="ui-select move-select">
            <select
              aria-label={t('photos_move')} value="" disabled={!selected.size}
              onChange={async e => {
                const to = e.target.value;
                if (to && await moveTo([...selected], to === UNFILED ? null : Number(to))) endMode();
              }}
            >
              <option value="">{t('photos_move')}</option>
              {moveTargets.map(p => <option key={p.id} value={p.id}>{postTitle(p)}</option>)}
              {isPost ? <option value={UNFILED}>{t('posts_unfiled')}</option> : null}
            </select>
            <Icon name="chevronUpDown" size={14} className="ui-select-icon" />
          </span>
          <button type="button" className="ui-btn danger-text" disabled={!selected.size} onClick={async () => { if (await deletePhotos([...selected])) endMode(); }}>
            <Icon name="trash" size={18} />{t('photos_delete')}
          </button>
        </StickyBar>
      ) : mode.kind === 'reorder' ? (
        <StickyBar>
          <span className="ui-sticky-status" aria-live="polite">{dirty ? t('unsaved_changes') : ''}</span>
          <button type="button" className="ui-btn ui-btn--ink" onClick={endMode}>{t('cancel')}</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={!dirty || saving} onClick={saveOrder}>{t('reorder_save')}</button>
        </StickyBar>
      ) : null}

      <PhotoDrop label={t('post_drop')} onPhotos={addPhotos} />

    </>
  );
}

// The post's pricing, or for the unfiled photos the default, once it is known.
function PostPricingRow({ pricing, folder }: { pricing: PricingStore; folder: Folder }) {
  const { t } = useT();
  const { pricingFor } = pricing;
  if (!pricing.pricingKnown(folder.postId)) return null;
  return folder.postId == null
    ? <PricingRow title={t('pricing_row_default')} settings={pricingFor(null)} to={{ page: 'profile-pricing' }} />
    : <PricingRow title={t('settings_title')} settings={pricingFor(folder.postId)} to={{ page: 'pricing', folder: folder.key }} />;
}

interface RowProps {
  title: string;
  settings: Settings;
  to: Route;
}

function PricingRow({ title, settings, to }: RowProps) {
  const { t } = useT();
  return (
    <Link className="pricing-row" to={to}>
      <Icon name="tag" size={18} />
      <span className="pricing-row-text">
        <span className="pricing-row-title">{title}</span>
        <span className="pricing-row-summary">{pricingSummary(settings, t)}</span>
      </span>
      <span className="pricing-row-change">{t('pricing_edit')}</span>
    </Link>
  );
}
