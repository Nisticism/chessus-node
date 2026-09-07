import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { getPieceById } from "../../actions/pieces";
import { hasStaffRole } from "../../helpers/supporterTiers";
import {
  createMoveEngine,
  getMoveDotType,
  MOVE_DOT_BACKGROUNDS,
} from "../../helpers/moveEngine";
import useBoardViewport from "../common/useBoardViewport";
import BoardZoomControls from "../common/BoardZoomControls";
import boardVp from "../common/boardViewport.module.scss";
import styles from "./puzzlesolver.module.scss";

/*
 * Puzzle solver.
 *
 * Open to everyone, signed in or not - only BUILDING puzzles is a supporter
 * perk. A signed-in solver's attempts are recorded against them; a guest's are
 * anonymous.
 *
 * The answer is never in the page. The client posts the move it played and the
 * server decides, so the solution only arrives once it has been found or the
 * solver has asked to see it. Checking client-side would put the answer one
 * view-source away.
 */

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";
const resolveUrl = (p) => (!p ? null : (p.startsWith('http') ? p : `${ASSET_URL}${p}`));
const keyOf = (x, y) => `${y},${x}`;

const imageFor = (placement, pieceDataMap) => {
  if (placement?.image_url) return resolveUrl(placement.image_url);
  const loc = placement?.image_location || pieceDataMap[placement?.piece_id]?.image_location;
  if (!loc) return null;
  try {
    const images = typeof loc === 'string' ? JSON.parse(loc) : loc;
    if (Array.isArray(images) && images.length) {
      const idx = Math.min(Number(placement.player_id || 1) - 1, images.length - 1);
      return resolveUrl(images[Math.max(0, idx)]);
    }
  } catch (_) { /* fall through */ }
  return null;
};

/*
 * The `pieces` table's column names are not the names the move engine reads. A
 * live game renames eight of them when it builds its piece objects; spreading a
 * raw row without doing the same leaves the engine seeing no movement, silently
 * - which is why a knight would show no hover dots at all.
 */
const ENGINE_FIELD_RENAMES = {
  ratio_one_movement: 'ratio_movement_1',
  ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1',
  ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};

const toEngineFields = (row) => {
  const out = { ...row };
  for (const [from, to] of Object.entries(ENGINE_FIELD_RENAMES)) {
    if (row?.[from] !== undefined) out[to] = row[from];
  }
  return out;
};

/** Move a piece on the board map. Anything unplayable is left alone. */
const applyPly = (cells, ply) => {
  if (!ply?.from || !ply?.to) return cells;
  const fromKey = keyOf(ply.from.x, ply.from.y);
  const mover = cells[fromKey];
  if (!mover) return cells;
  const next = { ...cells };
  delete next[fromKey];
  next[keyOf(ply.to.x, ply.to.y)] = {
    // A piece keeps the id it had on its starting square, so a second move by
    // the same piece quotes that one rather than its current square.
    ...mover,
    id: mover.id || `${mover.piece_id}_${ply.from.y}_${ply.from.x}`,
    x: ply.to.x,
    y: ply.to.y,
  };
  return next;
};

const goalText = (p) => {
  if (!p) return '';
  if (p.goal === 'checkmate_in_1') return 'Checkmate in one move';
  return p.goal_description || (p.goal === 'win_material' ? 'Win material' : 'Find the move');
};

const FEEDBACK_CATEGORIES = [
  { value: 'multiple_solutions', label: 'Another move also works' },
  { value: 'no_solution', label: "I don't think this can be solved" },
  { value: 'unclear_goal', label: 'The goal is unclear' },
  { value: 'too_easy', label: 'Too easy' },
  { value: 'too_hard', label: 'Too hard' },
  { value: 'praise', label: 'Nice puzzle' },
  { value: 'other', label: 'Something else' },
];

const PuzzleSolver = () => {
  const { gameId, puzzleId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  const [puzzle, setPuzzle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pieceDataMap, setPieceDataMap] = useState({});

  const [placements, setPlacements] = useState({});
  const [selected, setSelected] = useState(null);
  const [lastTry, setLastTry] = useState(null);   // {from,to}
  const [outcome, setOutcome] = useState(null);   // 'solved' | 'wrong' | 'revealed' | 'continue'
  /*
   * A puzzle can run to several moves. The moves found so far are re-sent with
   * every submission rather than kept on the server, so a reload picks up where
   * it left off, and the answer still never reaches the page: the server hands
   * back only the opponent's reply to a move already found.
   */
  const [playedMoves, setPlayedMoves] = useState([]);
  const [progress, setProgress] = useState(null); // { played, total }
  const [attempts, setAttempts] = useState(0);
  const [solution, setSolution] = useState(null);
  const [ratingChange, setRatingChange] = useState(null);
  const [ratingNote, setRatingNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(() => Date.now());

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState('other');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackNotice, setFeedbackNotice] = useState(null);
  const [duplicateError, setDuplicateError] = useState(null);
  const [hoveredMoves, setHoveredMoves] = useState([]);
  /*
   * Dragging a piece.
   *
   * Not HTML5 drag-and-drop: the piece images are `pointer-events: none` (so a
   * click lands on the square, not the picture), which means they can never
   * start a native drag - and a native drag gives a translucent browser ghost
   * rather than the piece itself moving. Pointer events instead, with the piece
   * drawn under the cursor.
   *
   * `pending` is a press that has not moved far enough to count as a drag yet,
   * so a plain click still selects rather than being swallowed.
   */
  const [drag, setDrag] = useState(null); // { fromKey, x, y }
  const pendingRef = useRef(null);        // { fromKey, startX, startY }
  const boardRef = useRef(null);

  const boardWidth = puzzle?.board_width || 8;
  const boardHeight = puzzle?.board_height || 8;
  const lightColor = currentUser?.light_square_color || localStorage.getItem('boardLightColor') || '#e3d4bf';
  const darkColor = currentUser?.dark_square_color || localStorage.getItem('boardDarkColor') || '#64472b';

  const vp = useBoardViewport({
    boardWidth,
    boardHeight,
    fitMaxSquare: 78,
    maxSquare: 160,
    maxHeight: () => Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 300),
    insetW: 8,
    insetH: 8,
  });

  // Same shape as the builder: a floor keeps the hook's measurement stable, and
  // above it the column follows the board's current size so zooming expands
  // sideways instead of clipping. See the builder for the full reasoning.
  const boardColumnMax = useMemo(() => {
    const heightBudget = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 300);
    const byHeight = Math.floor((heightBudget - 8) / Math.max(1, boardHeight));
    const fitSquare = Math.max(6, Math.min(78, byHeight));
    const floorPx = Math.max(120, fitSquare * boardWidth + 24);
    const zoomedPx = (vp.squareSize || 0) * boardWidth + 24;
    const widgetPx = vp.placement === 'side' ? 64 : 0;
    return Math.max(floorPx, zoomedPx) + widgetPx;
  }, [boardWidth, boardHeight, vp.squareSize, vp.placement]);

  const isSkinnyBoard = boardHeight >= boardWidth * 2;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}puzzles/${puzzleId}`, { headers: authHeader() });
        if (cancelled) return;
        const p = data.puzzle;
        setPuzzle(p);
        const map = {};
        (p.position || []).forEach((pl) => { map[keyOf(pl.x, pl.y)] = pl; });
        setPlacements(map);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Could not load this puzzle');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [puzzleId]);

  // Board dimensions are not on the puzzle row; take them from the game type.
  const [board, setBoard] = useState(null);
  useEffect(() => {
    if (!puzzle) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}games/${puzzle.game_type_id}`);
        if (!cancelled) setBoard(data);
      } catch (_) { /* fall back to 8x8 */ }
    })();
    return () => { cancelled = true; };
  }, [puzzle]);
  useEffect(() => {
    if (board && puzzle && (puzzle.board_width !== board.board_width)) {
      setPuzzle((p) => ({ ...p, board_width: board.board_width, board_height: board.board_height, game_name: board.game_name }));
    }
  }, [board, puzzle]);

  useEffect(() => {
    const ids = [...new Set(Object.values(placements).map((p) => p.piece_id).filter(Boolean))];
    const missing = ids.filter((id) => !pieceDataMap[id]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const loaded = {};
      await Promise.all(missing.map(async (id) => {
        try { loaded[id] = await getPieceById(id); } catch (_) { /* image falls back */ }
      }));
      if (!cancelled && Object.keys(loaded).length) setPieceDataMap((prev) => ({ ...prev, ...loaded }));
    })();
    return () => { cancelled = true; };
  }, [placements, pieceDataMap]);

  /*
   * The board stores compact placements; the move engine needs full pieces. This
   * is the same merge the server does before it validates - piece definition,
   * plus board position, plus the per-game-type flags that make a piece royal.
   */
  const enginePieces = useMemo(() => {
    return Object.entries(placements).map(([k, pl]) => {
      const [y, x] = k.split(',').map(Number);
      const def = toEngineFields(pieceDataMap[pl.piece_id] || {});
      const player = Number(pl.player_id ?? pl.team ?? 1);
      return {
        ...def,
        id: pl.id || `${pl.piece_id}_${y}_${x}`,
        piece_id: pl.piece_id,
        x, y,
        player_id: player,
        team: player,
        ends_game_on_checkmate: pl.ends_game_on_checkmate ?? def.ends_game_on_checkmate ?? false,
        ends_game_on_capture: pl.ends_game_on_capture ?? def.ends_game_on_capture ?? false,
      };
    });
  }, [placements, pieceDataMap]);

  const specialSquares = useMemo(() => {
    const squares = { range: {}, promotion: {}, control: {}, special: {} };
    if (!board) return squares;
    const fields = {
      range: 'range_squares_string',
      promotion: 'promotion_squares_string',
      control: 'control_squares_string',
      special: 'special_squares_string',
    };
    for (const [key, field] of Object.entries(fields)) {
      try { if (board[field]) squares[key] = JSON.parse(board[field]); } catch (_) { /* ignore */ }
    }
    return squares;
  }, [board]);

  // currentPlayerPosition null, same as the replay board: hovering shows a
  // piece's raw reachability rather than filtering by whose turn it is.
  const moveEngine = useMemo(() => createMoveEngine({
    specialSquares,
    gameType: board,
    enPassantTarget: null,
    currentPlayerPosition: null,
  }), [specialSquares, board]);

  const hoverPiece = useCallback((piece) => {
    if (!piece || !board) { setHoveredMoves([]); return; }
    // Same arguments a live game's hover helpers use, so a piece's dots read
    // identically in a puzzle and in a game.
    setHoveredMoves(moveEngine.calculateValidMoves(
      piece, enginePieces, boardWidth, boardHeight,
      false,  // skipCheckFilter
      false,  // forPremove
      true    // forHoverDisplay
    ) || []);
  }, [moveEngine, enginePieces, board, boardWidth, boardHeight]);

  const submit = useCallback(async (move) => {
    setBusy(true);
    setLastTry(move);
    const attemptLine = [...playedMoves, move];
    try {
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzleId}/solve`,
        { moves: attemptLine, duration_ms: Date.now() - startedAt },
        { headers: authHeader() }
      );
      if (data.rating) setRatingChange(data.rating);
      else if (data.ratingNote) setRatingNote(data.ratingNote);
      if (Number.isFinite(data.movesTotal)) {
        setProgress({ played: data.movesPlayed || 0, total: data.movesTotal });
      }

      if (data.status === 'continue') {
        // Right so far: play the move, then the answer the creator wrote for it.
        setPlayedMoves(attemptLine);
        setPlacements((prev) => applyPly(applyPly(prev, move), data.reply));
        setLastTry(data.reply || move);
        setOutcome('continue');
        return;
      }
      if (data.solved) {
        const line = data.solution || attemptLine;
        setPlayedMoves(attemptLine);
        // Everything from here to the end of the line: this move, plus any
        // reply the creator wrote after it.
        setPlacements((prev) => line.slice(playedMoves.length * 2).reduce(applyPly, prev));
        setSolution(line);
        setOutcome('solved');
        return;
      }
      // Off the line. The board stays where it is, so they can try again from
      // the same position.
      setAttempts((n) => n + 1);
      setOutcome('wrong');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not submit that move');
    } finally {
      setBusy(false);
    }
  }, [puzzleId, startedAt, playedMoves]);

  const reveal = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzleId}/solve`,
        // What they found before giving up, so a part-solved line still scores.
        { moves: playedMoves, revealed: true, duration_ms: Date.now() - startedAt },
        { headers: authHeader() }
      );
      const line = data.solution || null;
      setSolution(line);
      if (Array.isArray(line)) {
        setPlacements((prev) => line.slice(playedMoves.length * 2).reduce(applyPly, prev));
      }
      if (data.rating) setRatingChange(data.rating);
      setOutcome('revealed');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load the solution');
    } finally {
      setBusy(false);
    }
  }, [puzzleId, playedMoves, startedAt]);

  const playFrom = useCallback((fromKey, x, y) => {
    const [fy, fx] = fromKey.split(',').map(Number);
    const mover = placements[fromKey];
    setSelected(null);
    setHoveredMoves([]);
    submit({
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    });
  }, [placements, submit]);

  /** Which square a client-space point is over, or null if it is off the board. */
  const squareAtPoint = useCallback((clientX, clientY) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || !vp.squareSize) return null;
    const x = Math.floor((clientX - rect.left) / vp.squareSize);
    const y = Math.floor((clientY - rect.top) / vp.squareSize);
    if (x < 0 || y < 0 || x >= boardWidth || y >= boardHeight) return null;
    return { x, y };
  }, [vp.squareSize, boardWidth, boardHeight]);

  /*
   * Editing is the creator's, plus admins and owners - the same rule the server
   * enforces on the update route, mirrored here only to decide whether to draw
   * the buttons. The server is what actually refuses.
   */
  const canManage = !!currentUser && !!puzzle
    && (Number(puzzle.creator_id) === Number(currentUser.id) || hasStaffRole(currentUser));

  const duplicatePuzzle = useCallback(async () => {
    setDuplicateError(null);
    try {
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzleId}/duplicate`, {}, { headers: authHeader() }
      );
      const copy = data?.puzzle;
      if (copy?.id) navigate(`/games/${copy.game_type_id}/puzzles/${copy.id}/edit`);
    } catch (err) {
      setDuplicateError(err?.response?.data?.message || 'Could not duplicate this puzzle');
    }
  }, [puzzleId, navigate]);

  const finished = outcome === 'solved' || outcome === 'revealed';
  // How many moves the solver has to find. solution_depth counts their moves
  // only, so a 3-move line with 2 replies reads as 3.
  const movesToFind = progress?.total || Number(puzzle?.solution_depth) || 1;

  /*
   * A press on one of your own pieces. Movement past a few pixels turns it into
   * a drag; anything less stays a click, which keeps click-to-move working
   * exactly as before.
   *
   * Mouse and pen only. On touch the board deliberately keeps `touch-action`
   * alone so the page still scrolls under a finger - tapping the piece and then
   * the destination is the touch path.
   */
  const startPress = useCallback((e, x, y) => {
    if (busy || finished || e.pointerType === 'touch' || e.button !== 0) return;
    const k = keyOf(x, y);
    const here = placements[k];
    if (!here || Number(here.player_id) !== Number(puzzle?.side_to_move)) return;
    pendingRef.current = { fromKey: k, startX: e.clientX, startY: e.clientY };
  }, [busy, finished, placements, puzzle]);

  useEffect(() => {
    const DRAG_THRESHOLD_PX = 4;

    const onMove = (e) => {
      const pending = pendingRef.current;
      if (!pending) return;
      const far = Math.abs(e.clientX - pending.startX) > DRAG_THRESHOLD_PX
        || Math.abs(e.clientY - pending.startY) > DRAG_THRESHOLD_PX;
      if (!far && !drag) return;
      if (!drag) {
        // Crossed the threshold: lift the piece and show where it can go.
        const [fy, fx] = pending.fromKey.split(',').map(Number);
        hoverPiece(enginePieces.find((p) => p.x === fx && p.y === fy));
        setSelected(null);
      }
      setDrag({ fromKey: pending.fromKey, x: e.clientX, y: e.clientY });
    };

    const onUp = (e) => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending || !drag) { setDrag(null); return; }
      setDrag(null);
      setHoveredMoves([]);
      const target = squareAtPoint(e.clientX, e.clientY);
      const [fy, fx] = pending.fromKey.split(',').map(Number);
      // Dropped off the board, or back where it started: nothing happened.
      if (!target || (target.x === fx && target.y === fy)) return;
      playFrom(pending.fromKey, target.x, target.y);
    };

    const onCancel = () => { pendingRef.current = null; setDrag(null); setHoveredMoves([]); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [drag, squareAtPoint, playFrom, hoverPiece, enginePieces]);

  const handleSquareClick = useCallback((x, y) => {
    if (busy || finished) return;
    const k = keyOf(x, y);
    const here = placements[k];
    if (!selected) {
      if (!here) return;
      if (Number(here.player_id) !== Number(puzzle?.side_to_move)) return;
      setSelected(k);
      return;
    }
    if (selected === k) { setSelected(null); return; }
    playFrom(selected, x, y);
  }, [busy, finished, selected, placements, puzzle, playFrom]);

  const sendFeedback = async () => {
    setFeedbackNotice(null);
    try {
      await axios.post(
        `${API_URL}puzzles/${puzzleId}/feedback`,
        { category: feedbackCategory, message: feedbackMessage },
        { headers: authHeader() }
      );
      setFeedbackNotice({ tone: 'ok', text: "Sent to the puzzle's creator. Thanks for the note." });
      setFeedbackMessage('');
      setFeedbackOpen(false);
    } catch (err) {
      setFeedbackNotice({ tone: 'error', text: err?.response?.data?.message || 'Could not send that' });
    }
  };

  if (loading) return <div className={styles["solver-page"]}><p>Loading…</p></div>;
  if (error && !puzzle) return <div className={styles["solver-page"]}><p>{error}</p></div>;
  if (!puzzle) return null;

  const solutionPlies = Array.isArray(solution) ? solution.filter(Boolean) : [];
  const sol = solutionPlies[0] || null;
  const squares = [];
  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const k = keyOf(x, y);
      const p = placements[k];
      const isLight = (x + y) % 2 === 0;
      const setup = puzzle.setup_move;
      const classes = [
        styles["square"],
        selected === k ? styles["selected"] : '',
        setup && ((setup.from?.x === x && setup.from?.y === y) || (setup.to?.x === x && setup.to?.y === y)) ? styles["setup"] : '',
        lastTry && lastTry.to.x === x && lastTry.to.y === y && outcome === 'wrong' ? styles["wrong"] : '',
        sol && sol.from?.x === x && sol.from?.y === y ? styles["sol-from"] : '',
        sol && sol.to?.x === x && sol.to?.y === y ? styles["sol-to"] : '',
      ].filter(Boolean).join(' ');
      const src = imageFor(p, pieceDataMap);
      const dot = hoveredMoves.find((m) => m.x === x && m.y === y);
      const mine = p && Number(p.player_id) === Number(puzzle.side_to_move);
      const isDragOrigin = !!drag && drag.fromKey === k;
      // Placements only have to carry a piece id; the name lives on the piece
      // definition, so fall back to it rather than showing "undefined".
      const pieceName = p ? (p.piece_name || pieceDataMap[p.piece_id]?.piece_name || 'Piece') : '';
      squares.push(
        <div
          key={k}
          className={`${classes}${mine && !finished ? ` ${styles["grabbable"]}` : ''}`}
          style={{ background: isLight ? lightColor : darkColor, width: vp.squareSize, height: vp.squareSize }}
          onClick={() => handleSquareClick(x, y)}
          onPointerDown={(e) => startPress(e, x, y)}
          onMouseEnter={() => { if (!finished && !selected && !drag) hoverPiece(enginePieces.find((e) => e.x === x && e.y === y)); }}
          onMouseLeave={() => { if (!selected && !drag) setHoveredMoves([]); }}
          title={p ? `${pieceName} (Player ${p.player_id})` : ''}
        >
          {src
            ? <img
                src={src}
                alt={pieceName}
                draggable={false}
                // While it is being dragged the piece is drawn under the cursor
                // instead, so the square it came from reads as empty.
                style={isDragOrigin ? { opacity: 0 } : undefined}
              />
            : (p ? <span className={styles["piece-fallback"]}>{(pieceName || '?').charAt(0)}</span> : null)}
          {/* Same movement helpers as a live game: blue for a move, red for an
              attack, split when a piece can do both on that square. */}
          {dot && (
            <span
              className={styles["move-dot"]}
              style={{ background: MOVE_DOT_BACKGROUNDS[getMoveDotType(dot)] }}
            />
          )}
        </div>
      );
    }
  }

  // The piece currently in hand, drawn at the cursor. Fixed-position and
  // pointer-transparent so it cannot swallow the pointerup that drops it.
  const draggedPlacement = drag ? placements[drag.fromKey] : null;
  const draggedSrc = draggedPlacement ? imageFor(draggedPlacement, pieceDataMap) : null;

  return (
    <div className={`${styles["solver-page"]}${isSkinnyBoard ? ` ${styles["skinny"]}` : ''}`}>
      {drag && draggedSrc && (
        <img
          className={styles["drag-piece"]}
          src={draggedSrc}
          alt=""
          style={{
            left: drag.x,
            top: drag.y,
            width: vp.squareSize,
            height: vp.squareSize,
          }}
        />
      )}
      <h1>{puzzle.title || 'Puzzle'}</h1>
      <p className={styles["subtitle"]}>
        {puzzle.game_name && <>in <Link to={`/games/${puzzle.game_type_id}`}>{puzzle.game_name}</Link></>}
        {puzzle.creator_username && <> · by {puzzle.creator_username}</>}
      </p>

      <div className={styles["layout"]}>
        <div className={styles["board-side"]} style={{ width: boardColumnMax, maxWidth: '100%' }}>
          <div style={{ ...vp.frameStyle, justifyContent: 'flex-start' }}>
            <div
              className={`${boardVp.viewport} ${vp.hideScrollbars ? boardVp.noScrollbars : ''}`}
              ref={vp.viewportRef}
              style={vp.viewportStyle}
            >
              <div style={vp.contentStyle}>
                <div
                  className={styles["board"]}
                  ref={boardRef}
                  style={{ gridTemplateColumns: `repeat(${boardWidth}, ${vp.squareSize}px)` }}
                >
                  {squares}
                </div>
              </div>
            </div>
            <BoardZoomControls {...vp.controlProps} />
          </div>
        </div>

        <div className={styles["panel"]}>
          <div className={styles["goal"]}>
            <span className={styles["goal-label"]}>Your goal</span>
            <span className={styles["goal-text"]}>{goalText(puzzle)}</span>
            <span className={styles["goal-side"]}>
              You are Player {puzzle.side_to_move}.
              {puzzle.rating_public && puzzle.rating != null && (
                <> · Rated {puzzle.rating} by {puzzle.rating_sample_count} solvers</>
              )}
            </span>
          </div>

          {puzzle.description && <p className={styles["description"]}>{puzzle.description}</p>}

          {/* Creator tools. Deliberately below the goal rather than beside the
              title: they are for the few people who can use them, and a solver
              should meet the puzzle first. */}
          {canManage && (
            <div className={styles["manage-row"]}>
              <button
                type="button"
                className={styles["btn-secondary"]}
                onClick={() => navigate(`/games/${puzzle.game_type_id}/puzzles/${puzzle.id}/edit`)}
              >
                ✏️ Edit puzzle
              </button>
              <button
                type="button"
                className={styles["btn-secondary"]}
                onClick={duplicatePuzzle}
                title="Copies this position and solution into a new draft you can change"
              >
                ⧉ Duplicate as draft
              </button>
            </div>
          )}
          {duplicateError && (
            <div className={`${styles["notice"]} ${styles["notice-warn"]}`}>{duplicateError}</div>
          )}

          {outcome === 'solved' && (
            <div className={`${styles["notice"]} ${styles["notice-ok"]}`}>
              Solved{attempts === 0
                ? ' first try'
                : ` after ${attempts} wrong ${attempts === 1 ? 'try' : 'tries'}`}. Nicely done.
            </div>
          )}
          {outcome === 'continue' && (
            <div className={`${styles["notice"]} ${styles["notice-ok"]}`}>
              That's it. Your opponent has answered — keep going.
            </div>
          )}
          {outcome === 'wrong' && (
            <div className={`${styles["notice"]} ${styles["notice-warn"]}`}>
              Not that one. Try again — the position is unchanged.
            </div>
          )}
          {/* Only worth showing once there is more than one move to find. */}
          {movesToFind > 1 && !finished && (
            <div className={styles["progress"]}>
              Move <strong>{(progress?.played || 0) + 1}</strong> of {movesToFind}
            </div>
          )}
          {ratingChange && (
            <div className={styles["rating-change"]}>
              Puzzle rating {ratingChange.before} → <strong>{ratingChange.after}</strong>
              <span className={ratingChange.delta >= 0 ? styles["delta-up"] : styles["delta-down"]}>
                {ratingChange.delta >= 0 ? `+${ratingChange.delta}` : ratingChange.delta}
              </span>
            </div>
          )}
          {!ratingChange && ratingNote && (
            <p className={styles["hint"]}>{ratingNote}</p>
          )}
          {outcome === 'revealed' && sol && (
            <div className={`${styles["notice"]} ${styles["notice-info"]}`}>
              {solutionPlies.length > 1 ? (
                <>
                  The answer, played out on the board:
                  <ol className={styles["ply-list"]}>
                    {solutionPlies.map((ply, i) => (
                      <li key={i} className={i % 2 === 0 ? styles["ply-yours"] : styles["ply-theirs"]}>
                        <span className={styles["ply-label"]}>
                          {i % 2 === 0 ? `Move ${Math.floor(i / 2) + 1}` : 'Their reply'}
                        </span>
                        ({ply.from.x}, {ply.from.y}) → ({ply.to.x}, {ply.to.y})
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <>The answer was ({sol.from.x}, {sol.from.y}) → ({sol.to.x}, {sol.to.y}), highlighted on the board.</>
              )}
            </div>
          )}
          {error && <div className={`${styles["notice"]} ${styles["notice-error"]}`}>{error}</div>}

          {outcome !== 'solved' && outcome !== 'revealed' && (
            <p className={styles["hint"]}>
              {selected ? 'Now click where it should go.' : 'Click the piece you want to move.'}
            </p>
          )}

          <div className={styles["actions"]}>
            {outcome !== 'solved' && outcome !== 'revealed' && (
              <button className={styles["btn-secondary"]} onClick={reveal} disabled={busy}>
                Show me the answer
              </button>
            )}
            <button className={styles["btn-secondary"]} onClick={() => navigate(`/games/${puzzle.game_type_id}`)}>
              More puzzles
            </button>
          </div>

          {/* Feedback goes to the creator. It cannot take a puzzle down - it is
              a note from a solver, which is why a message is required. */}
          {currentUser && (
            <div className={styles["feedback"]}>
              {!feedbackOpen ? (
                <button className={styles["link-btn"]} onClick={() => setFeedbackOpen(true)}>
                  Send the creator a note about this puzzle
                </button>
              ) : (
                <>
                  <label className={styles["field"]}>
                    <span>What did you notice?</span>
                    <select value={feedbackCategory} onChange={(e) => setFeedbackCategory(e.target.value)}>
                      {FEEDBACK_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className={styles["field"]}>
                    <span>Your note <em>(goes to {puzzle.creator_username || 'the creator'})</em></span>
                    <textarea
                      rows={3}
                      value={feedbackMessage}
                      onChange={(e) => setFeedbackMessage(e.target.value)}
                      maxLength={2000}
                      placeholder="The bishop on the other side also seems to work…"
                    />
                  </label>
                  <div className={styles["actions"]}>
                    <button className={styles["btn"]} onClick={sendFeedback} disabled={feedbackMessage.trim().length < 10}>
                      Send
                    </button>
                    <button className={styles["link-btn"]} onClick={() => setFeedbackOpen(false)}>Cancel</button>
                  </div>
                </>
              )}
              {feedbackNotice && (
                <div className={`${styles["notice"]} ${styles[`notice-${feedbackNotice.tone}`]}`}>
                  {feedbackNotice.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PuzzleSolver;

