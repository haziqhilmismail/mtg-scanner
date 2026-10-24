// The sign-in page's Claims demo: a screenshot of comments on the sample
// photo, the claims found in it, and the message for each buyer.

import { useEffect, useRef, useState } from 'react';
import { DEMO_COMMENTS, demoMessage, totalOf } from '../../data/demoClaims.ts';
import { DEMO_IMAGE_URL } from '../../data/demoScan.ts';
import { useT } from '../../hooks/useLang.ts';
import { initials } from '../../utils.ts';
import { Icon } from '../Icon.tsx';
import { Segmented } from '../ui/Segmented.tsx';

const READ_MS = 1100;
const buyers = DEMO_COMMENTS.filter(c => c.cards.length);
const skipped = DEMO_COMMENTS.filter(c => !c.cards.length);

export function DemoFindClaims() {
  const t = useT();
  const [stage, setStage] = useState<'idle' | 'reading' | 'found'>('idle');
  const [who, setWho] = useState(buyers[0].name);
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const find = () => {
    root.current?.focus();
    setStage('reading');
    timer.current = window.setTimeout(() => setStage('found'), READ_MS);
  };
  const reset = () => { clearTimeout(timer.current); root.current?.focus(); setStage('idle'); setWho(buyers[0].name); setCopied(null); };
  const buyer = buyers.find(b => b.name === who)!;
  const message = demoMessage(buyer, t);
  const copy = () => navigator.clipboard?.writeText(message).then(() => setCopied(who), () => { /* blocked: nothing to show */ });

  return (
    // The pressed button goes away, so focus stays on the demo, not the page.
    <div className="demo" ref={root} tabIndex={-1}>
      <p className="demo-intro">{t('lp_claims_intro')}</p>
      <figure className="demo-shot" aria-label={t('lp_claims_shot')}>
        <img className="demo-shot-photo" src={DEMO_IMAGE_URL} alt="" />
        <ul className="demo-comments">
          {DEMO_COMMENTS.map(c => (
            <li key={c.name} className="demo-comment">
              <span className="avatar" aria-hidden="true">{initials(c.name)}</span>
              <span className="demo-comment-body">
                <span className="demo-bubble"><strong>{c.name}</strong>{c.text}</span>
                <span className="demo-comment-time">{c.time}</span>
              </span>
              {stage === 'found' ? (
                <span className={c.cards.length ? 'ui-chip ui-chip--green' : 'ui-chip'}>
                  {c.cards.length ? `RM${totalOf(c)}` : t('lp_claims_skipped')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </figure>

      {stage === 'idle' ? (
        <button type="button" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block demo-find" onClick={find}>
          <Icon name="search" size={19} />{t('lp_claims_find')}
        </button>
      ) : null}
      {stage === 'reading' ? (
        <p className="demo-reading" role="status"><span className="demo-dot" aria-hidden="true" />{t('lp_claims_reading')}</p>
      ) : null}
      {stage === 'found' ? (
        <div className="demo-found">
          <p className="demo-found-head" role="status">
            <strong>{t('lp_claims_found', { n: buyers.length, total: buyers.reduce((sum, b) => sum + totalOf(b), 0) })}</strong>
            <span>{t('lp_claims_skipped_n', { n: skipped.length })}</span>
          </p>
          <Segmented aria-label={t('lp_claims_buyer')} value={who} onChange={setWho} options={buyers.map(b => ({ value: b.name, label: b.name }))} />
          <p className="demo-message">{message}</p>
          <button type="button" className={copied === who ? 'ui-btn ui-btn--block demo-copied' : 'ui-btn ui-btn--block'} onClick={copy}>
            <Icon name={copied === who ? 'check' : 'copy'} size={17} />{t(copied === who ? 'lp_claims_copied' : 'lp_claims_copy')}
          </button>
          <p className="demo-note">{t('lp_claims_note', { name: skipped.map(c => c.name).join(', ') })}</p>
          <button type="button" className="ui-btn ui-btn--plain demo-reset" onClick={reset}>{t('lp_claims_reset')}</button>
        </div>
      ) : null}
    </div>
  );
}
