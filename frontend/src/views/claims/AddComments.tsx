// Add comments: the seller brings a post's comment thread in as screenshots.
// The server finds the post's photo in each one and reads the comments; the
// seller checks both, then Find claims matches comments to cards. Nothing is
// saved until the seller has checked the claims and pressed Add.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmClaims, parseClaims, readClaimScreenshots, type CataloguePhoto } from '../../api.ts';
import { OutOfCreditsError } from '../../api/http.ts';
import type { Photo } from '../../components/ClaimPickers.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { PhotoViewer } from '../../components/ui/PhotoViewer.tsx';
import { useT } from '../../hooks/useLang.ts';
import type { Credits, Settings } from '../../types.ts';
import { creditsLine, creditsOutText, formatMyrWithFoil, listingFields, sortScreenshots } from '../../utils.ts';
import { blankDraft, CheckClaims, draftsKind, type Draft } from './CheckClaims.tsx';
import { counted } from './model.ts';
import { PostPhotos } from './PostPhotos.tsx';
import { ShotCard, type Shot } from './ShotCard.tsx';
import { useScreenshotDrop } from './useScreenshotDrop.ts';

interface Props {
  open: boolean;
  onClose: (hadWork: boolean) => void;   // ×, Esc, Cancel or the backdrop
  onSaved: (added: number) => void;
  incoming: { id: number; files: File[] } | null;   // screenshots pasted or dropped on the page
  photos: Photo[];
  postId: number | null;
  postTitle: string;
  claimedBy: Map<string, { qty: number; names: string[] }>;
  buyerNames: string[];
  // Starts on a claim typed by hand, for this buyer ('' for none yet), rather
  // than on screenshots.
  handFor: string | null;
  settings: Settings;
  credits: Credits | null;
  onCredits: (credits: Credits) => void;
  onEnterVoucher: () => void;
  lang: string;
}

type Busy = null | 'reading' | 'finding' | 'saving';
const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name);

// Mounted for the whole session, open or not, so a closed one can come back
// with Undo; a new session is a new key.
export function AddComments({ open, onClose, onSaved, incoming, photos, postId, postTitle, claimedBy, buyerNames, handFor, settings, credits, onCredits, onEnterVoucher, lang }: Props) {
  const t = useT();
  const [shots, setShots] = useState<Shot[]>([]);
  const [step, setStep] = useState<'shots' | 'check'>(handFor == null ? 'shots' : 'check');
  const [busy, setBusy] = useState<Busy>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() => (handFor == null ? [] : [blankDraft(handFor)]));
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [pickerFor, setPickerFor] = useState<number | null>(null);   // the screenshot whose In this post is open
  const [viewing, setViewing] = useState<Shot | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const cents = settings.showCents;
  const live = settings.priceMode === 'live';

  // Screenshots show from object URLs; they go with the session.
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach(s => URL.revokeObjectURL(s.src)), []);

  const cardsByKey = useMemo(() => new Map(photos.flatMap(p => p.cards).map(c => [c.key, c])), [photos]);

  const readFiles = useCallback(async (files: File[]) => {
    const images = files.filter(isImage);
    if (!images.length || !photos.length) return;
    setBusy('reading'); setError('');
    try {
      const all = photos.map(p => p.batch.scanId as number);
      const read = await readClaimScreenshots(images, all);
      const ours = (id: number | null) => (id != null && all.includes(id) ? id : null);
      // A one-photo post has nothing to sort.
      const sorted = all.length === 1
        ? read.map(() => ({ scanId: all[0], by: 'picked' as const }))
        : sortScreenshots<number | 'all'>(read.map(pg => ({ sure: ours(pg.scan_id), guess: ours(pg.guess) })), shotsRef.current.at(-1)?.photo ?? null, 'all');
      setShots(prev => [...prev, ...read.map((pg, i) => ({
        id: nextId.current++, name: images[i].name, src: URL.createObjectURL(images[i]),
        text: pg.text, photo: sorted[i].scanId, by: sorted[i].by,
      }))]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [photos]);

  const taken = useRef(0);
  useEffect(() => {
    if (!incoming || incoming.id === taken.current) return;
    taken.current = incoming.id;
    readFiles(incoming.files);
  }, [incoming, readFiles]);
  const dragging = useScreenshotDrop(open, () => step === 'shots' && pickerFor == null && !viewing && !busy, readFiles);

  // What Gemini is told is on sale; prices as the photo shows them.
  const catalogue = (subset: Photo[]): CataloguePhoto[] => subset.map(p => ({
    scan_id: p.batch.scanId as number,
    label: `Photo ${p.index} (${p.batch.filename})`,
    cards: p.cards.map(c => ({
      card_id: c.cd.card.id, name: c.cd.sel.name || '', set_code: c.cd.sel.set || '',
      price: Number.isFinite(c.cd.unitPrice) ? formatMyrWithFoil(c.cd.unitPrice, c.cd.isFoil, settings) : '',
      foil: c.cd.isFoil, position: c.position,
    })),
  }));

  const filled = shots.filter(s => s.text.trim());
  const findClaims = async () => {
    setBusy('finding'); setError('');
    try {
      // Screenshots of one photo are read as one thread, in order, so "top
      // left" means that photo; several photos are read against the post.
      const threads = new Map<number | 'all', string[]>();
      for (const s of filled) threads.set(s.photo, [...(threads.get(s.photo) ?? []), s.text.trim()]);
      const found: Draft[] = [];
      const skip: string[] = [];
      for (const [photo, texts] of threads) {
        const subset = photos.filter(p => photo === 'all' || p.batch.scanId === photo);
        const res = await parseClaims(texts.join('\n\n'), catalogue(subset.length ? subset : photos));
        onCredits(res.credits);
        skip.push(...(res.skipped ?? []));
        for (const d of res.claims) {
          found.push({
            buyer: d.buyer, comment: d.comment, unclear: d.unclear, byHand: false,
            items: d.items.map(i => {
              const key = `${i.scan_id}:${i.card_id}`;
              const hint = photos.some(p => p.batch.scanId === i.scan_id) ? i.scan_id : typeof photo === 'number' ? photo : null;
              return { key: cardsByKey.has(key) ? key : null, qty: Math.max(1, i.qty), said: i.said, unclear: i.unclear, hint };
            }),
          });
        }
      }
      // Claims typed by hand stay; the ones read before are read again.
      setDrafts(prev => [...found, ...prev.filter(d => d.byHand)]); setSkipped(skip); setStep('check');
    } catch (e) {
      // Each call works out claims with Gemini and costs a credit.
      if (e instanceof OutOfCreditsError && e.credits) onCredits(e.credits);
      setError(e instanceof OutOfCreditsError
        ? t('credits_out_title') + (e.credits ? `. ${creditsOutText(e.credits, t, lang)}` : '')
        : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ready = drafts.filter(d => d.items.length > 0);
  const problem = ready.some(d => !d.buyer.trim() || d.items.some(it => !it.key)) ? 'unresolved'
    : ready.some(d => d.items.some(it => !Number.isFinite(cardsByKey.get(it.key!)?.cd.unitPrice))) ? 'unpriced' : null;
  const save = async () => {
    setBusy('saving'); setError('');
    try {
      await confirmClaims(postId, ready.map(d => ({
        buyer: d.buyer.trim(),
        note: d.comment || null,
        items: d.items.map(it => {
          const c = cardsByKey.get(it.key!)!;
          return { ...listingFields(c.cd), scan_id: c.scanId, card_id: c.cd.card.id, bbox: c.cd.card.bbox, qty: it.qty };
        }),
      })));
      onSaved(ready.length);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const chosen = [...new Set(filled.map(s => s.photo))];
  const photoText = chosen.length === 1 && typeof chosen[0] === 'number'
    ? t('claims_photo', { n: photos.find(p => p.batch.scanId === chosen[0])?.index ?? '' })
    : t('claims_several_lower');
  const balance = creditsLine(credits, t, lang);
  // Work to offer back with Undo: screenshots, or a typed claim with a card.
  const close = () => onClose(shots.length > 0 || drafts.some(d => d.byHand && d.items.some(i => i.key)));
  const byHand = () => { setDrafts(prev => [...prev, blankDraft()]); setError(''); setStep('check'); };

  return (
    <>
      <Dialog
        open={open} onClose={close} variant="picker" className="claims-dialog" closeLabel={t('claims_close')}
        title={step === 'shots' ? t('claims_add_title') : {
          found: counted(t, 'claims_found', drafts.length),
          hand: t(drafts.length > 1 ? 'claims_add_title' : 'claims_hand_title'),
          none: t('claims_found_none'),
        }[draftsKind(drafts)]}
        subtitle={step === 'check' && filled.length
          ? `${counted(t, 'claims_from_shots', filled.length)} · ${photoText}`
          : `${postTitle} · ${counted(t, 'claims_photos', photos.length)}`}
        footer={step === 'check' ? (
          <>
            <button type="button" className="ui-btn ui-btn--ink" disabled={busy === 'saving'} onClick={() => { setStep('shots'); setError(''); }}>{t('claims_back')}</button>
            <button type="button" className="ui-btn ui-btn--primary" disabled={!!busy || !ready.length || !!problem} onClick={save}>
              {busy === 'saving' ? t('claims_adding') : counted(t, 'claims_add_n', ready.length)}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ui-btn ui-btn--ink" onClick={close}>{t('claims_cancel')}</button>
            <button
              type="button" className="ui-btn ui-btn--primary" onClick={findClaims}
              disabled={!!busy || !filled.length}
            >
              {busy === 'finding' ? <><span className="claims-spin" aria-hidden="true" />{t('claims_finding')}</> : t('claims_find')}
            </button>
          </>
        )}
      >
        {step === 'check' ? (
          <CheckClaims
            drafts={drafts} skipped={skipped} photos={photos} cardsByKey={cardsByKey} claimedBy={claimedBy}
            cents={cents} live={live} problem={problem} buyerNames={buyerNames} onChange={setDrafts}
          />
        ) : (
          <>
            <p className="claims-intro">{t('claims_add_intro')}</p>
            {shots.map(s => (
              <ShotCard
                key={s.id} shot={s} photos={photos}
                onChange={patch => setShots(prev => prev.map(x => (x.id === s.id ? { ...x, ...patch } : x)))}
                onRemove={() => { URL.revokeObjectURL(s.src); setShots(prev => prev.filter(x => x.id !== s.id)); }}
                onView={() => setViewing(s)}
                onPostPhotos={() => setPickerFor(s.id)}
              />
            ))}
            <button type="button" className="ui-btn ui-btn--lg ui-btn--block claims-choose" disabled={busy === 'reading'} onClick={() => fileRef.current?.click()}>
              {busy === 'reading' ? <span className="claims-spin" aria-hidden="true" /> : <Icon name="plus" size={18} />}
              {busy === 'reading' ? t('claims_reading') : t(shots.length ? 'claims_choose_more' : 'claims_choose')}
            </button>
            <button type="button" className="ui-btn ui-btn--plain claims-by-hand" onClick={byHand}>{t('claims_by_hand')}</button>
            {balance ? (
              <p className="claims-foot-note">
                {balance}
                {credits?.remaining === 0 ? <>{' · '}<button type="button" className="claims-text-btn" onClick={onEnterVoucher}>{t('voucher_enter')}</button></> : null}
              </p>
            ) : null}
            <input
              ref={fileRef} type="file" multiple accept="image/*" hidden
              onChange={e => { if (e.target.files?.length) readFiles(Array.from(e.target.files)); e.target.value = ''; }}
            />
          </>
        )}
        {error ? <p className="ui-error claims-error" role="alert">{error}</p> : null}
        {dragging ? <div className="claims-drop" aria-hidden="true"><span><Icon name="plus" size={20} />{t('claims_drop_dialog')}</span></div> : null}
      </Dialog>
      <PostPhotos
        open={pickerFor != null} onClose={() => setPickerFor(null)} photos={photos} postTitle={postTitle}
        chosen={shots.find(s => s.id === pickerFor)?.photo ?? null} cents={cents} live={live}
        onUse={scanId => { setShots(prev => prev.map(x => (x.id === pickerFor ? { ...x, photo: scanId, by: 'picked' } : x))); setPickerFor(null); }}
      />
      <PhotoViewer
        open={viewing != null} onClose={() => setViewing(null)} label={t('claims_view_shot')} closeLabel={t('claims_close')}
        image={{ src: viewing?.src ?? '', alt: viewing?.name ?? '' }}
      />
    </>
  );
}
