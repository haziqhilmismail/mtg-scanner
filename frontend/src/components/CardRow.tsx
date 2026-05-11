import type { CardRowData, RelookupMsg, Settings } from '../types.ts';
import { fmt2, formatMyrWithFoil } from '../utils.ts';
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
  const url = ck || cd.sel.scryfall_uri || '';
  if (!url) return name;
  const tip = ck ? t('view_on_ck') : t('view_on_scryfall');
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
    : cd.source === 'tcgplayer' ? <span className="source-tag tcg">TCG</span>
      : cd.source === 'manual' ? <span className="source-tag manual">{t('manual_pill')}</span>
        : <span className="source-tag none">no price</span>;

  const subtotalLine = (cd.qty > 1 && !cd.needsPrice) ? (
    <div className="subtotal">
      × {cd.qty} = <strong>{formatMyrWithFoil(cd.lineTotal, cd.isFoil, settings)}</strong>
    </div>
  ) : null;

  const matchLine = cd.isManual ? null : (
    <div className={`conf ${cd.sel._lookup_failed ? 'low' : ''}`}>
      {cd.sel._lookup_failed ? t('scryfall_failed') : t('matched')}
    </div>
  );

  const priceLine = cd.isManual ? (
    <div className="price-line">
      {sourceTag}<span style={{ color: 'var(--ink-soft)' }}>{t('user_entered_name')}</span>
    </div>
  ) : (
    <div className="price-line">
      {sourceTag}USD {fmt2(cd.usd)} × {cd.mult}
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
        <span className="dot">⚠</span> {t('manual_set_price')}
      </div>
    );
  }

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
        <span className="glyph">{added ? '✓' : '+'}</span>
      </button>
      <button
        type="button"
        className="remove-btn"
        title={t('remove_card')}
        aria-label={t('remove_card')}
        onClick={onRemove}
      >×</button>

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
        {priceLine}
        {manualBanner}
        <PriceBlock cd={cd} settings={settings} t={t} onClearOverride={onClearOverride} />
        {subtotalLine}
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
