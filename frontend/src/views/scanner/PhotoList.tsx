import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Link } from '../../components/Link.tsx';
import { hideBroken, Money, thumbOf, type BatchSummary } from '../../components/ScanGallery.tsx';
import type { T } from '../../hooks/useLang.ts';
import type { Route } from '../../routes.ts';
import type { Settings } from '../../types.ts';
import { canRetry } from '../../utils.ts';

// What a row of the list does: open its photo, be ticked, or move up and down.
export type PhotoListMode =
  | { kind: 'normal'; query: string; showFile: boolean; onOpen: () => void; onRetry: (id: string) => void }
  | { kind: 'select'; selected: Set<string>; onToggle: (id: string) => void }
  | { kind: 'reorder'; onMove: (index: number, by: -1 | 1, dir: 'up' | 'down') => void };

interface Props {
  items: BatchSummary[];
  // "Photo N" for each saved photo; in reorder mode the place in the draft.
  numbers: Map<string, number>;
  settings: Settings;
  mode: PhotoListMode;
  photoRoute: (scanId: number) => Route;
  t: T;
}

// A post's photos as rows: the picture, "Photo N", its cards and total, and
// what still waits (not added, to fix, prices locked).
export function PhotoList({ items, numbers, settings, mode, photoRoute, t }: Props) {
  return (
    <ul className="ui-list photolist">
      {items.map((s, i) => {
        const b = s.batch;
        const n = numbers.get(b.id);
        const title = n != null ? t('photo_n', { n }) : b.filename;
        const query = mode.kind === 'normal' ? mode.query.trim().toLowerCase() : '';
        const matched = query ? s.names.filter(name => name.toLowerCase().includes(query)) : [];
        let meta: ReactNode;
        if (b.status === 'scanning') meta = t('photo_scanning');
        else if (b.outOfCredits) meta = t('photo_no_credits');
        else if (b.status === 'error') meta = t('photo_failed');
        else meta = <>{s.cards === 1 ? t('post_cards_one') : t('post_cards', { n: s.cards })}{s.total > 0 ? <> · <Money amount={s.total} settings={settings} /></> : null}</>;
        const src = thumbOf(b);
        const body = (
          <>
            <span className={`photo-thumb${b.status === 'scanning' ? ' is-scanning' : ''}`}>
              {src ? <img src={src} alt="" loading="lazy" onError={hideBroken} /> : <Icon name="photo" size={24} />}
            </span>
            <span className="ui-row-main">
              <span className="ui-row-title">{title}</span>
              {n != null && (mode.kind === 'reorder' || (mode.kind === 'normal' && mode.showFile)) ? <span className="photo-file">{b.filename}</span> : null}
              <span className="ui-row-meta">{meta}</span>
              {matched.length ? (
                <span className="photo-match">{matched.length > 1 ? t('photo_more_matches', { name: matched[0], n: matched.length - 1 }) : matched[0]}</span>
              ) : null}
              {mode.kind !== 'reorder' && b.response ? (
                <span className="chips">
                  {b.lockedAt ? <span className="ui-chip"><Icon name="lock" size={13} />{t('tile_locked')}</span>
                    : s.pending ? <span className="ui-chip ui-chip--accent"><Icon name="addList" size={13} />{t('scans_cards_not_added', { n: s.pending })}</span> : null}
                  {s.needs ? <span className="ui-chip ui-chip--warn"><Icon name="warning" size={13} />{t('scans_to_fix', { n: s.needs })}</span> : null}
                </span>
              ) : null}
            </span>
          </>
        );
        if (mode.kind === 'select') {
          return (
            <li key={b.id}>
              <label className={`ui-row photorow${mode.selected.has(b.id) ? ' is-selected' : ''}`}>
                <input type="checkbox" className="photorow-check" checked={mode.selected.has(b.id)} onChange={() => mode.onToggle(b.id)} />
                {body}
              </label>
            </li>
          );
        }
        if (mode.kind === 'reorder') {
          return (
            <li key={b.id} className="ui-row photorow">
              {body}
              <span className="photorow-moves">
                <button type="button" className="ui-icon-btn" data-move={`${b.id} up`} disabled={i === 0} aria-label={t('reorder_up', { photo: title })} onClick={() => mode.onMove(i, -1, 'up')}>
                  <Icon name="up" size={18} />
                </button>
                <button type="button" className="ui-icon-btn" data-move={`${b.id} down`} disabled={i === items.length - 1} aria-label={t('reorder_down', { photo: title })} onClick={() => mode.onMove(i, 1, 'down')}>
                  <Icon name="up" size={18} className="flip" />
                </button>
              </span>
            </li>
          );
        }
        return (
          <li key={b.id}>
            {b.scanId != null ? (
              <Link className="ui-row photorow" to={photoRoute(b.scanId)} onClick={mode.onOpen}>{body}</Link>
            ) : (
              <div className="ui-row photorow">
                {body}
                {canRetry(b) ? <button type="button" className="ui-btn" onClick={() => mode.onRetry(b.id)}>{t('scan_retry')}</button> : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
