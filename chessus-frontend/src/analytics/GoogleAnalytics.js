// First-party, privacy-friendly analytics (replaced Google Analytics / react-ga4).
// Sends anonymous page-view beacons to our OWN backend: no third-party scripts,
// no cross-site cookies, and not blocked by ad/tracker blockers. We store only a
// random visitor id, the page path, referrer/UTM source, whether the visitor is
// logged in, and a coarse country derived server-side from IP (the IP itself is
// never stored). Granular product events are intentionally NOT collected.

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// Random first-party visitor id (localStorage). Not tied to identity — lets us
// count unique visitors/sessions without cookies or PII.
function getVisitorId() {
  try {
    let id = localStorage.getItem('ggVisitorId');
    if (!id) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem('ggVisitorId', id);
    }
    return id;
  } catch (_) { return null; }
}

let _firstView = true;

// initGA name kept so existing imports don't need to change.
export const initGA = () => { getVisitorId(); };

// Send an anonymous page-view beacon to our own backend.
export const trackPageView = (path /*, title */) => {
  try {
    const params = new URLSearchParams(window.location.search || '');
    let userId = null;
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      if (u && (u.id || u.user_id)) userId = u.id || u.user_id;
    } catch (_) { /* ignore */ }
    const payload = {
      path: String(path || window.location.pathname || '/').split('?')[0].slice(0, 300),
      visitorId: getVisitorId(),
      referrer: _firstView ? String(document.referrer || '').slice(0, 300) : '',
      utmSource: (params.get('utm_source') || '').slice(0, 100),
      utmMedium: (params.get('utm_medium') || '').slice(0, 100),
      utmCampaign: (params.get('utm_campaign') || '').slice(0, 100),
      isAuthenticated: !!localStorage.getItem('user'),
      userId,
    };
    _firstView = false;
    const url = `${API_URL}/api/analytics/pageview`;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch (_) { /* analytics must never break the app */ }
};

// Legacy event stubs — kept so existing imports keep working. We intentionally
// don't collect granular product events, only aggregate traffic/usage.
const _noop = () => {};
export const trackEvent = _noop;
export const trackUserInteraction = _noop;
export const trackGameCreation = _noop;
export const trackPieceCreation = _noop;
export const trackGamePlay = _noop;
export const trackRegistration = _noop;
export const trackLogin = _noop;
export const trackLogout = _noop;
export const trackForumActivity = _noop;
export const trackDonation = _noop;
export const trackSocialClick = _noop;
export const trackError = _noop;
export const trackSearch = _noop;
export const trackProfileView = _noop;

const analytics = {
  initGA,
  trackPageView,
  trackEvent,
  trackUserInteraction,
  trackGameCreation,
  trackPieceCreation,
  trackGamePlay,
  trackRegistration,
  trackLogin,
  trackLogout,
  trackForumActivity,
  trackDonation,
  trackSocialClick,
  trackError,
  trackSearch,
  trackProfileView,
};

export default analytics;
