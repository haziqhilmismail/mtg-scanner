import { useId, useState } from 'react';
import { dropoffSlipsPdf } from '../api.ts';
import { useT } from '../hooks/useLang.ts';
import { downloadBlob } from '../utils.ts';
import { counted } from '../views/claims/model.ts';
import { Icon } from './Icon.tsx';
import { Dialog } from './ui/Dialog.tsx';
import { useToast } from './ui/Toast.tsx';

export interface SlipBuyer { id: number; name: string; phone: string }

interface Props {
  open: boolean;
  onClose: () => void;
  buyers: SlipBuyer[];   // in claim order
  postTitle: string;
}

// Drop-off slips: one per buyer, ticked by default, made into an A4 PDF.
export function SlipsSheet({ open, onClose, buyers, postTitle }: Props) {
  const t = useT();
  const toast = useToast();
  const listId = useId();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Each opening starts with every buyer ticked.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setPicked(new Set(buyers.map(b => b.id))); setError(''); }
  }

  const chosen = buyers.filter(b => picked.has(b.id));
  const allOn = chosen.length === buyers.length;
  const pages = Math.ceil(Math.max(1, chosen.length) / 10);
  const label = chosen.length === 0 ? t('slips_make_blank')
    : pages > 1 ? t('slips_make_pages', { n: chosen.length, pages }) : counted(t, 'slips_make', chosen.length);
  const toggle = (id: number, on: boolean) => setPicked(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const make = async () => {
    setBusy(true); setError('');
    try {
      downloadBlob(await dropoffSlipsPdf({ slips: chosen.map(b => ({ buyer: b.name, phone: b.phone })) }), 'drop-off-slips.pdf');
      onClose();
      toast(t('slips_saved'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open} onClose={onClose} className="claims-dialog" title={t('slips_title')} subtitle={postTitle} closeLabel={t('claims_close')}
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn--ink" onClick={onClose}>{t('claims_cancel')}</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={busy} onClick={make}>
            <Icon name="download" size={18} />{busy ? t('slips_making') : label}
          </button>
        </>
      )}
    >
      <p className="claims-intro">{t('slips_intro')}</p>
      {buyers.length ? (
        <>
          <div className="claims-list-head">
            <span id={listId} className="ui-label">{t('slips_buyers')}</span>
            <button type="button" className="ui-btn ui-btn--plain" onClick={() => setPicked(new Set(allOn ? [] : buyers.map(b => b.id)))}>
              {allOn ? t('slips_select_none') : t('slips_select_all')}
            </button>
          </div>
          <ul className="claims-box claims-slip-list" aria-labelledby={listId}>
            {buyers.map(b => (
              <li key={b.id}>
                <label className="claims-slip-row">
                  <input type="checkbox" checked={picked.has(b.id)} onChange={e => toggle(b.id, e.target.checked)} />
                  <span className="claims-slip-text">
                    <span className="claims-slip-name">{b.name}</span>
                    <span className="claims-slip-phone">{b.phone || t('slips_no_phone')}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="claims-foot-note">{t('slips_note')}</p>
      {error ? <p className="ui-error" role="alert">{error}</p> : null}
    </Dialog>
  );
}
