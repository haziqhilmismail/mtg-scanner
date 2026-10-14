// Mini, mostly-frozen kanban preview for the landing page. One card is
// flagged interactive — it has a gold "Try me" badge, a clear "Mark paid"
// button, and animates into the Paid column when clicked. Every other card
// is static demo data so the page tells a clear story: this is what the
// real checklist looks like, here's how it moves.

import { useState } from 'react';
import type { T } from '../../hooks/useLang.ts';

interface DemoOrder {
  buyer: string;
  items: number;
  total: number;
  /** Exactly one order in the dataset should be flagged interactive. */
  interactive?: boolean;
}

type ColumnKey = 'unpaid' | 'paid' | 'credit' | 'done';

interface DemoColumn {
  key: ColumnKey;
  labelKey: string;
  orders: DemoOrder[];
}

const COLUMNS: DemoColumn[] = [
  { key: 'unpaid', labelKey: 'lp_track_unpaid', orders: [
    { buyer: 'Ahmad R.',  items: 3, total: 42, interactive: true },
    { buyer: 'Siti N.',   items: 1, total: 14 },
  ]},
  { key: 'paid', labelKey: 'lp_track_paid', orders: [
    { buyer: 'Jason L.',  items: 5, total: 87 },
  ]},
  { key: 'credit', labelKey: 'lp_track_credit', orders: [
    { buyer: 'Faiz K.',   items: 2, total: 28 },
  ]},
  { key: 'done', labelKey: 'lp_track_done', orders: [
    { buyer: 'Mei Ling',  items: 4, total: 65 },
    { buyer: 'Daniel T.', items: 1, total: 9 },
  ]},
];

export function DemoChecklist({ t }: { t: T }) {
  // false = interactive card lives in Unpaid (initial state)
  // true  = user clicked "Mark paid", it now lives in Paid
  const [paid, setPaid] = useState(false);

  // The single interactive card, hoisted so we can render it in either column.
  const interactive: DemoOrder | undefined = COLUMNS
    .flatMap((c) => c.orders)
    .find((o) => o.interactive);

  const renderColumn = (col: DemoColumn) => {
    // Drop the interactive card from its declared column and inject it into
    // whichever column the current state dictates.
    const baseOrders = col.orders.filter((o) => !o.interactive);
    const targetCol: ColumnKey = paid ? 'paid' : 'unpaid';
    const orders = interactive && col.key === targetCol
      ? [interactive, ...baseOrders]
      : baseOrders;

    return (
      <div key={col.key} className={`demo-col demo-col-${col.key}`}>
        <div className="demo-col-head">
          <span className="demo-col-label">{t(col.labelKey)}</span>
          <span className="demo-col-count">{orders.length}</span>
        </div>
        <ul className="demo-col-list">
          {orders.map((o) => {
            const isLive = o.interactive === true;
            return (
              <li
                key={o.buyer}
                className={`demo-order ${isLive ? 'is-live' : 'is-frozen'}`}
              >
                {isLive && (
                  <span className="demo-order-badge">{t('lp_track_try_badge')}</span>
                )}
                <div className="demo-order-buyer">{o.buyer}</div>
                <div className="demo-order-meta">
                  <span>
                    {o.items} {t(o.items === 1 ? 'lp_track_card_one' : 'lp_track_card_many')}
                  </span>
                  <span>RM {o.total}</span>
                </div>
                {isLive && (
                  <button
                    type="button"
                    className="demo-order-btn"
                    onClick={() => setPaid((p) => !p)}
                  >
                    {paid ? t('lp_track_undo') : t('lp_track_mark_paid')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="demo-tracker">
      <div className="demo-kanban" role="img" aria-label={t('lp_track_aria')}>
        {COLUMNS.map(renderColumn)}
      </div>
      <p className="demo-tracker-hint">{t('lp_track_hint')}</p>
    </div>
  );
}
