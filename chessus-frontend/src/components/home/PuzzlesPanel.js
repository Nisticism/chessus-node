import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import authHeader from "../../services/auth-header";
import API_URL from "../../global/global";
import { isSilverSupporter } from "../../helpers/supporterTiers";
import useBoardViewport from "../common/useBoardViewport";
import { MOVE_DOT_BACKGROUNDS, getMoveDotType } from "../../helpers/moveEngine";
import PlacementTray from "../common/PlacementTray";
import PromotionChooser from "../common/PromotionChooser";
import GameRulesModal from "../common/GameRulesModal";
import { applyPromotionDefinition, promotionPieceNumber, solvedPliesRemaining } from "../../helpers/pieceMovementUtils";
import useSetupMoveReplay from "../common/useSetupMoveReplay";
import { expandPlaceable, placesPieces } from "../../helpers/placement";
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
/** A server-sent position, keyed the way the board wants it. */
const fromServerPosition = (list) => {
  const out = {};
  for (const pc of (Array.isArray(list) ? list : [])) out[`${pc.y},${pc.x}`] = { ...pc };
  return out;
};

const applyMove = (cells, move, recorded, promotionArt = null) => {
  const m = recorded || move;
  if (!cells || !m?.from || !m?.to) return cells;
  const fromKey = `${m.from.y},${m.from.x}`;
  const mover = cells[fromKey];
  if (!mover) return cells;
  const next = { ...cells };
  delete next[fromKey];
  const landed = {
    ...mover,
    // Keep the id the piece had on its STARTING square, so a later move by the
    // same piece quotes that square, not its current one. The solve check keys
    // on the id, and a second move quoting the wrong square never matches - the
    // bug that made move two of a multi-move puzzle unsolvable on this card.
    id: mover.id || `${mover.piece_id}_${m.from.y}_${m.from.x}`,
    x: m.to.x,
    y: m.to.y,
  };

  /*
   * A promotion replaces the piece rather than moving it, so the labels have to
   * be replaced too - otherwise the card shows a pawn on the last rank until the
   * server's authoritative position lands. Through the replay's own helper, so
   * what survives a promotion is decided in one place.
   *
   * This card has no piece-definition map to fall back on, so the art is only
   * cleared when there is something to put in its place; an empty square reads
   * worse than the old picture for the moment before the server answers.
   */
  const promotedId = promotionPieceNumber(m.promotionPieceId);
  if (promotedId != null) {
    applyPromotionDefinition(landed, {
      piece_id: promotedId,
      ...(promotionArt ? {
        piece_name: promotionArt.piece_name || null,
        image_location: promotionArt.image_location || null,
        image_url: null,
      } : {}),
    });
    if (m.promotionPlayer != null) landed.player_id = Number(m.promotionPlayer);
  }
  next[`${m.to.y},${m.to.x}`] = landed;

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

/*
 * How long today's puzzle has left, for the countdown beside the date.
 *
 * The day turns over at midnight EASTERN, not at the viewer's midnight and not
 * at UTC's - see server/daily-puzzle.js, which is the authority. Read off the
 * Eastern wall clock and subtracted from 24 hours, which is the same sum the
 * server does when it picks a day key.
 *
 * On the two days a year the clock shifts this is an hour out, because 24 hours
 * is not how long those days are. Nobody plans around a countdown, and the
 * alternative - resolving the exact instant of the next Eastern midnight - is a
 * lot of arithmetic to be right twice a year.
 */
const DAILY_TZ = 'America/New_York';
const easternClock = new Intl.DateTimeFormat('en-US', {
  timeZone: DAILY_TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const timeUntilNextPuzzle = () => {
  const parts = {};
  for (const part of easternClock.formatToParts(new Date())) parts[part.type] = part.value;
  // hour12:false renders midnight as "24" in some engines, so it is wrapped
  // rather than trusted.
  const seconds = (Number(parts.hour) % 24) * 3600
    + Number(parts.minute) * 60
    + Number(parts.second);
  if (!Number.isFinite(seconds)) return null;

  const left = 86400 - seconds;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
};

const PuzzlesPanel = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
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
  /*
   * A multi-move puzzle is played out on the card now, rather than handed off
   * to its own page. Every solver move found so far is re-sent with the next
   * one - the solve endpoint is stateless and interleaves the opponent's
   * replies - so this is the same list PuzzleSolver and the Discord activity
   * keep.
   */
  const [found, setFound] = useState([]);
  // Bumped to re-arm the opponent's-move animation when the puzzle restarts.
  const [replayKey, setReplayKey] = useState(0);
  // The opponent move currently sliding in: the setup move at the start, then
  // each scripted reply as a multi-move line is answered.
  const [animMove, setAnimMove] = useState(null);
  /*
   * The signed-in solver's rating move, shown once the puzzle is decided -
   * exactly what the puzzle's own page shows, so a solve on the card counts and
   * reads the same. The server's first-attempt rule is what fills this in, and
   * only ever once per puzzle.
   */
  const [ratingChange, setRatingChange] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ratingNote, setRatingNote] = useState(null);
  // When this attempt began, for the solve's duration. Reset per puzzle and on
  // a restart.
  const [startedAt, setStartedAt] = useState(() => Date.now());
  // Where the held piece may go, from the server. The dots are what make the
  // board playable rather than a picture you can click at.
  const [hints, setHints] = useState([]);
  // The piece held from the tray, in a game whose answer is a placement.
  const [trayPick, setTrayPick] = useState(null);
  const [lastTry, setLastTry] = useState(null);
  /*
   * A promotion waiting on the solver. Held with the board it was played
   * against, because the guess is not on the board while the dialog is open and
   * the answer has to be sent against the position it was made in.
   */
  const [pendingPromotion, setPendingPromotion] = useState(null);
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
        setFound([]);
        setRatingChange(null);
        setRatingNote(null);
        setStartedAt(Date.now());
        setAnimMove(data?.puzzle?.setup_move || null);
        setReplayKey((k) => k + 1);
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
  /*
   * The opponent's last move, played onto the card before anyone touches it.
   *
   * Same hook the puzzle's own page uses: `shownBoard` is the pre-move
   * position while it runs and the real one after, and `replaying` gates every
   * way of acting on the board.
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
    // reply the creator wrote, as a multi-move line is answered - so each of
    // the opponent's moves slides rather than snapping into place.
    setupMove: animMove,
    imageFor,
    // Not gated on solvedByYou or on being mid-line: the card always opens on
    // the fresh position and animates each opponent move as it arrives, the
    // same way the puzzle's own page does.
    enabled: !finished,
    replayKey,
    // Only the opening move holds; each reply answers a move just made.
    immediate: found.length > 0,
  });

  /** A fresh copy of the opening position, for a restart or a wrong guess. */
  const freshBoard = useCallback(() => {
    const map = {};
    for (const pl of (puzzle?.position || [])) map[`${pl.y},${pl.x}`] = { ...pl };
    return map;
  }, [puzzle]);

  /*
   * Start the puzzle over on the card itself. Everything the solver built up is
   * cleared and the opponent's opening move is re-armed, so "Play it again"
   * replays the position from the top rather than sending them elsewhere.
   */
  const restart = useCallback(() => {
    setBoard(freshBoard());
    setFound([]);
    setVerdict(null);
    setPicked(null);
    setHints([]);
    setLastTry(null);
    setTrayPick(null);
    setPendingPromotion(null);
    setRatingChange(null);
    setRatingNote(null);
    setStartedAt(Date.now());
    setAnimMove(puzzle?.setup_move || null);
    hintCache.current = new Map();
    setReplayKey((k) => k + 1);
  }, [freshBoard, puzzle]);

  /*
   * Send a move and act on the verdict.
   *
   * Split out of tryMove so a promotion can interrupt: the lookup below stops to
   * ask which piece it becomes, and this is what the answer resumes into. `art`
   * is the chosen piece's name and image, for the optimistic board only.
   */
  const submitMove = useCallback(async (move, before, art = null) => {
    if (!puzzle) return;
    const { x, y } = move.to;
    setBusy(true);
    setLastTry({ x, y });
    // From `before`, not `prev`: the caller already placed the piece the moment
    // it was dropped, and applying from the board it started on means doing it
    // twice lands in the same place instead of moving it again.
    setBoard(applyMove(before, move, null, art));

    try {
      const attemptLine = [...found, move];
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzle.id}/solve`,
        { moves: attemptLine, duration_ms: Date.now() - startedAt },
        { headers: authHeader() }
      );
      if (data.rating) setRatingChange(data.rating);
      else if (data.ratingNote) setRatingNote(data.ratingNote);

      if (data.solved) {
        setFound(attemptLine);
        // This move to the end of the line, replayed onto the board it started
        // from - the server's version carries the promotion piece, so it
        // replaces the guess rather than stacking on it.
        setBoard(data.position
          ? fromServerPosition(data.position)
          : solvedPliesRemaining(data.solution, found.length, move)
              .reduce((cells, ply) => applyMove(cells, ply), before));
        setVerdict({ status: 'solved', text: 'That is it — solved.' });
      } else if (data.status === 'continue') {
        // Right so far: play the move, then the answer the creator wrote for
        // it, so the board shows the position the next move starts from.
        setFound(attemptLine);
        setBoard(data.position
          ? fromServerPosition(data.position)
          : applyMove(applyMove(before, move), data.reply));
        // Slide the opponent's reply in, the same as the opening move.
        if (data.reply?.from && data.reply?.to) {
          setAnimMove(data.reply);
          setReplayKey((k) => k + 1);
        } else {
          setAnimMove(null);
        }
        setLastTry(data.reply ? { x: data.reply.to.x, y: data.reply.to.y } : { x, y });
        hintCache.current = new Map();
        const left = (data.movesTotal || 0) - (data.movesPlayed || 0);
        setVerdict({
          status: 'continue',
          text: left === 1 ? 'Good — one move left.' : `Good — ${left} moves left.`,
        });
      } else {
        // Off the line. The guess comes back off, but the moves already found
        // stay, so they try again from where they were rather than starting the
        // whole puzzle over.
        setBoard(before);
        setLastTry({ x, y });
        setVerdict({ status: 'wrong', text: 'Not that one. Try again.' });
      }
    } catch (_) {
      setBoard(before);
      setVerdict({ status: 'error', text: 'Could not submit that move.' });
    } finally {
      setBusy(false);
    }
  }, [puzzle, found, startedAt]);

  /*
   * Ask what the move actually is, then send it.
   *
   * A promotion stops here rather than being sent: the piece is part of the
   * answer, so it has to be chosen first. That used to mean leaving the home
   * card for the puzzle's own page mid-puzzle - the card could start a puzzle it
   * could not finish. The dialog is the same one the puzzle page uses.
   */
  const tryMove = useCallback(async (fromKey, x, y) => {
    if (!puzzle || busy || finished) return;
    const [fy, fx] = fromKey.split(',').map(Number);
    const mover = board?.[fromKey];
    setPicked(null);
    setHints([]);
    setLastTry({ x, y });
    const move = {
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    };

    // The position the guess is made against, so every outcome rebuilds from it.
    const before = board;
    /*
     * The piece moves NOW, before the lookup below.
     *
     * That lookup is a round trip, and until this was here the piece sat back
     * on the square it was dragged from for the whole of it - so the drop read
     * as "nothing happened" and then the piece jumped. The lookup refines the
     * move; it does not decide whether it happens.
     */
    setBoard(applyMove(before, move));
    setBusy(true);
    try {
      const info = await axios.post(
        `${API_URL}game-types/${puzzle.game_type_id}/puzzle-move-info`,
        {
          position: Object.values(before || {}),
          side_to_move: puzzle.side_to_move,
          setup_move: found.length ? null : puzzle.setup_move,
          move,
        },
        { headers: authHeader() }
      ).catch(() => null);

      if (info?.data?.castling) {
        move.isCastling = true;
        move.castlingWith = info.data.castling.castlingWith;
        move.castlingDirection = info.data.castling.castlingDirection;
      }

      if (info?.data?.promotes && Array.isArray(info.data.options) && info.data.options.length) {
        setBusy(false);
        setPendingPromotion({ move, before, options: info.data.options });
        return;
      }
    } catch (_) {
      // The lookup is an improvement, not a gate - send the move as it stands.
    }
    await submitMove(move, before);
  }, [puzzle, busy, finished, board, found, submitMove]);

  const choosePromotion = useCallback((option) => {
    const pending = pendingPromotion;
    setPendingPromotion(null);
    if (!pending) return;
    submitMove(
      {
        ...pending.move,
        promotionPieceId: option.id,
        ...(option.player != null ? { promotionPlayer: option.player } : {}),
      },
      pending.before,
      { piece_name: option.piece_name || null, image_location: option.image_location || null },
    );
  }, [pendingPromotion, submitMove]);

  /** This piece's moves, from the cache when we already asked. */
  const loadHints = useCallback(async (x, y) => {
    if (!puzzle) return [];
    const key = `${y},${x}`;
    if (hintCache.current.has(key)) return hintCache.current.get(key);
    try {
      // The CURRENT position, not the puzzle's opening one: past the first move
      // the piece to move sits somewhere the starting board never had it, so the
      // stored-position endpoint would light up the wrong squares, or none.
      const { data } = await axios.post(
        `${API_URL}game-types/${puzzle.game_type_id}/puzzle-moves`,
        {
          position: Object.values(board || {}),
          side_to_move: puzzle.side_to_move,
          setup_move: found.length ? null : puzzle.setup_move,
          x, y,
        },
        { headers: authHeader() }
      );
      const moves = data?.moves || [];
      hintCache.current.set(key, moves);
      return moves;
    } catch (_) {
      return [];
    }
  }, [puzzle, board, found]);

  const hoverSquare = useCallback(async (x, y) => {
    // A held piece or a drag in progress owns the dots; hover must not fight it.
    // Nor may it describe a board the opponent's move is still arriving on.
    if (!puzzle || finished || picked || drag || replaying) return;
    if (!board?.[`${y},${x}`]) { setHints([]); return; }
    const moves = await loadHints(x, y);
    // The pointer may have moved on while the request was out.
    setHints((prev) => (picked || drag ? prev : moves));
  }, [puzzle, finished, picked, drag, replaying, board, loadHints]);

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
    // `replaying`: a piece picked up mid-replay would be dragged off a
    // position that is about to change under it.
    if (!puzzle || busy || finished || replaying) return;
    const key = `${y},${x}`;
    const here = board?.[key];
    if (!here || Number(here.player_id) !== Number(puzzle.side_to_move)) return;
    setPicked(key);
    setVerdict(null);
    setDrag({ fromKey: key, x: e.clientX, y: e.clientY });
    loadHints(x, y).then(setHints);
  }, [puzzle, busy, finished, replaying, board, loadHints]);

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
    // The browser took the gesture over (a scroll, a system swipe): the
    // drag ends where it started, with the piece still picked up.
    const onCancel = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [drag, squareAt, tryMove]);

  /*
   * Answer by putting a piece down. One click rather than two - there is no
   * piece on the board to pick up first - and the resulting board comes back
   * from the server, because a placement's captures (a surrounded group in Go)
   * are not something this card can work out.
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
    // Show the piece down straight away; the server's board replaces this the
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
      const attemptLine = [...found, move];
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzle.id}/solve`,
        { moves: attemptLine, duration_ms: Date.now() - startedAt },
        { headers: authHeader() }
      );
      if (data.rating) setRatingChange(data.rating);
      else if (data.ratingNote) setRatingNote(data.ratingNote);
      if (data.position) setBoard(fromServerPosition(data.position));
      if (data.solved) {
        setFound(attemptLine);
        setVerdict({ status: 'solved', text: 'That is it — solved.' });
      } else if (data.status === 'continue') {
        // Played out in place, the same as a move-based line: keep what has
        // been found and let the next placement continue it.
        setFound(attemptLine);
        hintCache.current = new Map();
        const left = (data.movesTotal || 0) - (data.movesPlayed || 0);
        setVerdict({
          status: 'continue',
          text: left === 1 ? 'Good — one move left.' : `Good — ${left} moves left.`,
        });
      } else {
        // Off the line: take the guess back off and keep what was found, so the
        // next try continues rather than restarting the puzzle.
        setBoard(before);
        setVerdict({ status: 'wrong', text: 'Not this one. Try another square.' });
      }
    } catch (_) {
      setBoard(before);
      setVerdict({ status: 'error', text: 'Could not check that just now.' });
    } finally {
      setBusy(false);
      setTrayPick(null);
    }
  }, [puzzle, busy, finished, trayPick, board, found, startedAt]);

  const clickSquare = useCallback((x, y) => {
    if (!puzzle || busy || finished || replaying) return;
    if (trayPick) { tryPlace(x, y); return; }
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
  }, [puzzle, busy, finished, replaying, board, picked, tryMove, loadHints, trayPick, tryPlace]);

  // Built from the REPLAY's board, so the squares show the pre-move position
  // while the opponent's move is arriving and the real one afterwards.
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

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  /*
   * Ticked every second, but held as the FORMATTED string rather than as a
   * number of seconds: for most of the day the label only changes once a
   * minute, and setting state to a string it already equals is a no-op in
   * React. So the panel - board, drag handlers and all - re-renders when the
   * countdown actually moves, not sixty times a minute.
   */
  const [nextPuzzleIn, setNextPuzzleIn] = useState(timeUntilNextPuzzle);
  useEffect(() => {
    const id = setInterval(() => setNextPuzzleIn(timeUntilNextPuzzle()), 1000);
    return () => clearInterval(id);
  }, []);

  const dragSrc = drag ? imageFor(board?.[drag.fromKey]) : null;

  return (
    <section className={styles["puzzles-section"]} aria-label="Puzzles">
      {/* The opponent's last move, in flight. */}
      {replayPiece && (
        <img src={replayPiece.src} alt={replayPiece.alt} style={replayPiece.style} draggable={false} />
      )}
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
                  liftedSquare={picked}
                  onSquareMouseEnter={hoverSquare}
                  onSquareMouseLeave={unhoverSquare}
                />
              </div>

              {/* Only appears for a game that places pieces, which is where the
                  answer is "put one here" rather than "move this there". */}
              <PlacementTray
                items={placesPieces(puzzle) ? expandPlaceable(puzzle.placeable_pieces, puzzle.player_count) : []}
                heldKey={trayPick?.key}
                onPick={(item) => { setTrayPick(item); setPicked(null); setHints([]); }}
                label="Answer by placing"
                disabled={busy || finished || replaying}
                imageFor={(item) => imageFor({
                  piece_id: item.template.piece_id,
                  image_location: item.template.image_location,
                  player_id: item.player || 1,
                })}
              />

              {/* The same dialog the puzzle's own page uses, so a promotion can
                  be finished here instead of sending the solver away. */}
              {pendingPromotion && (
                <PromotionChooser
                  options={pendingPromotion.options}
                  defaultPlayer={puzzle.side_to_move}
                  imageFor={imageFor}
                  onChoose={choosePromotion}
                  onCancel={() => {
                    setBoard(pendingPromotion.before);
                    setPendingPromotion(null);
                  }}
                />
              )}

              <div className={styles["daily-info"]}>
                <h3 className={styles["daily-title"]}>
                  <Link to={`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`}>
                    {puzzle.title || 'Today’s puzzle'}
                  </Link>
                  {daily.solvedByYou && <span className={styles["solved-tick"]} title="You have solved this">✓</span>}
                  {/* Whose move it is decides everything about how the board
                      reads, so it belongs with the title rather than adrift
                      below it. Separated, not stacked - one line, two facts. */}
                  <span className={styles["title-sep"]} aria-hidden="true">|</span>
                  <span className={styles["turn-inline"]}>
                    <span className={styles[`turn-p${puzzle.side_to_move}`]} aria-hidden="true" />
                    Player {puzzle.side_to_move} to move
                  </span>
                </h3>


                {/*
                  * One row of facts about this puzzle - where it is from, who
                  * wrote it, which day it is, how long it has left, and what
                  * kind of puzzle it is.
                  *
                  * A div of spans rather than a sentence, because each fact has
                  * to stay whole when the row wraps: a date broken across two
                  * lines reads as two dates. Each span is nowrap and the
                  * separators are drawn by CSS between them, so wrapping moves
                  * facts around without ever splitting one.
                  */}
                <div className={styles["daily-facts"]}>
                  <span className={styles["fact"]}>
                    from <Link to={`/games/${puzzle.game_type_id}`}>{puzzle.game_name}</Link>
                  </span>
                  {puzzle.creator_username && (
                    <span className={styles["fact"]}>puzzle by {puzzle.creator_username}</span>
                  )}
                  <span className={styles["fact"]}>{today}</span>
                  {!!nextPuzzleIn && (
                    <span className={styles["fact"]} title="Puzzles change at midnight Eastern">
                      next in {nextPuzzleIn}
                    </span>
                  )}
                  {/*
                    * The goal and how long it takes, as ONE fact.
                    *
                    * They were two pills in two different rows, which read as
                    * two unrelated labels when they are really one sentence:
                    * checkmate, in three. Plain text in the same row as
                    * everything else, because a pill implies something you can
                    * press.
                    */}
                  {(puzzle.goal_label || puzzle.solution_depth > 1) && (
                    <span className={styles["fact"]}>
                      {[puzzle.goal_label,
                        puzzle.solution_depth > 1 ? `in ${puzzle.solution_depth} moves` : null]
                        .filter(Boolean).join(' ')}
                    </span>
                  )}
                  {puzzle.rating != null && (
                    <span className={styles["fact"]}>rated {puzzle.rating}</span>
                  )}
                </div>
                <GameRulesModal
                  puzzleId={puzzle.id}
                  open={rulesOpen}
                  onClose={() => setRulesOpen(false)}
                />
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
                {ratingChange && (
                  <p className={styles["rating-change"]}>
                    Puzzle rating {ratingChange.before} → <strong>{ratingChange.after}</strong>{' '}
                    <span className={ratingChange.delta >= 0 ? styles["delta-up"] : styles["delta-down"]}>
                      {ratingChange.delta >= 0 ? `+${ratingChange.delta}` : ratingChange.delta}
                    </span>
                  </p>
                )}
                {!ratingChange && ratingNote && (
                  <p className={styles["muted"]}>{ratingNote}</p>
                )}
                <div className={styles["daily-actions"]}>
                  {finished ? (
                    <>
                      <button
                        type="button"
                        className={styles["btn-primary"]}
                        onClick={restart}
                      >
                        Play it again
                      </button>
                      <Link
                        to={`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`}
                        className={styles["btn-secondary"]}
                      >
                        See the full puzzle
                      </Link>
                    </>
                  ) : (
                    <Link
                      to={`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`}
                      className={styles["btn-secondary"]}
                    >
                      Open Puzzle #{puzzle.id}
                    </Link>
                  )}
                  {/* The rules sit at the end, beside the way out to the full
                      page: both are "somewhere else to look", and neither is
                      the thing to do next. */}
                  <button
                    type="button"
                    className={styles["btn-secondary"]}
                    onClick={() => setRulesOpen(true)}
                  >
                    {puzzle.game_name || 'Game'} Rules
                  </button>
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
              {FREE_PUZZLES_PER_GAME} puzzles for each game they've created. Silver Supporters can build
              as many as they like.
            </li>
            <li>
              <strong>Any game, any pieces.</strong> A puzzle can come from any game on
              the site, so finding the answer might depend on knowing the rules and the typical patterns of the game.
            </li>
            <li>
              <strong>Yours could be Puzzle of the Day.</strong> Publish it, press
              &ldquo;Check puzzle&rdquo; and get a clean result with exactly one answer, and
              leave the daily rotation switched on — it is on by default. The game it
              belongs to has to be in the daily pool, which wants a board close to square
              and at least three different piece types a side. The builder lists the full
              set of requirements, and tells you which ones a puzzle already meets.
            </li>
          </ul>

          <div className={styles["about-actions"]}>
            <Link to="/play/puzzles" className={styles["btn-secondary"]}>Find puzzles</Link>
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
