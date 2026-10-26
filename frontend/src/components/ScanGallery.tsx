// Posts as list rows: big enough to tell a post by its pictures, with what is
// worth knowing before opening it (its total, how many photos, what waits).

import type { SyntheticEvent } from 'react';
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
  names: string[];    // the visible cards' names, for search
}

export function summarise(batch: Batch, settings: Settings): BatchSummary {
  if (!batch.response) {
    return { batch, cards: 0, total: 0, pending: 0, needs: batch.status === 'error' ? 1 : 0, names: [] };
  }
  const visible = computeCardData(batch, settings).filter(cd => !cd.removed);
  return {
    batch,
    cards: visible.length,
    pending: notAdded(batch, visible).length,
    needs: visible.filter(cd => cd.needsPrice).length,
    total: visible.reduce((sum, cd) => sum + (isFinite(cd.lineTotal) ? cd.lineTotal : 0), 0),
    names: visible.map(cd => cd.sel.name || ''),
  };
}

// A saved photo that still waits on the seller: on a live post, cards not in
// the post yet; on a price-on-photo post, prices not locked by Finish.
export const waits = (s: BatchSummary, live: boolean) =>
  !!s.batch.response && s.batch.scanId != null && (live ? s.pending > 0 : !s.batch.lockedAt);

// The small picture of a photo, once it has one.
export const thumbOf = (b: Batch) => (b.response ? b.response.thumb_url ?? b.response.image_b64 : null);

// A picture that won't load leaves its plain cell, not a broken-image icon.
export const hideBroken = (e: SyntheticEvent<HTMLImageElement>) => { e.currentTarget.hidden = true; };

// An amount, with "≈" when it is a live price: the price is set later.
export function Money({ amount, settings }: { amount: number; settings: Settings }) {
  return (
    <>
      {settings.priceMode === 'live' ? <span className="approx">≈</span> : null}
      {formatMyr(amount, settings)}
    </>
  );
}

// A count in words, from a key and its "_one" twin: "1 photo", "3 photos".
export const countText = (t: T, key: string, n: number) => t(n === 1 ? `${key}_one` : key, { n });

// A post's first photos in a square, the fourth cell saying how many more.
export function Mosaic({ srcs, photos }: { srcs: string[]; photos: number }) {
  const shown = srcs.slice(0, 4);
  const more = photos - shown.length;
  return (
    <span className={`mosaic n${shown.length}`} aria-hidden="true">
      {shown.length ? shown.map((src, i) => (
        <span className="mosaic-cell" key={i}>
          <img src={src} alt="" loading="lazy" onError={hideBroken} />
          {more > 0 && i === shown.length - 1 ? <span className="mosaic-more">+{more}</span> : null}
        </span>
      )) : <Icon name="photo" size={24} />}
    </span>
  );
}

interface PostRowProps {
  title: string;
  items: BatchSummary[];
  total: number;
  settings: Settings;
  // Buyers with claims on the post, and how many still have to pay.
  buyers: number;
  unpaid: number;
  paid: number;          // RM buyers have paid, shown in green under the total
  t: T;
  to: Route;
}

// One post in the list: its photos, name, total, kind and what still waits.
// For a live post that is photos with cards not in the post yet; for a
// price-on-photo post, photos not finished. Then who still has to pay.
export function PostRow({ title, items, total, settings, buyers, unpaid, paid, t, to }: PostRowProps) {
  const live = settings.priceMode === 'live';
  const scanning = items.filter(s => s.batch.status === 'scanning').length;
  const waiting = items.filter(s => waits(s, live)).length;
  const needs = items.reduce((n, s) => n + s.needs, 0);
  const meta = [live ? t('kind_live') : '', items.length ? countText(t, 'post_photos_count', items.length) : t('posts_no_photos'), scanning ? t('posts_row_scanning', { n: scanning }) : '']
    .filter(Boolean).join(' · ');
  return (
    <Link className="ui-row postrow" to={to}>
      <Mosaic srcs={items.flatMap(s => thumbOf(s.batch) ?? [])} photos={items.length} />
      <span className="ui-row-main">
        <span className="postrow-head">
          <span className="ui-row-title">{title}</span>
          {items.length ? (
            <span className="postrow-total">
              <span><Money amount={total} settings={settings} /></span>
              {paid > 0 ? <span className="postrow-paid">{t('posts_paid', { amount: formatMyr(paid, settings) })}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="ui-row-meta">{meta}</span>
        {waiting || needs || buyers ? (
          <span className="chips">
            {waiting ? (
              <span className="ui-chip ui-chip--accent">
                <Icon name="addList" size={13} />
                {countText(t, live ? 'posts_not_added' : 'posts_not_finished', waiting)}
              </span>
            ) : null}
            {needs ? <span className="ui-chip ui-chip--warn"><Icon name="warning" size={13} />{t('scans_to_fix', { n: needs })}</span> : null}
            {unpaid ? <span className="ui-chip ui-chip--warn"><Icon name="chat" size={13} />{countText(t, 'posts_buyers_unpaid', unpaid)}</span>
              : buyers ? <span className="ui-chip ui-chip--green"><Icon name="check" size={13} />{countText(t, 'posts_buyers_paid', buyers)}</span> : null}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
