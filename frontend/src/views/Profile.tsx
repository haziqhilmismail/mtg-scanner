import { useEffect, useState } from 'react';
import { fetchMe, saveSellerName, type AuthUser } from '../api/auth.ts';
import { Avatar } from '../components/Avatar.tsx';
import { FeedbackModal } from '../components/FeedbackModal.tsx';
import { Icon } from '../components/Icon.tsx';
import { Link } from '../components/Link.tsx';
import { PaymentDetails } from '../components/PaymentDetails.tsx';
import { Preferences } from '../components/Preferences.tsx';
import { SupportSheet } from '../components/SupportSheet.tsx';
import { SaveField } from '../components/ui/SaveField.tsx';
import { useToast } from '../components/ui/Toast.tsx';
import { useT } from '../hooks/useLang.ts';
import type { PaymentStore } from '../hooks/usePayment.ts';
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
  payments: PaymentStore;
}

export function Profile({ user, onSignOut, status, credits, onRedeemVoucher, lang, setLang, appearance, setAppearance, pricing, payments }: Props) {
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
                  {t(user ? 'profile_google' : 'profile_solo_sub')}
                </span>
              </div>
              {user && onSignOut ? (
                <button type="button" className="ui-btn ui-btn--ink profile-signout" onClick={onSignOut}>
                  {t('menu_sign_out')}
                </button>
              ) : null}
            </div>
            <ul className="profile-facts">
              <li className={`profile-fact ${status.state ?? ''}`} aria-live="polite">
                <span className={`status-dot ${status.state ?? ''}`} aria-hidden="true" />
                <span>{status.label}</span>
              </li>
              {claimReads ? (
                <li className="profile-fact profile-fact--wrap">
                  <span>{claimReads}</span>
                  {onRedeemVoucher ? <button type="button" className="ui-btn ui-btn--plain profile-redeem" onClick={onRedeemVoucher}>{t('voucher_title')}</button> : null}
                </li>
              ) : null}
            </ul>
            <SellerName />
          </section>

          <PaymentDetails store={payments} />
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
            <Preferences lang={lang} setLang={setLang} appearance={appearance} setAppearance={setAppearance} />
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

// The name printed on drop-off slips. Loaded here, as only Profile shows it.
function SellerName() {
  const t = useT();
  const toast = useToast();
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { fetchMe().then(me => setSaved(me.seller_name), () => {}); }, []);
  if (saved === null) return null;
  return (
    <div className="profile-seller">
      <SaveField
        saved={saved} required maxLength={255} autoComplete="name"
        label={t('profile_seller_name')} saveLabel={t('profile_seller_name_save')} hint={t('profile_seller_name_hint')}
        onSave={async name => {
          try { setSaved(await saveSellerName(name)); return true; } catch { toast(t('profile_seller_name_failed')); return false; }
        }}
      />
    </div>
  );
}
