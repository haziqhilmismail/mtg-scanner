import { useState, type ReactNode } from 'react';
import type { T } from '../hooks/useLang.ts';
import type { CardRowData, Settings } from '../types.ts';
import { ckSearchUrl, fmt2, formatMyr, rarityKey, smallScryfallImage } from '../utils.ts';
import { Icon } from './Icon.tsx';
import { PhotoViewer } from './ui/PhotoViewer.tsx';
import { Stepper } from './ui/Stepper.tsx';

interface Props {
  cd: CardRowData;
  // On the post's card list.
  added: boolean;
  // Being added to the post or taken out of it.
  adding: boolean;
  // The photo is finished: its prices are fixed, so only adding and taking out are left.
  locked: boolean;
  // A live-price post: the auto price is today's, marked ≈.
  live: boolean;
  // The scanner guessed the printing: the seller checks it.
  unsure: boolean;
  settings: Settings;
  t: T;
  onView: (side: 0 | 1) => void;
  onLooksRight: () => void;
  onToggleAdded: () => void;
  onEditPrice: () => void;
  onChangeCard: () => void;
  onQuantity: (qty: number) => void;
  onRemove: () => void;
  onRestore: () => void;
}

// The card's name, linked to its Card Kingdom page (or a search there by name).
function titleLink(cd: CardRowData, name: string, t: T) {
  if (cd.isManual) return name;
  const ck = (cd.isFoil ? cd.sel.ck_url_foil || cd.sel.ck_url_normal : cd.sel.ck_url_normal || cd.sel.ck_url_foil) || '';
  const url = ck || (cd.sel.name ? ckSearchUrl(cd.sel.name) : '');
  if (!url) return name;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={ck ? t('photo_view_on_ck') : t('photo_search_on_ck')}>
      {name}<Icon name="external" size={14} className="photo-tile-ext" />
    </a>
  );
}

// How the price was made: "USD 4.99 × 2.5", "Foil · USD 4.49 × 2.8",
// "Your price · auto ≈RM13", or that Card Kingdom has no price.
function formula(cd: CardRowData, live: boolean, settings: Settings, t: T): ReactNode {
  const foil = cd.isFoil ? <><span className="photo-foil">{t('foil_on')}</span> · </> : null;
  const noCk = t('photo_no_ck');
  if (cd.hasOverride) {
    const yours = <span className="photo-yours">{t('photo_your_price')}</span>;
    if (cd.ownUsd != null) return <>{foil}{yours} · USD {fmt2(cd.ownUsd)} × {cd.mult}</>;
    const auto = cd.autoPrice > 0 ? t('photo_auto', { price: `${live ? '≈' : ''}${formatMyr(cd.autoPrice, settings)}` }) : noCk;
    return <>{foil}{yours} · {auto}</>;
  }
  if (cd.needsPrice) return <>{foil}{noCk}</>;
  return <>{foil}USD {fmt2(cd.usd)} × {cd.mult}</>;
}

// A card's picture, or the placeholder when there is none or it fails to load.
function Picture({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState('');
  return src && failed !== src ? <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} /> : <>{fallback}</>;
}

// One card of the photo: your crop next to the matched card, then its name,
// printing, price and the controls a seller uses on every card. A removed
// card stays in its place as one row, so it is easy to bring back.
export function CardRow({
  cd, added, adding, locked, live, unsure, settings, t,
  onView, onLooksRight, onToggleAdded, onEditPrice, onChangeCard, onQuantity, onRemove, onRestore,
}: Props) {
  const name = cd.sel.name || t('unknown_card');
  const num = cd.origIdx + 1;
  if (cd.removed) {
    return (
      <article className="photo-tile is-removed">
        <span className="photo-tile-num">{num}</span>
        <p className="photo-tile-removed"><strong>{t('photo_removed')}</strong> · {name}</p>
        {locked ? null : (
          <button type="button" className="ui-btn ui-btn--plain" aria-label={t('photo_restore_card', { name })} onClick={onRestore}>{t('photo_restore')}</button>
        )}
      </article>
    );
  }

  const set = cd.isManual ? '' : cd.sel.set?.toUpperCase() ?? '';
  const rarity = rarityKey(cd.sel.rarity);
  const matchSrc = cd.sel.image_url || '';
  const priced = Number.isFinite(cd.unitPrice);
  const approx = live && !cd.hasOverride ? <span className="photo-approx">≈</span> : null;
  return (
    <article className={`photo-tile${cd.isFoil ? ' is-foil' : ''}`}>
      <div className="photo-tile-pair">
        <button type="button" className="photo-tile-img" aria-label={t('photo_view_yours', { name })} onClick={() => onView(0)}>
          <Picture src={cd.card.crop_b64} fallback={<span className="photo-tile-none"><Icon name="photo" size={24} /></span>} />
          <span className="photo-tile-num">{num}</span>
          <span className="photo-tile-zoom"><Icon name="expand" size={12} /></span>
        </button>
        <span className={`photo-tile-arrow${unsure ? ' is-unsure' : ''}`} aria-hidden="true">
          {unsure ? '?' : <Icon name="arrowRight" size={18} />}
        </span>
        <button type="button" className="photo-tile-img" aria-label={t('photo_view_match', { name })} onClick={() => onView(1)}>
          <Picture
            src={matchSrc && smallScryfallImage(matchSrc)}
            fallback={<span className="photo-tile-none"><Icon name="photo" size={24} />{set ? `${set} · #${cd.sel.collector_number || '?'}` : t('photo_no_match')}</span>}
          />
          <span className="photo-tile-zoom"><Icon name="expand" size={12} /></span>
        </button>
      </div>

      {unsure ? (
        <div className="photo-tile-check">
          <Icon name="warning" size={16} />
          <span>{t('tile_check')}</span>
          <button type="button" className="photo-tile-ok" onClick={onLooksRight}>{t('version_unsure_ok')}</button>
        </div>
      ) : null}

      <div className="photo-tile-title">
        <h3 className="photo-tile-name">{titleLink(cd, name, t)}</h3>
        <button
          type="button" className={`photo-tile-add${added ? ' is-added' : ''}`}
          aria-label={t(added ? 'photo_take_out' : 'photo_add', { name })}
          title={t(added ? 'photo_in_post' : 'photo_add_short')}
          disabled={adding} aria-busy={adding || undefined}
          onClick={onToggleAdded}
        ><span><Icon name={added ? 'check' : 'plus'} size={16} /></span></button>
      </div>

      <div className="version-line photo-tile-version">
        <span className="set-badge">
          {rarity ? <span className={`rarity ${rarity}`} /> : null}
          {set ? <>{set}<span className="cn">#{cd.sel.collector_number || '?'}</span></> : t('photo_no_printing')}
        </span>
        {set && cd.sel.set_name ? <span className="set-name">{cd.sel.set_name}</span> : null}
      </div>

      <p className="photo-tile-formula">{formula(cd, live, settings, t)}</p>

      <div className="photo-tile-price">
        {priced ? (
          <span className="photo-tile-amount">{approx}{formatMyr(cd.unitPrice, settings)}</span>
        ) : <span className="photo-tile-setprice">{t('photo_set_price')}</span>}
        {locked ? null : (
          <button
            type="button" className={`ui-icon-btn ui-icon-btn--sm photo-tile-edit${cd.hasOverride ? ' is-set' : ''}${priced ? '' : ' is-needed'}`}
            aria-label={t('photo_edit_price', { name })} title={t('tile_edit_price')} onClick={onEditPrice}
          ><Icon name="edit" size={16} /></button>
        )}
        {priced && cd.qty > 1 ? (
          <span className="photo-tile-each">{t('photo_times', { qty: cd.qty, total: `${approx ? '≈' : ''}${formatMyr(cd.lineTotal, settings)}` })}</span>
        ) : null}
      </div>

      {locked ? null : (
        <div className="photo-tile-actions">
          <button type="button" className="ui-btn photo-tile-change" onClick={onChangeCard}>
            <Icon name="swap" size={16} />{t('tile_change_card')}
          </button>
          <Stepper
            value={cd.qty} onChange={onQuantity} min={1}
            label={t('photo_qty', { name })} decrementLabel={t('tile_qty_down')} incrementLabel={t('tile_qty_up')}
            onRemove={onRemove} removeLabel={t('photo_remove_card', { name })}
          />
        </div>
      )}
    </article>
  );
}

interface ViewerProps {
  cd: CardRowData;
  open: boolean;
  // Which picture shows first: your card (0) or the matched one (1).
  start: 0 | 1;
  locked: boolean;
  t: T;
  onClose: () => void;
  onChangeCard: () => void;
}

// Your card and the matched card full screen; a click on the picture flips
// between them. With no matched picture, your card alone.
export function CardViewer({ cd, open, start, locked, t, onClose, onChangeCard }: ViewerProps) {
  const name = cd.sel.name || t('unknown_card');
  const set = cd.isManual ? '' : cd.sel.set?.toUpperCase() ?? '';
  const printing = set ? [set, `#${cd.sel.collector_number || '?'}`, cd.sel.set_name] : [t('photo_no_printing')];
  const yours = { src: cd.card.crop_b64, alt: t('photo_alt_yours', { name }), label: t('tile_your_card') };
  const caption = (
    <div className="ui-viewer-caption photo-viewer-caption is-card">
      <strong>{name}</strong>
      <span>{[...printing, t(cd.isFoil ? 'foil_on' : 'foil_off')].filter(Boolean).join(' · ')}</span>
      {cd.sel.image_url ? <span className="photo-viewer-hint">{t('photo_viewer_hint')}</span> : null}
      {locked ? null : (
        <button type="button" className="ui-btn" onClick={onChangeCard}><Icon name="swap" size={16} />{t('tile_change_card')}</button>
      )}
    </div>
  );
  const common = { open, onClose, label: name, closeLabel: t('voucher_close') };
  return cd.sel.image_url ? (
    <PhotoViewer
      {...common} start={start} flipLabel={t('photo_flip')}
      pair={[yours, { src: cd.sel.image_url, alt: t('photo_alt_match', { name }), label: t('tile_matched_card') }]}
    >{caption}</PhotoViewer>
  ) : <PhotoViewer {...common} image={yours}>{caption}</PhotoViewer>;
}
