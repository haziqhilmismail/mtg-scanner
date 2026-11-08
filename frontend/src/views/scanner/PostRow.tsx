// Posts as list rows: big enough to tell a post by its pictures, with what is
// worth knowing before opening it (its total, how many photos, what waits).

import type { SyntheticEvent } from 'react';
import { plural } from '../../i18n/index.ts';
import type { Route } from '../../routes.ts';
import type { Batch, Settings } from '../../types.ts';
import { postStatus, type PhotoStatus } from './status.ts';
import { Icon } from '../../components/Icon.tsx';
import { Link } from '../../components/Link.tsx';
import { useT } from '../../hooks/useLang.ts';
import { Money } from '../../components/Money.tsx';
import { formatMyr } from '../../lib/money.ts';
import { isLive } from '../../lib/pricing.ts';

export const thumbOf = (b: Batch) => (b.response ? b.response.thumb_url ?? b.response.image_b64 : null);

// A picture that won't load leaves its plain cell, not a broken-image icon.
export const hideBroken = (e: SyntheticEvent<HTMLImageElement>) => { e.currentTarget.hidden = true; };

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
  items: PhotoStatus[];
  settings: Settings;
  // Buyers with claims on the post, and how many still have to pay.
  buyers: number;
  unpaid: number;
  paid: number;          // RM buyers have paid, shown in green under the total
  to: Route;
}

// One post in the list: its photos, name, total, kind and what still waits.
// For a live post that is photos with cards not in the post yet; for a
// price-on-photo post, photos not finished. Then who still has to pay.
export function PostRow({ title, items, settings, buyers, unpaid, paid, to }: PostRowProps) {
  const { t } = useT();
  const live = isLive(settings);
  const { scanning, waiting: { length: waiting }, toFix: needs, total } = postStatus(items);
  const meta = [live ? t('kind_live') : '', items.length ? plural(t, 'photos', items.length) : t('posts_no_photos'), scanning ? t('posts_row_scanning', { n: scanning }) : '']
    .filter(Boolean).join(' · ');
  return (
    <Link className="ui-row postrow" to={to}>
      <Mosaic srcs={items.flatMap(s => thumbOf(s.batch) ?? [])} photos={items.length} />
      <span className="ui-row-main">
        <span className="postrow-head">
          <span className="ui-row-title">{title}</span>
          {items.length ? (
            <span className="postrow-total">
              <span><Money live={live}>{formatMyr(total, settings)}</Money></span>
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
                {plural(t, live ? 'posts_not_added' : 'posts_not_finished', waiting)}
              </span>
            ) : null}
            {needs ? <span className="ui-chip ui-chip--warn"><Icon name="warning" size={13} />{t('scans_to_fix', { n: needs })}</span> : null}
            {unpaid ? <span className="ui-chip ui-chip--warn"><Icon name="chat" size={13} />{plural(t, 'posts_buyers_unpaid', unpaid)}</span>
              : buyers ? <span className="ui-chip ui-chip--green"><Icon name="check" size={13} />{plural(t, 'posts_buyers_paid', buyers)}</span> : null}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
