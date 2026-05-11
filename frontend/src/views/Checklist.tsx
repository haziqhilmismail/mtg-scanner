import { useCallback, useEffect, useState } from 'react';
import { buyersApi, listingsApi, ordersApi, postsApi, type Buyer, type Listing, type Order, type Post } from '../api/checklist.ts';
import { CancelledOrdersSection } from '../components/checklist/CancelledOrdersSection.tsx';
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
  // Listing id to pre-seed into the new-order form when user clicks "+ Order" on a stock row
  const [pendingListingId, setPendingListingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [b, l, o, p] = await Promise.all([
        buyersApi.list(),
        listingsApi.list(),
        ordersApi.list(),
        // include archived so PostsView can offer un-archive; selectors that
        // shouldn't show archived filter them out themselves.
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
  const activeOrders = orders.filter(o => o.status !== 'cancelled');

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
          initialListingId={pendingListingId}
          t={t}
          onCancel={() => { setShowForm(false); setPendingListingId(null); }}
          onCreated={() => { setShowForm(false); setPendingListingId(null); reload(); }}
        />
      )}

      {loading ? (
        <div className="checklist-empty">
          <div className="sub loading">{t('ck_loading')}</div>
        </div>
      ) : (
        <>
          {/* Kanban — the daily workflow surface */}
          <OrderKanban
            orders={orders}
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
              onCreateOrder={(l) => {
                setPendingListingId(l.id);
                setShowForm(true);
                setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 0);
              }}
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
                onCreateOrder={(l) => {
                  setPendingListingId(l.id);
                  setShowForm(true);
                  // Scroll the form into view (it's above the stock panel)
                  setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }, 0);
                }}
              />
            </div>
          </details>

          {/* Cancelled orders — separated to the bottom of the page so they
              don't pollute the active kanban view. */}
          <CancelledOrdersSection
            orders={orders}
            buyers={buyers}
            listings={listings}
            reload={reload}
            t={t}
          />
        </>
      )}
    </div>
  );
}
