import { useState } from 'react';
import { buyersApi, type Buyer, type BuyerCreatePayload } from '../../api/checklist.ts';

interface Props {
  buyers: Buyer[];
  reload: () => void;
}

export function BuyersView({ buyers, reload }: Props) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <div className="list-toolbar">
        <h3>Buyers · {buyers.length}</h3>
        <div className="spacer" />
        {!showForm && (
          <button onClick={() => setShowForm(true)}>+ Add buyer</button>
        )}
      </div>

      {showForm && (
        <BuyerForm
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Facebook name</th>
            <th>Profile / contact</th>
            <th>Default dropoff</th>
            <th className="num">Open</th>
            <th className="num">Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {buyers.length === 0 ? (
            <tr><td colSpan={6} className="empty">No buyers yet — click "Add buyer" to start.</td></tr>
          ) : buyers.map(b => (
            <tr key={b.id}>
              <td><strong>{b.fb_name}</strong></td>
              <td>
                {b.fb_url ? (
                  <a href={b.fb_url} target="_blank" rel="noreferrer">{b.fb_url.replace(/^https?:\/\//, '')}</a>
                ) : '—'}
                {b.phone ? <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{b.phone}</div> : null}
              </td>
              <td>
                {b.default_dropoff_method || '—'}
                {b.default_dropoff_address ? (
                  <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{b.default_dropoff_address}</div>
                ) : null}
              </td>
              <td className="num">{b.open_orders_count ?? 0}</td>
              <td className="num">{b.total_orders_count ?? 0}</td>
              <td className="actions-cell">
                <button
                  className="ghost"
                  onClick={async () => {
                    if (!confirm(`Delete buyer "${b.fb_name}"?`)) return;
                    try { await buyersApi.remove(b.id); reload(); }
                    catch (e) { alert((e as Error).message); }
                  }}
                >Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuyerForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [payload, setPayload] = useState<BuyerCreatePayload>({
    fb_name: '', fb_url: '', phone: '',
    default_dropoff_method: '', default_dropoff_address: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!payload.fb_name.trim()) { setErr('Facebook name is required'); return; }
    setBusy(true);
    try {
      // Send empty strings as null so the DB stores NULL, not ""
      const cleaned: BuyerCreatePayload = {
        fb_name: payload.fb_name.trim(),
        fb_url: payload.fb_url?.trim() || null,
        phone: payload.phone?.trim() || null,
        default_dropoff_method: payload.default_dropoff_method?.trim() || null,
        default_dropoff_address: payload.default_dropoff_address?.trim() || null,
        notes: payload.notes?.trim() || null,
      };
      await buyersApi.create(cleaned);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="form-card">
      <h3>New buyer</h3>
      <div className="form-grid">
        <label>
          <span>Facebook name *</span>
          <input
            autoFocus
            value={payload.fb_name}
            onChange={e => setPayload({ ...payload, fb_name: e.target.value })}
          />
        </label>
        <label>
          <span>FB profile URL</span>
          <input
            value={payload.fb_url ?? ''}
            onChange={e => setPayload({ ...payload, fb_url: e.target.value })}
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            value={payload.phone ?? ''}
            onChange={e => setPayload({ ...payload, phone: e.target.value })}
          />
        </label>
        <label>
          <span>Default dropoff</span>
          <select
            value={payload.default_dropoff_method ?? ''}
            onChange={e => setPayload({ ...payload, default_dropoff_method: e.target.value })}
          >
            <option value="">(none)</option>
            <option value="meetup">Meetup</option>
            <option value="post">Post</option>
            <option value="cod">COD</option>
            <option value="pickup">Pickup</option>
          </select>
        </label>
        <label className="full">
          <span>Dropoff address / notes</span>
          <textarea
            value={payload.default_dropoff_address ?? ''}
            onChange={e => setPayload({ ...payload, default_dropoff_address: e.target.value })}
          />
        </label>
        <label className="full">
          <span>Internal notes</span>
          <textarea
            value={payload.notes ?? ''}
            onChange={e => setPayload({ ...payload, notes: e.target.value })}
          />
        </label>
      </div>
      {err ? <div className="form-error">{err}</div> : null}
      <div className="form-actions">
        <button className="accent" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save buyer'}
        </button>
        <button className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
