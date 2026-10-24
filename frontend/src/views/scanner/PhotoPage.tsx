import { useCallback, useEffect, useRef, useState } from 'react';
import { frameCard } from '../../api.ts';
import { ActiveBatchView } from '../../components/ActiveBatchView.tsx';
import { Breadcrumbs } from '../../components/Breadcrumbs.tsx';
import { useDialog } from '../../components/DialogProvider.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PrintingsModal } from '../../components/PrintingsModal.tsx';
import { PricingRow } from '../../components/SettingsPanel.tsx';
import { folderOf, POSTS } from '../../routes.ts';
import type { Batch, Candidate } from '../../types.ts';
import { matchThumbs } from '../../utils.ts';
import { keyTaken, type Area } from './area.tsx';

// One photo: its cards as tiles, with previous and next through its post.
export function PhotoPage({ area, batch }: { area: Area; batch: Batch }) {
  const {
    t, lang, scanner, pricing, pricingFor, pricingTitle, go, openFolder, postsById, postTitle, numbers,
    finishing, finishPhoto, deliverPhoto, editPrices, refreshScanPrices, addCard, takeOutCard,
    deletePhotos, liveNavIds, navIndex, step,
  } = area;
  const dialog = useDialog();
  const folder = folderOf(batch.postId);
  const settings = pricingFor(batch.postId);
  const [printingsCtx, setPrintingsCtx] = useState<{ batchId: string; idx: number } | null>(null);

  // "Photo 2 of 2": the photo's place in its post, once it is saved.
  const photoNumber = numbers.get(batch.id);
  const photosInPost = [...numbers.keys()].filter(id => scanner.batches.find(b => b.id === id)?.postId === batch.postId).length;

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
      if (keyTaken(e)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'Escape') go({ page: 'post', folder });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, go, folder]);

  // Swipe left/right on the page's header to step, like a photo roll. Kept
  // to the header so it can't fight scrolling the tiles.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // A card the scan missed: the seller names it, then picks its printing.
  const addMissingCard = useCallback(async () => {
    if (batch.scanId == null || !batch.response) return;
    const name = await dialog.prompt({ title: t('add_card_title'), message: t('add_card_msg'), placeholder: 'Sol Ring', okLabel: t('add_card_ok'), cancelLabel: t('cancel') });
    if (!name?.trim()) return;
    const { width: w, height: h } = batch.response;
    const cw = Math.round(Math.min(w, h) * 0.18), ch = Math.round(cw * 1.395);
    const x = Math.round((w - cw) / 2), y = Math.round((h - ch) / 2);
    try {
      const card = await frameCard(batch.scanId, [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]], true);
      const idx = batch.response.cards.length;
      scanner.appendFramedCard(batch.id, card);
      await scanner.relookupByName(batch.id, idx, name, t);
      await dialog.alert({ title: t('add_card_title'), message: t('add_card_next'), okLabel: t('photo_ok') });
      setPrintingsCtx({ batchId: batch.id, idx });
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message, okLabel: t('photo_ok') });
    }
  }, [batch, dialog, scanner, t]);

  // The seller's answers about the printing: another one picked, or the guess confirmed.
  const pickPrinting = (batchId: string, idx: number, printing: Candidate) => {
    scanner.replaceCandidate(batchId, idx, { ...printing, _lookup_failed: false, _manual: false });
    scanner.confirmVersion(batchId, idx);
  };
  const looksRight = (idx: number) => scanner.confirmVersion(batch.id, idx);

  const printingsBatch = printingsCtx ? scanner.batches.find(b => b.id === printingsCtx.batchId) : undefined;
  const printingsCard = printingsCtx ? printingsBatch?.response?.cards[printingsCtx.idx]?.candidates[0] : undefined;
  const postName = batch.postId != null && postsById.has(batch.postId) ? postTitle(postsById.get(batch.postId)!) : null;

  return (
    <section className="photo-page">
      <div
        onTouchStart={e => { swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={e => {
          const from = swipeStart.current; swipeStart.current = null;
          if (!from) return;
          const dx = e.changedTouches[0].clientX - from.x;
          const dy = e.changedTouches[0].clientY - from.y;
          if (Math.abs(dx) > 60 && Math.abs(dy) < 40) step(dx < 0 ? 1 : -1);
        }}
      >
        <Breadcrumbs items={[
          { label: t('scans_title'), to: POSTS },
          ...(openFolder ? [{ label: openFolder.title, to: { page: 'post' as const, folder: openFolder.key } }] : []),
          { label: photoNumber != null ? t('photo_n', { n: photoNumber }) : t('crumbs_photo_one') },
        ]} />
        <div className="photo-title-row">
          <h1 className="page-title">
            {photoNumber != null ? <>{t('photo_n', { n: photoNumber })} <span className="ui-count">{t('photo_of', { total: photosInPost })}</span></> : t('crumbs_photo_one')}
          </h1>
          <div className="photo-title-actions">
            <button type="button" className="ui-icon-btn" aria-label={t('scans_prev')} title={`${t('scans_prev')} (←)`} disabled={navIndex <= 0} onClick={() => step(-1)}>
              <Icon name="chevronLeft" size={18} />
            </button>
            <button type="button" className="ui-icon-btn" aria-label={t('scans_next')} title={`${t('scans_next')} (→)`} disabled={navIndex < 0 || navIndex >= liveNavIds.length - 1} onClick={() => step(1)}>
              <Icon name="chevronRight" size={18} />
            </button>
            <button type="button" className="ui-icon-btn photo-delete" aria-label={t('scans_delete_photo')} title={t('scans_delete_photo')} onClick={() => deletePhotos([batch.id])}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        </div>
      </div>

      {openFolder && pricing.pricingKnown(batch.postId) ? (
        <PricingRow title={pricingTitle(openFolder)} settings={settings} t={t} to={{ page: 'pricing', folder }} />
      ) : null}

      <ActiveBatchView
        batch={batch}
        photoNumber={photoNumber ?? null}
        live={settings.priceMode === 'live'}
        settings={settings}
        scanner={scanner}
        t={t}
        dateLocale={lang === 'ms' ? 'ms-MY' : 'en-MY'}
        postTitle={postName}
        busy={finishing === batch.id}
        onFinish={() => finishPhoto(batch)}
        onDeliver={() => deliverPhoto(batch)}
        onEditPrices={() => editPrices(batch)}
        onRefreshPrices={() => refreshScanPrices(batch)}
        onAddMissing={addMissingCard}
        onChangeCard={idx => setPrintingsCtx({ batchId: batch.id, idx })}
        onLooksRight={looksRight}
        onAddToPost={cd => addCard(batch, cd)}
        onTakeOut={cd => takeOutCard(batch, cd)}
      />

      {/* The same previous / next as the top, so a long card list needn't scroll back. */}
      <nav className="photo-steps" aria-label={t('photo_steps_label')}>
        {(['prev', 'next'] as const).map(dir => {
          const id = navIndex >= 0 ? liveNavIds[navIndex + (dir === 'prev' ? -1 : 1)] : undefined;
          const n = id ? numbers.get(id) : undefined;
          return (
            <button key={dir} type="button" className={`photo-step is-${dir}`} disabled={!id} onClick={() => step(dir === 'prev' ? -1 : 1)}>
              {dir === 'prev' ? <Icon name="chevronLeft" size={18} /> : null}
              <span className="photo-step-text">
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
        onSelect={printing => { if (printingsCtx) { pickPrinting(printingsCtx.batchId, printingsCtx.idx, printing); setPrintingsCtx(null); } }}
        busy={!!printingsCtx && !!printingsBatch?.relookupBusy[printingsCtx.idx]}
        msg={printingsCtx ? printingsBatch?.relookupMsg[printingsCtx.idx] ?? null : null}
        onFind={name => printingsCtx && scanner.relookupByName(printingsCtx.batchId, printingsCtx.idx, name, t)}
        onUseAsIs={name => { if (printingsCtx) { scanner.useAsIs(printingsCtx.batchId, printingsCtx.idx, name, t); setPrintingsCtx(null); } }}
        t={t}
      />
    </section>
  );
}
