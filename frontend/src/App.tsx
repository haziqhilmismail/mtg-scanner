import { useCallback, useEffect, useState } from 'react';
import { fetchCredits, fetchHealth, type Health } from './api.ts';
import { formatRelativeTime } from './utils.ts';
import { DialogProvider, useDialog } from './components/DialogProvider.tsx';
import { FloatingBackToTop } from './components/FloatingBackToTop.tsx';
import { Header } from './components/Header.tsx';
import { ImageZoomProvider } from './components/ImageZoomProvider.tsx';
import { VoucherSheet } from './components/VoucherSheet.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { TProvider, useLang } from './hooks/useLang.ts';
import { NavProvider, useNav } from './hooks/useNav.ts';
import { usePayment } from './hooks/usePayment.ts';
import { usePricing } from './hooks/usePricing.ts';
import { useScanner } from './hooks/useScanner.ts';
import { useTheme } from './hooks/useTheme.ts';
import type { Appearance, Credits, Lang } from './types.ts';
import { Claims } from './views/Claims.tsx';
import { Login } from './views/Login.tsx';
import { PricingPage } from './views/PricingPage.tsx';
import { Profile } from './views/Profile.tsx';
import { Scanner } from './views/scanner/Scanner.tsx';
import type { T } from './hooks/useLang.ts';

export default function App() {
  const { appearance, setAppearance } = useTheme();
  const { lang, setLang, t } = useLang();
  const auth = useAuth();
  const { signInWithCredential } = auth;
  const onCredential = useCallback(
    (c: string) => { signInWithCredential(c).catch(() => { /* shown in error */ }); },
    [signInWithCredential],
  );

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // While bootstrapping auth: show a blank shell with the theme/lang controls.
  // While unauthenticated with auth enabled: show the Google login screen.
  if (auth.status === 'loading') {
    return <div className="auth-bootstrap" aria-busy="true" />;
  }
  if (auth.status === 'unauthenticated' && auth.config?.auth_enabled) {
    return (
      <TProvider value={t}>
      <DialogProvider>
        <Login
          clientId={auth.config.google_client_id}
          onCredential={onCredential}
          error={auth.error}
          lang={lang}
          setLang={setLang}
          t={t}
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
    <TProvider value={t}>
      <Workspace
        key={auth.user?.id ?? 'none'}
        auth={auth}
        lang={lang}
        setLang={setLang}
        t={t}
        appearance={appearance}
        setAppearance={setAppearance}
      />
    </TProvider>
  );
}

interface WorkspaceProps {
  auth: ReturnType<typeof useAuth>;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: T;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
}

function Workspace({ auth, lang, setLang, t, appearance, setAppearance }: WorkspaceProps) {
  const pricing = usePricing();
  const scanner = useScanner(auth.user?.id ?? null, auth.signOut);

  const navStore = useNav();
  const { route, replace } = navStore;
  const page = route.page;
  // A post, a photo and a post's pricing sit under Scanner.
  const onScanner = page === 'posts' || page === 'post' || page === 'photo' || page === 'pricing';
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);

  useEffect(() => {
    fetchHealth().then(
      h => { setHealth(h); setHealthErr(!h.ok || !!h.cardkingdom_error); },
      () => { setHealth(null); setHealthErr(true); },
    );
  }, []);

  // Credit balance, shown under Find Claims. Refetched whenever a scan
  // finishes too: with the Gemini scanner on, a scan costs a credit.
  const [credits, setCredits] = useState<Credits | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);

  // How buyers pay this seller: on a failed load, buyer messages go without it.
  const payments = usePayment();
  const scansDone = scanner.scanProgress?.done ?? -1;
  useEffect(() => {
    fetchCredits().then(setCredits, () => { /* balance line just stays hidden */ });
  }, [scansDone]);

  const healthLabel = (() => {
    if (!health && !healthErr) return t('ck_checking');
    if (!health && healthErr) return t('ck_unreachable');
    // When the index loaded successfully, append the refresh-age so users
    // can decide whether their prices are stale enough to manually refresh.
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
      {/* Both tabs stay mounted, so switching shows them at once instead of
          loading again; the one not showing renders nothing. */}
      <Scanner
        active={onScanner}
        scanner={scanner}
        nav={navStore}
        pricing={pricing}
        health={health}
        t={t}
        lang={lang}
      />
      <Claims
        active={page === 'claims'}
        scanner={scanner}
        pricing={pricing}
        t={t}
        lang={lang}
        folderKey={page === 'claims' ? route.folder : null}
        onFolderChange={key => replace({ page: 'claims', folder: key })}
        credits={credits}
        onCredits={setCredits}
        payment={payments.payment}
        onEnterVoucher={() => setVoucherOpen(true)}
      />
      {page === 'profile' ? (
        <Profile
          user={auth.config?.auth_enabled ? auth.user : null}
          // Waiting edits go first: request() reads the token before it awaits.
          onSignOut={auth.config?.auth_enabled ? () => { scanner.flush(); pricing.flush(); auth.signOut(); } : undefined}
          status={{ label: healthLabel, state: healthState }}
          credits={credits}
          lang={lang}
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
          title={t('menu_default_pricing')}
          crumbs={[{ label: t('nav_profile'), to: { page: 'profile' } }, { label: t('menu_default_pricing') }]}
          pricing={pricing}
          health={health}
          t={t}
        />
      ) : null}

      <footer className="foot">
        <span>{t('footer_left')}</span>
        <span>{t('footer_right')} · <a href="/privacy.html">{t('privacy_link')}</a></span>
      </footer>
    </main>
    <Notice source={scanner} t={t} />
    <Notice source={pricing} t={t} />
    <FloatingBackToTop />
    <VoucherSheet
      open={voucherOpen}
      onClose={() => setVoucherOpen(false)}
      onRedeemed={setCredits}
      t={t}
    />
    </ImageZoomProvider>
    </DialogProvider>
    </NavProvider>
  );
}

// Tells the user when something done in the background (a scan, a save)
// failed. `notice` is a string key.
function Notice({ source, t }: { source: { notice: string | null; clearNotice: () => void }; t: T }) {
  const dialog = useDialog();
  const { notice, clearNotice } = source;
  useEffect(() => {
    if (!notice) return;
    clearNotice();
    dialog.alert({ title: t('alert_error_title'), message: t(notice) });
  }, [notice, clearNotice, dialog, t]);
  return null;
}
