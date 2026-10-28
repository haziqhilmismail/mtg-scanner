import { useId, useMemo, useState } from 'react';
import { CardPicker, hideBroken, type CardRef, type CardStatus, type Photo } from '../../components/ClaimPickers.tsx';
import { Icon } from '../../components/Icon.tsx';
import { TextField } from '../../components/ui/Field.tsx';
import { Stepper } from '../../components/ui/Stepper.tsx';
import { useT } from '../../hooks/useLang.ts';
import { spelledDifferently } from './comments.ts';
import { counted, rm } from './model.ts';

// hint: the photo the comment is about, when known, so its cards come first.
export interface DraftItem { key: string | null; qty: number; said: string; unclear: string; hint: number | null }
// byHand: typed by the seller, not read from a comment.
export interface Draft { buyer: string; comment: string; unclear: string; items: DraftItem[]; byHand: boolean }

// What the check step holds: claims read from comments, only typed ones, or none.
export const draftsKind = (drafts: Draft[]): 'found' | 'hand' | 'none' =>
  !drafts.length ? 'none' : drafts.some(d => !d.byHand) ? 'found' : 'hand';

// A claim to type: the buyer (when known) and one card still to choose.
export const blankDraft = (buyer = ''): Draft => ({
  buyer, comment: '', unclear: '', byHand: true, items: [{ key: null, qty: 1, said: '', unclear: '', hint: null }],
});

interface Props {
  drafts: Draft[];
  skipped: string[];
  photos: Photo[];
  cardsByKey: Map<string, CardRef>;
  claimedBy: Map<string, { qty: number; names: string[] }>;
  cents: boolean;
  live: boolean;
  problem: 'unresolved' | 'unpriced' | null;
  buyerNames: string[];      // the seller's buyers, suggested as a name is typed
  onChange: (drafts: Draft[]) => void;
}

const quoteOf = (line: string) => `“${line.length > 80 ? `${line.slice(0, 79)}…` : line}”`;

// The claims found, one card each, to fix before they are added: the buyer's
// name, their comment, the matched card with Change, and how many.
export function CheckClaims({ drafts, skipped, photos, cardsByKey, claimedBy, cents, live, problem, buyerNames, onChange }: Props) {
  const t = useT();
  const namesId = useId();
  // `${draft}:${item}` whose card is being changed. A claim typed by hand
  // starts with its card picker open.
  const [picking, setPicking] = useState<string | null>(() => {
    const blank = drafts.findIndex(d => d.byHand && !d.items[0]?.key);
    return blank < 0 ? null : `${blank}:0`;
  });
  const addAnother = () => { onChange([...drafts, blankDraft()]); setPicking(`${drafts.length}:0`); };

  const patchDraft = (di: number, patch: Partial<Draft>) => onChange(drafts.map((d, i) => (i === di ? { ...d, ...patch } : d)));
  const patchItem = (di: number, ii: number, patch: Partial<DraftItem>) =>
    patchDraft(di, { items: drafts[di].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });

  // Cards claimed more times than there are copies, counting earlier claims
  // first: saved ones, then these top to bottom (the first comment wins).
  const overClaimed = useMemo(() => {
    const used = new Map([...claimedBy].map(([k, v]) => [k, v.qty]));
    const out = new Set<string>();
    drafts.forEach((d, di) => d.items.forEach((it, ii) => {
      if (!it.key) return;
      const after = (used.get(it.key) ?? 0) + it.qty;
      if (after > (cardsByKey.get(it.key)?.cd.qty ?? 1)) out.add(`${di}:${ii}`);
      used.set(it.key, after);
    }));
    return out;
  }, [drafts, claimedBy, cardsByKey]);

  // Who has each card already, and who these claims would give it to.
  const draftedBy = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const d of drafts) for (const it of d.items) {
      if (!it.key) continue;
      const names = out.get(it.key) ?? [];
      if (!names.includes(d.buyer.trim() || '?')) names.push(d.buyer.trim() || '?');
      out.set(it.key, names);
    }
    return out;
  }, [drafts]);
  const statusOf = (c: CardRef): CardStatus => {
    const taken = claimedBy.get(c.key);
    const fresh = draftedBy.get(c.key);
    if (!taken && !fresh) return { text: t('claims_inv_free'), kind: 'free' };
    const left = c.cd.qty - (taken?.qty ?? 0);
    const parts = [taken?.names.join(', '), taken && left > 0 && c.cd.qty > 1 ? t('claims_inv_left', { n: left, total: c.cd.qty }) : '', fresh ? t('claims_inv_new', { names: fresh.join(', ') }) : ''];
    return { text: parts.filter(Boolean).join(' · '), kind: taken && left <= 0 ? 'taken' : 'part' };
  };
  const priceOf = (c: CardRef) => (Number.isFinite(c.cd.unitPrice) ? `${live ? '≈' : ''}${rm(c.cd.unitPrice, cents)}` : '');

  return (
    <>
      <p className="claims-intro">
        {t({ found: 'claims_check_intro', hand: 'claims_hand_intro', none: 'claims_none_found_text' }[draftsKind(drafts)])}
      </p>
      <div className="claims-drafts">
        {drafts.map((d, di) => (
          <div key={di} className="claims-draft">
            <div className="claims-draft-head">
              <TextField
                label={t('claims_buyer')} className="claims-draft-buyer" value={d.buyer} list={namesId} autoComplete="off"
                onChange={e => patchDraft(di, { buyer: e.target.value })}
              />
              <button
                type="button" className="ui-icon-btn ui-icon-btn--sm" aria-label={`${t('claims_remove_claim')} ${d.buyer.trim()}`.trim()}
                onClick={() => { setPicking(null); onChange(drafts.filter((_, i) => i !== di)); }}
              ><Icon name="close" size={16} /></button>
            </div>
            {d.comment ? <p className="claims-quote">“{d.comment}”</p> : null}
            {d.unclear ? <p className="claims-note"><Icon name="warning" size={15} />{d.unclear}</p> : null}
            {d.items.map((it, ii) => {
              const card = it.key ? cardsByKey.get(it.key) : undefined;
              const at = `${di}:${ii}`;
              const open = picking === at;
              return (
                <div key={ii} className="claims-draft-item">
                  {card ? (
                    <div className="claims-match">
                      <span className="claims-thumb">{card.cd.card.crop_b64 ? <img src={card.cd.card.crop_b64} alt="" onError={hideBroken} /> : <Icon name="photo" size={16} />}</span>
                      <span className="claims-match-text">
                        <span className="claims-match-name">{card.cd.sel.name || '?'}</span>
                        <span className="claims-match-meta">{[photos.length > 1 ? t('claims_photo', { n: card.photo }) : '', priceOf(card)].filter(Boolean).join(' · ')}</span>
                      </span>
                      <button type="button" className="ui-btn" aria-expanded={open} onClick={() => setPicking(open ? null : at)}>{t('claims_change')}</button>
                    </div>
                  ) : (
                    <div className="claims-match is-missing">
                      <Icon name="warning" size={16} />
                      <span className="claims-match-text">{it.unclear || t('claims_which_card')}{it.said ? ` (“${it.said}”)` : ''}</span>
                      <button type="button" className="ui-btn" aria-expanded={open} onClick={() => setPicking(open ? null : at)}>{t('claims_choose_card')}</button>
                    </div>
                  )}
                  {card && it.said && spelledDifferently(it.said, card.cd.sel.name || '') ? (
                    <p className="claims-note"><Icon name="warning" size={15} />{t('claims_fuzzy')}</p>
                  ) : null}
                  {open ? (
                    <CardPicker
                      photos={photos} hint={card ? card.scanId : it.hint} value={it.key} priceOf={priceOf} statusOf={statusOf}
                      onPick={key => { patchItem(di, ii, { key, unclear: '' }); setPicking(null); }}
                    />
                  ) : null}
                  {overClaimed.has(at) ? (
                    <p className="claims-note">
                      <Icon name="warning" size={15} />
                      {it.key && claimedBy.get(it.key) ? t('claims_taken_by', { names: claimedBy.get(it.key)!.names.join(', ') }) : t('claims_taken_earlier')}
                    </p>
                  ) : null}
                  <div className="claims-qty">
                    <span aria-hidden="true">{t('claims_quantity')}</span>
                    <Stepper
                      value={it.qty} min={1} onChange={qty => patchItem(di, ii, { qty })}
                      label={t('claims_quantity')} decrementLabel={t('claims_fewer')} incrementLabel={t('claims_more')}
                      onRemove={() => { setPicking(null); patchDraft(di, { items: d.items.filter((_, j) => j !== ii) }); }}
                      removeLabel={t('claims_remove_card')}
                    />
                  </div>
                </div>
              );
            })}
            <button
              type="button" className="ui-btn ui-btn--plain claims-add-card"
              onClick={() => { patchDraft(di, { items: [...d.items, { key: null, qty: 1, said: '', unclear: '', hint: null }] }); setPicking(`${di}:${d.items.length}`); }}
            ><Icon name="plus" size={16} />{t('claims_add_card')}</button>
          </div>
        ))}
      </div>
      <button type="button" className="ui-btn ui-btn--block claims-add-another" onClick={addAnother}>
        <Icon name="plus" size={18} />{t('claims_add_another')}
      </button>
      <datalist id={namesId}>{buyerNames.map(n => <option key={n} value={n} />)}</datalist>
      {skipped.length ? <p className="claims-foot-note">{counted(t, 'claims_skipped', skipped.length, { lines: skipped.map(quoteOf).join(', ') })}</p> : null}
      {problem ? <p className="claims-note">{t(problem === 'unresolved' ? 'claims_unresolved' : 'claims_unpriced')}</p> : null}
    </>
  );
}
