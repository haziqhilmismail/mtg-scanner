import { Icon } from './Icon.tsx';
import { useEffect, useState } from 'react';

import type { CardRowData, Settings } from '../types.ts';
import { photoLabel } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

interface Props {
  imageB64: string;
  width: number;
  height: number;
  visibleCards: CardRowData[];
  settings: Settings;
  t: T;
}

// Mirrors the anchor math in backend/app/services/price_overlay.py so the
// preview pill lands where the export will draw it. The label-string width
// is approximated (PIL's textbbox vs SVG <text> differ a few px); for the
// "center" labelPosition the math is dimension-independent so the match is
// exact. Top/bottom can be ±5px off.
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
// drawn so the preview matches the export, and neither are cards added by
// hand: they have no spot on the photo. Each price pill sits where the
// exported PNG will draw it. "Expand" shows the photo large; ESC or the close
// button collapses it back inline.
export function BatchPreview({
  imageB64, width, height,
  visibleCards, settings,
  t,
}: Props) {
  const onPhoto = visibleCards.filter(cd => cd.card.bbox_source !== 'user');
  const [expanded, setExpanded] = useState(false);
  useBackClose(expanded, () => setExpanded(false));
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // Modal dimensions follow the image's aspect ratio so a portrait phone
  // photo gets a portrait modal and a landscape scan gets a landscape modal.
  // Capped at ~85% viewport so it doesn't feel like a fullscreen takeover;
  // we don't scale beyond the image's native size so small photos stay
  // small instead of getting blown up and blurry.
  const [modalSize, setModalSize] = useState<{ w: number; h: number } | null>(null);

  // ESC collapses the expanded view.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Lock body scroll while the preview is expanded — the cell behaves like a
  // modal, so wheeling/trackpad-scrolling inside it shouldn't drift the page
  // underneath. Restores whatever overflow value was there on close.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [expanded]);

  // Recompute modal size whenever expand toggles or the viewport changes.
  // `padding` is the cell's own padding.
  useEffect(() => {
    if (!expanded) { setModalSize(null); return; }
    const compute = () => {
      const padding = 28;   // .preview-cell.expanded { padding: 14px } × 2
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight * 0.9;
      const availForImageW = Math.max(200, maxW - padding);
      const availForImageH = Math.max(200, maxH - padding);
      const scale = Math.min(
        availForImageW / width,
        availForImageH / height,
        1,  // never upscale beyond native — keeps small photos crisp
      );
      const imgW = width * scale;
      const imgH = height * scale;
      setModalSize({
        w: Math.round(imgW + padding),
        h: Math.round(imgH + padding),
      });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [expanded, width, height]);

  // Saved scans load their photo from a URL, so it can arrive after the
  // card data. Until it does, show a placeholder of the same size and keep
  // the outlines and price pills back: frames drawn over nothing look broken.
  const photoLoaded = loadedSrc === imageB64;

  return (
    <div
      className={`preview-cell${expanded ? ' expanded' : ''}`}
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
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {onPhoto.map(cd => {
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
          {onPhoto.map(cd => {
            const label = photoLabel(cd, settings);
            if (!label) return null;
            const a = computePillAnchor(cd.card.bbox, label, width, height, settings.labelPosition, settings.labelFontScale);
            const r = a.rectH / 2;
            const baseFont = Math.max(22, Math.floor(Math.min(width, height) * 0.03 * settings.labelFontScale));
            return (
              <g key={`pill-${cd.origIdx}`} className={`preview-pill ${cd.isFoil ? 'foil' : ''}`}>
                <rect x={a.cx - a.rectW / 2} y={a.cy - r} width={a.rectW} height={a.rectH} rx={r} ry={r} />
                <text x={a.cx} y={a.cy} dominantBaseline="central" textAnchor="middle" style={{ fontSize: `${baseFont}px` }}>{label}</text>
              </g>
            );
          })}
        </svg>
        {expanded ? null : (
          <button
            type="button" className="preview-expand-btn"
            aria-label={t('preview_expand')} title={t('preview_expand')}
            onClick={() => setExpanded(true)}
          ><Icon name="expand" size={16} /></button>
        )}
      </div>
    </div>
  );
}
