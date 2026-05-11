import { useState } from 'react';
import { ordersApi, type Buyer, type Listing, type Order, type OrderItemPayload } from '../../api/checklist.ts';

interface Props {
  orders: Order[];
  buyers: Buyer[];
  listings: Listing[];
  reload: () => void;
}

function buyerName(buyers: Buyer[], id: number): string {
  return buyers.find(b => b.id === id)?.fb_name ?? `Buyer #${id}`;
}

function orderStatusBadges(o: Order) {
  if (o.status === 'cancelled') return <span className="badge cancelled">cancelled</span>;
  const paid = !!o.paid_at;
  const delivered = !!o.delivered_at;
  // "Credit" = delivered but not paid (the tricky case)
  if (delivered && !paid) {
    return (
      <>
        <span className="badge credit">on credit</span>
        <span className="badge delivered" style={{ marginLeft: 4 }}>delivered</span>
      </>
    );
  }
  return (
    <>
      <span className={`badge ${paid ? 'paid' : 'unpaid'}`}>{paid ? 'paid' : 'unpaid'}</span>
      <span className={`badge ${delivered ? 'delivered' : 'pending'}`} style={{ marginLeft: 4 }}>
        {delivered ? 'delivered' : 'pending'}
      </span>
    </>
  );
}

export function OrdersView({ orders, buyers, listings, reload }: Props) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <div className="list-toolbar">
        <h3>Orders · {orders.length}</h3>
        <div className="spacer" />
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            disabled={buyers.length === 0 || listings.length === 0}
            title={
              buyers.length === 0
                ? 'Add a buyer first'
                : listings.length === 0 ? 'Add a listing first' : ''
            }
          >+ New order</button>
        )}
      </div>

      {showForm && (
        <OrderForm
          buyers={buyers}
          listings={listings}
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Buyer</th>
            <th className="num">Items</th>
            <th className="num">Total</th>
            <th>Status</th>
            <th>When</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr><td colSpan={6} className="empty">No orders yet.</td></tr>
          ) : orders.map(o => (
            <tr key={o.id}>
              <td>
                <strong>{buyerName(buyers, o.buyer_id)}</strong>
                {o.items.length > 0 ? (
                  <div style={{ color: 'var(--ink-soft)', fontSize: 11, marginTop: 4 }}>
                    {o.items.slice(0, 3).map(i => i.name_snapshot).join(' · ')}
                    {o.items.length > 3 ? ` · +${o.items.length - 3} more` : ''}
                  </div>
                ) : null}
              </td>
              <td className="num">{o.items.reduce((s, i) => s + i.qty, 0)}</td>
              <td className="num"><strong>RM{o.total_myr}</strong></td>
              <td>{orderStatusBadges(o)}</td>
              <td>
                {new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {o.paid_at ? (
                  <div style={{ color: 'var(--green)', fontSize: 10 }}>
                    paid {new Date(o.paid_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                ) : null}
                {o.delivered_at ? (
                  <div style={{ color: 'var(--ink-soft)', fontSize: 10 }}>
                    delivered {new Date(o.delivered_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                ) : null}
              </td>
              <td className="actions-cell">
                {o.status !== 'cancelled' && !o.paid_at && (
                  <button
                    className="ghost"
                    onClick={async () => {
                      try { await ordersApi.markPaid(o.id); reload(); }
                      catch (e) { alert((e as Error).message); }
                    }}
                  >Mark paid</button>
                )}
                {o.status !== 'cancelled' && !o.delivered_at && (
                  <button
                    className="ghost"
                    onClick={async () => {
                      try { await ordersApi.markDelivered(o.id); reload(); }
                      catch (e) { alert((e as Error).message); }
                    }}
                  >Mark delivered</button>
                )}
                {o.status !== 'cancelled' && (
                  <button
                    className="ghost"
                    onClick={async () => {
                      if (!confirm('Cancel this order?')) return;
                      try { await ordersApi.cancel(o.id); reload(); }
                      catch (e) { alert((e as Error).message); }
                    }}
                  >Cancel</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderForm({
  buyers, listings, onCancel, onSaved,
}: {
  buyers: Buyer[];
  listings: Listing[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [buyerId, setBuyerId] = useState<number>(buyers[0]?.id ?? 0);
  const [items, setItems] = useState<OrderItemPayload[]>([
    { listing_id: listings[0]?.id ?? 0, qty: 1 },
  ]);
  const [dropoffMethod, setDropoffMethod] = useState<string>('');
  const [dropoffAddress, setDropoffAddress] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const active = listings.filter(l => l.status === 'active');

  const addItem = () => setItems([...items, { listing_id: active[0]?.id ?? 0, qty: 1 }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<OrderItemPayload>) =>
    setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const total = items.reduce((sum, it) => {
    const l = listings.find(l => l.id === it.listing_id);
    if (!l) return sum;
    return sum + parseFloat(l.unit_price_myr) * (it.qty || 1);
  }, 0);

  const save = async () => {
    setErr(null);
    if (!buyerId) { setErr('Pick a buyer'); return; }
    if (items.length === 0) { setErr('Add at least one item'); return; }
    if (items.some(it => !it.listing_id || it.qty < 1)) {
      setErr('Every item needs a listing and qty ≥ 1'); return;
    }
    setBusy(true);
    try {
      await ordersApi.create({
        buyer_id: buyerId,
        items,
        dropoff_method: dropoffMethod.trim() || null,
        dropoff_address: dropoffAddress.trim() || null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="form-card">
      <h3>New order</h3>
      <div className="form-grid">
        <label className="full">
          <span>Buyer *</span>
          <select value={buyerId} onChange={e => setBuyerId(parseInt(e.target.value))}>
            {buyers.map(b => (
              <option key={b.id} value={b.id}>{b.fb_name}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.14em',
          color: 'var(--ink-soft)', marginBottom: 8, fontWeight: 700,
        }}>Items</div>
        {items.map((it, i) => {
          const l = listings.find(l => l.id === it.listing_id);
          const linePrice = l ? parseFloat(l.unit_price_myr) * (it.qty || 1) : 0;
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select
                value={it.listing_id}
                onChange={e => updateItem(i, { listing_id: parseInt(e.target.value) })}
                style={{
                  flex: 2, padding: '8px 10px', border: '1px solid var(--rule)',
                  background: 'var(--surface)', color: 'var(--ink)',
                  borderRadius: 'var(--radius)',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                }}
              >
                {active.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.set_code ? `[${l.set_code.toUpperCase()}]` : ''} · RM{l.unit_price_myr}
                  </option>
                ))}
              </select>
              <input
                type="number" min="1" step="1" value={it.qty}
                onChange={e => updateItem(i, { qty: parseInt(e.target.value) || 1 })}
                style={{
                  width: 60, padding: '8px 10px', border: '1px solid var(--rule)',
                  background: 'var(--surface)', color: 'var(--ink)',
                  borderRadius: 'var(--radius)',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                  textAlign: 'center',
                }}
              />
              <div style={{
                width: 80, textAlign: 'right',
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13,
              }}>
                RM{linePrice.toFixed(2)}
              </div>
              {items.length > 1 ? (
                <button className="ghost" onClick={() => removeItem(i)}>×</button>
              ) : null}
            </div>
          );
        })}
        <button className="ghost" onClick={addItem} style={{ marginTop: 4 }}>+ Add item</button>
      </div>

      <div style={{ marginTop: 18 }} className="form-grid">
        <label>
          <span>Dropoff method</span>
          <select value={dropoffMethod} onChange={e => setDropoffMethod(e.target.value)}>
            <option value="">(use buyer default)</option>
            <option value="meetup">Meetup</option>
            <option value="post">Post</option>
            <option value="cod">COD</option>
            <option value="pickup">Pickup</option>
          </select>
        </label>
        <label className="full">
          <span>Dropoff address / notes</span>
          <textarea value={dropoffAddress} onChange={e => setDropoffAddress(e.target.value)} />
        </label>
        <label className="full">
          <span>Order notes</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
      </div>

      <div style={{
        marginTop: 14, padding: '10px 14px',
        background: 'var(--ink)', color: 'var(--paper)',
        borderRadius: 'var(--radius)',
        fontFamily: "'JetBrains Mono', monospace",
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 11 }}>Total</span>
        <strong style={{ fontSize: 16 }}>RM{total.toFixed(2)}</strong>
      </div>

      {err ? <div className="form-error">{err}</div> : null}
      <div className="form-actions">
        <button className="accent" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Create order'}
        </button>
        <button className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
