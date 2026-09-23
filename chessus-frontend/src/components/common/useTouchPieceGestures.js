import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * How a finger works on every board on the site. One hook, so the boards
 * cannot drift apart again - they had, into three different touch models, and
 * on several of them a swipe could not scroll a zoomed board at all.
 *
 * THE RULES
 *
 *   swipe                      scrolls the board and the page, wherever it
 *                              starts, unless it starts on a lifted piece
 *   tap a piece                reveals its hover styles; tapping one of your
 *                              own pieces lifts it (the board's click path)
 *   press a lifted piece       drags it straight away - no long press
 *   long-press your piece      lifts it and drags from that same press
 *   tap, then tap a square     moves there (the board's click path)
 *
 * HOW THE BOARD TAKES PART
 *
 * The board marks the element that carries each piece:
 *
 *   data-piece-key="..."       any piece; the value is the board's own key
 *   data-piece-own="1"         a piece this user may move right now
 *   data-piece-lifted="1"      the piece that is picked up
 *
 * index.css gives [data-piece-lifted="1"] `touch-action: none`, which is what
 * lets a lifted piece drag without the browser deciding it was a scroll. A
 * long press cannot use that - touch-action is fixed when the finger lands -
 * so after a hold this hook cancels the touchmoves instead, which the browser
 * honours as long as it has not started scrolling, and it has not: the finger
 * was still.
 *
 * The board then supplies whichever callbacks it needs. Boards that already
 * run their own drag (the live game's touch handlers, the puzzle board's
 * pointer handlers) only need onLift, to pick the piece up when a hold
 * completes; the real events that follow drive the rest. A board with no touch
 * drag of its own supplies onDragMove / onDrop and this hook drives it.
 *
 *   onTap(info)                a tap on any piece, before the click that follows
 *   onLift(info, point)        a hold completed on a piece the user may move
 *   onDragStart(info, point)   a drag began (after a hold, or off a lifted piece)
 *   onDragMove(point)
 *   onDrop(info, point)        the finger lifted mid-drag
 *   onCancel()                 the drag was abandoned (a second finger, a cancel)
 *
 * `info` is { key, own, lifted, el }, read from the data attributes.
 */

const HOLD_MS = 320;
const SLOP_PX = 10;

const readInfo = (target) => {
  const el = target && target.closest ? target.closest('[data-piece-key]') : null;
  if (!el) return null;
  return {
    key: el.getAttribute('data-piece-key'),
    own: el.getAttribute('data-piece-own') === '1',
    lifted: el.getAttribute('data-piece-lifted') === '1',
    el,
  };
};

export default function useTouchPieceGestures(boardRef, options = {}) {
  // Latest callbacks without re-binding the native listeners on every render.
  const opts = useRef(options);
  opts.current = options;
  const enabled = options.enabled !== false;

  // The board element can mount after its data loads, so follow the node
  // itself rather than binding once to whatever the ref held at first.
  const [node, setNode] = useState(null);
  // Every render, deliberately: a ref changing does not re-render, so a deps
  // list would never see the new node. The comparison makes it a no-op.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (boardRef.current !== node) setNode(boardRef.current);
  });

  useEffect(() => {
    if (!enabled || !node) return undefined;

    const holdMs = opts.current.holdMs || HOLD_MS;
    let mode = 'idle';           // idle | pending | armed | tap | drag | scroll
    let info = null;
    let start = null;
    let timer = null;
    let swallowClickUntil = 0;
    let lastTouchAt = 0;

    const call = (name, ...args) => {
      const fn = opts.current[name];
      if (typeof fn === 'function') fn(...args);
    };
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const reset = () => { clearTimer(); mode = 'idle'; info = null; start = null; };
    const pointOf = (t) => ({ clientX: t.clientX, clientY: t.clientY, x: t.clientX, y: t.clientY });
    const far = (t) => start && (Math.abs(t.clientX - start.clientX) > SLOP_PX
      || Math.abs(t.clientY - start.clientY) > SLOP_PX);

    const beginDrag = (point) => {
      mode = 'drag';
      call('onDragStart', info, point);
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) {
        // A second finger is a pinch, never a drag.
        if (mode === 'drag') call('onCancel');
        reset();
        return;
      }
      reset();
      lastTouchAt = Date.now();
      const t = e.touches[0];
      info = readInfo(e.target);
      start = pointOf(t);
      if (!info) return;
      if (info.own && info.lifted) {
        mode = 'armed';
      } else if (info.own) {
        mode = 'pending';
        timer = setTimeout(() => {
          timer = null;
          if (mode !== 'pending') return;
          // Held still long enough: pick it up and drag from here.
          call('onLift', info, start);
          if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) { /* optional */ } }
          beginDrag(start);
        }, holdMs);
      } else {
        mode = 'tap';
      }
    };

    const onTouchMove = (e) => {
      if (mode === 'idle' || mode === 'scroll') return;
      const t = e.touches[0];
      if (!t) return;
      if (mode === 'pending' || mode === 'tap') {
        // Moved before the hold completed: this was a scroll all along.
        if (far(t)) { clearTimer(); mode = 'scroll'; }
        return;
      }
      // armed or drag: the finger belongs to the piece, not the page.
      if (e.cancelable) e.preventDefault();
      if (mode === 'armed') {
        if (!far(t)) return;
        beginDrag(pointOf(t));
      }
      call('onDragMove', pointOf(t));
    };

    const onTouchEnd = (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (mode === 'drag') {
        call('onDrop', info, t ? pointOf(t) : start);
        // A drop is not also a tap on wherever the finger came up.
        swallowClickUntil = Date.now() + 450;
      } else if ((mode === 'pending' || mode === 'armed' || mode === 'tap') && info) {
        call('onTap', info);
      }
      reset();
    };

    const onTouchCancel = () => {
      if (mode === 'drag') call('onCancel');
      reset();
    };

    // Android opens a context menu on a long press, and iOS a callout.
    const onContextMenu = (e) => {
      if (mode === 'pending' || mode === 'drag' || Date.now() < swallowClickUntil) e.preventDefault();
    };
    /*
     * Boards drag with HTML5 `draggable` for the mouse, and Chrome on Android
     * and Windows will start a NATIVE drag from a long press on a draggable
     * element - which would take the finger away from the rules above. A drag
     * that begins while a finger is down, or just after, is the finger's.
     */
    const onDragStartCapture = (e) => {
      if (mode !== 'idle' || Date.now() - lastTouchAt < 1500) { e.preventDefault(); e.stopPropagation(); }
    };
    const onClickCapture = (e) => {
      if (Date.now() < swallowClickUntil) { e.stopPropagation(); e.preventDefault(); }
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', onTouchCancel);
    node.addEventListener('contextmenu', onContextMenu);
    node.addEventListener('click', onClickCapture, true);
    node.addEventListener('dragstart', onDragStartCapture, true);
    return () => {
      clearTimer();
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
      node.removeEventListener('contextmenu', onContextMenu);
      node.removeEventListener('click', onClickCapture, true);
      node.removeEventListener('dragstart', onDragStartCapture, true);
    };
  }, [node, enabled]);
}
