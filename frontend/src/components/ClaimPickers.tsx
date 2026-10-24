// The pictures the Claims page points at: the post's photos and the cards in
// them, and the picker the seller uses when a comment's card needs changing.

import { useState } from 'react';
import type { Batch, CardRowData } from '../types.ts';
import { useT } from '../hooks/useLang.ts';

// One card that can be claimed: a scanned card in one of the post's photos.
export interface CardRef {
  key: string;          // `${scanId}:${cardId}`
  scanId: number;
  photo: number;        // 1-based position of its photo in the post
  filename: string;
  cd: CardRowData;
  position: string;
}

export interface Photo {
  batch: Batch;
  index: number;        // 1-based
  cards: CardRef[];
}

export interface CardStatus { text: string; kind: 'free' | 'taken' | 'part' }

export const photoThumb = (p: Photo) => p.batch.response?.thumb_url ?? p.batch.response?.image_b64 ?? '';

interface TileProps {
  card: CardRef;
  price: string;
  status?: CardStatus;
  selected: boolean;
  onPick: () => void;
}

function CardTile({ card, price, status, selected, onPick }: TileProps) {
  return (
    <button type="button" className="claims-pick-tile" aria-pressed={selected} onClick={onPick}>
      <span className="claims-thumb">
        {card.cd.card.crop_b64 ? <img src={card.cd.card.crop_b64} alt="" loading="lazy" decoding="async" /> : null}
      </span>
      <span className="claims-pick-text">
        <span className="claims-pick-name">{card.cd.sel.name || '?'}</span>
        <span className="claims-pick-meta">{[price, card.cd.qty > 1 ? `×${card.cd.qty}` : ''].filter(Boolean).join(' · ')}</span>
        {status ? <span className={`claims-pick-status is-${status.kind}`}>{status.text}</span> : null}
      </span>
    </button>
  );
}

interface CardPickerProps {
  photos: Photo[];
  hint: number | null;      // the photo the comment is probably about
  value: string | null;
  priceOf: (c: CardRef) => string;
  statusOf: (c: CardRef) => CardStatus | undefined;
  onPick: (key: string) => void;
}

// Which card a comment means, picked by its picture. The photo the comment is
// about comes first; the rest of the post is one click away.
export function CardPicker({ photos, hint, value, priceOf, statusOf, onPick }: CardPickerProps) {
  const t = useT();
  const first = photos.find(p => p.batch.scanId === hint);
  const [all, setAll] = useState(!first);
  const shown = first && !all ? [first] : photos;
  return (
    <div className="claims-picker">
      <p className="claims-picker-hint">{t('claims_pick_card')}</p>
      {shown.map(p => (
        <div key={p.batch.id} className="claims-picker-photo">
          {photos.length > 1 ? <p className="claims-label">{t('claims_photo', { n: p.index })}</p> : null}
          <div className="claims-pick-grid">
            {p.cards.map(c => (
              <CardTile key={c.key} card={c} price={priceOf(c)} status={statusOf(c)} selected={value === c.key} onPick={() => onPick(c.key)} />
            ))}
          </div>
        </div>
      ))}
      {first && !all && photos.length > 1 ? (
        <button type="button" className="ui-btn ui-btn--plain" onClick={() => setAll(true)}>{t('claims_other_photos')}</button>
      ) : null}
    </div>
  );
}
