import { useEffect, useState } from 'react';
import { listingsApi, type Listing, type Post } from '../../api/checklist.ts';
import { useDialog } from '../DialogProvider.tsx';
import { FoilToggle } from './FoilToggle.tsx';
import { PrintingPicker } from './PrintingPicker.tsx';

type T = (k: string, vars?: Record<string, string | number>) => string;

interface Props {
  listing: Listing;
  posts: Post[];          // active+inactive posts (archived already filtered out by caller)
  onClose: () => void;
  onSaved: () => void;
  t: T;
}

// Modal editor for a single stock row. Editable fields: set, price, qty,
// foil, post links (multi), notes. Collector number is displayed read-only
// alongside the set — it's a property of the printing, not something users
// type by hand. Name stays readonly too.
export function StockEditDialog({ listing, posts, onClose, onSaved, t }: Props) {
  const dialog = useDialog();
  const [setCode, setSetCode] = useState(listing.set_code ?? '');
  const [setName, setSetName] = useState(listing.set_name ?? '');
  // cn, image, rarity, scryfall_id are all derived from the chosen printing.
  // We keep them in state so the dialog can preview the image and ship the
  // refreshed values on save.
  const [collector, setCollector] = useState(listing.collector_number ?? '');
  const [scryfallId, setScryfallId] = useState(listing.scryfall_id ?? '');
  const [imageUrl, setImageUrl] = useState(listing.image_url ?? '');
  const [rarity, setRarity] = useState(listing.rarity ?? '');
  const [price, setPrice] = useState(listing.unit_price_myr);
  const [qty, setQty] = useState(listing.qty_total);
  const [isFoil, setIsFoil] = useState(listing.is_foil);
  const [postIds, setPostIds] = useState<number[]>(listing.post_ids ?? []);
  const [notes, setNotes] = useState(listing.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Escape to dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const togglePost = (pid: number) => {
    setPostIds(curr => curr.includes(pid) ? curr.filter(x => x !== pid) : [...curr, pid]);
  };

  const save = async () => {
    setErr(null);
    const n = parseFloat(price);
    if (!isFinite(n) || n < 0) { setErr(t('ck_err_price_required')); return; }
    if (qty < 1) { setErr(t('ck_err_qty_required')); return; }
    setBusy(true);
    try {
      await listingsApi.update(listing.id, {
        set_code: setCode || null,
        set_name: setName || null,
        collector_number: collector || null,
        scryfall_id: scryfallId || null,
        image_url: imageUrl || null,
        rarity: rarity || null,
        unit_price_myr: n.toFixed(2),
        qty_total: qty,
        is_foil: isFoil,
        post_ids: postIds,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  const setDisplay = setName || (setCode ? setCode.toUpperCase() : '');

  return (
    <div className="modal-shade" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-card stock-edit-card" onClick={e => e.stopPropagation()}>
        <h3 className="dlg-title">{t('ck_stock_edit_title')}</h3>
        <div className="stock-edit-subtitle">
          {/* Live preview of the currently-selected printing. Updates as
              soon as the user picks a different one in the picker below. */}
          {imageUrl ? (
            <img src={imageUrl} alt="" className="stock-edit-preview" />
          ) : (
            <div className="stock-edit-preview placeholder">?</div>
          )}
          <div className="stock-edit-titletext">
            <span className="name">{listing.name}</span>
            {(setDisplay || collector) ? (
              <span className="set-badge stock-edit-printing">
                {setCode ? setCode.toUpperCase() : setDisplay}
                {collector ? <span className="cn">#{collector}</span> : null}
              </span>
            ) : null}
          </div>
        </div>

        <div className="form-grid compact">
          <label className="full">
            <span>{t('ck_form_set')}</span>
            <PrintingPicker
              cardName={listing.name}
              value={setDisplay}
              onTextChange={(s) => { setSetName(s); setSetCode(''); }}
              onPick={(printing) => {
                // Snap to the picked printing — every set-derived field
                // refreshes including the image preview above.
                setSetCode((printing.set || '').toLowerCase());
                setSetName(printing.set_name || '');
                setCollector(printing.collector_number || '');
                setScryfallId(printing.scryfall_id || '');
                setRarity(printing.rarity || '');
                setImageUrl(printing.image_url || '');
              }}
              placeholder={t('ck_form_printing_placeholder')}
              loadingLabel={t('ck_form_printing_loading')}
              emptyLabel={t('ck_form_printing_empty')}
            />
          </label>
          <label>
            <span>{t('ck_form_price')}</span>
            <input
              type="number" step="0.5" min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </label>
          <div className="qty-foil-row">
            <div>
              <span className="lab-text">{t('ck_form_qty')}</span>
              <div className="qty-stepper">
                <button
                  type="button"
                  className="step minus"
                  onClick={() => setQty(q => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                >−</button>
                <span className="qty-value">{qty}</span>
                <button
                  type="button"
                  className="step plus"
                  onClick={() => setQty(q => q + 1)}
                >+</button>
              </div>
            </div>
            <FoilToggle
              value={isFoil}
              onChange={setIsFoil}
              foilLabel={t('ck_foil_on_label')}
              nonFoilLabel={t('ck_foil_off_label')}
              size="sm"
            />
          </div>
          <div className="full">
            <span className="lab-text">{t('ck_form_posts_label')}</span>
            {posts.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>{t('ck_form_posts_empty')}</p>
            ) : (
              <div className="post-chips">
                {posts.map(p => {
                  const linked = postIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`post-chip${linked ? ' on' : ''}`}
                      onClick={() => togglePost(p.id)}
                    >
                      <span className="x">{linked ? '✓' : '+'}</span>
                      <span className="label">{p.title || `#${p.id}`}</span>
                      {p.status === 'inactive' ? <span className="status-flag">{t('ck_post_status_inactive_pill')}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <label className="full">
            <span>{t('ck_form_notes')}</span>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
        </div>

        {err ? <div className="form-error" style={{ marginTop: 12 }}>{err}</div> : null}

        <div className="form-actions stock-edit-actions">
          <button className="ghost" disabled={busy} onClick={onClose}>{t('ck_cancel')}</button>
          <button className="accent" disabled={busy} onClick={save}>
            {busy ? t('ck_saving') : t('ck_save_changes')}
          </button>
        </div>
      </div>
    </div>
  );
}
