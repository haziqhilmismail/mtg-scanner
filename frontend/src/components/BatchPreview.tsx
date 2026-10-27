import { useId, useState } from 'react';
import type { CardRowData, Settings } from '../types.ts';
import { goldPill, photoLabel } from '../utils.ts';

interface Props {
  src: string;
  width: number;
  height: number;
  // The kept cards. One added by hand has no spot on the photo, so it gets no outline.
  cards: CardRowData[];
  // Cards sold on an earlier post: blurred, darkened and marked SOLD, as the
  // download draws them (price_overlay.py _cover_sold).
  covers?: CardRowData[];
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

// A card's outline in photo pixels: its quad when known, else its bbox.
function outline(cd: CardRowData): string {
  const [x, y, w, h] = cd.card.bbox;
  const corners = cd.card.corners;
  return Array.isArray(corners) && corners.length === 4
    ? corners.map(([px, py]) => `${px},${py}`).join(' ')
    : `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`;
}

// The photo with each card's outline and the price label the download will
// carry, drawn in the photo's own pixels so the whole picture scales as one,
// on the page and full screen. Outlines and labels wait for the photo:
// frames drawn over nothing look broken.
export function BatchPreview({ src, width, height, cards, covers = [], settings, label, className }: Props) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const onPhoto = cards.filter(cd => cd.card.bbox_source !== 'user');
  const baseFont = Math.max(22, Math.floor(Math.min(width, height) * 0.03 * settings.labelFontScale));
  // url(#…) breaks on the colons React puts in its ids.
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, '');
  // A price pill, or SOLD across a sold card, where the download draws it.
  const pill = (key: string, cd: CardRowData, text: string, position: Settings['labelPosition'], foil: boolean) => {
    const a = computePillAnchor(cd.card.bbox, text, width, height, position, settings.labelFontScale);
    const r = a.rectH / 2;
    return (
      <g key={key} className={`preview-pill ${foil ? 'foil' : ''}`}>
        <rect x={a.cx - a.rectW / 2} y={a.cy - r} width={a.rectW} height={a.rectH} rx={r} ry={r} />
        <text x={a.cx} y={a.cy} dominantBaseline="central" textAnchor="middle" style={{ fontSize: `${baseFont}px` }}>{text}</text>
      </g>
    );
  };
  return (
    <svg
      className={['photo-svg', loaded ? '' : 'is-loading', className ?? ''].filter(Boolean).join(' ')}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <image href={src} width={width} height={height} onLoad={() => setLoadedSrc(src)} onError={() => setLoadedSrc(src)} />
      {loaded && covers.length ? (
        <>
          <defs>
            {/* The blur and shade of price_overlay.py's cover (_cover_blur, COVER_SHADE). */}
            <filter id={`${uid}-blur`}><feGaussianBlur stdDeviation={Math.max(10, Math.floor(Math.min(width, height) / 50))} /></filter>
            {covers.map(cd => <clipPath key={cd.origIdx} id={`${uid}-c${cd.origIdx}`}><polygon points={outline(cd)} /></clipPath>)}
          </defs>
          {covers.map(cd => (
            <g key={`cover-${cd.origIdx}`} clipPath={`url(#${uid}-c${cd.origIdx})`}>
              <image href={src} width={width} height={height} filter={`url(#${uid}-blur)`} />
              <polygon points={outline(cd)} className="preview-cover" />
            </g>
          ))}
          {covers.map(cd => pill(`sold-${cd.origIdx}`, cd, 'SOLD', 'center', false))}
        </>
      ) : null}
      {loaded ? onPhoto.map(cd => (
        <polygon key={`out-${cd.origIdx}`} points={outline(cd)} className={`card-outline ${cd.isFoil ? 'foil' : ''}`} />
      )) : null}
      {loaded ? onPhoto.map(cd => {
        const text = photoLabel(cd, settings);
        return text ? pill(`pill-${cd.origIdx}`, cd, text, settings.labelPosition, goldPill(cd, settings)) : null;
      }) : null}
    </svg>
  );
}
