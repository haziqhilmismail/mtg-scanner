// Landing-page demo of the scanner workflow. Plays back a frozen scan response
// with a staged animation so anyone (not just signed-in users) can see what
// the app does. Pure frontend — no Gemini call, no backend hit.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEMO_CARDS,
  DEMO_IMAGE_H,
  DEMO_IMAGE_URL,
  DEMO_IMAGE_W,
  type DemoCard,
} from '../../data/demoScan.ts';

type Phase = 'idle' | 'uploading' | 'thinking' | 'detecting' | 'pricing' | 'done';
type T = (key: string, vars?: Record<string, string | number>) => string;

// Per-phase millisecond budgets. Tweak these together — the whole demo runs in
// PHASE_MS.uploading + thinking + detecting + pricing, and detecting staggers
// internally so it shouldn't be much shorter than ~1.2s.
const PHASE_MS = {
  uploading: 900,
  thinking: 1000,
  detecting: 1400,
  pricing: 700,
} as const;

const BOX_REVEAL_STAGGER_MS = 220;

export function DemoScan({ t }: { t: T }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [boxesVisible, setBoxesVisible] = useState(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(() => {
    clearTimers();
    setBoxesVisible(0);
    setPhase('uploading');
    let cursor = PHASE_MS.uploading;

    timers.current.push(window.setTimeout(() => setPhase('thinking'), cursor));
    cursor += PHASE_MS.thinking;

    timers.current.push(window.setTimeout(() => setPhase('detecting'), cursor));
    // Stagger the bounding-box reveals while we sit in the detecting phase.
    DEMO_CARDS.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(
          () => setBoxesVisible(i + 1),
          cursor + i * BOX_REVEAL_STAGGER_MS,
        ),
      );
    });
    cursor += PHASE_MS.detecting;

    timers.current.push(window.setTimeout(() => setPhase('pricing'), cursor));
    cursor += PHASE_MS.pricing;

    timers.current.push(window.setTimeout(() => setPhase('done'), cursor));
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase('idle');
    setBoxesVisible(0);
  }, [clearTimers]);

  const phaseLabel = phaseToLabel(phase, t);
  const progress = phaseToProgress(phase);
  const showResults = phase === 'done';
  const total = DEMO_CARDS.reduce((s, c) => s + c.rmPrice, 0);

  return (
    <div className="demo-scan">
      <div className="demo-stage">
        <div className="demo-imgwrap" style={{ aspectRatio: `${DEMO_IMAGE_W} / ${DEMO_IMAGE_H}` }}>
          <img className="demo-img" src={DEMO_IMAGE_URL} alt="Sample cards on a table" />
          <svg
            className="demo-overlay"
            viewBox={`0 0 ${DEMO_IMAGE_W} ${DEMO_IMAGE_H}`}
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            {DEMO_CARDS.map((c, i) => (
              <BoxOutline
                key={c.id}
                card={c}
                index={i}
                visible={i < boxesVisible}
                priced={phase === 'pricing' || phase === 'done'}
              />
            ))}
          </svg>

          {phase !== 'idle' && phase !== 'done' && (
            <div className="demo-status" role="status" aria-live="polite">
              <div className="demo-status-row">
                <span className="demo-status-dot" />
                <span className="demo-status-text">{phaseLabel}</span>
              </div>
              <div className="demo-progress">
                <div className="demo-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {phase === 'idle' && (
            <button type="button" className="demo-cta" onClick={start}>
              <span className="demo-cta-icon" aria-hidden="true">▶</span>
              <span className="demo-cta-text">{t('lp_scan_cta_text')}</span>
              <span className="demo-cta-sub">{t('lp_scan_cta_sub')}</span>
            </button>
          )}
        </div>

        <div className={`demo-results ${showResults ? 'is-open' : ''}`} aria-hidden={!showResults}>
          <div className="demo-results-head">
            <span className="demo-results-pill">{t('lp_scan_results_pill', { n: DEMO_CARDS.length })}</span>
            <span className="demo-results-total">{t('lp_scan_results_total', { n: total })}</span>
          </div>
          <ul className="demo-card-list">
            {DEMO_CARDS.map((c, i) => (
              <li
                key={c.id}
                className={`demo-card-row ${c.foil ? 'is-foil' : ''}`}
                style={{ animationDelay: showResults ? `${i * 80}ms` : '0ms' }}
              >
                <span className="demo-card-num">{c.id}</span>
                <div className="demo-card-info">
                  <div className="demo-card-name">
                    {c.name}
                    {c.foil && <span className="demo-card-foil">FOIL</span>}
                  </div>
                  <div className="demo-card-meta">
                    {c.setName} · #{c.collectorNumber} · {c.rarity}
                  </div>
                </div>
                <div className="demo-card-price">
                  <div className="demo-card-rm">RM {c.rmPrice}</div>
                  <div className="demo-card-ck">
                    CK ${c.ckRetailUsd.toFixed(2)} × {c.multiplier}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="demo-actions">
        {phase === 'idle' && (
          <span className="demo-hint">{t('lp_scan_hint')}</span>
        )}
        {phase === 'done' && (
          <button type="button" className="demo-reset" onClick={reset}>
            {t('lp_scan_reset')}
          </button>
        )}
      </div>
    </div>
  );
}

function BoxOutline({
  card,
  index,
  visible,
  priced,
}: {
  card: DemoCard;
  index: number;
  visible: boolean;
  priced: boolean;
}) {
  // Perimeter for the marching-ants animation; we set it as the dash array and
  // animate dashoffset from full→0 to draw the box on.
  const perim = 2 * (card.bbox.w + card.bbox.h);
  return (
    <g className={`demo-bbox ${visible ? 'is-on' : ''} ${priced ? 'is-priced' : ''}`}>
      <rect
        x={card.bbox.x}
        y={card.bbox.y}
        width={card.bbox.w}
        height={card.bbox.h}
        rx="14"
        ry="14"
        className="demo-bbox-rect"
        strokeDasharray={perim}
        strokeDashoffset={visible ? 0 : perim}
      />
      {/* Outer <g> owns positioning; CSS transforms hit the inner <g> so they
          can't clobber the SVG translate attribute. */}
      <g transform={`translate(${card.bbox.x + 20} ${card.bbox.y + 20})`}>
        <g className="demo-bbox-badge">
          <circle r="22" cx="22" cy="22" />
          <text x="22" y="29" textAnchor="middle">{index + 1}</text>
        </g>
      </g>
      {priced && (
        <g transform={`translate(${card.bbox.x + card.bbox.w / 2} ${card.bbox.y + card.bbox.h / 2})`}>
          <g className="demo-bbox-price">
            <rect x="-72" y="-26" width="144" height="52" rx="26" ry="26" />
            <text y="10" textAnchor="middle">RM {card.rmPrice}{card.foil ? 'F' : ''}</text>
          </g>
        </g>
      )}
    </g>
  );
}

function phaseToLabel(p: Phase, t: T): string {
  switch (p) {
    case 'uploading': return t('lp_scan_status_uploading');
    case 'thinking':  return t('lp_scan_status_thinking');
    case 'detecting': return t('lp_scan_status_detecting');
    case 'pricing':   return t('lp_scan_status_pricing');
    default:          return '';
  }
}

function phaseToProgress(p: Phase): number {
  switch (p) {
    case 'uploading': return 22;
    case 'thinking':  return 48;
    case 'detecting': return 76;
    case 'pricing':   return 95;
    case 'done':      return 100;
    default:          return 0;
  }
}
