import { useCallback, useEffect, useRef, useState } from 'react';
import { frameCard } from '../../api.ts';
import { ActiveBatchView } from '../../components/ActiveBatchView.tsx';
import { Breadcrumbs } from '../../components/Breadcrumbs.tsx';
import { useDialog } from '../../components/DialogProvider.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PrintingsModal } from '../../components/PrintingsModal.tsx';
import { folderOf, POSTS } from '../../routes.ts';
import type { Batch, Candidate } from '../../types.ts';
import { matchThumbs } from '../../utils.ts';
import { keyTaken, type Area } from './area.tsx';

// One photo: its cards as tiles, with previous and next through its post.
export function PhotoPage({ area, batch }: { area: Area; batch: Batch }) {
  const {
    t, scanner, pricingFor, go, openFolder, postsById, postTitle, numbers,
    sharePhone, ready, finishing, share, finishPhoto, deliverPhoto, editPrices, refreshScanPrices,
    deletePhotos, liveNavIds, navIndex, step,
  } = area;
  const dialog = useDialog();
  const folder = folderOf(batch.postId);
  const [printingsCtx, setPrintingsCtx] = useState<{ batchId: string; idx: number } | null>(null);

  // "Photo 2 of 2": the photo's place in its post, once it is saved.
  const photoNumber = numbers.get(batch.id);
  const photosInPost = [...numbers.keys()].filter(id => scanner.batches.find(b => b.id === id)?.postId === batch.postId).length;
  const photoCrumb = photoNumber != null ? t('photo_n', { n: photoNumber }) : t('crumbs_photo_one');
  const photoTitle = photoNumber != null ? t('photo_n_of', { n: photoNumber, total: photosInPost }) : t('crumbs_photo_one');

  // Warm the cache with the next and previous photos' match images, so a step shows them at once.
  const neighbourThumbs = (navIndex < 0 ? [] : [liveNavIds[navIndex - 1], liveNavIds[navIndex + 1]])
    .flatMap(id => { const b = scanner.batches.find(x => x.id === id); return b ? matchThumbs(b) : []; })
    .join('\n');
  useEffect(() => {
    for (const src of neighbourThumbs.split('\n')) if (src) new Image().src = src;
  }, [neighbourThumbs]);

  // Keyboard: ← / → previous and next photo, Esc back to the post. Never
  // while typing or under a popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The expanded photo answers Esc itself and is no popup to popupOpen() yet.
      if (keyTaken(e) || document.querySelector('.preview-cell.expanded')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'Escape') go({ page: 'post', folder });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, go, folder]);

  // Swipe left/right on the photo's header to step, like a photo roll. Kept
  // to the header so it can't fight dragging a price pill or scrolling a row.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // A card the scan missed: the seller names it, picks its version, then
  // drags its price label onto it (the label starts in the middle of the photo).
  const addMissingCard = useCallback(async () => {
    if (batch.scanId == null || !batch.response) return;
    const name = await dialog.prompt({ title: t('add_card_title'), message: t('add_card_msg'), placeholder: 'Sol Ring', okLabel: t('add_card_ok') });
    if (!name?.trim()) return;
    const { width: w, height: h } = batch.response;
    const cw = Math.round(Math.min(w, h) * 0.18), ch = Math.round(cw * 1.395);
    const x = Math.round((w - cw) / 2), y = Math.round((h - ch) / 2);
    try {
      const card = await frameCard(batch.scanId, [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]], true);
      const idx = batch.response.cards.length;
      scanner.appendFramedCard(batch.id, card);
      await scanner.relookupByName(batch.id, idx, name, t);
      await dialog.alert({ title: t('add_card_title'), message: t('add_card_next') });
      setPrintingsCtx({ batchId: batch.id, idx });
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [batch, dialog, scanner, t]);

  const onPickPrinting = (printing: Candidate) => {
    if (!printingsCtx) return;
    scanner.replaceCandidate(printingsCtx.batchId, printingsCtx.idx, {
      ...printing,
      _lookup_failed: false,
      _manual: false,
    });
    // The seller chose this printing, so the "check the version" notice is answered.
    scanner.confirmVersion(printingsCtx.batchId, printingsCtx.idx);
    scanner.setRelookupMsg(printingsCtx.batchId, printingsCtx.idx, {
      type: 'ok',
      text: t('modal_switched', { name: printing.set_name || printing.set || '' }),
    });
    setPrintingsCtx(null);
  };

  const printingsBatch = printingsCtx ? scanner.batches.find(b => b.id === printingsCtx.batchId) : undefined;
  const printingsCard = printingsCtx ? printingsBatch?.response?.cards[printingsCtx.idx]?.candidates[0] : undefined;

  return (
    <section>
      <div
        className="photo-head"
        onTouchStart={e => { swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={e => {
          const from = swipeStart.current; swipeStart.current = null;
          if (!from) return;
          const dx = e.changedTouches[0].clientX - from.x;
          const dy = e.changedTouches[0].clientY - from.y;
          if (Math.abs(dx) > 60 && Math.abs(dy) < 40) step(dx < 0 ? 1 : -1);
        }}
      >
        <div className="photo-nav">
          <Breadcrumbs items={[
            { label: t('scans_title'), to: POSTS },
            ...(openFolder ? [{ label: openFolder.title, to: { page: 'post' as const, folder: openFolder.key } }] : []),
            { label: photoCrumb },
          ]} />
        </div>
        <div className="review-head">
          <div className="review-title"><h1 className="page-title">{photoTitle}</h1></div>
          <span className="photo-nav-steps">
            <button
              type="button" className="round-btn"
              aria-label={t('scans_prev')} title={`${t('scans_prev')} (←)`}
              disabled={navIndex <= 0}
              onClick={() => step(-1)}
            ><Icon name="chevronLeft" size={18} /></button>
            <button
              type="button" className="round-btn"
              aria-label={t('scans_next')} title={`${t('scans_next')} (→)`}
              disabled={navIndex < 0 || navIndex >= liveNavIds.length - 1}
              onClick={() => step(1)}
            ><Icon name="chevronRight" size={18} /></button>
            <button
              type="button" className="round-btn destructive"
              aria-label={t('scans_delete_photo')} title={t('scans_delete_photo')}
              onClick={() => deletePhotos([batch.id])}
            ><Icon name="trash" size={18} /></button>
          </span>
        </div>
      </div>
      <ActiveBatchView
        photoNumber={photoNumber ?? null}
        live={pricingFor(batch.postId).priceMode === 'live'}
        batch={batch}
        settings={pricingFor(batch.postId)}
        scanner={scanner}
        t={t}
        onBrowsePrintings={idx => setPrintingsCtx({ batchId: batch.id, idx })}
        postTitle={batch.postId != null && postsById.has(batch.postId) ? postTitle(postsById.get(batch.postId)!) : null}
        sharePhone={sharePhone}
        busy={finishing === batch.id}
        shareReady={ready?.key === batch.id ? ready.files.length : 0}
        onFinish={() => finishPhoto(batch)}
        onDeliver={() => deliverPhoto(batch)}
        onShare={share}
        onEditPrices={() => editPrices(batch)}
        onRefreshPrices={() => refreshScanPrices(batch)}
        onAddCard={addMissingCard}
      />
      {/* The same previous / next as the top, so a long card list needn't scroll back. */}
      <nav className="photo-steps-bottom" aria-label={t('scans_title')}>
        {(['prev', 'next'] as const).map(dir => {
          const at = navIndex + (dir === 'prev' ? -1 : 1);
          const id = navIndex >= 0 ? liveNavIds[at] : undefined;
          const n = id ? numbers.get(id) : undefined;
          return (
            <button key={dir} type="button" className={`photo-step ${dir}`} disabled={!id} onClick={() => step(dir === 'prev' ? -1 : 1)}>
              {dir === 'prev' ? <Icon name="chevronLeft" size={18} /> : null}
              <span>
                <span className="photo-step-dir">{t(dir === 'prev' ? 'scans_prev' : 'scans_next')}</span>
                {n ? <strong>{t('photo_n', { n })}</strong> : null}
              </span>
              {dir === 'next' ? <Icon name="chevronRight" size={18} /> : null}
            </button>
          );
        })}
      </nav>

      <PrintingsModal
        open={!!printingsCtx}
        cardName={printingsCard?.name || ''}
        currentSid={printingsCard?.scryfall_id || ''}
        onClose={() => setPrintingsCtx(null)}
        onSelect={onPickPrinting}
        busy={!!printingsBatch?.relookupBusy[printingsCtx!.idx]}
        msg={printingsBatch?.relookupMsg[printingsCtx!.idx] ?? null}
        onFind={name => printingsCtx && scanner.relookupByName(printingsCtx.batchId, printingsCtx.idx, name, t)}
        onUseAsIs={name => { if (printingsCtx) { scanner.useAsIs(printingsCtx.batchId, printingsCtx.idx, name, t); setPrintingsCtx(null); } }}
        t={t}
      />
    </section>
  );
}
