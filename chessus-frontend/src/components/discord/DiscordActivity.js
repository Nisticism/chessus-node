import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import axios from "axios";
import API_URL from "../../global/global";
import useBoardViewport from "../common/useBoardViewport";
import { MOVE_DOT_BACKGROUNDS } from "../../helpers/moveEngine";
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
const applyMove = (cells, move, recorded) => {
  const m = recorded || move;
  if (!cells || !m?.from || !m?.to) return cells;
  const fromKey = `${m.from.y},${m.from.x}`;
  const mover = cells[fromKey];
  if (!mover) return cells;
  const next = { ...cells };
  delete next[fromKey];
  next[`${m.to.y},${m.to.x}`] = { ...mover, x: m.to.x, y: m.to.y };

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
          setVerdict({ status: 'solved', text: 'You solved this one already.' });
        }
      } catch (_) { /* progress is a nicety; the puzzle still plays */ }
    })();
    return () => { cancelled = true; };
  }, [discord.token, discordHeaders]);

  const puzzle = daily?.puzzle || null;

  /*
   * Tell Discord what this activity IS.
   *
   * Without this, the card Discord posts when somebody launches the activity
   * reads "Game Invitation - Game ended. Start a new one?", which is the
   * generic fallback for an activity that never described itself. It makes no
   * sense for a puzzle, and it is the reason Wordle's card looks considered and
   * ours did not: Wordle sets its own presence ("Wordle No. 1911") and gets the
   * proper card, with Discord's own Play button, for free.
   *
   * Needs the rpc.activities.write scope, requested in useDiscordSdk.
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
      const { data } = await axios.get(`${API}puzzles/${puzzle.id}/moves`, { params: { x, y } });
      const moves = data?.moves || [];
      hintCache.current.set(key, moves);
      return moves;
    } catch (_) {
      return [];
    }
  }, [puzzle]);

  /** Open the full puzzle page in the player's browser, outside Discord. */
  const openOnSite = useCallback(() => {
    if (!puzzle) return;
    const url = `${window.location.origin}/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`;
    /*
     * `openExternalLink` asks the Discord client to open a real browser. A bare
     * window.open inside the iframe is blocked, so without this the link
     * silently does nothing.
     */
    if (discord.sdk?.commands?.openExternalLink) {
      discord.sdk.commands.openExternalLink({ url }).catch(() => {});
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }, [puzzle, discord.sdk]);

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
      const { data } = await axios.post(
        `${API}puzzles/${puzzle.id}/solve`,
        { moves },
        { headers: discordHeaders }
      );

      if (data.solved) {
        setBoard((prev) => applyMove(prev, move, data.solution?.[found.length]));
        setFound(moves);
        setVerdict({ status: 'solved', text: 'Solved.' });
        setAttempts((n) => n + 1);
        if (data.discord) setProgress((p) => ({ ...(p || {}), player: { ...(p?.player || {}), ...data.discord } }));
      } else if (data.status === 'continue') {
        /*
         * Right so far. Their move is played, then the opponent's scripted
         * reply, so the board shows the position the next move starts from.
         */
        setFound(moves);
        setBoard((prev) => {
          const after = applyMove(prev, move);
          return data.reply ? applyMove(after, data.reply) : after;
        });
        hintCache.current = new Map();
        const left = (data.movesTotal || 0) - (data.movesPlayed || 0);
        setVerdict({
          status: 'continue',
          text: left === 1 ? 'Good. One move left.' : `Good. ${left} moves left.`,
        });
      } else {
        /*
         * Wrong, and the line restarts from the beginning - the prefix rule the
         * solve endpoint applies means a half-right line cannot be resumed from
         * the middle.
         */
        setFound([]);
        setAttempts((n) => n + 1);
        setVerdict({ status: 'wrong', text: 'Not that one. Try again.' });
        if (data.discord) setProgress((p) => ({ ...(p || {}), player: { ...(p?.player || {}), ...data.discord } }));
        if (daily?.puzzle?.position) {
          const map = {};
          for (const pl of daily.puzzle.position) map[`${pl.y},${pl.x}`] = pl;
          setBoard(map);
          hintCache.current = new Map();
        }
      }
    } catch (_) {
      setVerdict({ status: 'error', text: 'Could not submit that move.' });
    } finally {
      setBusy(false);
    }
  }, [puzzle, busy, finished, board, found, daily, discordHeaders]);

  // ----------------------------------------------------------- interaction --
  const squareAt = useCallback((clientX, clientY) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || !vp.squareSize) return null;
    const x = Math.floor((clientX - rect.left) / vp.squareSize);
    const y = Math.floor((clientY - rect.top) / vp.squareSize);
    if (x < 0 || y < 0 || x >= boardWidth || y >= boardHeight) return null;
    return { x, y };
  }, [vp.squareSize, boardWidth, boardHeight]);

  const startPress = useCallback((e, x, y) => {
    if (!puzzle || busy || finished) return;
    const key = `${y},${x}`;
    const here = board?.[key];
    if (!here || Number(here.player_id) !== Number(puzzle.side_to_move)) return;
    setPicked(key);
    setVerdict(null);
    setDrag({ fromKey: key, x: e.clientX, y: e.clientY });
    loadHints(x, y).then(setHints);
  }, [puzzle, busy, finished, board, loadHints]);

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

  const clickSquare = useCallback((x, y) => {
    if (!puzzle || busy || finished) return;
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
  }, [puzzle, busy, finished, board, picked, tryMove, loadHints]);

  const hoverSquare = useCallback(async (x, y) => {
    if (!puzzle || finished || picked || drag) return;
    if (!board?.[`${y},${x}`]) { setHints([]); return; }
    const moves = await loadHints(x, y);
    setHints((prev) => (picked || drag ? prev : moves));
  }, [puzzle, finished, picked, drag, board, loadHints]);

  const unhoverSquare = useCallback(() => {
    if (picked || drag) return;
    setHints([]);
  }, [picked, drag]);

  // --------------------------------------------------------------- render --
  const bySquare = useMemo(() => {
    const map = new Map();
    for (const [key, pl] of Object.entries(board || {})) map.set(key, pl);
    return map;
  }, [board]);

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
              background: MOVE_DOT_BACKGROUNDS[
                hint.isCastling ? 'castle' : (hint.isCapture ? 'capture' : 'move')
              ],
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

      {verdict && (
        <p className={`${styles["verdict"]} ${styles[verdict.status] || ''}`}>
          {verdict.text}
          {verdict.status === 'handoff' && (
            <button type="button" className={styles["link-btn"]} onClick={openOnSite}>
              Open on GridGrove
            </button>
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
        <button type="button" className={styles["link-btn"]} onClick={openOnSite}>
          Open on GridGrove
        </button>
      </footer>

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
