import React, { useEffect, useState } from 'react';
import styles from './boardViewport.module.scss';

const HIDE_KEY = 'hideBoardZoomWidget';

// Live subscription to the "hide zoom widget" preference. Same-tab changes are
// broadcast via a custom event dispatched from Preferences; cross-tab via storage.
export function useHideBoardZoomWidget() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === 'true'; } catch (_) { return false; }
  });
  useEffect(() => {
    const read = () => {
      try { setHidden(localStorage.getItem(HIDE_KEY) === 'true'); } catch (_) { /* ignore */ }
    };
    window.addEventListener('storage', read);
    window.addEventListener('boardZoomWidgetPrefChanged', read);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener('boardZoomWidgetPrefChanged', read);
    };
  }, []);
  return hidden;
}

const Icon = ({ name }) => {
  switch (name) {
    case 'in':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
      );
    case 'out':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
      );
    case 'fit':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
        </svg>
      );
    default:
      return null;
  }
};

// Compact zoom widget rendered BELOW the board (or to the side for tall boards) so
// it never overlaps the board. Zooming still works via Ctrl+wheel / pinch when hidden.
const BoardZoomControls = ({ zoomIn, zoomOut, setFit, atFit, atMax, canZoom, placement = 'below', className = '' }) => {
  const hidden = useHideBoardZoomWidget();
  if (hidden || !canZoom) return null;

  const pos = placement === 'side' ? 'side' : 'below';

  return (
    <div className={`${styles.controls} ${styles[pos]} ${className}`} role="group" aria-label="Board zoom">
      <button type="button" className={styles.btn} onClick={zoomOut} disabled={atFit} title="Zoom out" aria-label="Zoom out">
        <Icon name="out" />
      </button>
      <button type="button" className={styles.btn} onClick={setFit} disabled={atFit} title="Fit board" aria-label="Fit board to view">
        <Icon name="fit" />
      </button>
      <button type="button" className={styles.btn} onClick={zoomIn} disabled={atMax} title="Zoom in" aria-label="Zoom in">
        <Icon name="in" />
      </button>
    </div>
  );
};

export default BoardZoomControls;
