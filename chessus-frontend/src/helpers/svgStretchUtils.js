/**
 * SVG images have a preserveAspectRatio attribute that forces them to maintain
 * their aspect ratio regardless of CSS sizing. For non-square multi-tile pieces,
 * we need to patch SVGs to use preserveAspectRatio="none" so they stretch.
 * 
 * This utility provides:
 * - isSvgUrl(url): detect if a URL points to an SVG
 * - applySvgStretchBackground(element, imageUrl): set a background-image on a DOM element,
 *   patching SVGs to disable preserveAspectRatio
 */

// Cache patched SVG blob URLs to avoid re-fetching
const svgCache = new Map();

export function isSvgUrl(url) {
  if (!url) return false;
  return url.includes('image/svg') || url.toLowerCase().includes('.svg');
}

/**
 * Apply a stretched background image to a DOM element.
 * For SVGs, fetches and patches preserveAspectRatio="none".
 * For other formats, just sets background-image directly.
 */
export function applySvgStretchBackground(el, imageUrl) {
  if (!el || !imageUrl) return;

  if (isSvgUrl(imageUrl)) {
    // Check cache first
    if (svgCache.has(imageUrl)) {
      setBackground(el, svgCache.get(imageUrl));
      return;
    }

    fetch(imageUrl)
      .then(r => r.text())
      .then(svgText => {
        let patched = svgText.replace(/preserveAspectRatio="[^"]*"/g, '');
        patched = patched.replace(/<svg/, '<svg preserveAspectRatio="none"');
        const blob = new Blob([patched], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        svgCache.set(imageUrl, url);
        setBackground(el, url);
      })
      .catch(err => {
        console.error('SVG patch failed:', err);
        // Fallback: use original URL
        setBackground(el, imageUrl);
      });
  } else {
    setBackground(el, imageUrl);
  }
}

function setBackground(el, url) {
  el.style.setProperty('background-image', `url("${url}")`, 'important');
  el.style.setProperty('background-size', '100% 100%', 'important');
  el.style.setProperty('background-repeat', 'no-repeat', 'important');
}
