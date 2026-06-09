import { useCallback, useEffect, useState } from 'react';
import { buyersApi, listingsApi, ordersApi, postsApi, type Buyer, type Listing, type Order, type Post } from '../api/checklist.ts';
import { ArchivedOrdersSection } from '../components/checklist/ArchivedOrdersSection.tsx';
import { ListingsView } from '../components/checklist/ListingsView.tsx';
import { NewOrderCard } from '../components/checklist/NewOrderCard.tsx';
import { OrderKanban } from '../components/checklist/OrderKanban.tsx';
import { PostsView } from '../components/checklist/PostsView.tsx';

interface Props {
  t: (k: string, vars?: Record<string, string | number>) => string;
}

// Three-step workflow surface:
//   1. Posts — group cards by the FB post they were advertised in (optional but recommended)
//   2. Orders kanban — track who claimed what and move them through paid/delivered/done
//   3. Stock — flat catalog view; useful when you don't care about post grouping
// Cancelled orders live in a separate panel at the very bottom of the page.
export function Checklist({ t }: Props) {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // Listing ids to pre-seed into the new-order form. One id when "+ Order" is
  // clicked on a single row; many when "Add to order" is used on a bulk stock
  // selection.
  const [pendingListingIds, setPendingListingIds] = useState<number[]>([]);

  // Open the new-order form seeded with the given listings and scroll it into
  // view (the form lives above the stock panel).
  const openNewOrder = useCallback((ids: number[]) => {
    setPendingListingIds(ids);
    setShowForm(true);
    setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 0);
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [b, l, o, p] = await Promise.all([
        buyersApi.list(),
        listingsApi.list(),
        // include archived orders too — the Archived section needs them, and
        // the kanban filters them out via the archived_at field.
        ordersApi.list(true),
        // include archived posts so PostsView can offer un-archive; selectors
        // that shouldn't show archived filter them out themselves.
        postsApi.list(true),
      ]);
      setBuyers(b);
      setListings(l);
      setOrders(o);
      setPosts(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const activeListings = listings.filter(l => l.status === 'active');
  // Kanban shows orders that are neither cancelled nor archived. Archived
  // ones live in the Archived section at the bottom of the page.
  const activeOrders = orders.filter(o => o.status !== 'cancelled' && o.archived_at == null);
  const kanbanOrders = orders.filter(o => o.archived_at == null);

  return (
    <div>
      {/* Workflow hint — three numbered steps explaining the flow */}
      <div className="ck-flow">
        <span className="ck-flow-step"><span className="step-num">1</span> {t('ck_flow_step1')}</span>
        <span className="ck-flow-arrow">→</span>
        <span className="ck-flow-step"><span className="step-num">2</span> {t('ck_flow_step2')}</span>
        <span className="ck-flow-arrow">→</span>
        <span className="ck-flow-step"><span className="step-num">3</span> {t('ck_flow_step3')}</span>
      </div>

      {/* New order entry — kept at the top because it's the recurring task */}
      <div className="list-toolbar">
        <h3>{t('ck_orders')} · {activeOrders.length}</h3>
        <div className="spacer" />
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            disabled={activeListings.length === 0}
            title={activeListings.length === 0 ? t('ck_new_order_disabled_hint') : ''}
          >{t('ck_new_order')}</button>
        )}
      </div>

      {error ? (
        <div className="form-error" style={{ marginBottom: 14 }}>
          {t('ck_backend_error', { err: error })}
        </div>
      ) : null}

      {showForm && (
        <NewOrderCard
          buyers={buyers}
          listings={listings}
          initialListingIds={pendingListingIds}
          t={t}
          onCancel={() => { setShowForm(false); setPendingListingIds([]); }}
          onCreated={() => { setShowForm(false); setPendingListingIds([]); reload(); }}
        />
      )}

      {loading ? (
        <div className="checklist-empty">
          <div className="sub loading">{t('ck_loading')}</div>
        </div>
      ) : (
        <>
          {/* Kanban — the daily workflow surface. Archived orders are filtered
              out (they live in ArchivedOrdersSection below). */}
          <OrderKanban
            orders={kanbanOrders}
            buyers={buyers}
            listings={listings}
            reload={reload}
            t={t}
          />

          {/* Posts — primary catalog organization (the user's "most important" entity).
              Default-open and prominent. */}
          <section className="ck-section primary">
            <header className="ck-section-head">
              <h2><span className="ck-tag">{t('ck_section_tag_posts')}</span>{t('ck_posts_panel')}</h2>
              <p className="ck-section-sub">{t('ck_posts_section_sub')}</p>
            </header>
            <PostsView
              posts={posts}
              listings={listings}
              reload={reload}
              onCreateOrder={(l) => openNewOrder([l.id])}
              t={t}
            />
          </section>

          {/* Stock — flat catalog. Useful for cross-cutting search. Default-closed
              if posts exist to push the user toward post-organized views. */}
          <details className="stock-panel" open={posts.length === 0}>
            <summary>
              {t('ck_stock_listings')}
              <span className="count">{t('ck_stock_count', { active: activeListings.length, total: listings.length })}</span>
              <span className="spacer" />
              <span className="sub-hint">{t('ck_stock_subhint')}</span>
            </summary>
            <div className="body">
              <ListingsView
                listings={listings}
                posts={posts}
                reload={reload}
                t={t}
                onCreateOrder={(l) => openNewOrder([l.id])}
                onBulkCreateOrder={(ids) => openNewOrder(ids)}
              />
            </div>
          </details>

          {/* Archived orders — finished sales the user explicitly moved out
              of the kanban. Collapsed by default; click to expand. */}
          <ArchivedOrdersSection
            orders={orders}
            buyers={buyers}
            listings={listings}
            reload={reload}
            t={t}
          />
          {/* Cancelled orders intentionally hide from the UI — the × button
              cancels (DB row stays for audit) but there's no surface for
              browsing/restoring them. The Cancelled section was removed for
              kanban focus; restore via direct DB if ever needed. */}
        </>
      )}
    </div>
  );
}
