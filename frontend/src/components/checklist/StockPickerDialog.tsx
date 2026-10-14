import { useEffect, useMemo, useState } from 'react';
import { postsApi, type Listing, type Post } from '../../api/checklist.ts';
import { useDialog } from '../DialogProvider.tsx';
import type { T } from '../../hooks/useLang.ts';

interface Props {
  post: Post;
  // Every active listing the user owns. Pre-checked rows are those already
  // linked to this post. Toggling sets membership; Save replaces the post's
  // listing set in one PUT call.
  allListings: Listing[];
  onClose: () => void;
  onSaved: () => void;
  t: T;
}

export function StockPickerDialog({ post, allListings, onClose, onSaved, t }: Props) {
  const dialog = useDialog();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  // Pre-seed the selection with the listings already in this post. We only
  // include "active" listings here — archived ones aren't browsable.
  const initiallyLinked = new Set(
    allListings.filter(l => l.post_ids.includes(post.id)).map(l => l.id),
  );
  const [selected, setSelected] = useState<Set<number>>(initiallyLinked);

  // Escape to dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Filter to active stock + search query
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allListings
      .filter(l => l.status === 'active')
      .filter(l => {
        if (!q) return true;
        return (
          l.name.toLowerCase().includes(q) ||
          (l.set_code?.toLowerCase().includes(q) ?? false) ||
          (l.set_name?.toLowerCase().includes(q) ?? false) ||
          (l.collector_number?.toLowerCase().includes(q) ?? false)
        );
      });
  }, [allListings, search]);

  const toggle = (id: number) => {
    setSelected(curr => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Bulk toggles for the currently-filtered view (so the user can "Select
  // all matching cmm" without polluting other posts' picks).
  const selectAllFiltered = () => {
    setSelected(curr => {
      const next = new Set(curr);
      for (const l of filtered) next.add(l.id);
      return next;
    });
  };
  const clearAllFiltered = () => {
    setSelected(curr => {
      const next = new Set(curr);
      for (const l of filtered) next.delete(l.id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      await postsApi.setListings(post.id, [...selected]);
      onSaved();
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    } finally { setBusy(false); }
  };

  const addedCount = [...selected].filter(id => !initiallyLinked.has(id)).length;
  const removedCount = [...initiallyLinked].filter(id => !selected.has(id)).length;

  return (
    <div className="modal-shade" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-card stock-picker-card" onClick={e => e.stopPropagation()}>
        <h3 className="dlg-title">{t('ck_post_picker_title', { name: post.title || `#${post.id}` })}</h3>
        <p className="dlg-msg" style={{ marginBottom: 12 }}>{t('ck_post_picker_sub')}</p>

        <div className="picker-toolbar">
          <input
            type="search"
            className="stock-search"
            placeholder={t('ck_stock_search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <button type="button" className="ghost" onClick={selectAllFiltered}>
            {t('ck_post_picker_select_all', { n: filtered.length })}
          </button>
          <button type="button" className="ghost" onClick={clearAllFiltered}>
            {t('ck_post_picker_clear')}
          </button>
        </div>

        <div className="picker-list">
          {filtered.length === 0 ? (
            <div className="checklist-empty" style={{ padding: 20 }}>
              <div className="sub">{search ? t('ck_stock_search_no_match', { q: search }) : t('ck_no_stock_active')}</div>
            </div>
          ) : filtered.map(l => {
            const checked = selected.has(l.id);
            const otherPosts = l.post_ids.filter(pid => pid !== post.id).length;
            return (
              <button
                key={l.id}
                type="button"
                className={`picker-row${checked ? ' checked' : ''}`}
                onClick={() => toggle(l.id)}
                aria-pressed={checked}
              >
                <span className={`picker-check${checked ? ' on' : ''}`}>{checked ? '✓' : ''}</span>
                {l.image_url ? <img src={l.image_url} alt="" loading="lazy" className="thumb" /> : <div className="thumb placeholder">?</div>}
                <div className="info">
                  <div className="name">
                    {l.name}
                    {l.is_foil ? <span className="foil-mark">FOIL</span> : null}
                  </div>
                  <div className="sub">
                    {l.set_code ? (
                      <span className="set-badge">
                        {l.set_code.toUpperCase()}
                        {l.collector_number ? <span className="cn">#{l.collector_number}</span> : null}
                      </span>
                    ) : null}
                    <span>×{l.qty_total}</span>
                    {otherPosts > 0 ? <span className="other-posts">{t('ck_post_picker_other_posts', { n: otherPosts })}</span> : null}
                  </div>
                </div>
                <div className="price">RM{l.unit_price_myr}</div>
              </button>
            );
          })}
        </div>

        <div className="picker-summary">
          {addedCount > 0 || removedCount > 0 ? (
            <span>
              {addedCount > 0 ? t('ck_post_picker_delta_add', { n: addedCount }) : ''}
              {addedCount > 0 && removedCount > 0 ? ' · ' : ''}
              {removedCount > 0 ? t('ck_post_picker_delta_remove', { n: removedCount }) : ''}
            </span>
          ) : (
            <span style={{ color: 'var(--ink-soft)' }}>{t('ck_post_picker_delta_none')}</span>
          )}
        </div>

        <div className="form-actions stock-edit-actions">
          <button className="ghost" disabled={busy} onClick={onClose}>{t('ck_cancel')}</button>
          <button className="accent" disabled={busy || (addedCount === 0 && removedCount === 0)} onClick={save}>
            {busy ? t('ck_saving') : t('ck_post_picker_save')}
          </button>
        </div>
      </div>
    </div>
  );
}
