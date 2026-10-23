import { useState } from 'react';
import type { Payment } from '../api.ts';
import type { AuthUser } from '../api/auth.ts';
import { Avatar } from '../components/Avatar.tsx';
import { FeedbackModal } from '../components/FeedbackModal.tsx';
import { PaymentSheet } from '../components/PaymentSheet.tsx';
import { PricingRow } from '../components/SettingsPanel.tsx';
import { SupportSheet } from '../components/SupportSheet.tsx';
import { useT } from '../hooks/useLang.ts';
import type { PricingStore } from '../hooks/usePricing.ts';
import type { Appearance, Lang } from '../types.ts';

interface Props {
  // null in solo mode, where nobody signs in.
  user: AuthUser | null;
  onSignOut?: () => void;
  status: { label: string; state: 'ok' | 'err' | null };
  lang: Lang;
  setLang: (l: Lang) => void;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  pricing: PricingStore;
  payment: Payment | null;
  onPaymentSaved: (payment: Payment) => void;
  // Set when claim reads are counted for this account.
  onRedeemVoucher?: () => void;
}

const LANGS: Lang[] = ['en', 'ms'];
const APPEARANCES: Appearance[] = ['auto', 'light', 'dark'];

// The account and its settings: what the bar's menu used to hold, as plain
// sections.
export function Profile({ user, onSignOut, status, lang, setLang, appearance, setAppearance, pricing, payment, onPaymentSaved, onRedeemVoucher }: Props) {
  const t = useT();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <div className="review-head">
        <div className="review-title"><h1 className="page-title">{t('nav_profile')}</h1></div>
      </div>

      {user ? (
        <section className="panel profile-account">
          <Avatar user={user} className="lg" />
          <div className="profile-account-text">
            <strong>{user.name || user.email}</strong>
            {user.name ? <span>{user.email}</span> : null}
            <span>{t('profile_google')}</span>
          </div>
          {onSignOut ? <button type="button" className="profile-signout" onClick={onSignOut}>{t('menu_sign_out')}</button> : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>{t('profile_prices')}</h2>
        <p className={`profile-status ${status.state ?? ''}`}>
          <span className={`status-dot ${status.state ?? ''}`} aria-hidden="true" />
          {status.label}
        </p>
      </section>

      <section className="panel">
        <h2>{t('pay_title')}</h2>
        <p className="profile-note">{t('pay_sub')}</p>
        <button type="button" onClick={() => setPaymentOpen(true)}>{t('profile_payment_edit')}</button>
      </section>

      {pricing.pricingKnown(null) ? (
        <section className="panel">
          <PricingRow title={t('menu_default_pricing')} settings={pricing.pricingFor(null)} t={t} to={{ page: 'profile-pricing' }} />
          <p className="profile-note">{t('pricing_default_sub')}</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>{t('profile_prefs')}</h2>
        <div className="profile-pref">
          <span id="profile-lang">{t('menu_language')}</span>
          <div className="segmented" role="group" aria-labelledby="profile-lang">
            {LANGS.map(l => (
              <button key={l} type="button" className={lang === l ? 'active' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l === 'en' ? 'English' : 'Melayu'}
              </button>
            ))}
          </div>
        </div>
        <div className="profile-pref">
          <span id="profile-appearance">{t('menu_appearance')}</span>
          <div className="segmented" role="group" aria-labelledby="profile-appearance">
            {APPEARANCES.map(a => (
              <button key={a} type="button" className={appearance === a ? 'active' : ''} aria-pressed={appearance === a} onClick={() => setAppearance(a)}>
                {t(`appearance_${a}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {onRedeemVoucher ? (
        <section className="panel">
          <h2>{t('profile_credits')}</h2>
          <button type="button" onClick={onRedeemVoucher}>{t('voucher_title')}</button>
        </section>
      ) : null}

      <section className="panel">
        <h2>{t('profile_help')}</h2>
        <div className="profile-actions">
          <button type="button" onClick={() => setSupportOpen(true)}>{t('support_open')}</button>
          <button type="button" onClick={() => setFeedbackOpen(true)}>{t('feedback_open')}</button>
        </div>
      </section>

      <PaymentSheet open={paymentOpen} onClose={() => setPaymentOpen(false)} payment={payment} onSaved={onPaymentSaved} t={t} />
      <SupportSheet open={supportOpen} onClose={() => setSupportOpen(false)} t={t} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} t={t} />
    </>
  );
}
