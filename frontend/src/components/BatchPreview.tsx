import { Icon } from './Icon.tsx';
import { useEffect, useRef, useState } from 'react';

import type { CardRowData, PillOffset, Settings } from '../types.ts';
import { pillLabel } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';

// Card aspect (width / height). The framing tool's default snap.
const CARD_ASPECT = 488 / 680;

interface Props {
  imageB64: string;
  width: number;
  height: number;
  visibleCards: CardRowData[];
  settings: Settings;
  // Commit a new offset for the card at origIdx. Pass null to clear back to default.
  onPillOffsetChange: (origIdx: number, offset: PillOffset | null) => void;
  // Submit a user-drawn frame to the backend. Returns once the card has been
  // appended to the batch (or rejects on error). When undefined, the framing
  // tool is hidden — used while the scan hasn't been saved server-side yet.
  // `skipIdentify=true` is the "just add a blank row" path; the user fills in
  // the name via the existing per-row edit controls below the preview.
  onFrameCard?: (corners: [number, number][], skipIdentify: boolean) => Promise<void>;
  t: T;
}

type FrameStage = 'idle' | 'active' | 'drawing' | 'drawn' | 'submitting';
interface FrameRect { x1: number; y1: number; x2: number; y2: number }

interface DragState {
  origIdx: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: PillOffset;  // offset at drag start (may be 0,0)
}

// Build the label that would land on the exported PNG. Returns empty when the
// card is in a "needs manual price" state — we skip rendering a pill then.
function pillLabelFor(cd: CardRowData, settings: Settings): string {
  if (cd.needsPrice || !Number.isFinite(cd.unitPrice)) return '';
  return pillLabel(cd, settings);
}

// Mirrors the anchor math in backend/app/services/price_overlay.py so the
// preview pill lands where the export will draw it. The label-string width
// is approximated (PIL's textbbox vs SVG <text> differ a few px); for the
// "center" labelPosition the math is dimension-independent so the match is
// exact. Top/bottom can be ±5px off but the user has drag to compensate.
function computePillAnchor(
  bbox: [number, number, number, number],
  label: string,
  imageW: number,
  imageH: number,
  labelPosition: 'top' | 'bottom' | 'center',
  fontScale: number,
): { cx: number; cy: number; rectW: number; rectH: number } {
  const [bx, by, bw, bh] = bbox;
  const CARD = 488 / 680;
  const cxBox = bx + bw / 2;
  const cyBox = by + bh / 2;
  const curAspect = bh > 0 ? bw / bh : CARD;
  let cardW: number, cardH: number;
  if (curAspect < CARD) {
    cardW = bw;
    cardH = cardW / CARD;
  } else {
    cardH = bh;
    cardW = cardH * CARD;
  }
  const y = cyBox - cardH / 2;
  const y2 = y + cardH;

  // Same formulas as price_overlay.py. fontScale is the user setting (1.0 default).
  const baseFont = Math.max(22, Math.floor(Math.min(imageW, imageH) * 0.03 * fontScale));
  const padX = Math.max(12, Math.floor(baseFont / 2));
  const padY = Math.max(8, Math.floor(baseFont / 3));
  // DejaVu Sans Bold runs ~0.6em per char; approximation for rect width
  const tw = Math.max(2, label.length) * Math.floor(baseFont * 0.6);
  const rectW = tw + padX * 2;
  const rectH = baseFont + padY * 2;

  let rectY: number;
  if (labelPosition === 'top') rectY = y - rectH / 3;
  else if (labelPosition === 'center') rectY = y + cardH / 2 - rectH / 2;
  else rectY = y2 - (rectH * 2) / 3;

  return { cx: cxBox, cy: rectY + rectH / 2, rectW, rectH };
}

// Solid polygon outline (follows the classical-detector quad when present;
// axis-aligned rectangle for Gemini-only detections). Removed cards aren't
// drawn so the preview matches the export. Each card carries a draggable
// price pill positioned exactly where the exported PNG will draw it; the
// user can pull it onto the card when bbox detection drifted. The "Expand"
// button promotes the cell to a fullscreen overlay so dragging is more
// precise; ESC or the close button collapses it back inline.
export function BatchPreview({
  imageB64, width, height,
  visibleCards, settings,
  onPillOffsetChange,
  onFrameCard,
  t,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  // Per-card live offset while a drag is in flight. We don't push every
  // pointermove through onPillOffsetChange — that would write localStorage
  // on every frame. We render from `liveOffset` during drag, then commit on
  // pointer-up.
  const [liveOffset, setLiveOffset] = useState<Record<number, PillOffset>>({});
  const [expanded, setExpanded] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // Framing tool — lets the user draw a rectangle on the photo to identify a
  // card the detector merged with its neighbour (or missed entirely). Only
  // available in expanded mode where the user has the space to draw cleanly.
  const [frameStage, setFrameStage] = useState<FrameStage>('idle');
  const [frameRect, setFrameRect] = useState<FrameRect | null>(null);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [frameError, setFrameError] = useState<string | null>(null);
  // Modal dimensions follow the image's aspect ratio so a portrait phone
  // photo gets a portrait modal and a landscape scan gets a landscape modal.
  // Capped at ~85% viewport so it doesn't feel like a fullscreen takeover;
  // we don't scale beyond the image's native size so small photos stay
  // small instead of getting blown up and blurry.
  const [modalSize, setModalSize] = useState<{ w: number; h: number } | null>(null);

  // ESC: cancel framing first if it's active, otherwise collapse the modal.
  // The two-step fall-through stops a mid-draw ESC from yanking the user out
  // of the expanded view — they almost always meant "drop this frame".
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (frameStage === 'submitting') return;  // mid-request — don't interrupt
      if (frameStage !== 'idle') {
        setFrameStage('idle');
        setFrameRect(null);
        setFrameError(null);
        return;
      }
      setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, frameStage]);

  // Lock body scroll while the preview is expanded — the cell behaves like a
  // modal, so wheeling/trackpad-scrolling inside it shouldn't drift the page
  // underneath. Restores whatever overflow value was there on close.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  // Recompute modal size whenever expand toggles or the viewport changes.
  // `chrome` reserves vertical space for the tip + price-info banner that
  // live below the image inside the cell; `padding` is the cell's own padding.
  useEffect(() => {
    if (!expanded) { setModalSize(null); return; }
    const compute = () => {
      const padding = 28;   // .preview-cell.expanded { padding: 14px } × 2
      const chrome = 36;    // .preview-tip line + gap below the image
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight * 0.9;
      const availForImageW = Math.max(200, maxW - padding);
      const availForImageH = Math.max(200, maxH - chrome - padding);
      const scale = Math.min(
        availForImageW / width,
        availForImageH / height,
        1,  // never upscale beyond native — keeps small photos crisp
      );
      const imgW = width * scale;
      const imgH = height * scale;
      setModalSize({
        w: Math.round(imgW + padding),
        h: Math.round(imgH + chrome + padding),
      });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [expanded, width, height]);

  // Convert a CSS-pixel delta to image-viewBox pixels. The SVG itself can be
  // larger than the rendered image content when `preserveAspectRatio="meet"`
  // letterboxes one axis (typical in expanded mode where the wrap is wider
  // than the image). The actual visual scale is set by the *limiting* axis,
  // so we take the larger of the two image-per-css ratios — that's the one
  // the user feels when they drag. Using only `width/rect.width` made the
  // pill move slower than the cursor on wide containers.
  const cssToViewBox = (dxCss: number, dyCss: number): { dx: number; dy: number } => {
    const el = svgRef.current;
    if (!el) return { dx: 0, dy: 0 };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { dx: 0, dy: 0 };
    const scale = Math.max(width / rect.width, height / rect.height);
    return { dx: dxCss * scale, dy: dyCss * scale };
  };

  const onPillPointerDown = (e: React.PointerEvent<SVGGElement>, cd: CardRowData) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    setDragState({
      origIdx: cd.origIdx,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffset: cd.pillOffset ?? { dx: 0, dy: 0 },
    });
  };

  const onPillPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const delta = cssToViewBox(
      e.clientX - dragState.startClientX,
      e.clientY - dragState.startClientY,
    );
    setLiveOffset(prev => ({
      ...prev,
      [dragState.origIdx]: {
        dx: Math.round(dragState.startOffset.dx + delta.dx),
        dy: Math.round(dragState.startOffset.dy + delta.dy),
      },
    }));
  };

  const finishDrag = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId);
    const finalOffset = liveOffset[dragState.origIdx] ?? dragState.startOffset;
    // Commit. Treat (0, 0) as "no override" so the persisted state stays clean.
    const next = (finalOffset.dx === 0 && finalOffset.dy === 0) ? null : finalOffset;
    onPillOffsetChange(dragState.origIdx, next);
    setDragState(null);
    setLiveOffset(prev => {
      const { [dragState.origIdx]: _, ...rest } = prev;
      return rest;
    });
  };

  // --- Framing tool ---

  // Translate client coords to viewBox (source-image) pixels. The SVG uses
  // preserveAspectRatio="xMidYMid meet" so the rendered image is centered
  // and one axis can be letterboxed; we back out the actual image rect first.
  const clientToViewBox = (clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const containerAspect = rect.width / rect.height;
    const imageAspect = width / height;
    let renderedW: number, renderedH: number, offX: number, offY: number;
    if (containerAspect > imageAspect) {
      renderedH = rect.height;
      renderedW = renderedH * imageAspect;
      offX = (rect.width - renderedW) / 2;
      offY = 0;
    } else {
      renderedW = rect.width;
      renderedH = renderedW / imageAspect;
      offX = 0;
      offY = (rect.height - renderedH) / 2;
    }
    const x = (clientX - rect.left - offX) * (width / renderedW);
    const y = (clientY - rect.top - offY) * (height / renderedH);
    return {
      x: Math.max(0, Math.min(width, x)),
      y: Math.max(0, Math.min(height, y)),
    };
  };

  // Apply card-aspect lock to a dragged rectangle. Anchored at (x1,y1); the
  // second corner snaps so the rect matches CARD_ASPECT while still covering
  // whichever dimension the user dragged further. Shift override unlocks.
  const applyAspectLock = (r: FrameRect, locked: boolean): FrameRect => {
    if (!locked) return r;
    const dx = r.x2 - r.x1;
    const dy = r.y2 - r.y1;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    const absW = Math.abs(dx);
    const absH = Math.abs(dy);
    // Grow whichever dimension is "smaller" in card units so the rect covers
    // what the user pointed to instead of shrinking inside the gesture.
    if (absW / CARD_ASPECT >= absH) {
      return { ...r, y2: r.y1 + sy * (absW / CARD_ASPECT) };
    }
    return { ...r, x2: r.x1 + sx * (absH * CARD_ASPECT) };
  };

  const onFrameCapturePointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (frameStage !== 'active') return;
    e.preventDefault();
    (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
    const { x, y } = clientToViewBox(e.clientX, e.clientY);
    setFrameStage('drawing');
    setFrameRect({ x1: x, y1: y, x2: x, y2: y });
    setFrameError(null);
  };

  const onFrameCapturePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (frameStage !== 'drawing' || !frameRect) return;
    const { x, y } = clientToViewBox(e.clientX, e.clientY);
    const next = applyAspectLock(
      { x1: frameRect.x1, y1: frameRect.y1, x2: x, y2: y },
      aspectLocked && !e.shiftKey,
    );
    setFrameRect(next);
  };

  const onFrameCapturePointerUp = (e: React.PointerEvent<SVGRectElement>) => {
    if (frameStage !== 'drawing' || !frameRect) return;
    (e.currentTarget as SVGRectElement).releasePointerCapture(e.pointerId);
    const w = Math.abs(frameRect.x2 - frameRect.x1);
    const h = Math.abs(frameRect.y2 - frameRect.y1);
    // Anything smaller than ~1% of the image is almost certainly an accidental
    // click — bounce back to active so the user can try again.
    if (w < width * 0.02 || h < height * 0.02) {
      setFrameStage('active');
      setFrameRect(null);
      return;
    }
    setFrameStage('drawn');
  };

  const cancelFrame = () => {
    if (frameStage === 'submitting') return;
    setFrameStage('idle');
    setFrameRect(null);
    setFrameError(null);
  };

  const submitFrame = async (skipIdentify: boolean) => {
    if (!onFrameCard || !frameRect || frameStage !== 'drawn') return;
    const x = Math.min(frameRect.x1, frameRect.x2);
    const y = Math.min(frameRect.y1, frameRect.y2);
    const x2 = Math.max(frameRect.x1, frameRect.x2);
    const y2 = Math.max(frameRect.y1, frameRect.y2);
    // Axis-aligned quad in TL, TR, BR, BL order — matches what the backend
    // expects and what classical_detector.perspective_warp consumes.
    const corners: [number, number][] = [
      [x, y], [x2, y], [x2, y2], [x, y2],
    ];
    setFrameStage('submitting');
    setFrameError(null);
    try {
      await onFrameCard(corners, skipIdentify);
      setFrameStage('idle');
      setFrameRect(null);
    } catch (err) {
      setFrameError((err as Error).message || t('frame_error_generic'));
      setFrameStage('drawn');
    }
  };

  // Auto-exit framing mode when the user collapses the modal.
  useEffect(() => {
    if (!expanded && frameStage !== 'idle') {
      setFrameStage('idle');
      setFrameRect(null);
      setFrameError(null);
    }
  }, [expanded, frameStage]);

  // Derived rect for rendering (normalised positive). null when nothing drawn yet.
  const drawnRect = frameRect && (frameStage === 'drawing' || frameStage === 'drawn' || frameStage === 'submitting')
    ? {
      x: Math.min(frameRect.x1, frameRect.x2),
      y: Math.min(frameRect.y1, frameRect.y2),
      w: Math.abs(frameRect.x2 - frameRect.x1),
      h: Math.abs(frameRect.y2 - frameRect.y1),
    }
    : null;

  // Saved scans load their photo from a URL, so it can arrive after the
  // card data. Until it does, show a placeholder of the same size and keep
  // the outlines and price pills back: frames drawn over nothing look broken.
  const photoLoaded = loadedSrc === imageB64;

  const framingEnabled = expanded && !!onFrameCard;
  const framingActive = frameStage !== 'idle';

  return (
    <div
      className={`preview-cell${expanded ? ' expanded' : ''}${framingActive ? ' framing' : ''}`}
      style={expanded && modalSize
        ? { width: modalSize.w, height: modalSize.h }
        : undefined}
    >
      {expanded ? (
        <button
          type="button"
          className="preview-close-btn"
          onClick={() => setExpanded(false)}
          aria-label={t('preview_collapse')}
          title={t('preview_collapse')}
        ><Icon name="close" size={18} /></button>
      ) : null}
      <div
        className={`preview-wrap ${photoLoaded ? '' : 'is-loading'}`}
        style={photoLoaded || expanded ? undefined : {
          // Hold the exact box the photo will fill (fit inside 100% × 65vh,
          // never upscaled past the 1400px preview) so nothing jumps when it
          // arrives.
          width: `min(100%, calc(65vh * ${width / height}), 1400px)`,
          aspectRatio: `${width} / ${height}`,
        }}
      >
        <img
          src={imageB64}
          alt=""
          onLoad={() => setLoadedSrc(imageB64)}
          onError={() => setLoadedSrc(imageB64)}
        />
        {framingEnabled ? (
          <div className="frame-toolbar">
            {!framingActive ? (
              <button
                type="button"
                className="frame-toolbar-btn"
                onClick={() => { setFrameStage('active'); setFrameRect(null); setFrameError(null); }}
                title={t('frame_btn_title')}
              >＋ {t('frame_btn_label')}</button>
            ) : (
              <>
                <span className="frame-toolbar-hint">
                  {frameStage === 'active' ? t('frame_hint_draw')
                    : frameStage === 'drawing' ? t('frame_hint_drawing')
                    : frameStage === 'submitting' ? t('frame_hint_submitting')
                    : t('frame_hint_drawn')}
                </span>
                {frameError ? (
                  <span className="frame-action-error">{frameError}</span>
                ) : null}
                {frameStage === 'drawn' || frameStage === 'submitting' ? (
                  <>
                    <button
                      type="button"
                      className="frame-action-confirm"
                      onClick={() => submitFrame(false)}
                      disabled={frameStage === 'submitting'}
                      title={t('frame_confirm_title')}
                    >{frameStage === 'submitting' ? t('frame_submitting') : `✓ ${t('frame_confirm')}`}</button>
                    <button
                      type="button"
                      className="frame-action-manual"
                      onClick={() => submitFrame(true)}
                      disabled={frameStage === 'submitting'}
                      title={t('frame_manual_title')}
                    >{t('frame_manual')}</button>
                  </>
                ) : null}
                <label className="frame-toolbar-aspect">
                  <input
                    type="checkbox"
                    checked={aspectLocked}
                    onChange={(e) => setAspectLocked(e.target.checked)}
                    disabled={frameStage === 'submitting'}
                  />
                  <span>{t('frame_aspect_lock')}</span>
                </label>
                <button
                  type="button"
                  className="frame-toolbar-btn ghost"
                  onClick={cancelFrame}
                  disabled={frameStage === 'submitting'}
                >{t('frame_cancel')}</button>
              </>
            )}
          </div>
        ) : null}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {framingActive ? (
            <rect
              className="frame-capture"
              x={0} y={0} width={width} height={height}
              onPointerDown={onFrameCapturePointerDown}
              onPointerMove={onFrameCapturePointerMove}
              onPointerUp={onFrameCapturePointerUp}
              onPointerCancel={onFrameCapturePointerUp}
            />
          ) : null}
          {drawnRect ? (
            <rect
              className={`frame-drawn${frameStage === 'submitting' ? ' is-submitting' : ''}`}
              x={drawnRect.x} y={drawnRect.y}
              width={drawnRect.w} height={drawnRect.h}
            />
          ) : null}
          {visibleCards.map(cd => {
            const [x, y, w, h] = cd.card.bbox;
            const corners = cd.card.corners;
            const hasQuad = Array.isArray(corners) && corners.length === 4;
            const polyPoints = hasQuad
              ? corners.map(([px, py]) => `${px},${py}`).join(' ')
              : `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`;
            return (
              <polygon
                key={`out-${cd.origIdx}`}
                points={polyPoints}
                className={`card-outline ${cd.isFoil ? 'foil' : ''}`}
              />
            );
          })}
          {visibleCards.map(cd => {
            const label = pillLabelFor(cd, settings);
            if (!label) return null;
            const anchor = computePillAnchor(
              cd.card.bbox, label, width, height, settings.labelPosition, settings.labelFontScale,
            );
            const offset = liveOffset[cd.origIdx] ?? cd.pillOffset ?? { dx: 0, dy: 0 };
            const cx = anchor.cx + offset.dx;
            const cy = anchor.cy + offset.dy;
            const px = cx - anchor.rectW / 2;
            const py = cy - anchor.rectH / 2;
            const r = anchor.rectH / 2;
            const isDragging = dragState?.origIdx === cd.origIdx;
            const baseFont = Math.max(22, Math.floor(Math.min(width, height) * 0.03 * settings.labelFontScale));
            const isOffset = offset.dx !== 0 || offset.dy !== 0;
            return (
              <g key={`pill-${cd.origIdx}`}>
                <g
                  className={`preview-pill ${cd.isFoil ? 'foil' : ''} ${isDragging ? 'is-dragging' : ''}`}
                  onPointerDown={(e) => onPillPointerDown(e, cd)}
                  onPointerMove={onPillPointerMove}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                >
                  {/* SVG <title> gives a native hover tooltip in browsers and
                      a screen-reader label, signalling that the pill is interactive. */}
                  <title>{t('preview_drag_pill_title')}</title>
                  <rect
                    x={px} y={py}
                    width={anchor.rectW} height={anchor.rectH}
                    rx={r} ry={r}
                  />
                  <text
                    x={cx} y={cy}
                    dominantBaseline="central"
                    textAnchor="middle"
                    style={{ fontSize: `${baseFont}px` }}
                  >{label}</text>
                </g>
                {isOffset && !isDragging ? (
                  <g
                    className="preview-pill-reset"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onPillOffsetChange(cd.origIdx, null);
                    }}
                  >
                    <title>{t('preview_pill_reset_title')}</title>
                    <circle
                      cx={px + anchor.rectW + r * 0.6}
                      cy={py}
                      r={r * 0.55}
                    />
                    <text
                      x={px + anchor.rectW + r * 0.6}
                      y={py}
                      dominantBaseline="central"
                      textAnchor="middle"
                      style={{ fontSize: `${baseFont * 0.7}px` }}
                    >↺</text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {!expanded ? (
        <div className="preview-expand-row">
          <button
            type="button"
            className="preview-expand-btn"
            onClick={() => setExpanded(true)}
          >
            {t('preview_expand')}
          </button>
          {onFrameCard ? (
            <span className="preview-expand-hint">{t('preview_frame_hint')}</span>
          ) : null}
        </div>
      ) : null}
      <p className="preview-tip">{t('preview_drag_tip')}</p>
      {!expanded ? (
        <div className="preview-info-banner">
          <span aria-hidden="true">⏱</span> {t('preview_price_info')}
        </div>
      ) : null}
    </div>
  );
}
