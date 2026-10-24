import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Payment } from '../api.ts';
import { translate } from '../i18n/index.ts';
import { paymentLines } from '../utils.ts';
import { changesOf, draftOf, NO_PAYMENT, previewOf, type PaymentDraft } from './paymentDraft.ts';

const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
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
