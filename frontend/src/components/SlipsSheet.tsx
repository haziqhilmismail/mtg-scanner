import { useEffect, useState } from 'react';
import { dropoffSlipsPdf } from '../api.ts';
import { usePersistedState } from '../hooks/usePersistedState.ts';
import { downloadBlob } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

export interface SlipBuyer { id: number; name: string; phone: string; done: boolean }

interface Props {
  open: boolean;
  onClose: () => void;
  buyers: SlipBuyer[];
  t: T;
}

// Printable Cards & Hobbies drop-off slips. Everything is optional: a buyer
// left out, a missing phone or no seller name leaves a line to write on.
export function SlipsSheet({ open, onClose, buyers, t }: Props) {
  useBackClose(open, onClose);
  const [seller, setSeller] = usePersistedState('mtg.slips.seller', '');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [blank, setBlank] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Each time it opens: the buyers not done yet, no extra blanks.
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(buyers.filter(b => !b.done).map(b => b.id))); setBlank(0); setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const chosen = buyers.filter(b => picked.has(b.id));
  const total = chosen.length + blank;
  const pages = Math.max(1, Math.ceil(total / 10));
  const download = async () => {
    setBusy(true); setError('');
    try {
      const pdf = await dropoffSlipsPdf({ seller, slips: chosen.map(b => ({ buyer: b.name, phone: b.phone })), blank });
      downloadBlob(pdf, 'ch-dropoff-slips.pdf');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div className="feedback-modal slips-sheet" role="dialog" aria-modal="true" aria-labelledby="slips-title" onClick={e => e.stopPropagation()}>
        <div className="feedback-head">
          <h2 id="slips-title">{t('slips_title')}</h2>
          <button type="button" className="feedback-close" onClick={onClose} aria-label={t('voucher_close')}>×</button>
        </div>
        <p className="feedback-sub">{t('slips_sub')}</p>
        <label className="payment-field">
          <span>{t('slips_seller')}</span>
          <input type="text" value={seller} maxLength={60} placeholder={t('slips_optional')} onChange={e => setSeller(e.target.value)} />
        </label>
        {buyers.length ? (
          <fieldset className="slips-buyers">
            <legend>{t('slips_buyers')}</legend>
            {buyers.map(b => (
              <label className="checkbox-row" key={b.id}>
                <input
                  type="checkbox" checked={picked.has(b.id)}
                  onChange={e => setPicked(prev => { const next = new Set(prev); if (e.target.checked) next.add(b.id); else next.delete(b.id); return next; })}
                />
                <span>{b.name}{b.phone ? <span className="meta"> · {b.phone}</span> : <span className="meta"> · {t('slips_no_phone')}</span>}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="payment-field">
          <span>{t('slips_blank')}</span>
          <input type="number" inputMode="numeric" min={0} max={80} value={blank} onChange={e => setBlank(Math.max(0, Math.min(80, Math.floor(Number(e.target.value) || 0))))} />
        </label>
        <p className="feedback-sub">{t('slips_summary', { n: total, pages })}</p>
        {error ? <p className="feedback-error" role="alert">{error}</p> : null}
        <div className="feedback-foot">
          <button type="button" className="accent" disabled={busy} onClick={download}>{busy ? t('finish_busy') : t('slips_download')}</button>
        </div>
      </div>
    </div>
  );
}
