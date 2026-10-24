// The seller's payment details as the Profile form edits them: the text
// fields, and the QR as a choice that Save carries out.

import type { Payment } from '../api.ts';

export type PaymentFields = Omit<Payment, 'qr_version'>;

export const NO_PAYMENT: Payment = { bank_name: '', bank_account_number: '', bank_account_holder: '', payment_note: '', qr_version: null };

// Keep the saved QR, upload a new picture, or remove the saved one.
export type QrDraft = { kind: 'saved' } | { kind: 'new'; file: File; url: string } | { kind: 'removed' };

export interface PaymentDraft {
  fields: PaymentFields;
  qr: QrDraft;
}

export const draftOf = ({ qr_version: _, ...fields }: Payment): PaymentDraft => ({ fields, qr: { kind: 'saved' } });

export const hasDetails = (p: Payment) => Object.values(p).some(Boolean);

// The server trims what it stores, so the form compares and previews trimmed text.
const trimmed = (f: PaymentFields): PaymentFields => ({
  bank_name: f.bank_name.trim(),
  bank_account_number: f.bank_account_number.trim(),
  bank_account_holder: f.bank_account_holder.trim(),
  payment_note: f.payment_note.trim(),
});

// What Save sends to turn the saved details into the draft: the fields when
// any changed, and what to do with the QR. null when there is nothing to save.
export function changesOf(saved: Payment, draft: PaymentDraft): { fields: PaymentFields | null; qr: 'upload' | 'delete' | null } | null {
  const fields = trimmed(draft.fields);
  const edited = (Object.keys(fields) as (keyof PaymentFields)[]).some(k => fields[k] !== saved[k]);
  const qr = draft.qr.kind === 'new' ? 'upload' : draft.qr.kind === 'removed' && saved.qr_version ? 'delete' : null;
  return edited || qr ? { fields: edited ? fields : null, qr } : null;
}

// The details as buyers will get them once the draft is saved (see paymentLines).
export const previewOf = (draft: PaymentDraft): Payment => ({ ...trimmed(draft.fields), qr_version: null });
