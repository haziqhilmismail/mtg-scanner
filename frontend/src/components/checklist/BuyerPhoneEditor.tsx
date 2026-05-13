import { useEffect, useState } from 'react';

import { buyersApi, type Buyer } from '../../api/checklist.ts';
import { useDialog } from '../DialogProvider.tsx';
import { BuyerNamePicker } from './BuyerNamePicker.tsx';

type T = (k: string, vars?: Record<string, string | number>) => string;

interface Props {
  buyer: Buyer | undefined;
  // Full list of buyers from the kanban — feeds the name input's autocomplete
  // (compact mode). Optional so callers that don't need suggestions can omit it.
  buyers?: Buyer[];
  // Controlled state. The parent owns the ✎ trigger (lives next to the phone
  // link on the kanban card so it's always visible) and toggles editing on/off.
  // The editor renders nothing when editing=false — the trigger is up to the
  // parent's layout.
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onChange: () => void;
  t: T;
}

/**
 * Inline buyer-edit form. Edit mode shows stacked inputs for fb_name, fb_url,
 * phone with icon-only Save/Cancel buttons. Save runs `PATCH /api/buyers/{id}`
 * with only the changed fields, so concurrent writers don't get clobbered.
 *
 * Name field is a BuyerNamePicker (compact) when callers pass `buyers` — so
 * the user can autocomplete to an existing record to fix typo'd duplicates,
 * and the URL/phone fields auto-fill from the picked buyer. Picking doesn't
 * merge — Save still updates *this* buyer with whatever is in the inputs.
 */
export function BuyerPhoneEditor({ buyer, buyers, editing, onEditingChange, onChange, t }: Props) {
  const dialog = useDialog();
  const [name, setName] = useState(buyer?.fb_name ?? '');
  const [fbUrl, setFbUrl] = useState(buyer?.fb_url ?? '');
  const [phone, setPhone] = useState(buyer?.phone ?? '');
  const [busy, setBusy] = useState(false);

  // Sync local form values when the buyer record changes externally — after a
  // save propagates, or when switching cards within the same render pass.
  useEffect(() => {
    setName(buyer?.fb_name ?? '');
    setFbUrl(buyer?.fb_url ?? '');
    setPhone(buyer?.phone ?? '');
  }, [buyer?.id, buyer?.fb_name, buyer?.fb_url, buyer?.phone]);

  if (!buyer || !editing) return null;

  const save = async () => {
    const patch: Partial<Buyer> = {};
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== buyer.fb_name) patch.fb_name = trimmedName;
    const trimmedUrl = fbUrl.trim();
    if (trimmedUrl !== (buyer.fb_url ?? '')) patch.fb_url = trimmedUrl || null;
    const trimmedPhone = phone.trim();
    if (trimmedPhone !== (buyer.phone ?? '')) patch.phone = trimmedPhone || null;

    if (Object.keys(patch).length === 0) {
      onEditingChange(false);
      return;
    }
    if (!trimmedName) {
      dialog.alert({ title: t('alert_error_title'), message: t('ck_buyer_name_required') });
      return;
    }
    setBusy(true);
    try {
      await buyersApi.update(buyer.id, patch);
      onEditingChange(false);
      onChange();
    } catch (e) {
      dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setName(buyer.fb_name);
    setFbUrl(buyer.fb_url ?? '');
    setPhone(buyer.phone ?? '');
    onEditingChange(false);
  };

  const otherBuyers = buyers ? buyers.filter(b => b.id !== buyer.id) : [];

  return (
    <div className="buyer-inline-editor editing" onPointerDown={e => e.stopPropagation()}>
      {buyers ? (
        <BuyerNamePicker
          buyers={otherBuyers}
          value={name}
          onChange={setName}
          onPick={(b) => {
            // Picking an existing buyer auto-fills URL + phone (same UX as
            // the new-order form). Empty source fields stay empty so we don't
            // clobber data the user may want to keep.
            setFbUrl(b.fb_url ?? '');
            setPhone(b.phone ?? '');
          }}
          placeholder={t('ck_buyer_fb_name')}
          compact
          t={t}
        />
      ) : (
        <input
          type="text"
          value={name}
          disabled={busy}
          placeholder={t('ck_buyer_fb_name')}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          autoFocus
        />
      )}
      <input
        type="url"
        inputMode="url"
        value={fbUrl}
        disabled={busy}
        placeholder={t('ck_buyer_fb_url')}
        onChange={e => setFbUrl(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
      />
      <input
        type="tel"
        inputMode="tel"
        value={phone}
        disabled={busy}
        placeholder={t('ck_buyer_phone_placeholder_default')}
        onChange={e => setPhone(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
      />
      <div className="buyer-inline-editor-actions">
        <button
          type="button"
          className="phone-action save"
          onClick={save}
          disabled={busy}
          title={t('ck_save')}
          aria-label={t('ck_save')}
        >✓</button>
        <button
          type="button"
          className="phone-action cancel"
          onClick={cancel}
          disabled={busy}
          title={t('ck_cancel')}
          aria-label={t('ck_cancel')}
        >✕</button>
      </div>
    </div>
  );
}
