import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ordersApi, type Buyer, type Listing, type Order } from '../../api/checklist.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';
import { upgradeScryfallImage } from '../../utils.ts';
import { BuyerPhoneEditor } from './BuyerPhoneEditor.tsx';
import { DeliveryPhotoWidget } from './DeliveryPhotoWidget.tsx';

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
// `extraPills` are appended after the move pills inside the same bar — used by
// the Done column to add an Archive pill that matches the move-pill size.
function ColumnMoveBar({ current, onMove, t, label, extraPills }: {
  current: KanColumn;
  onMove: (target: KanColumn) => void | Promise<void>;
  t: T;
  label?: string;
  extraPills?: ReactNode;
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
      {extraPills}
    </div>
  );
}

export function OrderKanban({ orders, buyers, listings, reload, t }: Props) {
  // Grouping is tracked by *individual order IDs* in this Set — not by
  // buyer:column key. That means moving an order between columns doesn't
  // auto-join any existing group: only orders the user explicitly added stay
  // grouped. A buyer-column's "in-group" orders bundle into one GroupedCard
  // when there are 2+; everything else renders as individual cards.
  //
  // Persisted to localStorage so deliberate bundles survive refresh.
  const [groupedIds, setGroupedIds] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem('mtg.checklist.grouped_order_ids');
      if (raw) return new Set(JSON.parse(raw) as number[]);
    } catch { /* corrupted JSON or storage disabled — start clean */ }
    return new Set();
  });
  useEffect(() => {
    try {
      localStorage.setItem('mtg.checklist.grouped_order_ids', JSON.stringify([...groupedIds]));
    } catch { /* quota or disabled — ignore */ }
  }, [groupedIds]);

  const addToGroup = (ids: number[]) => {
    setGroupedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  };
  const removeFromGroup = (ids: number[]) => {
    setGroupedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const byColumn: Record<KanColumn, Order[]> = {
    unpaid: [], paid: [], credit: [], done: [],
  };
  for (const o of orders) {
    const c = classify(o);
    if (c !== 'cancelled') byColumn[c].push(o);
    // Cancelled orders are excluded from the kanban entirely — no Cancelled
    // section any more; the DB rows stay for audit but aren't surfaced in UI.
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
                // Partition by Set membership. Need 2+ in-group to form a
                // GroupedCard; a lone "in-group" order is effectively
                // un-bundled — render it as an OrderCard like the others.
                const inGroup = group.filter(o => groupedIds.has(o.id));
                const outGroup = group.filter(o => !groupedIds.has(o.id));
                const hasBundle = inGroup.length >= 2;

                // Single-order buyer:column → just one card, no group affordance.
                if (group.length === 1) {
                  return <OrderCard key={group[0].id} order={group[0]} column={col.key} buyers={buyers} listings={listings} reload={reload} t={t} />;
                }

                const buyer = buyers.find(b => b.id === buyerId);
                const buyerName = buyer?.fb_name ?? t('ck_buyer_anon', { id: buyerId });

                // Top CTA: when no bundle yet AND 2+ ungrouped orders, offer
                // to group them all at once (most common workflow).
                const showGroupAllCta = !hasBundle && outGroup.length >= 2;

                return (
                  <Fragment key={groupKey}>
                    {showGroupAllCta ? (
                      <button
                        type="button"
                        className="group-cta-btn"
                        onClick={() => addToGroup(outGroup.map(o => o.id))}
                        title={t('ck_group_cta_title', { name: buyerName, n: outGroup.length })}
                      >
                        {t('ck_group_cta', { name: buyerName, n: outGroup.length })}
                      </button>
                    ) : null}

                    {hasBundle ? (
                      <GroupedCard
                        orders={inGroup}
                        column={col.key}
                        buyers={buyers}
                        listings={listings}
                        reload={reload}
                        onUngroup={() => removeFromGroup(inGroup.map(o => o.id))}
                        t={t}
                      />
                    ) : null}

                    {outGroup.map(o => (
                      <OrderCard
                        key={o.id}
                        order={o}
                        column={col.key}
                        buyers={buyers}
                        listings={listings}
                        reload={reload}
                        t={t}
                        // Show "+ Add to group" only when a sibling bundle
                        // exists for this same buyer:column.
                        onAddToGroup={hasBundle ? () => addToGroup([o.id]) : undefined}
                        groupBuyerName={hasBundle ? buyerName : undefined}
                      />
                    ))}
                  </Fragment>
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

  const buyerNode = buyer?.fb_url
    ? <a href={buyer.fb_url} target="_blank" rel="noreferrer">{buyer.fb_name}</a>
    : <span>{buyer?.fb_name ?? t('ck_buyer_anon', { id: orders[0].buyer_id })}</span>;

  const zoom = useImageZoom();
  const oldestDate = new Date(Math.min(...orders.map(o => new Date(o.created_at).getTime())))
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // Cards default to compact — buyer + thumbnails + move bar only. Click the
  // "More ▾" toggle to reveal the order summary, the meta line, the
  // delivery-photo widget, and the bulk action buttons.
  const [expanded, setExpanded] = useState(false);
  // Buyer-edit form lives next to the phone (always visible pencil), so it
  // works in both collapsed and expanded states.
  const [editingBuyer, setEditingBuyer] = useState(false);

  return (
    <div className={`kan-card kan-group${expanded ? ' is-expanded' : ' is-collapsed'}`}>
      <button
        type="button"
        className="kan-cancel-x icon-x"
        onClick={async () => {
          const ok = await dialog.confirm({
            title: t('ck_cancel_group_title'),
            message: t('ck_cancel_group_msg', { n: orders.length }),
            okLabel: t('ck_cancel_group_btn'),
            destructive: true,
          });
          if (!ok) return;
          try {
            for (const o of orders) await ordersApi.cancel(o.id);
            reload();
          } catch (e) { showError(e); }
        }}
        title={t('ck_cancel_group_title')}
        aria-label={t('ck_cancel_group_title')}
      >✕</button>
      <div className="buyer">
        <div className="name">{buyerNode}</div>
        <div className="total">RM{totalMyr.toFixed(2)}</div>
      </div>

      {/* Phone + edit-buyer pencil row. Same position in both collapsed and
          expanded states; the pencil triggers the inline editor regardless. */}
      <div className="kan-phone-row">
        {buyer?.phone ? (
          <a
            className="buyer-phone card-phone"
            href={`tel:${buyer.phone.replace(/\s+/g, '')}`}
            onPointerDown={e => e.stopPropagation()}
          >{buyer.phone}</a>
        ) : (
          <span className="buyer-phone card-phone no-phone">{t('ck_no_phone')}</span>
        )}
        <button
          type="button"
          className="phone-edit-btn pencil"
          onClick={() => setEditingBuyer(true)}
          title={t('ck_buyer_edit_title')}
          aria-label={t('ck_buyer_edit_title')}
        >✎</button>
      </div>
      <BuyerPhoneEditor
        buyer={buyer}
        buyers={buyers}
        editing={editingBuyer}
        onEditingChange={setEditingBuyer}
        onChange={reload}
        t={t}
      />

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
        extraPills={column === 'done' ? (
          <button
            type="button"
            className="col-move-pill archive"
            onClick={async () => {
              try {
                for (const o of orders) await ordersApi.archive(o.id);
                reload();
              } catch (e) { showError(e); }
            }}
            title={t('ck_archive_group_title')}
          >{t('ck_archive_group')}</button>
        ) : null}
      />

      {expanded ? (
        <>
          {/* BuyerPhoneEditor is rendered above next to the phone pencil so
              the trigger stays visible in both states. */}
          <div className="group-meta">
            <span className="count">×{orders.length}</span>
            <span>{t(totalItems === 1 ? 'ck_group_orders_cards' : 'ck_group_orders_cards_plural', { n: totalItems })}</span>
          </div>
          <div className="meta">
            {t(orders.length === 1 ? 'ck_group_oldest' : 'ck_group_oldest_plural', { n: orders.length, date: oldestDate })}
          </div>
          {/* Shared delivery-proof photo across the whole group. Upload fans
              out to every order; if the user ungroups later the photo is
              already on each one, so individual cards can be moved/exported
              without losing the proof. */}
          <DeliveryPhotoWidget orders={orders} onChange={reload} t={t} />
          <div className="actions">
            <button
              type="button"
              className="ghost ungroup-full"
              onClick={onUngroup}
              title={t('ck_ungroup_title')}
            >{t('ck_ungroup')}</button>
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="kan-expand-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        title={expanded ? t('ck_card_collapse_title') : t('ck_card_expand_title')}
      >
        {expanded ? `▴ ${t('ck_card_less')}` : `▾ ${t('ck_card_more')}`}
      </button>
    </div>
  );
}

function OrderCard({
  order, column, buyers, listings, reload, t,
  onAddToGroup, groupBuyerName,
}: {
  order: Order;
  column: KanColumn;
  buyers: Buyer[];
  listings: Listing[];
  reload: () => void;
  t: T;
  // When set, this order is an ungrouped sibling of an existing GroupedCard
  // for the same buyer in the same column. Renders a "+ Add to group" pill
  // so the user can include it without re-grouping the whole column.
  onAddToGroup?: () => void;
  groupBuyerName?: string;
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

  const buyerNode = buyer?.fb_url
    ? <a href={buyer.fb_url} target="_blank" rel="noreferrer">{buyer.fb_name}</a>
    : <span>{buyer?.fb_name ?? t('ck_buyer_anon', { id: order.buyer_id })}</span>;

  // Default collapsed — buyer + phone + thumbnails + move bar only. Toggle
  // reveals the items summary, meta line, delivery photo, and the per-order
  // cancel button.
  const [expanded, setExpanded] = useState(false);
  // Buyer-edit form. Trigger lives next to the phone, always visible.
  const [editingBuyer, setEditingBuyer] = useState(false);

  return (
    <div className={`kan-card${expanded ? ' is-expanded' : ' is-collapsed'}`}>
      {!cancelled && (
        <button
          type="button"
          className="kan-cancel-x icon-x"
          onClick={async () => {
            const ok = await dialog.confirm({
              title: t('ck_cancel_order_title'),
              message: t('ck_cancel_order_msg'),
              okLabel: t('ck_cancel_order'),
              destructive: true,
            });
            if (!ok) return;
            try { await ordersApi.cancel(order.id); reload(); }
            catch (e) { showError(e); }
          }}
          title={t('ck_cancel_order_title')}
          aria-label={t('ck_cancel_order_title')}
        >✕</button>
      )}
      <div className="buyer">
        <div className="name">{buyerNode}</div>
        <div className="total">RM{order.total_myr}</div>
      </div>

      {/* Phone + edit-buyer pencil row — same position in both states. */}
      <div className="kan-phone-row">
        {buyer?.phone ? (
          <a
            className="buyer-phone card-phone"
            href={`tel:${buyer.phone.replace(/\s+/g, '')}`}
            onPointerDown={e => e.stopPropagation()}
          >{buyer.phone}</a>
        ) : (
          <span className="buyer-phone card-phone no-phone">{t('ck_no_phone')}</span>
        )}
        <button
          type="button"
          className="phone-edit-btn pencil"
          onClick={() => setEditingBuyer(true)}
          title={t('ck_buyer_edit_title')}
          aria-label={t('ck_buyer_edit_title')}
        >✎</button>
      </div>
      <BuyerPhoneEditor
        buyer={buyer}
        buyers={buyers}
        editing={editingBuyer}
        onEditingChange={setEditingBuyer}
        onChange={reload}
        t={t}
      />

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

      {!cancelled && (
        <ColumnMoveBar
          current={column}
          t={t}
          onMove={async (target) => {
            try { await moveOrderTo(order, target); reload(); }
            catch (e) { showError(e); }
          }}
          extraPills={column === 'done' ? (
            <button
              type="button"
              className="col-move-pill archive"
              onClick={async () => {
                try { await ordersApi.archive(order.id); reload(); }
                catch (e) { showError(e); }
              }}
              title={t('ck_archive_order_title')}
            >{t('ck_archive_order')}</button>
          ) : null}
        />
      )}

      {expanded ? (
        <>
          {/* Editor trigger lives next to the phone above, always visible. */}
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
          {!cancelled ? (
            <DeliveryPhotoWidget orders={[order]} onChange={reload} t={t} />
          ) : null}
          {!cancelled && onAddToGroup ? (
            <div className="actions">
              <button
                type="button"
                className="ghost add-to-group"
                onClick={onAddToGroup}
                title={t('ck_add_to_group_title', { name: groupBuyerName ?? '' })}
              >{t('ck_add_to_group')}</button>
            </div>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className="kan-expand-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        title={expanded ? t('ck_card_collapse_title') : t('ck_card_expand_title')}
      >
        {expanded ? `▴ ${t('ck_card_less')}` : `▾ ${t('ck_card_more')}`}
      </button>
    </div>
  );
}
