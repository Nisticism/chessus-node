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
import PuzzleBoard from "./PuzzleBoard";
import PlacementTray from "../common/PlacementTray";
import PromotionChooser from "../common/PromotionChooser";
import GameRulesModal from "../common/GameRulesModal";
import useSetupMoveReplay from "../common/useSetupMoveReplay";
import { expandPlaceable, placesPieces } from "../../helpers/placement";
import { applyPromotionDefinition, promotionPieceNumber, solvedPliesRemaining } from "../../helpers/pieceMovementUtils";
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
/** A server-sent position, keyed the way the board wants it. */
const fromServerPosition = (list) => {
  const out = {};
  for (const pc of (Array.isArray(list) ? list : [])) {
    out[keyOf(pc.x, pc.y)] = { ...pc };
  }
  return out;
};

/**
 * Turn the piece that just promoted into what it promoted to, in place.
 *
 * A promotion is the one move where the piece that arrives is not the piece
 * that left, so relocating it - right for every other move - kept the pawn's
 * name and artwork on the last rank for good. Not merely cosmetic either: the
 * dots drawn for the piece's next move come from what the board says it is.
 *
 * The swap itself is applyPromotionDefinition, which the game replay has always
 * used - so what survives a promotion (the square, the owner, what the piece
 * has done) is decided in one place rather than restated here.
 *
 * `art` is the promoted piece's name and image when the caller has them: the
 * chooser is handed both with every option. Without them the labels are cleared
 * rather than guessed, so the board looks the piece up by its new id - which is
 * what pieceDataMap and the effect that fills it are for - instead of showing
 * the old piece's picture with the new one's rules.
 */
const applyPromotionToCell = (cell, ply, art) => {
  const pieceId = promotionPieceNumber(ply?.promotionPieceId);
  if (pieceId == null) return;
  applyPromotionDefinition(cell, {
    piece_id: pieceId,
    piece_name: art?.piece_name || null,
    image_location: art?.image_location || null,
    // Cleared deliberately: it is the pawn's resolved picture, and it wins over
    // image_location everywhere, so leaving it would undo the whole swap.
    image_url: null,
  });
  // Cross-player and neutral promotion: the piece may not stay yours. The owner
  // is preserved by applyPromotionDefinition, so it is set after it.
  if (ply.promotionPlayer != null) cell.player_id = Number(ply.promotionPlayer);
};

const applyPly = (cells, ply, art = null) => {
  /*
   * A placement puts a NEW piece down rather than moving one. What it CAPTURES
   * is not worked out here: a stone played in Go can take a group on the far
   * side of the board, and the surround rule lives in the engine. The server
   * sends the resulting position for these games (see `position` on the solve
   * response) and that replaces this guess the moment it arrives; this is only
   * what the board shows for the fraction of a second in between.
   */
  if (ply?.type === 'place') {
    return {
      ...cells,
      [keyOf(ply.to.x, ply.to.y)]: {
        piece_id: Number(ply.placePieceId),
        player_id: Number(ply.placedBy ?? 1),
        piece_name: ply.placedName || null,
        image_location: ply.placedImage || null,
        x: ply.to.x,
        y: ply.to.y,
      },
    };
  }
  if (!ply?.from || !ply?.to) return cells;
  const fromKey = keyOf(ply.from.x, ply.from.y);
  const mover = cells[fromKey];
  if (!mover) return cells;
  const next = { ...cells };
  delete next[fromKey];
  const landed = {
    // A piece keeps the id it had on its starting square, so a second move by
    // the same piece quotes that one rather than its current square.
    ...mover,
    id: mover.id || `${mover.piece_id}_${ply.from.y}_${ply.from.x}`,
    x: ply.to.x,
    y: ply.to.y,
    // Anything that has moved has moved: this is what stops a king castling
    // twice, or a pawn double-stepping after it has already stepped.
    hasMoved: true,
    moveCount: (Number(mover.moveCount) || 0) + 1,
  };
  // A fresh object, so mutating it is nobody else's business.
  applyPromotionToCell(landed, ply, art);
  next[keyOf(ply.to.x, ply.to.y)] = landed;

  /*
   * Castling moves two pieces. The partner lands on the far side of the square
   * the king arrived at, which is what the engine does when it applies the move;
   * without doing the same here the board would keep showing a rook in the
   * corner and every later ply would be played against the wrong position.
   */
  if (ply.isCastling && ply.castlingWith) {
    const partnerKey = Object.keys(next).find((key) => {
      const pc = next[key];
      if (!pc) return false;
      if (pc.id) return pc.id === ply.castlingWith;
      const [ky, kx] = key.split(',');
      return `${pc.piece_id}_${ky}_${kx}` === ply.castlingWith;
    });
    if (partnerKey) {
      const partner = next[partnerKey];
      const px = ply.castlingDirection === 'left' ? ply.to.x + 1 : ply.to.x - 1;
      delete next[partnerKey];
      next[keyOf(px, ply.to.y)] = {
        ...partner,
        id: partner.id || ply.castlingWith,
        x: px,
        y: ply.to.y,
        hasMoved: true,
        moveCount: (Number(partner.moveCount) || 0) + 1,
      };
    }
  }
  return next;
};

/*
 * What the solver is looking for.
 *
 * The server writes this sentence, because it is the same code that decides
 * whether the goal was met - so the two can never disagree about what the puzzle
 * is asking. A creator's own words win when they wrote any; the rest is the
 * fallback for puzzles saved before goal_text existed.
 */
const goalText = (p) => {
  if (!p) return '';
  if (p.goal_text) return p.goal_text;
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
  const [startPlacements, setStartPlacements] = useState({});
  const [selected, setSelected] = useState(null);
  /*
   * The piece held from the tray, in a game where the answer is a placement.
   * Mutually exclusive with `selected`: you are either holding a piece off the
   * board or one on it, never both.
   */
  const [trayPick, setTrayPick] = useState(null);
  const [lastTry, setLastTry] = useState(null);   // {from,to}
  const [outcome, setOutcome] = useState(null);   // 'solved' | 'wrong' | 'revealed' | 'continue'
  /*
   * A puzzle can run to several moves. The moves found so far are re-sent with
   * every submission rather than kept on the server, so a reload picks up where
   * it left off, and the answer still never reaches the page: the server hands
   * back only the opponent's reply to a move already found.
   */
  const [playedMoves, setPlayedMoves] = useState([]);
  // The opponent move currently sliding in - the setup move, then each reply -
  // and a key bumped to re-arm the animation for each new one.
  const [animMove, setAnimMove] = useState(null);
  const [replayKey, setReplayKey] = useState(0);
  const [progress, setProgress] = useState(null); // { played, total }
  const [attempts, setAttempts] = useState(0);
  const [solution, setSolution] = useState(null);
  /*
   * Which step of a revealed answer the board is showing.
   *
   *   null  the final position, which is where a reveal lands
   *   -1    the position the puzzle starts from
   *   0..n  after that ply of the answer
   *
   * Same three-state shape the match review uses, because it is the same idea
   * and a person who has stepped through one game should not have to learn a
   * second set of controls.
   */
  const [revealStep, setRevealStep] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ratingChange, setRatingChange] = useState(null);
  const [ratingNote, setRatingNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(() => Date.now());

  /*
   * A promotion waiting on the solver. Same shape and the same reason as the
   * builder's: the move is held back until they pick, because the piece they
   * choose is part of the answer - moveKey includes it, so promoting to the
   * wrong piece is a different move, not the same move with a footnote.
   */
  const [pendingPromotion, setPendingPromotion] = useState(null);

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
    /*
     * As big as the screen allows, rather than as big as a guess allowed.
     *
     * The budget was `innerHeight - 300`, a fixed allowance for chrome that was
     * never measured, and the cap was a flat 78px - so on a tall desktop the
     * board sat in the middle of a screen of empty space. 'viewport' asks the
     * real question instead: everything from the top of the board to the
     * bottom of the window is the board's to use.
     */
    fitMaxSquare: () => ((typeof window !== 'undefined' && window.innerWidth > 1200) ? 120 : 78),
    maxSquare: 220,
    maxHeight: 'viewport',
    insetW: 8,
    insetH: 8,
  });

  // Same shape as the builder: a floor keeps the hook's measurement stable, and
  // above it the column follows the board's current size so zooming expands
  // sideways instead of clipping. See the builder for the full reasoning.
  const boardColumnMax = useMemo(() => {
    const heightBudget = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 300);
    const byHeight = Math.floor((heightBudget - 8) / Math.max(1, boardHeight));
    // Same ceiling the hook uses, so the column can hold what the board becomes.
    const maxFit = (typeof window !== 'undefined' && window.innerWidth > 1200) ? 120 : 78;
    const fitSquare = Math.max(6, Math.min(maxFit, byHeight));
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
        setAnimMove(p?.setup_move || null);
        const map = {};
        (p.position || []).forEach((pl) => { map[keyOf(pl.x, pl.y)] = pl; });
        setPlacements(map);
        // Kept, because the board is played on: stepping through the answer and
        // starting the puzzle over both need the position as it was handed over,
        // not as the solver left it.
        setStartPlacements(map);
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
        /*
         * Castling and first-move state, all of it decided by the server and
         * carried on the placement. The shared client engine reads exactly these
         * names: without hasMoved it would offer a double step to a pawn halfway
         * up the board, and without the resolved partner ids it would never draw
         * a castling dot at all, because partner KEYS are not partner ids.
         */
        hasMoved: !!pl.hasMoved,
        moveCount: Number(pl.moveCount) || 0,
        can_castle: pl.can_castle ?? def.can_castle ?? false,
        castling_distance: pl.castling_distance ?? def.castling_distance ?? null,
        castling_partner_left_id: pl.castling_partner_left_id ?? null,
        castling_partner_right_id: pl.castling_partner_right_id ?? null,
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
  //
  // The en passant target comes from the server, derived from the move that set
  // this position up. Without it a pawn that CAN take en passant shows no dot on
  // the square where the capture happens, and the answer looks illegal.
  const moveEngine = useMemo(() => createMoveEngine({
    specialSquares,
    gameType: board,
    enPassantTarget: puzzle?.en_passant_target || null,
    currentPlayerPosition: null,
  }), [specialSquares, board, puzzle?.en_passant_target]);

  /*
   * Fog of war, played for real.
   *
   * Fog is a rule of the game, so a puzzle in a fog game is solved in fog -
   * showing the whole board would be a different puzzle from the one its creator
   * built. The visible set is worked out exactly as the live game works it out:
   * every square the SOLVER'S own pieces occupy or can reach, using raw
   * reachability (skipCheckFilter) with the fog flag on, so a pawn's diagonals
   * count as seen even when empty.
   *
   * null means fog is off and everything is visible - the same sentinel the
   * live board uses, so the render below reads the same way.
   */
  const fogVisibleSquares = useMemo(() => {
    if (!puzzle?.fog_of_war || !board) return null;
    const viewer = Number(puzzle.side_to_move);
    const visible = new Set();
    for (const p of enginePieces) {
      if (Number(p.player_id ?? p.team) !== viewer) continue;
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      for (let dy = 0; dy < ph; dy++) {
        for (let dx = 0; dx < pw; dx++) visible.add(`${p.x + dx},${p.y + dy}`);
      }
      const moves = moveEngine.calculateValidMoves(
        p, enginePieces, boardWidth, boardHeight,
        true,   // skipCheckFilter - raw reachability
        false,  // forPremove
        false,  // forHoverDisplay
        true    // forFog - include capture-range squares even when empty
      ) || [];
      for (const m of moves) {
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) visible.add(`${m.x + dx},${m.y + dy}`);
        }
      }
    }
    return visible;
  }, [puzzle?.fog_of_war, puzzle?.side_to_move, board, enginePieces, moveEngine, boardWidth, boardHeight]);

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

  /*
   * `art` is the promoted piece's name and image, for the optimistic board only.
   *
   * Passed beside the move rather than on it: the submitted line is stored
   * verbatim in puzzle_attempts, and an image_location is a JSON array of paths
   * that has no business being written there once per attempt. The server
   * already knows what piece the id names.
   */
  const submit = useCallback(async (move, art = null, preApplied = null) => {
    setBusy(true);
    setLastTry(move);
    const attemptLine = [...playedMoves, move];

    /*
     * Move the piece now, ask the server afterwards - the same way the live
     * games and the Discord activity already work.
     *
     * Waiting for the round trip left the piece under the cursor long enough to
     * read as a dropped input. The board is a guess until the server answers;
     * `before` is what it is a guess against, so every branch below rebuilds
     * from that rather than layering onto the guess, and anything the server
     * rejects puts the piece back.
     *
     * `preApplied` is the board as it was when the CALLER already moved the
     * piece - which it does, because the move has to appear the instant it is
     * dropped and there is a lookup between there and here. Applying from
     * `before` rather than from `prev` makes that harmless: doing it twice
     * lands on the same board, and a promotion arriving late redraws it with
     * the right artwork instead of layering a second move on top.
     */
    const before = preApplied || placements;
    setPlacements(applyPly(before, move, art));

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
        // From `before`, not from the optimistic board - the move is already on
        // that one, and applying it again would play it twice.
        setPlayedMoves(attemptLine);
        // `position` arrives only for games whose captures the client cannot
        // compute; when it does it is the authority and the guess is discarded.
        setPlacements(data.position
          ? fromServerPosition(data.position)
          : applyPly(applyPly(before, move), data.reply));
        // Slide the opponent's reply in, the same as the opening move.
        if (data.reply?.from && data.reply?.to) {
          setAnimMove(data.reply);
          setReplayKey((k) => k + 1);
        } else {
          setAnimMove(null);
        }
        setLastTry(data.reply || move);
        setOutcome('continue');
        return;
      }
      if (data.solved) {
        const line = data.solution || attemptLine;
        setPlayedMoves(attemptLine);
        // Everything from here to the end of the line: this move, plus any
        // reply the creator wrote after it. Replayed onto `before` so the
        // authoritative version of this move - promotion piece included -
        // replaces the guess rather than stacking on top of it.
        setPlacements(data.position
          ? fromServerPosition(data.position)
          : solvedPliesRemaining(line, playedMoves.length, move)
              .reduce((cells, ply) => applyPly(cells, ply), before));
        setSolution(line);
        setOutcome('solved');
        return;
      }
      // Off the line. The guess comes back off, so they try again from the same
      // position they were looking at.
      setPlacements(before);
      setAttempts((n) => n + 1);
      setOutcome('wrong');
    } catch (err) {
      // Nothing was judged, so the guess must not stay on the board.
      setPlacements(before);
      setError(err?.response?.data?.message || 'Could not submit that move');
    } finally {
      setBusy(false);
    }
  }, [puzzleId, startedAt, playedMoves, placements]);

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
      if (data.position) {
        setPlacements(fromServerPosition(data.position));
      } else if (Array.isArray(line)) {
        setPlacements((prev) => line.slice(playedMoves.length * 2).reduce((cells, ply) => applyPly(cells, ply), prev));
      }
      if (data.rating) setRatingChange(data.rating);
      /*
       * Start at the first move, not the finished position.
       *
       * Landing on the end showed the answer as a fait accompli - the whole
       * line already played, with nothing to read. The point of asking is to be
       * shown HOW, so it opens where the answer begins and is stepped forward
       * from there. ⏮ still goes back to the position as it was set.
       */
      setRevealStep(0);
      setOutcome('revealed');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load the solution');
    } finally {
      setBusy(false);
    }
  }, [puzzleId, playedMoves, startedAt]);

  /*
   * Play a move - but ask the server first what it actually is.
   *
   * Both answers change what gets submitted. The promoted piece is part of the
   * answer, since moveKey folds promotionPieceId in: promoting to a rook when
   * the line says queen is a different move, not a near miss. And a castle has
   * to be submitted AS a castle, with the partner and direction the engine
   * expects - a king-slides-two move without those flags is simply illegal, so a
   * solver who found the right idea would be told they were wrong.
   */
  const playFrom = useCallback(async (fromKey, x, y) => {
    const [fy, fx] = fromKey.split(',').map(Number);
    const mover = placements[fromKey];
    setSelected(null);
    setHoveredMoves([]);
    let move = {
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    };
    /*
     * The piece moves NOW.
     *
     * The lookup below is a round trip, and until this was here the piece sat
     * back on the square it was dragged from for the whole of it - so a drop
     * read as "nothing happened", and then the piece jumped. The lookup only
     * refines the move (castling partner, promotion choice); it does not decide
     * whether it happens.
     */
    const before = placements;
    setPlacements(applyPly(before, move));

    try {
      const { data } = await axios.post(
        `${API_URL}game-types/${gameId}/puzzle-move-info`,
        {
          position: Object.entries(placements).map(([k, pl]) => {
            const [py, px] = k.split(',').map(Number);
            return { ...pl, x: px, y: py };
          }),
          side_to_move: puzzle?.side_to_move,
          setup_move: puzzle?.setup_move,
          move,
        },
        { headers: authHeader() }
      );
      if (data?.castling) {
        move = {
          ...move,
          isCastling: true,
          castlingWith: data.castling.castlingWith,
          castlingDirection: data.castling.castlingDirection,
        };
      }
      if (data?.promotes && Array.isArray(data.options) && data.options.length) {
        // The piece is already on its new square; the chooser decides what it
        // becomes there. `before` travels with it so the choice redraws from
        // the same board this did.
        setPendingPromotion({ move, options: data.options, before });
        return;
      }
    } catch (_) {
      // The lookup is an improvement, not a gate - submit the move as it stands.
    }
    submit(move, null, before);
  }, [placements, submit, gameId, puzzle?.side_to_move, puzzle?.setup_move]);

  const choosePromotion = useCallback((option) => {
    const pending = pendingPromotion;
    setPendingPromotion(null);
    if (!pending) return;
    submit({
      ...pending.move,
      promotionPieceId: option.id,
      ...(option.player != null ? { promotionPlayer: option.player } : {}),
    }, {
      /*
       * The chosen piece's artwork, for the optimistic board.
       *
       * The server answers a promoting line with the whole resulting position
       * and that is the authority - but it answers after a round trip, and
       * until it does the board is showing this move. Without this the piece
       * the solver just chose appears as the pawn it was.
       */
      piece_name: option.piece_name || null,
      image_location: option.image_location || null,
    }, pending.before || null);
  }, [pendingPromotion, submit]);

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
   * Touch arrives here only for a piece already picked up, or from a long
   * press - PuzzleBoard and useTouchPieceGestures decide which, so a finger
   * anywhere else still scrolls. Tapping the piece and then the destination
   * works as it always did.
   */
  /*
   * The opponent's last move, played onto the board before the solver starts.
   *
   * `shown` is what every square below reads instead of `placements`: the
   * pre-move position while it runs, the real one after. `replaying` gates
   * every way of acting on the board - see submit and the click handler - so a
   * fast solver cannot answer a position that is still arriving.
   */
  const {
    displayBoard: shown,
    replaying,
    overlay: replayPiece,
  } = useSetupMoveReplay({
    boardRef,
    squareSize: vp.squareSize,
    board: placements,
    // The opponent's move to play in: the setup move to begin with, then every
    // reply as a multi-move line is answered, so each opponent move slides.
    setupMove: animMove,
    imageFor: (piece) => imageFor(piece, pieceDataMap),
    // Not gated on being mid-line: each opponent move animates as it arrives,
    // and nothing plays once the puzzle is over.
    enabled: !finished,
    replayKey,
    // Only the opening move holds; each reply answers a move just made.
    immediate: playedMoves.length > 0,
  });

  const startPress = useCallback((e, x, y) => {
    // `replaying`: the opponent's move is still arriving, and a piece picked up
    // mid-replay would be dragged off a position that is about to change.
    if (busy || finished || replaying || e.button !== 0) return;
    const k = keyOf(x, y);
    const here = placements[k];
    if (!here || Number(here.player_id) !== Number(puzzle?.side_to_move)) return;
    pendingRef.current = { fromKey: k, startX: e.clientX, startY: e.clientY };
  }, [busy, finished, replaying, placements, puzzle]);

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
    if (busy || finished || replaying) return;
    const k = keyOf(x, y);
    const here = placements[k];
    /*
     * A piece held from the tray answers by being PUT DOWN, so one click ends
     * the turn rather than two. Whether the square is legal is the server's
     * call, exactly as it is for a move.
     */
    if (trayPick) {
      submit({
        type: 'place',
        placePieceId: Number(trayPick.template.piece_id),
        to: { x, y },
        // Carried for the optimistic draw only; the server stores three fields
        // and sends back the real position for these games.
        placedBy: trayPick.player || Number(puzzle?.side_to_move) || 1,
        placedName: trayPick.template.name || null,
        placedImage: trayPick.template.image_location || null,
      });
      return;
    }
    if (!selected) {
      if (!here) return;
      if (Number(here.player_id) !== Number(puzzle?.side_to_move)) return;
      setSelected(k);
      return;
    }
    if (selected === k) { setSelected(null); return; }
    playFrom(selected, x, y);
  }, [busy, finished, replaying, selected, placements, puzzle, playFrom, trayPick, submit]);

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

  /*
   * Stepping through a revealed answer.
   *
   *   null   the finished position
   *   -1     the position the puzzle was set from
   *   0..n   after that ply
   *
   * The same three states the match review uses, and the same way through
   * them, so the arrows and the arrow keys do what they do everywhere else.
   */
  const revealPlyCount = Array.isArray(solution) ? solution.filter(Boolean).length : 0;

  const stepBack = useCallback(() => setRevealStep((prev) => (
    // From the finished position, back onto the last ply that is not it.
    prev == null ? Math.max(-1, revealPlyCount - 2) : Math.max(-1, prev - 1)
  )), [revealPlyCount]);

  const stepForward = useCallback(() => setRevealStep((prev) => {
    if (prev == null) return null;
    return prev < revealPlyCount - 1 ? prev + 1 : null;
  }), [revealPlyCount]);

  const reviewLabel = useMemo(() => {
    if (revealStep == null) return 'Final Position';
    if (revealStep < 0) return 'Starting Position';
    // Whose move it was is worth saying here in a way it is not in a game
    // review: half of a puzzle's line is the answer and half is the reply to it.
    const whose = revealStep % 2 === 0 ? 'your move' : 'their reply';
    return `Move ${revealStep + 1} of ${revealPlyCount} — ${whose}`;
  }, [revealStep, revealPlyCount]);

  /*
   * Left and right step through it, as they do in the match review.
   *
   * Only while an answer is on show, and never while something is being typed
   * - the feedback box is on this page, and arrow keys belong to whatever has
   * the cursor.
   */
  useEffect(() => {
    if (outcome !== 'revealed' || !revealPlyCount) return undefined;
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepBack(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
      else if (e.key === 'Escape') { e.preventDefault(); setRevealStep(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [outcome, revealPlyCount, stepBack, stepForward]);

  /*
   * The board as it stood after `revealStep` plies of the answer.
   *
   * Replayed from the starting position each time rather than stepped forward
   * and back: a move is not reversible here - a capture removes a piece and
   * nothing records what it was - so walking backwards would quietly invent
   * empty squares. Replaying a handful of plies is cheap and always right.
   */
  const reviewPlacements = useMemo(() => {
    const plies = Array.isArray(solution) ? solution.filter(Boolean) : [];
    if (revealStep == null || !plies.length) return null;
    if (revealStep < 0) return startPlacements;
    return plies
      .slice(0, revealStep + 1)
      .reduce((cells, ply) => applyPly(cells, ply), startPlacements);
  }, [revealStep, solution, startPlacements]);

  /*
   * Start the puzzle over.
   *
   * Offered after a reveal because seeing the answer and then playing it is how
   * a puzzle teaches - but the rating has already been settled by the reveal,
   * and it is not settled twice. The server decides that; this only has to be
   * honest about it on the way in.
   */
  const playAgain = useCallback(() => {
    setPlacements(startPlacements);
    setPlayedMoves([]);
    setSolution(null);
    setRevealStep(null);
    setOutcome(null);
    setSelected(null);
    setHoveredMoves([]);
    setLastTry(null);
    setError(null);
    setRatingChange(null);
    setProgress(null);
    setAnimMove(puzzle?.setup_move || null);
    setReplayKey((k) => k + 1);
  }, [startPlacements, puzzle]);

  if (loading) return <div className={styles["solver-page"]}><p>Loading…</p></div>;
  if (error && !puzzle) return <div className={styles["solver-page"]}><p>{error}</p></div>;
  if (!puzzle) return null;

  /*
   * What this game lets the solver put down. Empty for every game that does
   * not place pieces, so the tray does not appear and nothing changes.
   */
  const trayItems = placesPieces(puzzle)
    ? expandPlaceable(puzzle.placeable_pieces, puzzle.player_count)
    : [];

  const solutionPlies = Array.isArray(solution) ? solution.filter(Boolean) : [];
  const sol = solutionPlies[0] || null;

  const setup = puzzle.setup_move;

  /*
   * What a square looks like, and what is in it.
   *
   * The board itself - the frame, the grid, the square sizes, the light/dark
   * alternation - is PuzzleBoard's, shared with the home-page card. These two
   * functions are the part that is genuinely this page's: the fog, the hidden
   * pieces, the selection, the move dots and the solution highlights.
   */
  const squareState = (x, y) => {
    const k = keyOf(x, y);
    /*
     * Stepping through a revealed answer bypasses the setup-move replay: that
     * animation is for arriving at the puzzle, and by now the puzzle is over.
     */
    const rawPiece = (reviewPlacements || shown)[k];

    /*
     * Fog and hidden pieces, applied at the point of drawing.
     *
     * Both are rules of the GAME, so a puzzle from a fog game is solved in fog -
     * revealing the whole board would be a different puzzle from the one its
     * creator built and tested. Once the puzzle is over the fog lifts, the way it
     * lifts at the end of a live game, so the solution can be read.
     */
    const fogged = !finished && !!fogVisibleSquares && !fogVisibleSquares.has(`${x},${y}`);
    const p = fogged ? null : rawPiece;
    // "Hidden enemy pieces" shows that something is there, not what it is.
    const concealed = !finished && !fogged && !!puzzle.hide_enemy_pieces
      && !!rawPiece && Number(rawPiece.player_id) !== Number(puzzle.side_to_move);
    // Placements only have to carry a piece id; the name lives on the piece
    // definition, so fall back to it rather than showing "undefined".
    const pieceName = p ? (p.piece_name || pieceDataMap[p.piece_id]?.piece_name || 'Piece') : '';
    return { k, rawPiece, p, fogged, concealed, pieceName };
  };

  const squareClass = (x, y) => {
    const { k, fogged } = squareState(x, y);
    const mine = shown[k] && Number(shown[k].player_id) === Number(puzzle.side_to_move);
    return [
      selected === k ? styles["selected"] : '',
      fogged ? styles["fogged"] : '',
      setup && !fogged && ((setup.from?.x === x && setup.from?.y === y) || (setup.to?.x === x && setup.to?.y === y)) ? styles["setup"] : '',
      lastTry && lastTry.to.x === x && lastTry.to.y === y && outcome === 'wrong' ? styles["wrong"] : '',
      sol && sol.from?.x === x && sol.from?.y === y ? styles["sol-from"] : '',
      sol && sol.to?.x === x && sol.to?.y === y ? styles["sol-to"] : '',
      mine && !finished ? styles["grabbable"] : '',
    ].filter(Boolean).join(' ');
  };

  const squareTitle = (x, y) => {
    const { p, concealed, pieceName } = squareState(x, y);
    if (concealed) return 'An enemy piece — this game hides which one';
    return p ? `${pieceName} (Player ${p.player_id})` : '';
  };

  const renderSquare = (x, y) => {
    const { k, p, concealed, pieceName } = squareState(x, y);
    const src = concealed ? null : imageFor(p, pieceDataMap);
    const dot = hoveredMoves.find((m) => m.x === x && m.y === y);
    const isDragOrigin = !!drag && drag.fromKey === k;
    return (
      <>
        {src
          ? <img
              src={src}
              alt={pieceName}
              draggable={false}
              // While it is being dragged the piece is drawn under the cursor
              // instead, so the square it came from reads as empty.
              style={isDragOrigin ? { opacity: 0 } : undefined}
            />
          : concealed
            ? <span className={styles["concealed-piece"]} aria-label="Unknown enemy piece">?</span>
            : (p ? <span className={styles["piece-fallback"]}>{(pieceName || '?').charAt(0)}</span> : null)}
        {/* Same movement helpers as a live game: blue for a move, red for an
            attack, split when a piece can do both on that square. */}
        {dot && (
          <span
            className={styles["move-dot"]}
            style={{ background: MOVE_DOT_BACKGROUNDS[getMoveDotType(dot)] }}
          />
        )}
      </>
    );
  };

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
      {/* The opponent's last move, in flight. */}
      {replayPiece && (
        <img src={replayPiece.src} alt={replayPiece.alt} style={replayPiece.style} draggable={false} />
      )}
      <h1>{puzzle.title || 'Puzzle'}</h1>
      <p className={styles["subtitle"]}>
        {puzzle.game_name && <>in <Link to={`/games/${puzzle.game_type_id}`}>{puzzle.game_name}</Link></>}
        {puzzle.creator_username && <> · puzzle by {puzzle.creator_username}</>}
      </p>

      <div className={styles["layout"]}>
        <div className={styles["board-side"]} style={{ width: boardColumnMax, maxWidth: '100%' }}>
          {/*
            * Reading the answer, above the board - the same place, shape and
            * words as the match review, because it is the same act and anyone
            * who has stepped through one of their own games already knows it.
            */}
          {solutionPlies.length > 0 && outcome === 'revealed' && (
            <>
              <h3 className={styles["board-title"]}>{reviewLabel}</h3>
              <div className={styles["review-controls"]}>
                <button
                  onClick={() => setRevealStep(-1)}
                  disabled={revealStep === -1}
                  title="Starting position"
                >⏮</button>
                <button
                  onClick={stepBack}
                  disabled={revealStep === -1}
                  title="Previous move (left arrow)"
                >◀</button>
                <button
                  onClick={stepForward}
                  disabled={revealStep == null}
                  title="Next move (right arrow)"
                >▶</button>
                <button
                  onClick={() => setRevealStep(null)}
                  disabled={revealStep == null}
                  title="Final position"
                >⏭ Final</button>
              </div>
            </>
          )}
          <div style={{ ...vp.frameStyle, justifyContent: 'flex-start' }}>
            <PuzzleBoard
              vp={vp}
              boardRef={boardRef}
              boardWidth={boardWidth}
              boardHeight={boardHeight}
              lightColor={lightColor}
              darkColor={darkColor}
              squareClassName={squareClass}
              squareTitle={squareTitle}
              renderSquare={renderSquare}
              onSquareClick={handleSquareClick}
              onSquarePointerDown={startPress}
              liftedSquare={selected}
              squarePiece={(x, y) => {
                const here = placements[keyOf(x, y)];
                if (!here) return null;
                const movable = !busy && !finished && !replaying
                  && Number(here.player_id) === Number(puzzle?.side_to_move);
                return movable ? 'own' : 'other';
              }}
              onSquareLift={(x, y) => setSelected(keyOf(x, y))}
              onSquareMouseEnter={(x, y) => {
                if (!finished && !selected && !drag && !replaying) {
                  hoverPiece(enginePieces.find((e) => e.x === x && e.y === y));
                }
              }}
              onSquareMouseLeave={() => { if (!selected && !drag) setHoveredMoves([]); }}
            />
            <BoardZoomControls {...vp.controlProps} />
          </div>
          {/* In a game where the answer is a placement there is no piece on the
              board to pick up first, so the tray IS the first half of the
              gesture. */}
          <PlacementTray
            items={trayItems}
            heldKey={trayPick?.key}
            onPick={(item) => { setTrayPick(item); setSelected(null); }}
            label="Answer by placing"
            disabled={busy || finished || replaying}
            /*
             * image_location, not image_url: the template's image_url is one
             * fixed picture, and these pieces differ by owner - a black stone
             * and a white one are the same piece_id. image_location is the
             * per-player list, indexed by who is placing.
             */
            imageFor={(item) => imageFor({
              piece_id: item.template.piece_id,
              image_location: item.template.image_location,
              player_id: item.player || 1,
            }, {})}
          />
        </div>

        <div className={styles["panel"]}>
          <div className={styles["goal"]}>
            {/* Whose move it is decides how the whole board reads, so it leads
                rather than trailing the goal as a footnote. */}
            <p className={styles["turn"]}>
              <span className={styles[`turn-p${puzzle.side_to_move}`]} aria-hidden="true" />
              Player {puzzle.side_to_move} to move — that is you
            </p>
            <span className={styles["goal-label"]}>Your goal</span>
            <span className={styles["goal-text"]}>{goalText(puzzle)}</span>
            <span className={styles["goal-side"]}>
              {puzzle.game_name && <>from {puzzle.game_name}</>}
              {puzzle.creator_username && <> · puzzle by {puzzle.creator_username}</>}
              {puzzle.published_at && (
                <> · {new Date(puzzle.published_at).toLocaleDateString(undefined, {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}</>
              )}
              {puzzle.rating_public && puzzle.rating != null && (
                <> · Rated {puzzle.rating} by {puzzle.rating_sample_count} solvers</>
              )}
            </span>
          </div>

          {puzzle.description && <p className={styles["description"]}>{puzzle.description}</p>}

          {/* Fog and hidden pieces change what the board is showing, so they are
              said out loud rather than left for the solver to infer from a
              board that looks half-empty. */}
          {(puzzle.fog_of_war || puzzle.hide_enemy_pieces) && !finished && (
            <p className={styles["visibility-note"]}>
              {puzzle.fog_of_war && <>🌫 <strong>Fog of war.</strong> You only see the squares your own pieces can reach.</>}
              {puzzle.fog_of_war && puzzle.hide_enemy_pieces && ' '}
              {puzzle.hide_enemy_pieces && <>👁 <strong>Hidden enemy pieces.</strong> You can see where they are, not what they are.</>}
            </p>
          )}

          {/* The rules, without leaving the puzzle. Movement first - see
              GameRulesModal. */}
          <button
            type="button"
            className={styles["rules-button"]}
            onClick={() => setRulesOpen(true)}
          >
            {puzzle.game_name || 'Game'} Rules
          </button>
          {/* onNavigate: a route, not a page load - the card's way out to the
              game page should not throw the puzzle away. */}
          <GameRulesModal
            puzzleId={puzzle.id}
            open={rulesOpen}
            onClose={() => setRulesOpen(false)}
            onNavigate={(href) => { setRulesOpen(false); navigate(href); }}
          />

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
            {/*
              * Having seen the answer, play it. That is how a puzzle teaches,
              * and there is no reason to make somebody reload the page for it.
              * The rating was already settled by the reveal and is not settled
              * twice - said out loud rather than discovered afterwards.
              */}
            {outcome === 'revealed' && (
              <button className={styles["btn"]} onClick={playAgain} disabled={busy}>
                Play this puzzle
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

      {/*
        * Creator tools, below the puzzle rather than inside the sidebar.
        *
        * Two buttons only the creator and admins can press were sitting above
        * "Show me the answer" in a column everybody reads. Down here they are
        * still one click away and out of the solver's path.
        */}
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
      {/* Follows the button it belongs to, now that the button has moved. */}
      {duplicateError && (
        <div className={`${styles["notice"]} ${styles["notice-warn"]} ${styles["manage-notice"]}`}>{duplicateError}</div>
      )}

      {/* One dialog for all three boards: see components/common/PromotionChooser. */}
      {pendingPromotion && (
        <PromotionChooser
          options={pendingPromotion.options}
          defaultPlayer={puzzle.side_to_move}
          imageFor={(placement) => imageFor(placement, pieceDataMap)}
          onChoose={choosePromotion}
          onCancel={() => setPendingPromotion(null)}
        />
      )}
    </div>
  );
};

export default PuzzleSolver;

