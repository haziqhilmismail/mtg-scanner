import { useState } from 'react';
import type { CardRowData, Settings } from '../types.ts';
import { goldPill, photoLabel } from '../utils.ts';

interface Props {
  src: string;
  width: number;
  height: number;
  // The kept cards. One added by hand has no spot on the photo, so it gets no outline.
  cards: CardRowData[];
  settings: Settings;
  // What the picture shows, for a screen reader.
  label: string;
  className?: string;
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

// The photo with each card's outline and the price label the download will
// carry, drawn in the photo's own pixels so the whole picture scales as one,
// on the page and full screen. Outlines and labels wait for the photo:
// frames drawn over nothing look broken.
export function BatchPreview({ src, width, height, cards, settings, label, className }: Props) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const onPhoto = cards.filter(cd => cd.card.bbox_source !== 'user');
  const baseFont = Math.max(22, Math.floor(Math.min(width, height) * 0.03 * settings.labelFontScale));
  return (
    <svg
      className={['photo-svg', loaded ? '' : 'is-loading', className ?? ''].filter(Boolean).join(' ')}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <image href={src} width={width} height={height} onLoad={() => setLoadedSrc(src)} onError={() => setLoadedSrc(src)} />
      {loaded ? onPhoto.map(cd => {
        const [x, y, w, h] = cd.card.bbox;
        const corners = cd.card.corners;
        const points = Array.isArray(corners) && corners.length === 4
          ? corners.map(([px, py]) => `${px},${py}`).join(' ')
          : `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`;
        return <polygon key={`out-${cd.origIdx}`} points={points} className={`card-outline ${cd.isFoil ? 'foil' : ''}`} />;
      }) : null}
      {loaded ? onPhoto.map(cd => {
        const text = photoLabel(cd, settings);
        if (!text) return null;
        const a = computePillAnchor(cd.card.bbox, text, width, height, settings.labelPosition, settings.labelFontScale);
        const r = a.rectH / 2;
        return (
          <g key={`pill-${cd.origIdx}`} className={`preview-pill ${goldPill(cd, settings) ? 'foil' : ''}`}>
            <rect x={a.cx - a.rectW / 2} y={a.cy - r} width={a.rectW} height={a.rectH} rx={r} ry={r} />
            <text x={a.cx} y={a.cy} dominantBaseline="central" textAnchor="middle" style={{ fontSize: `${baseFont}px` }}>{text}</text>
          </g>
        );
      }) : null}
    </svg>
  );
}
