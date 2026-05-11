import { upgradeScryfallImage } from '../utils.ts';

interface Props {
  cropB64: string;
  matchUrl: string;
  photoLabel: string;
  matchLabel: string;
  onZoom: (src: string, caption: string) => void;
  zoomPhotoCaption: string;
  zoomMatchCaption: string;
}

// Side-by-side photo crop + matched Scryfall printing. Both click to zoom.
export function CompareImages({
  cropB64, matchUrl,
  photoLabel, matchLabel,
  onZoom, zoomPhotoCaption, zoomMatchCaption,
}: Props) {
  return (
    <div className="compare">
      <div className="compare-cell">
        <img
          src={cropB64}
          alt=""
          loading="lazy"
          onClick={() => onZoom(cropB64, zoomPhotoCaption)}
        />
        <div className="lbl">{photoLabel}</div>
      </div>
      <div className="compare-cell match">
        {matchUrl ? (
          <img
            src={matchUrl}
            alt=""
            loading="lazy"
            onClick={() => onZoom(upgradeScryfallImage(matchUrl), zoomMatchCaption)}
          />
        ) : (
          <div className="placeholder">?</div>
        )}
        <div className="lbl">{matchLabel}</div>
      </div>
    </div>
  );
}
