import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import axios from "axios";
import API_URL from "../../global/global";
import useBoardViewport from "../common/useBoardViewport";
import { MOVE_DOT_BACKGROUNDS, getMoveDotType } from "../../helpers/moveEngine";
import PlacementTray from "../common/PlacementTray";
import useSetupMoveReplay from "../common/useSetupMoveReplay";
import { expandPlaceable, placesPieces } from "../../helpers/placement";
import PuzzleBoard from "../puzzles/PuzzleBoard";
import useDiscordSdk from "./useDiscordSdk";
import styles from "./discordactivity.module.scss";

/*
 * The daily puzzle, playable inside Discord.
 *
 * This is a Discord ACTIVITY, not a bot. Discord loads this page in an iframe
 * inside its own client, which is why it can be a real board you drag pieces on
 * rather than a picture with menus under it - the thing a bot could never be.
 *
 * It plays the same puzzle through the same endpoints as the website. Nothing
 * about a move is decided here: /puzzles/:id/moves says where a piece may go and
 * /puzzles/:id/solve says whether an answer is right, exactly as on the site.
 * The only thing that differs is who is asking, and even that is settled by the
 * server - see useDiscordSdk and server/discord-auth.js.
 *
 * Signing in is optional and stays optional. Without it the puzzle is fully
 * playable and nothing is recorded; with it, the streak and today's result are
 * remembered against a Discord id and never against a GridGrove account.
 */

/*
 * Everything this page fetches must be SAME-ORIGIN when it runs inside Discord.
 *
 * Discord sandboxes an activity behind a proxy at <app id>.discordsays.com and
 * its CSP permits requests to that origin and almost nothing else. The rest of
 * the site is built with REACT_APP_API_URL and REACT_APP_ASSET_URL baked in as
 * absolute https://gridgrove.gg URLs, and every one of those is blocked here -
 * silently, with no error the page can catch, which is why the first version
 * sat on "Loading today's puzzle..." forever.
 *
 * Relative paths work, because the proxy forwards them to whatever the root URL
 * mapping points at. So in the frame we drop the host and keep the path.
 */
const IN_DISCORD = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('frame_id');

/** Strip the host off an absolute URL, leaving the path the proxy can route. */
const sameOrigin = (url) => {
  if (!url) return url;
  try { return new URL(url, window.location.origin).pathname; } catch (_) { return url; }
};

const API = IN_DISCORD ? sameOrigin(API_URL) : API_URL;

/*
 * Where the real site lives - which inside the frame is NOT window.location.
 *
 * The activity is served from <app id>.discordsays.com, so building a link out
 * of window.location.origin produced a link to Discord's own proxy host. That
 * is why "Open on GridGrove" did nothing: the client was being handed a URL
 * that is not a public web page, and the one thing it will not do is open it in
 * a browser. Links OUT have to be absolute to the site, which is the opposite
 * of every request the frame makes.
 */
const SITE_ORIGIN = (process.env.REACT_APP_API_URL || '').replace(/\/+$/, '')
  || (typeof window !== 'undefined' ? window.location.origin : '');

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";
const resolveUrl = (p) => {
  if (!p) return null;
  if (IN_DISCORD) return sameOrigin(p.startsWith('http') ? p : `${ASSET_URL}${p}`);
  return p.startsWith('http') ? p : `${ASSET_URL}${p}`;
};

/** Same precedence as everywhere else: a placement override, then the piece. */
const imageFor = (placement) => {
  if (placement?.image_url) return resolveUrl(placement.image_url);
  if (!placement?.image_location) return null;
  try {
    const images = typeof placement.image_location === 'string'
      ? JSON.parse(placement.image_location)
      : placement.image_location;
    if (Array.isArray(images) && images.length) {
      const idx = Math.min(Number(placement.player_id || 1) - 1, images.length - 1);
      return resolveUrl(images[Math.max(0, idx)]);
    }
  } catch (_) { /* fall through to the letter */ }
  return null;
};

/** Move a piece on the board map. Castling moves two. */
/** A server-sent position, keyed the way the board wants it. */
const fromServerPosition = (list) => {
  const out = {};
  for (const pc of (Array.isArray(list) ? list : [])) out[`${pc.y},${pc.x}`] = { ...pc };
  return out;
};

const applyMove = (cells, move, recorded) => {
  const m = recorded || move;
  if (!cells || !m?.from || !m?.to) return cells;
  const fromKey = `${m.from.y},${m.from.x}`;
  const mover = cells[fromKey];
  if (!mover) return cells;
  const next = { ...cells };
  delete next[fromKey];
  next[`${m.to.y},${m.to.x}`] = {
    ...mover,
    // Keep the id the piece had on its STARTING square, so a later move by the
    // same piece quotes that square, not its current one - the solve check keys
    // on the id, and a second move quoting the wrong square never matches.
    id: mover.id || `${mover.piece_id}_${m.from.y}_${m.from.x}`,
    x: m.to.x,
    y: m.to.y,
  };

  if (m.isCastling && m.castlingWith) {
    const pKey = `${m.castlingWith.y},${m.castlingWith.x}`;
    const partner = next[pKey];
    if (partner) {
      // The partner lands the far side of the king, in the direction travelled.
      const dir = Math.sign(m.to.x - m.from.x) || 1;
      const landing = { x: m.to.x - dir, y: m.to.y };
      delete next[pKey];
      next[`${landing.y},${landing.x}`] = { ...partner, x: landing.x, y: landing.y };
    }
  }
  return next;
};

export default function DiscordActivity() {
  const discord = useDiscordSdk();

  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);   // streak + today's state

  const [board, setBoard] = useState(null);
  const [picked, setPicked] = useState(null);
  const [hints, setHints] = useState([]);
  // The piece held from the tray, in a game whose answer is a placement.
  const [trayPick, setTrayPick] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastTry, setLastTry] = useState(null);
  const [drag, setDrag] = useState(null);
  /*
   * A multi-move puzzle is played out here rather than handed off, because
   * inside Discord there is nowhere to hand off TO. Every move found so far is
   * re-sent with the next one, which is what the solve endpoint expects and
   * what makes a reload pick up where it left off.
   */
  const [found, setFound] = useState([]);
  // Bumped to re-arm the opponent's-move animation for each new opponent move.
  const [replayKey, setReplayKey] = useState(0);
  // The opponent move currently sliding in - the setup move, then each reply.
  const [animMove, setAnimMove] = useState(null);
  const [attempts, setAttempts] = useState(0);
  // The one-time code for joining this Discord id to a GridGrove account.
  const [linkCode, setLinkCode] = useState(null);

  const boardRef = useRef(null);
  const hintCache = useRef(new Map());

  // Only send the header once Discord has vouched for us. Anonymous play sends
  // nothing, which the server reads as "no Discord identity" and allows.
  const discordHeaders = useMemo(
    () => (discord.token ? { 'X-Discord-Token': discord.token } : {}),
    [discord.token]
  );

  /*
   * The handshake takes a moment; a fast solver does not.
   *
   * The SDK's ready() call is retried and can take a couple of seconds on a
   * cold launch. Somebody who spots a mate-in-one immediately can submit before
   * the token exists, and that attempt is then recorded as anonymous - it
   * happened in testing, three seconds before the identity arrived, and it is
   * the difference between a streak counting and not.
   *
   * So a submission waits for the handshake to settle - but only briefly, and
   * never for a handshake that has already failed. Anonymous play stays a
   * supported path; this only stops an attempt being misfiled as anonymous
   * while the answer was moments away.
   */
  const statusRef = useRef(discord.status);
  const tokenRef = useRef(discord.token);
  useEffect(() => { statusRef.current = discord.status; }, [discord.status]);
  useEffect(() => { tokenRef.current = discord.token; }, [discord.token]);

  const HANDSHAKE_GRACE_MS = 3000;
  /*
   * Paid ONCE, not on every move.
   *
   * The grace above is about the FIRST answer of a session - the one that can
   * beat the handshake to the server. Charging it again on every move of a
   * multi-move line turned a slow handshake into a slow board: a handshake
   * that never settles keeps the status on 'connecting' for the better part of
   * forty seconds, and each move inside that window sat here for three of them
   * before it was even sent. That is the delay between moves that the site's
   * own boards do not have, and it was never the animation.
   *
   * One wait is all the intent needs. If the handshake has not arrived by the
   * end of it, it is not going to arrive in time for the move after either.
   */
  const handshakeWaitedRef = useRef(false);
  const awaitHandshake = useCallback(async () => {
    if (handshakeWaitedRef.current) return;
    handshakeWaitedRef.current = true;
    if (statusRef.current !== 'connecting') return;
    const until = Date.now() + HANDSHAKE_GRACE_MS;
    while (statusRef.current === 'connecting' && Date.now() < until) {
      // eslint-disable-next-line no-await-in-loop -- a short poll, deliberately serial
      await new Promise((r) => setTimeout(r, 100));
    }
  }, []);

  // -------------------------------------------------------------- loading --
  /*
   * The puzzle loads immediately, whatever the Discord handshake is doing.
   *
   * It used to wait for the handshake to settle so a signed-in player would not
   * briefly see the anonymous version of their streak. That traded a cosmetic
   * flicker for a total failure: a handshake that never settles - because
   * authorize hangs, or the token exchange is blocked - left the page on
   * "Loading today's puzzle..." with no error and no board.
   *
   * Playing anonymously is a supported path, so identity is layered on when and
   * if it arrives. A board with no streak beats a spinner with no board.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API}puzzles/daily`);
        if (cancelled) return;
        setDaily(data);
        if (data?.puzzle?.position) {
          const map = {};
          for (const pl of data.puzzle.position) map[`${pl.y},${pl.x}`] = pl;
          setBoard(map);
        }
        setAnimMove(data?.puzzle?.setup_move || null);
        setReplayKey((k) => k + 1);
      } catch (_) {
        if (!cancelled) setDaily({ puzzle: null });
      } finally {
        if (!cancelled) setLoading(false);
      }

    })();
    return () => { cancelled = true; };
  }, []);

  // Identity, separately, once Discord has vouched for someone. Failure here
  // costs a streak, never the puzzle.
  useEffect(() => {
    if (!discord.token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API}discord/me`, { headers: discordHeaders });
        if (cancelled) return;
        setProgress(data);
        setAttempts(Number(data?.today?.attempts) || 0);
        // Opening on a puzzle they already finished should say so, not offer it
        // again as though today had not happened.
        if (data?.today?.solved) {
          const tries = Number(data?.today?.attempts) || 0;
          setVerdict({
            status: 'solved',
            text: tries > 0
              ? `Solved in ${tries} ${tries === 1 ? 'try' : 'tries'}.`
              : 'You solved this one already.',
          });
          /*
           * Show the position they left, not the one they started from.
           *
           * Coming back to a puzzle you solved this morning and being handed
           * the opening position reads as though it had not happened - and the
           * board is already locked, so the only thing on offer was a puzzle
           * you could look at but not touch. Replaying the line puts the answer
           * back on the board.
           *
           * Guarded on the line actually arriving: the server only attaches it
           * once this player has solved this puzzle.
           */
          const line = data?.today?.solution;
          if (Array.isArray(line) && line.length) {
            setFound(line);
            setBoard((prev) => line.reduce((cells, ply) => applyMove(cells, ply), prev));
          }
        }
      } catch (_) { /* progress is a nicety; the puzzle still plays */ }
    })();
    return () => { cancelled = true; };
  }, [discord.token, discordHeaders]);

  const puzzle = daily?.puzzle || null;

  /*
   * Tell Discord what this player is doing, for their PROFILE.
   *
   * This is what makes their status read "Playing GridGrove - Mate in one" with
   * the game and goal underneath, rather than a bare app name.
   *
   * It does NOT change the "Game Invitation - Game ended. Start a new one?"
   * card posted in the channel, which I first thought it would. That card is
   * the follow-up message Discord itself sends because the app's Entry Point
   * command uses the DISCORD_LAUNCH_ACTIVITY handler, where Discord answers the
   * interaction "without coordinating with the app" - so nothing the app says
   * about itself can reach it. Changing that card means switching the Entry
   * Point command to APP_HANDLER and receiving the interaction ourselves.
   *
   * Needs the rpc.activities.write scope, requested in useDiscordSdk. A player
   * who dismisses the authorisation prompt gets no presence and the whole
   * puzzle, which is the right way round.
   */
  useEffect(() => {
    if (!discord.sdk || !puzzle) return;
    discord.sdk.commands.setActivity({
      activity: {
        // 0 = Playing, which is what puts "was playing" above the card.
        type: 0,
        details: puzzle.title || 'Puzzle of the Day',
        state: [
          puzzle.game_name,
          puzzle.goal_label,
        ].filter(Boolean).join(' · '),
        // When they started, so the card shows elapsed time as Wordle's does.
        timestamps: { start: Date.now() },
      },
    }).catch(() => {
      /*
       * Presence is decoration. A player who declined the scope, or an older
       * client that does not support it, still gets the whole puzzle - so this
       * failing is not worth telling them about.
       */
    });
  }, [discord.sdk, puzzle]);

  const boardWidth = puzzle?.board_width || 8;
  const boardHeight = puzzle?.board_height || 8;

  /*
   * Discord's iframe is small and fixed - much smaller than a browser tab - so
   * the board is given the whole width it has and the caps only stop a tiny
   * board from being drawn at absurd size.
   */
  const vp = useBoardViewport({
    boardWidth,
    boardHeight,
    fitMaxSquare: 96,
    maxSquare: 120,
    maxHeight: () => Math.max(240, (typeof window !== 'undefined' ? window.innerHeight : 600) * 0.62),
    insetW: 0,
    insetH: 0,
  });

  const solved = verdict?.status === 'solved';
  const finished = solved || verdict?.status === 'revealed';

  const lightColor = '#cad5e8';
  const darkColor = '#08234d';

  // ---------------------------------------------------------------- moves --
  const loadHints = useCallback(async (x, y) => {
    if (!puzzle) return [];
    const key = `${y},${x}`;
    if (hintCache.current.has(key)) return hintCache.current.get(key);
    try {
      // The current position, so a piece that has already moved lights up the
      // right squares - past move one the opening board no longer has it there.
      const { data } = await axios.post(`${API}game-types/${puzzle.game_type_id}/puzzle-moves`, {
        position: Object.values(board || {}),
        side_to_move: puzzle.side_to_move,
        setup_move: found.length ? null : puzzle.setup_move,
        x, y,
      });
      const moves = data?.moves || [];
      hintCache.current.set(key, moves);
      return moves;
    } catch (_) {
      return [];
    }
  }, [puzzle, board, found]);

  /** The puzzle's address on the site itself, not on Discord's proxy host. */
  const siteUrl = useMemo(
    () => (puzzle ? `${SITE_ORIGIN}/games/${puzzle.game_type_id}/puzzles/${puzzle.id}` : null),
    [puzzle]
  );

  /*
   * Open the full puzzle page in the player's browser, outside Discord.
   *
   * `openExternalLink` asks the Discord client to open a real browser, and it
   * is the only reliable way out of the frame - but it is an RPC command, so it
   * only answers once the handshake has. Asked while the handshake is dead it
   * neither resolves nor rejects, and a `.catch()` on a promise that never
   * settles is a button that does nothing at all.
   *
   * So it is only tried when the SDK is actually ready, it is raced against a
   * short timeout, and the anchor underneath is left to do its ordinary job in
   * every other case - including an ordinary browser tab, where there is no SDK
   * and never was a problem.
   */
  const openOnSite = useCallback((e) => {
    if (!siteUrl) return;
    const cmd = discord.status === 'ready' && discord.sdk?.commands?.openExternalLink;
    if (!cmd) return;   // let the anchor navigate

    if (e) e.preventDefault();
    let handled = false;
    const fallback = setTimeout(() => {
      if (handled) return;
      handled = true;
      window.open(siteUrl, '_blank', 'noopener');
    }, 1500);
    Promise.resolve(discord.sdk.commands.openExternalLink({ url: siteUrl }))
      .then(() => { handled = true; clearTimeout(fallback); })
      .catch(() => { /* the timeout above is the fallback */ });
  }, [siteUrl, discord.sdk, discord.status]);

  const tryMove = useCallback(async (fromKey, x, y) => {
    if (!puzzle || busy || finished) return;
    const [fy, fx] = fromKey.split(',').map(Number);
    const mover = board?.[fromKey];
    setPicked(null);
    setHints([]);
    setBusy(true);
    setLastTry({ x, y });

    const move = {
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    };

    /*
     * Move the piece now, ask the server afterwards.
     *
     * The round trip is a move-info call and a solve call, and waiting for both
     * before anything happened left the piece sitting under the cursor for long
     * enough to read as a dropped input - the same flash the live games had
     * before they moved optimistically. The board is a guess until the server
     * answers; `before` is what it is a guess AGAINST, so every outcome below
     * rebuilds from that rather than from the guess, and a rejected move puts
     * the piece back.
     */
    const before = board;
    setBoard((prev) => applyMove(prev, move));

    try {
      const info = await axios.post(
        `${API}game-types/${puzzle.game_type_id}/puzzle-move-info`,
        {
          position: Object.values(board || {}),
          side_to_move: puzzle.side_to_move,
          setup_move: puzzle.setup_move,
          move,
        }
      ).catch(() => null);

      /*
       * A promotion needs a piece chooser, and a custom game's promotion list is
       * not something to cram into this frame. The player is sent to the real
       * page in their browser, which is the honest answer rather than guessing
       * a piece for them.
       */
      if (info?.data?.promotes) {
        setBoard(before);
        setVerdict({ status: 'handoff', text: 'That move promotes — finish it on the site.' });
        setBusy(false);
        return;
      }
      if (info?.data?.castling) {
        move.isCastling = true;
        move.castlingWith = info.data.castling.castlingWith;
        move.castlingDirection = info.data.castling.castlingDirection;
      }

      const moves = [...found, move];
      // Give the handshake its last moment before this is filed as anonymous,
      // then read the token as it stands NOW rather than as it was on mount.
      await awaitHandshake();
      const { data } = await axios.post(
        `${API}puzzles/${puzzle.id}/solve`,
        { moves },
        { headers: tokenRef.current ? { 'X-Discord-Token': tokenRef.current } : {} }
      );

      if (data.solved) {
        // From `before`, not from the optimistic board: the authoritative version
        // carries the promotion piece, and applying it on top of the guess would
        // play the move twice.
        // `position` arrives only for games whose captures this frame cannot
        // work out - a surrounded group in Go - and is the authority when it does.
        setBoard(data.position ? fromServerPosition(data.position)
          : applyMove(before, move, data.solution?.[found.length]));
        setFound(moves);
        const tries = attempts + 1;
        setVerdict({
          status: 'solved',
          text: `Solved in ${tries} ${tries === 1 ? 'try' : 'tries'}.`,
        });
        setAttempts(tries);
        if (data.discord) setProgress((p) => ({ ...(p || {}), player: { ...(p?.player || {}), ...data.discord } }));
      } else if (data.status === 'continue') {
        /*
         * Right so far. Their move is played, then the opponent's scripted
         * reply, so the board shows the position the next move starts from.
         */
        setFound(moves);
        setBoard(() => {
          if (data.position) return fromServerPosition(data.position);
          const after = applyMove(before, move);
          return data.reply ? applyMove(after, data.reply) : after;
        });
        // Slide the opponent's reply in, the same as the opening move.
        if (data.reply?.from && data.reply?.to) {
          setAnimMove(data.reply);
          setReplayKey((k) => k + 1);
        } else {
          setAnimMove(null);
        }
        hintCache.current = new Map();
        const left = (data.movesTotal || 0) - (data.movesPlayed || 0);
        setVerdict({
          status: 'continue',
          text: left === 1 ? 'Good. One move left.' : `Good. ${left} moves left.`,
        });
      } else {
        /*
         * Off the line. The guess comes back off but the moves already found
         * stay, so they retry from where they were rather than replaying the
         * whole line from the start.
         */
        setBoard(before);
        setAttempts((n) => n + 1);
        setVerdict({ status: 'wrong', text: 'Not that one. Try again.' });
        if (data.discord) setProgress((p) => ({ ...(p || {}), player: { ...(p?.player || {}), ...data.discord } }));
        hintCache.current = new Map();
      }
    } catch (_) {
      // Nothing was judged, so the guess has to come back off the board.
      setBoard(before);
      setVerdict({ status: 'error', text: 'Could not submit that move.' });
    } finally {
      setBusy(false);
    }
  }, [puzzle, busy, finished, board, found, attempts, awaitHandshake]);

  // ----------------------------------------------------------- interaction --
  const squareAt = useCallback((clientX, clientY) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || !vp.squareSize) return null;
    const x = Math.floor((clientX - rect.left) / vp.squareSize);
    const y = Math.floor((clientY - rect.top) / vp.squareSize);
    if (x < 0 || y < 0 || x >= boardWidth || y >= boardHeight) return null;
    return { x, y };
  }, [vp.squareSize, boardWidth, boardHeight]);

  /*
   * The opponent's last move, played onto the board before the solver starts -
   * the same hook the site's own boards use, so a puzzle opens the same way in
   * Discord as it does on the page.
   */
  const {
    displayBoard: shownBoard,
    replaying,
    overlay: replayPiece,
  } = useSetupMoveReplay({
    boardRef,
    squareSize: vp.squareSize,
    board,
    // The opponent's move to play in: the setup move to begin with, then every
    // reply as a multi-move line is answered, so each of the opponent's moves
    // slides rather than snapping into place.
    setupMove: animMove,
    imageFor,
    // Not gated on being mid-line: the board animates each opponent move as it
    // arrives, and stops once the puzzle is over.
    enabled: !finished,
    replayKey,
    // Only the opening move holds; each reply answers a move just made.
    immediate: found.length > 0,
  });

  const startPress = useCallback((e, x, y) => {
    // `replaying`: the position is still arriving.
    if (!puzzle || busy || finished || replaying) return;
    const key = `${y},${x}`;
    const here = board?.[key];
    if (!here || Number(here.player_id) !== Number(puzzle.side_to_move)) return;
    setPicked(key);
    setVerdict(null);
    setDrag({ fromKey: key, x: e.clientX, y: e.clientY });
    loadHints(x, y).then(setHints);
  }, [puzzle, busy, finished, replaying, board, loadHints]);

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (e) => setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const onUp = (e) => {
      const sq = squareAt(e.clientX, e.clientY);
      const from = drag.fromKey;
      setDrag(null);
      if (!sq) { setPicked(null); setHints([]); return; }
      const [fy, fx] = from.split(',').map(Number);
      // Press and release on the same square is a click, so the piece stays
      // selected and click-then-click still works.
      if (sq.x === fx && sq.y === fy) return;
      tryMove(from, sq.x, sq.y);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, squareAt, tryMove]);

  /*
   * Answer by putting a piece down. One click, because there is nothing on the
   * board to pick up first - and the board that comes back is the server's,
   * since a placement can capture a group this frame cannot find.
   */
  const tryPlace = useCallback(async (x, y) => {
    if (!puzzle || busy || finished || !trayPick) return;
    setBusy(true);
    setLastTry({ x, y });
    const move = {
      type: 'place',
      placePieceId: Number(trayPick.template.piece_id),
      to: { x, y },
    };
    // Put the piece down straight away; the server's board replaces this the
    // moment it answers, and a rejected placement takes it back off.
    const before = board;
    const player = trayPick.player || Number(puzzle.side_to_move) || 1;
    setBoard((prev) => ({
      ...prev,
      [`${y},${x}`]: {
        piece_id: Number(trayPick.template.piece_id),
        player_id: player,
        piece_name: trayPick.template.name || null,
        image_location: trayPick.template.image_location || null,
        x, y,
      },
    }));
    try {
      const moves = [...found, move];
      await awaitHandshake();
      const { data } = await axios.post(
        `${API}puzzles/${puzzle.id}/solve`,
        { moves },
        { headers: tokenRef.current ? { 'X-Discord-Token': tokenRef.current } : {} }
      );
      if (data.position) setBoard(fromServerPosition(data.position));
      if (data.solved) {
        setFound(moves);
        const tries = attempts + 1;
        setVerdict({ status: 'solved', text: `Solved in ${tries} ${tries === 1 ? 'try' : 'tries'}.` });
        setAttempts(tries);
        if (data.discord) setProgress((p) => ({ ...(p || {}), player: { ...(p?.player || {}), ...data.discord } }));
      } else if (data.status === 'continue') {
        setFound(moves);
        hintCache.current = new Map();
        const left = (data.movesTotal || 0) - (data.movesPlayed || 0);
        setVerdict({
          status: 'continue',
          text: left === 1 ? 'Good. One move left.' : `Good. ${left} moves left.`,
        });
      } else {
        // Off the line: take the guess back off and keep what was found.
        setBoard(before);
        setAttempts((n) => n + 1);
        setVerdict({ status: 'wrong', text: 'Not that one. Try again.' });
      }
    } catch (_) {
      setBoard(before);
      setVerdict({ status: 'error', text: 'Could not check that just now.' });
    } finally {
      setBusy(false);
      setTrayPick(null);
    }
  }, [puzzle, busy, finished, trayPick, board, found, attempts, awaitHandshake]);

  const clickSquare = useCallback((x, y) => {
    if (!puzzle || busy || finished || replaying) return;
    if (trayPick) { tryPlace(x, y); return; }
    const key = `${y},${x}`;
    const here = board?.[key];
    if (!picked) {
      if (!here || Number(here.player_id) !== Number(puzzle.side_to_move)) return;
      setPicked(key);
      setVerdict(null);
      loadHints(x, y).then(setHints);
      return;
    }
    if (picked === key) { setPicked(null); setHints([]); return; }
    tryMove(picked, x, y);
  }, [puzzle, busy, finished, replaying, board, picked, tryMove, loadHints, trayPick, tryPlace]);

  const hoverSquare = useCallback(async (x, y) => {
    if (!puzzle || finished || picked || drag || replaying) return;
    if (!board?.[`${y},${x}`]) { setHints([]); return; }
    const moves = await loadHints(x, y);
    setHints((prev) => (picked || drag ? prev : moves));
  }, [puzzle, finished, picked, drag, replaying, board, loadHints]);

  const unhoverSquare = useCallback(() => {
    if (picked || drag) return;
    setHints([]);
  }, [picked, drag]);

  // --------------------------------------------------------------- render --
  // From the REPLAY's board: the pre-move position while the opponent's move
  // is arriving, the real one afterwards.
  const bySquare = useMemo(() => {
    const map = new Map();
    for (const [key, pl] of Object.entries(shownBoard || {})) map.set(key, pl);
    return map;
  }, [shownBoard]);

  const squareClass = useCallback((x, y) => {
    const key = `${y},${x}`;
    const pl = bySquare.get(key);
    const mine = pl && Number(pl.player_id) === Number(puzzle?.side_to_move);
    const wrong = verdict?.status === 'wrong' && lastTry?.x === x && lastTry?.y === y;
    const target = hints.some((m) => m.x === x && m.y === y);
    return [
      picked === key ? styles["picked"] : '',
      wrong ? styles["wrong"] : '',
      (mine || target) && !finished ? styles["grabbable"] : '',
    ].filter(Boolean).join(' ');
  }, [bySquare, puzzle?.side_to_move, picked, verdict, lastTry, finished, hints]);

  const renderSquare = useCallback((x, y) => {
    const pl = bySquare.get(`${y},${x}`);
    const hint = hints.find((m) => m.x === x && m.y === y);
    const src = imageFor(pl);
    return (
      <>
        {pl && (src
          ? <img
              src={src}
              alt={pl.piece_name || ''}
              draggable={false}
              style={drag && drag.fromKey === `${y},${x}` ? { opacity: 0 } : undefined}
            />
          : <span className={styles["piece-letter"]}>{(pl.piece_name || '?').charAt(0)}</span>)}
        {!!hint && (
          <span
            className={styles["move-dot"]}
            style={{
              /*
               * getMoveDotType, the same call the solver page and every live
               * board make, so one square means one thing everywhere. It reads
               * the move/attack split the moves endpoint now sends: a square a
               * piece can both walk to and take on gets the half-and-half dot,
               * which was previously only ever drawn outside puzzles.
               */
              background: MOVE_DOT_BACKGROUNDS[getMoveDotType(hint)],
            }}
            aria-hidden="true"
          />
        )}
      </>
    );
  }, [bySquare, hints, drag]);

  /*
   * Ask for a link code. Nothing is linked by pressing this - it hands back six
   * characters to type on the website, where the session proves which account
   * they belong to. See server/index.js, /api/account/link-discord.
   */
  const requestLinkCode = useCallback(async () => {
    try {
      const { data } = await axios.post(`${API}discord/link-code`, {}, { headers: discordHeaders });
      setLinkCode(data.code);
    } catch (err) {
      setLinkCode(null);
      setVerdict({
        status: 'error',
        text: err?.response?.data?.message || 'Could not create a link code.',
      });
    }
  }, [discordHeaders]);

  const dragSrc = drag ? imageFor(board?.[drag.fromKey]) : null;
  const player = progress?.player || null;

  if (loading) {
    return <div className={styles["activity"]}><p className={styles["muted"]}>Loading today's puzzle…</p></div>;
  }

  if (!puzzle) {
    return (
      <div className={styles["activity"]}>
        <h1 className={styles["title"]}>Puzzle of the Day</h1>
        <p className={styles["muted"]}>There is no puzzle scheduled for today. Check back tomorrow.</p>
      </div>
    );
  }

  return (
    <div className={styles["activity"]}>
      <header className={styles["head"]}>
        <div>
          <h1 className={styles["title"]}>{puzzle.title || 'Puzzle of the Day'}</h1>
          <p className={styles["sub"]}>
            {puzzle.game_name}
            {puzzle.goal_label ? ` · ${puzzle.goal_label}` : ''}
          </p>
        </div>
        {player && (
          <div className={styles["streak"]} title={`Best: ${player.best_streak}`}>
            <span className={styles["streak-n"]}>{player.current_streak}</span>
            <span className={styles["streak-label"]}>day streak</span>
          </div>
        )}
      </header>

      <p className={styles["turn"]}>Player {puzzle.side_to_move} to move</p>

      <div className={styles["board-frame"]}>
        <PuzzleBoard
          vp={vp}
          boardWidth={boardWidth}
          boardHeight={boardHeight}
          lightColor={lightColor}
          darkColor={darkColor}
          renderSquare={renderSquare}
          squareClassName={squareClass}
          onSquareClick={clickSquare}
          onSquarePointerDown={startPress}
          onSquareMouseEnter={hoverSquare}
          onSquareMouseLeave={unhoverSquare}
          boardRef={boardRef}
        />
        {/* The opponent's last move, in flight. */}
        {replayPiece && (
          <img src={replayPiece.src} alt={replayPiece.alt} style={replayPiece.style} draggable={false} />
        )}
        {drag && dragSrc && (
          <img
            className={styles["drag-piece"]}
            src={dragSrc}
            alt=""
            draggable={false}
            style={{
              left: drag.x, top: drag.y,
              width: vp.squareSize, height: vp.squareSize,
            }}
          />
        )}
      </div>

      {/* Only for a game that places pieces; every other puzzle is unchanged.
          `tone` swaps the chrome for Discord's own greys - the geometry and
          the held-piece ring stay identical to the site's. */}
      <PlacementTray
        items={placesPieces(puzzle) ? expandPlaceable(puzzle.placeable_pieces, puzzle.player_count) : []}
        heldKey={trayPick?.key}
        onPick={(item) => { setTrayPick(item); setPicked(null); setHints([]); }}
        label="Answer by placing"
        tone="discord"
        disabled={busy || finished || replaying}
        imageFor={(item) => imageFor({
          piece_id: item.template.piece_id,
          image_location: item.template.image_location,
          player_id: item.player || 1,
        })}
      />

      {verdict && (
        <p className={`${styles["verdict"]} ${styles[`v-${verdict.status}`] || ''}`}>
          {verdict.text}
          {verdict.status === 'handoff' && (
            <a
              className={styles["link-btn"]}
              href={siteUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openOnSite}
            >
              Open on GridGrove
            </a>
          )}
        </p>
      )}

      {/* Only offered to somebody Discord has identified: there is nothing to
          link for an anonymous player, and nothing to link it to once linked. */}
      {player && !player.linked_username && (
        <div className={styles["link-row"]}>
          {linkCode ? (
            <p className={styles["muted"]}>
              On GridGrove, open your account page and enter{' '}
              <strong className={styles["code"]}>{linkCode}</strong> within 10 minutes.
            </p>
          ) : (
            <button type="button" className={styles["link-btn"]} onClick={requestLinkCode}>
              Link a GridGrove account
            </button>
          )}
        </div>
      )}

      <footer className={styles["foot"]}>
        <span className={styles["muted"]}>
          {attempts === 0 ? 'No attempts yet' : `${attempts} ${attempts === 1 ? 'try' : 'tries'} today`}
        </span>
        {/* An anchor, not a button: when the SDK handshake is dead there is no
            openExternalLink to call, and an ordinary link is the only way out
            of the frame that does not depend on it. */}
        <a
          className={styles["link-btn"]}
          href={siteUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openOnSite}
        >
          Open on GridGrove
        </a>
      </footer>

      {/*
        * The handshake, on screen.
        *
        * Every attempt to report this to the server has produced silence, and a
        * report that cannot be delivered is not a diagnostic. This one cannot
        * fail to arrive: it is rendered where the person launching the activity
        * can read it. Shown only while the handshake has not succeeded, so a
        * working activity never carries it.
        */}
      {discord.status === 'error' && (
        <p className={styles["muted"]} style={{ fontSize: '11px', opacity: 0.75, wordBreak: 'break-all' }}>
          {`handshake: ${discord.status}`}
          {discord.stage ? ` @ ${discord.stage}` : ''}
          {discord.error ? ` · ${discord.error}` : ''}
          {` · host ${typeof window !== 'undefined' ? window.location.hostname : '?'}`}
          {` · params ${typeof window !== 'undefined'
            ? ([...new URLSearchParams(window.location.search).keys()].join(',') || 'none')
            : '?'}`}
          {/* Whether the page is actually inside an iframe, and whether it has
              a real origin. A top-level document has no parent to hand the
              SDK's handshake to, and a sandbox without allow-same-origin gives
              an opaque origin where storage throws - either explains a ready()
              that never settles, and neither is visible any other way. */}
          {` · framed ${(() => { try { return window.self !== window.top; } catch (_) { return 'blocked'; } })()}`}
          {` · storage ${(() => {
            try { window.localStorage.setItem('gg:probe', '1'); window.localStorage.removeItem('gg:probe'); return 'ok'; }
            catch (_) { return 'blocked'; }
          })()}`}
          {/* The application id the handshake used, and - when they differ -
              the one this build was carrying. Discord answers the handshake
              only for the application it launched, so a mismatch here is a
              ready() that never settles and nothing else to see. */}
          {discord.appId ? ` · app ${discord.appId}` : ' · app (none)'}
          {discord.envAppId && discord.envAppId !== discord.appId
            ? ` (build says ${discord.envAppId} — set REACT_APP_DISCORD_CLIENT_ID to ${discord.appId})`
            : ''}
        </p>
      )}

      {discord.status === 'error' && (
        /*
         * Said plainly and without alarm. Nothing is broken - the puzzle in
         * front of them works - so this explains what they are missing rather
         * than reporting a failure.
         */
        <p className={styles["muted"]}>
          Playing without a Discord sign-in, so today's result will not be saved.
        </p>
      )}
    </div>
  );
}
