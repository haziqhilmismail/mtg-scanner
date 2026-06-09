import { useEffect, useMemo, useState } from 'react';
import { listingsApi, type Listing, type ListingCreatePayload, type ListingStatus, type Post } from '../../api/checklist.ts';
import { upgradeScryfallImage } from '../../utils.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';
import { BulkImportForm } from './BulkImportForm.tsx';
import { FoilToggle } from './FoilToggle.tsx';
import { NamePicker } from './NamePicker.tsx';
import { PrintingPicker } from './PrintingPicker.tsx';
import { StockEditDialog } from './StockEditDialog.tsx';

type T = (k: string, vars?: Record<string, string | number>) => string;

interface Props {
  listings: Listing[];
  posts: Post[];
  reload: () => void;
  onCreateOrder?: (listing: Listing) => void;
  onBulkCreateOrder?: (listingIds: number[]) => void;
  t: T;
}

// Stock = flat cross-cutting view of every card. Rendered as compact rows
// (one per card), each opening an edit dialog. Search box at the top filters
// by name / set / collector number.
export function ListingsView({ listings, posts, reload, onCreateOrder, onBulkCreateOrder, t }: Props) {
  const dialog = useDialog();
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<ListingStatus | 'all'>('active');
  const [search, setSearch] = useState('');
  // Multi-select for bulk delete. Holds listing ids; pruned to whatever is
  // actually on screen whenever the filtered set changes so a stale id can't
  // linger in a hidden selection.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Posts that can be linked to from the edit dialog: active + inactive.
  // Archived posts are deliberately excluded — user has to un-archive first.
  const linkablePosts = useMemo(
    () => posts.filter(p => p.status !== 'archived'),
    [posts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings
      .filter(l => filter === 'all' || l.status === filter)
      .filter(l => {
        if (!q) return true;
        return (
          l.name.toLowerCase().includes(q) ||
          (l.set_code?.toLowerCase().includes(q) ?? false) ||
          (l.set_name?.toLowerCase().includes(q) ?? false) ||
          (l.collector_number?.toLowerCase().includes(q) ?? false)
        );
      });
  }, [listings, filter, search]);

  // Keep the selection in sync with what's visible: drop ids that filtering or
  // search scrolled out of view (and ids deleted on the last reload).
  const filteredIds = filtered.map(l => l.id).join(',');
  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(filtered.map(l => l.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // filteredIds is the cheap stable key for the filtered id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredIds]);

  const selectedVisible = filtered.filter(l => selected.has(l.id));
  const allSelected = filtered.length > 0 && selectedVisible.length === filtered.length;
  // Only active listings can go on an order (archived ones aren't sellable).
  const selectedActive = selectedVisible.filter(l => l.status === 'active');

  const toggleOne = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => {
      if (filtered.length > 0 && filtered.every(l => prev.has(l.id))) {
        const next = new Set(prev);
        filtered.forEach(l => next.delete(l.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach(l => next.add(l.id));
      return next;
    });
  };

  // Bulk delete = the same per-row archive endpoint applied to every selected
  // id (hard-deletes cards with no order history, archives the rest). Fired in
  // parallel; partial failures are surfaced rather than silently swallowed.
  const bulkDelete = async () => {
    const ids = selectedVisible.map(l => l.id);
    if (ids.length === 0) return;
    const ok = await dialog.confirm({
      title: t('ck_bulk_delete_title'),
      message: t('ck_bulk_delete_msg', { n: ids.length }),
      okLabel: t('ck_bulk_delete_ok'),
      destructive: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(ids.map(id => listingsApi.archive(id)));
      const failed = results.filter(r => r.status === 'rejected').length;
      setSelected(new Set());
      reload();
      if (failed > 0) {
        await dialog.alert({ title: t('alert_error_title'), message: t('ck_bulk_some_failed', { n: failed }) });
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const editingListing = editingId ? listings.find(l => l.id === editingId) : null;

  const emptyMsg = filter === 'active'
    ? t('ck_no_stock_active')
    : filter === 'archived' ? t('ck_no_stock_archived') : t('ck_no_stock_all');

  return (
    <div>
      <div className="list-toolbar stock-toolbar">
        <h3>{t('ck_stock_heading', { n: filtered.length })}</h3>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as ListingStatus | 'all')}
          className="filter-select"
        >
          <option value="active">{t('ck_filter_active')}</option>
          <option value="archived">{t('ck_filter_archived')}</option>
          <option value="all">{t('ck_filter_all')}</option>
        </select>
        <input
          type="search"
          className="stock-search"
          placeholder={t('ck_stock_search_placeholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="spacer" />
        {!showForm && !showBulk && (
          <>
            <button className="ghost" onClick={() => setShowBulk(true)}>{t('ck_bulk_import_btn_short')}</button>
            <button onClick={() => setShowForm(true)}>{t('ck_add_stock')}</button>
          </>
        )}
      </div>

      {showForm && (
        <NewStockForm
          t={t}
          posts={linkablePosts}
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}

      {showBulk && (
        <BulkImportForm
          t={t}
          onCancel={() => setShowBulk(false)}
          onDone={() => { setShowBulk(false); reload(); }}
        />
      )}

      {selectedVisible.length > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{t('ck_bulk_selected', { n: selectedVisible.length })}</span>
          <button className="ghost compact" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            {t('ck_bulk_clear')}
          </button>
          {onBulkCreateOrder && selectedActive.length > 0 && (
            <button
              className="bulk-order-btn"
              disabled={bulkBusy}
              onClick={() => onBulkCreateOrder(selectedActive.map(l => l.id))}
            >
              {t('ck_bulk_add_order', { n: selectedActive.length })}
            </button>
          )}
          <button className="bulk-delete-btn" disabled={bulkBusy} onClick={bulkDelete}>
            {bulkBusy ? t('ck_bulk_deleting') : t('ck_bulk_delete_btn', { n: selectedVisible.length })}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="checklist-empty" style={{ padding: 30 }}>
          <div className="sub">{search ? t('ck_stock_search_no_match', { q: search }) : emptyMsg}</div>
        </div>
      ) : (
        <div className="stock-rows">
          {filtered.length > 1 && (
            <label className="stock-select-all">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>{allSelected ? t('ck_bulk_deselect_all') : t('ck_bulk_select_all')}</span>
            </label>
          )}
          {filtered.map(l => (
            <StockRow
              key={l.id}
              l={l}
              posts={posts}
              reload={reload}
              onEdit={() => setEditingId(l.id)}
              onCreateOrder={onCreateOrder}
              selected={selected.has(l.id)}
              onToggleSelect={() => toggleOne(l.id)}
              t={t}
            />
          ))}
        </div>
      )}

      {editingListing && (
        <StockEditDialog
          listing={editingListing}
          posts={linkablePosts}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); reload(); }}
          t={t}
        />
      )}
    </div>
  );
}

function StockRow({ l, posts, reload, onEdit, onCreateOrder, selected, onToggleSelect, t }: {
  l: Listing;
  posts: Post[];
  reload: () => void;
  onEdit: () => void;
  onCreateOrder?: (l: Listing) => void;
  selected: boolean;
  onToggleSelect: () => void;
  t: T;
}) {
  const dialog = useDialog();
  const zoom = useImageZoom();
  const archived = l.status === 'archived';
  const available = l.qty_available ?? l.qty_total;
  const committed = l.qty_committed ?? 0;
  const linkedPosts = l.post_ids
    .map(pid => posts.find(p => p.id === pid))
    .filter((p): p is Post => p !== undefined);

  const remove = async () => {
    const ok = await dialog.confirm({
      title: t('ck_stock_remove_title'),
      message: committed > 0
        ? t('ck_stock_remove_msg_with_orders', { name: l.name, committed })
        : t('ck_stock_remove_msg', { name: l.name }),
      okLabel: committed > 0 ? t('ck_archive') : t('ck_stock_remove_ok'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await listingsApi.archive(l.id);
      reload();
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  };

  return (
    <div className={`stock-row${archived ? ' archived' : ''}${selected ? ' selected' : ''}`}>
      <input
        type="checkbox"
        className="stock-check"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={t('ck_bulk_select_one', { name: l.name })}
      />
      {l.image_url ? (
        <img
          src={l.image_url}
          alt=""
          loading="lazy"
          className="zoomable thumb"
          onClick={() => zoom.open(upgradeScryfallImage(l.image_url!), l.name)}
        />
      ) : (
        <div className="thumb placeholder">?</div>
      )}
      <div className="info">
        <div className="row-1">
          <span className="name" title={l.name}>{l.name}</span>
          {l.is_foil ? <span className="foil-mark">FOIL</span> : null}
          {archived ? <span className="archived-mark">{t('ck_badge_archived')}</span> : null}
        </div>
        <div className="row-2">
          {l.set_code ? (
            <span className="set-badge">
              {l.set_code.toUpperCase()}
              {l.collector_number ? <span className="cn">#{l.collector_number}</span> : null}
            </span>
          ) : null}
          <span className="meta">
            {available}/{l.qty_total} {t('ck_stock_qty_avail')}
            {committed > 0 ? <span style={{ color: 'var(--gold)' }}> · {committed} {t('ck_stock_qty_in_orders')}</span> : null}
          </span>
        </div>
        {linkedPosts.length > 0 ? (
          <div className="row-3 linked-posts">
            {linkedPosts.map(p => (
              <span key={p.id} className={`post-chip mini${p.status === 'inactive' ? ' inactive' : ''}`}>
                📌 {p.title || `#${p.id}`}
                {p.status === 'inactive' ? <span className="status-flag">{t('ck_post_status_inactive_pill')}</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="price-block">
        <div className="price">RM{l.unit_price_myr}</div>
      </div>
      <div className="row-actions">
        {l.status === 'active' && onCreateOrder ? (
          <button className="accent compact" onClick={() => onCreateOrder(l)}>{t('ck_create_order')}</button>
        ) : null}
        <button className="ghost compact" onClick={onEdit}>{t('ck_stock_edit_btn')}</button>
        {archived ? (
          <button
            className="ghost compact"
            onClick={async () => {
              try { await listingsApi.update(l.id, { status: 'active' }); reload(); }
              catch (e) { await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message }); }
            }}
          >{t('ck_reactivate')}</button>
        ) : (
          <button
            type="button"
            className="stock-remove"
            onClick={remove}
            title={t('ck_stock_remove_title')}
            aria-label={t('ck_stock_remove_title')}
          >×</button>
        )}
      </div>
    </div>
  );
}

// Inline "Add stock" form. NamePicker for the card name, then PrintingPicker
// scoped to that card's printings (shows thumb + set + cn). On pick we
// capture image_url + scryfall_id so the saved listing carries a thumbnail.
function NewStockForm({ onCancel, onSaved, t, posts }: {
  onCancel: () => void;
  onSaved: () => void;
  t: T;
  posts: Post[];
}) {
  const dialog = useDialog();
  const [p, setP] = useState<ListingCreatePayload>({
    name: '', set_code: '', set_name: '', collector_number: '',
    is_foil: false, unit_price_myr: '', qty_total: 1, notes: '',
    post_ids: [],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setDisplay = p.set_name || (p.set_code ? p.set_code.toUpperCase() : '');

  const togglePost = (pid: number) => {
    const curr = p.post_ids ?? [];
    setP({ ...p, post_ids: curr.includes(pid) ? curr.filter(x => x !== pid) : [...curr, pid] });
  };

  const save = async () => {
    setErr(null);
    if (!p.name.trim()) { setErr(t('ck_err_name_required')); return; }
    if (!p.unit_price_myr || isNaN(parseFloat(p.unit_price_myr))) {
      setErr(t('ck_err_price_required')); return;
    }
    setBusy(true);
    try {
      await listingsApi.create({
        name: p.name.trim(),
        set_code: p.set_code?.trim() || null,
        set_name: p.set_name?.trim() || null,
        collector_number: p.collector_number?.trim() || null,
        scryfall_id: p.scryfall_id || null,
        rarity: p.rarity || null,
        image_url: p.image_url || null,
        is_foil: !!p.is_foil,
        unit_price_myr: p.unit_price_myr,
        qty_total: Math.max(1, p.qty_total || 1),
        notes: p.notes?.trim() || null,
        post_ids: p.post_ids ?? [],
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <div className="form-card">
      <h3>{t('ck_new_stock')}</h3>
      <div className="form-grid">
        <label className="full">
          <span>{t('ck_form_name')}</span>
          <NamePicker
            value={p.name}
            onChange={(name) => setP({ ...p, name })}
            placeholder={t('ck_form_name_placeholder_short')}
            loadingLabel={t('ck_form_name_loading')}
            autoFocus
          />
        </label>
        <label className="full">
          <span>{t('ck_form_set')}</span>
          <PrintingPicker
            cardName={p.name}
            value={setDisplay}
            onTextChange={(s) => setP({ ...p, set_name: s, set_code: null })}
            onPick={(printing) => setP({
              ...p,
              // Snap to the canonical record so the saved listing has every
              // field aligned with the real Scryfall printing.
              name: printing.name || p.name,
              set_code: (printing.set || '').toLowerCase() || null,
              set_name: printing.set_name || null,
              collector_number: printing.collector_number || null,
              scryfall_id: printing.scryfall_id || null,
              rarity: printing.rarity || null,
              image_url: printing.image_url || null,
            })}
            placeholder={t('ck_form_printing_placeholder')}
            loadingLabel={t('ck_form_printing_loading')}
            emptyLabel={t('ck_form_printing_empty')}
          />
        </label>
        <label>
          <span>{t('ck_form_price')}</span>
          <input
            type="number" step="0.5" min="0"
            placeholder="3.00"
            value={p.unit_price_myr}
            onChange={e => setP({ ...p, unit_price_myr: e.target.value })}
          />
        </label>
        <label>
          <span>{t('ck_form_qty')}</span>
          <div className="qty-stepper" style={{ width: 'fit-content' }}>
            <button
              type="button"
              className="step minus"
              onClick={() => setP({ ...p, qty_total: Math.max(1, (p.qty_total ?? 1) - 1) })}
              disabled={(p.qty_total ?? 1) <= 1}
            >−</button>
            <span className="qty-value">{p.qty_total ?? 1}</span>
            <button
              type="button"
              className="step plus"
              onClick={() => setP({ ...p, qty_total: (p.qty_total ?? 1) + 1 })}
            >+</button>
          </div>
        </label>
        <label className="full" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <span>{t('ck_form_foil')}</span>
          <FoilToggle
            value={!!p.is_foil}
            onChange={(v) => setP({ ...p, is_foil: v })}
            foilLabel={t('ck_foil_on_label')}
            nonFoilLabel={t('ck_foil_off_label')}
          />
        </label>
        <div className="full">
          <span style={{
            display: 'block',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--ink-soft)', marginBottom: 6,
          }}>{t('ck_form_posts_label')}</span>
          {posts.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{t('ck_form_posts_empty')}</p>
          ) : (
            <div className="post-chips">
              {posts.map(po => {
                const linked = (p.post_ids ?? []).includes(po.id);
                return (
                  <button
                    key={po.id}
                    type="button"
                    className={`post-chip${linked ? ' on' : ''}`}
                    onClick={() => togglePost(po.id)}
                  >
                    <span className="x">{linked ? '✓' : '+'}</span>
                    <span className="label">{po.title || `#${po.id}`}</span>
                    {po.status === 'inactive' ? <span className="status-flag">{t('ck_post_status_inactive_pill')}</span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <label className="full">
          <span>{t('ck_form_notes')}</span>
          <textarea value={p.notes ?? ''} onChange={e => setP({ ...p, notes: e.target.value })} />
        </label>
      </div>
      {err ? <div className="form-error">{err}</div> : null}
      <div className="form-actions">
        <button className="accent" disabled={busy} onClick={save}>
          {busy ? t('ck_saving') : t('ck_save_stock')}
        </button>
        <button className="ghost" disabled={busy} onClick={onCancel}>{t('ck_cancel')}</button>
      </div>
    </div>
  );
}
