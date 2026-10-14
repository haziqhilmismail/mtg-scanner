import { useState } from 'react';
import { Icon } from './Icon.tsx';
import type { CardRowData, RelookupMsg, Settings } from '../types.ts';
import { ckSearchUrl, fmt2, formatMyrWithFoil } from '../utils.ts';
import { CompareImages } from './CompareImages.tsx';
import { VersionBadge } from './VersionBadge.tsx';
import { PriceBlock } from './PriceBlock.tsx';
import { RowControls } from './RowControls.tsx';
import { AdjustPanel } from './AdjustPanel.tsx';

interface Props {
  cd: CardRowData;
  msg: RelookupMsg | null;
  busy: boolean;
  added: boolean;
  settings: Settings;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onZoom: (src: string, caption: string) => void;
  onAddToList: () => void;
  onRemove: () => void;
  onQtyChange: (qty: number) => void;
  onQtyStep: (delta: number) => void;
  onMultChange: (mult: number | null) => void;
  onMultStep: (delta: number) => void;
  onMultClear: () => void;
  onFoilToggle: () => void;
  onPriceChange: (v: string | null) => void;
  onClearOverride: () => void;
  onBrowsePrintings: () => void;
  onFind: (name: string) => void;
  onUseAsIs: (name: string) => void;
}

function renderTitleLink(cd: CardRowData, t: Props['t']) {
  const name = cd.sel.name || t('unknown_card');
  if (cd.isManual) return name;
  const primaryCk = cd.isFoil ? cd.sel.ck_url_foil : cd.sel.ck_url_normal;
  const altCk = cd.isFoil ? cd.sel.ck_url_normal : cd.sel.ck_url_foil;
  const ck = primaryCk || altCk || '';
  // CK product page if we have one, otherwise CK search by name. Never link to
  // Scryfall — this app is for selling, and the link is to help the user view
  // the SKU on the source-of-truth retailer.
  const url = ck || (cd.sel.name ? ckSearchUrl(cd.sel.name) : '');
  if (!url) return name;
  const tip = ck ? t('view_on_ck') : t('search_on_ck');
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={tip}>
      {name}<span className="ext-icon">↗</span>
    </a>
  );
}

export function CardRow({
  cd, msg, busy, added, settings, t,
  onZoom, onAddToList, onRemove,
  onQtyChange, onQtyStep,
  onMultChange, onMultStep, onMultClear,
  onFoilToggle,
  onPriceChange, onClearOverride,
  onBrowsePrintings, onFind, onUseAsIs,
}: Props) {
  const sourceTag = cd.source === 'cardkingdom' ? <span className="source-tag ck">CK</span>
    : cd.source === 'manual' ? <span className="source-tag manual">{t('manual_pill')}</span>
      : <span className="source-tag none">no price</span>;

  // Rendered inline inside `.price-block` (passed as the `extra` prop on
  // PriceBlock below) so toggling qty 1↔N doesn't add/remove a vertical line
  // and shift the row controls beneath it.
  const subtotalInline = (cd.qty > 1 && !cd.needsPrice) ? (
    <span className="subtotal">
      × {cd.qty} = <strong>{formatMyrWithFoil(cd.lineTotal, cd.isFoil, settings)}</strong>
    </span>
  ) : null;

  const matchLine = cd.isManual ? null : (
    <div className={`conf ${cd.sel._lookup_failed ? 'low' : ''}`}>
      {cd.sel._lookup_failed ? t('scryfall_failed') : t('matched')}
    </div>
  );

  // For non-manual cards with a CK price, show the raw multiplication result
  // (USD × mult = RM raw, *before* rounding). The rounded final RM is already
  // shown as the big number by PriceBlock — no need to repeat it here.
  const rawMyr = cd.usd * cd.mult;
  const priceLine = cd.isManual ? (
    <div className="price-line">
      {sourceTag}<span style={{ color: 'var(--ink-soft)' }}>{t('user_entered_name')}</span>
    </div>
  ) : (
    <div className="price-line">
      {sourceTag}USD {fmt2(cd.usd)} × {cd.mult}
      {cd.usd > 0 ? <span className="price-line-raw"> = RM {fmt2(rawMyr)}</span> : null}
    </div>
  );

  let manualBanner: React.ReactNode = null;
  if (cd.isManual) {
    manualBanner = cd.hasOverride ? (
      <div className="manual-banner set">
        <span className="dot">●</span> {t('manual_price_set')}
      </div>
    ) : (
      <div className="manual-banner">
        <Icon name="warning" size={16} /> {t('manual_set_price')}
      </div>
    );
  }

  // The local scanner couldn't read the collector line, so the printing (and
  // the foil default) is a visual best guess. Ask the seller to check it until
  // they pick another printing or say it's right.
  const [versionConfirmed, setVersionConfirmed] = useState(false);
  const versionUnsure = !cd.isManual
    && cd.card.version_source === 'embedding'
    && cd.sel.scryfall_id === cd.card.candidates[0]?.scryfall_id
    && !versionConfirmed;
  const versionNotice = versionUnsure ? (
    <div className="manual-banner version-check">
      <Icon name="warning" size={16} />
      <span>{t('version_unsure')}</span>
      <button type="button" className="link-btn" onClick={() => setVersionConfirmed(true)}>
        {t('version_unsure_ok')}
      </button>
    </div>
  ) : null;

  const rowClasses = ['card-row'];
  if (cd.isFoil) rowClasses.push('foil');
  if (cd.hasOverride) rowClasses.push('overridden');
  if (cd.isManual) rowClasses.push('manual');

  return (
    <div className={rowClasses.join(' ')}>
      <div className="num">{cd.origIdx + 1}</div>
      <button
        type="button"
        className={`list-btn ${added ? 'added' : ''}`}
        title={added ? t('added_to_list') : t('add_to_list')}
        aria-label={added ? t('added_to_list') : t('add_to_list')}
        onClick={added ? undefined : onAddToList}
        disabled={added}
      >
        <Icon name={added ? 'check' : 'plus'} size={16} />
      </button>
      <button
        type="button"
        className="remove-btn"
        title={t('remove_card')}
        aria-label={t('remove_card')}
        onClick={onRemove}
      ><Icon name="close" size={14} /></button>

      <CompareImages
        cropB64={cd.card.crop_b64}
        matchUrl={cd.sel.image_url || ''}
        photoLabel={t('photo_label')}
        matchLabel={t('match_label')}
        onZoom={onZoom}
        zoomPhotoCaption={t('zoom_photo')}
        zoomMatchCaption={t('zoom_match')}
      />

      <div className="info">
        <div className="title">{renderTitleLink(cd, t)}</div>
        <VersionBadge cd={cd} t={t} />
        {versionNotice}
        {priceLine}
        {manualBanner}
        <PriceBlock
          cd={cd}
          settings={settings}
          t={t}
          onClearOverride={onClearOverride}
          extra={subtotalInline}
        />
        {matchLine}

        <RowControls
          cd={cd} t={t}
          onQtyChange={onQtyChange}
          onQtyStep={onQtyStep}
          onMultChange={onMultChange}
          onMultStep={onMultStep}
          onMultClear={onMultClear}
          onFoilToggle={onFoilToggle}
        />

        <AdjustPanel
          cd={cd}
          msg={msg}
          busy={busy}
          settings={settings}
          t={t}
          onPriceChange={onPriceChange}
          onClearOverride={onClearOverride}
          onBrowsePrintings={onBrowsePrintings}
          onFind={onFind}
          onUseAsIs={onUseAsIs}
        />
      </div>
    </div>
  );
}
