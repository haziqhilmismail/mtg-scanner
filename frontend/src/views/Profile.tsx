import { useState } from 'react';
import type { Payment } from '../api.ts';
import type { AuthUser } from '../api/auth.ts';
import { Avatar } from '../components/Avatar.tsx';
import { FeedbackModal } from '../components/FeedbackModal.tsx';
import { Icon } from '../components/Icon.tsx';
import { Link } from '../components/Link.tsx';
import { flushPaymentDelete, PaymentDetails } from '../components/PaymentDetails.tsx';
import { SupportSheet } from '../components/SupportSheet.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { useT } from '../hooks/useLang.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import { pricingSummary } from '../lib/pricingSummary.ts';
import type { Appearance, Credits, Lang } from '../types.ts';
import { creditsLine } from '../utils.ts';

interface Props {
  user: AuthUser | null;  // null in solo mode, where nobody signs in
  onSignOut?: () => void;
  status: { label: string; state: 'ok' | 'err' | null };
  credits: Credits | null;
  onRedeemVoucher?: () => void;  // set when claim reads are counted
  lang: Lang;
  setLang: (l: Lang) => void;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  pricing: PricingStore;
  payment: Payment | null;
  setPayment: (payment: Payment) => void;
}

export function Profile({ user, onSignOut, status, credits, onRedeemVoucher, lang, setLang, appearance, setAppearance, pricing, payment, setPayment }: Props) {
  const t = useT();
  const [supportOpen, setSupportOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const claimReads = creditsLine(credits, t, lang);

  return (
    <>
      <div className="review-head">
        <div className="review-title"><h1 className="page-title">{t('nav_profile')}</h1></div>
      </div>

      <div className="profile">
        <div className="profile-col">
          <section className="ui-card" aria-label={t('profile_account')}>
            <div className="profile-who">
              <Avatar user={user} className="lg" />
              <div className="profile-who-text">
                <strong className="profile-who-name">{user ? user.name || user.email : t('profile_solo_title')}</strong>
                <span className="profile-who-sub">
                  {!user ? t('profile_solo_sub') : user.name ? t('profile_google_as', { email: user.email }) : t('profile_google')}
                </span>
              </div>
              {user && onSignOut ? (
                // A delete waiting on its Undo goes first, while the session can still send it.
                <button type="button" className="ui-btn ui-btn--ink profile-signout" onClick={() => { flushPaymentDelete(); onSignOut(); }}>
                  {t('menu_sign_out')}
                </button>
              ) : null}
            </div>
            <ul className="profile-facts">
              <li className={`profile-fact ${status.state ?? ''}`} aria-live="polite">
                <span className={`status-dot ${status.state ?? ''}`} aria-hidden="true" />
                {status.label}
              </li>
              {claimReads ? (
                <li className="profile-fact">
                  <span>{claimReads}</span>
                  {onRedeemVoucher ? <button type="button" className="ui-btn ui-btn--plain profile-redeem" onClick={onRedeemVoucher}>{t('voucher_title')}</button> : null}
                </li>
              ) : null}
            </ul>
          </section>

          <PaymentDetails payment={payment} setPayment={setPayment} />
        </div>

        <div className="profile-col">
          <section className="ui-card" aria-labelledby="profile-pricing-title">
            <div className="profile-head">
              <div className="profile-head-text">
                <h2 id="profile-pricing-title" className="ui-card-title">{t('menu_default_pricing')}</h2>
                <p className="profile-pricing">{pricing.pricingKnown(null) ? pricingSummary(pricing.pricingFor(null), t) : t('profile_loading')}</p>
              </div>
              <Link className="ui-btn" to={{ page: 'profile-pricing' }}>{t('profile_pricing_edit')}</Link>
            </div>
            <p className="profile-note">{t('profile_pricing_note')}</p>
          </section>

          <section className="ui-card profile-stack" aria-labelledby="profile-prefs-title">
            <h2 id="profile-prefs-title" className="ui-card-title">{t('profile_prefs')}</h2>
            <Segmented
              label={t('menu_language')} value={lang} onChange={setLang}
              options={[{ value: 'en', label: <span lang="en">English</span> }, { value: 'ms', label: <span lang="ms">Melayu</span> }]}
            />
            <Segmented
              label={t('menu_appearance')} value={appearance} onChange={setAppearance}
              options={(['auto', 'light', 'dark'] as const).map(a => ({ value: a, label: t(`appearance_${a}`) }))}
            />
          </section>

          <section className="ui-card profile-stack" aria-labelledby="profile-help-title">
            <h2 id="profile-help-title" className="ui-card-title">{t('profile_help')}</h2>
            <div className="profile-help">
              <button type="button" className="ui-btn ui-btn--block" onClick={() => setSupportOpen(true)}><Icon name="heart" size={17} />{t('support_open')}</button>
              <button type="button" className="ui-btn ui-btn--block" onClick={() => setFeedbackOpen(true)}><Icon name="feedback" size={17} />{t('feedback_open')}</button>
            </div>
          </section>
        </div>
      </div>

      <SupportSheet open={supportOpen} onClose={() => setSupportOpen(false)} t={t} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} t={t} />
    </>
  );
}
