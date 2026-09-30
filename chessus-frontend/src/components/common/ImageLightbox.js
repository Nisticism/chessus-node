import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import styles from "./imagelightbox.module.scss";

/*
 * One image, enlarged to fit the screen. Click anywhere outside it, press
 * Escape or use the × to close.
 *
 * Rendered into document.body so it sits above whatever modal opened it, and
 * clicks inside it never reach that modal's own overlay (which would close it).
 *
 * Small images are scaled UP to fill the screen, not just shown at their own
 * size - an avatar is often smaller than the modal that already shows it, so
 * "enlarge" would otherwise change nothing. Capped at 4x, past which the
 * picture is mostly blur.
 */
const MAX_UPSCALE = 4;

const ImageLightbox = ({ src, alt, onClose, onError }) => {
  const [natural, setNatural] = useState(null);

  useEffect(() => { setNatural(null); }, [src]);
  const onLoad = useCallback((e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w && h) setNatural({ w, h });
  }, []);

  // The width alone, in CSS, so the height follows the picture's own shape and
  // the fit tracks the window (rotation, resizing) with no listener: the
  // narrowest of 4x, the screen's width, and the width at which it fills the
  // screen's height.
  const size = natural
    ? {
        width: `min(${natural.w * MAX_UPSCALE}px, calc(100vw - 32px), calc((100vh - 32px) * ${(natural.w / natural.h).toFixed(4)}))`,
        height: 'auto',
      }
    : undefined;

  useEffect(() => {
    if (!src) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [src, onClose]);

  if (!src) return null;
  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Enlarged image"}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt} className={styles.img} style={size} onLoad={onLoad} onError={onError} />
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </div>
    </div>,
    document.body
  );
};

export default ImageLightbox;
