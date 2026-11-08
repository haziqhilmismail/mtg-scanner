import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Payment } from '../api/payment.ts';
import { translate, type T } from '../i18n/index.ts';
import { changesOf, draftOf, NO_PAYMENT, paymentLines, previewOf, type PaymentDraft } from './paymentDraft.ts';

const t: T = (k, v) => translate('en', k, v);
const SAVED: Payment = { bank_name: 'Maybank', bank_account_number: '0000 0000 0000', bank_account_holder: 'Your name', payment_note: '', qr_version: '17' };
const edit = (fields: Partial<Payment>, qr: PaymentDraft['qr'] = { kind: 'saved' }): PaymentDraft => ({ fields: { ...draftOf(SAVED).fields, ...fields }, qr });

test('an untouched draft, or one with only spaces added, has nothing to save', () => {
  assert.equal(changesOf(SAVED, draftOf(SAVED)), null);
  assert.equal(changesOf(SAVED, edit({ bank_name: '  Maybank ' })), null);
});

test('an edited field sends all four fields, trimmed as the server stores them', () => {
  assert.deepEqual(changesOf(SAVED, edit({ payment_note: ' Send the receipt here \n' })), {
    fields: { bank_name: 'Maybank', bank_account_number: '0000 0000 0000', bank_account_holder: 'Your name', payment_note: 'Send the receipt here' },
    qr: null,
  });
});

test('the QR changes on Save: a new picture uploads, Remove deletes only a saved QR', () => {
  const file = new File(['png'], 'qr.png', { type: 'image/png' });
  assert.deepEqual(changesOf(SAVED, edit({}, { kind: 'new', file, url: 'blob:qr' })), { fields: null, qr: 'upload' });
  assert.deepEqual(changesOf(SAVED, edit({}, { kind: 'removed' })), { fields: null, qr: 'delete' });
  assert.equal(changesOf(NO_PAYMENT, { ...draftOf(NO_PAYMENT), qr: { kind: 'removed' } }), null);
});

test('the preview is the payment lines buyers get, from the trimmed draft', () => {
  assert.deepEqual(paymentLines(previewOf(edit({ bank_name: ' CIMB ', payment_note: 'Send the receipt here' })), t), [
    'Payment: CIMB 0000 0000 0000 (Your name)',
    'Send the receipt here',
  ]);
  assert.deepEqual(paymentLines(previewOf(draftOf(NO_PAYMENT)), t), []);
});

test('payment details become the lines under a buyer message, empty parts left out', () => {
  const t = ((key: string, v?: Record<string, string>) => `${key}:${v?.account ?? ''}`) as unknown as T;
  const full = { bank_name: 'Maybank', bank_account_number: '1234', bank_account_holder: 'Nurul Huda', payment_note: 'Send your name.', qr_version: null };
  assert.deepEqual(paymentLines(full, t), ['pay_copy_account:Maybank 1234 (Nurul Huda)', 'Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: '' }, t), ['pay_copy_account:1234 (Nurul Huda)', 'Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: '', bank_account_number: '' }, t), ['pay_copy_account:(Nurul Huda)', 'Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: ' ', bank_account_number: '', bank_account_holder: '' }, t), ['Send your name.']);
  assert.deepEqual(paymentLines({ ...full, bank_name: '', bank_account_number: '', bank_account_holder: '', payment_note: '' }, t), []);
  assert.deepEqual(paymentLines(null, t), []);
});
