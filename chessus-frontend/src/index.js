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
const patchGoogleIdentityServices = () => {
  const id = window?.google?.accounts?.id;
  if (!id) return;

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
