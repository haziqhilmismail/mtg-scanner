import { useId, useMemo, useState } from 'react';
import { photoThumb, type Photo } from '../../components/ClaimPickers.tsx';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { TextArea } from '../../components/ui/Field.tsx';
import { useT } from '../../hooks/useLang.ts';
import type { SortedBy } from '../../utils.ts';
import { commentRows } from './comments.ts';
import { counted } from './model.ts';

// One comment screenshot in Add comments.
export interface Shot {
  id: number;
  name: string;
  src: string;                    // object URL of the screenshot
  text: string;                   // what was read; the seller can fix it
  photo: number | 'all' | null;   // the photo's scan id; 'all' = several photos; null = not chosen yet
  by: SortedBy;                   // how it got that photo
}

interface Props {
  shot: Shot;
  photos: Photo[];
  onChange: (patch: Partial<Shot>) => void;
  onRemove: () => void;
  onView: () => void;
  onPostPhotos: () => void;
}

const TONE: Record<SortedBy, { tone: string; icon: IconName }> = {
  found: { tone: 'is-found', icon: 'check' },
  picked: { tone: 'is-picked', icon: 'edit' },
  guess: { tone: 'is-check', icon: 'warning' },
  follows: { tone: 'is-check', icon: 'warning' },
  none: { tone: 'is-check', icon: 'warning' },
};

// The screenshot, which photo its comments are for, and the comments read
// from it, with the raw text behind "Fix a misread name".
export function ShotCard({ shot, photos, onChange, onRemove, onView, onPostPhotos }: Props) {
  const t = useT();
  const id = useId();
  const rows = useMemo(() => commentRows(shot.text), [shot.text]);
  const [raw, setRaw] = useState(rows.length === 0);
  const photoNo = photos.find(p => p.batch.scanId === shot.photo)?.index;
  const status = shot.by === 'found' ? t('claims_shot_found', { n: photoNo ?? '' })
    : shot.by === 'guess' ? t('claims_shot_guess', { n: photoNo ?? '' })
    : shot.by === 'follows' ? t('claims_shot_follows')
    : shot.by === 'picked' ? t(shot.photo === 'all' ? 'claims_shot_picked_several' : 'claims_shot_picked')
    : t('claims_shot_none');
  const pick = (photo: number | 'all') => onChange({ photo, by: 'picked' });

  return (
    <section className="claims-shot" aria-label={shot.name}>
      <div className="claims-shot-head">
        <button type="button" className="claims-shot-thumb" aria-label={t('claims_view_shot')} onClick={onView}>
          <img src={shot.src} alt="" />
        </button>
        <div className="claims-shot-info">
          {photos.length > 1 ? (
            <p className={`claims-shot-status ${TONE[shot.by].tone}`}><Icon name={TONE[shot.by].icon} size={15} />{status}</p>
          ) : null}
          <p className={rows.length ? 'claims-shot-count' : 'claims-shot-count is-check'}>
            {rows.length ? counted(t, 'claims_read_count', rows.length) : t('claims_read_none')}
          </p>
        </div>
        <button type="button" className="ui-icon-btn ui-icon-btn--sm" aria-label={t('claims_remove_shot')} onClick={onRemove}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="claims-for">
        <span id={`${id}-for`} className="ui-label">{t('claims_for')}</span>
        <button type="button" className="ui-btn ui-btn--plain" aria-haspopup="dialog" onClick={onPostPhotos}>
          <Icon name="photo" size={16} />{t('claims_in_post')}
        </button>
      </div>
      <div className="claims-photo-grid" role="radiogroup" aria-labelledby={`${id}-for`}>
        {photos.map(p => (
          <label key={p.batch.id} className="claims-photo-cell">
            <input type="radio" name={`${id}-photo`} checked={shot.photo === p.batch.scanId} onChange={() => pick(p.batch.scanId as number)} />
            <span className="claims-photo-thumb">
              <img src={photoThumb(p)} alt="" loading="lazy" decoding="async" />
              <Icon name="check" size={12} className="claims-photo-check" />
            </span>
            <span className="claims-photo-label">{t('claims_photo', { n: p.index })}</span>
          </label>
        ))}
        {photos.length > 1 ? (
          <label className="claims-photo-cell">
            <input type="radio" name={`${id}-photo`} checked={shot.photo === 'all'} onChange={() => pick('all')} />
            <span className="claims-photo-thumb is-several">
              <Icon name="photos" size={22} />
              <Icon name="check" size={12} className="claims-photo-check" />
            </span>
            <span className="claims-photo-label">{t('claims_several')}</span>
          </label>
        ) : null}
      </div>

      {rows.length ? (
        <>
          <p className="ui-label">{t('claims_comments_read')}</p>
          <ul className="claims-box claims-read">
            {rows.map((r, i) => (
              <li key={i}><span className="claims-read-name">{r.name}</span><span className="claims-read-text">{r.text}</span></li>
            ))}
          </ul>
        </>
      ) : null}
      <button type="button" className="ui-btn ui-btn--plain claims-raw-toggle" aria-expanded={raw} onClick={() => setRaw(!raw)}>
        <Icon name="edit" size={16} />{raw ? t('claims_hide_text') : t('claims_fix_text')}
      </button>
      {raw ? <TextArea label={t('claims_text_label')} rows={7} value={shot.text} onChange={e => onChange({ text: e.target.value })} /> : null}
    </section>
  );
}
