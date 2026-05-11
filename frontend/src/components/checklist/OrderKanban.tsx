import { Fragment, useState } from 'react';
import { ordersApi, type Buyer, type Listing, type Order } from '../../api/checklist.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';
import { upgradeScryfallImage } from '../../utils.ts';

type T = (k: string, vars?: Record<string, string | number>) => string;

interface Props {
  orders: Order[];
  buyers: Buyer[];
  listings: Listing[];
  reload: () => void;
  t: T;
}

// 4 columns map to the (paid?, delivered?) axes. Cancelled orders are
// pulled out of the kanban and listed separately below.
type KanColumn = 'unpaid' | 'paid' | 'credit' | 'done';

function classify(o: Order): KanColumn | 'cancelled' {
  if (o.status === 'cancelled') return 'cancelled';
  const paid = !!o.paid_at;
  const delivered = !!o.delivered_at;
  if (paid && delivered) return 'done';
  if (delivered && !paid) return 'credit';  // took on credit
  if (paid && !delivered) return 'paid';
  return 'unpaid';
}

const COLUMN_KEYS: Array<{ key: KanColumn; titleKey: string; subKey: string }> = [
  { key: 'unpaid', titleKey: 'ck_col_unpaid', subKey: 'ck_sub_unpaid' },
  { key: 'paid', titleKey: 'ck_col_paid', subKey: 'ck_sub_paid' },
  { key: 'credit', titleKey: 'ck_col_credit', subKey: 'ck_sub_credit' },
  { key: 'done', titleKey: 'ck_col_done', subKey: 'ck_sub_done' },
];

// Translate a target column into a PATCH body. We preserve existing
// timestamps when moving back into a column the order was already in —
// so a card that was paid_at = 2026-04-15, then moved through credit and
// back to paid, keeps its original paid date.
function targetTimestamps(order: Order, target: KanColumn): { paid_at: string | null; delivered_at: string | null } {
  const now = new Date().toISOString();
  const wantsPaid = target === 'paid' || target === 'done';
  const wantsDelivered = target === 'credit' || target === 'done';
  return {
    paid_at: wantsPaid ? (order.paid_at ?? now) : null,
    delivered_at: wantsDelivered ? (order.delivered_at ?? now) : null,
  };
}

async function moveOrderTo(order: Order, target: KanColumn): Promise<Order> {
  return ordersApi.update(order.id, targetTimestamps(order, target));
}

// Compact bar of "→ Column" buttons. Skips the current column. Used by both
// OrderCard and GroupedCard so the move targets are the same shape everywhere.
function ColumnMoveBar({ current, onMove, t, label }: {
  current: KanColumn;
  onMove: (target: KanColumn) => void | Promise<void>;
  t: T;
  label?: string;
}) {
  return (
    <div className="col-move-bar">
      {label ? <span className="bar-label">{label}</span> : null}
      {COLUMN_KEYS.filter(c => c.key !== current).map(c => (
        <button
          key={c.key}
          type="button"
          className={`col-move-pill ${c.key}`}
          onClick={() => onMove(c.key)}
          title={t('ck_move_to', { col: t(c.titleKey) })}
        >→ {t(c.titleKey)}</button>
      ))}
    </div>
  );
}

export function OrderKanban({ orders, buyers, listings, reload, t }: Props) {
  // Groups stay collapsed by default; users can expand a buyer's group via "Ungroup"
  // and collapse it back via the "regroup" footer that appears on the individual cards.
  // Key shape: `${column}:${buyer_id}`. Doesn't persist across refresh — fresh sessions
  // default to grouped for at-a-glance clarity.
  const [ungrouped, setUngrouped] = useState<Set<string>>(new Set());
  const toggleUngroup = (key: string) => {
    setUngrouped(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const byColumn: Record<KanColumn, Order[]> = {
    unpaid: [], paid: [], credit: [], done: [],
  };
  for (const o of orders) {
    const c = classify(o);
    if (c !== 'cancelled') byColumn[c].push(o);
    // Cancelled orders are rendered by CancelledOrdersSection at the bottom of the page.
  }

  return (
    <>
      <div className="kanban">
        {COLUMN_KEYS.map(col => {
          const colOrders = byColumn[col.key];
          // Sub-group orders by buyer_id so we can collapse same-buyer-same-column into one card
          const byBuyer = new Map<number, Order[]>();
          for (const o of colOrders) {
            const arr = byBuyer.get(o.buyer_id) ?? [];
            arr.push(o);
            byBuyer.set(o.buyer_id, arr);
          }
          return (
            <div key={col.key} className={`kan-col ${col.key}`}>
              <div className="kan-col-head">
                <span>{t(col.titleKey)}</span>
                <span className="count">{colOrders.length}</span>
              </div>
              {colOrders.length === 0 ? (
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--ink-soft)', textAlign: 'center', padding: '20px 0',
                  fontStyle: 'italic', textTransform: 'lowercase', letterSpacing: '0.08em',
                }}>{t(col.subKey)}</div>
              ) : Array.from(byBuyer.entries()).map(([buyerId, group]) => {
                const groupKey = `${col.key}:${buyerId}`;
                const expanded = ungrouped.has(groupKey);
                // Single-order groups always render as a single card
                if (group.length === 1) {
                  return <OrderCard key={group[0].id} order={group[0]} column={col.key} buyers={buyers} listings={listings} reload={reload} t={t} />;
                }
                // Expanded — render each individually, with a regroup footer at the end
                if (expanded) {
                  const buyer = buyers.find(b => b.id === buyerId);
                  const buyerName = buyer?.fb_name ?? t('ck_buyer_anon', { id: buyerId });
                  return (
                    <Fragment key={groupKey}>
                      {group.map(o => (
                        <OrderCard key={o.id} order={o} column={col.key} buyers={buyers} listings={listings} reload={reload} t={t} />
                      ))}
                      <button
                        type="button"
                        className="regroup-btn"
                        onClick={() => toggleUngroup(groupKey)}
                        title={t('ck_regroup_title', { name: buyerName, n: group.length })}
                      >
                        {t('ck_regroup', { name: buyerName, n: group.length })}
                      </button>
                    </Fragment>
                  );
                }
                // Collapsed grouped card
                return (
                  <GroupedCard
                    key={groupKey}
                    orders={group}
                    column={col.key}
                    buyers={buyers}
                    listings={listings}
                    reload={reload}
                    onUngroup={() => toggleUngroup(groupKey)}
                    t={t}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

    </>
  );
}

function GroupedCard({ orders, column, buyers, listings, reload, onUngroup, t }: {
  orders: Order[];
  column: KanColumn;
  buyers: Buyer[];
  listings: Listing[];
  reload: () => void;
  onUngroup: () => void;
  t: T;
}) {
  const dialog = useDialog();
  const showError = (e: unknown) => dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
  const buyer = buyers.find(b => b.id === orders[0].buyer_id);
  const totalMyr = orders.reduce((s, o) => s + parseFloat(o.total_myr), 0);
  const totalItems = orders.reduce(
    (s, o) => s + o.items.reduce((ss, i) => ss + i.qty, 0),
    0,
  );
  // Combined image strip across every item in every order
  const allImages = orders.flatMap(o =>
    o.items.map(it => listings.find(l => l.id === it.listing_id)?.image_url || null),
  );
  const shown = allImages.slice(0, 5);
  const extra = allImages.length - shown.length;

  const buyerNode = buyer?.fb_url ? (
    <a href={buyer.fb_url} target="_blank" rel="noreferrer">{buyer.fb_name}</a>
  ) : (
    <span>{buyer?.fb_name ?? t('ck_buyer_anon', { id: orders[0].buyer_id })}</span>
  );

  const zoom = useImageZoom();
  const oldestDate = new Date(Math.min(...orders.map(o => new Date(o.created_at).getTime())))
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="kan-card kan-group">
      <div className="buyer">
        <div className="name">{buyerNode}</div>
        <div className="total">RM{totalMyr.toFixed(2)}</div>
      </div>

      <div className="group-meta">
        <span className="count">×{orders.length}</span>
        <span>{t(totalItems === 1 ? 'ck_group_orders_cards' : 'ck_group_orders_cards_plural', { n: totalItems })}</span>
      </div>

      {shown.length > 0 ? (
        <div className="items">
          {shown.map((src, i) => (
            src
              ? <img
                  key={i}
                  className="item-thumb zoomable"
                  src={src}
                  alt=""
                  loading="lazy"
                  onClick={() => zoom.open(upgradeScryfallImage(src))}
                />
              : <div key={i} className="item-thumb more">?</div>
          ))}
          {extra > 0 ? <div className="item-thumb more">+{extra}</div> : null}
        </div>
      ) : null}

      <div className="meta">
        {t(orders.length === 1 ? 'ck_group_oldest' : 'ck_group_oldest_plural', { n: orders.length, date: oldestDate })}
      </div>

      <ColumnMoveBar
        current={column}
        t={t}
        label={t('ck_move_all_label')}
        onMove={async (target) => {
          try {
            for (const o of orders) await moveOrderTo(o, target);
            reload();
          } catch (e) { showError(e); }
        }}
      />

      <div className="actions">
        <button
          type="button"
          className="ghost"
          onClick={onUngroup}
          title={t('ck_ungroup_title')}
        >{t('ck_ungroup')}</button>
      </div>
    </div>
  );
}

function OrderCard({ order, column, buyers, listings, reload, t }: {
  order: Order;
  column: KanColumn;
  buyers: Buyer[];
  listings: Listing[];
  reload: () => void;
  t: T;
}) {
  const dialog = useDialog();
  const zoom = useImageZoom();
  const showError = (e: unknown) => dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
  const buyer = buyers.find(b => b.id === order.buyer_id);
  const cancelled = order.status === 'cancelled';

  // Resolve the card image for each item from the in-memory listings array
  const itemImages = order.items
    .map(it => {
      const l = listings.find(l => l.id === it.listing_id);
      return l?.image_url || null;
    });
  const shown = itemImages.slice(0, 4);
  const extra = itemImages.length - shown.length;

  const buyerNode = buyer?.fb_url ? (
    <a href={buyer.fb_url} target="_blank" rel="noreferrer">{buyer.fb_name}</a>
  ) : (
    <span>{buyer?.fb_name ?? t('ck_buyer_anon', { id: order.buyer_id })}</span>
  );

  return (
    <div className="kan-card">
      <div className="buyer">
        <div className="name">{buyerNode}</div>
        <div className="total">RM{order.total_myr}</div>
      </div>

      {shown.length > 0 ? (
        <div className="items">
          {shown.map((src, i) => (
            src
              ? <img
                  key={i}
                  className="item-thumb zoomable"
                  src={src}
                  alt=""
                  loading="lazy"
                  onClick={() => zoom.open(upgradeScryfallImage(src))}
                />
              : <div key={i} className="item-thumb more">?</div>
          ))}
          {extra > 0 ? <div className="item-thumb more">+{extra}</div> : null}
        </div>
      ) : null}

      <div className="summary">
        {order.items.slice(0, 4).map(i =>
          i.qty > 1 ? `${i.qty}× ${i.name_snapshot}` : i.name_snapshot,
        ).join(' · ')}
        {order.items.length > 4 ? ` · +${order.items.length - 4} more` : ''}
      </div>

      <div className="meta">
        <span>{new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        {order.dropoff_method ? <span>· {order.dropoff_method}</span> : null}
      </div>

      {!cancelled && (
        <>
          <ColumnMoveBar
            current={column}
            t={t}
            onMove={async (target) => {
              try { await moveOrderTo(order, target); reload(); }
              catch (e) { showError(e); }
            }}
          />
          <div className="actions">
            <button
              type="button"
              className="ghost cancel"
              onClick={async () => {
                try { await ordersApi.cancel(order.id); reload(); }
                catch (e) { showError(e); }
              }}
            >{t('ck_cancel_order')}</button>
          </div>
        </>
      )}
    </div>
  );
}
