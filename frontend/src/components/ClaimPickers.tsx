// The pictures the Claims page points at: the post's photos and the cards in
// them. The same tiles serve as the post's inventory and as the pickers the
// seller taps when the app could not tell which photo or card a comment means.

import { useState } from 'react';
import type { Batch, CardRowData } from '../types.ts';
import { Icon } from './Icon.tsx';

type T = (k: string, vars?: Record<string, string | number>) => string;

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
  selected?: boolean;
  onClick?: () => void;
}

export function CardTile({ card, price, status, selected, onClick }: TileProps) {
  const body = (
    <>
      <span className="card-tile-img">
        {card.cd.card.crop_b64 ? <img src={card.cd.card.crop_b64} alt="" loading="lazy" decoding="async" /> : null}
      </span>
      <span className="card-tile-text">
        <span className="card-tile-name">{card.cd.sel.name || '?'}</span>
        <span className="card-tile-meta">{[price, card.cd.qty > 1 ? `×${card.cd.qty}` : ''].filter(Boolean).join(' · ')}</span>
        {status ? <span className={`card-tile-status is-${status.kind}`}>{status.text}</span> : null}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={`card-tile ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="card-tile">{body}</div>
  );
}

interface PhotoPickerProps {
  photos: Photo[];
  value: number | 'all' | null;
  suggest: number | null;
  onPick: (v: number | 'all') => void;
  t: T;
}

// Which photo a screenshot's comments are about, picked by its picture.
export function PhotoPicker({ photos, value, suggest, onPick, t }: PhotoPickerProps) {
  return (
    <div className="photo-picker" role="group" aria-label={t('claims_page_photo')}>
      {photos.map(p => {
        const id = p.batch.scanId as number;
        return (
          <button
            key={p.batch.id} type="button"
            className={`photo-pick ${value === id ? 'is-selected' : ''}`}
            aria-pressed={value === id}
            onClick={() => onPick(id)}
          >
            <span className="photo-pick-img"><img src={photoThumb(p)} alt="" loading="lazy" decoding="async" /></span>
            <span className="photo-pick-label">{t('claims_photo_short', { n: p.index })}</span>
            {value == null && suggest === id ? <span className="photo-pick-hint">{t('claims_same_as_before')}</span> : null}
          </button>
        );
      })}
      {photos.length > 1 ? (
        <button
          type="button" className={`photo-pick is-all ${value === 'all' ? 'is-selected' : ''}`}
          aria-pressed={value === 'all'} onClick={() => onPick('all')}
        >
          <span className="photo-pick-img"><Icon name="photo" size={22} /></span>
          <span className="photo-pick-label">{t('claims_several_photos')}</span>
        </button>
      ) : null}
    </div>
  );
}

interface CardPickerProps {
  photos: Photo[];
  hint: number | null;      // the photo the comment is probably about
  value: string | null;
  priceOf: (c: CardRef) => string;
  statusOf: (c: CardRef) => CardStatus | undefined;
  photoLabel: (p: Photo) => string;
  onPick: (key: string) => void;
  t: T;
}

// Which card a comment means, picked by its picture. The photo the comment is
// about comes first; the rest of the post is one tap away.
export function CardPicker({ photos, hint, value, priceOf, statusOf, photoLabel, onPick, t }: CardPickerProps) {
  const first = photos.find(p => p.batch.scanId === hint);
  const [all, setAll] = useState(!first);
  const shown = first && !all ? [first] : photos;
  return (
    <div className="card-picker">
      <p className="card-picker-hint">{t('claims_pick_card')}</p>
      {shown.map(p => (
        <div key={p.batch.id}>
          {photos.length > 1 ? <p className="card-picker-photo">{photoLabel(p)}</p> : null}
          <div className="card-grid">
            {p.cards.map(c => (
              <CardTile
                key={c.key} card={c} price={priceOf(c)} status={statusOf(c)}
                selected={value === c.key} onClick={() => onPick(c.key)}
              />
            ))}
          </div>
        </div>
      ))}
      {first && !all && photos.length > 1 ? (
        <button type="button" className="link-btn" onClick={() => setAll(true)}>{t('claims_other_photos')}</button>
      ) : null}
    </div>
  );
}
