import { useEffect, useRef } from 'react';
import type { Batch, Settings } from '../types.ts';
import { computeCardData, formatMyr } from '../utils.ts';
import { useDialog } from './DialogProvider.tsx';

interface Props {
  batches: Batch[];
  activeId: string | null;
  settings: Settings;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

// Priced value of a single batch — sum of every visible card's line total.
// Recomputes with the multiplier (computeCardData reads settings.mult*), so a
// tab's price tracks the same number shown inside the batch view.
function batchTotal(b: Batch, settings: Settings): number {
  if (!b.response) return 0;
  return computeCardData(b, settings)
    .filter(cd => !cd.removed)
    .reduce((sum, cd) => sum + (isFinite(cd.lineTotal) ? cd.lineTotal : 0), 0);
}

function summary(b: Batch, t: Props['t']): { status: string; text: string } {
  if (b.status === 'scanning') return { status: 'scanning', text: t('tab_status_scanning') };
  if (b.outOfCredits) return { status: 'warn', text: t('tab_status_no_credits') };
  if (b.status === 'error') return { status: 'error', text: t('tab_status_error') };
  if (!b.response) return { status: 'done', text: t('tab_status_done', { n: 0 }) };
  let n = 0, needs = 0;
  b.response.cards.forEach((c, i) => {
    if (b.removed[i]) return;
    n++;
    const sel = c.candidates[0];
    const o = b.priceOverride[i];
    const hasOverride = o != null && o !== '';
    if (sel?._manual && !hasOverride) needs++;
  });
  if (needs > 0) return { status: 'warn', text: t('tab_status_warn', { n, w: needs }) };
  if (n === 1) return { status: 'done', text: t('tab_status_done_one') };
  return { status: 'done', text: t('tab_status_done', { n }) };
}

export function BatchTabStrip({ batches, activeId, settings, onSelect, onRemove, t }: Props) {
  const { confirm } = useDialog();
  const stripRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the active tab into view on change
  useEffect(() => {
    if (!activeId || !stripRef.current) return;
    const el = stripRef.current.querySelector<HTMLButtonElement>(`[data-tab-id="${activeId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeId]);

  return (
    <div className="tab-strip" ref={stripRef}>
      {batches.map(b => {
        const s = summary(b, t);
        const price = batchTotal(b, settings);
        const isActive = b.id === activeId;
        return (
          <div
            key={b.id}
            data-tab-id={b.id}
            className={`tab ${isActive ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(b.id)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(b.id); }
            }}
          >
            {b.response?.image_b64 ? (
              <img className="tab-thumb" src={b.response.image_b64} alt="" />
            ) : (
              <div className="tab-thumb placeholder">…</div>
            )}
            <div className="tab-meta">
              <div className="tab-name">{b.filename}</div>
              <div className={`tab-status ${s.status}`}>
                <span className="dot" />
                {s.text}
              </div>
              {b.response && price > 0 ? (
                <div className="tab-price">{formatMyr(price, settings)}</div>
              ) : null}
            </div>
            {onRemove ? (
              <button
                type="button"
                className="tab-close"
                aria-label="Remove this scan"
                title="Remove this scan"
                onClick={async e => {
                  // stopPropagation so clicking the X doesn't also activate the tab
                  e.stopPropagation();
                  const ok = await confirm({
                    title: t('confirm_remove_scan_title'),
                    message: t('confirm_remove_scan_msg', { name: b.filename }),
                    okLabel: t('confirm_remove_scan_ok'),
                    destructive: true,
                  });
                  if (ok) onRemove(b.id);
                }}
                onKeyDown={e => e.stopPropagation()}
              >×</button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
