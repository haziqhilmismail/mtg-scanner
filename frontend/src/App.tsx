import { useCallback, useEffect, useState } from 'react';
import { fetchCredits, fetchHealth, paymentApi, type Health, type Payment } from './api.ts';
import { formatRelativeTime } from './utils.ts';
import { DialogProvider, useDialog } from './components/DialogProvider.tsx';
import { FloatingBackToTop } from './components/FloatingBackToTop.tsx';
import { Header } from './components/Header.tsx';
import { ImageZoomProvider } from './components/ImageZoomProvider.tsx';
import { PricingSheet } from './components/PricingSheet.tsx';
import { TopTabs } from './components/TopTabs.tsx';
import { PaymentSheet } from './components/PaymentSheet.tsx';
import { VoucherSheet } from './components/VoucherSheet.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { TProvider, useLang } from './hooks/useLang.ts';
import { useNav } from './hooks/useNav.ts';
import { usePricing } from './hooks/usePricing.ts';
import { useScanner } from './hooks/useScanner.ts';
import { useTheme } from './hooks/useTheme.ts';
import type { Appearance, Credits, Lang } from './types.ts';
import { Claims } from './views/Claims.tsx';
import { Login } from './views/Login.tsx';
import { Scanner } from './views/Scanner.tsx';
import type { T } from './hooks/useLang.ts';

export default function App() {
  const { theme, appearance, setAppearance } = useTheme();
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
          theme={theme}
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
  const { nav, go, replace, up } = navStore;
  const view = nav.view;
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

  // How buyers pay this seller, added to every summary copied for a buyer.
  const [payment, setPayment] = useState<Payment | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  useEffect(() => {
    paymentApi.get().then(setPayment, () => { /* summaries just go without it */ });
  }, []);
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
    <DialogProvider>
    <ImageZoomProvider>
    <Header
        title={t('app_title')}
        healthLabel={healthLabel}
        healthState={healthState}
        lang={lang}
        onLangChange={setLang}
        appearance={appearance}
        onAppearanceChange={setAppearance}
        t={t}
        user={auth.config?.auth_enabled ? auth.user : null}
        // Waiting edits go first: request() reads the token before it awaits.
        onSignOut={auth.config?.auth_enabled ? () => { scanner.flush(); pricing.flush(); auth.signOut(); } : undefined}
        onRedeemVoucher={credits?.enforced ? () => setVoucherOpen(true) : undefined}
        onDefaultPricing={() => go({ sheet: 'pricing' })}
        onPaymentDetails={() => setPaymentOpen(true)}
        onHome={() => go({ view: 'scanner', folder: null, photo: null })}
      />
    <TopTabs
      view={view === 'scanner' ? 'scanner' : 'claims'}
      onChange={v => go({ view: v, photo: null })}
      scannerLabel={t('nav_scanner')}
      claimsLabel={t('nav_claims')}
    />
    <main className="wrap">
      {/* Both tabs stay mounted, so switching shows them at once instead of
          loading again; the hidden one ignores keys and paste. */}
      <div hidden={view !== 'scanner'}>
        <Scanner
          active={view === 'scanner'}
          scanner={scanner}
          nav={navStore}
          pricing={pricing}
          health={health}
          t={t}
          lang={lang}
        />
      </div>
      <div hidden={view !== 'claims'}>
        <Claims
          active={view === 'claims'}
          scanner={scanner}
          pricing={pricing}
          t={t}
          lang={lang}
          folderKey={nav.folder}
          onFolderChange={key => replace({ folder: key })}
          credits={credits}
          onCredits={setCredits}
          payment={payment}
          onEnterVoucher={() => setVoucherOpen(true)}
        />
      </div>
      <footer className="foot">
        <span>{t('footer_left')}</span>
        <span>{t('footer_right')} · <a href="/privacy.html">{t('privacy_link')}</a></span>
      </footer>
    </main>
    <Notice source={scanner} t={t} />
    <Notice source={pricing} t={t} />
    <FloatingBackToTop />
    <PaymentSheet open={paymentOpen} onClose={() => setPaymentOpen(false)} payment={payment} onSaved={setPayment} t={t} />
    <VoucherSheet
      open={voucherOpen}
      onClose={() => setVoucherOpen(false)}
      onRedeemed={setCredits}
      t={t}
    />
    {/* A history level (see useNav), so back closes it instead of changing the page under it. */}
    <PricingSheet open={nav.sheet === 'pricing'} onClose={up} pricing={pricing} health={health} t={t} />
    </ImageZoomProvider>
    </DialogProvider>
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
