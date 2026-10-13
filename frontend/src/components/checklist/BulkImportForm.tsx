import { useState } from 'react';
import { listingsApi, type BulkImportLineResult } from '../../api/checklist.ts';

interface Props {
  onDone: () => void;
  onCancel: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

const PLACEHOLDER = `1 Lightning Bolt (LEA) 161
4 Counterspell (TMP) 86
2 Mox Sapphire
1 Black Lotus (LEA) 232 *F*`;

// Moxfield-style bulk import: paste a deck-style list, Scryfall does the
// resolution, server creates loose Listing rows (no post link). Posts pick
// from existing stock via the "Add cards from stock" dialog instead.
// Foil is per-line via the *F* marker — no global toggle.
export function BulkImportForm({ onDone, onCancel, t }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; lines: BulkImportLineResult[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) { setErr(t('ck_bulk_err_empty')); return; }
    setErr(null);
    setBusy(true);
    setResult(null);
    try {
      const r = await listingsApi.bulkImport(text, null);
      setResult(r);
      // Keep failed lines so the user can edit + retry
      const failed = r.lines.filter(l => !l.ok);
      setText(failed.map(l => l.raw).join('\n'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-card">
      <h3>{t('ck_bulk_title')}</h3>
      <p style={{ fontSize: 13,
        color: 'var(--ink-soft)', marginTop: -6, marginBottom: 10,
        lineHeight: 1.45,
      }}>{t('ck_bulk_hint')}</p>

      <textarea
        rows={10}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        style={{
          width: '100%',
          fontSize: 13,
          minHeight: 220,
        }}
      />

      {err ? <div className="form-error" style={{ marginTop: 10 }}>{err}</div> : null}

      {result ? (
        <div style={{ marginTop: 14 }}>
          <div style={{
            padding: '8px 12px', borderRadius: 'var(--radius)',
            background: result.created > 0 ? 'rgba(99,142,80,0.12)' : 'var(--surface-2)', fontSize: 13,
            color: result.created > 0 ? 'var(--green)' : 'var(--ink)',
            marginBottom: 8,
          }}>
            {t('ck_bulk_result', { created: result.created, skipped: result.skipped })}
          </div>
          {result.lines.filter(l => !l.ok).length > 0 && (
            <details open>
              <summary style={{
                cursor: 'pointer', fontSize: 13,
                color: 'var(--warn)', padding: '4px 0',
              }}>{t('ck_bulk_failed_summary', { n: result.lines.filter(l => !l.ok).length })}</summary>
              <ul style={{
                margin: '6px 0 0', padding: '0 0 0 18px', fontSize: 13,
                color: 'var(--ink-soft)',
              }}>
                {result.lines.filter(l => !l.ok).map((l, i) => (
                  <li key={i}><code>{l.raw}</code> — <span style={{ color: 'var(--warn)' }}>{l.error}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : null}

      <div className="form-actions">
        <button className="accent" disabled={busy} onClick={submit}>
          {busy ? t('ck_bulk_importing') : t('ck_bulk_import_btn')}
        </button>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => {
            setResult(null);
            setText('');
            if (result && result.created > 0) onDone();
            else onCancel();
          }}
        >
          {result && result.created > 0 ? t('ck_bulk_done') : t('ck_cancel')}
        </button>
      </div>
    </div>
  );
}
