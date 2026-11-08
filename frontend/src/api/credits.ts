import { ApiError, request } from './http.ts';

// The balance, as GET /api/credits answers and as each scan carries it.
export interface Credits {
  enforced: boolean;          // false in solo mode: nothing is limited
  unlimited: boolean;
  limit: number;              // free scans per rolling 30 days
  used: number;               // free scans used in the current window
  bonus: number;              // extra scans from vouchers; don't expire
  remaining: number | null;   // free + extra left; null when unlimited
  next_free_at: string | null; // when the oldest free scan drops out of the window
}

export async function fetchCredits(): Promise<Credits> {
  return (await request('/api/credits')).json();
}

export interface RedeemResult {
  granted: { credits: number; unlimited: boolean; unlimited_days: number | null; reset?: boolean };
  credits: Credits;
}

// Rejects with an ApiError whose code is invalid | expired | used_up |
// already_redeemed | rate_limited.
export async function redeemVoucher(code: string): Promise<RedeemResult> {
  try {
    return await (await request('/api/vouchers/redeem', { method: 'POST', json: { code } })).json();
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new ApiError(e.message, 429, { code: 'rate_limited' });
    throw e;
  }
}
