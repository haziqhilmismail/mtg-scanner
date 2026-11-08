import { useCallback, useEffect, useRef, useState } from 'react';
import { statusOf } from '../../api/http.ts';
import { frameCard } from '../../api/scans.ts';
import { ActiveBatchView } from './ActiveBatchView.tsx';
import { Breadcrumbs } from '../../components/Breadcrumbs.tsx';
import { useDialog } from '../../components/DialogProvider.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PrintingsModal } from './PrintingsModal.tsx';
import type { T } from '../../hooks/useLang.ts';
import type { NavStore } from '../../hooks/useNav.ts';
import type { PricingStore } from '../../hooks/usePricing.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';
import { dateLocale, keyTaken } from '../../lib/browser.ts';
import { folderOf, POSTS, routeFolder } from '../../routes.ts';
import type { Batch, Candidate, RelookupMsg } from '../../types.ts';
import { isLive, matchThumbs } from '../../utils.ts';
import type { PhotoActions } from './usePhotoActions.ts';
import type { Posts } from './usePosts.ts';

interface Props {
  batch: Batch;
  scanner: ScannerStore;
  pricingFor: PricingStore['pricingFor'];
  nav: NavStore;
  t: T;
  lang: string;
  posts: Posts;
  photos: PhotoActions;
  // The photos Prev and Next step through, as the post page listed them.
  navIds: string[];
}

export function PhotoPage({ batch, scanner, pricingFor, nav: { route, go, replace }, t, lang, posts, photos, navIds }: Props) {
  const { openFolder, postsById, postTitle, deletePhotos } = posts;
  const { numbers, finishing, finishPhoto, deliverPhoto, editPrices, refreshScanPrices, addCard, takeOutCard } = photos;
  const dialog = useDialog();
  const folder = folderOf(batch.postId);
  const settings = pricingFor(batch.postId);
  const [printingsCtx, setPrintingsCtx] = useState<{ batchId: string; idx: number } | null>(null);
  // The Change card dialog's name search: in flight, and how it went.
  const [relookup, setRelookup] = useState<{ busy: boolean; msg: RelookupMsg | null }>({ busy: false, msg: null });
  const openPrintings = (idx: number) => { setRelookup({ busy: false, msg: null }); setPrintingsCtx({ batchId: batch.id, idx }); };
  const findCard = useCallback(async (idx: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return setRelookup({ busy: false, msg: { type: 'err', text: t('msg_type_name_first') } });
    setRelookup({ busy: true, msg: { type: 'busy', text: t('msg_searching') } });
    try {
      const found = await scanner.relookupByName(batch.id, idx, trimmed);
      setRelookup({ busy: false, msg: { type: 'ok', text: t('msg_updated', { name: found.name }) } });
      setTimeout(() => setRelookup(r => (r.msg?.type === 'ok' ? { ...r, msg: null } : r)), 2500);
    } catch (e) {
      setRelookup({ busy: false, msg: { type: 'err', text: statusOf(e) === 404 ? t('msg_not_found') : t('msg_lookup_failed', { err: (e as Error).message }) } });
    }
  }, [batch.id, scanner, t]);

  // Reached through history (or a reload) rather than from the list, a photo
  // steps through its post in list order. Only a saved photo has a page of its own.
  const stepIds = navIds.includes(batch.id) ? navIds : (openFolder?.items.map(s => s.batch.id) ?? []);
  const liveNavIds = stepIds.filter(id => scanner.batches.some(b => b.id === id && b.scanId != null));
  const navIndex = liveNavIds.indexOf(batch.id);
  const folderKey = routeFolder(route);
  const step = useCallback((delta: number) => {
    const next = scanner.batches.find(b => b.id === liveNavIds[navIndex + delta]);
    if (next?.scanId != null && folderKey != null) { replace({ page: 'photo', folder: folderKey, scanId: next.scanId }); window.scrollTo({ top: 0 }); }
  }, [liveNavIds, navIndex, replace, scanner.batches, folderKey]);

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
    const name = await dialog.prompt({ title: t('add_card_title'), message: t('add_card_msg'), placeholder: 'Sol Ring', okLabel: t('add_card_ok') });
    if (!name?.trim()) return;
    const { width: w, height: h } = batch.response;
    const cw = Math.round(Math.min(w, h) * 0.18), ch = Math.round(cw * 1.395);
    const x = Math.round((w - cw) / 2), y = Math.round((h - ch) / 2);
    try {
      const card = await frameCard(batch.scanId, [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]]);
      const idx = batch.response.cards.length;
      scanner.appendFramedCard(batch.id, card);
      await findCard(idx, name);
      await dialog.alert({ title: t('add_card_title'), message: t('add_card_next') });
      setPrintingsCtx({ batchId: batch.id, idx });
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    }
  }, [batch, dialog, findCard, scanner, t]);

  // The seller's answers about the printing; each one also sends the card's crop
  // with the answer to the server, as training data (card corrections).
  const pickPrinting = (batchId: string, idx: number, printing: Candidate) => scanner.pickPrinting(batchId, idx, printing);
  const looksRight = (idx: number) => scanner.looksRight(batch.id, idx);

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

      <ActiveBatchView
        batch={batch}
        photoNumber={photoNumber ?? null}
        live={isLive(settings)}
        settings={settings}
        scanner={scanner}
        t={t}
        dateLocale={dateLocale(lang)}
        postTitle={postName}
        busy={finishing === batch.id}
        onFinish={() => finishPhoto(batch)}
        onDeliver={() => deliverPhoto(batch)}
        onEditPrices={() => editPrices(batch)}
        onRefreshPrices={() => refreshScanPrices(batch)}
        onAddMissing={addMissingCard}
        onChangeCard={openPrintings}
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
        busy={relookup.busy}
        msg={relookup.msg}
        onFind={name => printingsCtx && findCard(printingsCtx.idx, name)}
        onUseAsIs={name => { if (printingsCtx) { if (name.trim()) scanner.useAsIs(printingsCtx.batchId, printingsCtx.idx, name.trim()); setPrintingsCtx(null); } }}
        t={t}
      />
    </section>
  );
}
