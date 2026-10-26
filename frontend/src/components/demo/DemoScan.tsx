// The sign-in page's scanner demo: a real scan of the sample photo, played
// back in steps with no call to the server.

import { useEffect, useRef, useState } from 'react';
import { DEMO_CARDS, DEMO_CROP, DEMO_IMAGE_URL, type DemoCard } from '../../data/demoScan.ts';
import { useT } from '../../hooks/useLang.ts';
import { Icon } from '../Icon.tsx';

// When each step starts after play, its status line, the progress bar, and
// what the photo shows: the outlines, then the price labels (the top row
// while pricing, every card when all are priced).
const STEPS = [
  { at: 0, status: 'lp_scan_reading', progress: 0.18, outlines: false, pills: 'none' },
  { at: 700, status: 'lp_scan_found', progress: 0.4, outlines: true, pills: 'none' },
  { at: 1300, status: 'lp_scan_matching', progress: 0.62, outlines: true, pills: 'none' },
  { at: 1900, status: 'lp_scan_pricing', progress: 0.82, outlines: true, pills: 'top' },
  { at: 2500, status: 'lp_scan_priced', progress: 1, outlines: true, pills: 'all' },
] as const;
const DONE_AT = 3100;
const IDLE = -1;
const DONE = STEPS.length;
const NOTHING = { outlines: false, pills: 'none' } as const;
const at = (x: number, from: number, size: number) => `${((x - from) / size) * 100}%`;

// onNext: the button after a run that moves on to the Claims demo.
export function DemoScan({ onNext }: { onNext: () => void }) {
  const t = useT();
  const [step, setStep] = useState(IDLE);
  const timers = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => stop, []);

  const play = () => {
    stop();
    root.current?.focus();
    setStep(0);
    timers.current = [
      ...STEPS.slice(1).map((s, i) => window.setTimeout(() => setStep(i + 1), s.at)),
      window.setTimeout(() => setStep(DONE), DONE_AT),
    ];
  };
  const again = () => { stop(); root.current?.focus(); setStep(IDLE); };

  const n = DEMO_CARDS.length;
  const running = step > IDLE && step < DONE;
  const shown = step === IDLE ? NOTHING : STEPS[Math.min(step, DONE - 1)];
  const priced = (c: DemoCard) => shown.pills === 'all' || (shown.pills === 'top' && c.bbox.y < DEMO_CROP.h / 2);
  const total = DEMO_CARDS.reduce((sum, c) => sum + c.rmPrice, 0);

  return (
    // The pressed button goes away, so focus stays on the demo, not the page.
    <div className="demo" ref={root} tabIndex={-1}>
      <div className="demo-photo" style={{ aspectRatio: `${DEMO_CROP.w} / ${DEMO_CROP.h}` }}>
        <img src={DEMO_IMAGE_URL} alt={t('lp_scan_alt')} />
        <svg viewBox={`${DEMO_CROP.x} 0 ${DEMO_CROP.w} ${DEMO_CROP.h}`} aria-hidden="true">
          {DEMO_CARDS.map(({ id, bbox }) => {
            const edge = 2 * (bbox.w + bbox.h);
            return (
              <rect
                key={id} className="demo-outline" data-on={shown.outlines || undefined}
                x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} rx="18"
                style={{ strokeDasharray: edge, strokeDashoffset: shown.outlines ? 0 : edge }}
              />
            );
          })}
        </svg>
        {DEMO_CARDS.map(c => (
          <span
            key={c.id} className="demo-pill" aria-hidden="true" data-on={priced(c) || undefined}
            style={{ left: at(c.bbox.x + c.bbox.w / 2, DEMO_CROP.x, DEMO_CROP.w), top: at(c.bbox.y + c.bbox.h / 2, 0, DEMO_CROP.h) }}
          >RM{c.rmPrice}</span>
        ))}
        {step === IDLE ? (
          <button type="button" className="demo-play" onClick={play}>
            <span className="demo-play-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4a1 1 0 0 0 1.52.85l11.5-7.2a1 1 0 0 0 0-1.7L8.52 3.95A1 1 0 0 0 7 4.8Z" /></svg>
            </span>
            <span className="demo-play-title">{t('lp_scan_cta_text')}</span>
            <span className="demo-play-sub">{t('lp_scan_cta_sub')}</span>
          </button>
        ) : null}
        {/* Always there and empty when idle, so a screen reader hears every step. */}
        <div className="demo-status" role="status">
          {running ? (
            <>
              <span className="demo-status-text"><span className="demo-dot" aria-hidden="true" />{t(STEPS[step].status, { n })}</span>
              <span className="demo-progress" aria-hidden="true"><span style={{ transform: `scaleX(${STEPS[step].progress})` }} /></span>
            </>
          ) : null}
        </div>
      </div>

      {step === DONE ? (
        <>
          <div className="demo-results">
            <div className="demo-results-head">
              <span>{t('lp_scan_cards', { n })}</span>
              <strong>{t('lp_scan_total', { n: total })}</strong>
            </div>
            <ul className="demo-cards">
              {DEMO_CARDS.map(c => (
                <li key={c.id} className="demo-card">
                  <span className="demo-card-num">{c.id}</span>
                  <span className="demo-card-main">
                    <span className="demo-card-name">{c.name}</span>
                    <span className="version-line">
                      <span className="set-badge"><span className={`rarity ${c.rarity}`} />{c.setCode}<span className="cn">#{c.collectorNumber}</span></span>
                      <span className="set-name">{c.setName}</span>
                    </span>
                    <span className="demo-card-formula">USD {c.ckRetailUsd.toFixed(2)} × {c.multiplier}</span>
                  </span>
                  <span className="demo-card-price">RM{c.rmPrice}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="demo-next">
            <button type="button" className="ui-btn" onClick={again}>
              <Icon name="refresh" size={16} />{t('lp_scan_again')}
            </button>
            <button type="button" className="ui-btn" onClick={onNext}>
              {t('lp_scan_next')}<Icon name="chevronRight" size={16} />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
