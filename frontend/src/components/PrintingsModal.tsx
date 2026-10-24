import { useEffect, useState } from 'react';
import { fetchPrintings } from '../api.ts';
import type { T } from '../hooks/useLang.ts';
import type { Candidate, RelookupMsg } from '../types.ts';
import { fmt2, smallScryfallImage } from '../utils.ts';
import { Icon } from './Icon.tsx';
import { Dialog } from './ui/Dialog.tsx';
import { TextField } from './ui/Field.tsx';

interface Props {
  open: boolean;
  cardName: string;
  currentSid: string;
  onClose: () => void;
  onSelect: (printing: Candidate) => void;
  // Wrong card altogether: look it up by another name, or keep the name as
  // typed and price it by hand.
  busy: boolean;
  msg: RelookupMsg | null;
  onFind: (name: string) => void;
  onUseAsIs: (name: string) => void;
  t: T;
}

const PAGE_SIZE = 30;

// Change card: every printing of the card with its Card Kingdom prices, the
// current one marked. Choosing one is the change, so there is no Save.
export function PrintingsModal({ open, cardName, currentSid, onClose, onSelect, busy, msg, onFind, onUseAsIs, t }: Props) {
  return (
    <Dialog
      open={open} onClose={onClose} closeLabel={t('voucher_close')} variant="picker" className="change-card"
      title={t('cc_title')} subtitle={t('cc_subtitle', { name: cardName })}
    >
      <Printings cardName={cardName} currentSid={currentSid} onSelect={onSelect} busy={busy} msg={msg} onFind={onFind} onUseAsIs={onUseAsIs} t={t} />
    </Dialog>
  );
}

// The body mounts with each opening, so the search box and the list start from the card as it is.
function Printings({ cardName, currentSid, onSelect, busy, msg, onFind, onUseAsIs, t }: Omit<Props, 'open' | 'onClose'>) {
  const [name, setName] = useState(cardName);
  const [printings, setPrintings] = useState<Candidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);

  // Find replaces the card, and its new name loads its own printings.
  useEffect(() => {
    if (!cardName) return;
    let current = true;
    setName(cardName); setPrintings(null); setFailed(false); setShown(PAGE_SIZE);
    fetchPrintings(cardName).then(
      data => { if (current) setPrintings(data.printings || []); },
      (e: Error & { status?: number }) => { if (!current) return; if (e.status === 404) setPrintings([]); else setFailed(true); },
    );
    return () => { current = false; };
  }, [cardName]);

  const ck = printings?.filter(p => p.price_source_normal === 'cardkingdom' || p.price_source_foil === 'cardkingdom').length ?? 0;
  const status = failed ? t('cc_failed')
    : printings == null ? t('cc_loading')
      : printings.length === 0 ? t('cc_none')
        : t(printings.length === 1 ? 'cc_count_one' : 'cc_count', { n: printings.length, ck });

  return (
    <>
      <form className="cc-search" role="search" onSubmit={e => { e.preventDefault(); onFind(name); }}>
        <TextField
          type="search" aria-label={t('cc_name')} className="cc-search-field"
          prefix={<Icon name="search" size={18} />} enterKeyHint="search" autoComplete="off"
          value={name} disabled={busy} onChange={e => setName(e.target.value)}
        />
        <button type="submit" className="ui-btn ui-btn--primary" disabled={busy}>{busy ? t('cc_finding') : t('find')}</button>
      </form>
      {msg && msg.type !== 'busy' ? <p className={`cc-msg is-${msg.type}`} role="status">{msg.text}</p> : null}
      <p className="cc-status" aria-live="polite">{status}</p>

      {printings?.length ? (
        <ul className="cc-grid">
          {printings.slice(0, shown).map(p => (
            <li key={p.scryfall_id || `${p.set}-${p.collector_number}`}>
              <Printing p={p} current={!!currentSid && p.scryfall_id === currentSid} onPick={() => onSelect(p)} t={t} />
            </li>
          ))}
        </ul>
      ) : null}
      {printings && printings.length > shown ? (
        <button type="button" className="ui-btn ui-btn--block cc-more" onClick={() => setShown(n => n + PAGE_SIZE)}>
          {t('cc_more', { n: Math.min(PAGE_SIZE, printings.length - shown) })}
        </button>
      ) : null}

      <div className="cc-asis">
        <span>{t('cc_asis_hint')}</span>
        <button type="button" className="ui-btn" disabled={busy} onClick={() => onUseAsIs(name)}>{t('use_asis')}</button>
      </div>
    </>
  );
}

function Printing({ p, current, onPick, t }: { p: Candidate; current: boolean; onPick: () => void; t: T }) {
  const code = `${(p.set || '?').toUpperCase()} · #${p.collector_number || '?'}`;
  const normal = p.price_source_normal === 'cardkingdom' && p.usd > 0;
  const foil = p.price_source_foil === 'cardkingdom' && p.usd_foil > 0;
  return (
    <button type="button" className={`cc-printing${current ? ' is-current' : ''}`} aria-current={current || undefined} onClick={onPick}>
      <span className="cc-printing-img">
        {p.image_url ? <img src={smallScryfallImage(p.image_url)} alt="" loading="lazy" decoding="async" width={146} height={204} /> : (
          <span className="cc-printing-none"><Icon name="photo" size={24} />{code}</span>
        )}
        {current ? <span className="cc-printing-check"><Icon name="check" size={14} /></span> : null}
      </span>
      <span className="cc-printing-text">
        <span className="cc-printing-code">{code}</span>
        <span className="cc-printing-set">{p.set_name || ''}</span>
        {normal ? <span className="cc-printing-price">USD {fmt2(p.usd)}</span> : <span className="cc-printing-price is-none">{t('cc_no_normal')}</span>}
        {foil ? <span className="cc-printing-price is-foil">{t('foil_on')} · USD {fmt2(p.usd_foil)}</span> : null}
        {current ? <span className="cc-printing-current">{t('cc_current')}</span> : null}
      </span>
    </button>
  );
}
