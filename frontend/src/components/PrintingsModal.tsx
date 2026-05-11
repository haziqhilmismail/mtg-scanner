import { useEffect, useMemo, useState } from 'react';
import { fetchPrintings } from '../api.ts';
import type { Candidate } from '../types.ts';
import { fmt2 } from '../utils.ts';

interface Props {
  open: boolean;
  cardName: string;
  currentSid: string;
  onClose: () => void;
  onSelect: (printing: Candidate) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

export function PrintingsModal({ open, cardName, currentSid, onClose, onSelect, t }: Props) {
  const [printings, setPrintings] = useState<Candidate[]>([]);
  const [status, setStatus] = useState<string>('');
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Load printings on open
  useEffect(() => {
    if (!open || !cardName) return;
    setPrintings([]);
    setFilter('');
    setStatus(t('modal_loading_from'));
    setLoading(true);
    fetchPrintings(cardName).then(
      data => {
        setLoading(false);
        const list = data.printings || [];
        setPrintings(list);
        if (!list.length) setStatus(t('modal_no_printings'));
      },
      e => {
        setLoading(false);
        const err = e as Error & { status?: number };
        setStatus(err.status === 404 ? t('modal_no_printings') : `Error: ${err.message}`);
      },
    );
  }, [open, cardName, t]);

  // Esc to close + body scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return printings;
    return printings.filter(p =>
      (p.set_name || '').toLowerCase().includes(q) ||
      (p.set || '').toLowerCase().includes(q) ||
      (p.collector_number || '').toLowerCase().includes(q),
    );
  }, [printings, filter]);

  // Update status text based on filter state
  useEffect(() => {
    if (loading || !printings.length) return;
    const total = printings.length;
    const ckCount = filtered.filter(
      p => p.price_source_normal === 'cardkingdom' || p.price_source_foil === 'cardkingdom',
    ).length;
    if (filtered.length === 0) {
      setStatus(t('modal_count_filtered_none'));
    } else if (filter.trim()) {
      setStatus(t('modal_count_filtered', { shown: filtered.length, total }));
    } else if (total === 1) {
      setStatus(t('modal_count_summary_singular', { ck: ckCount }));
    } else {
      setStatus(t('modal_count_summary', { n: total, ck: ckCount }));
    }
  }, [filtered, filter, loading, printings.length, t]);

  if (!open) return null;

  return (
    <div className="modal open">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-box" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3 className="modal-title">
            {t('modal_all_printings')} <em>{cardName}</em>
          </h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-status">{status}</div>
        {printings.length >= 8 && (
          <div className="modal-filter">
            <input
              autoFocus
              type="text"
              placeholder={t('printings_filter_placeholder')}
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <button
              type="button"
              className="clear-filter"
              onClick={() => setFilter('')}
            >
              {t('clear')}
            </button>
          </div>
        )}
        <div className="modal-grid">
          {filtered.map(p => (
            <PrintingCard
              key={`${p.scryfall_id || p.set + p.collector_number}`}
              p={p}
              isCurrent={p.scryfall_id === currentSid}
              onPick={() => onSelect(p)}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PrintingCard({
  p, isCurrent, onPick, t,
}: {
  p: Candidate;
  isCurrent: boolean;
  onPick: () => void;
  t: Props['t'];
}) {
  const tag = (src: string) =>
    src === 'cardkingdom' ? <span className="src ck">CK</span>
      : src === 'tcgplayer' ? <span className="src tcg">TCG</span>
        : <span className="src none">—</span>;

  return (
    <div
      className={`printing-card ${isCurrent ? 'current' : ''}`}
      onClick={onPick}
    >
      {p.image_url
        ? <img className="img" src={p.image_url} alt="" loading="lazy" />
        : <div className="img" />}
      <div className="info">
        <div className="set-code">
          {(p.set || '?').toUpperCase()} · #{p.collector_number || '?'}
        </div>
        <div className="set-name-small">{p.set_name || ''}</div>
        {p.usd > 0
          ? <div className="price-row">{tag(p.price_source_normal)}USD {fmt2(p.usd)}</div>
          : <div className="price-row" style={{ color: 'var(--ink-soft)' }}>{tag('none')}{t('modal_no_normal')}</div>}
        {p.usd_foil > 0 ? (
          <div className="price-row foil">
            {tag(p.price_source_foil)}{t('modal_foil_label')} {fmt2(p.usd_foil)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
