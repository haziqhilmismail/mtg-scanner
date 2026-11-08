import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCredits } from './api/credits.ts';
import { fetchHealth, type Health } from './api/health.ts';
import { formatRelativeTime } from './utils.ts';
import { DialogProvider, useDialog } from './components/DialogProvider.tsx';
import { FloatingBackToTop } from './components/FloatingBackToTop.tsx';
import { Header } from './components/Header.tsx';
import { ImageZoomProvider } from './components/ImageZoomProvider.tsx';
import { VoucherSheet } from './components/VoucherSheet.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { TProvider, useLang, useT } from './hooks/useLang.ts';
import { NavProvider, useNav } from './hooks/useNav.ts';
import { usePayment } from './hooks/usePayment.ts';
import { usePricing } from './hooks/usePricing.ts';
import { useScanner } from './hooks/useScanner.ts';
import { useTheme } from './hooks/useTheme.ts';
import type { Appearance, Lang } from './types.ts';
import type { Credits } from './api/credits.ts';
import { Login } from './views/login/Login.tsx';
import { PricingPage } from './views/PricingPage.tsx';
import { Profile } from './views/profile/Profile.tsx';
import { Scanner } from './views/scanner/Scanner.tsx';
import type { Key } from './hooks/useLang.ts';

export default function App() {
  const { appearance, setAppearance } = useTheme();
  const { lang, setLang, t } = useLang();
  const langT = useMemo(() => ({ lang, t }), [lang, t]);
  const auth = useAuth();
  const { signInWithCredential } = auth;
  const onCredential = useCallback(
    (c: string) => { signInWithCredential(c).catch(() => { /* shown in error */ }); },
    [signInWithCredential],
  );

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  if (auth.status === 'loading') {
    return <div className="auth-bootstrap" aria-busy="true" />;
  }
  if (auth.status === 'unauthenticated' && auth.config?.auth_enabled) {
    return (
      <TProvider value={langT}>
      <DialogProvider>
        <Login
          clientId={auth.config.google_client_id}
          onCredential={onCredential}
          error={auth.error}
          setLang={setLang}
          appearance={appearance}
          setAppearance={setAppearance}
        />
      </DialogProvider>
      </TProvider>
    );
  }

  // Keyed by user so signing in as someone else starts from a clean slate:
  // the scans are fetched again, with the new user's token, after sign-in.
  return (
    <TProvider value={langT}>
      <Workspace
        key={auth.user?.id ?? 'none'}
        auth={auth}
        setLang={setLang}
        appearance={appearance}
        setAppearance={setAppearance}
      />
    </TProvider>
  );
}

interface WorkspaceProps {
  auth: ReturnType<typeof useAuth>;
  setLang: (l: Lang) => void;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
}

function Workspace({ auth, setLang, appearance, setAppearance }: WorkspaceProps) {
  const { t } = useT();
  const pricing = usePricing(auth.user?.pricing ?? null);
  // Credit balance, shown under Find Claims; each scan answers with the balance after it.
  const [credits, setCredits] = useState<Credits | null>(null);
  const scanner = useScanner(auth.user?.id ?? null, auth.signOut, setCredits);

  const navStore = useNav();
  const { route } = navStore;
  const page = route.page;
  const onProfile = page === 'profile' || page === 'profile-pricing';
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);

  useEffect(() => {
    fetchHealth().then(
      h => { setHealth(h); setHealthErr(!h.ok || !!h.cardkingdom_error); },
      () => { setHealth(null); setHealthErr(true); },
    );
  }, []);

  const [voucherOpen, setVoucherOpen] = useState(false);

  // How buyers pay this seller: on a failed load, buyer messages go without it.
  const payments = usePayment();
  useEffect(() => {
    fetchCredits().then(setCredits, () => { /* balance line just stays hidden */ });
  }, []);

  const healthLabel = (() => {
    if (!health && !healthErr) return t('ck_checking');
    if (!health && healthErr) return t('ck_unreachable');
    const since = health?.cardkingdom_refreshed_at
      ? ' · ' + formatRelativeTime(health.cardkingdom_refreshed_at, t)
      : '';
    if (health?.cardkingdom_cards) return t('ck_loaded', { n: health.cardkingdom_cards.toLocaleString() }) + since;
    if (health?.cardkingdom_error) return t('ck_error');
    return t('ck_not_loaded');
  })();
  const healthState: 'ok' | 'err' | null =
    !health && !healthErr ? null :
      (health?.cardkingdom_cards && !healthErr) ? 'ok' : healthErr ? 'err' : null;

  return (
    <NavProvider value={navStore}>
    <DialogProvider>
    <ImageZoomProvider>
    <Header route={route} healthLabel={healthLabel} healthState={healthState} user={auth.config?.auth_enabled ? auth.user : null} />
    <main className="wrap">
      {/* Stays mounted on Profile, so coming back shows the posts at once
          instead of loading again; it renders nothing meanwhile. */}
      <Scanner
        active={!onProfile}
        scanner={scanner}
        nav={navStore}
        pricing={pricing}
        claims={{ credits, onCredits: setCredits, payment: payments.payment, onEnterVoucher: () => setVoucherOpen(true) }}
      />
      {page === 'profile' ? (
        <Profile
          user={auth.config?.auth_enabled ? auth.user : null}
          sellerName={auth.user?.seller_name ?? ''}
          onSellerName={auth.setSellerName}
          // Waiting edits go first: request() reads the token before it awaits.
          onSignOut={auth.config?.auth_enabled ? () => { scanner.flush(); pricing.flush(); auth.signOut(); } : undefined}
          status={{ label: healthLabel, state: healthState }}
          credits={credits}
          setLang={setLang}
          appearance={appearance}
          setAppearance={setAppearance}
          pricing={pricing}
          payments={payments}
          onRedeemVoucher={credits?.enforced ? () => setVoucherOpen(true) : undefined}
        />
      ) : null}
      {page === 'profile-pricing' ? (
        <PricingPage
          postId={null}
          crumbs={[{ label: t('nav_profile'), to: { page: 'profile' } }, { label: t('menu_default_pricing') }]}
          parent={{ page: 'profile' }}
          pricing={pricing}
        />
      ) : null}

      <footer className="foot">
        <span>{t('footer_left')}</span>
        <span>{t('footer_right')} · <a href="/privacy.html">{t('privacy_link')}</a></span>
      </footer>
    </main>
    <Notice source={scanner} />
    <Notice source={pricing} />
    <FloatingBackToTop />
    <VoucherSheet
      open={voucherOpen}
      onClose={() => setVoucherOpen(false)}
      onRedeemed={setCredits}
    />
    </ImageZoomProvider>
    </DialogProvider>
    </NavProvider>
  );
}

function Notice({ source }: { source: { notice: Key | null; clearNotice: () => void } }) {
  const { t } = useT();
  const dialog = useDialog();
  const { notice, clearNotice } = source;
  useEffect(() => {
    if (!notice) return;
    clearNotice();
    dialog.alert({ title: t('alert_error_title'), message: t(notice) });
  }, [notice, clearNotice, dialog, t]);
  return null;
}
