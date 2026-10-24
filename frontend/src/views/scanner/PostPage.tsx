import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Breadcrumbs } from '../../components/Breadcrumbs.tsx';
import { useDialog } from '../../components/DialogProvider.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PricingRow } from '../../components/SettingsPanel.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { Select, TextField } from '../../components/ui/Field.tsx';
import { Menu } from '../../components/ui/Menu.tsx';
import { StickyBar } from '../../components/ui/StickyBar.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { photosOf, usePhotoDrop } from '../../hooks/usePhotoDrop.ts';
import { POSTS, UNFILED } from '../../routes.ts';
import type { Batch } from '../../types.ts';
import { byPostOrder, PHOTO_SORTS, sortPhotos, type PhotoSort } from '../../utils.ts';
import { keyTaken, ScanProgress, type Area, type Folder } from './area.tsx';
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

// One post: its name with Rename and Manage post, its total and actions,
// then its photos to search, sort, select and reorder.
export function PostPage({ area, folder }: { area: Area; folder: Folder }) {
  const {
    t, scanner, pricingFor, go, pickerPosts, postTitle, numbers, exportJob,
    renamePost, setArchived, deletePost, deletePhotos, moveTo, sort, setSort, openPhoto,
  } = area;
  const dialog = useDialog();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>(NORMAL);
  const [saving, setSaving] = useState(false);
  // The name being typed in Rename; null while the dialog is closed.
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameForm = useId();
  const headId = useId();
  const addInput = useRef<HTMLInputElement>(null);

  const settings = pricingFor(folder.postId);
  const live = settings.priceMode === 'live';
  const isPost = folder.postId != null;
  const q = query.trim().toLowerCase();
  // The saved photos in post order: what reorder moves and what exports.
  const saved = useMemo(() => folder.items.map(s => s.batch).filter(b => b.response && b.scanId != null).sort(byPostOrder), [folder]);
  // The labelled photos of some of them: a live post's every photo, a
  // price-on-photo post's finished ones (their prices are the ones claims use).
  const jobsOf = (batches: Batch[]) => batches.filter(b => live || b.lockedAt).flatMap(b => exportJob(b) ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shareJobs = useMemo(() => (isPost ? jobsOf(saved) : []), [isPost, saved, live, exportJob]);
  const exp = usePostExport(shareJobs, folder.title, t);
  const visible = useMemo(
    () => sortPhotos(folder.items.filter(s => !q || s.names.some(n => n.toLowerCase().includes(q))), sort),
    [folder, q, sort],
  );
  const selected = mode.kind === 'select' ? mode.selected : new Set<string>();
  const draft = mode.kind === 'reorder' ? mode.draft : [];
  const dirty = draft.join() !== saved.map(b => b.id).join();

  const addPhotos = (photos: File[]) => (photos.length ? scanner.addFiles(photos, folder.postId) : toast(t('drop_no_photos')));
  const dragging = usePhotoDrop(addPhotos);

  const endMode = () => setMode(NORMAL);
  const startSelect = () => { setQuery(''); setMode({ kind: 'select', selected: new Set() }); };
  const startReorder = () => setMode({ kind: 'reorder', draft: saved.map(b => b.id) });
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setMode({ kind: 'select', selected: next });
  };

  const move = (i: number, by: -1 | 1, dir: 'up' | 'down') => {
    const next = [...draft];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setMode({ kind: 'reorder', draft: next });
    // At the top or bottom its button turns off; keep the keyboard on the row.
    const id = draft[i];
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLButtonElement>(`[data-move="${id} ${dir}"]`);
      if (btn?.disabled) document.querySelector<HTMLButtonElement>(`[data-move="${id} ${dir === 'up' ? 'down' : 'up'}"]`)?.focus();
    });
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

  const saveName = () => {
    const title = (renaming ?? '').trim();
    if (!title) return;
    setRenaming(null);
    renamePost(folder, title);
  };

  // Keyboard: / jumps to the search; Esc ends a mode, or goes up to Posts.
  // Never while typing or under a popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyTaken(e)) return;
      if (e.key === '/' && mode.kind === 'normal') {
        const search = document.querySelector<HTMLInputElement>('.photo-search input');
        if (search) { e.preventDefault(); search.focus(); }
      } else if (e.key === 'Escape') {
        if (mode.kind === 'normal') go(POSTS);
        else setMode(NORMAL);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode.kind, go]);

  const count = folder.items.length;
  const allSelected = count > 0 && selected.size === count;
  const chosenJobs = jobsOf(saved.filter(b => selected.has(b.id)));
  const moveTargets = pickerPosts.filter(p => p.id !== folder.postId);

  return (
    <>
      <Breadcrumbs items={[{ label: t('scans_title'), to: POSTS }, { label: folder.title }]} />
      <div className="post-head">
        <h1 className="page-title">{folder.title}</h1>
        {isPost ? (
          <span className="post-head-actions">
            <button type="button" className="ui-icon-btn" aria-label={t('rename_post')} aria-haspopup="dialog" onClick={() => setRenaming(folder.title)}>
              <Icon name="edit" size={18} />
            </button>
            <Menu
              label={t('manage_post')}
              items={[
                folder.archived
                  ? { label: t('restore_post'), hint: t('restore_post_hint'), onSelect: () => setArchived(folder, false) }
                  : { label: t('archive_post'), hint: t('archive_post_hint'), onSelect: () => setArchived(folder, true) },
                { label: t('delete_post'), hint: t('delete_post_hint'), destructive: true, onSelect: () => deletePost(folder) },
              ]}
            >
              <Icon name="more" size={20} />
            </Menu>
          </span>
        ) : null}
      </div>
      {folder.archived ? (
        <div className="post-note">
          <Icon name="archive" size={18} />
          <span>{t('post_archived_note')}</span>
          <button type="button" className="ui-btn" onClick={() => setArchived(folder, false)}>{t('posts_restore')}</button>
        </div>
      ) : null}
      {!isPost ? <p className="post-note"><Icon name="folder" size={18} /><span>{t('unfiled_note')}</span></p> : null}

      <div className="post-layout">
        <div className="post-side">
          {isPost && count ? <PostSummary area={area} folder={folder} quiet={mode.kind === 'reorder'} jobs={shareJobs} exp={exp} /> : null}
          <PostPricingRow area={area} folder={folder} />
        </div>

        <section className="post-main" aria-labelledby={headId}>
          <ScanProgress progress={scanner.scanProgress} t={t} />
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
                    {t(allSelected ? 'photos_select_none' : 'photos_select_all')}
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
                  type="search" className="photo-search" aria-label={t('post_search')} placeholder={t('post_search')}
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
              t={t}
              photoRoute={scanId => ({ page: 'photo', folder: folder.key, scanId })}
              mode={mode.kind === 'select' ? { kind: 'select', selected, onToggle: toggle }
                : mode.kind === 'reorder' ? { kind: 'reorder', onMove: move } : {
                kind: 'normal', query, showFile: sort === 'name',
                onOpen: () => openPhoto(visible.map(s => s.batch.id)),
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
          <span className="ui-sticky-status" aria-live="polite">{dirty ? t('reorder_unsaved') : ''}</span>
          <button type="button" className="ui-btn ui-btn--ink" onClick={endMode}>{t('cancel')}</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={!dirty || saving} onClick={saveOrder}>{t('reorder_save')}</button>
        </StickyBar>
      ) : null}

      {dragging ? <div className="drop-hint" aria-hidden="true"><span><Icon name="photo" size={28} />{t('post_drop')}</span></div> : null}

      <Dialog
        open={renaming != null}
        onClose={() => setRenaming(null)}
        title={t('rename_post')}
        closeLabel={t('cancel')}
        footer={(
          <>
            <button type="button" className="ui-btn ui-btn--ink" onClick={() => setRenaming(null)}>{t('cancel')}</button>
            <button type="submit" form={renameForm} className="ui-btn ui-btn--primary" disabled={!renaming?.trim()}>{t('rename_save')}</button>
          </>
        )}
      >
        <form id={renameForm} onSubmit={e => { e.preventDefault(); saveName(); }}>
          <TextField
            label={t('rename_label')} hint={t('rename_hint')} value={renaming ?? ''} maxLength={255}
            onChange={e => setRenaming(e.target.value)} data-autofocus=""
          />
        </form>
      </Dialog>
    </>
  );
}

// The post's pricing, or for the unfiled photos the default, once it is known.
function PostPricingRow({ area, folder }: { area: Area; folder: Folder }) {
  const { t, pricing, pricingFor } = area;
  if (!pricing.pricingKnown(folder.postId)) return null;
  return folder.postId == null
    ? <PricingRow title={t('pricing_row_default')} settings={pricingFor(null)} t={t} to={{ page: 'profile-pricing' }} />
    : <PricingRow title={t('settings_title')} settings={pricingFor(folder.postId)} t={t} to={{ page: 'pricing', folder: folder.key }} />;
}
