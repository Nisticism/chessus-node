import { useEffect } from 'react';

const SITE = 'https://gridgrove.gg';
const DEFAULT_IMAGE = `${SITE}/logo512.png`;

function setMeta(attr, key, content) {
  if (content == null) return null;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  let created = false;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
    created = true;
  }
  const prev = el.getAttribute('content');
  el.setAttribute('content', String(content));
  return { el, prev, created, attr };
}

// Per-page SEO: sets the document title, meta description, canonical URL, Open
// Graph + Twitter tags, and (optionally) a JSON-LD block. Restores prior values
// on unmount so the next route starts clean. Pass `ready=false` while data is
// still loading to avoid flashing an incomplete title/description to crawlers.
export default function useSeo({
  title,
  description,
  path,
  image,
  type = 'website',
  jsonLd,
  ready = true,
} = {}) {
  useEffect(() => {
    if (!ready) return undefined;

    const canonical = path ? SITE + (path.startsWith('/') ? path : `/${path}`) : SITE + window.location.pathname;
    const img = image || DEFAULT_IMAGE;
    const prevTitle = document.title;
    if (title) document.title = title;

    const restores = [];
    const track = (r) => { if (r) restores.push(r); };

    track(setMeta('name', 'description', description));
    track(setMeta('property', 'og:title', title));
    track(setMeta('property', 'og:description', description));
    track(setMeta('property', 'og:url', canonical));
    track(setMeta('property', 'og:type', type));
    track(setMeta('property', 'og:image', img));
    track(setMeta('name', 'twitter:title', title));
    track(setMeta('name', 'twitter:description', description));
    track(setMeta('name', 'twitter:image', img));

    // Canonical link.
    let canonicalEl = document.head.querySelector('link[rel="canonical"]');
    const prevCanonical = canonicalEl ? canonicalEl.getAttribute('href') : null;
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.setAttribute('href', canonical);

    // JSON-LD structured data.
    let ldEl = null;
    if (jsonLd) {
      ldEl = document.createElement('script');
      ldEl.type = 'application/ld+json';
      ldEl.setAttribute('data-page-seo', '1');
      try { ldEl.textContent = JSON.stringify(jsonLd); } catch (_) { ldEl = null; }
      if (ldEl) document.head.appendChild(ldEl);
    }

    return () => {
      document.title = prevTitle;
      for (const r of restores) {
        if (r.created) r.el.remove();
        else if (r.prev != null) r.el.setAttribute('content', r.prev);
      }
      if (canonicalEl && prevCanonical != null) canonicalEl.setAttribute('href', prevCanonical);
      if (ldEl) ldEl.remove();
    };
  }, [title, description, path, image, type, ready, JSON.stringify(jsonLd)]); // eslint-disable-line react-hooks/exhaustive-deps
}
