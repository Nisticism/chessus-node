/*
 * The parameters Discord launches an activity with, kept safe.
 *
 * Discord puts frame_id, instance_id and platform on the URL when it opens an
 * activity, and everything downstream depends on them: the SDK constructor
 * throws without all three, and the app decides whether to render the activity
 * at all by looking for frame_id.
 *
 * Reading them from window.location whenever they happen to be needed is
 * fragile. This is a single-page app - any client-side navigation replaces the
 * URL, and a query string that is not carried forward is simply gone. The code
 * that needs these values runs after React has mounted and possibly routed, by
 * which point the only copy may already have been thrown away.
 *
 * So they are captured once, as early as the bundle runs, and kept for the
 * session. sessionStorage rather than module state because a reload inside the
 * activity - which Discord can do - starts a new module instance but the same
 * tab, and the reloaded URL may not carry the parameters either.
 */

const KEY = 'gg:discord:launch-params';

/** The parameter names that matter. Presence of frame_id is the signal. */
const REQUIRED = ['frame_id', 'instance_id', 'platform'];

/*
 * Also worth keeping, though nothing breaks without it.
 *
 * custom_id is the id of the button that launched the activity, which is how a
 * daily post says WHICH puzzle it was about. It has to survive the same
 * navigations the three above do, or a post from last week quietly opens
 * today's puzzle - the failure it exists to prevent.
 */
const OPTIONAL = ['custom_id'];

/**
 * Remember this launch's parameters, if this looks like a launch.
 *
 * Call as early as possible - before anything can navigate. Safe to call more
 * than once; a launch URL always wins over a stored one, so a fresh launch
 * replaces a stale instance rather than inheriting it.
 */
export function captureLaunchParams() {
  try {
    const search = window.location.search || '';
    const params = new URLSearchParams(search);
    if (!params.get('frame_id')) return;
    const keep = new URLSearchParams();
    for (const name of [...REQUIRED, ...OPTIONAL]) {
      const v = params.get(name);
      if (v) keep.set(name, v);
    }
    window.sessionStorage.setItem(KEY, keep.toString());
  } catch (_) {
    // Storage unavailable. The live URL still works for the common case; this
    // is a safety net, not a dependency.
  }
}

/**
 * This launch's parameters: whatever is on the URL now, else what was captured.
 *
 * @returns {URLSearchParams}
 */
export function getLaunchParams() {
  const live = new URLSearchParams(window.location.search || '');
  if (live.get('frame_id')) return live;
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (stored) {
      const params = new URLSearchParams(stored);
      if (params.get('frame_id')) return params;
    }
  } catch (_) { /* fall through to the live (empty) params */ }
  return live;
}

/** Whether this page is running as a Discord activity. */
export function isDiscordLaunch() {
  return !!getLaunchParams().get('frame_id');
}

/**
 * Which puzzle this launch is about, when the launch names one.
 *
 * The daily post's Play button carries `gridgrove:play-daily:<puzzle id>`, and
 * Discord passes that custom_id through to the activity. A post is permanent
 * and a schedule is not, so the id in the button is the only thing that still
 * means the same puzzle a week later.
 *
 * Returns null for a launch with no id - the app shelf, an older post, a button
 * from before this existed - and the caller then asks for today's, which is
 * what all of those mean.
 *
 * @returns {number|null}
 */
export function launchedPuzzleId() {
  const raw = String(getLaunchParams().get('custom_id') || '');
  /*
   * Deliberately loose about the shape around the number. The contract is the
   * prefix and a trailing id, and an anchored match would hand back null over a
   * separator or a suffix - which is indistinguishable, from the player's side,
   * from the bug this exists to fix.
   */
  const m = /play-daily[:\-_](\d+)/.exec(raw);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Put the launch parameters back on the URL if they have been lost.
 *
 * The Discord SDK reads window.location.search directly and cannot be handed
 * values, so restoring what was captured is the only way to let it start after
 * a navigation has stripped them. replaceState rather than a router navigation:
 * it changes the address without a re-render or a history entry.
 *
 * @returns {boolean} whether anything was restored.
 */
export function restoreLaunchParamsToUrl() {
  try {
    const live = new URLSearchParams(window.location.search || '');
    if (live.get('frame_id')) return false;
    const params = getLaunchParams();
    if (!params.get('frame_id')) return false;
    // Merge rather than replace, so any other query the page relies on survives.
    for (const [k, v] of params.entries()) live.set(k, v);
    window.history.replaceState(
      window.history.state, '',
      `${window.location.pathname}?${live.toString()}${window.location.hash || ''}`
    );
    return true;
  } catch (_) {
    return false;
  }
}
