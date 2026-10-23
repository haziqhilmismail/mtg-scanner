import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';
import type { CardRowData, Settings } from '../types.ts';
import { ckSearchUrl, fmt2, formatMyrWithFoil, rarityKey, smallScryfallImage } from '../utils.ts';
import { AdjustPanel } from './AdjustPanel.tsx';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

interface Props {
  cd: CardRowData;
  // Shown on the compare popup: "From photo 2 · card 1".
  photoNumber: number | null;
  added: boolean;
  // The photo is finished: the tile shows its price but can't change it.
  locked: boolean;
  // A live-price post: the price shown is today's estimate.
  live: boolean;
  versionOk: boolean;
  settings: Settings;
  t: T;
  onVersionOk: () => void;
  onRemove: () => void;
  onQtyStep: (delta: number) => void;
  onMultStep: (delta: number) => void;
  onMultClear: () => void;
  onFoilToggle: () => void;
  onPriceChange: (v: string | null) => void;
  onClearOverride: () => void;
  onChangeCard: () => void;
}

function titleLink(cd: CardRowData, t: T) {
  const name = cd.sel.name || t('unknown_card');
  if (cd.isManual) return name;
  const ck = (cd.isFoil ? cd.sel.ck_url_foil || cd.sel.ck_url_normal : cd.sel.ck_url_normal || cd.sel.ck_url_foil) || '';
  // CK product page, else a CK search by name: the link is for checking the
  // card on the retailer the prices come from.
  const url = ck || (cd.sel.name ? ckSearchUrl(cd.sel.name) : '');
  if (!url) return name;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={ck ? t('view_on_ck') : t('search_on_ck')}>
      {name}<Icon name="external" size={13} className="tile-ext" />
    </a>
  );
}

export function CardRow({
  cd, photoNumber, added, locked, live, versionOk, settings, t,
  onVersionOk, onRemove, onQtyStep, onMultStep, onMultClear, onFoilToggle,
  onPriceChange, onClearOverride, onChangeCard,
}: Props) {
  const [comparing, setComparing] = useState(false);
  const [side, setSide] = useState<'yours' | 'match'>('yours');
  useBackClose(comparing, () => setComparing(false));
  const [editing, setEditing] = useState(false);

  // The local scanner couldn't read the collector line, so the printing (and
  // the foil default) is a best guess until the seller picks another or says
  // it is right.
  const versionUnsure = !locked && !cd.isManual
    && cd.card.version_source === 'embedding'
    && cd.sel.scryfall_id === cd.card.candidates[0]?.scryfall_id
    && !versionOk;
  const matchSrc = cd.sel.image_url || '';
  const gold = cd.isFoil && settings.foilStyle === 'gold';
  const price = formatMyrWithFoil(cd.unitPrice, cd.isFoil, settings);

  const working = cd.isManual ? t('user_entered_name')
    : cd.hasOverride ? <><span className="tile-yours">{t('tile_your_price')}</span> · {t('tile_auto', { price: formatMyrWithFoil(cd.autoPrice, cd.isFoil, settings) })}</>
      : <>{cd.isFoil ? <span className="tile-foil">{t('foil_on')}</span> : null}{cd.isFoil ? ' · ' : ''}USD {fmt2(cd.usd)} × {cd.mult}</>;

  const classes = ['card-row'];
  if (cd.isFoil) classes.push('foil');
  if (versionUnsure) classes.push('unsure');

  return (
    <article className={classes.join(' ')}>
      <button type="button" className="tile-compare" aria-label={t('tile_compare')} title={t('tile_compare')} onClick={() => { setSide('yours'); setComparing(true); }}>
        <span className="tile-img">
          <img src={cd.card.crop_b64} alt="" loading="lazy" />
          <span className="tile-num">{cd.origIdx + 1}</span>
        </span>
        <span className={`tile-arrow ${versionUnsure ? 'is-unsure' : ''}`} aria-hidden="true">
          {versionUnsure ? '?' : <Icon name="chevronRight" size={18} />}
        </span>
        <span className="tile-img">
          {matchSrc ? <img key={matchSrc} src={smallScryfallImage(matchSrc)} alt="" loading="lazy" /> : <span className="tile-img-none">?</span>}
        </span>
      </button>

      {versionUnsure ? (
        <div className="tile-check" title={t('version_unsure')}>
          <Icon name="warning" size={16} />
          <span>{t('tile_check')}</span>
          <button type="button" onClick={onVersionOk}>{t('version_unsure_ok')}</button>
        </div>
      ) : null}

      <div className="tile-title">
        <span className="tile-name">{titleLink(cd, t)}</span>
        {added ? <span className="tile-in-post" title={t('added_to_list')} aria-label={t('added_to_list')}><Icon name="check" size={16} /></span> : null}
      </div>
      {cd.isManual || !cd.sel.set ? null : (
        <div className="version-line tile-version">
          <span className="set-badge">
            {rarityKey(cd.sel.rarity) ? <span className={`rarity ${rarityKey(cd.sel.rarity)}`} /> : null}
            {cd.sel.set.toUpperCase()}
            <span className="cn">#{cd.sel.collector_number || '?'}</span>
          </span>
          {cd.sel.set_name ? <span className="set-name">{cd.sel.set_name}</span> : null}
        </div>
      )}
      <div className="tile-working">{working}</div>
      <div className="tile-price-row">
        {cd.needsPrice ? <span className="tile-needs">{t('price_required')}</span> : (
          <span className={`tile-price ${gold ? 'foil' : ''}`}>
            {live && !cd.hasOverride ? <span className="tile-approx">~</span> : null}{price}
            {cd.qty > 1 ? <span className="tile-subtotal"> × {cd.qty} = {formatMyrWithFoil(cd.lineTotal, cd.isFoil, settings)}</span> : null}
          </span>
        )}
        {locked ? null : (
          <button
            type="button" className={`tile-icon-btn ${cd.hasOverride ? 'is-set' : ''} ${cd.needsPrice ? 'is-needed' : ''}`}
            aria-label={t('tile_edit_price')} title={t('tile_edit_price')} onClick={() => setEditing(true)}
          ><Icon name="edit" size={16} /></button>
        )}
      </div>

      {locked ? null : (
        <div className="tile-foot">
          <button type="button" className="tile-change" onClick={onChangeCard}>
            <Icon name="swap" size={16} />{t('tile_change_card')}
          </button>
          <div className="tile-qty">
            {cd.qty > 1 ? (
              <button type="button" aria-label={t('tile_qty_down')} onClick={() => onQtyStep(-1)}><Icon name="minus" size={18} /></button>
            ) : (
              <button type="button" className="is-remove" aria-label={t('remove_card')} title={t('remove_card')} onClick={onRemove}><Icon name="trash" size={18} /></button>
            )}
            <span aria-live="polite">{cd.qty}</span>
            <button type="button" aria-label={t('tile_qty_up')} onClick={() => onQtyStep(1)}><Icon name="plus" size={18} /></button>
          </div>
        </div>
      )}

      {comparing ? createPortal(
        <div className="feedback-overlay compare-shade" onClick={() => setComparing(false)}>
          <div className="compare-pop" role="dialog" aria-modal="true" aria-label={cd.sel.name || t('unknown_card')} onClick={e => e.stopPropagation()}>
            <h2>{cd.sel.name || t('unknown_card')}</h2>
            {/* Phone: one card at a time, switched here or by tapping the card. */}
            <div className="segmented compare-switch" role="group" aria-label={t('tile_compare')}>
              <button type="button" className={side === 'yours' ? 'active' : ''} aria-pressed={side === 'yours'} onClick={() => setSide('yours')}>{t('tile_your_card')}</button>
              <button type="button" className={side === 'match' ? 'active' : ''} aria-pressed={side === 'match'} onClick={() => setSide('match')}>{t('tile_matched_card')}</button>
            </div>
            <div className={`compare-pair show-${side}`}>
              <figure className="is-yours" onClick={() => setSide('match')}>
                <img src={cd.card.crop_b64} alt="" />
                <figcaption>
                  <strong className="compare-wide">{t('tile_your_card')}</strong>
                  <strong className="compare-narrow">{cd.sel.name || t('unknown_card')}</strong>
                  {photoNumber != null ? <span>{t('tile_from_photo', { photo: photoNumber, n: cd.origIdx + 1 })}</span> : null}
                  <span className="compare-narrow compare-tap">{t('tile_tap_match')}</span>
                </figcaption>
              </figure>
              <span className="tile-arrow" aria-hidden="true"><Icon name="chevronRight" size={18} /></span>
              <figure className="is-match" onClick={() => setSide('yours')}>
                {matchSrc ? <img src={matchSrc} alt="" /> : <span className="tile-img-none">?</span>}
                <figcaption>
                  <strong className="compare-wide">{t('tile_matched_card')}</strong>
                  <strong className="compare-narrow">{cd.sel.name || t('unknown_card')}</strong>
                  <span>{[cd.sel.set?.toUpperCase(), cd.sel.collector_number ? `#${cd.sel.collector_number}` : '', cd.sel.set_name, cd.isFoil ? t('foil_on') : t('foil_off')].filter(Boolean).join(' · ')}</span>
                  <span className="compare-narrow compare-tap">{t('tile_tap_yours')}</span>
                </figcaption>
              </figure>
            </div>
            <div className="compare-actions">
              {locked ? null : (
                <button type="button" className="tile-change" onClick={() => { setComparing(false); onChangeCard(); }}>
                  <Icon name="swap" size={16} />{t('tile_change_card')}
                </button>
              )}
              <button type="button" className="feedback-close" onClick={() => setComparing(false)} aria-label={t('voucher_close')}>×</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {editing ? (
        <AdjustPanel
          cd={cd} live={live} settings={settings} t={t}
          onClose={() => setEditing(false)}
          onFoilToggle={onFoilToggle}
          onMultStep={onMultStep}
          onMultClear={onMultClear}
          onPriceChange={onPriceChange}
          onClearOverride={onClearOverride}
        />
      ) : null}
    </article>
  );
}

