import { hideBroken, photoThumb, type Photo } from '../../components/ClaimPickers.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { useT } from '../../hooks/useLang.ts';
import { counted } from './model.ts';
import { Money } from './parts.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  photos: Photo[];
  postTitle: string;
  chosen: number | 'all' | null;   // the photo's scan id
  cents: boolean;
  live: boolean;
  onUse: (scanId: number) => void;
}

// "In this post": every photo large, in post order, to tell which photo a
// screenshot's comments are about when the small ones look alike.
export function PostPhotos({ open, onClose, photos, postTitle, chosen, cents, live, onUse }: Props) {
  const t = useT();
  return (
    <Dialog
      open={open} onClose={onClose} variant="picker" className="claims-dialog" closeLabel={t('claims_close')} title={t('claims_in_post')}
      subtitle={t('claims_post_photos_sub', { title: postTitle, photos: counted(t, 'claims_photos', photos.length) })}
    >
      <ul className="claims-post-photos">
        {photos.map(p => {
          const scanId = p.batch.scanId as number;
          const cards = p.cards.reduce((n, c) => n + c.cd.qty, 0);
          const value = p.cards.reduce((sum, c) => sum + (Number.isFinite(c.cd.unitPrice) ? c.cd.unitPrice * c.cd.qty : 0), 0);
          return (
            <li key={p.batch.id} className={chosen === scanId ? 'claims-post-photo is-chosen' : 'claims-post-photo'}>
              <span className="claims-post-photo-img"><img src={photoThumb(p)} alt={t('claims_photo', { n: p.index })} loading="lazy" decoding="async" onError={hideBroken} /></span>
              <div className="claims-post-photo-row">
                <span className="claims-post-photo-text">
                  <strong>{t('claims_photo', { n: p.index })}</strong>
                  <span>{counted(t, 'claims_cards', cards)} · <Money value={value} live={live} cents={cents} /></span>
                </span>
                {chosen === scanId ? (
                  <span className="claims-chosen"><Icon name="check" size={16} />{t('claims_chosen')}</span>
                ) : (
                  <button type="button" className="ui-btn" onClick={() => onUse(scanId)}>{t('claims_use_photo')}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
