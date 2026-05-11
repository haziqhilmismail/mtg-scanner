import type { CardRowData } from '../types.ts';

interface Props {
  imageB64: string;
  width: number;
  height: number;
  visibleCards: CardRowData[];
  onZoom?: (src: string, caption: string) => void;
  zoomCaption?: string;
}

// Renders the source photo with a uniform rounded-square marker per visible card.
// Removed cards are not drawn so the preview matches what'll be exported.
export function BatchPreview({ imageB64, width, height, visibleCards, onZoom, zoomCaption }: Props) {
  const clickable = !!onZoom;
  return (
    <div className="preview-cell">
      <div
        className={`preview-wrap${clickable ? ' zoomable' : ''}`}
        onClick={clickable ? () => onZoom!(imageB64, zoomCaption || '') : undefined}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onZoom!(imageB64, zoomCaption || '');
          }
        } : undefined}
      >
        <img src={imageB64} alt="" />
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {visibleCards.map(cd => {
            const [x, y, w, h] = cd.card.bbox;
            const cx = x + w / 2;
            const cy = y + h / 2;
            // Center marker — fixed-aspect square so cards look consistent regardless of rotation
            const side = Math.max(40, Math.min(w, h) * 0.7);
            const sx = cx - side / 2;
            const sy = cy - side / 2;
            const radius = side * 0.18;
            const r = Math.max(22, side * 0.28);
            const fontSize = Math.round(r * 1.3);
            // Outline of the actual detected bbox, slight rounding to match real card corners
            const outlineRadius = Math.min(w, h) * 0.04;
            return (
              <g key={cd.origIdx}>
                <rect
                  x={x} y={y} width={w} height={h}
                  rx={outlineRadius} ry={outlineRadius}
                  className={`card-outline ${cd.isFoil ? 'foil' : ''}`}
                />
                <rect
                  x={sx} y={sy} width={side} height={side}
                  rx={radius} ry={radius}
                  className={`corner-rect ${cd.isFoil ? 'foil' : ''}`}
                />
                <circle cx={cx} cy={cy} r={r} className="corner-num-bg" />
                <text
                  x={cx} y={cy + r * 0.38}
                  textAnchor="middle"
                  className="corner-num"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {cd.origIdx + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
