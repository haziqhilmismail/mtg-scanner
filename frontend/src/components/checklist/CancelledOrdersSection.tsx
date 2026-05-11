import { ordersApi, type Buyer, type Listing, type Order } from '../../api/checklist.ts';
import { upgradeScryfallImage } from '../../utils.ts';
import { useDialog } from '../DialogProvider.tsx';
import { useImageZoom } from '../ImageZoomProvider.tsx';

type T = (k: string, vars?: Record<string, string | number>) => string;

interface Props {
  orders: Order[];          // pass all orders; we'll filter cancelled here
  buyers: Buyer[];
  listings: Listing[];
  reload: () => void;
  t: T;
}

// Standalone "trash bin" section that lives at the bottom of the checklist
// page. Surfaces every cancelled order with a one-click Restore so they aren't
// hidden inside the kanban any more.
export function CancelledOrdersSection({ orders, buyers, listings, reload, t }: Props) {
  const dialog = useDialog();
  const cancelled = orders.filter(o => o.status === 'cancelled');
  if (cancelled.length === 0) return null;

  const restore = async (id: number) => {
    try { await ordersApi.restore(id); reload(); }
    catch (e) { await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message }); }
  };

  return (
    <details className="stock-panel cancelled-panel">
      <summary>
        <span className="cancelled-mark">✕</span>
        {t('ck_cancelled_header')}
        <span className="count">{cancelled.length}</span>
        <span className="spacer" />
        <span className="sub-hint">{t('ck_cancelled_subhint')}</span>
      </summary>
      <div className="body">
        <div className="cancelled-grid">
          {cancelled.map(o => (
            <CancelledCard
              key={o.id}
              order={o}
              buyers={buyers}
              listings={listings}
              onRestore={() => restore(o.id)}
              t={t}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function CancelledCard({ order, buyers, listings, onRestore, t }: {
  order: Order;
  buyers: Buyer[];
  listings: Listing[];
  onRestore: () => void;
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
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: 'var(--ink-soft)', letterSpacing: '0.04em',
        }}>
          {t(totalItems === 1 ? 'ck_cancelled_summary' : 'ck_cancelled_summary_plural', { unique: order.items.length, qty: totalItems })} · <strong style={{ color: 'var(--ink)' }}>RM{order.total_myr}</strong>
        </div>
        <div>
          <span className="badge cancelled">{t('ck_status_cancelled')}</span>
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2,
        }}>
          {new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="ghost" onClick={onRestore}>{t('ck_restore_order')}</button>
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
