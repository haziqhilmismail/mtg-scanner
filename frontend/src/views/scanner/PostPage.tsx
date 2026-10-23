import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddAllChecklistModal } from '../../components/AddAllChecklistModal.tsx';
import { Breadcrumbs } from '../../components/Breadcrumbs.tsx';
import { useDialog } from '../../components/DialogProvider.tsx';
import { Icon } from '../../components/Icon.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { PhotoTile, type BatchSummary } from '../../components/ScanGallery.tsx';
import { PricingRow } from '../../components/SettingsPanel.tsx';
import { UploadZone } from '../../components/UploadZone.tsx';
import { POSTS, UNFILED } from '../../routes.ts';
import type { Batch } from '../../types.ts';
import { byPostOrder, formatMyr, PHOTO_SORTS, sortPhotos, type PhotoSort } from '../../utils.ts';
import { keyTaken, moveTileFocus, ScanProgress, type Area, type Folder } from './area.tsx';

// One post: its name, total and actions, then its photos to search, sort,
// select and reorder.
export function PostPage({ area, folder }: { area: Area; folder: Folder }) {
  const {
    t, scanner, pricing, pricingFor, go, pickerPosts, postTitle, numbers, pricingTitle,
    sharePhone, ready, finishing, share, explainFinish, runFinishAll, deliverFolder,
    deletePhotos, renamePost, setArchived, deletePost, moveTo, sort, setSort, openPhoto,
  } = area;
  const dialog = useDialog();
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reordering, setReordering] = useState(false);
  // Renaming: click the name and type. Enter or clicking away saves, Esc
  // cancels. null = not editing.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Unfiled photos ask which post to finish into; the picker holds them.
  const [finishTargets, setFinishTargets] = useState<{ key: string; batches: Batch[] } | null>(null);

  const live = pricingFor(folder.postId).priceMode === 'live';
  const q = query.trim().toLowerCase();
  const matches = useCallback((s: BatchSummary) => !q || s.haystack.includes(q), [q]);
  const visibleItems = useMemo(() => sortPhotos(folder.items.filter(matches), sort), [folder, matches, sort]);
  // The saved photos in post order, for reordering.
  const postOrdered = useMemo(() => folder.items.map(s => s.batch).filter(b => b.scanId != null).sort(byPostOrder), [folder]);

  const clearSelection = () => { setSelected(new Set()); setSelecting(false); };

  const saveTitle = () => {
    const title = (titleDraft ?? '').trim();
    setTitleDraft(null);
    renamePost(folder, title);
  };

  const moveInOrder = async (i: number, by: -1 | 1) => {
    const ids = postOrdered.map(b => b.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    try { await scanner.orderBatches(ids); } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  };

  const finishFolder = async () => {
    const targets = folder.items.map(s => s.batch).filter(b => b.response && b.scanId != null);
    if (targets.length === 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('bulk_add_all_none') });
      return;
    }
    if (!live && !(await explainFinish())) return;
    if (folder.postId == null) { setFinishTargets({ key: folder.key, batches: targets }); return; }
    const ok = await dialog.confirm({
      title: t(live ? 'live_add_all_title' : 'finish_all_confirm_title'),
      message: t(live ? 'live_add_all_msg' : 'finish_all_confirm_msg', { n: targets.length, post: folder.title }),
      okLabel: t(live ? 'live_add_all' : 'finish_all_confirm_ok'),
    });
    if (ok) runFinishAll(folder.key, targets, folder.postId);
  };

  // Keyboard: / jumps to the search, Esc ends selecting or goes to Posts,
  // arrows move between the tiles. Never while typing or under a popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyTaken(e)) return;
      if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('.scan-search input');
        if (search) { e.preventDefault(); search.focus(); }
        return;
      }
      if (e.key === 'Escape') {
        if (selecting) { setSelecting(false); setSelected(new Set()); }
        else go(POSTS);
        return;
      }
      moveTileFocus(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, go]);

  return (
    <>
      <div className="photo-nav">
        <Breadcrumbs items={[{ label: t('scans_title'), to: POSTS }, { label: folder.title }]} />
      </div>
      <div className="review-head">
        <div className={`review-title post-title ${titleDraft != null ? 'is-editing' : ''}`}>
          {folder.postId == null ? (
            <h1 className="page-title">{folder.title}</h1>
          ) : titleDraft != null ? (
            <input
              className="title-edit"
              type="text"
              value={titleDraft}
              aria-label={t('scans_rename_title')}
              maxLength={255}
              autoFocus
              onFocus={e => e.target.select()}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
                if (e.key === 'Escape') { e.preventDefault(); setTitleDraft(null); }
              }}
            />
          ) : (
            <h1 className="page-title">
              <button
                type="button" className="title-btn"
                title={t('scans_rename')}
                onClick={() => setTitleDraft(folder.title)}
              >
                <span>{folder.title}</span>
                <Icon name="edit" size={16} />
              </button>
            </h1>
          )}
        </div>
        {folder.total > 0 ? (
          <span className="all-scans-total">
            <span className="label">{folder.items.length === 1 ? t('scans_photo_one') : t('scans_photos', { n: folder.items.length })}</span>
            <span className="value">{formatMyr(folder.total, pricingFor(folder.postId))}</span>
          </span>
        ) : null}
        {folder.items.some(s => s.batch.response) || folder.postId != null ? (
          <span className="review-actions">
            {ready?.key === folder.key ? (
              <button className="accent" onClick={share}>
                <Icon name="share" size={18} />{t('share_n_photos', { n: ready.files.length })}
              </button>
            ) : (
              <>
                {live ? (
                  folder.items.some(s => s.pending > 0) ? (
                    <button className="accent" disabled={finishing != null} onClick={finishFolder}>
                      <Icon name="addList" size={18} />{finishing === folder.key ? t('finish_busy') : t('live_add_all')}
                    </button>
                  ) : null
                ) : folder.items.some(s => s.batch.response && !s.batch.lockedAt) ? (
                  <button className="accent" disabled={finishing != null} onClick={finishFolder}>
                    <Icon name="lock" size={18} />{finishing === folder.key ? t('finish_busy') : t('finish_all')}
                  </button>
                ) : null}
                {(live ? folder.items.some(s => s.batch.response) : folder.items.some(s => s.batch.lockedAt)) ? (
                  <button disabled={finishing != null} onClick={() => deliverFolder(folder.key, folder.items.map(s => s.batch))}>
                    <Icon name={sharePhone ? 'share' : 'download'} size={18} />{t(sharePhone ? 'share_all' : 'download_all')}
                  </button>
                ) : null}
              </>
            )}
            {folder.postId != null ? (
              <>
                <button className="ghost" onClick={() => setArchived(folder, !folder.archived)}>
                  <Icon name="archive" size={18} />{folder.archived ? t('scans_unarchive') : t('scans_archive')}
                </button>
                <button className="ghost destructive" onClick={() => deletePost(folder)}>
                  <Icon name="trash" size={18} />{t('scans_delete_post')}
                </button>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {folder.archived ? (
        <p className="archived-note"><Icon name="archive" size={16} />{t('scans_archived_note')}</p>
      ) : null}
      <UploadZone active onFiles={files => scanner.addFiles(files, folder.postId)} t={t} compact />
      {pricing.pricingKnown(folder.postId) ? (
        <PricingRow title={pricingTitle(folder)} settings={pricingFor(folder.postId)} t={t} to={{ page: 'pricing', folder: folder.key }} />
      ) : null}
      <ScanProgress progress={scanner.scanProgress} t={t} />
      <h3 className="level-label">
        {t('scans_photos_label')}{folder.items.length ? <span className="meta"> · {folder.items.length}</span> : null}
      </h3>
      {folder.items.length > 0 ? (
        <div className="gallery-bar">
          {selecting ? (
            <>
              <span className="gallery-bar-count">{t('scans_n_selected', { n: selected.size })}</span>
              <select
                className="gallery-move"
                value=""
                disabled={selected.size === 0}
                aria-label={t('scans_move_to')}
                onChange={async e => {
                  const v = e.target.value;
                  if (!v) return;
                  await moveTo([...selected], v === UNFILED ? null : Number(v));
                  clearSelection();
                }}
              >
                <option value="">{t('scans_move_to')}</option>
                {pickerPosts.filter(p => p.id !== folder.postId).map(p => (
                  <option key={p.id} value={p.id}>{postTitle(p)}</option>
                ))}
                {folder.postId != null ? <option value={UNFILED}>{t('scans_unfiled')}</option> : null}
              </select>
              <button className="destructive" disabled={selected.size === 0} onClick={async () => { if (await deletePhotos([...selected])) clearSelection(); }}>
                <Icon name="trash" size={18} />{t('scans_delete')}
              </button>
              <button className="ghost" onClick={clearSelection}>{t('scans_select_done')}</button>
            </>
          ) : (
            <>
              <label className="scan-search">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('scans_search')}
                  aria-label={t('scans_search')}
                />
              </label>
              <select className="gallery-sort" value={sort} aria-label={t('scans_sort')} onChange={e => setSort(e.target.value as PhotoSort)}>
                {(Object.keys(PHOTO_SORTS) as PhotoSort[]).map(k => (
                  <option key={k} value={k}>{t(`scans_sort_${k}`)}</option>
                ))}
              </select>
              <InfoTip label={t('post_order_info_title')} text={t('post_order_info')} />
              <button className="ghost" onClick={() => setReordering(true)}>{t('scans_reorder')}</button>
              <button className="ghost" onClick={() => setSelecting(true)}>{t('scans_select')}</button>
            </>
          )}
        </div>
      ) : null}
      {reordering ? (
        /* Post order as a list: move a photo up or down, saved at once. */
        <div className="reorder-list">
          <p className="claims-hint">{t('scans_reorder_hint')}</p>
          {postOrdered.map((b, i) => (
            <div className="reorder-row" key={b.id}>
              <span className="reorder-num">{i + 1}</span>
              {b.response ? <img src={b.response.thumb_url ?? b.response.image_b64} alt="" /> : null}
              <span className="reorder-name">
                <strong>{t('photo_n', { n: i + 1 })}</strong>
                <span>{b.filename}</span>
              </span>
              <button type="button" className="round-btn" aria-label={t('scans_move_up')} disabled={i === 0} onClick={() => moveInOrder(i, -1)}>
                <Icon name="chevronUp" size={18} />
              </button>
              <button type="button" className="round-btn" aria-label={t('scans_move_down')} disabled={i === postOrdered.length - 1} onClick={() => moveInOrder(i, 1)}>
                <Icon name="chevronDown" size={18} />
              </button>
            </div>
          ))}
          <div className="claims-actions">
            <span className="spacer" />
            <button type="button" className="accent" onClick={() => setReordering(false)}>{t('scans_select_done')}</button>
          </div>
        </div>
      ) : folder.items.length === 0 ? (
        <p className="gallery-empty">{t('scans_empty_post')}</p>
      ) : visibleItems.length === 0 ? (
        <p className="gallery-empty">{q ? t('scans_no_matches') : t('scans_none_to_fix')}</p>
      ) : (
        <div className="gallery-grid">
          {visibleItems.map(s => (
            <PhotoTile
              key={s.batch.id}
              summary={s}
              number={numbers.get(s.batch.id) ?? null}
              settings={pricingFor(s.batch.postId)}
              t={t}
              selecting={selecting}
              selected={selected.has(s.batch.id)}
              to={s.batch.scanId != null ? { page: 'photo', folder: folder.key, scanId: s.batch.scanId } : null}
              onOpen={() => openPhoto(visibleItems.map(v => v.batch.id))}
              onToggle={() => setSelected(prev => {
                const next = new Set(prev);
                if (next.has(s.batch.id)) next.delete(s.batch.id); else next.add(s.batch.id);
                return next;
              })}
            />
          ))}
        </div>
      )}

      {finishTargets && (
        <AddAllChecklistModal
          count={finishTargets.batches.length}
          posts={pickerPosts}
          onClose={() => setFinishTargets(null)}
          onConfirm={postId => { setFinishTargets(null); runFinishAll(finishTargets.key, finishTargets.batches, postId); }}
          t={t}
        />
      )}
    </>
  );
}
