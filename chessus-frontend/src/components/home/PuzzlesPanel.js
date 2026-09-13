import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import authHeader from "../../services/auth-header";
import API_URL from "../../global/global";
import { isSilverSupporter } from "../../helpers/supporterTiers";
import useBoardViewport from "../common/useBoardViewport";
import { MOVE_DOT_BACKGROUNDS } from "../../helpers/moveEngine";
import PuzzleBoard from "../puzzles/PuzzleBoard";
import styles from "./puzzlespanel.module.scss";

/*
 * The home page's puzzle block: today's puzzle drawn on a real board on the
 * left, what puzzles ARE on the right.
 *
 * The board is the point. A block of text about puzzles is not a draw for
 * somebody who has never been here; a position they can look at and start
 * solving in their head is. Showing it gives nothing away either - the solution
 * is the secret, and that stays on the server.
 *
 * The pool sweep keeps boards further from square than 3:2 out of the rotation
 * (see scripts/puzzle-pool-sweep.js), so this half never has to cope with a
 * 3x24 strip and the two halves can share a height without either one
 * stretching.
 */

// Mirrors PUZZLE_FREE_PER_GAME on the server. Shown, never enforced here.
const FREE_PUZZLES_PER_GAME = 3;

/*
 * Development only: a control for stepping through the scheduled queue, so the
 * card can be checked against boards of different shapes without waiting a day
 * per board. Gated on the build being a development one, so it cannot ship.
 *
 * The server refuses future dates for everyone, which is why this walks the
 * queue through the admin endpoint rather than asking /puzzles/daily?date=.
 */
const IS_LOCAL = process.env.NODE_ENV === 'development';

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";
const resolveUrl = (p) => (!p ? null : (p.startsWith('http') ? p : `${ASSET_URL}${p}`));

/**
 * Same precedence the rest of the site uses: a placement's own image_url is a
 * deliberate override, so it wins; otherwise the piece's image_location, indexed
 * by player.
 */
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

/** Move a piece on the board map, so a solved puzzle shows its answer played. */
const applyMove = (cells, move, recorded) => {
  const m = recorded || move;
  if (!cells || !m?.from || !m?.to) return cells;
  const fromKey = `${m.from.y},${m.from.x}`;
  const mover = cells[fromKey];
  if (!mover) return cells;
  const next = { ...cells };
  delete next[fromKey];
  next[`${m.to.y},${m.to.x}`] = { ...mover, x: m.to.x, y: m.to.y };

  // Castling moves two pieces; the partner lands the far side of the king.
  if (m.isCastling && m.castlingWith) {
    const partnerKey = Object.keys(next).find((k) => {
      const pc = next[k];
      if (!pc) return false;
      if (pc.id) return pc.id === m.castlingWith;
      const [ky, kx] = k.split(',');
      return `${pc.piece_id}_${ky}_${kx}` === m.castlingWith;
    });
    if (partnerKey) {
      const partner = next[partnerKey];
      const px = m.castlingDirection === 'left' ? m.to.x + 1 : m.to.x - 1;
      delete next[partnerKey];
      next[`${m.to.y},${px}`] = { ...partner, x: px, y: m.to.y };
    }
  }
  return next;
};

const PuzzlesPanel = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const navigate = useNavigate();
  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(true);

  /*
   * Solving in place. The home page is where most people meet the puzzle, and
   * sending them somewhere else to make one move loses most of them - so the
   * board here is playable: click a piece, click a square.
   *
   * Anything the inline board cannot do honestly (a promotion, which needs a
   * piece chooser) hands off to the full solver page rather than guessing.
   */
  const [board, setBoard] = useState(null);    // live position while solving
  const [picked, setPicked] = useState(null);  // "y,x" of the held piece
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);
  // Where the held piece may go, from the server. The dots are what make the
  // board playable rather than a picture you can click at.
  const [hints, setHints] = useState([]);
  const [lastTry, setLastTry] = useState(null);
  // Development only: how many days ahead of today we are previewing.
  const [preview, setPreview] = useState(0);
  /*
   * Dragging. Click-then-click still works - some people prefer it, and it is
   * the only option on a keyboard - but dragging is what a board invites, and
   * making people double-click to move a piece feels broken.
   */
  const [drag, setDrag] = useState(null);   // { fromKey, x, y }
  const boardRef = useRef(null);
  /*
   * Hovering a piece shows where it can go, exactly as the solver page does.
   *
   * The solver computes that locally because it already holds every piece
   * definition; the card asks the server instead, so the answers are cached per
   * square - a hover is a mouse movement, and re-asking on every one of them
   * would be a request storm for something that cannot change between hovers.
   * Cleared whenever the board changes.
   */
  const hintCache = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = (IS_LOCAL && preview) ? { preview } : undefined;
        const { data } = await axios.get(`${API_URL}puzzles/daily`, {
          headers: authHeader(), params,
        });
        if (cancelled) return;
        setDaily(data);
        setVerdict(null);
        setPicked(null);
        setHints([]);
        setLastTry(null);
        hintCache.current = new Map();
        if (data?.puzzle?.position) {
          const map = {};
          for (const pl of data.puzzle.position) map[`${pl.y},${pl.x}`] = pl;
          setBoard(map);
        } else {
          setBoard(null);
        }
      } catch (_) {
        // The section still has something to say without today's puzzle.
        if (!cancelled) setDaily({ puzzle: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [preview]);

  const puzzle = daily?.puzzle || null;
  const supporter = isSilverSupporter(currentUser);

  // The same board colours a signed-in player sees everywhere else.
  const lightColor = currentUser?.light_square_color || localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkColor = currentUser?.dark_square_color || localStorage.getItem('boardDarkColor') || '#08234d';

  const boardWidth = puzzle?.board_width || 8;
  const boardHeight = puzzle?.board_height || 8;

  /*
   * The same sizing hook the solver and the builder use, rather than a second
   * way of laying out a board. It hands back a SQUARE SIZE in pixels, which is
   * also why the solver never had the collapsed-rank bug this card first
   * shipped with: fixed-size squares cannot collapse, whereas a grid with
   * implicit rows sizes each rank to its contents and an empty rank to nothing.
   */
  const vp = useBoardViewport({
    boardWidth,
    boardHeight,
    /*
     * These caps are deliberately high so the CONTAINER is what bounds the
     * board, not an arbitrary square size. With a low fitMaxSquare the squares
     * stop growing while the column keeps going, and the board sits as a small
     * square in the middle of a very wide frame on a large screen.
     *
     * The fit is min(width/columns, height/rows, fitMaxSquare) - so raising the
     * cap hands the decision to whichever of width or height actually runs out
     * first, which is what "fill the container" means.
     */
    fitMaxSquare: 160,
    maxSquare: 220,
    maxHeight: () => Math.max(300, Math.min(
      640,
      (typeof window !== 'undefined' ? window.innerHeight : 900) * 0.7
    )),
    insetW: 0,
    insetH: 0,
  });

  const solved = verdict?.status === 'solved';
  const finished = solved || verdict?.status === 'revealed';

  /*
   * Board shape drives the layout. A wide board earns more of the row than the
   * text beside it; a tall narrow one needs less, and would otherwise stretch
   * the whole section to its height. Expressed as an aspect ratio rather than
   * pixel breakpoints so it holds for any board the pool contains.
   */
  const aspect = boardWidth / boardHeight;
  const shape = aspect >= 1.25 ? 'wide' : (aspect <= 0.8 ? 'tall' : 'square');

  /** Play a move, or hand off to the full page when it needs a chooser. */
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
        `${API_URL}game-types/${puzzle.game_type_id}/puzzle-move-info`,
        {
          position: Object.values(board || {}),
          side_to_move: puzzle.side_to_move,
          setup_move: puzzle.setup_move,
          move,
        },
        { headers: authHeader() }
      ).catch(() => null);

      // A promotion needs a piece chooser, which belongs on the solver page.
      if (info?.data?.promotes) {
        navigate(`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`);
        return;
      }
      if (info?.data?.castling) {
        move.isCastling = true;
        move.castlingWith = info.data.castling.castlingWith;
        move.castlingDirection = info.data.castling.castlingDirection;
      }

      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzle.id}/solve`,
        { moves: [move] },
        { headers: authHeader() }
      );
      if (data.solved) {
        setBoard((prev) => applyMove(prev, move, data.solution?.[0]));
        setVerdict({ status: 'solved', text: 'That is it — solved.' });
      } else if (data.status === 'continue') {
        // A longer line than the card can show; finish it on its own page.
        navigate(`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`);
      } else {
        setVerdict({ status: 'wrong', text: 'Not that one. Try again.' });
      }
    } catch (_) {
      setVerdict({ status: 'error', text: 'Could not submit that move.' });
    } finally {
      setBusy(false);
    }
  }, [puzzle, busy, finished, board, navigate]);

  /** This piece's moves, from the cache when we already asked. */
  const loadHints = useCallback(async (x, y) => {
    if (!puzzle) return [];
    const key = `${y},${x}`;
    if (hintCache.current.has(key)) return hintCache.current.get(key);
    try {
      const { data } = await axios.get(`${API_URL}puzzles/${puzzle.id}/moves`, {
        params: { x, y },
      });
      const moves = data?.moves || [];
      hintCache.current.set(key, moves);
      return moves;
    } catch (_) {
      return [];
    }
  }, [puzzle]);

  const hoverSquare = useCallback(async (x, y) => {
    // A held piece or a drag in progress owns the dots; hover must not fight it.
    if (!puzzle || finished || picked || drag) return;
    if (!board?.[`${y},${x}`]) { setHints([]); return; }
    const moves = await loadHints(x, y);
    // The pointer may have moved on while the request was out.
    setHints((prev) => (picked || drag ? prev : moves));
  }, [puzzle, finished, picked, drag, board, loadHints]);

  const unhoverSquare = useCallback(() => {
    if (picked || drag) return;
    setHints([]);
  }, [picked, drag]);

  /** Which square a point on the screen is over, or null if it is off the board. */
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

  /*
   * The move and release listeners live on the window, not the board: a drag
   * that ends outside the board still has to end, or the piece stays glued to
   * the cursor.
   */
  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (e) => setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const onUp = (e) => {
      const sq = squareAt(e.clientX, e.clientY);
      const from = drag.fromKey;
      setDrag(null);
      if (!sq) { setPicked(null); setHints([]); return; }
      const [fy, fx] = from.split(',').map(Number);
      // A press and release on the same square is a click: keep it selected so
      // click-then-click still works.
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
      if (!here) return;
      if (Number(here.player_id) !== Number(puzzle.side_to_move)) return;
      setPicked(key);
      setVerdict(null);
      loadHints(x, y).then(setHints);
      return;
    }
    if (picked === key) { setPicked(null); setHints([]); return; }
    tryMove(picked, x, y);
  }, [puzzle, busy, finished, board, picked, tryMove, loadHints]);

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
      // Your own pieces and the squares they can reach get the pointer. The
      // opponent's pieces are still hoverable for a preview, but they are not
      // yours to move, so they keep the plain cursor.
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
        {/* The same dots the solver page draws, from the same colour map, so a
            square means the same thing in both places. */}
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

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const dragSrc = drag ? imageFor(board?.[drag.fromKey]) : null;

  return (
    <section className={styles["puzzles-section"]} aria-label="Puzzles">
      {drag && dragSrc && (
        <img
          className={styles["drag-piece"]}
          src={dragSrc}
          alt=""
          style={{
            left: drag.x,
            top: drag.y,
            width: vp.squareSize,
            height: vp.squareSize,
          }}
        />
      )}
      <div className={styles["section-header"]}>
        <h2>Puzzle of the Day</h2>
      </div>

      <div className={`${styles["split"]} ${styles[`shape-${shape}`]}`}>

        {/* ---------------------------------------------- today's puzzle -- */}
        <div className={styles["daily"]}>
          {loading && <p className={styles["muted"]}>Loading today’s puzzle…</p>}

          {!loading && !puzzle && (
            <div className={styles["empty"]}>
              <h3>No puzzle today</h3>
              <p className={styles["muted"]}>
                A puzzle has to be checked by the server before it can be the daily one,
                so there is nothing scheduled yet. Build one and it could be here.
              </p>
              <Link to="/play/games" className={styles["btn-secondary"]}>Browse games</Link>
            </div>
          )}

          {!loading && puzzle && (
            <>
              {/* The board sets this half's height; the other half matches it. */}
              <div className={styles["board-frame"]} style={vp.frameStyle}>
                <PuzzleBoard
                  vp={vp}
                  boardRef={boardRef}
                  boardWidth={boardWidth}
                  boardHeight={boardHeight}
                  lightColor={lightColor}
                  darkColor={darkColor}
                  squareClassName={squareClass}
                  renderSquare={renderSquare}
                  onSquareClick={clickSquare}
                  onSquarePointerDown={startPress}
                  onSquareMouseEnter={hoverSquare}
                  onSquareMouseLeave={unhoverSquare}
                />
              </div>

              <div className={styles["daily-info"]}>
                <h3 className={styles["daily-title"]}>
                  <Link to={`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`}>
                    {puzzle.title || 'Today’s puzzle'}
                  </Link>
                  {daily.solvedByYou && <span className={styles["solved-tick"]} title="You have solved this">✓</span>}
                </h3>

                {/* Whose move it is decides everything about how the board
                    reads, so it sits directly under the title rather than
                    among the chips. */}
                <p className={styles["turn"]}>
                  <span className={styles[`turn-p${puzzle.side_to_move}`]} aria-hidden="true" />
                  Player {puzzle.side_to_move} to move
                </p>

                <p className={styles["daily-game"]}>
                  from <Link to={`/games/${puzzle.game_type_id}`}>{puzzle.game_name}</Link>
                  {puzzle.creator_username && <> · puzzle by {puzzle.creator_username}</>}
                  {' · '}{today}
                </p>
                <div className={styles["daily-meta"]}>
                  {puzzle.goal_label && <span className={styles["chip"]}>{puzzle.goal_label}</span>}
                  {puzzle.solution_depth > 1 && (
                    <span className={styles["chip"]}>{puzzle.solution_depth} moves</span>
                  )}
                  {puzzle.rating != null && <span className={styles["chip"]}>Rated {puzzle.rating}</span>}
                </div>
                {IS_LOCAL && (
                  <div className={styles["dev-nav"]}>
                    <span>dev only</span>
                    <button
                      type="button"
                      onClick={() => setPreview((n) => Math.max(0, n - 1))}
                      disabled={preview === 0}
                    >
                      ← previous
                    </button>
                    <strong>{preview === 0 ? 'today' : `+${preview} day${preview === 1 ? '' : 's'}`}</strong>
                    <button type="button" onClick={() => setPreview((n) => n + 1)}>
                      next day →
                    </button>
                  </div>
                )}

                {verdict && (
                  <p className={`${styles["verdict"]} ${styles[`verdict-${verdict.status}`]}`}>
                    {verdict.text}
                  </p>
                )}
                {!verdict && !daily.solvedByYou && (
                  <p className={styles["muted"]}>
                    Play it right here: drag a piece, or click it and then its square.
                  </p>
                )}

                <div className={styles["daily-actions"]}>
                  <Link
                    to={`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`}
                    className={styles["btn-primary"]}
                  >
                    {solved ? 'See the full puzzle' : (daily.solvedByYou ? 'Play it again' : 'Open on its own page')}
                  </Link>
                  {verdict?.status === 'wrong' && (
                    <button className={styles["btn-link"]} onClick={() => setVerdict(null)}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ------------------------------------------------- the standing -- */}
        <div className={styles["about"]}>
          <h3 className={styles["about-title"]}>Puzzles on GridGrove</h3>
          <p>
            Every puzzle on the site is free to solve, and one a day isn't the limit. Some of them are built from actual games played on the site, so the positions are realistic and varied.  Others
            were created by hand to provide unique challenges.
          </p>

          <ul className={styles["points"]}>
            <li>
              <strong>Solving is free.</strong> No account needed, no daily allowance.
              Sign in and your solves build a puzzle rating.
            </li>
            <li>
              <strong>Build your own.</strong> Everyone can create up to{' '}
              {FREE_PUZZLES_PER_GAME} puzzles for each game. Silver Supporters can build
              as many as they like, for any game they've created.
            </li>
            <li>
              <strong>Any game, any pieces.</strong> A puzzle can come from any game on
              the site, so finding the answer might depend on knowing the rules and the typical patterns of the game.
            </li>
          </ul>

          <div className={styles["about-actions"]}>
            <Link to="/play/games" className={styles["btn-secondary"]}>Find puzzles</Link>
            {!supporter && (
              <Link to="/donate" className={styles["btn-link"]}>
                {currentUser ? 'Become a supporter' : 'See supporter perks'} →
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default PuzzlesPanel;
