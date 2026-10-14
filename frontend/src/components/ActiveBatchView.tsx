import { Icon } from './Icon.tsx';
import { useMemo, useRef, useState } from 'react';
import { frameCard } from '../api.ts';
import { listingsApi, type Post } from '../api/checklist.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Batch, CardRowData, Settings } from '../types.ts';
import { computeCardData, formatMyr, listingFields } from '../utils.ts';
import { BatchPreview } from './BatchPreview.tsx';
import { CardRow } from './CardRow.tsx';
import { useDialog } from './DialogProvider.tsx';
import type { T } from '../hooks/useLang.ts';

interface Props {
  batch: Batch;
  settings: Settings;
  scanner: ScannerStore;
  t: T;
  onZoom: (src: string, caption: string) => void;
  onBrowsePrintings: (idx: number) => void;
  posts: Post[];
  selectedPostId: number | null;
  onSelectPost: (postId: number | null) => void;
  onPostsChanged: () => void;
  createPost: PricingStore['createPost'];
  // Lifted from Scanner.tsx so bulk callers can dedupe and so the "added"
  // badge survives batch-tab switches.
  addedIdx: Record<number, number>;
  onMarkAdded: (origIdx: number, listingId: number) => void;
  // Add-all and export now live in Scanner.tsx so the page-level bulk strip
  // can replay them against any batch. This component just triggers them.
  onAddAll: () => Promise<void>;
  // True while this batch's add-all (or the page-level bulk add) is running.
  // Drives the button's loading label and disables it so a double-click can't
  // fire a second add — re-adding is otherwise always allowed.
  addAllBusy: boolean;
  onExport: () => Promise<void>;
  // Re-queries CK for this scan's cards. Disabled until the batch has a
  // scanId (server-side save complete). The button manages its own busy
  // state locally — Scanner.tsx doesn't need a global flag for it.
  onRefreshPrices: () => Promise<void>;
}

// Convert a data: URL (the preview the backend returns) into a File so we
// can multipart-upload it as a post's reminder image without an extra HTTP
// round-trip to the server.
async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

export function ActiveBatchView({
  batch, settings, scanner, t, onZoom, onBrowsePrintings,
  posts, selectedPostId, onSelectPost, onPostsChanged, createPost,
  addedIdx, onMarkAdded, onAddAll, addAllBusy, onExport, onRefreshPrices,
}: Props) {
  const dialog = useDialog();
  const [refreshing, setRefreshing] = useState(false);

  // Synchronous re-entry guard for per-card adds. React's `disabled={added}`
  // updates on the next render, which can be slower than a real double-click.
  // This ref flips immediately, blocks the second click in the same JS tick.
  const cardAddInFlightRef = useRef<Set<number>>(new Set());

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

  // POST a single card row to /api/listings, remembering it succeeded
  // so the button can show its "added" state. Skips when this card is
  // already added or has a POST in flight from a same-tick double-click.
  const addOneToList = async (cd: CardRowData) => {
    if (addedIdx[cd.origIdx]) return;
    if (cardAddInFlightRef.current.has(cd.origIdx)) return;
    if (!isFinite(cd.unitPrice) || cd.unitPrice <= 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('add_to_list_failed', { err: 'no price set' }) });
      return;
    }
    cardAddInFlightRef.current.add(cd.origIdx);
    try {
      const result = await listingsApi.create({
        ...listingFields(cd),
        post_ids: selectedPostId != null ? [selectedPostId] : [],
      });
      onMarkAdded(cd.origIdx, result.id);
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: t('add_to_list_failed', { err: (e as Error).message }) });
    } finally {
      cardAddInFlightRef.current.delete(cd.origIdx);
    }
  };

  // Create a new Post seeded with this scan's preview image so it doubles as
  // the post's reminder photo. We use the data: URL the backend already
  // baked into the response — no extra round-trip needed.
  const createPostFromScan = async () => {
    const defaultTitle = batch.filename.replace(/\.[^.]+$/, '');
    const title = await dialog.prompt({
      title: t('scanner_post_prompt_title'),
      defaultValue: defaultTitle,
      placeholder: defaultTitle,
      okLabel: t('scanner_post_prompt_ok'),
    });
    if (title == null) return;  // user cancelled
    try {
      let imageFile: File | null = null;
      if (batch.response?.image_b64) {
        imageFile = await dataUrlToFile(batch.response.image_b64, `${defaultTitle}.jpg`);
      }
      const created = await createPost({
        title: title.trim() || defaultTitle,
        image: imageFile,
      });
      onPostsChanged();
      onSelectPost(created.id);
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: t('scanner_post_create_failed', { err: (e as Error).message }) });
    }
  };

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

  // Shared finalize-block content. Rendered once at the top of the card list
  // and once at the bottom so mobile users don't have to scroll past long
  // card lists to act. The picker + button state are bound to the same props,
  // so both copies stay in sync automatically.
  const finalizeContent = (
    <>
      <div className="finalize-picker-row">
        <span className="scan-post-label">{t('scanner_post_label')}</span>
        <select
          className="scan-post-select"
          value={selectedPostId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onSelectPost(v === '' ? null : parseInt(v, 10));
          }}
        >
          <option value="">{t('scanner_post_none')}</option>
          {posts.map(p => (
            <option key={p.id} value={p.id}>
              {p.title || `#${p.id}`}
              {p.fb_url ? ' · link' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ghost"
          onClick={createPostFromScan}
          title={t('scanner_post_new_title')}
        ><Icon name="plus" size={16} />{t('scanner_post_new_btn')}</button>
      </div>
      {selectedPostId != null ? (
        <span className="scan-post-hint">{t('scanner_post_selected_hint')}</span>
      ) : (
        <span className="scan-post-hint muted">{t('scanner_post_unselected_hint')}</span>
      )}
      <div className="finalize-action-row">
        <button className="accent" onClick={onExport}>
          <Icon name="share" size={18} />{t('export_btn')}
        </button>
        <button onClick={onAddAll} disabled={addAllBusy}>
          <Icon name="addList" size={18} />{addAllBusy ? t('add_all_loading') : t('add_all_to_list')}
        </button>
        {refreshButton}
      </div>
    </>
  );

  return (
    <div className="batch-image">
      <div className="batch-image-head">
        <span className="name">{batch.filename}</span>
        <span className="meta">{headerCount} · {data.width}×{data.height}</span>
      </div>
      <div className="batch-body">
        <BatchPreview
          imageB64={data.image_b64}
          width={data.width}
          height={data.height}
          visibleCards={visible}
          settings={settings}
          onPillOffsetChange={(idx, offset) =>
            scanner.setPillOffset(batch.id, idx, offset)
          }
          onFrameCard={batch.scanId != null ? async (corners, skipIdentify) => {
            const newCard = await frameCard(batch.scanId!, corners, skipIdentify);
            scanner.appendFramedCard(batch.id, newCard);
          } : undefined}
          t={t}
        />
        <div>
          {/* Top finalize block — same content as the bottom one so mobile
              users with long card lists can act without scrolling. Picker +
              button state are bound to shared props, so both stay in sync. */}
          <div className="finalize-block finalize-block-top">
            {finalizeContent}
          </div>

          <div className="bulk-bar">
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
          </div>
          <div className="card-list">
            {visible.map(cd => (
              <CardRow
                key={cd.origIdx}
                cd={cd}
                msg={batch.relookupMsg[cd.origIdx] ?? null}
                busy={!!batch.relookupBusy[cd.origIdx]}
                added={!!addedIdx[cd.origIdx]}
                settings={settings}
                t={t}
                onZoom={onZoom}
                onAddToList={() => addOneToList(cd)}
                onRemove={() => scanner.setRemoved(batch.id, cd.origIdx, true)}
                onQtyChange={(q) => scanner.setQuantity(batch.id, cd.origIdx, q)}
                onQtyStep={(d) => scanner.stepQuantity(batch.id, cd.origIdx, d)}
                onMultChange={(m) => scanner.setMultOverride(batch.id, cd.origIdx, m)}
                onMultStep={(d) => scanner.stepMult(batch.id, cd.origIdx, d, cd.globalMult)}
                onMultClear={() => scanner.setMultOverride(batch.id, cd.origIdx, null)}
                onFoilToggle={() => scanner.toggleFoil(batch.id, cd.origIdx)}
                onPriceChange={(v) => scanner.setPriceOverride(batch.id, cd.origIdx, v)}
                onClearOverride={() => scanner.setPriceOverride(batch.id, cd.origIdx, null)}
                onBrowsePrintings={() => onBrowsePrintings(cd.origIdx)}
                onFind={(name) => scanner.relookupByName(batch.id, cd.origIdx, name, t)}
                onUseAsIs={(name) => scanner.useAsIs(batch.id, cd.origIdx, name, t)}
              />
            ))}
          </div>

          {removed.length > 0 ? (
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
          <div className="export-warning">
            <Icon name="warning" className="warn-icon" />
            <span>{t('export_warning')}</span>
          </div>

          {/* Bottom finalize block — same content, same handlers, kept here
              so users who've scrolled all the way down don't need to scroll
              back up. The post picker and action buttons are bound to shared
              state, so changing one updates both. */}
          <div className="finalize-block">
            {finalizeContent}
          </div>
        </div>
      </div>
    </div>
  );
}
