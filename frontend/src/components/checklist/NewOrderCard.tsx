import { useState } from 'react';
import { ordersApi, type Buyer, type Listing, type OrderItemPayload } from '../../api/checklist.ts';
import { BuyerNamePicker } from './BuyerNamePicker.tsx';

interface Props {
  buyers: Buyer[];
  listings: Listing[];
  // One row is seeded per id (bulk "Add to order" from stock). A single click
  // passes a one-element array. Ids that aren't active listings are dropped.
  initialListingIds?: number[];
  onCreated: () => void;
  onCancel: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

// Inline form: buyer is identified by FB name (with optional URL). Backend
// resolves the name against existing buyers case-insensitively, creating a
// new buyer row only if there's no match. No separate "manage buyers" UI.
export function NewOrderCard({ buyers, listings, initialListingIds, onCreated, onCancel, t }: Props) {
  const active = listings.filter(l => l.status === 'active');
  const [fbName, setFbName] = useState('');
  const [fbUrl, setFbUrl] = useState('');
  const [phone, setPhone] = useState('');
  // Seed one row per prefilled listing (bulk "Add to order" from the stock
  // panel); only ids that are actually active listings survive. Falls back to
  // the first active listing when nothing was passed in.
  const seedIds = (initialListingIds ?? []).filter(id => active.some(l => l.id === id));
  const [items, setItems] = useState<OrderItemPayload[]>(
    seedIds.length > 0
      ? seedIds.map(id => ({ listing_id: id, qty: 1 }))
      : [{ listing_id: active[0]?.id ?? 0, qty: 1 }],
  );
  // BuyerNamePicker autoFocuses its own input on mount, so we don't need a
  // separate ref-based focus dance when seed listings are provided.
  const [dropoffMethod, setDropoffMethod] = useState<string>('dropoff');
  // Default drop-off location — user's regular spot for handing cards over
  const [dropoffAddress, setDropoffAddress] = useState<string>('Cards and Hobbies');
  const [notes, setNotes] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If the typed name exactly matches an existing buyer, prefill the URL field
  const matchedBuyer = buyers.find(
    b => b.fb_name.trim().toLowerCase() === fbName.trim().toLowerCase(),
  );

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
    if (!fbName.trim()) { setErr(t('ck_err_buyer_required')); return; }
    if (items.length === 0) { setErr(t('ck_err_no_items')); return; }
    if (items.some(it => !it.listing_id || it.qty < 1)) {
      setErr(t('ck_err_invalid_items')); return;
    }
    setBusy(true);
    try {
      await ordersApi.create({
        // Always send the FB name + URL + phone — backend will look up an
        // existing buyer by case-insensitive name or create a new one. Phone
        // and URL are only written back if the existing record's field is
        // null (won't overwrite stored data).
        buyer_fb_name: fbName.trim(),
        buyer_fb_url: fbUrl.trim() || (matchedBuyer?.fb_url ?? null),
        buyer_phone: phone.trim() || (matchedBuyer?.phone ?? null),
        items,
        dropoff_method: dropoffMethod.trim() || null,
        dropoff_address: dropoffAddress.trim() || null,
        notes: notes.trim() || null,
      });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="new-order-card">
      <div className="head">{t('ck_new_order_title')}</div>

      <div className="form-grid">
        <label>
          <span>{t('ck_buyer_fb_name')}</span>
          <BuyerNamePicker
            buyers={buyers}
            value={fbName}
            onChange={setFbName}
            onPick={(b) => {
              // Picking an existing buyer is an explicit "use their data"
              // signal — overwrite both fields with whatever the buyer
              // record has so the user sees exactly what's on file. Empty
              // record fields stay empty (no clobbering with empty string).
              setFbUrl(b.fb_url ?? '');
              setPhone(b.phone ?? '');
            }}
            placeholder={t('ck_buyer_name_placeholder')}
            required
            t={t}
          />
        </label>
        <label>
          <span>{t('ck_buyer_fb_url')}</span>
          <input
            placeholder={matchedBuyer?.fb_url
              ? t('ck_buyer_url_placeholder_existing', { url: matchedBuyer.fb_url.replace(/^https?:\/\//, '') })
              : t('ck_buyer_url_placeholder_default')}
            value={fbUrl}
            onChange={e => setFbUrl(e.target.value)}
          />
        </label>
        <label>
          <span>{t('ck_buyer_phone')}</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder={matchedBuyer?.phone
              ? t('ck_buyer_phone_placeholder_existing', { phone: matchedBuyer.phone })
              : t('ck_buyer_phone_placeholder_default')}
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </label>
      </div>

      {!fbName.trim() ? (
        <div style={{
          marginTop: 8, padding: '8px 12px',
          background: 'var(--accent-soft)', borderRadius: 'var(--radius)',
          borderLeft: '3px solid var(--accent)', fontSize: 13, fontWeight: 600,
          color: 'var(--accent)',
        }}>
          {t('ck_buyer_required_banner')}
        </div>
      ) : matchedBuyer ? (
        <div style={{
          marginTop: 8, padding: '6px 10px',
          background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 12,
          color: 'var(--green)',
        }}>
          {t(
            (matchedBuyer.total_orders_count ?? 0) === 1 ? 'ck_buyer_match' : 'ck_buyer_match_plural',
            { n: matchedBuyer.total_orders_count ?? 0 },
          )}
        </div>
      ) : (
        <div style={{
          marginTop: 8, padding: '6px 10px',
          background: 'var(--accent-soft)', borderRadius: 'var(--radius)', fontSize: 12,
          color: 'var(--accent)',
        }}>
          {t('ck_buyer_new')}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12,
          color: 'var(--ink-soft)', marginBottom: 8, fontWeight: 600,
        }}>{t('ck_items')}</div>
        {items.map((it, i) => {
          const l = listings.find(l => l.id === it.listing_id);
          const linePrice = l ? parseFloat(l.unit_price_myr) * (it.qty || 1) : 0;
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              {l?.image_url ? (
                <img
                  src={l.image_url}
                  alt=""
                  style={{
                    width: 36, aspectRatio: '488 / 680',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--rule)',
                    objectFit: 'cover',
                  }}
                />
              ) : null}
              <select
                value={it.listing_id}
                onChange={e => updateItem(i, { listing_id: parseInt(e.target.value) })}
                style={{
                  flex: 2, padding: '8px 10px', border: '1px solid var(--rule)',
                  background: 'var(--surface)', color: 'var(--ink)',
                  borderRadius: 'var(--radius)', fontSize: 13,
                }}
              >
                {active.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}{l.set_code ? ` [${l.set_code.toUpperCase()}]` : ''} · RM{l.unit_price_myr}{l.is_foil ? ' · FOIL' : ''}
                  </option>
                ))}
              </select>
              <input
                type="number" min="1" step="1" value={it.qty}
                onChange={e => updateItem(i, { qty: parseInt(e.target.value) || 1 })}
                style={{
                  width: 60, padding: '8px 10px', border: '1px solid var(--rule)',
                  background: 'var(--surface)', color: 'var(--ink)',
                  borderRadius: 'var(--radius)', fontSize: 13,
                  textAlign: 'center',
                }}
              />
              <div style={{
                width: 80, textAlign: 'right', fontWeight: 600, fontSize: 15,
              }}>RM{linePrice.toFixed(2)}</div>
              {items.length > 1 ? (
                <button className="ghost" onClick={() => removeItem(i)}>×</button>
              ) : null}
            </div>
          );
        })}
        <button className="ghost" onClick={addItem} style={{ marginTop: 4 }}>{t('ck_add_item')}</button>
      </div>

      <div style={{ marginTop: 18 }} className="form-grid">
        <label>
          <span>{t('ck_dropoff_method')}</span>
          <select value={dropoffMethod} onChange={e => setDropoffMethod(e.target.value)}>
            <option value="dropoff">{t('ck_dropoff_dropoff')}</option>
            <option value="meetup">{t('ck_dropoff_meetup')}</option>
            <option value="post">{t('ck_dropoff_post')}</option>
            <option value="cod">{t('ck_dropoff_cod')}</option>
          </select>
        </label>
        <label>
          <span>{t('ck_dropoff_address')}</span>
          <input
            value={dropoffAddress}
            onChange={e => setDropoffAddress(e.target.value)}
          />
        </label>
        <label className="full">
          <span>{t('ck_order_notes')}</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
      </div>

      <div style={{
        marginTop: 14,
        marginBottom: 18,
        padding: '7px 14px',
        background: 'var(--ink)', color: 'var(--paper)',
        borderRadius: 'var(--radius)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        lineHeight: 1.2,
      }}>
        <span style={{ fontSize: 12 }}>{t('ck_total_label')}</span>
        <strong style={{ fontSize: 15 }}>RM{total.toFixed(2)}</strong>
      </div>

      {err ? <div className="form-error">{err}</div> : null}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button
          className="accent"
          disabled={busy || active.length === 0}
          onClick={save}
        >
          {busy ? t('ck_saving') : t('ck_create_order_btn')}
        </button>
        <button className="ghost" disabled={busy} onClick={onCancel}>{t('ck_cancel')}</button>
      </div>
      {active.length === 0 ? (
        <div style={{
          marginTop: 10, fontSize: 12,
          color: 'var(--warn)',
        }}>
          {t('ck_no_active_listings')}
        </div>
      ) : null}
    </div>
  );
}
