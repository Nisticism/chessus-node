import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Shared board zoom/fit logic. Sizes a board to fully fit its scroll container by
// default (fit-by-both-dimensions). The mouse wheel scrolls normally (the board when
// it overflows, the page otherwise); Ctrl/Cmd + wheel zooms the board while the
// pointer is over it, and two-finger pinch zooms on touch. Overflow scrolls INSIDE
// the container, never the page.
//
// Usage:
//   const vp = useBoardViewport({ boardWidth, boardHeight });
//   <div style={vp.frameStyle}>
//     <div ref={vp.viewportRef} className={styles.viewport} style={vp.viewportStyle}>
//       <div style={vp.contentStyle}>{/* board grid sized by vp.squareSize */}</div>
//     </div>
//     <BoardZoomControls {...vp.controlProps} />
//   </div>

const isMobile = () => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false);

function resolveNum(v, fallback) {
  if (typeof v === 'function') { try { return v(); } catch (_) { return fallback; } }
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export default function useBoardViewport({
  boardWidth,
  boardHeight,
  // Absolute max square size (px) the user can zoom IN to. Responsive default.
  maxSquare,
  // Max square size at the DEFAULT (fit) zoom, so normal boards open at a
  // comfortable size but can still be zoomed in past it. Defaults below maxSquare.
  fitMaxSquare,
  // Never shrink squares below this even for extreme boards (keeps them visible).
  minSquare = 6,
  // Height budget (px) for the fit calc. Number, () => number, or 'square'
  // (height budget = measured width). Defaults to a fraction of the viewport height.
  maxHeight,
  // Extra px reserved inside the viewport for coordinate labels / borders.
  insetW = 0,
  insetH = 0,
  // Zoom step per wheel notch / button click, as a fraction of the fit→max range.
  step = 0.18,
  // Enable Ctrl+wheel + pinch zoom.
  wheelZoom = true,
  enabled = true,
} = {}) {
  const bw = Math.max(1, Number(boardWidth) || 1);
  const bh = Math.max(1, Number(boardHeight) || 1);

  // Callback-ref pattern: the board may mount AFTER this hook first runs (e.g. behind
  // a loading gate), so we track the node in state to (re)attach observers/listeners
  // once it exists. A plain ref would never re-run the measure effect.
  const [node, setNode] = useState(null);
  const viewportRef = useCallback((el) => setNode(el), []);

  const [availW, setAvailW] = useState(0);
  const [availH, setAvailH] = useState(0);
  // Zoom position: 0 = fit (whole board visible), 1 = maxSquare.
  const [t, setT] = useState(0);

  const resolvedMax = resolveNum(maxSquare, isMobile() ? 112 : 150);
  const resolvedFitMax = Math.min(resolvedMax, resolveNum(fitMaxSquare, isMobile() ? 66 : 96));
  const defaultHeight = useCallback(
    () => Math.max(240, Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.72)),
    []
  );

  const maxHeightRef = useRef(maxHeight);
  maxHeightRef.current = maxHeight;

  // Measure the AVAILABLE space from the full-width frame (the viewport itself is
  // sized to hug the board, so measuring it would give the board width, not the
  // space available). Falls back to the node when there's no wrapping frame.
  useLayoutEffect(() => {
    if (!enabled || !node) return undefined;
    const target = node.parentElement || node;
    const measure = () => {
      const w = target.clientWidth || 0;
      const mh = maxHeightRef.current;
      const h = mh === 'square' ? w : resolveNum(mh, defaultHeight());
      setAvailW((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
      setAvailH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(target);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, node, defaultHeight]);

  // Fit square = the largest square that shows the whole board in the container.
  const fitSquare = useMemo(() => {
    if (!availW || !availH) return 0;
    const usableW = Math.max(1, availW - insetW);
    const usableH = Math.max(1, availH - insetH);
    const byW = Math.floor(usableW / bw);
    const byH = Math.floor(usableH / bh);
    return Math.max(minSquare, Math.min(resolvedFitMax, byW, byH));
  }, [availW, availH, bw, bh, minSquare, resolvedFitMax, insetW, insetH]);

  const maxSquareResolved = Math.max(fitSquare, resolvedMax);
  const canZoom = fitSquare > 0 && maxSquareResolved > fitSquare;

  const squareSize = useMemo(() => {
    if (!fitSquare) return 0;
    if (!canZoom) return fitSquare;
    const clampedT = Math.max(0, Math.min(1, t));
    return Math.round(fitSquare + clampedT * (maxSquareResolved - fitSquare));
  }, [fitSquare, maxSquareResolved, canZoom, t]);

  const atFit = !canZoom || t <= 0.0001;
  const atMax = !canZoom || t >= 0.9999;

  // Measure ACTUAL overflow per-axis from the DOM (scroll vs client) so scrollbars
  // only ever show when the board genuinely can't be seen in full, and so a plain
  // wheel over a board with NO vertical overflow scrolls the page (the viewport is
  // only made a vertical scroll container when it actually overflows vertically).
  const [overflowXState, setOverflowXState] = useState(false);
  const [overflowYState, setOverflowYState] = useState(false);
  useLayoutEffect(() => {
    if (!node) return;
    setOverflowXState(node.scrollWidth > node.clientWidth + 2);
    setOverflowYState(node.scrollHeight > node.clientHeight + 2);
  }, [node, squareSize, availW, availH]);
  const hasOverflow = overflowXState || overflowYState;

  // Pointer-anchored zoom: remember where to keep fixed, apply after the size change.
  const anchorRef = useRef(null);
  const prevSquareRef = useRef(squareSize);

  const nudge = useCallback((delta, anchor) => {
    if (!canZoom) return false;
    let changed = false;
    setT((prev) => {
      const next = Math.max(0, Math.min(1, prev + delta));
      if (next !== prev) changed = true;
      return next;
    });
    if (changed && anchor) anchorRef.current = anchor;
    return changed;
  }, [canZoom]);

  const zoomIn = useCallback(() => nudge(step), [nudge, step]);
  const zoomOut = useCallback(() => nudge(-step), [nudge, step]);
  const setFit = useCallback(() => setT(0), []);
  const setMax = useCallback(() => setT(1), []);

  useLayoutEffect(() => {
    const prev = prevSquareRef.current;
    prevSquareRef.current = squareSize;
    if (!node || !anchorRef.current || !prev || prev === squareSize) return;
    const { cx, cy } = anchorRef.current;
    anchorRef.current = null;
    const k = squareSize / prev;
    node.scrollLeft = (node.scrollLeft + cx) * k - cx;
    node.scrollTop = (node.scrollTop + cy) * k - cy;
  }, [squareSize, node]);

  // Live values for the (stable) native listeners below.
  const canZoomRef = useRef(canZoom); canZoomRef.current = canZoom;
  const tRef = useRef(t); tRef.current = t;
  const nudgeRef = useRef(nudge); nudgeRef.current = nudge;

  // Wheel: plain wheel scrolls (native); Ctrl/Cmd + wheel zooms the board. We only
  // preventDefault when actually zooming, so normal scrolling is never hijacked.
  useEffect(() => {
    if (!enabled || !wheelZoom || !node) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;      // plain wheel = normal scroll
      if (!canZoomRef.current) return;
      e.preventDefault();                        // stop the page/browser zoom
      const rect = node.getBoundingClientRect();
      const anchor = { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
      nudgeRef.current(e.deltaY < 0 ? step : -step, anchor);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [enabled, wheelZoom, node, step]);

  // Two-finger pinch zoom (touch). Single-pointer is untouched so drag-to-move and
  // tap-to-place keep working on the surfaces that use them.
  useEffect(() => {
    if (!enabled || !wheelZoom || !node) return undefined;
    const state = { pointers: new Map(), startDist: 0, startT: 0 };
    const dist = () => {
      const pts = [...state.pointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };
    const down = (e) => {
      if (e.pointerType !== 'touch') return;
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 2) { state.startDist = dist(); state.startT = tRef.current; }
    };
    const move = (e) => {
      if (e.pointerType !== 'touch' || !state.pointers.has(e.pointerId)) return;
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 2 && state.startDist > 0 && canZoomRef.current) {
        e.preventDefault();
        const ratio = dist() / state.startDist;
        setT(Math.max(0, Math.min(1, state.startT + (ratio - 1))));
      }
    };
    const up = (e) => {
      if (!state.pointers.has(e.pointerId)) return;
      state.pointers.delete(e.pointerId);
      if (state.pointers.size < 2) state.startDist = 0;
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move, { passive: false });
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    };
  }, [enabled, wheelZoom, node]);

  // Auto-scroll the board while dragging a piece near an edge, so pieces can be
  // dragged across a board that's larger than the viewport. (Native HTML5 drag
  // suppresses wheel events, so edge auto-scroll is the reliable equivalent.)
  useEffect(() => {
    if (!enabled || !node) return undefined;
    let raf = 0;
    let vx = 0;
    let vy = 0;
    const tick = () => {
      if (vx || vy) {
        node.scrollLeft += vx;
        node.scrollTop += vy;
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    const onDragOver = (e) => {
      const rect = node.getBoundingClientRect();
      const edge = 48;
      const speed = 18;
      vx = 0; vy = 0;
      if (node.scrollHeight > node.clientHeight) {
        if (e.clientY < rect.top + edge) vy = -speed;
        else if (e.clientY > rect.bottom - edge) vy = speed;
      }
      if (node.scrollWidth > node.clientWidth) {
        if (e.clientX < rect.left + edge) vx = -speed;
        else if (e.clientX > rect.right - edge) vx = speed;
      }
      if ((vx || vy) && !raf) raf = requestAnimationFrame(tick);
    };
    const stop = () => { vx = 0; vy = 0; };
    node.addEventListener('dragover', onDragOver);
    node.addEventListener('drop', stop);
    node.addEventListener('dragend', stop);
    node.addEventListener('dragleave', stop);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('drop', stop);
      node.removeEventListener('dragend', stop);
      node.removeEventListener('dragleave', stop);
    };
  }, [enabled, node]);

  const viewportStyle = useMemo(() => ({
    // Size the scroll container to hug the board's actual content (capped at the
    // available space) so the empty area around a small/narrow board is NOT part
    // of the scroll container — a wheel there scrolls the page, only a wheel over
    // the board scrolls the board. max-content avoids depending on inset estimates.
    width: availW ? 'max-content' : undefined,
    maxWidth: availW ? `${availW}px` : '100%',
    maxHeight: availH || undefined,
    // Only become a scroll container on an axis that actually overflows, so a
    // plain wheel over an axis that fits scrolls the page instead of the board.
    //
    // When NEITHER axis overflows, use `visible` rather than `hidden`. `hidden`
    // still makes the element a scroll container: the browser then swallows a
    // scroll gesture made over it instead of chaining to the page. That was
    // invisible with a mouse (the wheel path has its own handling) but on touch
    // it meant you could not scroll the page by dragging over a board that had
    // no scrollbars at all. `visible` opts out of being a scroll container
    // entirely, so the gesture reaches the page.
    //
    // Mixing `visible` with `auto` is not possible - the spec computes a
    // `visible` axis to `auto` as soon as the other axis is auto/hidden/scroll -
    // so once either axis overflows we keep the auto/hidden pair.
    overflowX: hasOverflow ? (overflowXState ? 'auto' : 'hidden') : 'visible',
    overflowY: hasOverflow ? (overflowYState ? 'auto' : 'hidden') : 'visible',
    // Contain the scroll chain only on the axis that scrolls; letting the other
    // axis chain to the page fixes wheel "sticking" when paused over the board.
    overscrollBehaviorX: overflowXState ? 'contain' : 'auto',
    overscrollBehaviorY: overflowYState ? 'contain' : 'auto',
  }), [availW, availH, overflowXState, overflowYState, hasOverflow]);

  const contentStyle = useMemo(() => ({
    // Hug the board so the viewport's max-content width measures the real content.
    width: 'max-content',
    // Deliberately NOT capped at 100%. Capping it meant a zoomed board could
    // never be wider than its own viewport, so the overflow happened inside the
    // board element instead - where `overflow: clip` (kept for the rounded
    // corners) swallowed it without ever reaching the viewport's scrollWidth.
    // The per-axis overflow check below then concluded there was nothing to
    // scroll and set overflow-x: hidden, which clipped the board horizontally
    // even when there was room on the page for it. The viewport has its own
    // maxWidth, so letting the content exceed it is exactly what should produce
    // a scrollbar.
    maxWidth: 'none',
    margin: '0 auto',
  }), []);

  // Controls sit BELOW the board by default, or to the SIDE for tall/skinny boards
  // (never overlapping the board).
  const placement = bh > bw * 1.3 ? 'side' : 'below';
  const frameStyle = useMemo(() => ({
    position: 'relative',
    display: 'flex',
    flexDirection: placement === 'side' ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
    minWidth: 0,
  }), [placement]);

  return {
    squareSize,
    fitSquare,
    maxSquare: maxSquareResolved,
    canZoom,
    atFit,
    atMax,
    overflow: hasOverflow,
    // Hide scrollbars while the board fully fits; show them when zoomed in.
    hideScrollbars: !hasOverflow,
    zoomIn,
    zoomOut,
    setFit,
    setMax,
    viewportRef,
    viewportStyle,
    contentStyle,
    frameStyle,
    placement,
    controlProps: { zoomIn, zoomOut, setFit, atFit, atMax, canZoom, placement },
    aspect: bw >= bh ? 'wide' : 'tall',
  };
}
