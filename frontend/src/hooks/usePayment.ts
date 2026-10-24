import { useCallback, useEffect, useState } from 'react';
import { paymentApi, type Payment } from '../api.ts';

// The seller's payment details, loaded once per session: Claims adds them to
// buyer messages, and Profile edits them.
export function usePayment() {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    paymentApi.get().then(setPayment, () => setFailed(true));
  }, []);
  useEffect(load, [load]);
  return { payment, failed, retry: load, setPayment };
}

export type PaymentStore = ReturnType<typeof usePayment>;
