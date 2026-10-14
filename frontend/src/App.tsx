import { useCallback, useEffect, useState } from 'react';
import { fetchCredits, fetchHealth, type Health } from './api.ts';
import { formatRelativeTime } from './utils.ts';
import { DialogProvider, useDialog } from './components/DialogProvider.tsx';
import { FloatingBackToTop } from './components/FloatingBackToTop.tsx';
import { Header } from './components/Header.tsx';
import { ImageZoomProvider } from './components/ImageZoomProvider.tsx';
import { TopTabs } from './components/TopTabs.tsx';
import { VoucherSheet } from './components/VoucherSheet.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { useLang } from './hooks/useLang.ts';
import { usePersistedState } from './hooks/usePersistedState.ts';
import { useScanner, type ScannerStore } from './hooks/useScanner.ts';
import { useSettings } from './hooks/useSettings.ts';
import { useTheme } from './hooks/useTheme.ts';
import type { Appearance, Credits, Lang } from './types.ts';
import { Checklist } from './views/Checklist.tsx';
import { Claims } from './views/Claims.tsx';
import { Login } from './views/Login.tsx';
import { Scanner } from './views/Scanner.tsx';
import type { T } from './hooks/useLang.ts';

// 'checklist' is the page Claims replaced; still reachable from a link at the
// bottom of Claims for anyone with stock or orders in it.
type View = 'scanner' | 'claims' | 'checklist';

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
    );
  }

  // Keyed by user so signing in as someone else starts from a clean slate:
  // the scans are fetched again, with the new user's token, after sign-in.
  return (
    <Workspace
      key={auth.user?.id ?? 'none'}
      auth={auth}
      lang={lang}
      setLang={setLang}
      t={t}
      appearance={appearance}
      setAppearance={setAppearance}
    />
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
  const { settings, update: updateSetting } = useSettings();
  const scanner = useScanner();

  const [view, setView] = usePersistedState<View>('mtg.tab', 'scanner');
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);

  useEffect(() => {
    fetchHealth().then(
      h => { setHealth(h); setHealthErr(!h.ok || !!h.cardkingdom_error); },
      () => { setHealth(null); setHealthErr(true); },
    );
  }, []);

  // Scan-credit balance. Refetched whenever a scan finishes (scanProgress
  // ticks) so the line under the upload area is always current.
  const [credits, setCredits] = useState<Credits | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
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
        onSignOut={auth.config?.auth_enabled ? () => { scanner.flush(); auth.signOut(); } : undefined}
        onRedeemVoucher={credits?.enforced ? () => setVoucherOpen(true) : undefined}
      />
    <TopTabs
      view={view === 'scanner' ? 'scanner' : 'claims'}
      onChange={setView}
      scannerLabel={t('nav_scanner')}
      claimsLabel={t('nav_claims')}
    />
    <main className="wrap">
      {view === 'scanner' ? (
        <Scanner
          scanner={scanner}
          settings={settings}
          updateSetting={updateSetting}
          health={health}
          t={t}
          lang={lang}
          credits={credits}
          onEnterVoucher={() => setVoucherOpen(true)}
        />
      ) : view === 'claims' ? (
        <Claims
          scanner={scanner}
          settings={settings}
          t={t}
          onOpenOldChecklist={() => setView('checklist')}
        />
      ) : (
        <Checklist t={t} />
      )}

      <footer className="foot">
        <span>{t('footer_left')}</span>
        <span>{t('footer_right')}</span>
      </footer>
    </main>
    <ScannerNotice scanner={scanner} t={t} />
    <FloatingBackToTop />
    <VoucherSheet
      open={voucherOpen}
      onClose={() => setVoucherOpen(false)}
      onRedeemed={setCredits}
      t={t}
    />
    </ImageZoomProvider>
    </DialogProvider>
  );
}

// Tells the user when something the scanner did in the background failed.
function ScannerNotice({ scanner, t }: { scanner: ScannerStore; t: T }) {
  const dialog = useDialog();
  const { notice, clearNotice } = scanner;
  useEffect(() => {
    if (!notice) return;
    clearNotice();
    dialog.alert({ title: t('alert_error_title'), message: t(notice) });
  }, [notice, clearNotice, dialog, t]);
  return null;
}
