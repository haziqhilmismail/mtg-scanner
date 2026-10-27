import { useMemo, useState, type ReactNode } from 'react';
import type { T } from '../hooks/useLang.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Batch, CardRowData, Settings } from '../types.ts';
import { bboxKey, canRetry, computeCardData, formatMyr, notAdded } from '../utils.ts';
import { AdjustPanel, type PriceEdit } from './AdjustPanel.tsx';
import { BatchPreview } from './BatchPreview.tsx';
import { CardRow, CardViewer } from './CardRow.tsx';
import { useDialog } from './DialogProvider.tsx';
import { Icon } from './Icon.tsx';
import { PhotoViewer } from './ui/PhotoViewer.tsx';
import { useToast } from './ui/Toast.tsx';

interface Props {
  batch: Batch;
  // Its "Photo N" in the post order; null while it is not saved yet.
  photoNumber: number | null;
  // A live-price post: no Finish or lock, the photo goes out without prices.
  live: boolean;
  settings: Settings;
  scanner: ScannerStore;
  t: T;
  // Dates in the app's language: "24 Oct".
  dateLocale: string;
  // The post the photo is in (null when unfiled): its cards are added there.
  postTitle: string | null;
  // Finishing, adding all or rendering the image is under way.
  busy: boolean;
  onFinish: () => void;
  onDeliver: () => void;
  onEditPrices: () => void;
  // True once the prices came back.
  onRefreshPrices: () => Promise<boolean>;
  onAddMissing: () => void;
  onChangeCard: (idx: number) => void;
  onLooksRight: (idx: number) => void;
  onAddToPost: (cd: CardRowData) => Promise<void>;
  onTakeOut: (cd: CardRowData) => Promise<'claimed' | 'taken out'>;
}

// Above this many cards the actions show again under the list, so a long
// photo needn't scroll back up to act.
const ACTIONS_AGAIN_AFTER = 4;

// The photo's panel: the photo with its labels, what to do with it, and a
// tile per card. The dialogs a tile opens (viewer, Edit price) live here, one
// each, for whichever card asked.
export function ActiveBatchView({
  batch, photoNumber, live, settings, scanner, t, dateLocale, postTitle, busy,
  onFinish, onDeliver, onEditPrices, onRefreshPrices, onAddMissing, onChangeCard, onLooksRight, onAddToPost, onTakeOut,
}: Props) {
  const dialog = useDialog();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState<ReadonlySet<number>>(new Set());
  // `n` counts openings, so each Edit price starts from the card as it is now.
  const [edit, setEdit] = useState<{ idx: number; n: number; open: boolean } | null>(null);
  // card null: the whole photo.
  const [view, setView] = useState<{ card: number | null; side: 0 | 1; open: boolean } | null>(null);
  const cardData = useMemo(() => computeCardData(batch, settings), [batch, settings]);
  const cardsLabel = (n: number) => (n === 1 ? t('photo_card_one') : t('photo_cards', { n }));

  if (batch.status === 'scanning' || batch.status === 'error' || !batch.response) {
    const failed = scanner.batches.filter(canRetry);
    return (
      <div className="photo-panel">
        <header className="photo-panel-head">
          <h2 className="photo-panel-title">{photoNumber != null ? t('photo_n', { n: photoNumber }) : batch.filename}</h2>
          {photoNumber != null ? <p className="photo-panel-file">{batch.filename}</p> : null}
        </header>
        {batch.status === 'scanning' ? <p className="photo-panel-status" aria-live="polite">{t('photo_scanning')}</p> : (
          <>
            <p className="photo-panel-status is-error" role="alert">
              {batch.outOfCredits ? t('scan_no_credits') : (batch.error || t('unknown_error'))}
            </p>
            {canRetry(batch) ? (
              <div className="photo-actions-row">
                <button type="button" className="ui-btn ui-btn--primary" onClick={() => scanner.retryBatches([batch.id])}>
                  <Icon name="refresh" size={18} />{t('scan_retry')}
                </button>
                {failed.length > 1 ? (
                  <button type="button" className="ui-btn" onClick={() => scanner.retryBatches(failed.map(b => b.id))}>{t('scan_retry_all', { n: failed.length })}</button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }

  const data = batch.response;
  const locked = !!batch.lockedAt;
  const visible = cardData.filter(cd => !cd.removed);
  const covered = cardData.filter(cd => cd.sold);
  const removedCount = cardData.length - visible.length - covered.length;
  const isAdded = (cd: CardRowData) => batch.listed.includes(bboxKey(cd.card.bbox));
  const priced = (cd: CardRowData) => Number.isFinite(cd.unitPrice);
  const pending = notAdded(batch, visible).length;
  const unpricedOut = visible.filter(cd => !isAdded(cd) && !(cd.unitPrice > 0)).length;
  const inPost = visible.filter(isAdded).length;
  const totalQty = visible.reduce((n, cd) => n + cd.qty, 0);
  const total = visible.reduce((sum, cd) => sum + (priced(cd) ? cd.lineTotal : 0), 0);
  const unpriced = visible.filter(cd => !priced(cd)).length;
  const approxTotal = live && visible.some(cd => !cd.hasOverride && priced(cd));
  const photoName = photoNumber != null ? t('photo_n', { n: photoNumber }) : batch.filename;
  const nameOf = (cd: CardRowData) => cd.sel.name || t('unknown_card');

  // The post's name shown as a name: posts are often called by a date and
  // time, which would read as part of the sentence.
  const withPost = (key: string, vars: Record<string, string> = {}) => {
    const [before, after = ''] = t(key, { ...vars, post: '\u0000' }).split('\u0000');
    return <>{before}<strong className="photo-post-name">{postTitle ?? t('scans_unfiled')}</strong>{after}</>;
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { if (await onRefreshPrices()) toast(t('photo_refreshed')); } finally { setRefreshing(false); }
  };

  const listFailed = () => dialog.alert({ title: t('alert_error_title'), message: t('photo_list_failed'), okLabel: t('photo_ok') });
  const toggleAdded = async (cd: CardRowData) => {
    const name = nameOf(cd);
    if (!isAdded(cd) && !(cd.unitPrice > 0)) { toast(t('photo_price_first', { name })); return; }
    setAdding(s => new Set(s).add(cd.origIdx));
    try {
      if (!isAdded(cd)) await onAddToPost(cd);
      else if (await onTakeOut(cd) === 'claimed') {
        await dialog.alert({ title: t('photo_claimed_title'), message: t('photo_claimed_msg', { name }), okLabel: t('photo_ok') });
      } else {
        toast(t('photo_taken_out', { name }), { undoLabel: t('photo_undo'), onUndo: () => { onAddToPost(cd).catch(listFailed); } });
      }
    } catch {
      await listFailed();
    } finally {
      setAdding(s => { const next = new Set(s); next.delete(cd.origIdx); return next; });
    }
  };

  const remove = (cd: CardRowData) => {
    scanner.setRemoved(batch.id, cd.origIdx, true);
    toast(t('photo_removed_toast', { name: nameOf(cd) }), { undoLabel: t('photo_undo'), onUndo: () => scanner.setRemoved(batch.id, cd.origIdx, false) });
  };

  const savePrice = (idx: number, e: PriceEdit) => {
    if (e.isFoil !== !!batch.isFoil[idx]) scanner.toggleFoil(batch.id, idx);
    scanner.setMultOverride(batch.id, idx, e.multOverride);
    scanner.setPriceOverride(batch.id, idx, e.priceOverride);
    setEdit(s => (s ? { ...s, open: false } : s));
  };

  // Shown above the tiles, and again below a long list. Only the top one gets
  // the filled button: one primary per page.
  const actions = (top: boolean) => {
    const button = (primary: boolean) => (top && primary ? 'ui-btn ui-btn--primary' : 'ui-btn');
    const download = (primary: boolean) => (
      <button type="button" className={button(primary)} disabled={busy} onClick={onDeliver}>
        <Icon name="download" size={18} />{busy ? t('finish_busy') : t('download_image')}
      </button>
    );
    const refreshButton = batch.scanId != null && !locked ? (
      <button type="button" className="ui-btn ui-btn--plain" disabled={refreshing} onClick={refresh}>
        <Icon name="refresh" size={18} />{refreshing ? t('photo_refreshing') : t('scan_refresh_prices')}
      </button>
    ) : null;
    let hint: ReactNode;
    let row: ReactNode;
    if (live) {
      hint = <><Icon name="bolt" size={16} /><span>{withPost('live_hint')}</span></>;
      const add = pending > 0 ? (
        <button type="button" className={button(true)} disabled={busy} onClick={onFinish}>
          <Icon name="addList" size={18} />{busy ? t('finish_busy') : t('live_add_all')}
        </button>
      ) : visible.length === 0 ? null : unpricedOut > 0 ? (
        <p className="photo-actions-note">{t(unpricedOut === 1 ? 'photo_unpriced_out_one' : 'photo_unpriced_out', { n: unpricedOut })}</p>
      ) : (
        <p className="photo-done" role={top ? 'status' : undefined}><Icon name="check" size={18} />{t(inPost === 1 ? 'photo_all_in_one' : 'photo_all_in', { n: inPost })}</p>
      );
      row = <>{add}{download(pending === 0)}{refreshButton}</>;
    } else if (locked) {
      const date = new Date(batch.lockedAt!).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
      hint = <><Icon name="lock" size={16} /><span>{withPost('locked_hint', { date })}</span></>;
      row = <>{download(true)}<button type="button" className="ui-btn" disabled={busy} onClick={onEditPrices}><Icon name="edit" size={18} />{t('edit_prices')}</button></>;
    } else {
      hint = <><Icon name="lock" size={16} /><span>{withPost('finish_hint')}</span></>;
      row = (
        <>
          <button type="button" className={button(true)} disabled={busy} onClick={onFinish}>
            <Icon name="lock" size={18} />{busy ? t('finish_busy') : t('finish_btn')}
          </button>
          {refreshButton}
        </>
      );
    }
    return (
      <div className="photo-actions">
        <p className={`photo-actions-hint${locked ? ' is-locked' : ''}`}>{hint}</p>
        <div className="photo-actions-row">{row}</div>
      </div>
    );
  };

  const viewed = view?.card != null ? cardData[view.card] : null;
  return (
    <section className="photo-panel" aria-labelledby={`photo-title-${batch.id}`}>
      <header className="photo-panel-head">
        <h2 className="photo-panel-title" id={`photo-title-${batch.id}`}>{photoName}</h2>
        {photoNumber != null ? <p className="photo-panel-file" title={batch.filename}>{batch.filename}</p> : null}
        <p className="photo-panel-meta">
          {cardsLabel(visible.length)}{covered.length ? ` · ${t('photo_n_sold', { n: covered.length })}` : ''}{removedCount ? ` · ${t('photo_n_removed', { n: removedCount })}` : ''} · {data.width}×{data.height}
        </p>
      </header>
      <div className="photo-panel-body">
        <div className="photo-panel-photo">
          <div className="photo-frame" style={{ width: `min(100%, calc(70vh * ${data.width / data.height}))` }}>
            <BatchPreview src={data.image_b64} width={data.width} height={data.height} cards={visible} covers={covered} settings={settings} label={t('photo_alt', { name: photoName })} />
            <button type="button" className="photo-expand" aria-label={t('photo_expand', { name: photoName })} onClick={() => setView({ card: null, side: 0, open: true })}>
              <Icon name="expand" size={16} />
            </button>
          </div>
        </div>

        <div className="photo-panel-main">
          {visible.length ? actions(true) : null}

          {locked || visible.length === 0 ? null : (
            <div className="photo-setall" role="group" aria-labelledby={`setall-${batch.id}`}>
              <span className="photo-setall-label" id={`setall-${batch.id}`}>{t('bulk_label')}</span>
              <button type="button" className="ui-btn photo-setall-foil" onClick={() => scanner.setAllFoil(batch.id, true)}>{t('bulk_all_foil')}</button>
              <button type="button" className="ui-btn ui-btn--ink" onClick={() => scanner.setAllFoil(batch.id, false)}>{t('bulk_all_nonfoil')}</button>
            </div>
          )}

          {cardData.length ? (
            <div className="photo-tiles">
              {cardData.map(cd => (
                <CardRow
                  key={cd.origIdx}
                  cd={cd}
                  added={isAdded(cd)}
                  adding={adding.has(cd.origIdx) || batch.scanId == null}
                  locked={locked}
                  live={live}
                  unsure={!locked && !cd.isManual && cd.card.version_source === 'embedding' && !batch.versionOk[cd.origIdx]}
                  settings={settings}
                  t={t}
                  onView={side => setView({ card: cd.origIdx, side, open: true })}
                  onLooksRight={() => onLooksRight(cd.origIdx)}
                  onToggleAdded={() => toggleAdded(cd)}
                  onEditPrice={() => setEdit(s => ({ idx: cd.origIdx, n: (s?.n ?? 0) + 1, open: true }))}
                  onChangeCard={() => onChangeCard(cd.origIdx)}
                  onQuantity={qty => scanner.setQuantity(batch.id, cd.origIdx, qty)}
                  onRemove={() => remove(cd)}
                  onRestore={() => scanner.setRemoved(batch.id, cd.origIdx, false)}
                />
              ))}
            </div>
          ) : <p className="photo-empty">{t('photo_no_cards')}</p>}

          {locked || batch.scanId == null ? null : (
            <button type="button" className="ui-btn ui-btn--plain photo-add-missing" onClick={onAddMissing}>
              <Icon name="plus" size={18} />{t('add_card_title')}
            </button>
          )}

          {visible.length ? (
            <div className="photo-total">
              <span className="photo-total-label">{t('total')} · {cardsLabel(totalQty)}</span>
              <span className="photo-total-amount" aria-live="polite">{approxTotal ? <span className="photo-approx">≈</span> : null}{formatMyr(total, settings)}</span>
              {unpriced ? <span className="photo-total-note">{t(unpriced === 1 ? 'photo_total_unpriced_one' : 'photo_total_unpriced', { n: unpriced })}</span> : null}
            </div>
          ) : null}
          {locked || visible.length === 0 ? null : (
            <p className="photo-check-note"><Icon name="warning" size={16} />{t('photo_check_note')}</p>
          )}
          {visible.length > ACTIONS_AGAIN_AFTER ? actions(false) : null}
        </div>
      </div>

      {view?.card === null ? (
        <PhotoViewer
          open={view.open} onClose={() => setView(v => (v ? { ...v, open: false } : v))}
          label={t('photo_expand', { name: photoName })} closeLabel={t('voucher_close')}
          media={<BatchPreview src={data.image_b64} width={data.width} height={data.height} cards={visible} covers={covered} settings={settings} label={t('photo_alt', { name: photoName })} className="is-full" />}
        >
          <p className="ui-viewer-caption photo-viewer-caption"><strong>{photoName}</strong>{photoNumber != null ? <span>{batch.filename}</span> : null}</p>
        </PhotoViewer>
      ) : null}
      {view && viewed ? (
        <CardViewer
          key={`${view.card}-${view.side}`}
          cd={viewed} open={view.open} start={view.side} locked={locked} t={t}
          onClose={() => setView(v => (v ? { ...v, open: false } : v))}
          onChangeCard={() => onChangeCard(viewed.origIdx)}
        />
      ) : null}
      {edit ? (
        <AdjustPanel
          key={edit.n} open={edit.open} batch={batch} idx={edit.idx} live={live} settings={settings} t={t}
          onClose={() => setEdit(s => (s ? { ...s, open: false } : s))}
          onSave={e => savePrice(edit.idx, e)}
        />
      ) : null}
    </section>
  );
}
