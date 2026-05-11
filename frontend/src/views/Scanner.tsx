import { useCallback, useEffect, useState } from 'react';
import { postsApi, type Post } from '../api/checklist.ts';
import type { ScannerStore } from '../hooks/useScanner.ts';
import type { Candidate, Settings } from '../types.ts';
import { ActiveBatchView } from '../components/ActiveBatchView.tsx';
import { BatchTabStrip } from '../components/BatchTabStrip.tsx';
import { useDialog } from '../components/DialogProvider.tsx';
import { PrintingsModal } from '../components/PrintingsModal.tsx';
import { SettingsPanel } from '../components/SettingsPanel.tsx';
import { UploadZone } from '../components/UploadZone.tsx';
import { ZoomModal } from '../components/ZoomModal.tsx';
import type { Health } from '../api.ts';

interface Props {
  scanner: ScannerStore;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  health: Health | null;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

export function Scanner({ scanner, settings, updateSetting, health, t }: Props) {
  const dialog = useDialog();
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);
  const [printingsCtx, setPrintingsCtx] = useState<{ batchId: string; idx: number } | null>(null);

  // Post grouping state — which post each batch's cards get attached to when
  // added to the checklist. Map keyed by batch id so the choice survives
  // switching tabs between batches.
  const [posts, setPosts] = useState<Post[]>([]);
  const [postIdByBatch, setPostIdByBatch] = useState<Record<string, number | null>>({});

  const refreshPosts = useCallback(async () => {
    try { setPosts(await postsApi.list()); }
    catch { /* offline or auth error — ignore, picker just stays empty */ }
  }, []);

  useEffect(() => { refreshPosts(); }, [refreshPosts]);

  const activeBatch = scanner.batches.find(b => b.id === scanner.activeBatchId) ?? null;

  const onBrowsePrintings = (idx: number) => {
    if (!activeBatch) return;
    setPrintingsCtx({ batchId: activeBatch.id, idx });
  };

  const onPickPrinting = (printing: Candidate) => {
    if (!printingsCtx) return;
    scanner.replaceCandidate(printingsCtx.batchId, printingsCtx.idx, {
      ...printing,
      _lookup_failed: false,
      _manual: false,
    });
    scanner.setRelookupMsg(printingsCtx.batchId, printingsCtx.idx, {
      type: 'ok',
      text: t('modal_switched', { name: printing.set_name || printing.set || '' }),
    });
    setPrintingsCtx(null);
  };

  const printingsCardName = (() => {
    if (!printingsCtx) return '';
    const b = scanner.batches.find(b => b.id === printingsCtx.batchId);
    return b?.response?.cards[printingsCtx.idx]?.candidates[0]?.name || '';
  })();

  const printingsCurrentSid = (() => {
    if (!printingsCtx) return '';
    const b = scanner.batches.find(b => b.id === printingsCtx.batchId);
    return b?.response?.cards[printingsCtx.idx]?.candidates[0]?.scryfall_id || '';
  })();

  const counterText = (() => {
    if (!scanner.activeBatchId) return '';
    const idx = scanner.batches.findIndex(b => b.id === scanner.activeBatchId);
    if (idx < 0) return '';
    return t('batch_counter', { cur: idx + 1, total: scanner.batches.length });
  })();

  return (
    <>
      <SettingsPanel settings={settings} update={updateSetting} t={t} health={health} />
      <UploadZone onFiles={scanner.addFiles} t={t} />

      {scanner.batches.length > 0 && (
        <section>
          <div className="review-head">
            <h2><span className="step-num">3</span><span> {t('review_title')}</span></h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="meta">{counterText}</span>
              {scanner.batches.length > 1 && (
                <button
                  className="ghost"
                  style={{ padding: '6px 12px', fontSize: 10 }}
                  onClick={async () => {
                    const ok = await dialog.confirm({
                      title: t('confirm_clear_all_title'),
                      message: t('confirm_clear_all_msg', { n: scanner.batches.length }),
                      okLabel: t('confirm_clear_all_ok'),
                      destructive: true,
                    });
                    if (ok) scanner.clearAll();
                  }}
                >× Clear all</button>
              )}
            </span>
          </div>
          <BatchTabStrip
            batches={scanner.batches}
            activeId={scanner.activeBatchId}
            onSelect={scanner.setActiveBatchId}
            onRemove={scanner.removeBatch}
            t={t}
          />
          {activeBatch ? (
            <ActiveBatchView
              batch={activeBatch}
              settings={settings}
              scanner={scanner}
              t={t}
              onZoom={(src, caption) => setZoom({ src, caption })}
              onBrowsePrintings={onBrowsePrintings}
              posts={posts}
              selectedPostId={postIdByBatch[activeBatch.id] ?? null}
              onSelectPost={(pid) => setPostIdByBatch(prev => ({ ...prev, [activeBatch.id]: pid }))}
              onPostsChanged={refreshPosts}
            />
          ) : null}
        </section>
      )}

      <PrintingsModal
        open={!!printingsCtx}
        cardName={printingsCardName}
        currentSid={printingsCurrentSid}
        onClose={() => setPrintingsCtx(null)}
        onSelect={onPickPrinting}
        t={t}
      />
      <ZoomModal
        src={zoom?.src ?? null}
        caption={zoom?.caption || ''}
        onClose={() => setZoom(null)}
      />
    </>
  );
}
