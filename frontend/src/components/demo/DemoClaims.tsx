// Real comment threads (names and photos blurred) next to the claims the app
// drafts from them, so the Claims page shows its result before any words do.

import type { T } from '../../hooks/useLang.ts';
import { Icon } from '../Icon.tsx';

interface Shot { src: string; width: number; height: number }

// `card: null` is a comment the app skips.
interface Comment { said?: string; card: string | null; img?: string; price?: number }

// Phones get a phone screenshot: Facebook lays the thread out differently.
interface Example { shot: Shot; mobile: Shot; mobileNote?: string; comments: Comment[] }

// From the seller's own posts, at the prices written on the photos.
const EXAMPLES: Example[] = [
  {
    shot: { src: '/demo/claims-thread.jpg', width: 861, height: 553 },
    mobile: { src: '/demo/claims-thread-mobile.jpg', width: 815, height: 943 },
    comments: [
      { said: 'Claim victimize', card: 'Victimize', img: '/demo/claims-victimize.jpg', price: 4 },
      { said: 'claim Dark Petition', card: 'Dark Petition', img: '/demo/claims-dark-petition.jpg', price: 13 },
    ],
  },
  {
    shot: { src: '/demo/claims-thread-multi.jpg', width: 1200, height: 793 },
    mobile: { src: '/demo/claims-thread-multi-mobile.jpg', width: 815, height: 818 },
    mobileNote: 'claims_demo_mobile_note',
    comments: [
      { card: null },
      { said: 'Claim slip out the back', card: 'Slip Out the Back', img: '/demo/claims-slip-out-the-back.jpg', price: 17 },
      { said: 'Claim silundi', card: 'Silundi Vision', img: '/demo/claims-silundi-vision.jpg', price: 4 },
      { said: 'Claim Delay', card: 'Delay', img: '/demo/claims-delay.jpg', price: 9 },
      { said: 'Claim arkenstone', card: 'The Arkenstone (foil)', img: '/demo/claims-arkenstone.jpg', price: 40 },
    ],
  },
];

export function DemoClaims({ t }: { t: T }) {
  return (
    <>
      {EXAMPLES.map(ex => {
        const claims = ex.comments.filter(c => c.card);
        const total = claims.reduce((sum, c) => sum + (c.price ?? 0), 0);
        return (
          <div className="demo-claims" key={ex.shot.src}>
            <figure className="demo-claims-shot">
              <figcaption>{t('claims_demo_in')}</figcaption>
              <picture>
                <source media="(max-width: 640px)" srcSet={ex.mobile.src} width={ex.mobile.width} height={ex.mobile.height} />
                <img src={ex.shot.src} alt={t('claims_demo_in_alt')} width={ex.shot.width} height={ex.shot.height} loading="lazy" />
              </picture>
              {ex.mobileNote ? <p className="demo-claims-mobile-note">{t(ex.mobileNote)}</p> : null}
            </figure>
            <Icon name="chevronRight" size={22} className="demo-claims-arrow" />
            <div className="demo-claims-out">
              <p className="demo-claims-label">{t('claims_demo_out')}</p>
              {ex.comments.map((c, i) => c.card ? (
                <div className="demo-claims-row" key={i}>
                  <img src={c.img} alt="" width={64} height={89} loading="lazy" />
                  <span className="demo-claims-text">
                    <strong>{t('claims_demo_buyer', { n: i + 1 })}</strong>
                    <span className="demo-claims-said">“{c.said}”</span>
                    <span>{c.card} · RM{c.price}</span>
                  </span>
                </div>
              ) : (
                <p className="demo-claims-skipped" key={i}>{t('claims_demo_skipped', { n: i + 1 })}</p>
              ))}
              <p className="demo-claims-total">{t('claims_demo_total', { n: claims.length, total })}</p>
            </div>
          </div>
        );
      })}
    </>
  );
}
