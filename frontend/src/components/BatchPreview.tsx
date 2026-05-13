import { useEffect, useRef, useState } from 'react';

import type { CardRowData, PillOffset, Settings } from '../types.ts';
import { formatMyrWithFoil } from '../utils.ts';

interface Props {
  imageB64: string;
  width: number;
  height: number;
  visibleCards: CardRowData[];
  settings: Settings;
  // Commit a new offset for the card at origIdx. Pass null to clear back to default.
  onPillOffsetChange: (origIdx: number, offset: PillOffset | null) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

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
  const unit = formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings);
  return cd.qty > 1 ? `${unit} ×${cd.qty}` : unit;
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
  const x = cxBox - cardW / 2;
  const y = cyBox - cardH / 2;
  const y2 = y + cardH;

  // Same formulas as price_overlay.py
  const baseFont = Math.max(22, Math.floor(Math.min(imageW, imageH) * 0.03));
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

  // ESC closes the expanded view
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

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

  return (
    <div className={`preview-cell${expanded ? ' expanded' : ''}`}>
      {expanded ? (
        <button
          type="button"
          className="preview-close-btn"
          onClick={() => setExpanded(false)}
          aria-label={t('preview_collapse')}
          title={t('preview_collapse')}
        >✕</button>
      ) : null}
      <div className="preview-wrap">
        <img src={imageB64} alt="" />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
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
              cd.card.bbox, label, width, height, settings.labelPosition,
            );
            const offset = liveOffset[cd.origIdx] ?? cd.pillOffset ?? { dx: 0, dy: 0 };
            const cx = anchor.cx + offset.dx;
            const cy = anchor.cy + offset.dy;
            const px = cx - anchor.rectW / 2;
            const py = cy - anchor.rectH / 2;
            const r = anchor.rectH / 2;
            const isDragging = dragState?.origIdx === cd.origIdx;
            const baseFont = Math.max(22, Math.floor(Math.min(width, height) * 0.03));
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
        </div>
      ) : null}
      <p className="preview-tip">{t('preview_drag_tip')}</p>
      <div className="preview-info-banner">
        <span aria-hidden="true">⏱</span> {t('preview_price_info')}
      </div>
    </div>
  );
}
