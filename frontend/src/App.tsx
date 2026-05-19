import { useEffect, useState } from 'react';
import { fetchHealth, type Health } from './api.ts';
import { formatRelativeTime } from './utils.ts';
import { DialogProvider } from './components/DialogProvider.tsx';
import { FloatingBackToTop } from './components/FloatingBackToTop.tsx';
import { Header } from './components/Header.tsx';
import { ImageZoomProvider } from './components/ImageZoomProvider.tsx';
import { TopTabs } from './components/TopTabs.tsx';
import { useAuth } from './hooks/useAuth.ts';
import { useLang } from './hooks/useLang.ts';
import { usePersistedState } from './hooks/usePersistedState.ts';
import { useScanner } from './hooks/useScanner.ts';
import { useSettings } from './hooks/useSettings.ts';
import { useTheme } from './hooks/useTheme.ts';
import { Checklist } from './views/Checklist.tsx';
import { Login } from './views/Login.tsx';
import { Scanner } from './views/Scanner.tsx';

type View = 'scanner' | 'checklist';

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  const { settings, update: updateSetting } = useSettings();
  const scanner = useScanner();
  const auth = useAuth();

  const [view, setView] = usePersistedState<View>('mtg.view', 'scanner');
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  useEffect(() => {
    // Defer the health check until the user is authenticated — otherwise the
    // request 401s in auth-enabled mode before they've had a chance to log in.
    if (auth.status !== 'authenticated') return;
    fetchHealth().then(
      h => { setHealth(h); setHealthErr(!h.ok || !!h.cardkingdom_error); },
      () => { setHealth(null); setHealthErr(true); },
    );
  }, [auth.status]);

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
          onCredential={(c) => auth.signInWithCredential(c).catch(() => { /* shown in error */ })}
          error={auth.error}
        />
      </DialogProvider>
    );
  }

  return (
    <DialogProvider>
    <ImageZoomProvider>
    <div className="wrap">
      <Header
        title={t('app_title')}
        sub={t('app_sub')}
        healthLabel={healthLabel}
        healthState={healthState}
        lang={lang}
        onLangChange={setLang}
        theme={theme}
        onThemeToggle={toggleTheme}
        user={auth.config?.auth_enabled ? auth.user : null}
        onSignOut={auth.config?.auth_enabled ? auth.signOut : undefined}
      />

      <TopTabs
        view={view}
        onChange={setView}
        scannerLabel={t('nav_scanner')}
        checklistLabel={t('nav_checklist')}
      />

      {view === 'scanner' ? (
        <Scanner
          scanner={scanner}
          settings={settings}
          updateSetting={updateSetting}
          health={health}
          t={t}
        />
      ) : (
        <Checklist t={t} />
      )}

      <footer className="foot">
        <span>{t('footer_left')}</span>
        <span>{t('footer_right')}</span>
      </footer>
    </div>
    <FloatingBackToTop />
    </ImageZoomProvider>
    </DialogProvider>
  );
}
