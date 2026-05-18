import { useMemo, useState } from 'react';
import { addToChecklist, exportImage, frameCard } from '../api.ts';
import { postsApi, type Post } from '../api/checklist.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Batch, CardRowData, Settings } from '../types.ts';
import { applyRounding, ckSearchUrl, formatMyrWithFoil } from '../utils.ts';
import { BatchPreview } from './BatchPreview.tsx';
import { CardRow } from './CardRow.tsx';
import { useDialog } from './DialogProvider.tsx';

interface Props {
  batch: Batch;
  settings: Settings;
  scanner: ScannerStore;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onZoom: (src: string, caption: string) => void;
  onBrowsePrintings: (idx: number) => void;
  posts: Post[];
  selectedPostId: number | null;
  onSelectPost: (postId: number | null) => void;
  onPostsChanged: () => void;
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
  posts, selectedPostId, onSelectPost, onPostsChanged,
}: Props) {
  const dialog = useDialog();
  // Track which cards have already been pushed to the checklist (origIdx → listing id)
  const [addedIdx, setAddedIdx] = useState<Record<number, number>>({});

  // Compute per-card row data unconditionally. Hooks must not run conditionally.
  const cardData = useMemo<CardRowData[]>(() => {
    if (!batch.response) return [];
    return batch.response.cards.map((c, origIdx) => {
      const sel = c.candidates[0] || ({} as never);
      const isManual = !!sel._manual;
      const isFoil = batch.isFoil[origIdx] ?? false;
      const removed = !!batch.removed[origIdx];
      const usd = isFoil ? (sel.usd_foil || sel.usd || 0) : (sel.usd || 0);
      const globalMult = isFoil ? settings.multFoil : settings.multNormal;
      const multRaw = batch.multOverride[origIdx];
      const hasMultOverride = multRaw != null && !isNaN(multRaw);
      const mult = hasMultOverride ? (multRaw as number) : globalMult;
      const qty = Math.max(1, batch.quantity[origIdx] || 1);
      const overrideRaw = batch.priceOverride[origIdx];
      const hasOverride = overrideRaw != null && overrideRaw !== '';
      // CK is the only price source. If the chosen side has no CK row we don't
      // auto-price — the user must enter manually. Skipping applyRounding here
      // is what bypasses the RM 1 floor and surfaces "needs price" so we never
      // ship a fake RM 1 sticker on something we couldn't actually look up.
      const ckSourceMatched = isFoil
        ? sel.price_source_foil === 'cardkingdom'
        : sel.price_source_normal === 'cardkingdom';
      const autoPrice = ckSourceMatched ? applyRounding(usd * mult, settings) : 0;
      const needsPrice = !hasOverride && (isManual || !ckSourceMatched);
      const unitPrice = hasOverride
        ? (parseFloat(overrideRaw as string) || 0)
        : needsPrice ? NaN : autoPrice;
      const lineTotal = isFinite(unitPrice) ? unitPrice * qty : 0;
      const source = isManual
        ? 'manual'
        : (isFoil
          ? (sel.price_source_foil || 'none')
          : (sel.price_source_normal || 'none')) as CardRowData['source'];
      return {
        card: c, sel, origIdx, removed,
        isFoil, isManual, needsPrice,
        usd, mult, globalMult, hasMultOverride,
        autoPrice, qty, unitPrice, hasOverride, lineTotal, source,
        pillOffset: batch.pillOffset?.[origIdx] ?? null,
      };
    });
  }, [batch, settings]);

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
          <span className="meta" style={{ color: 'var(--warn)' }}>{t('error')}</span>
        </div>
        <p className="status error">{batch.error || t('unknown_error')}</p>
      </div>
    );
  }

  const data = batch.response;
  const visible = cardData.filter(cd => !cd.removed);
  const removed = cardData.filter(cd => cd.removed);
  const totalQty = visible.reduce((s, cd) => s + cd.qty, 0);
  const visibleCount = visible.length;
  const needsPriceCount = visible.filter(cd => cd.needsPrice).length;

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

  // POST a single card row to /api/listings, remembering it succeeded
  // so the button can show its "added" state.
  const addOneToList = async (cd: CardRowData) => {
    if (!isFinite(cd.unitPrice) || cd.unitPrice <= 0) {
      await dialog.alert({ title: t('alert_error_title'), message: t('add_to_list_failed', { err: 'no price set' }) });
      return;
    }
    try {
      const ckDirect = cd.isFoil
        ? (cd.sel.ck_url_foil || cd.sel.ck_url_normal || '')
        : (cd.sel.ck_url_normal || cd.sel.ck_url_foil || '');
      // Fall back to CK search-by-name if there's no direct product URL, so
      // the saved listing carries *some* CK link rather than going to Scryfall.
      const ck = ckDirect || ckSearchUrl(cd.sel.name || '');
      const result = await addToChecklist({
        name: cd.sel.name || '(unknown)',
        scryfall_id: cd.sel.scryfall_id || null,
        set_code: cd.sel.set || null,
        set_name: cd.sel.set_name || null,
        collector_number: cd.sel.collector_number || null,
        rarity: cd.sel.rarity || null,
        is_foil: cd.isFoil,
        image_url: cd.sel.image_url || null,
        ck_url: ck || null,
        unit_price_myr: cd.unitPrice.toFixed(2),
        qty_total: cd.qty,
        post_ids: selectedPostId != null ? [selectedPostId] : [],
      });
      setAddedIdx(prev => ({ ...prev, [cd.origIdx]: result.id }));
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: t('add_to_list_failed', { err: (e as Error).message }) });
    }
  };

  // "Add all to checklist" — runs sequentially so we get clean errors per card
  const addAllToList = async () => {
    for (const cd of visible) {
      if (addedIdx[cd.origIdx]) continue;
      if (!isFinite(cd.unitPrice) || cd.unitPrice <= 0) continue;
      try {
        const ck = cd.isFoil
          ? (cd.sel.ck_url_foil || cd.sel.ck_url_normal || '')
          : (cd.sel.ck_url_normal || cd.sel.ck_url_foil || '');
        const result = await addToChecklist({
          name: cd.sel.name || '(unknown)',
          scryfall_id: cd.sel.scryfall_id || null,
          set_code: cd.sel.set || null,
          set_name: cd.sel.set_name || null,
          collector_number: cd.sel.collector_number || null,
          rarity: cd.sel.rarity || null,
          is_foil: cd.isFoil,
          image_url: cd.sel.image_url || null,
          ck_url: ck || null,
          unit_price_myr: cd.unitPrice.toFixed(2),
          qty_total: cd.qty,
          post_ids: selectedPostId != null ? [selectedPostId] : [],
        });
        setAddedIdx(prev => ({ ...prev, [cd.origIdx]: result.id }));
      } catch (e) {
        // Skip failures but warn at the end if any happened
        console.error('Add failed for', cd.sel.name, e);
      }
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
      const created = await postsApi.create({
        title: title.trim() || defaultTitle,
        image: imageFile,
      });
      onPostsChanged();
      onSelectPost(created.id);
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: t('scanner_post_create_failed', { err: (e as Error).message }) });
    }
  };

  const doExport = async () => {
    const payload = {
      image_id: data.image_id,
      show_outlines: settings.showOutlines,
      label_position: settings.labelPosition,
      font_scale: settings.labelFontScale,
      cards: visible.map(cd => {
        // Suffix mode bakes "F" into the label; gold mode leaves it off and the pill renders gold.
        const unitLabel = formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings);
        const label = cd.qty > 1 ? `${unitLabel} ×${cd.qty}` : unitLabel;
        return {
          bbox: cd.card.bbox,
          corners: cd.card.corners,
          is_foil: cd.isFoil && settings.foilStyle === 'gold',
          label_override: label,
          pill_dx: cd.pillOffset?.dx,
          pill_dy: cd.pillOffset?.dy,
        };
      }),
    };
    try {
      const blob = await exportImage(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = batch.filename.replace(/\.[^.]+$/, '') + '_priced.png';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: 'Export failed: ' + (e as Error).message });
    }
  };

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
          </div>
          <div className="export-warning">
            <span className="warn-icon">⚠</span>
            <span>{t('export_warning')}</span>
          </div>

          {/* Finalize block: pick/create a post, add all reviewed cards to it,
              export the priced image, jump back to the top for the next scan.
              Sits at the bottom because every action here is post-review. */}
          <div className="finalize-block">
            <div className="finalize-step">
              <span className="finalize-num">1</span>
              <div className="finalize-body">
                <div className="finalize-title">{t('scanner_finalize_step1')}</div>
                <div className="scan-post-bar">
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
                        {p.fb_url ? ' · 🔗' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ghost"
                    onClick={createPostFromScan}
                    title={t('scanner_post_new_title')}
                  >{t('scanner_post_new_btn')}</button>
                </div>
                {selectedPostId != null ? (
                  <span className="scan-post-hint">{t('scanner_post_selected_hint')}</span>
                ) : (
                  <span className="scan-post-hint muted">{t('scanner_post_unselected_hint')}</span>
                )}
              </div>
            </div>

            <div className="finalize-step">
              <span className="finalize-num">2</span>
              <div className="finalize-body">
                <div className="finalize-title">{t('scanner_finalize_step2')}</div>
                <button
                  className="accent"
                  onClick={addAllToList}
                  disabled={visible.every(cd => addedIdx[cd.origIdx])}
                >+ {t('add_all_to_list')}</button>
              </div>
            </div>

            <div className="finalize-step">
              <span className="finalize-num">3</span>
              <div className="finalize-body">
                <div className="finalize-title">{t('scanner_finalize_step3')}</div>
                <div className="finalize-actions">
                  <button className="accent" onClick={doExport}>{t('export_btn')}</button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    title={t('scanner_back_to_top_title')}
                  >{t('scanner_back_to_top')}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
