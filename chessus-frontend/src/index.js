import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { Provider } from 'react-redux';
import store from './store';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter } from 'react-router-dom';
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

const renderApp = () => {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
  );
};

clearAppCachesIfNeeded().finally(() => {
  renderApp();
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
