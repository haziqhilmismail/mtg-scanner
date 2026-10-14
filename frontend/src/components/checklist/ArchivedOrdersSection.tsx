import { ordersApi, type Buyer, type Listing, type Order } from '../../api/checklist.ts';
import { upgradeScryfallImage } from '../../utils.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';
import type { T } from '../../hooks/useLang.ts';

interface Props {
  orders: Order[];          // pass all orders; we'll filter archived here
  buyers: Buyer[];
  listings: Listing[];
  reload: () => void;
  t: T;
}

/**
 * Collapsible "Archived" section at the bottom of the checklist. Surfaces
 * every order with a non-null `archived_at` so they aren't lost in the DB —
 * the user can review past completed orders or un-archive ones they want
 * back on the kanban.
 *
 * Mirrors `CancelledOrdersSection`'s look and feel; the only behavioural
 * difference is the action (Unarchive vs Restore) and the badge.
 */
export function ArchivedOrdersSection({ orders, buyers, listings, reload, t }: Props) {
  const dialog = useDialog();
  const archived = orders.filter(o => o.archived_at != null);
  if (archived.length === 0) return null;

  const unarchive = async (id: number) => {
    try { await ordersApi.unarchive(id); reload(); }
    catch (e) { await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message }); }
  };

  return (
    <details className="stock-panel archived-panel">
      <summary>
        <span className="archived-mark">▼</span>
        {t('ck_archived_header')}
        <span className="count">{archived.length}</span>
        <span className="spacer" />
        <span className="sub-hint">{t('ck_archived_subhint')}</span>
      </summary>
      <div className="body">
        <div className="cancelled-grid">
          {archived.map(o => (
            <ArchivedCard
              key={o.id}
              order={o}
              buyers={buyers}
              listings={listings}
              onUnarchive={() => unarchive(o.id)}
              t={t}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function ArchivedCard({ order, buyers, listings, onUnarchive, t }: {
  order: Order;
  buyers: Buyer[];
  listings: Listing[];
  onUnarchive: () => void;
  t: T;
}) {
  const zoom = useImageZoom();
  const buyer = buyers.find(b => b.id === order.buyer_id);
  const totalItems = order.items.reduce((s, i) => s + i.qty, 0);
  const imgs = order.items
    .map(it => listings.find(l => l.id === it.listing_id)?.image_url)
    .filter(Boolean) as string[];
  const shown = imgs.slice(0, 3);
  const more = imgs.length - shown.length;
  const archivedDate = order.archived_at
    ? new Date(order.archived_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="cancelled-card">
      <div className="info">
        <div className="title">
          {buyer?.fb_url ? (
            <a href={buyer.fb_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', borderBottom: '1px dotted var(--ink-soft)' }}>
              {buyer.fb_name}
            </a>
          ) : (
            <span>{buyer?.fb_name ?? t('ck_buyer_anon', { id: order.buyer_id })}</span>
          )}
        </div>
        <div style={{ fontSize: 13,
          color: 'var(--ink-soft)',
        }}>
          {t(totalItems === 1 ? 'ck_cancelled_summary' : 'ck_cancelled_summary_plural', { unique: order.items.length, qty: totalItems })} · <strong style={{ color: 'var(--ink)' }}>RM{order.total_myr}</strong>
        </div>
        <div>
          <span className="badge archived">{t('ck_status_archived')}</span>
        </div>
        {archivedDate ? (
          <div style={{ fontSize: 11,
            color: 'var(--ink-soft)', marginTop: 2,
          }}>
            {t('ck_archived_on', { date: archivedDate })}
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          <button type="button" className="ghost" onClick={onUnarchive}>{t('ck_unarchive_order')}</button>
        </div>
      </div>
      <div className="images">
        {shown.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            className="zoomable"
            onClick={() => zoom.open(upgradeScryfallImage(src))}
          />
        ))}
        {more > 0 ? <div className="more">+{more}</div> : null}
      </div>
    </div>
  );
}
