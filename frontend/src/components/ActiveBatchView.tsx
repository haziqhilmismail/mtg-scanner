import { Icon } from './Icon.tsx';
import { useMemo, useState } from 'react';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Batch, CardRowData, Settings } from '../types.ts';
import { bboxKey, canRetry, computeCardData, formatMyr, notAdded } from '../utils.ts';
import { BatchPreview } from './BatchPreview.tsx';
import { InfoTip } from './InfoTip.tsx';
import { CardRow } from './CardRow.tsx';
import type { T } from '../hooks/useLang.ts';

interface Props {
  batch: Batch;
  // Its "Photo N" in the post order; null while it is not saved yet.
  photoNumber: number | null;
  // A live-price post: no Finish or lock, the photo goes out without prices.
  live: boolean;
  settings: Settings;
  scanner: ScannerStore;
  t: T;
  onBrowsePrintings: (idx: number) => void;
  // The post the photo is in (null when unfiled): its cards are added there.
  postTitle: string | null;
  // Finishing lives in Scanner.tsx (the post view finishes many photos the
  // same way); this component triggers it. A finished photo's image is then
  // shared (phone) or downloaded (PC) when the seller asks.
  sharePhone: boolean;
  // A finish, download or share is being prepared for this photo.
  busy: boolean;
  // How many rendered images wait for a tap to share (0: none).
  shareReady: number;
  onFinish: () => void;
  onDeliver: () => void;
  onShare: () => void;
  onEditPrices: () => void;
  // Re-queries CK for this scan's cards. Disabled until the batch has a
  // scanId (server-side save complete). The button manages its own busy
  // state locally — Scanner.tsx doesn't need a global flag for it.
  onRefreshPrices: () => Promise<void>;
  // A card the scan missed: named, its version picked, its label dragged on.
  onAddCard: () => void;
}

export function ActiveBatchView({
  batch, photoNumber, live, settings, scanner, t, onBrowsePrintings,
  postTitle, sharePhone, busy, shareReady, onFinish, onDeliver, onShare, onEditPrices, onRefreshPrices, onAddCard,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);


  // Compute per-card row data unconditionally. Hooks must not run conditionally.
  // The actual computation lives in utils.ts so Scanner's bulk handlers can
  // derive the same pricing/quantity rows for any batch they need to operate on.
  const cardData = useMemo<CardRowData[]>(
    () => computeCardData(batch, settings),
    [batch, settings],
  );

  if (batch.status === 'scanning') {
    return (
      <div className="batch-image">
        <div className="batch-image-head">
          <span className="name">{batch.filename}</span>
          <span className="meta loading">{t('scanning')}</span>
        </div>
      </div>
    );
  }
  if (batch.status === 'error' || !batch.response) {
    const failed = scanner.batches.filter(canRetry);
    return (
      <div className="batch-image">
        <div className="batch-image-head">
          <span className="name">{batch.filename}</span>
          <span className="meta" style={{ color: 'var(--warn)' }}>
            {batch.outOfCredits ? t('tab_status_no_credits') : t('error')}
          </span>
        </div>
        <p className="status error">
          {batch.outOfCredits ? t('scan_no_credits') : (batch.error || t('unknown_error'))}
        </p>
        {canRetry(batch) && (
          <div className="finalize-action-row">
            <button type="button" className="accent" onClick={() => scanner.retryBatches([batch.id])}>
              <Icon name="refresh" size={18} />{t('scan_retry')}
            </button>
            {failed.length > 1 && (
              <button type="button" onClick={() => scanner.retryBatches(failed.map(b => b.id))}>
                {t('scan_retry_all', { n: failed.length })}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const data = batch.response;
  const visible = cardData.filter(cd => !cd.removed);
  const removed = cardData.filter(cd => cd.removed);
  const totalQty = visible.reduce((s, cd) => s + cd.qty, 0);
  const visibleCount = visible.length;
  const needsPriceCount = visible.filter(cd => cd.needsPrice).length;
  // Priced value of this image. lineTotal already collapses unpriced cards to 0,
  // so this is the sum of everything we can actually price — and it recomputes
  // with the multiplier because computeCardData() reads settings.mult*.
  const priceTotal = visible.reduce((s, cd) => s + (isFinite(cd.lineTotal) ? cd.lineTotal : 0), 0);

  let totalLabel = `${t('total')} · ${totalQty} ${t('cards')}`;
  if (totalQty !== visibleCount) {
    totalLabel = `${t('total')} · ${totalQty} ${t('cards')} (${visibleCount} ${t('unique')})`;
  }
  if (needsPriceCount > 0) {
    totalLabel += ` · ${needsPriceCount} ${t('need_price')}`;
  }

  const headerCount = visibleCount === data.cards.length
    ? `${data.cards.length} ${t('cards')}`
    : `${visibleCount} / ${data.cards.length} ${t('cards')}`;

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefreshPrices(); }
    finally { setRefreshing(false); }
  };

  const isAdded = (cd: CardRowData) => batch.listed.includes(bboxKey(cd.card.bbox));


  // Single source of truth for the refresh button — rendered the same way
  // at both top and bottom finalize blocks. Sized like the other action
  // buttons (Add / Export), `ghost` styling so it reads as secondary.
  const refreshButton = batch.scanId != null ? (
    <button
      type="button"
      className="ghost"
      disabled={refreshing}
      onClick={handleRefresh}
    ><Icon name="refresh" size={18} />{refreshing ? t('scan_refresh_prices_busy') : t('scan_refresh_prices')}</button>
  ) : null;

  // Shared finalize-block content, at the top of the card list and again at
  // the bottom so a phone needn't scroll to act. Until the photo is finished
  // the hint says what Finish does (prices lock, but can be edited); after,
  // that its prices are locked and how to change them.
  const locked = !!batch.lockedAt;
  const post = postTitle ?? t('scans_unfiled');
  // A text with the post's name shown as a name: posts are usually called by
  // the date and time they were made, which reads like part of the sentence.
  const withPost = (key: string, vars: Record<string, string> = {}) => {
    const [before, after = ''] = t(key, { ...vars, post: '\u0000' }).split('\u0000');
    return <span>{before}<strong className="post-name">{post}</strong>{after}</span>;
  };
  const pending = notAdded(batch, visible).length;
  const imageButton = shareReady > 0 ? (
    <button className="accent" onClick={onShare}><Icon name="share" size={18} />{t('share_photo')}</button>
  ) : (
    <button className={live && pending > 0 ? '' : 'accent'} disabled={busy} onClick={onDeliver}>
      <Icon name={sharePhone ? 'share' : 'download'} size={18} />
      {busy ? t('finish_busy') : t(sharePhone ? 'share_image' : 'download_image')}
    </button>
  );
  const finalizeContent = live ? (
    <>
      <span className="scan-post-hint finish-hint"><Icon name="bolt" size={16} />{withPost('live_hint')}</span>
      <div className="finalize-action-row">
        {pending > 0 ? (
          <button className="accent" disabled={busy} onClick={onFinish}><Icon name="addList" size={18} />{t('live_add_all')}</button>
        ) : null}
        {imageButton}
        {refreshButton}
      </div>
    </>
  ) : (
    <>
      <span className={`scan-post-hint ${locked ? 'is-locked' : 'finish-hint'}`}>
        <Icon name="lock" size={16} />
        {locked
          ? withPost('locked_hint', { date: new Date(batch.lockedAt!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })
          : withPost('finish_hint')}
      </span>
      <div className="finalize-action-row">
        {shareReady > 0 || locked ? imageButton : (
          <>
            <button className="accent" disabled={busy} onClick={onFinish}>
              <Icon name="lock" size={18} />
              {busy ? t('finish_busy') : t('finish_btn')}
            </button>
            <InfoTip label={t('finish_explain_title')} text={t('finish_explain_msg')} />
          </>
        )}
        {locked ? (
          <button className="ghost" disabled={busy} onClick={onEditPrices}><Icon name="edit" size={18} />{t('edit_prices')}</button>
        ) : refreshButton}
      </div>
    </>
  );

  return (
    <div className="batch-image">
      <div className="batch-image-head">
        <span className="name">
          {photoNumber != null ? <>{t('photo_n', { n: photoNumber })}<span className="name-file">{batch.filename}</span></> : batch.filename}
        </span>
        <span className="meta">{headerCount} · {data.width}×{data.height}</span>
      </div>
      <div className="batch-body">
        <BatchPreview
          imageB64={data.image_b64}
          width={data.width}
          height={data.height}
          visibleCards={visible}
          settings={settings}
          t={t}
        />
        <div>
          {/* Top finalize block — same content as the bottom one so mobile
              users with long card lists can act without scrolling. */}
          <div className="finalize-block finalize-block-top">
            {finalizeContent}
          </div>

          {locked ? null : <div className="bulk-bar">
            <span className="bulk-label">{t('bulk_label')}</span>
            <button
              type="button"
              className="gold"
              onClick={() => scanner.setAllFoil(batch.id, true)}
            >{t('bulk_all_foil')}</button>
            <button
              type="button"
              onClick={() => scanner.setAllFoil(batch.id, false)}
            >{t('bulk_all_nonfoil')}</button>
          </div>}
          <div className="card-list">
            {visible.map(cd => (
              <CardRow
                key={cd.origIdx}
                cd={cd}
                photoNumber={photoNumber}
                added={isAdded(cd)}
                locked={locked}
                live={live}
                versionOk={batch.versionOk[cd.origIdx]}
                settings={settings}
                t={t}
                onVersionOk={() => scanner.looksRight(batch.id, cd.origIdx)}
                onRemove={() => scanner.setRemoved(batch.id, cd.origIdx, true)}
                onQtyStep={(d) => scanner.stepQuantity(batch.id, cd.origIdx, d)}
                onMultStep={(d) => scanner.stepMult(batch.id, cd.origIdx, d, cd.globalMult)}
                onMultClear={() => scanner.setMultOverride(batch.id, cd.origIdx, null)}
                onFoilToggle={() => scanner.toggleFoil(batch.id, cd.origIdx)}
                onPriceChange={(v) => scanner.setPriceOverride(batch.id, cd.origIdx, v)}
                onClearOverride={() => scanner.setPriceOverride(batch.id, cd.origIdx, null)}
                onChangeCard={() => onBrowsePrintings(cd.origIdx)}
              />
            ))}
          </div>

          {locked || batch.scanId == null ? null : (
            <button type="button" className="ghost add-card-btn" onClick={onAddCard}>
              <Icon name="plus" size={18} />{t('add_card_title')}
            </button>
          )}

          {removed.length > 0 && !locked ? (
            <div className="removed-strip">
              <span className="label">{t('removed_label')} · {removed.length}</span>
              {removed.map(cd => (
                <button
                  key={cd.origIdx}
                  type="button"
                  className="restore-chip"
                  title={cd.sel.name || ''}
                  onClick={() => scanner.setRemoved(batch.id, cd.origIdx, false)}
                >
                  #{cd.origIdx + 1} ↶
                </button>
              ))}
              <button
                type="button"
                className="restore-all"
                onClick={() => scanner.restoreAll(batch.id)}
              >
                {t('restore_all')}
              </button>
            </div>
          ) : null}

          <div className="totals">
            <span>{totalLabel}</span>
            <span className="total-price">{formatMyr(priceTotal, settings)}</span>
          </div>
{locked ? null : (
          <div className="export-warning">
            <Icon name="warning" className="warn-icon" />
            <span>{t('export_warning')}</span>
          </div>
          )}

          {/* Bottom finalize block — same content, same handlers, kept here
              so users who've scrolled all the way down don't need to scroll
              back up. */}
          <div className="finalize-block">
            {finalizeContent}
          </div>
        </div>
      </div>
    </div>
  );
}
