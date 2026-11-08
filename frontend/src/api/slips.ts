import { request } from './http.ts';

// Drop-off slips as a PDF, ten to an A4 page. An empty name or phone is a
// line to write on; the rest of the last page is blank slips.
export async function dropoffSlipsPdf(body: { slips: Array<{ buyer: string; phone: string }> }): Promise<Blob> {
  return (await request('/api/slips', { method: 'POST', json: body })).blob();
}
