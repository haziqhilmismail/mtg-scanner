import { imageUrl, request } from './http.ts';

// The seller's payment details, added to the summaries copied for buyers.
export interface Payment {
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
  payment_note: string;
  qr_version: string | null;   // changes when the QR is replaced; null = no QR
}

export const fetchPayment = async (): Promise<Payment> => (await request('/api/payment')).json();
export const savePayment = async (p: Omit<Payment, 'qr_version'>): Promise<Payment> => (await request('/api/payment', { method: 'PUT', json: p })).json();
export async function uploadPaymentQr(file: File): Promise<Payment> {
  const fd = new FormData();
  fd.append('image', file);
  return (await request('/api/payment/qr', { method: 'PUT', body: fd })).json();
}
export const deletePaymentQr = async (): Promise<Payment> => (await request('/api/payment/qr', { method: 'DELETE' })).json();
export const paymentQrUrl = (version: string) => imageUrl('/api/payment/qr', { v: version });
