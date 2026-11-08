// The card catalogue: a card by name, and every printing of one.

import type { Candidate } from '../types.ts';
import { request } from './http.ts';

export async function relookup(name: string, set?: string): Promise<Candidate> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ name, set }));
  return (await request('/api/relookup', { method: 'POST', body: fd })).json();
}

export async function fetchPrintings(name: string): Promise<{ name: string; printings: Candidate[] }> {
  const fd = new FormData();
  fd.append('payload', JSON.stringify({ name }));
  return (await request('/api/printings', { method: 'POST', body: fd })).json();
}
