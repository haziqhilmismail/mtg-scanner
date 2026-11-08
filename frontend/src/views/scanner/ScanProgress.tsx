import type { T } from '../../hooks/useLang.ts';
import type { ScannerStore } from '../../hooks/useScanner.ts';

// One step per photo finished, shown only while a run is going.
export function ScanProgress({ progress, t }: { progress: ScannerStore['scanProgress']; t: T }) {
  if (!progress) return null;
  return (
    <div className="scan-progress">
      <div
        className="scan-progress-track"
        role="progressbar"
        aria-label={t('scan_progress', progress)}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
      >
        <div className="scan-progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
      </div>
      <span className="scan-progress-label" aria-live="polite">{t('scan_progress', progress)}</span>
    </div>
  );
}
