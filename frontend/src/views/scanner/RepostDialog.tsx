import { useEffect, useId, useState } from 'react';
import { listingsApi, ordersApi } from '../../api/checklist.ts';
import { Spinner } from '../../components/Spinner.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { Checkbox } from '../../components/ui/Checkbox.tsx';
import { TextField } from '../../components/ui/Field.tsx';
import { repostPlan, type RepostPhoto } from '../../lib/repost.ts';
import { byPostOrder } from '../../utils.ts';
import { countText, thumbOf } from '../../components/ScanGallery.tsx';
import type { Area, Folder } from './area.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  area: Area;
  folder: Folder;
}

// Repost unsold cards: the photos the new post can hold, read from the post's
// claims when the dialog opens, which of them to take, and its name.
export function RepostDialog({ open, onClose, area, folder }: Props) {
  const { t, repost } = area;
  const form = useId();
  const [plan, setPlan] = useState<RepostPhoto[] | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [newPrices, setNewPrices] = useState(true);
  const [busy, setBusy] = useState(false);
  const photos = folder.items.map(s => s.batch).sort(byPostOrder);

  useEffect(() => {
    if (!open) return;
    setPlan(null); setSkipped(new Set()); setNewPrices(true); setError(''); setBusy(false);
    setName(t('repost_name', { title: folder.title }));
    let current = true;
    Promise.all([listingsApi.list(), ordersApi.list(true)]).then(
      ([listings, orders]) => { if (current) setPlan(repostPlan(photos, listings, orders)); },
      e => { if (current) setError((e as Error).message); },
    );
    return () => { current = false; };
    // Read once per opening: the counts are what the new post gets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = plan?.filter(p => !skipped.has(p.scanId)) ?? [];
  const total = (k: 'left' | 'sold') => chosen.reduce((n, p) => n + p[k], 0);
  const toggle = (scanId: number) => setSkipped(prev => {
    const next = new Set(prev);
    if (!next.delete(scanId)) next.add(scanId);
    return next;
  });
  const ready = !!chosen.length && !!name.trim() && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    if (await repost(folder, name.trim(), chosen, newPrices)) onClose();
    else setBusy(false);
  };

  return (
    <Dialog
      open={open} onClose={onClose} title={t('repost_post')} closeLabel={t('cancel')}
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn--ink" onClick={onClose}>{t('cancel')}</button>
          <button type="submit" form={form} className="ui-btn ui-btn--primary" disabled={!ready}>
            {busy ? t('repost_making') : t('repost_make')}
          </button>
        </>
      )}
    >
      <form id={form} className="repost-form" onSubmit={e => { e.preventDefault(); save(); }}>
        <p className="repost-intro">{t('repost_intro')}</p>
        {error ? <p className="ui-error" role="alert">{error}</p>
          : !plan ? <Spinner label={t('repost_reading')} />
          : !plan.length ? <p className="repost-summary">{t('repost_none_left')}</p>
          : (
            <>
              <TextField
                label={t('repost_name_label')} value={name} maxLength={255}
                onChange={e => setName(e.target.value)} data-autofocus=""
              />
              <Checkbox
                label={t('repost_new_prices')} hint={t('repost_new_prices_hint')}
                checked={newPrices} onChange={e => setNewPrices(e.target.checked)}
              />
              <p className="repost-summary" aria-live="polite">
                {!chosen.length ? t('repost_none_chosen')
                  : [countText(t, 'post_photos_count', chosen.length), countText(t, 'repost_left', total('left')),
                    total('sold') ? countText(t, 'repost_sold', total('sold')) : ''].filter(Boolean).join(' · ')}
              </p>
              <fieldset className="repost-photos">
                <legend className="ui-label">{t('repost_photos_label')}</legend>
                {plan.map(p => {
                  const at = photos.findIndex(b => b.scanId === p.scanId);
                  return (
                    <label key={p.scanId} className="repost-photo">
                      <input type="checkbox" checked={!skipped.has(p.scanId)} onChange={() => toggle(p.scanId)} />
                      <img src={thumbOf(photos[at]) ?? ''} alt={t('photo_n', { n: at + 1 })} loading="lazy" />
                      <span>{countText(t, 'repost_left', p.left)}</span>
                    </label>
                  );
                })}

              </fieldset>
            </>
          )}
      </form>
    </Dialog>
  );
}
