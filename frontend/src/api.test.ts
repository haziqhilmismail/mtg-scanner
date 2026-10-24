import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordCorrection } from './api.ts';

const tick = () => new Promise(r => setTimeout(r, 0));

test('an answer is one keepalive PUT of the printing and what the seller did', async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init: init ?? {} });
    return new Response(JSON.stringify({ kept: true }), { status: 200 });
  }) as typeof fetch;

  recordCorrection({ scanId: 7, cardId: 3, scryfallId: 'abc', kind: 'pick' });
  await tick();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/scans/7/cards/3/correction');
  assert.equal(sent[0].init.method, 'PUT');
  assert.equal(sent[0].init.keepalive, true);
  assert.deepEqual(JSON.parse(sent[0].init.body as string), { scryfall_id: 'abc', kind: 'pick' });
});

test('a refused or lost answer is dropped without a trace', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw new TypeError('network down');
    return new Response(JSON.stringify({ detail: 'Scan not found' }), { status: 404 });
  }) as typeof fetch;

  const answer = { scanId: 7, cardId: 3, scryfallId: 'abc', kind: 'confirm' } as const;
  recordCorrection(answer);
  recordCorrection(answer);
  await tick();
  await tick();

  assert.equal(calls, 2);
});
