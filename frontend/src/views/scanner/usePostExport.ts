import { useEffect, useReducer, useState } from 'react';
import { useDialog } from '../../components/DialogProvider.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import type { T } from '../../hooks/useLang.ts';
import { fileSafe } from '../../lib/photoFiles.ts';
import { downloadFiles, jobKey, KEEP, renderedFile, renderFile, type ExportJob } from './exportFiles.ts';

const canShareFiles = typeof navigator !== 'undefined'
  && !!navigator.canShare?.({ files: [new File([''], 'photo.jpg', { type: 'image/jpeg' })] });
// Chromium refuses to share more than 10 files (kMaxSharedFileCount in blink's
// navigator_share.cc), and only Chromium has userAgentData.
const SHARE_MAX = typeof navigator !== 'undefined' && 'userAgentData' in navigator ? 10 : KEEP;

// Share photos and Download all for a post. The photos to share are rendered
// ahead of time, a moment after they last changed, one at a time (the export
// allows 60 a minute), so Share opens the share sheet inside the click:
// browsers drop a share once the click is a moment old.
export function usePostExport(jobs: ExportJob[], title: string, t: T) {
  const dialog = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, rendered] = useReducer((n: number) => n + 1, 0);
  const shareable = canShareFiles && jobs.length > 0 && jobs.length <= SHARE_MAX;
  const signature = jobs.map(jobKey).join('\n');

  useEffect(() => {
    if (!shareable) return;
    let stopped = false;
    setFailed(false);
    const timer = setTimeout(async () => {
      for (const job of jobs) {
        if (stopped) return;
        const had = renderedFile(job);
        try { await renderFile(job); } catch { if (!stopped) setFailed(true); return; }
        if (!had && !stopped) rendered();
      }
    }, 1500);
    return () => { stopped = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, shareable]);

  const files = jobs.map(renderedFile);
  const done = files.filter(f => f).length;
  const ready = shareable && done === jobs.length;

  const download = async (which: ExportJob[], then?: string) => {
    if (busy || !which.length) return;
    setBusy(true);
    try {
      await downloadFiles(which, `${fileSafe(title)}.zip`);
      if (then) toast(then);
    } catch (e) {
      await dialog.alert({ title: t('alert_error_title'), message: (e as Error).message });
    } finally { setBusy(false); }
  };

  const share = async () => {
    if (!ready) {
      // Rendering failed, or this browser can't share these: they download instead.
      const tooMany = canShareFiles && jobs.length > SHARE_MAX;
      if (!shareable || failed) await download(jobs, tooMany ? t('post_share_too_many', { n: SHARE_MAX }) : t('post_share_fallback'));
      return;
    }
    const all = files as File[];
    try {
      if (!navigator.canShare({ files: all })) throw new Error('cannot share');
      await navigator.share({ files: all, title });
    } catch (e) {
      // The person closed the share sheet.
      if ((e as Error).name === 'AbortError') return;
      await download(jobs, t('post_share_fallback'));
    }
  };

  return {
    busy, share, download,
    // Rendering the photos ahead: n of total, or null when there's nothing to wait for.
    preparing: shareable && !ready && !failed ? { done, total: jobs.length } : null,
  };
}
