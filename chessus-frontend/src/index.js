import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { Provider } from 'react-redux';
import store from './store';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './services/axios-interceptor'; // Initialize axios interceptor
import { captureLaunchParams } from './helpers/discord-launch-params';

/*
 * Before anything can navigate.
 *
 * Discord launches an activity with frame_id, instance_id and platform on the
 * URL, and this is a single-page app: the first client-side navigation replaces
 * that URL, and a query string nobody carried forward is gone. Everything the
 * activity needs depends on those three values, so they are copied out here, at
 * the top of the bundle, before React mounts or routes.
 */
captureLaunchParams();

/*
 * One line, from outside every conditional in the app.
 *
 * Every previous probe lived inside something that could decline to run - the
 * Discord hook, which only mounts if the activity renders; App's gate, which
 * only renders the activity if it recognises the launch. When the answer is
 * "none of that happened", instrumentation placed inside it cannot say so.
 *
 * This runs at the top of the bundle on every load, and speaks only when the
 * page is being served from Discord's activity proxy - a domain nothing else is
 * ever on - so it is silent for every ordinary visitor and unconditional for
 * the case being chased. It reports parameter NAMES, never values.
 */
(() => {
  try {
    /*
     * Fire anywhere that is NOT the site's own host.
     *
     * This used to test for *.discordsays.com, which assumed the activity's
     * document lives on the same host its REQUESTS come from. That is where the
     * Origin header says they come from, but the assumption was never verified
     * and it is the last thing standing between "no report" and a cause - so
     * the test is inverted: speak for any host that is not ours, which is
     * silent for every real visitor and cannot miss whatever Discord uses.
     */
    const host = window.location.hostname;
    const ours = /^(localhost|127\.0\.0\.1|(www\.)?gridgrove\.gg)$/i.test(host);
    if (ours) return;
    const names = [...new URLSearchParams(window.location.search).keys()];
    const body = JSON.stringify({
      stage: 'boot',
      message: `host=${window.location.hostname} path=${window.location.pathname}`
        + ` params=${names.join(',') || '(none)'}`
        // Which build is actually running. If the activity is being served a
        // cached bundle, this is what says so.
        + ` build=${process.env.REACT_APP_UI_CACHE_VERSION || 'unset'}`
        + ` top=${(() => { try { return window.self === window.top; } catch (_) { return 'blocked'; } })()}`,
    });
    /*
     * sendBeacon rather than fetch: it is fire-and-forget by design, is not
     * cancelled if the page navigates immediately afterwards, and - the part
     * that matters here - is not subject to the CORS preflight that would
     * otherwise have to succeed before this could be delivered.
     */
    const url = `${process.env.REACT_APP_API_URL || ''}/api/discord/diag`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
        .catch(() => {});
    }
  } catch (_) { /* a beacon that cannot be sent must never break the page */ }
})();

const UI_CACHE_VERSION = process.env.REACT_APP_UI_CACHE_VERSION || '2026-02-20-1';

const clearAppCachesIfNeeded = async () => {
  const storedVersion = localStorage.getItem('ui_cache_version');
  const hasRefreshFlag = window.location.search.includes('cacheRefreshed=1');

  if (storedVersion === UI_CACHE_VERSION) {
    if (hasRefreshFlag && window.history?.replaceState) {
      const cleanSearch = new URLSearchParams(window.location.search);
      cleanSearch.delete('cacheRefreshed');
      const queryString = cleanSearch.toString();
      const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
    return;
  }

  localStorage.setItem('ui_cache_version', UI_CACHE_VERSION);

  if ('caches' in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if (hasRefreshFlag) {
    return;
  }

  const separator = window.location.search ? '&' : '?';
  window.location.replace(`${window.location.pathname}${window.location.search}${separator}cacheRefreshed=1${window.location.hash}`);
};

// Patch Google Identity Services to fix two known issues with @react-oauth/google:
//
// 1. renderButton passes undefined values (shape, locale, click_listener, etc.) to the
//    iframe URL as the literal string "undefined", which can cause the Sign In With
//    Google button iframe to fail to load (showing chrome-error://chromewebdata/ in the
//    button's iframe container) when COOP/COEP headers are active or when Chrome enforces
//    FedCM for buttons.  We strip undefined values before forwarding to the real call.
//
// 2. initialize() is called once per mounted <GoogleLogin> component.  Navigating between
//    Login and Register causes the warning "google.accounts.id.initialize() is called
//    multiple times" and may replace the active callback.  We call the real initialize()
//    only on the first invocation but keep a live reference to the latest callback so
//    whichever page is currently showing handles the credential response correctly.
//
// The patch is idempotent (guarded by __gsiPatched) so it is safe to call multiple times.
// useLoadGsiScript removes/re-adds the script tag on cleanup (React StrictMode double-
// mount), causing onScriptLoadSuccess to fire again.  Without the guard, that would reset
// gsiInitialized and let initialize() slip through a second time, re-triggering Google's
// "called multiple times" warning.
const patchGoogleIdentityServices = () => {
  const id = window?.google?.accounts?.id;
  if (!id || id.__gsiPatched) return;
  id.__gsiPatched = true;

  // --- patch renderButton ---
  const origRenderButton = id.renderButton;
  id.renderButton = (element, options) => {
    const clean = {};
    for (const [k, v] of Object.entries(options || {})) {
      if (v !== undefined) clean[k] = v;
    }
    return origRenderButton.call(id, element, clean);
  };

  // --- patch initialize ---
  const origInitialize = id.initialize;
  let gsiInitialized = false;
  let latestCallback = null;
  id.initialize = (options) => {
    latestCallback = options.callback;
    if (!gsiInitialized) {
      gsiInitialized = true;
      return origInitialize.call(id, {
        ...options,
        callback: (response) => latestCallback?.(response),
      });
    }
    // Already initialized — callback reference is already updated above; no-op.
  };
};

const renderApp = () => {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <GoogleOAuthProvider
      clientId={process.env.REACT_APP_GOOGLE_CLIENT_ID}
      onScriptLoadSuccess={patchGoogleIdentityServices}
    >
      <Provider store={store}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <App />
        </BrowserRouter>
      </Provider>
    </GoogleOAuthProvider>
  );
};

clearAppCachesIfNeeded().finally(() => {
  renderApp();
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
