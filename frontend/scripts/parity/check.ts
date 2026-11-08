// npm run parity: runs scenario.json against the real FastAPI app (real.py)
// and against the dev fake backend (src/dev/backend.ts), then compares each
// answer's status and shape: the keys at every level and the JSON type of
// each value. A null on one side matches any type on the other.
//
// The real side needs the backend's Python with its requirements installed:
// PARITY_PYTHON (default backend/.venv/bin/python).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeBackend } from '../../src/dev/backend.ts';
import { buildFixture } from '../../src/dev/fixtures.ts';

interface Step {
  name: string;
  method: string;
  path: string;
  json?: unknown;
  form?: Record<string, string>;
  image?: boolean;
  save?: Record<string, string>;
}
interface Answer { name: string; status: number; body: unknown }

const here = new URL('.', import.meta.url).pathname;
const backend = join(here, '../../../backend');
const scenario: Step[] = JSON.parse(readFileSync(join(here, 'scenario.json'), 'utf8'));

function runReal(): Answer[] {
  const out = join(mkdtempSync(join(tmpdir(), 'parity-')), 'real.json');
  const python = process.env.PARITY_PYTHON ?? join(backend, '.venv/bin/python');
  execFileSync(python, [join(here, 'real.py'), backend, join(here, 'scenario.json'), out], { stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(readFileSync(out, 'utf8'));
}

async function runFake(): Promise<Answer[]> {
  const answer = fakeBackend(buildFixture('empty'));
  const saved: Record<string, unknown> = {};
  const fill = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = /^\{(\w+)\}$/.exec(v);
      return whole ? saved[whole[1]] : v.replace(/\{(\w+)\}/g, (_, k) => String(saved[k]));
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  const pick = (body: unknown, path: string) => path.split('.').reduce<unknown>((b, k) => (b as Record<string, unknown>)[k], body);
  const out: Answer[] = [];
  for (const step of scenario) {
    let body: BodyInit | undefined;
    const headers: Record<string, string> = {};
    if (step.json !== undefined) { body = JSON.stringify(fill(step.json)); headers['content-type'] = 'application/json'; }
    if (step.form || step.image) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(step.form ?? {})) fd.append(k, String(fill(v)));
      if (step.image) fd.append('image', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' }));
      body = fd;
    }
    const res = await answer(new Request(`http://fake${fill(step.path)}`, { method: step.method, body, headers }));
    const text = await res.text();
    const json = text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null;
    for (const [name, path] of Object.entries(step.save ?? {})) saved[name] = pick(json, path);
    out.push({ name: step.name, status: res.status, body: json });
  }
  return out;
}

function shapeDiff(real: unknown, fake: unknown, at = ''): string[] {
  if (real === null || fake === null) return [];
  const kind = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v);
  if (kind(real) !== kind(fake)) return [`${at || '.'}: real ${kind(real)} / fake ${kind(fake)}`];
  if (Array.isArray(real) && Array.isArray(fake)) {
    return real.length && fake.length ? shapeDiff(real[0], fake[0], `${at}[0]`) : [];
  }
  if (kind(real) !== 'object') return [];
  const r = real as Record<string, unknown>, f = fake as Record<string, unknown>;
  return [...new Set([...Object.keys(r), ...Object.keys(f)])].sort().flatMap(k =>
    !(k in f) ? [`${at}.${k}: only real`] : !(k in r) ? [`${at}.${k}: only fake`] : shapeDiff(r[k], f[k], `${at}.${k}`));
}

const real = runReal();
const fake = await runFake();
let drift = 0;
scenario.forEach((step, i) => {
  const lines = [
    ...(real[i].status !== fake[i].status ? [`status: real ${real[i].status} / fake ${fake[i].status}`] : []),
    ...shapeDiff(real[i].body, fake[i].body),
  ];
  drift += lines.length;
  console.log(`${lines.length ? 'DRIFT' : 'ok   '} ${step.method} ${step.path} (${step.name})`);
  for (const l of lines) console.log(`        ${l}`);
});
console.log(drift ? `\n${drift} difference(s)` : '\nThe fake backend answers every step in the real shape.');
process.exit(drift ? 1 : 0);
