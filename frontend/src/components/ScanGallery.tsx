// The posts gallery: posts as tiles, then the photos inside one as tiles.
// Big enough to recognise a scan by its picture, with the things worth
// knowing before opening it (how many cards, what it's worth, what's wrong).

import type { Route } from '../routes.ts';
import type { Batch, Settings } from '../types.ts';
import { computeCardData, formatMyr, notAdded } from '../utils.ts';
import { Icon } from './Icon.tsx';
import { Link } from './Link.tsx';
import type { T } from '../hooks/useLang.ts';

export interface BatchSummary {
  batch: Batch;
  cards: number;      // visible (not removed) cards
  needs: number;      // things to fix: unpriced cards, or 1 if the photo itself failed
  pending: number;    // priced cards not added to the post's card list yet
  total: number;      // priced value of the visible cards
  haystack: string;   // lower-cased filename + card names, for search
}

export function summarise(batch: Batch, settings: Settings): BatchSummary {
  if (!batch.response) {
    return {
      batch, cards: 0, total: 0, pending: 0,
      needs: batch.status === 'error' ? 1 : 0,
      haystack: batch.filename.toLowerCase(),
    };
  }
  const visible = computeCardData(batch, settings).filter(cd => !cd.removed);
  return {
    batch,
    cards: visible.length,
    pending: notAdded(batch, visible).length,
    needs: visible.filter(cd => cd.needsPrice).length,
    total: visible.reduce((sum, cd) => sum + (isFinite(cd.lineTotal) ? cd.lineTotal : 0), 0),
    haystack: [batch.filename, ...visible.map(cd => cd.sel.name || '')].join('\n').toLowerCase(),
  };
}

function NeedsBadge({ n, t }: { n: number; t: T }) {
  if (n <= 0) return null;
  return (
    <span className="needs-badge">
      <Icon name="warning" size={14} />{t('scans_to_fix', { n })}
    </span>
  );
}

function PendingBadge({ text }: { text: string | null }) {
  if (!text) return null;
  return <span className="needs-badge pending-badge"><Icon name="addList" size={14} />{text}</span>;
}

function photosLabel(n: number, t: T) {
  return n === 1 ? t('scans_photo_one') : t('scans_photos', { n });
}

// A post's cover: its first few photos side by side, so posts are told apart
// by what is in them. The last cell says how many more there are.
const COVER_MAX = 4;

function Cover({ srcs, photos }: { srcs: string[]; photos: number }) {
  if (!srcs.length) return <span className="scan-tile-img"><Icon name="photo" size={28} /></span>;
  const shown = srcs.slice(0, COVER_MAX);
  const more = photos - shown.length;
  return (
    <span className={`scan-tile-img post-cover n${shown.length}`}>
      {shown.map((src, i) => (
        <span className="post-cover-cell" key={i}>
          <img src={src} alt="" loading="lazy" />
          {more > 0 && i === shown.length - 1 ? <span className="post-cover-more">+{more}</span> : null}
        </span>
      ))}
    </span>
  );
}

interface PostTileProps {
  title: string;
  covers: string[];
  photos: number;
  needs: number;
  pending: number;    // photos with cards not added yet
  total: number;
  settings: Settings;
  t: T;
  to: Route;
}

export function PostTile({ title, covers, photos, needs, pending, total, settings, t, to }: PostTileProps) {
  return (
    <Link className="scan-tile" to={to}>
      <Cover srcs={covers} photos={photos} />
      <span className="scan-tile-body">
        <span className="scan-tile-title">{title}</span>
        <span className="scan-tile-meta">
          {photosLabel(photos, t)}{total > 0 ? ` · ${formatMyr(total, settings)}` : ''}
        </span>
        <NeedsBadge n={needs} t={t} />
        <PendingBadge text={pending > 0 ? t('scans_photos_not_added', { n: pending }) : null} />
      </span>
    </Link>
  );
}

interface PhotoTileProps {
  summary: BatchSummary;
  // Its "Photo N" in the post order; null while it is not saved yet.
  number: number | null;
  settings: Settings;
  t: T;
  selecting: boolean;
  selected: boolean;
  // The photo's page; null while it is still scanning and has none yet.
  to: Route | null;
  // Called as the link is followed.
  onOpen: () => void;
  onToggle: () => void;
}

export function PhotoTile({ summary, number, settings, t, selecting, selected, to, onOpen, onToggle }: PhotoTileProps) {
  const { batch, cards, needs, pending, total } = summary;
  const src = batch.response ? (batch.response.thumb_url ?? batch.response.image_b64) : null;
  let meta: string;
  if (batch.status === 'scanning') meta = t('tab_status_scanning');
  else if (batch.outOfCredits) meta = t('tab_status_no_credits');
  else if (batch.status === 'error') meta = t('tab_status_error');
  else meta = (cards === 1 ? t('tab_status_done_one') : t('tab_status_done', { n: cards }))
    + (total > 0 ? ` · ${formatMyr(total, settings)}` : '');
  const body = (
    <>
      <span className={`scan-tile-img ${batch.status === 'scanning' ? 'is-scanning' : ''}`}>
        {src ? <img src={src} alt="" loading="lazy" /> : <Icon name="photo" size={28} />}
        {selecting ? (
          <span className="scan-tile-check" aria-hidden="true">
            {selected ? <Icon name="check" size={16} /> : null}
          </span>
        ) : null}
      </span>
      <span className="scan-tile-body">
        <span className="scan-tile-title">{number != null ? t('photo_n', { n: number }) : batch.filename}</span>
        {number != null ? <span className="scan-tile-file">{batch.filename}</span> : null}
        <span className="scan-tile-meta">{meta}</span>
        <NeedsBadge n={needs} t={t} />
        {batch.lockedAt ? (
          <span className="locked-badge"><Icon name="lock" size={13} />{t('tile_locked')}</span>
        ) : (
          <PendingBadge text={pending > 0 ? t('scans_cards_not_added', { n: pending }) : null} />
        )}
      </span>
    </>
  );
  if (selecting) {
    return (
      <button type="button" className={`scan-tile ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onToggle}>
        {body}
      </button>
    );
  }
  if (!to) return <div className="scan-tile">{body}</div>;
  return <Link className="scan-tile" to={to} onClick={onOpen}>{body}</Link>;
}
