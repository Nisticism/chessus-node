/* eslint-disable react-hooks/rules-of-hooks --
 * False positive from eslint-plugin-react-hooks 4.4.0, the same one already
 * documented in components/pieceview/PieceView.js. Its code-path analysis
 * mis-counts paths in components this large and then reports every hook in the
 * file as "called conditionally". Consolidating the duplicated Actions panel
 * changed the JSX enough to trip it; the file compiled cleanly before, and no
 * hook moved.
 *
 * Verified by AST analysis that the component is correct: all 249 hooks sit at
 * the top level of LiveGame (lines 316-5064), none is nested in a conditional,
 * loop or try block, and the first component-level return is at line 5978 -
 * after every one of them.
 *
 * Drop this disable once eslint-plugin-react-hooks is upgraded.
 */
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import axios from "axios";
import authHeader from "../../services/auth-header";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./livegame.module.scss";
import soundManager from "../../utils/soundEffects";
import PromotionModal from "./PromotionModal";
import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import BoardLegend from "../common/BoardLegend";
import PieceBadges from "../common/PieceBadges";
import GameChat from "./GameChat";
import ToggleSwitch from "../common/ToggleSwitch";
import useBoardViewport from "../common/useBoardViewport";
import BoardZoomControls from "../common/BoardZoomControls";
import boardVp from "../common/boardViewport.module.scss";
import {
  canRangedAttackTo,
  isRangedPathClear,
  colToFile,
  rowToRank,
  formatMoveNotation,
  findPieceAtSquare,
  doesPieceOccupySquare,
  replayToMove
} from "../../helpers/pieceMovementUtils";
import { createMoveEngine, getMoveDotType, MOVE_DOT_BACKGROUNDS } from "../../helpers/moveEngine";
import { totalMaterialValue } from "../../utils/pieceValueEstimator";
import { getFallbackPieceImage } from "../../utils/pieceFallback";
import { isTouchDevice } from "../../helpers/mobileUtils";
import { toggleUpvote, getUpvoteStatus } from "../../actions/games";
import useFairyStockfish from "../../hooks/useFairyStockfish";
import {
  buildFEN as buildFairyFEN,
  uciMoveToGameMove as fairyUciToMove,
} from "../../ai/fairyStockfishTranslator";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";
const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

// Canonical veto signature — MUST match vetoSignature() in server/game-socket.js.
// Placement is piece-agnostic (square only); moves include action discriminators.
const vetoSignatureClient = (move) => {
  if (!move || !move.to) return '';
  if (move.type === 'place' || move.isPlacement) return `place:${move.to.x},${move.to.y}`;
  const parts = [`p${move.pieceId}`, `${move.from ? move.from.x : '?'},${move.from ? move.from.y : '?'}`, `${move.to.x},${move.to.y}`];
  if (move.isRangedAttack) parts.push('r');
  if (move.isCastling) parts.push(`c${move.castlingDirection || move.castlingWith || ''}`);
  if (move.via) parts.push(`v${move.via.x},${move.via.y}`);
  return parts.join('|');
};

// Parse a veto signature back into { from, to, ranged, castling, isPlace } for
// display (tooltips). Inverse of vetoSignatureClient's square encoding.
const parseVetoSig = (sig) => {
  if (typeof sig !== 'string' || !sig) return null;
  if (sig.startsWith('place:')) {
    const [x, y] = sig.slice(6).split(',').map(Number);
    return { isPlace: true, to: { x, y } };
  }
  const parts = sig.split('|');
  const [fx, fy] = (parts[1] || '').split(',').map(Number);
  const [tx, ty] = (parts[2] || '').split(',').map(Number);
  if ([fx, fy, tx, ty].some(n => Number.isNaN(n))) return null;
  return {
    from: { x: fx, y: fy },
    to: { x: tx, y: ty },
    ranged: parts.includes('r'),
    castling: parts.some(p => p.startsWith('c')),
  };
};
// Algebraic square label (a1-style) for a board of the given height.
const vetoSquareLabel = (p, boardHeight) => p ? `${String.fromCharCode(97 + p.x)}${boardHeight - p.y}` : '?';


// Limited-reserve helpers. When a game type has `finite_reserve`, `gameState.reserves`
// is { [position]: { [piece_id]: remaining } }. These helpers are no-ops (treat as
// unlimited) when reserves are absent.
const getReserveCount = (reserves, position, pieceId) => {
  if (!reserves || position == null) return Infinity;
  const inv = reserves[position] || reserves[String(position)] || {};
  const v = inv[pieceId] ?? inv[String(pieceId)];
  return v == null ? Infinity : v;
};
// Whether the given player may deploy a placeable entry (per-entry ownership).
// neutral / 'all' / legacy(null) → any player; a specific number → only that player.
const isPlaceableEligible = (pp, position) =>
  pp.is_neutral || pp.player === 'neutral' || pp.player === 'all' || pp.player == null || Number(pp.player) === Number(position);

// Placeable pieces the given player can currently deploy (eligible for them, and
// reserve > 0 when limited reserves are on).
const getDeployablePieces = (otherData, reserves, position) => {
  const list = ((otherData && otherData.placeable_pieces) || []).filter(pp => isPlaceableEligible(pp, position));
  if (!reserves) return list;
  return list.filter(pp => getReserveCount(reserves, position, pp.piece_id) > 0);
};

// If the current player has any "confine placement to here" square, they may only
// deploy on those squares. Returns a Set of "y,x" keys or null (not confined).
const computePlacementConfinementZone = (specialSquares, position) => {
  const special = specialSquares?.special;
  if (!special) return null;
  let zone = null;
  for (const key of Object.keys(special)) {
    const cfg = special[key];
    if (!cfg || !cfg.restrictPiecePlacement || !cfg.confinePlacementToHere) continue;
    const to = cfg.restrictPiecePlacementTo || 'all';
    if (to === 'all' || to === `p${position}`) {
      if (!zone) zone = new Set();
      zone.add(key);
    }
  }
  return zone;
};
// Combined "may this player deploy on (x,y)?" check (per-square restriction + confinement).
const isDeployAllowed = (specialSquares, position, x, y, zone = undefined) => {
  const cfg = specialSquares?.special?.[`${y},${x}`];
  if (cfg && cfg.restrictPiecePlacement) {
    const to = cfg.restrictPiecePlacementTo || 'all';
    if (to === 'neutral') return false;
    if (to !== 'all' && to !== `p${position}`) return false;
  }
  const z = zone === undefined ? computePlacementConfinementZone(specialSquares, position) : zone;
  if (z && !z.has(`${y},${x}`)) return false;
  return true;
};

// Resolve a reserve piece's image variant to match a player's color (or the neutral image).
const reserveImageForPlayer = (pp, playerNum) => {
  if (pp && pp.image_location) {
    try {
      const arr = JSON.parse(pp.image_location);
      if (Array.isArray(arr) && arr.length > 0) {
        let idx;
        if (pp.is_neutral) idx = Math.min(Math.max(0, pp.neutral_image_index ?? 0), arr.length - 1);
        else idx = (playerNum === 2 && arr.length > 1) ? 1 : 0;
        const p = arr[idx];
        const path = p.startsWith('http') || p.startsWith('/uploads/') ? p : `/uploads/pieces/${p}`;
        return path.startsWith('http') ? path : `${ASSET_URL}${path}`;
      }
    } catch { /* fall through */ }
  }
  if (pp && pp.image_url) {
    return pp.image_url.startsWith('http') ? pp.image_url : `${ASSET_URL}${pp.image_url}`;
  }
  return null;
};

// Compute a live score estimate for score-based (Go-style) games: enclosed-region
// territory (orthogonal flood-fill) + board stones under the 'area' model + each
// player's starting points (komi). Mirrors the server's computeFinalScores for the
// common cases (captures/control points are added server-side at the game-end tally).
const computeGoScores = (pieces, gameType, otherData) => {
  const bw = gameType?.board_width || 8;
  const bh = gameType?.board_height || 8;
  let impassable = null;
  try {
    const ss = typeof gameType?.special_squares_string === 'string'
      ? JSON.parse(gameType.special_squares_string) : gameType?.special_squares_string;
    if (ss && typeof ss === 'object') {
      impassable = new Set();
      for (const [k, cfg] of Object.entries(ss)) if (cfg && cfg.impassable) impassable.add(k);
    }
  } catch { /* ignore */ }
  const occ = new Map();
  for (const p of pieces) occ.set(`${p.x},${p.y}`, p);
  const isWall = (x, y) => impassable && impassable.has(`${y},${x}`);
  const territory = { 1: 0, 2: 0 };
  if (otherData?.enclosed_region_scoring) {
    const visited = new Set();
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const k = `${x},${y}`;
      if (visited.has(k) || occ.has(k) || isWall(x, y)) continue;
      let size = 0; const owners = new Set(); let neutral = false; const stack = [[x, y]]; visited.add(k);
      while (stack.length) {
        const [cx, cy] = stack.pop(); size++;
        for (const [nx, ny] of [[cx, cy - 1], [cx, cy + 1], [cx - 1, cy], [cx + 1, cy]]) {
          if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) continue;
          if (isWall(nx, ny)) continue;
          const nk = `${nx},${ny}`; const np = occ.get(nk);
          if (np) { const o = np.team || np.player_id; if (np.is_neutral || o === 0) neutral = true; else owners.add(o); }
          else if (!visited.has(nk)) { visited.add(nk); stack.push([nx, ny]); }
        }
      }
      if (owners.size === 1 && !neutral) { const o = [...owners][0]; if (o === 1 || o === 2) territory[o] += size; }
    }
  }
  const stones = {
    1: pieces.filter(p => (p.team || p.player_id) === 1 && !p.is_neutral).length,
    2: pieces.filter(p => (p.team || p.player_id) === 2 && !p.is_neutral).length,
  };
  const start = { 1: Number(gameType?.starting_points_p1) || 0, 2: Number(gameType?.starting_points_p2) || 0 };
  const model = otherData?.scoring_model === 'region' ? 'region' : 'area';
  const scores = { 1: 0, 2: 0 };
  for (const pos of [1, 2]) {
    scores[pos] = start[pos] + (territory[pos] || 0) + (otherData?.enclosed_region_scoring && model === 'area' ? stones[pos] : 0);
    scores[pos] = Math.round(scores[pos] * 10) / 10;
  }
  return { scores, territory, stones, start, model };
};

// Helper to parse image_location and get the first image URL
const getFirstImageUrl = (imageLocation) => {
  if (!imageLocation) return null;
  
  try {
    const images = JSON.parse(imageLocation);
    if (Array.isArray(images) && images.length > 0) {
      const imagePath = images[0];
      if (imagePath.startsWith('http')) {
        return imagePath;
      }
      // Add ASSET_URL prefix if path starts with /
      return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
    }
  } catch {
    const imagePath = imageLocation;
    if (imagePath.startsWith('http')) {
      return imagePath;
    }
    // Add ASSET_URL prefix for all relative paths
    return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
  }
  
  return null;
};

// Helper to get image URL for a specific player (player 1 uses index 0, player 2 uses index 1).
// Optional imageIndexOverride forces a specific index from the array (per-placement override).
const getPlayerImageUrl = (imageLocation, playerNumber, imageIndexOverride = null) => {
  if (!imageLocation) return null;
  
  // Default to first image index for player 1, second for player 2
  const defaultImageIndex = playerNumber === 2 ? 1 : 0;
  const imageIndex = (imageIndexOverride != null && imageIndexOverride >= 0)
    ? imageIndexOverride
    : defaultImageIndex;
  
  try {
    const images = JSON.parse(imageLocation);
    if (Array.isArray(images) && images.length > 0) {
      // Use the appropriate index, or fall back to the last available image
      const actualIndex = Math.min(imageIndex, images.length - 1);
      const imagePath = images[actualIndex];
      if (imagePath.startsWith('http')) {
        return imagePath;
      }
      return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
    }
  } catch {
    const imagePath = imageLocation;
    if (imagePath.startsWith('http')) {
      return imagePath;
    }
    return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
  }
  
  return null;
};

// Helper to ensure pieces is always an array
const parsePieces = (pieces) => {
  if (!pieces) return [];
  if (Array.isArray(pieces)) return pieces;
  if (typeof pieces === 'string') {
    try {
      const parsed = JSON.parse(pieces);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Short, single-line label for a game-over reason. Used in the live-game
// header result line under "Game Over" once the modal has been dismissed.
const formatGameOverReasonShort = (reason) => {
  switch (reason) {
    case 'checkmate': return 'by checkmate';
    case 'capture': return 'by capture';
    case 'stalemate': return 'by stalemate';
    case 'stalemate_win': return 'by stalemate win';
    case 'resignation': return 'by resignation';
    case 'timeout': return 'by timeout';
    case 'disconnect': return 'by disconnect';
    case 'agreement': return 'by agreement';
    case 'draw_move_limit': return 'by move limit';
    case 'repetition': return 'by repetition';
    case 'insufficient_material': return 'insufficient material';
    case 'piece_count': return 'by piece count';
    case 'equal_piece_count': return 'equal piece count — draw';
    case 'promotion': return 'by promotion';
    case 'lose_all_pieces': return 'by anti-chess';
    case 'no_moves':
    case 'no_legal_moves': return 'by no legal moves';
    case 'elimination': return 'by elimination';
    case 'initial_position': return 'initial position (no rating change)';
    case 'cancellation_draw': return 'draw by simul-turns cancellations';
    case 'simultaneous_capture_draw': return 'draw by simultaneous capture';
    case 'simultaneous_checkmate_draw': return 'draw by simultaneous checkmate';
    case 'points_win': return 'by points';
    case 'score': return 'by highest score';
    case 'score_draw': return 'draw — equal score';
    case 'passes_draw': return 'draw';
    case 'draw_points_tie': return 'draw — both reached threshold';
    case 'draw_equal_points_at_turn': return 'draw — equal points at turn limit';
    case 'draw_equal_points_consecutive': return 'draw — equal points stalemate';
    case 'illegal_move_limit': return 'by illegal-move limit';
    default: return reason || 'game complete';
  }
};

const LiveGame = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const anonSpectate = React.useMemo(() => {
    try { return new URLSearchParams(location.search).get('anonSpectate') === '1'; } catch { return false; }
  }, [location.search]);
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  
  const { 
    connected,
    socket,
    getGameState,
    joinGame,
    makeMove,
    simulReadyToStart,
    simulPromotionChoice,
    resign,
    passTurn,
    offerDraw,
    acceptDraw,
    declineDraw,
    cancelDraw,
    cancelGame,
    setPremove: _rawSendPremove,
    clearPremove: sendClearPremove,
    cancelPromotion,
    promotePiece,
    skipCaptureAction,
    skipRangedCaptureAction,
    submitReposition,
    submitVetoes,
    sendVetoPreview,
    retractVetoMove,
    requestBotVeto,
    onGameEvent,
    spectateGame,
    pauseDisconnectTimer,
    resumeDisconnectTimer,
    authenticateAnonCorresPlayer,
    getStoredAnonCorresId,
    joinOpenGameAsGuest,
  } = useSocket();

  const [gameState, setGameState] = useState(null);
  const [loading, setLoading] = useState(true);

  // Hidden Enemy Pieces (fog): premoves ARE allowed and behave normally. If a
  // premove turns out to be illegal once the opponent's move is revealed, it
  // is silently cancelled — and if the game has the illegal-move-limit
  // condition enabled the server counts that failed premove toward the limit
  // (same as a manual illegal attempt while probing).
  const sendPremove = useCallback((gid, data) => {
    return _rawSendPremove(gid, data);
  }, [_rawSendPremove]);
  const [error, setError] = useState(null);
  const [spectators, setSpectators] = useState([]);
  const [showSpectators, setShowSpectators] = useState(true);
  const [moveError, setMoveError] = useState(null);
  const [botThinking, setBotThinking] = useState(false);
  // Simultaneous-turns state
  const [simulSubmittedThisRound, setSimulSubmittedThisRound] = useState(false);
  const [simulOpponentSubmitted, setSimulOpponentSubmitted] = useState(false);
  const [simulCancellationCount, setSimulCancellationCount] = useState(0);
  const [simulRoundNotice, setSimulRoundNotice] = useState(null);
  // Simul-turns ready-up: which player ids have pressed Ready in the lobby.
  const [simulReadyPlayerIds, setSimulReadyPlayerIds] = useState([]);
  // Simul-turns staged move (only used when game's simul_turns_submit_mode === 'stage').
  // Holds {moveData, requiresPromotion, promoteToPieceId} until the player
  // explicitly clicks Submit. Replaced when the player picks a different move.
  const [stagedSimulMove, setStagedSimulMove] = useState(null);
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [showGameOver, setShowGameOver] = useState(false);
  const [gameOverData, setGameOverData] = useState(null);
  // null = not yet checked, 'prompt' = show upvote CTA, 'just_upvoted' = show thanks
  const [gameOverUpvoteState, setGameOverUpvoteState] = useState(null);
  const [playerScores, setPlayerScores] = useState(null); // { 1: N, 2: M } or null when points not active
  const [stalemateNotice, setStalemateNotice] = useState(null);
  // Transient notice shown when the server re-rolls a randomized starting
  // position because the original roll resulted in an already-decided game.
  const [rerollNotice, setRerollNotice] = useState(null);
  // Capture actions per turn: server signals that the piece can make a bonus capture
  const [captureActionPieceId, setCaptureActionPieceId] = useState(null);
  const [captureActionData, setCaptureActionData] = useState(null); // { actionsUsed, actionsTotal, isRanged }
  // ─── Veto power state ───────────────────────────────────────────────────────
  // vetoWindow: set when a veto window is open and I'm the vetoer ({ style, revealMove, budget }).
  const [vetoWindow, setVetoWindow] = useState(null);
  // Server-confirmed banned signatures for the current opponent turn (shown to the mover).
  const [vetoBanned, setVetoBanned] = useState([]);
  // Which player position the current bans apply to (the mover). Ban X-marks are
  // only rendered for that player — otherwise the vetoer would see a spurious
  // "flash" on the board, sometimes landing on their own moves.
  const [vetoBannedMover, setVetoBannedMover] = useState(null);
  // Vetoes I'm building as the vetoer (array of move/placement descriptors).
  const [vetoSelection, setVetoSelection] = useState([]);
  // Opponent piece I've clicked to preview its candidate moves for vetoing.
  const [vetoSelectedPiece, setVetoSelectedPiece] = useState(null);
  const [vetoPieceMoves, setVetoPieceMoves] = useState([]);
  const [vetoError, setVetoError] = useState(null);
  // Reactive style: the move the opponent just submitted (shown to the vetoer so
  // they can ban it and/or spend remaining vetoes on other moves).
  const [vetoRevealMove, setVetoRevealMove] = useState(null);
  const [vetoMyBudget, setVetoMyBudget] = useState(null); // { perTurnRemaining, perGameRemaining }
  // Per-game veto bank remaining for both players (null when no per-game cap set).
  const [vetoBank, setVetoBank] = useState(null); // { 1: n, 2: n }
  const [vetoPerGameLimit, setVetoPerGameLimit] = useState(null);
  // Position whose clock is currently ticking due to an active veto phase (or null).
  const [vetoChargePos, setVetoChargePos] = useState(null);
  // Whether the veto game's clock has started (first action taken). Until then no
  // clock ticks — a pre-emptive premove by the mover does not start it.
  const [vetoClockStarted, setVetoClockStarted] = useState(false);
  // Live in-progress vetoes broadcast by the opponent (shown to the mover before submit).
  const [vetoPreviewSquares, setVetoPreviewSquares] = useState(null); // Map "x,y" -> count
  const [vetoPreviewMoves, setVetoPreviewMoves] = useState(null); // Map "x,y" -> [labels], for tooltips
  // True once I've submitted (or skipped) my vetoes for the current opponent turn.
  const [vetoDoneThisTurn, setVetoDoneThisTurn] = useState(false);
  // True (from the mover's view) once the opponent has submitted their vetoes this
  // turn, so pre-emptive messaging can switch from "opponent choosing" to "your move".
  const [vetoOpponentSubmitted, setVetoOpponentSubmitted] = useState(false);
  // True when I'm the mover and my submitted move is awaiting the opponent's veto decision.
  const [vetoMoveUnderReview, setVetoMoveUnderReview] = useState(false);
  // The mover's held move, shown premove-style (from/to) so it persists visually
  // while the opponent vetoes instead of jumping when the veto resolves.
  const [heldMoveHighlight, setHeldMoveHighlight] = useState(null); // { from, to, pieceId, type }
  // Pre-emptive: the mover's queued pre-move. Kept client-side (single, changeable,
  // cancellable) and auto-sent once the vetoer submits — so pre-moving never sends
  // multiple held moves to the server nor clears the vetoer's in-progress selection.
  const [vetoStagedMove, setVetoStagedMove] = useState(null); // { gameId, moveData }
  const vetoStagedMoveRef = useRef(null);
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredMoves, setHoveredMoves] = useState([]);
  const [draggedPiece, setDraggedPiece] = useState(null);
  const [dragValidMoves, setDragValidMoves] = useState([]);
  // Square currently under the cursor during a drag (for hover feedback).
  const [dragOverSquare, setDragOverSquare] = useState(null);
  const dragOverSquareRef = useRef(null);
  const dragGrabOffsetRef = useRef({ x: 0, y: 0 });
  const [inCheck, setInCheck] = useState(false);
  const [checkedPieces, setCheckedPieces] = useState([]);
  const [damageAnimations, setDamageAnimations] = useState([]); // HP/AD: floating damage numbers [{id, pieceId, damage, x, y}]
  const [regenAnimations, setRegenAnimations] = useState([]); // HP/AD: floating regen numbers [{id, pieceId, healed, x, y}]
  const [burnAnimations, setBurnAnimations] = useState([]); // DOT: floating burn damage numbers [{id, pieceId, damage, x, y}]
  const [showMovableIndicators, setShowMovableIndicators] = useState(false);
  const [showAllSpecialSquares, setShowAllSpecialSquares] = useState(false);
  const [hideRestrictionZones, setHideRestrictionZones] = useState(false);
  const [showCastlingInfo, setShowCastlingInfo] = useState(false);
  // Click-and-hold disambiguation: when a square has BOTH a regular move and
  // a castling move (same destination), a quick click executes the regular
  // move and a 1-second hold promotes to castle. Refs drive selection; state
  // drives the visual charging/armed overlay.
  const castleHoldTimerRef = useRef(null);
  const castleArmedRef = useRef(null); // { x, y } or null
  const dragCastleHoverRef = useRef(null); // { x, y } currently-armed-square during drag
  const [castleHoldSquare, setCastleHoldSquare] = useState(null); // { x, y }
  const [castleArmedSquare, setCastleArmedSquare] = useState(null); // { x, y }
  // Illegal-move counters — initialized from gameState and kept in sync via
  // 'illegalMove' events so the display updates immediately without waiting
  // for a full gameState re-broadcast.
  const [illegalMoveCounts, setIllegalMoveCounts] = useState(() => ({
    ...(gameState?.illegalMoveCounts || { 1: 0, 2: 0 })
  }));
  const [showBoardNotation, setShowBoardNotation] = useState(true);
  const [showBadges, setShowBadges] = useState(true);
  // Read the freshest persisted value: toggling mute updates localStorage even
  // when we skip the Redux user swap (see persistSoundPreference), so a remount
  // still reflects the latest choice.
  const computeInitialSoundEnabled = () => {
    try {
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      if (stored && stored.sound_enabled !== undefined) {
        return stored.sound_enabled !== 0 && stored.sound_enabled !== false;
      }
    } catch (_) { /* ignore */ }
    if (!currentUser) return true;
    return currentUser.sound_enabled !== 0 && currentUser.sound_enabled !== false;
  };
  const [soundEnabled, setSoundEnabled] = useState(computeInitialSoundEnabled);
  const soundEnabledRef = useRef(computeInitialSoundEnabled());
  const [premove, setPremove] = useState(null); // Store premove {from, to, pieceId}
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [promotionData, setPromotionData] = useState(null); // {pieceId, options, promotingPiece}
  const [promotionMinimized, setPromotionMinimized] = useState(false);
  // True when the active promotion modal belongs to a simul-turns submission
  // (so handlePromotionSelect routes to simulPromotionChoice instead of the
  // regular promotePiece handler).
  const [promotionIsSimul, setPromotionIsSimul] = useState(false);
  // Pre-promotion piece positions for fog-of-war: prevents fog from updating
  // until after the player confirms their promotion choice.
  const [prePromotionPieces, setPrePromotionPieces] = useState(null);
  const [specialSquares, setSpecialSquares] = useState({ range: {}, promotion: {}, control: {}, special: {} });
  // Custom per-piece sounds, keyed by piece_id. Fetched once per game type
  // rather than threaded through every piece payload from the server.
  const pieceSoundsRef = useRef({});
  const [pendingDrawOffer, setPendingDrawOffer] = useState(null); // {from, fromUsername} when opponent offers draw
  const [drawOfferSent, setDrawOfferSent] = useState(false); // Track if current user sent a draw offer
  const [showCapturedPieces, setShowCapturedPieces] = useState(true); // Show/hide captured pieces section
  const [showReserveBank, setShowReserveBank] = useState(true); // Show/hide the limited-reserve bank panel
  const [showPlacementModal, setShowPlacementModal] = useState(false);
  const [placementTarget, setPlacementTarget] = useState(null); // {x, y} where user wants to place
  // When true, placement uses left-click/tap (fallback for mobile). Default: right-click
  // on desktop, but left-click/tap on touch devices where right-click isn't available.
  const [placementUseLeftClick, setPlacementUseLeftClick] = useState(() => isTouchDevice());
  // When false, squares restricted from piece placement are shaded red. Default: hidden
  // for a cleaner board; users can toggle it on from the board options.
  const [hidePlacementRestrictions, setHidePlacementRestrictions] = useState(true);
  const [showGuestJoinModal, setShowGuestJoinModal] = useState(false);
  const [guestJoinName, setGuestJoinName] = useState('');
  const [isJoiningAsGuest, setIsJoiningAsGuest] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1920);
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 1080);

  // Fit-to-container sizing + zoom for the live board. Reserves vertical space for
  // the clocks/captured rows so the board fits without pushing the page.
  const boardVpHook = useBoardViewport({
    boardWidth: gameState?.gameType?.board_width,
    boardHeight: gameState?.gameType?.board_height,
    fitMaxSquare: windowWidth > 1200 ? 140 : 76,
    maxSquare: windowWidth > 1200 ? 220 : 140,
    maxHeight: () => Math.max(300, windowHeight - 172),
    insetW: showBoardNotation ? 30 : 8,
    insetH: showBoardNotation ? 26 : 8,
  });
  // Width of the board COLUMN (a fixed grid track), which is what decides whether
  // the Actions and clocks fit beside a tall board. Measuring the wrapper would
  // not do: in beside mode the wrapper shrinks to hug the board, so the answer
  // would immediately un-make itself and the layout would oscillate.
  const [boardColWidth, setBoardColWidth] = useState(0);
  // Width of the whole middle row. The difference between the two is the sidebar
  // plus its gap, which is exactly how far the board column's centre sits to the
  // right of the page's - measured rather than hard-coded so it tracks the grid.
  const [boardRowWidth, setBoardRowWidth] = useState(0);
  const [boardColNode, setBoardColNode] = useState(null);
  const boardColRef = useCallback((el) => setBoardColNode(el), []);
  useLayoutEffect(() => {
    if (!boardColNode) return undefined;
    const measure = () => {
      const w = boardColNode.clientWidth || 0;
      const rowW = boardColNode.parentElement ? (boardColNode.parentElement.clientWidth || w) : w;
      setBoardColWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
      setBoardRowWidth((prev) => (Math.abs(prev - rowW) > 0.5 ? rowW : prev));
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(boardColNode);
      if (boardColNode.parentElement) ro.observe(boardColNode.parentElement);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [boardColNode]);

  // The square size a HEIGHT-limited board settles at - the same arithmetic
  // useBoardViewport does, but from the window alone, with no reference to the
  // width available. That independence is the point: the beside-mode layout sets
  // the board's width budget, so deriving it from the board's current width
  // would feed the result back into its own input and shrink on every pass.
  const boardFitHeightSquare = useMemo(() => {
    const bh = gameState?.gameType?.board_height || 0;
    if (!bh) return 0;
    const budget = Math.max(300, windowHeight - 172) - (showBoardNotation ? 26 : 8);
    const cap = windowWidth > 1200 ? 140 : 76;
    return Math.max(6, Math.min(cap, Math.floor(budget / bh)));
  }, [gameState?.gameType?.board_height, windowHeight, windowWidth, showBoardNotation]);

  // Actions + clocks go in a column beside the board when it is taller than it
  // is wide and the column has room for both. Everything here comes from the
  // window and the grid track, so the test cannot flip its own answer.
  const BESIDE_PANEL_PX = 196; // 180px side column + 16px gap
  const BOARD_WRAP_PAD = 32;   // game-board-wrapper's own left+right padding
  const besideBoardPx = useMemo(() => {
    const bw = gameState?.gameType?.board_width || 0;
    return boardFitHeightSquare * bw + (showBoardNotation ? 20 : 0);
  }, [gameState?.gameType?.board_width, boardFitHeightSquare, showBoardNotation]);
  const actionsBeside = useMemo(() => {
    const bw = gameState?.gameType?.board_width || 0;
    const bh = gameState?.gameType?.board_height || 0;
    if (!bw || !bh || bh <= bw || !boardColWidth) return false;
    if (boardFitHeightSquare * bh < 200) return false; // too short to stack buttons against
    return boardColWidth - BOARD_WRAP_PAD - BESIDE_PANEL_PX >= besideBoardPx;
  }, [gameState?.gameType?.board_width, gameState?.gameType?.board_height, boardColWidth, boardFitHeightSquare, besideBoardPx]);

  // Width of the hugging wrapper itself, used only to work out how far it can be
  // shifted. Measured, never fed back into anything that decides its size, so
  // there is no loop: margins do not change a max-content width. It re-measures
  // when the layout mode or the board's size changes, because a ResizeObserver
  // alone missed the wrapper collapsing from full-width to hugging.
  const [besideWrapWidth, setBesideWrapWidth] = useState(0);
  const [besideWrapNode, setBesideWrapNode] = useState(null);
  const besideWrapRef = useCallback((el) => setBesideWrapNode(el), []);
  useLayoutEffect(() => {
    if (!besideWrapNode) return undefined;
    const measure = () => setBesideWrapWidth((prev) => {
      const w = besideWrapNode.offsetWidth || 0;
      return Math.abs(prev - w) > 0.5 ? w : prev;
    });
    measure();
    const raf = requestAnimationFrame(measure);
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(besideWrapNode);
    }
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [besideWrapNode, actionsBeside, besideBoardPx, boardColWidth]);

  // Centred in the board column, the hugging wrapper sits half a sidebar to the
  // right of everything below the grid (Game Settings, captured pieces, the veto
  // panel), which centre on the page. Trading the auto right margin for a fixed
  // one slides it back onto that shared centre line, clamped so it can never
  // travel far enough to sit under the sidebar.
  const besideMarginRight = useMemo(() => {
    if (!boardColWidth || !besideWrapWidth) return null;
    const free = Math.max(0, boardColWidth - besideWrapWidth);
    const pageShift = Math.max(0, (boardRowWidth - boardColWidth) / 2);
    return Math.round(Math.max(0, Math.min(free, free / 2 + pageShift)));
  }, [boardColWidth, besideWrapWidth, boardRowWidth]);

  const [displayTimes, setDisplayTimes] = useState({}); // Locally interpolated clock times for sub-second display
  const displayTimesRef = useRef({}); // Mirror of displayTimes for use inside effects/handlers without a re-render dep
  const lastServerTickRef = useRef(null); // Timestamp of last server timeUpdate
  const serverTimesRef = useRef({}); // Last raw server playerTimes
  const activeClockPlayerRef = useRef(null); // Which player's clock is ticking
  const playersRef = useRef(null); // Latest gameState.players — used in event handlers to avoid stale closure
  useEffect(() => { playersRef.current = gameState?.players; }, [gameState?.players]);

  // Disconnect-forfeit banner: { userId, username, durationMs, expiresAt, paused, remainingMs }
  const [disconnectInfo, setDisconnectInfo] = useState(null);
  const [disconnectNow, setDisconnectNow] = useState(Date.now()); // tick for live countdown

  // Turn confirmation for correspondence games
  const [turnConfirmEnabled, setTurnConfirmEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('turnConfirmEnabled');
    return saved === null ? true : saved === 'true';
  });
  const [pendingMove, setPendingMove] = useState(null); // {gameId, moveData} awaiting confirmation
  const [preConfirmState, setPreConfirmState] = useState(null); // snapshot of gameState before visual preview
  const optimisticMoveSnapshotRef = useRef(null); // Snapshot for reverting rejected optimistic previews
  const moveTimingRef = useRef(null); // {t, type} — measures submit -> server-confirm latency

  // Options menu collapse state
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);

  const boardAnimationsEnabled = typeof window !== 'undefined' && localStorage.getItem('boardAnimations') !== 'false';
  const pieceShadowEnabled = typeof window !== 'undefined' && localStorage.getItem('pieceShadow') === 'true';
  const persistLastMoveHighlight = typeof window !== 'undefined' && localStorage.getItem('persistLastMoveHighlight') === 'true';
  const hideMoveArrow = typeof window === 'undefined' || localStorage.getItem('hideMoveArrow') !== 'false';

  // Track previous lastMove so we can fade out the prior move's highlight for ~1s
  // after a new move is made.
  const [fadingLastMoves, setFadingLastMoves] = useState([]);
  const prevLastMoveSigRef = useRef(null);
  const prevLastMovesRef = useRef([]);
  const fadeTimeoutRef = useRef(null);

  const showIllegalMoveWarning = useCallback((message, duration = 3000) => {
    setMoveError(message);
    if (soundEnabledRef.current) {
      soundManager.playIllegalMove();
    }
    setTimeout(() => setMoveError(null), duration);
  }, []);

  const clearOptimisticMoveSnapshot = useCallback(() => {
    optimisticMoveSnapshotRef.current = null;
  }, []);

  const createOptimisticSnapshot = useCallback((state) => ({
    pieces: parsePieces(state?.pieces).map((piece) => ({ ...piece })),
    currentTurn: state?.currentTurn
  }), []);

  const applyOptimisticMovePreview = useCallback((state, moveData) => {
    if (!state?.pieces) return state;

    const nextPieces = parsePieces(state.pieces).map((piece) => ({ ...piece }));
    const movingPieceIndex = nextPieces.findIndex((piece) => piece.id === moveData.pieceId);

    if (movingPieceIndex === -1) {
      return state;
    }

    const capturedPieceIndex = nextPieces.findIndex(
      (piece) => piece.x === moveData.to.x && piece.y === moveData.to.y && piece.id !== moveData.pieceId
    );

    if (capturedPieceIndex !== -1) {
      nextPieces.splice(capturedPieceIndex, 1);
    }

    if (!moveData.isRangedAttack) {
      const adjustedMovingPieceIndex = nextPieces.findIndex((piece) => piece.id === moveData.pieceId);
      if (adjustedMovingPieceIndex !== -1) {
        nextPieces[adjustedMovingPieceIndex].x = moveData.to.x;
        nextPieces[adjustedMovingPieceIndex].y = moveData.to.y;
      }
    }

    // Increment moveCount so fog visibility correctly excludes first-N-move squares
    // from the piece's new position immediately (without waiting for server confirmation).
    const movedPieceIndex = nextPieces.findIndex((piece) => piece.id === moveData.pieceId);
    if (movedPieceIndex !== -1) {
      nextPieces[movedPieceIndex].moveCount = (nextPieces[movedPieceIndex].moveCount || 0) + 1;
    }

    return {
      ...state,
      pieces: nextPieces
    };
  }, []);

  // Optimistic preview for placement moves: drop the placed piece onto the board
  // immediately so it feels instant; moveMade replaces it with the authoritative
  // piece and an error reverts via the optimistic snapshot.
  const applyOptimisticPlacementPreview = useCallback((state, moveData, placingPos) => {
    if (!state?.pieces || moveData?.type !== 'place') return state;
    const templates = state?.otherGameData?.placeable_pieces || [];
    const tpl = templates.find(t => String(t.piece_id) === String(moveData.placePieceId));
    if (!tpl) return state;
    const nextPieces = parsePieces(state.pieces).map((p) => ({ ...p }));
    const neutral = !!tpl.is_neutral;
    // Resolve the SAME player-specific image the server will send back, so the
    // optimistic piece renders the correct side's artwork immediately and the
    // src matches the authoritative piece once moveMade arrives — this avoids a
    // flash/reload (and a wrong player-1 image for player-2 placements) when the
    // temp piece is reconciled with the server piece.
    const optImageUrl = getPlayerImageUrl(
      tpl.image_location,
      neutral ? 1 : placingPos,
      neutral ? (tpl.neutral_image_index ?? null) : null
    ) || tpl.image_url || null;
    nextPieces.push({
      id: `__opt_place_${Date.now()}`,
      piece_id: tpl.piece_id,
      piece_name: tpl.piece_name,
      x: moveData.to.x,
      y: moveData.to.y,
      team: neutral ? 0 : placingPos,
      player_id: neutral ? 0 : placingPos,
      is_neutral: neutral,
      image_url: optImageUrl,
      image_location: tpl.image_location,
      piece_width: tpl.piece_width || 1,
      piece_height: tpl.piece_height || 1,
      current_hp: tpl.hit_points ?? 1,
      hit_points: tpl.hit_points ?? 1,
      _optimistic: true,
    });
    return { ...state, pieces: nextPieces };
  }, []);

  // Ranged attack state
  const [rangedAttackSource, setRangedAttackSource] = useState(null);
  const [rangedMousePos, setRangedMousePos] = useState(null);
  const [, setRangedTargetSquare] = useState(null);
  const boardRef = useRef(null);
  const rightClickDataRef = useRef(null);
  const [rangedSelectedPiece, setRangedSelectedPiece] = useState(null); // for right-click-twice mode

  // Touch drag state for mobile
  const touchDragRef = useRef({ piece: null, moves: [], startX: 0, startY: 0, isDragging: false });
  const [touchDragPos, setTouchDragPos] = useState(null); // {x, y} screen coords for ghost piece
  const [touchDragPiece, setTouchDragPiece] = useState(null); // piece being touch-dragged

  // Ghost board state for move history review
  const [ghostMoveIndex, setGhostMoveIndex] = useState(null);
  const initialPiecesRef = useRef(null);

  // Fog of War: running set of squares permanently revealed (when permanent_fog_reveal is on).
  // Keyed by gameId + player position in localStorage so it survives page refreshes.
  const fogRevealedRef = useRef(new Set());
  const fogRevealedStorageKeyRef = useRef(null);

  // Helper to persist a user preference to the server and local storage
  const updateUserPreference = useCallback(async (key, value) => {
    if (!currentUser) return;
    try {
      await axios.put(
        `${API_URL}users/${currentUser.id}/messaging-preferences`,
        { [key]: value },
        { headers: authHeader() }
      );
      const updatedUser = { ...currentUser, [key]: value ? 1 : 0 };
      localStorage.setItem("user", JSON.stringify(updatedUser));
      dispatch({ type: "UPDATE_USER_PREFERENCES", payload: { user: updatedUser } });
    } catch (err) {
      console.error(`Error saving ${key} preference:`, err);
    }
  }, [currentUser, dispatch]);

  // Persist the sound on/off preference WITHOUT dispatching a global user swap.
  // Sound state is driven locally (soundEnabled + soundEnabledRef), so replacing
  // currentUser here would force a full re-render of the game view — the visible
  // "flash" when toggling mute. We still persist to the server + localStorage so
  // the choice survives a reload / remount.
  const persistSoundPreference = useCallback((enabled) => {
    try {
      const stored = JSON.parse(localStorage.getItem("user") || "null");
      if (stored) {
        stored.sound_enabled = enabled ? 1 : 0;
        localStorage.setItem("user", JSON.stringify(stored));
      }
    } catch (_) { /* ignore */ }
    if (!currentUser) return;
    axios.put(
      `${API_URL}users/${currentUser.id}/messaging-preferences`,
      { sound_enabled: enabled },
      { headers: authHeader() }
    ).catch(err => console.error("Error saving sound_enabled preference:", err));
  }, [currentUser]);

  // Wrapper for makeMove that supports turn confirmation in correspondence games
  const submitMove = useCallback((gId, moveData) => {
    // Start a latency measurement from the moment the user commits the move
    // (drop / click) until the server confirms it (moveMade). Helps distinguish
    // real validation lag from client-side image reload flicker.
    moveTimingRef.current = { t: (typeof performance !== 'undefined' ? performance.now() : Date.now()), type: moveData?.type || 'move' };
    const isSimulStage = gameState?.gameType?.simultaneous_turns
      && gameState?.gameType?.simul_turns_submit_mode === 'stage'
      && gameState?.status === 'active'
      && !simulSubmittedThisRound;
    const isCorrespondenceConfirm = turnConfirmEnabled && gameState?.isCorrespondence && !gameState?.timeControl;

    if (isSimulStage) {
      // Simul-turns + stage mode: stash the move. Player presses Submit when ready.
      // Apply optimistic visual preview so the board reflects the staged move.
      if (moveData.type !== 'place') {
        const snap = createOptimisticSnapshot({ pieces: gameState?.pieces, currentTurn: gameState?.currentTurn });
        setPreConfirmState(snap);
        optimisticMoveSnapshotRef.current = snap;
        setGameState((prev) => applyOptimisticMovePreview(prev, moveData));
      }
      setStagedSimulMove({ gameId: gId, moveData });

      // If also in correspondence confirm-mode, skip the second confirm step
      // (staging IS the confirmation step — the Submit button serves both roles).
      return;
    }

    const optimisticSnapshot = createOptimisticSnapshot({
      pieces: gameState?.pieces,
      currentTurn: gameState?.currentTurn
    });

    if (isCorrespondenceConfirm) {
      // Save current state for revert on cancel
      setPreConfirmState(optimisticSnapshot);
      optimisticMoveSnapshotRef.current = optimisticSnapshot;
      // Apply move visually (optimistic preview)
      if (moveData.type === 'place') {
        // For placement moves, we don't preview visually (complex piece creation)
      } else {
        setGameState((prev) => applyOptimisticMovePreview(prev, moveData));
      }
      setPendingMove({ gameId: gId, moveData });
    } else {
      // Veto games may HOLD the move for the opponent's veto decision. We still
      // apply the mover's own optimistic preview (like a premove) so the move
      // persists visually and doesn't jump when the veto resolves; moveVetoed
      // reverts it via the snapshot. We just don't switch clocks for held moves.
      const vetoActive = !!(gameState?.gameType?.veto_enabled) && !gameState?.gameType?.simultaneous_turns;
      const vetoStyle = gameState?.gameType?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
      const iAmMover = currentPlayerRef.current?.position === gameState?.currentTurn;
      // Pre-emptive: while the vetoer can still veto, queue the move client-side as
      // a single, changeable pre-move (never sent to the server) — it auto-executes
      // when the vetoer submits. This avoids sending multiple held moves and
      // avoids clearing the vetoer's in-progress selection.
      if (vetoActive && vetoStyle === 'preemptive' && iAmMover && !vetoOpponentSubmitted) {
        const clean = optimisticMoveSnapshotRef.current || optimisticSnapshot;
        optimisticMoveSnapshotRef.current = clean;
        setGameState((prev) => {
          const base = { ...prev, pieces: clean.pieces };
          return moveData.type === 'place'
            ? applyOptimisticPlacementPreview(base, moveData, currentPlayerRef.current?.position)
            : applyOptimisticMovePreview(base, moveData);
        });
        setHeldMoveHighlight({ from: moveData.from, to: moveData.to, pieceId: moveData.pieceId, type: moveData.type });
        setVetoStagedMove({ gameId: gId, moveData });
        return;
      }
      // Optimistic position update: move/place piece visually before server confirms
      if (moveData.type === 'place') {
        optimisticMoveSnapshotRef.current = optimisticSnapshot;
        setGameState((prev) => applyOptimisticPlacementPreview(prev, moveData, currentPlayerRef.current?.position));
      } else {
        optimisticMoveSnapshotRef.current = optimisticSnapshot;
        setGameState((prev) => applyOptimisticMovePreview(prev, moveData));
      }
      if (vetoActive) {
        setHeldMoveHighlight({ from: moveData.from, to: moveData.to, pieceId: moveData.pieceId, type: moveData.type });
      }
      makeMove(gId, moveData);
      if (vetoActive) {
        // Held moves resolve via veto events; don't switch clocks optimistically.
        return;
      }
      // Optimistically switch the active clock to the opponent immediately so
      // their clock starts ticking on the client without waiting for the
      // server's moveMade round-trip.  moveMade will re-anchor with the
      // authoritative server times when it arrives.
      if (gameState?.timeControl && Array.isArray(gameState?.players) && gameState?.currentTurn != null) {
        const opponent = gameState.players.find(p => p.position !== gameState.currentTurn);
        if (opponent?.id != null) {
          activeClockPlayerRef.current = opponent.id;
          lastServerTickRef.current = Date.now();
        }
      }
    }
  }, [turnConfirmEnabled, gameState?.isCorrespondence, gameState?.timeControl, gameState?.pieces, gameState?.currentTurn, gameState?.players, gameState?.gameType?.simultaneous_turns, gameState?.gameType?.simul_turns_submit_mode, gameState?.gameType?.veto_enabled, gameState?.gameType?.veto_style, gameState?.status, simulSubmittedThisRound, vetoOpponentSubmitted, makeMove, createOptimisticSnapshot, applyOptimisticMovePreview, applyOptimisticPlacementPreview]);

  /* eslint-disable react-hooks/rules-of-hooks -- False positive: all hooks below are unconditionally at the top level. eslint-plugin-react-hooks v4.4.0 CFG analysis limit reached in this large component. */
  // Cancel the pre-emptive staged pre-move: revert the optimistic board and drop it.
  const cancelVetoStagedMove = useCallback(() => {
    if (!vetoStagedMoveRef.current) return;
    const snap = optimisticMoveSnapshotRef.current;
    if (snap) {
      setGameState(prev => ({ ...prev, pieces: snap.pieces, currentTurn: snap.currentTurn ?? prev.currentTurn }));
    }
    clearOptimisticMoveSnapshot();
    vetoStagedMoveRef.current = null;
    setVetoStagedMove(null);
    setHeldMoveHighlight(null);
    setSelectedPiece(null);
    setValidMoves([]);
  }, [clearOptimisticMoveSnapshot]);

  // Reactive veto: retract the mover's held (under-review) move. Server-authoritative
  // — the board is cleared on the vetoMoveRetracted event so a racing veto submit
  // (which the server rejects) can't leave the UI inconsistent.
  const cancelReactiveHeldMove = useCallback(() => {
    retractVetoMove(parseInt(gameId));
  }, [retractVetoMove, gameId]);

  // Submit / clear the staged simul move. Called from the explicit Submit
  // button rendered in the turn-indicator area when stage-mode is active.
  const submitStagedSimulMove = useCallback(() => {
    if (!stagedSimulMove) return;
    makeMove(stagedSimulMove.gameId, stagedSimulMove.moveData);
    setStagedSimulMove(null);
  }, [makeMove, stagedSimulMove]);
  const clearStagedSimulMove = useCallback(() => {
    // Revert the optimistic board preview applied when the move was staged.
    if (preConfirmState) {
      setGameState(prev => ({
        ...prev,
        pieces: preConfirmState.pieces,
        currentTurn: preConfirmState.currentTurn
      }));
      setPreConfirmState(null);
    }
    clearOptimisticMoveSnapshot();
    setStagedSimulMove(null);
  }, [preConfirmState, clearOptimisticMoveSnapshot]);

  const confirmPendingMove = useCallback(() => {
    if (pendingMove) {
      makeMove(pendingMove.gameId, pendingMove.moveData);
      setPendingMove(null);
      setPreConfirmState(null);
    }
  }, [pendingMove, makeMove]);

  const cancelPendingMove = useCallback(() => {
    if (preConfirmState) {
      setGameState(prev => ({
        ...prev,
        pieces: preConfirmState.pieces,
        currentTurn: preConfirmState.currentTurn
      }));
    }
    clearOptimisticMoveSnapshot();
    setPendingMove(null);
    setPreConfirmState(null);
  }, [preConfirmState, clearOptimisticMoveSnapshot]);

  // Track window size for responsive board sizing
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Ghost board keyboard navigation (arrow keys)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (ghostMoveIndex === null || !gameState?.moveHistory) return;
      const totalMoves = gameState.moveHistory.length;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setGhostMoveIndex(prev => prev > -1 ? prev - 1 : prev);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setGhostMoveIndex(prev => prev < totalMoves - 1 ? prev + 1 : null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setGhostMoveIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ghostMoveIndex, gameState?.moveHistory]);

  // Track lastMove changes to fade out the previous move's highlight for ~1s.
  // Only active in non-ghost mode (live play). User-toggleable via preferences.
  useEffect(() => {
    if (!persistLastMoveHighlight) return;
    if (ghostMoveIndex !== null) return;
    const history = gameState?.moveHistory || [];
    if (history.length === 0) return;
    const lastIdx = history.length - 1;
    const last = history[lastIdx];
    const sig = `${lastIdx}:${last?.pieceId}:${last?.to?.x},${last?.to?.y}`;
    if (prevLastMoveSigRef.current === sig) return;
    // New last-move detected — snapshot the previous lastMoves as fading
    if (prevLastMovesRef.current && prevLastMovesRef.current.length > 0) {
      setFadingLastMoves(prevLastMovesRef.current);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = setTimeout(() => setFadingLastMoves([]), 2000);
    }
    // Compute current lastMoves for next snapshot.
    // Collect all consecutive moves from the same player position so that
    // must_move_if_able extra moves and multi-action-per-turn moves are all
    // highlighted — not just the single last move.
    const moves = [];
    const turnPosition = last?.position;
    if (turnPosition != null) {
      for (let i = lastIdx; i >= 0; i--) {
        if (history[i].position !== turnPosition) break;
        moves.push(history[i]);
      }
    } else {
      moves.push(last);
    }
    prevLastMovesRef.current = moves;
    prevLastMoveSigRef.current = sig;
  }, [gameState?.moveHistory, gameState?.gameType?.actions_per_turn, ghostMoveIndex, persistLastMoveHighlight]);

  // Cleanup any pending fade timeout on unmount
  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  // Synchronous cleanup when gameId changes — clears stale board and game state
  // immediately so pieces from the previous game never flash on the new board.
  // This effect runs in source order BEFORE the async loadGame effect below,
  // which means the board is blank during the async fetch.
  useEffect(() => {
    setGameState(null);
    setError(null);
    setGhostMoveIndex(null);
    setBotThinking(false);
    setMoveError(null);
    setSelectedPiece(null);
    setValidMoves([]);
    setPreConfirmState(null);
    setShowGameOver(false);
    setGameOverData(null);
    setDrawOfferSent(false);
    setPendingDrawOffer(null);
    setSimulSubmittedThisRound(false);
    setSimulOpponentSubmitted(false);
    setCheckedPieces([]);
    setSpectators([]);
    setSpecialSquares({ range: {}, promotion: {}, control: {}, special: {} });
    setCaptureActionPieceId(null);
    setCaptureActionData(null);
    setInCheck(false);
    initialPiecesRef.current = null;
    serverTimesRef.current = {};
    lastServerTickRef.current = null;
    activeClockPlayerRef.current = null;
    // Reset fog reveal history when navigating to a different game
    fogRevealedRef.current = new Set();
    fogRevealedStorageKeyRef.current = null;
  }, [gameId]);

  // Fog permanent reveal: persist accumulated set to localStorage whenever pieces change (after each move)
  useEffect(() => {
    const key = fogRevealedStorageKeyRef.current;
    if (!key || fogRevealedRef.current.size === 0) return;
    try {
      localStorage.setItem(key, JSON.stringify([...fogRevealedRef.current]));
    } catch {
      // localStorage quota — silently ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.pieces]);

  // Load game state on mount
  useEffect(() => {
    const loadGame = async () => {
      if (!connected) return;      
      setLoading(true);
      try {
        // For anonymous correspondence players returning to the game, authenticate
        // with the stored token first so the server can route events to this socket.
        if (!currentUser && authenticateAnonCorresPlayer) {
          await authenticateAnonCorresPlayer(parseInt(gameId)).catch(() => {});
        }

        const state = await getGameState(parseInt(gameId));
        // Ensure allowPremoves is set (default to true if not specified)
        if (state.allowPremoves === undefined) {
          state.allowPremoves = true;
        }
        // Ensure premove property exists
        if (state.premove === undefined) {
          state.premove = null;
        }
        clearOptimisticMoveSnapshot();
        setGameState(state);

        // Restore simul-turns submission state from server-side pendingSimulMoves.
        // If this player already submitted a move this round (e.g. after a refresh),
        // mark them as submitted so the UI doesn't prompt them to stage again.
        // Also visually move the piece to its submitted destination so the board
        // reflects the pending move until the round resolves or is cancelled.
        if (state.gameType?.simultaneous_turns && Array.isArray(state.players)) {
          // Determine this client's player ID — logged-in users use numeric id,
          // guests use anon_<socketId> (the server remaps it during getGameState).
          const myId = currentUser ? String(currentUser.id) : (socket?.id ? `anon_${socket.id}` : null);
          const pending = state.pendingSimulMoves || {};
          if (myId && pending[myId]) {
            setSimulSubmittedThisRound(true);
            // Apply visual preview of our submitted-but-not-yet-resolved move.
            // Only non-ranged, non-placement moves shift a piece visually.
            const pendingMove = pending[myId].move;
            if (pendingMove && pendingMove.pieceId != null && pendingMove.to && !pendingMove.isRangedAttack && pendingMove.type !== 'place') {
              setGameState(prev => applyOptimisticMovePreview(prev, pendingMove));
            }
          }
          // Restore opponent-submitted flag too
          const opponentSubmitted = myId && Object.keys(pending).some(pid => pid !== myId);
          if (opponentSubmitted) setSimulOpponentSubmitted(true);
        }

        // If the game ended before this client mounted (or during a reload),
        // re-display the game-over modal so the user has a definitive
        // signal that the game is over (e.g. initial-position ends where
        // joinGame and gameOver fire back-to-back faster than the modal
        // listener can attach).
        if (state.status === 'completed') {
          const winnerPlayer = Array.isArray(state.players)
            ? state.players.find(p => p.id === state.winner)
            : null;
          setGameOverData({
            winner: state.winner || null,
            winnerUsername: winnerPlayer?.username || null,
            reason: state.winReason || 'game_complete',
            eloChanges: state.eloChanges || null,
          });
          setShowGameOver(true);
        }

        // Restore pending draw offer state from server (handles initial load and reconnect)
        if (state.pendingDrawOffer) {
          if (state.pendingDrawOffer.from === currentUser?.id) {
            setDrawOfferSent(true);
            setPendingDrawOffer(null);
          } else {
            setPendingDrawOffer({ from: state.pendingDrawOffer.from, fromUsername: state.pendingDrawOffer.fromUsername });
            setDrawOfferSent(false);
          }
        }

        // Anchor the local clock interpolation immediately so the displayed clock
        // ticks down smoothly from the moment the game loads (without waiting for
        // the first moveMade or botThinking event).
        if (state?.playerTimes) {
          serverTimesRef.current = { ...state.playerTimes };
          lastServerTickRef.current = Date.now();
          if (state.currentTurn != null && Array.isArray(state.players)) {
            const cp = state.players.find(p => p.position === state.currentTurn);
            activeClockPlayerRef.current = cp?.id ?? null;
          }
        }

        // Capture initial pieces for ghost board replay
        if (state.initialPieces) {
          initialPiecesRef.current = state.initialPieces;
        } else if (!state.moveHistory || state.moveHistory.length === 0) {
          // Game just started — current pieces ARE the initial pieces
          initialPiecesRef.current = JSON.parse(JSON.stringify(parsePieces(state.pieces)));
        }
        
        // Initialize spectators from game state
        if (state.spectators) {
          setSpectators(state.spectators.map(s => ({ id: s.id, username: s.username })));
        }
        
        // Parse special squares from game type
        if (state.gameType) {
          const squares = { range: {}, promotion: {}, control: {}, special: {} };
          try {
            if (state.gameType.range_squares_string) {
              squares.range = JSON.parse(state.gameType.range_squares_string);
            }
          } catch (e) { console.error('Error parsing range_squares_string:', e); }
          try {
            if (state.gameType.promotion_squares_string) {
              squares.promotion = JSON.parse(state.gameType.promotion_squares_string);
            }
          } catch (e) { console.error('Error parsing promotion_squares_string:', e); }
          try {
            if (state.gameType.control_squares_string) {
              squares.control = JSON.parse(state.gameType.control_squares_string);
            }
          } catch (e) { console.error('Error parsing control_squares_string:', e); }
          try {
            if (state.gameType.special_squares_string) {
              squares.special = JSON.parse(state.gameType.special_squares_string);
            }
          } catch (e) { console.error('Error parsing special_squares_string:', e); }
          setSpecialSquares(squares);
        }
      } catch (err) {
        setError(err.message || "Failed to load game");
      } finally {
        setLoading(false);
      }
    };

    loadGame();
  }, [gameId, connected, getGameState, clearOptimisticMoveSnapshot, currentUser, authenticateAnonCorresPlayer]);

  // Load this game type's custom piece sounds (silver-supporter uploads).
  useEffect(() => {
    const gameTypeId = gameState?.gameType?.id;
    if (!gameTypeId) return;
    let cancelled = false;
    axios.get(`${API_URL}game-types/${gameTypeId}/piece-sounds`)
      .then(res => { if (!cancelled) pieceSoundsRef.current = res.data || {}; })
      .catch(() => { /* custom sounds are optional - fall back to defaults */ });
    return () => { cancelled = true; };
  }, [gameState?.gameType?.id]);

  // The custom sound a move should use, or null to fall back to the site default.
  const customSoundFor = useCallback((move, action) => {
    if (!move) return null;
    const pieces = parsePieces(gameState?.pieces);
    const moved = pieces.find(p => p.id === move.pieceId);
    const entry = moved && pieceSoundsRef.current[moved.piece_id];
    const url = entry && entry[action];
    return url ? `${ASSET_URL}${url}` : null;
  }, [gameState?.pieces]);

  // Which built-in sound should layer over a custom one for this move.
  const soundActionFor = (move) => {
    if (move?.captured) return 'capture';
    if (move?.damagedPieces && move.damagedPieces.length > 0) return 'hit';
    return 'move';
  };

  // When not a player, register as a spectator.
  // Also re-registers when game status changes to 'active' so that users who
  // were watching the lobby (before the game started) get added to the
  // spectators list as soon as the match begins.
  const isSpectator = !!(gameState && (anonSpectate || !gameState.players?.some(p => {
    if (currentUser && p.id === currentUser.id) return true;
    if (socket?.id && p.id === `anon_${socket.id}`) return true;
    // Stable anonymous correspondence player ID stored in localStorage
    const storedId = getStoredAnonCorresId ? getStoredAnonCorresId(String(gameId))?.playerId : null;
    if (storedId && p.id === storedId) return true;
    return false;
  })));

  // When the game-over modal opens for a logged-in player (not spectating),
  // check whether they have already upvoted this game type. If not, show the
  // upvote prompt. Spectators and guests are excluded — only players see it.
  // NOTE: this effect must live AFTER the isSpectator declaration to avoid TDZ.
  useEffect(() => {
    if (!showGameOver || !currentUser || isSpectator || !gameState?.gameTypeId) return;
    let cancelled = false;
    getUpvoteStatus(gameState.gameTypeId).then(data => {
      if (!cancelled && !data.upvoted) setGameOverUpvoteState('prompt');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [showGameOver, currentUser, isSpectator, gameState?.gameTypeId]);

  useEffect(() => {
    if (isSpectator && connected && gameId && spectateGame) {
      spectateGame(parseInt(gameId), { anonymous: anonSpectate });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpectator, connected, gameId, spectateGame, anonSpectate, gameState?.status]);

  // Leave game room on unmount so notifications can be sent
  useEffect(() => {
    return () => {
      if (socket && gameId) {
        socket.emit("leaveGame", { gameId: parseInt(gameId) });
      }
    };
  }, [socket, gameId]);

  // Re-anchor the local clock interpolation when the bot starts thinking so the
  // bot's clock keeps draining smoothly during the AI computation (the server
  // event loop is blocked during minimax and can't tick). Once the bot finishes,
  // moveMade re-anchors with the authoritative bot time.
  useEffect(() => {
    if (!botThinking || !gameState?.botPlayer || !gameState?.playerTimes) return;
    const botId = gameState.botPlayer.id || 'bot';
    if (gameState.playerTimes[botId] == null) return;
    serverTimesRef.current = { ...gameState.playerTimes };
    lastServerTickRef.current = Date.now();
    activeClockPlayerRef.current = botId;
  }, [botThinking, gameState?.botPlayer, gameState?.playerTimes]);

  // -------- Fairy-Stockfish (client-side) bot integration --------
  // When the bot's difficulty is 'stockfish' the browser runs the WASM
  // engine and submits the move via `submitFairyStockfishMove`. We used to
  // gate this behind `!gameType.fairy_stockfish_deep_analysis` so deep games
  // could be served by a stronger server-side engine, but that engine isn't
  // wired yet -- if we honored the flag the server would silently fall back
  // to the built-in AI on every move (giving you a 'hard' bot in disguise,
  // not Fairy Stockfish at all). Always run client-side until the server
  // engine ships.
  const isFairyClientBot = !!gameState?.botPlayer
    && gameState.botPlayer.difficulty === 'stockfish';
  const fairyStockfish = useFairyStockfish();

  // Cross-origin isolation safety net: Fairy Stockfish needs SharedArrayBuffer,
  // which is only available when the document was loaded with COOP same-origin +
  // COEP headers (window.crossOriginIsolated === true). Game pages ARE served
  // with those headers, but if the user reached this page via client-side SPA
  // navigation from a non-isolated page (e.g. /login, served with unsafe-none),
  // the isolation state from that original load sticks for the whole session.
  // A single hard reload of THIS page re-fetches it with the correct headers.
  // Guard with sessionStorage so we never loop if the server genuinely lacks
  // the headers.
  useEffect(() => {
    if (!isFairyClientBot) return;
    if (typeof window === 'undefined') return;
    if (window.crossOriginIsolated) return;
    const reloadKey = `coi-reload-${gameId}`;
    if (sessionStorage.getItem(reloadKey)) return; // already tried once
    sessionStorage.setItem(reloadKey, '1');
    console.warn('[FairyStockfish] Page is not cross-origin isolated; reloading once to pick up COOP/COEP headers so SharedArrayBuffer is available.');
    window.location.reload();
  }, [isFairyClientBot, gameId]);

  const [fairyTranslation, setFairyTranslation] = useState(null); // { variantIni, variantName, charMap, boardWidth, boardHeight }
  const fairyStartedForRef = useRef(null); // gameTypeId we've already booted the engine for
  const fairyMoveInFlightRef = useRef(false);
  // Circuit-breaker: if the engine returns no/invalid moves several times in
  // a row in the same game, stop calling it and let the server fallback take
  // over for the rest of the game. Otherwise FoW games or unsupported
  // variants spam fallback requests every turn.
  const fairyFailureCountRef = useRef(0);
  const fairyDisabledForGameRef = useRef(false);
  // Reactive copy so the UI can render a notice when the engine is disabled.
  const [fairyEngineDisabled, setFairyEngineDisabled] = useState(false);
  // Track the last (gameId, turnNumber) we've already asked the server to
  // play via fallback, so clock ticks don't trigger a flood of requests.
  const fairyFallbackAskedRef = useRef('');
  const FAIRY_MAX_CONSECUTIVE_FAILURES = 3;
  // Mirror gameState into a ref so async tasks (engine bestmove resolve)
  // can check the LATEST turn/status instead of the closure snapshot.
  const gameStateRef = useRef(null);

  // Fetch translation bundle (variant INI + char map) once per game type.
  useEffect(() => {
    if (!isFairyClientBot || !gameState?.gameType?.id) return;
    if (fairyTranslation && fairyTranslation._gtid === gameState.gameType.id) return;
    let cancelled = false;
    (async () => {
      try {
        // If the host clicked "Play anyway" past safe-to-ignore compat reasons
        // (fog of war, alternate win conditions, etc.) the server stamps the
        // bot with `forceStockfish`. Tell the translation endpoint so it
        // doesn't 409 us out on those same reasons.
        const ignoreSafe = !!gameState?.botPlayer?.forceStockfish;
        const url = `${API_URL}fairy-stockfish/translation/${gameState.gameType.id}`
          + (ignoreSafe ? '?ignoreSafe=1' : '');
        const resp = await axios.get(url, { headers: authHeader() });
        if (cancelled) return;
        setFairyTranslation({ ...resp.data, _gtid: gameState.gameType.id });
      } catch (err) {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 409) {
          // Game type is not compatible with Fairy-Stockfish (e.g. uses
          // custom squares with unnamed leaper atoms). Trip the circuit
          // breaker immediately so every bot turn falls back to the server
          // built-in AI instead of waiting for an engine that won't start.
          console.warn('[FairyStockfish] Game type incompatible (409); disabling client engine and using server fallback for all moves.');
          fairyDisabledForGameRef.current = true;
          setFairyEngineDisabled(true);
        } else {
          console.error('[FairyStockfish] Failed to load translation bundle', err);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isFairyClientBot, gameState?.gameType?.id, gameState?.botPlayer?.forceStockfish, fairyTranslation]);

  // Boot the engine once the translation bundle is available.
  useEffect(() => {
    if (!isFairyClientBot || !fairyTranslation) return;
    const gtid = fairyTranslation._gtid;
    if (fairyStartedForRef.current === gtid) return;
    fairyStartedForRef.current = gtid;
    fairyStockfish.startEngine(fairyTranslation.variantIni, fairyTranslation.variantName)
      .catch((err) => {
        console.error('[FairyStockfish] startEngine failed; tripping circuit-breaker so server fallback takes over', err);
        // Trip the circuit breaker immediately so every subsequent bot turn
        // goes to the server fallback instead of waiting on an engine that
        // will never be ready. This covers Safari < 15.2 (no SharedArrayBuffer)
        // and any other browser that can't run the pthreads WASM build.
        fairyDisabledForGameRef.current = true;
        setFairyEngineDisabled(true);
      });
  }, [isFairyClientBot, fairyTranslation, fairyStockfish]);

  // Keep gameStateRef in sync so async engine callbacks see the latest state.
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Latest makeMove for veto re-dispatch from socket-event closures.
  const makeMoveRef = useRef(makeMove);
  useEffect(() => { makeMoveRef.current = makeMove; }, [makeMove]);
  // Latest resolved current player (my seat) for socket-event closures.
  const currentPlayerRef = useRef(null);

  // Reset circuit-breaker when entering a new game (different gameId).
  useEffect(() => {
    fairyFailureCountRef.current = 0;
    fairyDisabledForGameRef.current = false;
    setFairyEngineDisabled(false);
  }, [gameId]);

  // When it's the bot's turn, compute and submit a move.
  useEffect(() => {
    if (!isFairyClientBot) return;
    if (!gameState) return;
    if (gameState.status === 'completed') return;
    const botPos = gameState.botPlayer.position;
    if (gameState.currentTurn !== botPos) return;

    // If the circuit breaker has tripped (including when the translation API
    // returned 409 meaning the game type is incompatible), don't run the
    // engine -- but DO ask the server to play this move with its built-in AI,
    // otherwise the bot appears to freeze for the rest of the game.
    // This check intentionally runs BEFORE the fairyTranslation guard so it
    // fires even when translation never loaded (e.g. after a 409).
    if (fairyDisabledForGameRef.current) {
      const askedGameId = gameState?.id ?? gameId;
      // De-dupe per (game, move number) so clock ticks don't spam requests.
      const askKey = `${askedGameId}:${gameState?.totalHalfMoves ?? 0}:${gameState.currentTurn}`;
      if (fairyFallbackAskedRef.current !== askKey) {
        fairyFallbackAskedRef.current = askKey;
        socket.emit('requestBotFallbackMove', {
          gameId: parseInt(askedGameId, 10),
          userId: currentUser?.id,
          reason: 'engine_disabled_for_game',
        });
      }
      return;
    }

    // Normal FS path: engine must be ready and translation loaded.
    if (!fairyStockfish.engineReady) return;
    if (!fairyTranslation) return;
    if (fairyMoveInFlightRef.current) return;
    // Don't recompute while the human is vetoing the engine's already-submitted
    // move (it's held server-side); the veto resolution drives what happens next.
    if (vetoWindow || vetoRevealMove) return;
    // Pre-emptive veto vs a Fairy-Stockfish mover: the human vetoer bans FIRST,
    // then the engine plays a ban-respecting move. Hold the engine compute until
    // the human has submitted (or skipped) their vetoes this turn — otherwise the
    // engine would submit its move before the ban is applied and land on the
    // vetoed square. `vetoDoneThisTurn` flips true once the vetoer submits/skips
    // (or on the server-confirmed resolution via vetoesUpdated).
    {
      const gt = gameState.gameType;
      const isPreemptiveVeto = gt?.veto_enabled && !gt?.simultaneous_turns && gt?.veto_style !== 'reactive';
      if (isPreemptiveVeto && !vetoDoneThisTurn) return;
    }

    const fen = buildFairyFEN(
      gameState.pieces,
      fairyTranslation.boardWidth,
      fairyTranslation.boardHeight,
      gameState.currentTurn,
      gameState.movesWithoutCapture || 0,
      gameState.totalHalfMoves || 0,
      fairyTranslation.charMap,
    );
    if (!fen) {
      console.warn('[FairyStockfish] Failed to build FEN; cannot compute move');
      return;
    }

    fairyMoveInFlightRef.current = true;
    // Map botPlayer.stockfishLevel (1..5) to engine search settings.
    // Strength is expressed primarily as search DEPTH so users see a stable
    // skill knob instead of "the bot took N seconds".  The movetime is a
    // hard upper bound so a runaway never holds up the UI.
    //   1 - Beginner : Skill  1, depth  4 (cap 800ms)
    //   2 - Casual   : Skill  6, depth  8 (cap 2s)
    //   3 - Skilled  : Skill 12, depth 14 (cap 4s)
    //   4 - Expert   : Skill 20, depth 20 (cap 10s, uses clock if available)
    //   5 - Maximum  : Skill 20, depth 30 (cap 60s, uses clock if available)
    const level = Math.max(1, Math.min(5,
      Number(gameState.botPlayer.stockfishLevel) || 3
    ));
    const STRENGTH = {
      1: { skillLevel:  1, depth:  4, movetime:   800, useClock: false },
      2: { skillLevel:  6, depth:  8, movetime:  2000, useClock: false },
      3: { skillLevel: 12, depth: 14, movetime:  4000, useClock: false },
      4: { skillLevel: 20, depth: 20, movetime: 10000, useClock: true  },
      5: { skillLevel: 20, depth: 30, movetime: 60000, useClock: true  },
    };
    const preset = STRENGTH[level];

    // Use the strength preset's depth + movetime directly. We previously
    // scaled the opening movetime down based on the game's total time budget,
    // but in practice the engine moves quickly even at high depth, and the
    // opening throttle made the bot pick obviously bad moves early because
    // it never reached its target depth. Trust the preset.
    const effectiveDepth    = preset.depth;
    const effectiveMovetime = preset.movetime;

    // Resolve bot's clock (seconds remaining) + per-move increment so the
    // engine can spend its time intelligently on Expert/Maximum.
    const botPlayerObj = gameState.players.find(p => p.position === botPos);
    const humanPlayerObj = gameState.players.find(p => p.position !== botPos);
    const botRemainingSec = botPlayerObj && gameState.playerTimes
      ? Number(gameState.playerTimes[botPlayerObj.id]) : null;
    const humanRemainingSec = humanPlayerObj && gameState.playerTimes
      ? Number(gameState.playerTimes[humanPlayerObj.id]) : null;
    const incrementSec = Number(gameState.increment || 0);

    const searchOptions = {
      skillLevel: preset.skillLevel,
      depth: effectiveDepth,
      movetime: effectiveMovetime,
      // Stable per-game key so the worker only resets its TT when the game
      // actually changes, instead of wiping it on every move.
      gameKey: `g${gameId}`,
    };
    // Clock-aware time management whenever the strength preset opts in. We
    // no longer gate this on the opening — the engine picks reasonable times
    // throughout the game, and the previous opening throttle caused weak
    // early moves.
    if (preset.useClock && botRemainingSec != null && humanRemainingSec != null) {
      // FS treats side=w as wtime; map our bot to whichever side it's on so
      // the engine's time-management math is correct.
      // In our FEN builder, the bot is always the side-to-move at engine time,
      // and `buildFairyFEN` writes player 1 as white.
      if (botPos === 1) {
        searchOptions.wtime = Math.max(0, Math.floor(botRemainingSec * 1000));
        searchOptions.btime = Math.max(0, Math.floor(humanRemainingSec * 1000));
        searchOptions.side  = 'w';
      } else {
        searchOptions.wtime = Math.max(0, Math.floor(humanRemainingSec * 1000));
        searchOptions.btime = Math.max(0, Math.floor(botRemainingSec * 1000));
        searchOptions.side  = 'b';
      }
      if (incrementSec > 0) {
        searchOptions.winc = Math.floor(incrementSec * 1000);
        searchOptions.binc = Math.floor(incrementSec * 1000);
      }
      // Tell the engine to budget for ~30 more moves. Without movestogo, FS
      // assumes sudden-death and burns through the clock too fast in the
      // middlegame, leaving nothing for endgame technique.
      searchOptions.movestogo = 30;
    }
    (async () => {
      // Snapshot the turn we were asked to play. If the human plays before
      // the engine returns (or the position changes underneath us), we must
      // not submit a stale move — the server would reject it with "Not the
      // bot's turn" and the noise floods the console.
      const askedTurn = gameState.currentTurn;
      const askedGameId = gameState?.id ?? gameId;
      const noteFailure = (reason, extra) => {
        fairyFailureCountRef.current += 1;
        if (fairyFailureCountRef.current >= FAIRY_MAX_CONSECUTIVE_FAILURES) {
          fairyDisabledForGameRef.current = true;
          setFairyEngineDisabled(true);
          console.warn(`[FairyStockfish] Disabling client-side engine for this game after ${fairyFailureCountRef.current} consecutive failures (${reason}); server fallback will play the rest of the game.`);
        }
        socket.emit('requestBotFallbackMove', {
          gameId: parseInt(askedGameId, 10),
          userId: currentUser?.id,
          reason,
          ...(extra || {}),
        });
      };
      try {
        const bestmove = await fairyStockfish.getBestMove(fen, '', searchOptions);
        // If the turn changed while we were thinking, drop this result.
        if (gameStateRef.current?.currentTurn !== askedTurn ||
            gameStateRef.current?.status === 'completed') {
          return;
        }
        if (!bestmove || bestmove === '(none)' || bestmove === '0000') {
          console.warn('[FairyStockfish] Engine returned no move; requesting server fallback for this turn',
            { bestmove, variantName: fairyTranslation?.variantName, fen, gameTypeId: gameState?.gameType?.id });
          noteFailure('engine_no_move');
          return;
        }
        const parsed = fairyUciToMove(
          bestmove,
          gameState.pieces.filter(p => (p.team || p.player_id) === botPos),
          fairyTranslation?.boardHeight,
        );
        if (!parsed) {
          console.warn('[FairyStockfish] Could not parse bestmove, requesting server fallback for this turn',
            { bestmove, variantName: fairyTranslation?.variantName, fen, gameTypeId: gameState?.gameType?.id,
              botPiecesSummary: gameState.pieces.filter(p => (p.team || p.player_id) === botPos).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y })) });
          noteFailure('unparseable_move', { bestmove });
          return;
        }
        // Engine produced a valid move — reset the failure counter.
        fairyFailureCountRef.current = 0;
        socket.emit('submitFairyStockfishMove', {
          gameId: parseInt(askedGameId, 10),
          userId: currentUser?.id,
          move: {
            from: parsed.from,
            to: parsed.to,
            promotionChar: parsed.promotionChar,
          },
        });
      } catch (err) {
        if (gameStateRef.current?.currentTurn !== askedTurn ||
            gameStateRef.current?.status === 'completed') {
          return;
        }
        console.error('[FairyStockfish] getBestMove failed; requesting server fallback for this turn', err);
        noteFailure('engine_error', { error: err?.message || String(err) });
      } finally {
        // Release after a small debounce so we don't double-fire on the same turn.
        setTimeout(() => { fairyMoveInFlightRef.current = false; }, 500);
      }
    })();
  }, [
    isFairyClientBot,
    fairyStockfish,
    fairyStockfish.engineReady,
    fairyTranslation,
    gameState,
    socket,
    gameId,
    currentUser?.id,
    vetoWindow,
    vetoRevealMove,
    vetoDoneThisTurn,
  ]);

  // Defensive re-anchor: any time the authoritative server-side currentTurn
  // changes, make sure the interpolation refs reflect the new active player.
  // This guards against initial load races and any state path that updates
  // gameState without going through the moveMade re-anchor block.
  useEffect(() => {
    if (gameState?.status !== 'active') return;
    if (!gameState?.playerTimes || !Array.isArray(gameState?.players)) return;
    if (gameState.currentTurn == null) return;
    // During an active veto phase the vetoer's clock ticks instead of the mover's.
    const effectivePos = vetoChargePos != null ? vetoChargePos : gameState.currentTurn;
    const cp = gameState.players.find(p => p.position === effectivePos);
    const newActiveId = cp?.id ?? null;
    if (newActiveId == null) return;
    if (activeClockPlayerRef.current !== newActiveId) {
      // Active player changed (or never set). During a veto phase the server has
      // NOT sent fresh times (the held move hasn't executed), so gameState.playerTimes
      // is stale — re-anchoring to it would snap the displayed clock back up. Base
      // the new anchor on the already-drained displayTimes instead so the clock
      // continues smoothly; a real move re-anchors to authoritative times via moveMade.
      const drained = displayTimesRef.current;
      const base = (drained && Object.keys(drained).length) ? { ...drained } : { ...gameState.playerTimes };
      serverTimesRef.current = base;
      lastServerTickRef.current = Date.now();
      activeClockPlayerRef.current = newActiveId;
    } else if (lastServerTickRef.current == null) {
      // First time we see playerTimes — anchor without changing active player.
      serverTimesRef.current = { ...gameState.playerTimes };
      lastServerTickRef.current = Date.now();
    }
  }, [gameState?.status, gameState?.currentTurn, gameState?.playerTimes, gameState?.players, vetoChargePos]);

  // Subscribe to game events
  useEffect(() => {
    const unsubscribeBotThinking = onGameEvent("botThinking", ({ gameId: botGameId, thinking }) => {
      if (parseInt(botGameId) === parseInt(gameId)) {
        setBotThinking(thinking);
      }
    });

    const unsubscribeMove = onGameEvent("moveMade", ({ gameId: moveGameId, move, gameState: newState, regenPieces, burnPieces, burnKilledPieces, clockMultipliers, midTurnCheckmate, midTurnCheck }) => {
      if (parseInt(moveGameId) === parseInt(gameId)) {
        if (moveTimingRef.current) {
          const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - moveTimingRef.current.t;
          console.log(`[move-timing] ${moveTimingRef.current.type} confirmed by server in ${dt.toFixed(1)}ms`);
          moveTimingRef.current = null;
        }
        try { sessionStorage.removeItem(`vetoPending_${gameId}`); } catch (_) { /* ignore */ }
        clearOptimisticMoveSnapshot();
        setBotThinking(false);
        setHeldMoveHighlight(null);
        setVetoStagedMove(null);
        vetoStagedMoveRef.current = null;
        // Clear any capture action state on a normal move broadcast
        setCaptureActionPieceId(null);
        setCaptureActionData(null);

        // Re-anchor the local clock interpolation to the new server-authoritative times so
        // the displayed clock doesn't "jump" the next time a timeUpdate arrives. Without
        // this re-anchor, the interpolation keeps subtracting elapsed time from the OLD
        // active clock player's stale times, then snaps when timeUpdate finally fires.
        if (newState?.playerTimes) {
          serverTimesRef.current = newState.playerTimes;
          lastServerTickRef.current = Date.now();
          if (newState.currentTurn != null) {
            const playersList = newState.players || playersRef.current;
            if (playersList) {
              const nextPlayer = playersList.find(p => p.position === newState.currentTurn);
              activeClockPlayerRef.current = nextPlayer?.id ?? null;
            }
          }
        }
        
        setGameState(prev => {
          // Ensure allowPremoves is set
          const allowPremoves = newState.allowPremoves !== undefined ? newState.allowPremoves : (prev?.allowPremoves !== undefined ? prev.allowPremoves : true);
          const rated = newState.rated !== undefined ? newState.rated : (prev?.rated !== undefined ? prev.rated : true);
          
          // Clone pieces array to ensure React detects the change
          const updatedState = {
            ...prev,
            ...newState,
            pieces: newState.pieces ? [...newState.pieces] : prev?.pieces,
            allowPremoves,
            rated,
            ...(clockMultipliers !== undefined ? { clockMultipliers } : {}),
            // The applied move resolved any open veto phase server-side; clear
            // the mirror so the reconnect-restore effect doesn't re-open it.
            ...(prev?.vetoState ? { vetoState: { ...prev.vetoState, phaseOpen: false, pendingMove: null, pendingBotMove: null } } : {}),
          };
          
          return updatedState;
        });
        setSelectedPiece(null);
        setValidMoves([]);
        setGhostMoveIndex(null); // Exit ghost review when a new move arrives
        setInCheck(newState.inCheck || false);
        setCheckedPieces(newState.checkedPieces || []);
        if (newState.playerScores) setPlayerScores(newState.playerScores);
        // Sync illegal-move counter from every moveMade event so the opponent's
        // display stays current in HEP games (where the `illegalMove` event is
        // only sent to the offending player, not the full room).
        if (newState.illegalMoveCounts && typeof newState.illegalMoveCounts === 'object') {
          setIllegalMoveCounts({ ...newState.illegalMoveCounts });
        }

        // Show mid-turn checkmate message if detected
        if (midTurnCheckmate) {
          setMoveError(midTurnCheckmate.message);
          setTimeout(() => setMoveError(null), 6000);
        } else if (midTurnCheck) {
          setMoveError('Opponent is in check! Try to checkmate them before your turn ends.');
          setTimeout(() => setMoveError(null), 5000);
        }
        
        // Play sound based on move type - prioritize check > capture > move
        if (soundEnabledRef.current) {
          // A piece with its own sound keeps it, with check layered on top;
          // otherwise check still replaces the action sound as it always did.
          const action = soundActionFor(move);
          const overlay = (newState.inCheck || midTurnCheck) ? 'check' : null;
          soundManager.playPieceAction(action, customSoundFor(move, action), overlay);
        }

        // HP/AD: Show floating damage numbers for damaged pieces
        if (move.damagedPieces && move.damagedPieces.length > 0) {
          const newAnims = move.damagedPieces.map((dp, i) => {
            // Find the damaged piece to get its position
            const damagedPiece = newState.pieces?.find(p => p.id === dp.id);
            return {
              id: `${Date.now()}-${i}`,
              pieceId: dp.id,
              damage: dp.damageDealt,
              x: damagedPiece?.x ?? 0,
              y: damagedPiece?.y ?? 0
            };
          });
          setDamageAnimations(prev => [...prev, ...newAnims]);
          // Clear animations after 1 second
          setTimeout(() => {
            setDamageAnimations(prev => prev.filter(a => !newAnims.some(n => n.id === a.id)));
          }, 1000);
        }

        // HP/AD: Show floating regen numbers with 0.2s delay to avoid overlap with damage
        if (regenPieces && regenPieces.length > 0) {
          setTimeout(() => {
            const regenAnims = regenPieces.map((rp, i) => ({
              id: `regen-${Date.now()}-${i}`,
              pieceId: rp.id,
              healed: rp.healed,
              x: rp.x,
              y: rp.y
            }));
            setRegenAnimations(prev => [...prev, ...regenAnims]);
            // Clear regen animations after 1 second
            setTimeout(() => {
              setRegenAnimations(prev => prev.filter(a => !regenAnims.some(n => n.id === a.id)));
            }, 1000);
          }, 200);
        }

        // DOT/Burn: Show floating burn damage numbers with 0.4s delay (after regen)
        if (burnPieces && burnPieces.length > 0) {
          setTimeout(() => {
            const burnAnims = burnPieces.map((bp, i) => ({
              id: `burn-${Date.now()}-${i}`,
              pieceId: bp.id,
              damage: bp.damage,
              x: bp.x,
              y: bp.y,
              turnsRemaining: bp.turnsRemaining
            }));
            setBurnAnimations(prev => [...prev, ...burnAnims]);
            // Clear burn animations after 1.2 seconds
            setTimeout(() => {
              setBurnAnimations(prev => prev.filter(a => !burnAnims.some(n => n.id === a.id)));
            }, 1200);
          }, 400);
        }
        
        // Check if premove piece still exists, if not clear it
        setPremove(prev => {
          if (prev) {
            const premovePiece = newState.pieces?.find(p => 
              p.x === prev.from.x && p.y === prev.from.y && p.id === prev.pieceId
            );
            if (!premovePiece) {
              return null; // Piece was captured or moved, clear premove
            }
          }
          return prev;
        });
      }
    });

    const unsubscribeCheck = onGameEvent("check", ({ gameId: checkGameId, playerId, playerPosition, checkedPieces: pieces }) => {
      if (parseInt(checkGameId) === parseInt(gameId)) {
        setInCheck(true);
        setCheckedPieces(pieces || []);
        if (soundEnabledRef.current) {
          soundManager.playCheck();
        }
      }
    });

    const unsubscribeGameOver = onGameEvent("gameOver", ({ gameId: overGameId, winner, winnerUsername, reason, finalState, eloChanges, player1Count, player2Count, player1Score, player2Score, finalScores, move }) => {
      if (parseInt(overGameId) === parseInt(gameId)) {
        clearOptimisticMoveSnapshot();
        // Score-based games (Highest Score Wins) send finalScores as { 1, 2 };
        // fold those into the per-player score fields the modal already renders.
        const p1Score = player1Score != null ? player1Score : (finalScores ? finalScores[1] : null);
        const p2Score = player2Score != null ? player2Score : (finalScores ? finalScores[2] : null);
        setGameOverData({ winner, winnerUsername, reason, eloChanges, player1Count, player2Count, player1Score: p1Score, player2Score: p2Score });
        setShowGameOver(true);
        setPendingDrawOffer(null); // Clear any pending draw offer
        setDrawOfferSent(false); // Clear any sent draw offer
        setGameState(prev => ({ 
          ...prev, 
          status: 'completed', 
          winner,
          // Update pieces from finalState if available (includes the final move that caused checkmate)
          pieces: finalState?.pieces || prev.pieces,
          currentTurn: finalState?.currentTurn || prev.currentTurn,
          // Update moveHistory so the final winning move appears in the move history panel
          moveHistory: finalState?.moveHistory || prev.moveHistory
        }));
        setInCheck(false);
        setCheckedPieces([]);
        // Play sound for the final move, then the game-ending sound
        if (soundEnabledRef.current) {
          // First play the move sound (capture/hit/move) for the last move
          if (move) {
            const action = soundActionFor(move);
            soundManager.playPieceAction(action, customSoundFor(move, action), null);
          }
          // Then play the game-ending sound after a short delay so both are audible
          const endSoundDelay = move ? 300 : 0;
          setTimeout(() => {
            if (reason === 'checkmate') {
              soundManager.playCheckmate();
            } else if (reason === 'lose_all_pieces' || reason === 'stalemate_win') {
              soundManager.playCheckmate();
            } else if (reason === 'stalemate' || reason === 'insufficient_material') {
              if (!move) soundManager.playMove();
            }
          }, endSoundDelay);
        }
      }
    });

    const unsubscribeTimeUpdate = onGameEvent("timeUpdate", ({ gameId: timerGameId, playerTimes, currentTurn, clockMultipliers, vetoClockPos }) => {
      if (parseInt(timerGameId) === parseInt(gameId)) {
        serverTimesRef.current = playerTimes || {};
        lastServerTickRef.current = Date.now();
        // During a veto phase the server charges the vetoer's clock, not the mover's.
        const effPos = vetoClockPos != null ? vetoClockPos : currentTurn;
        const activePlayer_ = playersRef.current?.find(p => p.position === effPos);
        activeClockPlayerRef.current = activePlayer_?.id || null;
        setVetoChargePos(vetoClockPos != null ? vetoClockPos : null);
        setGameState(prev => ({
          ...prev,
          playerTimes: playerTimes || prev.playerTimes,
          currentTurn: currentTurn || prev.currentTurn,
          ...(clockMultipliers ? { clockMultipliers } : {})
        }));
      }
    });

    const unsubscribeOpponentDisconnected = onGameEvent('opponentDisconnected', ({ gameId: gid, userId: uid, username, durationMs, expiresAt, paused }) => {
      if (parseInt(gid) !== parseInt(gameId)) return;
      // Only show the banner if the disconnected user is NOT the current viewer.
      // For logged-in users compare numeric IDs; for guests compare the anon_ string ID
      // via currentPlayer (which already resolves the guest's slot by socket.id).
      const myPlayerId = currentUser ? currentUser.id : currentPlayer?.id;
      if (myPlayerId != null && String(uid) === String(myPlayerId)) return;
      setDisconnectInfo({ userId: uid, username: username || 'Opponent', durationMs, expiresAt, paused: !!paused, remainingMs: durationMs });
    });

    const unsubscribeOpponentReconnected = onGameEvent('opponentReconnected', ({ gameId: gid, userId: uid }) => {
      if (parseInt(gid) !== parseInt(gameId)) return;
      setDisconnectInfo(prev => (prev && prev.userId === uid ? null : prev));
    });

    const unsubscribeDisconnectPaused = onGameEvent('disconnectTimerPaused', ({ gameId: gid, userId: uid, remainingMs }) => {
      if (parseInt(gid) !== parseInt(gameId)) return;
      setDisconnectInfo(prev => (prev && prev.userId === uid ? { ...prev, paused: true, remainingMs } : prev));
    });

    const unsubscribeDisconnectResumed = onGameEvent('disconnectTimerResumed', ({ gameId: gid, userId: uid, durationMs, expiresAt }) => {
      if (parseInt(gid) !== parseInt(gameId)) return;
      setDisconnectInfo(prev => (prev && prev.userId === uid ? { ...prev, paused: false, durationMs, expiresAt, remainingMs: durationMs } : prev));
    });
    // When an anon player reconnects with a new socket ID the server remaps their
    // slot and broadcasts the updated players/playerTimes to the whole room so
    // the opponent's clock lookup doesn't fall through to undefined (∞).
    const unsubscribePlayerListUpdated = onGameEvent('playerListUpdated', ({ gameId: gid, players, playerTimes }) => {
      if (parseInt(gid) !== parseInt(gameId)) return;
      setGameState(prev => prev ? {
        ...prev,
        ...(players ? { players } : {}),
        ...(playerTimes ? { playerTimes } : {}),
      } : prev);
      // Re-anchor the local interpolation so the clock doesn't stall after
      // the ID remap replaces the playerTimes keys.
      if (playerTimes) {
        serverTimesRef.current = { ...playerTimes };
        lastServerTickRef.current = Date.now();
      }
    });

    const unsubscribePlayerJoined = onGameEvent("playerJoined", ({ gameId: joinedGameId, gameState: newState }) => {
      if (parseInt(joinedGameId) === parseInt(gameId)) {
        clearOptimisticMoveSnapshot();
        setGameState(prev => {
          // Play game start sound when both players have joined and game starts
          if (soundEnabledRef.current && newState.status === 'active' && (!prev || prev.status !== 'active')) {
            soundManager.playGameStart();
          }
          
          return {
            ...prev,
            ...newState,
            // Ensure we keep allowPremoves and rated
            allowPremoves: newState.allowPremoves !== undefined ? newState.allowPremoves : (prev.allowPremoves !== undefined ? prev.allowPremoves : true),
            rated: newState.rated !== undefined ? newState.rated : (prev.rated !== undefined ? prev.rated : true)
          };
        });
      }
    });

    const unsubscribeGameState = onGameEvent("gameState", (state) => {
      if (parseInt(state.id) === parseInt(gameId)) {
        clearOptimisticMoveSnapshot();
        setGameState(state);
        setLoading(false);
        if (state.playerScores) setPlayerScores(state.playerScores);
        // Restore illegal-move counters on reconnect / page restore so the
        // display matches the server-side persisted counts.
        if (state.illegalMoveCounts && typeof state.illegalMoveCounts === 'object') {
          setIllegalMoveCounts({ ...state.illegalMoveCounts });
        }
        // Restore pending draw offer state from server (handles reconnect/rejoin)
        if (state.pendingDrawOffer) {
          if (state.pendingDrawOffer.from === currentUser?.id) {
            setDrawOfferSent(true);
            setPendingDrawOffer(null);
          } else {
            setPendingDrawOffer({ from: state.pendingDrawOffer.from, fromUsername: state.pendingDrawOffer.fromUsername });
            setDrawOfferSent(false);
          }
        } else {
          setPendingDrawOffer(null);
          setDrawOfferSent(false);
        }
      }
    });

    // Listen for move errors (e.g., "You must get out of check")
    const unsubscribeError = onGameEvent("error", ({ message }) => {
      const optimisticSnapshot = optimisticMoveSnapshotRef.current;
      if (optimisticSnapshot) {
        setGameState((prev) => ({
          ...prev,
          pieces: optimisticSnapshot.pieces,
          currentTurn: optimisticSnapshot.currentTurn ?? prev.currentTurn
        }));
        clearOptimisticMoveSnapshot();
      }
      setHeldMoveHighlight(null);
      setPendingMove(null);
      setPreConfirmState(null);
      showIllegalMoveWarning(message);
    });

    // Hidden Enemy Pieces / Illegal Move Limit: server emits "illegalMove" when
    // a move is rejected in a game with illegal_move_limit > 0. The reason is
    // intentionally suppressed for fog (hide_enemy_pieces) games.
    const unsubscribeIllegalMove = onGameEvent("illegalMove", ({ gameId: imGameId, position, attemptsMade, attemptsRemaining, limit, reason, illegalMoveCounts: updatedCounts }) => {
      if (parseInt(imGameId) !== parseInt(gameId)) return;
      // Sync counter state — prefer the full counts map from the event; fall
      // back to updating just the position whose count we know.
      if (updatedCounts && typeof updatedCounts === 'object') {
        setIllegalMoveCounts({ ...updatedCounts });
      } else if (position != null && attemptsMade != null) {
        setIllegalMoveCounts(prev => ({ ...prev, [position]: attemptsMade }));
      }
      const optimisticSnapshot = optimisticMoveSnapshotRef.current;
      if (optimisticSnapshot) {
        setGameState((prev) => ({
          ...prev,
          pieces: optimisticSnapshot.pieces,
          currentTurn: optimisticSnapshot.currentTurn ?? prev.currentTurn
        }));
        clearOptimisticMoveSnapshot();
      }
      setPendingMove(null);
      setPreConfirmState(null);
      const lead = reason ? reason : 'Illegal move.';
      const tail = attemptsRemaining === 1
        ? '1 illegal move remaining before loss.'
        : `${attemptsRemaining} illegal moves remaining before loss.`;
      showIllegalMoveWarning(`${lead} (${attemptsMade}/${limit}) ${tail}`, 4000);
    });

    // Fairy-Stockfish: the server rejected our submitted engine move (e.g. it
    // walks into check or otherwise violates a rule the engine's Betza model
    // doesn't enforce). Bump the failure counter, suppress re-submitting the
    // same move on this turn, and request a server-side fallback so the bot
    // actually plays. Without this, the client's engine effect would simply
    // re-fire after `fairyMoveInFlightRef` clears (~500ms) and resubmit the
    // same illegal move, stalling the bot's turn indefinitely.
    const unsubscribeFairyRejected = onGameEvent('fairyStockfishMoveRejected', ({ gameId: rejGameId, reason, move }) => {
      if (parseInt(rejGameId) !== parseInt(gameId)) return;
      console.warn('[FairyStockfish] Server rejected engine move; falling back to server-side bot for this turn', { reason, move });
      // Prevent the engine effect from resubmitting immediately.
      fairyMoveInFlightRef.current = true;
      fairyFailureCountRef.current += 1;
      if (fairyFailureCountRef.current >= FAIRY_MAX_CONSECUTIVE_FAILURES) {
        fairyDisabledForGameRef.current = true;
        setFairyEngineDisabled(true);
        console.warn(`[FairyStockfish] Disabling client-side engine for this game after ${fairyFailureCountRef.current} consecutive failures (server_rejection); server fallback will play the rest of the game.`);
      }
      socket.emit('requestBotFallbackMove', {
        gameId: parseInt(gameId, 10),
        userId: currentUser?.id,
        reason: `server_rejected:${reason || 'invalid_move'}`,
      });
    });

    // Listen for premove events
    const unsubscribePremoveSet = onGameEvent("premoveSet", ({ gameId: premoveGameId }) => {
      if (parseInt(premoveGameId) === parseInt(gameId)) {
        // Premove confirmed — no sound on set; regular move sound plays when the premove actually executes
      }
    });

    const unsubscribePremoveCancelled = onGameEvent("premoveCancelled", ({ gameId: cancelGameId, playerId, reason }) => {
      if (parseInt(cancelGameId) === parseInt(gameId)) {
        // Server now also broadcasts cancellations to the whole game room as
        // a delivery safety net; ignore cancellations that aren't ours.
        if (playerId != null && currentUser?.id != null && parseInt(playerId) !== parseInt(currentUser.id)) {
          return;
        }
        setPremove(null);
        setSelectedPiece(null);
        setValidMoves([]);
        // Show a brief, non-alarming notice so the player knows the queued
        // premove didn't execute and they should make a fresh move.
        showIllegalMoveWarning(reason ? `Premove cancelled: ${reason}` : "Premove cancelled — make your move", 2500);
      }
    });

    const unsubscribePremoveExecuted = onGameEvent("premoveExecuted", ({ gameId: execGameId, move, gameState: newState, regenPieces, burnPieces }) => {
      if (parseInt(execGameId) === parseInt(gameId)) {
        clearOptimisticMoveSnapshot();
        setPremove(null);
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          currentTurn: newState.currentTurn,
          playerTimes: newState.playerTimes,
          moveHistory: newState.moveHistory
        }));
        // Update check state from premove result
        if (newState.inCheck !== undefined) {
          setInCheck(newState.inCheck);
          setCheckedPieces(newState.checkedPieces || []);
        }
        // HP/AD: Show floating damage numbers for damaged pieces from premove
        if (move.damagedPieces && move.damagedPieces.length > 0) {
          const newAnims = move.damagedPieces.map((dp, i) => {
            const damagedPiece = newState.pieces?.find(p => p.id === dp.id);
            return {
              id: `premove-dmg-${Date.now()}-${i}`,
              pieceId: dp.id,
              damage: dp.damageDealt,
              x: damagedPiece?.x ?? 0,
              y: damagedPiece?.y ?? 0
            };
          });
          setDamageAnimations(prev => [...prev, ...newAnims]);
          setTimeout(() => {
            setDamageAnimations(prev => prev.filter(a => !newAnims.some(n => n.id === a.id)));
          }, 1000);
        }
        // HP/AD: Show regen animations from turn start (before premove)
        if (regenPieces && regenPieces.length > 0) {
          setTimeout(() => {
            const regenAnims = regenPieces.map((rp, i) => ({
              id: `premove-regen-${Date.now()}-${i}`,
              pieceId: rp.id,
              healed: rp.healed,
              x: rp.x,
              y: rp.y
            }));
            setRegenAnimations(prev => [...prev, ...regenAnims]);
            setTimeout(() => {
              setRegenAnimations(prev => prev.filter(a => !regenAnims.some(n => n.id === a.id)));
            }, 1000);
          }, 200);
        }
        // DOT: Show burn animations from turn start (before premove)
        if (burnPieces && burnPieces.length > 0) {
          setTimeout(() => {
            const burnAnims = burnPieces.map((bp, i) => ({
              id: `premove-burn-${Date.now()}-${i}`,
              pieceId: bp.id,
              damage: bp.damage,
              x: bp.x,
              y: bp.y,
              turnsRemaining: bp.turnsRemaining
            }));
            setBurnAnimations(prev => [...prev, ...burnAnims]);
            setTimeout(() => {
              setBurnAnimations(prev => prev.filter(a => !burnAnims.some(n => n.id === a.id)));
            }, 1200);
          }, 400);
        }
        // Play sound for premove execution - prioritize check > capture > hit > move
        if (soundEnabledRef.current) {
          const action = soundActionFor(move);
          soundManager.playPieceAction(action, customSoundFor(move, action), newState.inCheck ? 'check' : null);
        }
      }
    });

    const unsubscribePremoveCleared = onGameEvent("premoveCleared", ({ gameId: clearGameId }) => {
      if (parseInt(clearGameId) === parseInt(gameId)) {
        setPremove(null);
      }
    });

    // Promotion events
    const unsubscribePromotionRequired = onGameEvent("promotionRequired", ({ gameId: promoGameId, pieceId, pieceName, options, move, gameState: newState }) => {
      if (parseInt(promoGameId) === parseInt(gameId)) {
        // Save pre-move piece positions before clearing the optimistic snapshot,
        // so fog-of-war doesn't reveal the new position until promotion is confirmed.
        const prePromoSnap = optimisticMoveSnapshotRef.current?.pieces || null;
        clearOptimisticMoveSnapshot();
        // Update game state with the move
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          playerTimes: newState.playerTimes,
          moveHistory: newState.moveHistory
        }));
        
        // Find the promoting piece
        const promotingPiece = newState.pieces.find(p => p.id === pieceId);
        
        // Show promotion modal
        setPromotionData({
          pieceId,
          pieceName,
          options,
          promotingPiece
        });
        setShowPromotionModal(true);
        setPrePromotionPieces(prePromoSnap);

        // Play promotion sound
        if (soundEnabledRef.current) {
          soundManager.playMove();
        }
      }
    });

    // Promotion skipped (piece reached promotion square but no valid options)
    const unsubscribePromotionSkipped = onGameEvent("promotionSkipped", ({ gameId: promoGameId, pieceName, message }) => {
      if (parseInt(promoGameId) === parseInt(gameId)) {
        setMoveError(message || `Your ${pieceName || 'piece'} reached a promotion square, but there are no valid pieces to promote to.`);
        setTimeout(() => setMoveError(null), 4000);
      }
    });

    // Promotion cancelled — server reverted the move, let player move again
    const unsubscribePromotionCancelled = onGameEvent("promotionCancelled", ({ gameId: cgid, gameState: restoredState }) => {
      if (parseInt(cgid) !== parseInt(gameId)) return;
      setGameState(prev => ({
        ...prev,
        pieces: restoredState.pieces,
        currentTurn: restoredState.currentTurn,
        moveHistory: restoredState.moveHistory,
      }));
      setShowPromotionModal(false);
      setPromotionData(null);
      setPromotionMinimized(false);
      setPrePromotionPieces(null);
      setSelectedPiece(null);
      setValidMoves([]);
    });

    // Simul-turns: server is asking us to pick a promotion target before
    // our buffered submission resolves. Same modal, just routed differently
    // on Select.
    const unsubscribeSimulPromotionRequired = onGameEvent("simulPromotionRequired", ({ gameId: promoGameId, pieceId, pieceName, options }) => {
      if (parseInt(promoGameId) !== parseInt(gameId)) return;
      setGameState(prev => {
        const promotingPiece = (prev?.pieces || []).find(p => String(p.id) === String(pieceId));
        setPromotionData({ pieceId, pieceName, options, promotingPiece });
        return prev;
      });
      setPromotionIsSimul(true);
      setShowPromotionModal(true);
      if (soundEnabledRef.current) soundManager.playMove();
    });

    // Auto-promotion fell back because the originally chosen target was no
    // longer legal at apply time (e.g. royal cap exceeded). Surface a notice.
    const unsubscribePromotionAutoChosen = onGameEvent("promotionAutoChosen", ({ gameId: promoGameId, message }) => {
      if (parseInt(promoGameId) !== parseInt(gameId)) return;
      setMoveError(message || 'Promotion choice was no longer legal — auto-promoted.');
      setTimeout(() => setMoveError(null), 5000);
    });

    // Simul-turns: a player promoted with free_move_after_promotion AND
    // the game's policy is 'allow' — that player gets to submit one more
    // buffered move alone. The opponent's UI is locked until then.
    const unsubscribeSimulFreeMove = onGameEvent("simulFreeMoveRequired", ({ gameId: gid, playerId, reason }) => {
      if (parseInt(gid) !== parseInt(gameId)) return;
      const isMe = currentUser?.id && Number(playerId) === Number(currentUser.id);
      setSimulSubmittedThisRound(!isMe); // opponent waits with submit-state on
      setSimulOpponentSubmitted(false);
      setSimulRoundNotice(isMe
        ? 'Free move after promotion — submit one more move.'
        : 'Opponent has a free move after promotion — waiting...');
      setTimeout(() => setSimulRoundNotice(null), 5000);
    });

    // Simul-turns: a free-move-after-promotion happened with policy =
    // 'restage' — both players resubmit a fresh round.
    const unsubscribeSimulRestage = onGameEvent("simulRestageRequired", ({ gameId: gid, reason }) => {
      if (parseInt(gid) !== parseInt(gameId)) return;
      setSimulSubmittedThisRound(false);
      setSimulOpponentSubmitted(false);
      setStagedSimulMove(null);
      setSimulRoundNotice('Free move after promotion — both players submit again.');
      setTimeout(() => setSimulRoundNotice(null), 5000);
    });

    const unsubscribePiecePromoted = onGameEvent("piecePromoted", ({ gameId: promoGameId, pieceId, newPieceId, newPieceName, promotedPiece, gameState: newState }) => {
      if (parseInt(promoGameId) === parseInt(gameId)) {
        clearOptimisticMoveSnapshot();
        // Hide promotion modal
        setShowPromotionModal(false);
        setPromotionData(null);
        setPrePromotionPieces(null);
        // Update game state
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          currentTurn: newState.currentTurn
        }));
        
        // Play a sound for promotion
        if (soundEnabledRef.current) {
          soundManager.playMove();
        }
        
        console.log(`Piece ${pieceId} promoted to ${newPieceName}`);
      }
    });

    // Draw events
    const unsubscribeDrawOffered = onGameEvent("drawOffered", ({ gameId: drawGameId, from, fromUsername }) => {
      if (parseInt(drawGameId) === parseInt(gameId)) {
        if (from === currentUser?.id) {
          // Current user sent the offer
          setDrawOfferSent(true);
        } else {
          // Opponent sent the offer
          setPendingDrawOffer({ from, fromUsername });
        }
      }
    });

    const unsubscribeDrawDeclined = onGameEvent("drawDeclined", ({ gameId: drawGameId, by, byUsername }) => {
      if (parseInt(drawGameId) === parseInt(gameId)) {
        setPendingDrawOffer(null);
        setDrawOfferSent(false);
        console.log(`Draw declined by ${byUsername}`);
      }
    });

    const unsubscribeDrawCancelled = onGameEvent("drawCancelled", ({ gameId: drawGameId }) => {
      if (parseInt(drawGameId) === parseInt(gameId)) {
        setPendingDrawOffer(null);
        setDrawOfferSent(false);
      }
    });

    // Game deleted by admin
    const unsubscribeGameDeleted = onGameEvent("gameDeleted", ({ gameId: deletedGameId, message }) => {
      if (parseInt(deletedGameId) === parseInt(gameId)) {
        // Store message to show after redirect
        sessionStorage.setItem('gameDeletedMessage', message || 'This game has been deleted by an administrator.');
        navigate('/play/games');
      }
    });

    // Spectator list updates
    const unsubscribeSpectatorUpdate = onGameEvent("spectatorUpdate", ({ spectators: spectatorList }) => {
      setSpectators(spectatorList || []);
    });

    // Stalemate notice (fires when no stalemate rule applies and the stalemated
    // player's turn is being skipped instead of ending the game).
    const unsubscribeStalemateNotice = onGameEvent("stalemateNotice", ({ gameId: noticeGameId, message, currentTurn }) => {
      if (parseInt(noticeGameId) !== parseInt(gameId)) return;
      setStalemateNotice(message);
      if (typeof currentTurn === 'number') {
        setGameState(prev => ({ ...prev, currentTurn }));
      }
      // Auto-dismiss after a while so it doesn't block the UI.
      setTimeout(() => setStalemateNotice(null), 12000);
    });

    // gameRerolling: server is re-rolling the randomized starting position
    // because the rolled position would have ended the game immediately.
    // Show a transient banner so both players understand the brief delay.
    const unsubscribeReroll = onGameEvent("gameRerolling", ({ gameId: rerollGameId, attempts, reason }) => {
      if (parseInt(rerollGameId) !== parseInt(gameId)) return;
      const msg = reason || `The starting position was already decided — re-rolled ${attempts || 1} time(s).`;
      setRerollNotice(msg);
      setTimeout(() => setRerollNotice(null), 6000);
    });

    // ===== SIMULTANEOUS TURNS =====
    const unsubscribeSimulSubmitted = onGameEvent('simulMoveSubmitted', ({ gameId: simGid }) => {
      if (parseInt(simGid) !== parseInt(gameId)) return;
      setSimulSubmittedThisRound(true);
    });
    const unsubscribeSimulOpponentSubmitted = onGameEvent('simulOpponentSubmitted', ({ gameId: simGid, submittedPlayerId }) => {
      if (parseInt(simGid) !== parseInt(gameId)) return;
      // Only flag if the *other* player is the one who submitted.
      if (currentUser?.id && parseInt(submittedPlayerId) !== parseInt(currentUser.id)) {
        setSimulOpponentSubmitted(true);
      }
    });
    // Simul-turns ready-up: server tells us which players have pressed Ready.
    const unsubscribeSimulReady = onGameEvent('simulReadyUpdate', ({ gameId: simGid, readyPlayerIds, allReady }) => {
      if (parseInt(simGid) !== parseInt(gameId)) return;
      setSimulReadyPlayerIds(Array.isArray(readyPlayerIds) ? readyPlayerIds : []);
      if (allReady) {
        // Server has flipped game to active — mirror that locally so the
        // move-submission UI shows instead of the "I'm Ready" button.
        setGameState(prev => prev ? { ...prev, status: 'active' } : prev);
        setSimulSubmittedThisRound(false);
        setSimulOpponentSubmitted(false);
      }
    });
    const unsubscribeSimulResolved = onGameEvent('simulRoundResolved', ({ gameId: simGid, moves, cancellations, cancellationCount, cancellationDrawThreshold, promotions, pieces, playerTimes }) => {
      if (parseInt(simGid) !== parseInt(gameId)) return;
      // Reset round-state locks
      setSimulSubmittedThisRound(false);
      setSimulOpponentSubmitted(false);
      // If the modal somehow stayed open across a round (e.g. server applied
      // an auto-pick), close it now.
      setShowPromotionModal(false);
      setPromotionData(null);
      setPromotionIsSimul(false);
      setStagedSimulMove(null);
      if (typeof cancellationCount === 'number') setSimulCancellationCount(cancellationCount);
      // Update pieces, clocks, and move history
      setGameState(prev => ({
        ...prev,
        pieces: pieces ? [...pieces] : prev?.pieces,
        playerTimes: playerTimes || prev?.playerTimes,
        // Append this round's move records so capturedPieces stays up to date
        // without requiring a page reload.
        moveHistory: prev?.moveHistory
          ? [...prev.moveHistory, ...(moves || [])]
          : (moves || []),
      }));
      if (playerTimes) {
        serverTimesRef.current = playerTimes;
        lastServerTickRef.current = Date.now();
      }
      setSelectedPiece(null);
      setValidMoves([]);
      // Surface a notice describing what happened this round.
      const cancelledMine = (cancellations || []).find(c => currentUser?.id && parseInt(c.playerId) === parseInt(currentUser.id));
      const cancelledOpp = (cancellations || []).find(c => !currentUser?.id || parseInt(c.playerId) !== parseInt(currentUser.id));
      let msg = null;
      if (cancelledMine && cancelledOpp) {
        msg = `Both moves cancelled (${cancelledMine.reason === 'same_square' ? 'same destination' : cancelledMine.reason}).`;
        if (cancellationDrawThreshold > 0) {
          msg += ` Cancellations: ${cancellationCount}/${cancellationDrawThreshold}.`;
        }
      } else if (cancelledMine) {
        msg = `Your move was cancelled (${cancelledMine.reason}).`;
      } else if (cancelledOpp) {
        msg = `Opponent's move was cancelled (${cancelledOpp.reason}).`;
      } else if (moves && moves.length > 0) {
        // Quiet round — no notice needed.
      }
      if (msg) {
        setSimulRoundNotice(msg);
        setTimeout(() => setSimulRoundNotice(null), 4500);
      }
      // Play a sound so the round-resolution feels like a beat.
      if (soundEnabledRef.current) {
        const anyCapture = (moves || []).some(m => Array.isArray(m.capturedPieceIds) && m.capturedPieceIds.length > 0);
        if (anyCapture) soundManager.playCapture(); else soundManager.playMove();
      }
    });

    // Capture actions per turn: bonus capture opportunity after a normal capture
    const unsubscribeCaptureActionRequired = onGameEvent("captureActionRequired", ({ gameId: caGameId, pieceId, actionsUsed, actionsTotal, gameState: newState }) => {
      if (parseInt(caGameId) !== parseInt(gameId)) return;
      clearOptimisticMoveSnapshot();
      setGameState(prev => ({ ...prev, ...newState, pieces: newState.pieces ? [...newState.pieces] : prev?.pieces }));
      setCaptureActionPieceId(pieceId);
      setCaptureActionData({ actionsUsed, actionsTotal, isRanged: false });
      setSelectedPiece(null);
      setValidMoves([]);
    });

    const unsubscribeRangedCaptureActionRequired = onGameEvent("rangedCaptureActionRequired", ({ gameId: caGameId, pieceId, actionsUsed, actionsTotal, gameState: newState }) => {
      if (parseInt(caGameId) !== parseInt(gameId)) return;
      clearOptimisticMoveSnapshot();
      setGameState(prev => ({ ...prev, ...newState, pieces: newState.pieces ? [...newState.pieces] : prev?.pieces }));
      setCaptureActionPieceId(pieceId);
      setCaptureActionData({ actionsUsed, actionsTotal, isRanged: true });
      setSelectedPiece(null);
      setValidMoves([]);
    });

    // Capture action skipped (or last action used) — state clears, turn switched
    const unsubscribeCaptureActionSkipped = onGameEvent("captureActionSkipped", ({ gameId: caGameId, gameState: newState }) => {
      if (parseInt(caGameId) !== parseInt(gameId)) return;
      clearOptimisticMoveSnapshot();
      setGameState(prev => ({ ...prev, ...newState, pieces: newState.pieces ? [...newState.pieces] : prev?.pieces }));
      setCaptureActionPieceId(null);
      setCaptureActionData(null);
      setSelectedPiece(null);
      setValidMoves([]);
      setInCheck(newState.inCheck || false);
      setCheckedPieces(newState.checkedPieces || []);
    });

    const unsubscribeReposition = onGameEvent("repositionApplied", ({ gameId: rGameId, pieces, repositionPhase, gameStatus }) => {
      if (parseInt(rGameId) === parseInt(gameId)) {
        setGameState(prev => ({
          ...prev,
          pieces: [...pieces],
          repositionPhase,
          ...(gameStatus ? { status: gameStatus } : {}),
        }));
      }
    });

    // ─── Veto power events ───────────────────────────────────────────────────
    const myPosition = () => currentPlayerRef.current?.position ?? null;

    const unsubscribeVetoWindow = onGameEvent("vetoWindowOpened", ({ gameId: vGameId, mover, vetoer, revealMove, style, budget }) => {
      if (parseInt(vGameId) !== parseInt(gameId)) return;
      // A veto window only opens during active play; if a held first move left
      // the client showing the game as 'ready', promote it so the veto panel
      // (which only renders for an active game) appears.
      setGameState(prev => (prev && prev.status === 'ready') ? { ...prev, status: 'active' } : prev);
      const pos = myPosition();
      setVetoChargePos(vetoer);
      if (pos === vetoer) {
        setVetoWindow({ style, revealMove: revealMove || null, budget });
        setVetoMyBudget(budget || null);
        setVetoSelection([]);
        setVetoSelectedPiece(null);
        setVetoPieceMoves([]);
        setVetoError(null);
        // Reactive: reveal the opponent's just-submitted move so it can be vetoed.
        setVetoRevealMove(style === 'reactive' && revealMove ? revealMove : null);
      } else if (pos === mover) {
        setVetoMoveUnderReview(true);
      }
    });

    const unsubscribeVetoesUpdated = onGameEvent("vetoesUpdated", ({ gameId: vGameId, banned, mover }) => {
      if (parseInt(vGameId) !== parseInt(gameId)) return;
      setVetoBanned(Array.isArray(banned) ? banned : []);
      setVetoBannedMover(mover != null ? mover : null);
      setVetoPreviewSquares(null);
      setVetoPreviewMoves(null);
      if (mover != null && myPosition() === mover) {
        setVetoOpponentSubmitted(true);
        // Auto-send my queued pre-move now that the vetoer has decided. A short
        // delay lets me glimpse the confirmed bans before the move validates.
        if (vetoStagedMoveRef.current) {
          const staged = vetoStagedMoveRef.current;
          vetoStagedMoveRef.current = null;
          setVetoStagedMove(null);
          setTimeout(() => {
            if (makeMoveRef.current) makeMoveRef.current(staged.gameId, staged.moveData);
          }, 700);
        }
      }
      // The vetoer resolved this action — the mover's clock starts now.
      setVetoChargePos(null);
    });

    const unsubscribeVetoState = onGameEvent("vetoStateUpdate", ({ gameId: vGameId, perGameLimit, remaining, vetoClockPos, clockStarted }) => {
      if (parseInt(vGameId) !== parseInt(gameId)) return;
      setVetoPerGameLimit(perGameLimit != null ? perGameLimit : null);
      if (remaining) setVetoBank({ 1: remaining[1], 2: remaining[2] });
      setVetoChargePos(vetoClockPos != null ? vetoClockPos : null);
      if (clockStarted != null) setVetoClockStarted(!!clockStarted);
    });

    const unsubscribeVetoPreview = onGameEvent("vetoPreviewUpdated", ({ gameId: vGameId, mover, signatures }) => {
      if (parseInt(vGameId) !== parseInt(gameId)) return;
      // Only the mover renders the opponent's in-progress preview.
      if (myPosition() !== mover) return;
      const bh = gameState?.gameType?.board_height || 8;
      const m = new Map();
      const labels = new Map();
      const sigs = Array.isArray(signatures) ? signatures : [];
      for (let i = sigs.length - 1; i >= 0; i--) {
        const sig = sigs[i];
        if (typeof sig !== 'string') continue;
        let key;
        if (sig.startsWith('place:')) key = sig.slice(6);
        else { const parts = sig.split('|'); key = parts[2]; }
        if (!key) continue;
        m.set(key, (m.get(key) || 0) + 1);
        const d = parseVetoSig(sig);
        if (d) {
          const label = d.isPlace
            ? `place ${vetoSquareLabel(d.to, bh)}`
            : `${vetoSquareLabel(d.from, bh)}-${vetoSquareLabel(d.to, bh)}${d.ranged ? ' (ranged)' : ''}`;
          if (!labels.has(key)) labels.set(key, []);
          labels.get(key).push(label);
        }
      }
      setVetoPreviewSquares(m.size ? m : null);
      setVetoPreviewMoves(labels.size ? labels : null);
    });

    const unsubscribeVetoSubmitted = onGameEvent("vetoSubmitted", ({ banned, budget }) => {
      setVetoBanned(Array.isArray(banned) ? banned : []);
      // These are the bans I (the vetoer) just committed against my opponent, so
      // the mover is the opponent — I should not see the X-marks on my own board.
      setVetoBannedMover(myPosition() === 1 ? 2 : 1);
      setVetoMyBudget(budget || null);
      setVetoWindow(null);
      setVetoSelection([]);
      setVetoSelectedPiece(null);
      setVetoPieceMoves([]);
      setVetoError(null);
      setVetoRevealMove(null);
      setVetoDoneThisTurn(true);
      try { sessionStorage.removeItem(`vetoPending_${gameId}`); } catch (_) { /* ignore */ }
      setGameState(prev => prev?.vetoState ? { ...prev, vetoState: { ...prev.vetoState, phaseOpen: false, pendingMove: null, pendingBotMove: null } } : prev);
    });

    const unsubscribeVetoRejected = onGameEvent("vetoRejected", ({ message }) => {
      const msg = message || "Veto submission rejected.";
      setVetoError(msg);
      showIllegalMoveWarning(msg, 3500);
    });

    // Reactive: the mover retracted their under-review held move. Clear it on the
    // mover's board and close the veto window on the vetoer's side.
    const unsubscribeVetoRetracted = onGameEvent("vetoMoveRetracted", ({ gameId: vGameId, mover }) => {
      if (parseInt(vGameId) !== parseInt(gameId)) return;
      if (myPosition() === mover) {
        setVetoMoveUnderReview(false);
        setHeldMoveHighlight(null);
        setSelectedPiece(null);
        setValidMoves([]);
        const snap = optimisticMoveSnapshotRef.current;
        if (snap) setGameState((prev) => ({ ...prev, pieces: snap.pieces, currentTurn: snap.currentTurn ?? prev.currentTurn }));
        clearOptimisticMoveSnapshot();
      } else {
        // Vetoer: the move under review is gone — close the window + drop selection.
        setVetoWindow(null);
        setVetoRevealMove(null);
        setVetoSelection([]);
        setVetoSelectedPiece(null);
        setVetoPieceMoves([]);
      }
    });

    const unsubscribeVetoRetractRejected = onGameEvent("vetoRetractRejected", ({ message }) => {
      showIllegalMoveWarning(message || "Too late to retract your move.", 2500);
    });

    const unsubscribeVetoCleared = onGameEvent("vetoCleared", ({ gameId: vGameId, mover, move }) => {
      if (parseInt(vGameId) !== parseInt(gameId)) return;
      setVetoRevealMove(null);
      if (myPosition() === mover) {
        setVetoMoveUnderReview(false);
        // The move survived the veto — re-submit it for execution.
        makeMoveRef.current(parseInt(gameId), { ...move, _vetoCleared: true });
      }
    });

    const unsubscribeMoveVetoed = onGameEvent("moveVetoed", ({ gameId: vGameId, mover, message, banned }) => {
      if (vGameId != null && parseInt(vGameId) !== parseInt(gameId)) return;
      if (Array.isArray(banned)) setVetoBanned(banned);
      if (mover != null) setVetoBannedMover(mover);
      if (mover == null || myPosition() === mover) {
        setVetoMoveUnderReview(false);
        setSelectedPiece(null);
        setValidMoves([]);
        setHeldMoveHighlight(null);
        // Revert the optimistic preview of the held move that was just vetoed.
        const snap = optimisticMoveSnapshotRef.current;
        if (snap) {
          setGameState((prev) => ({ ...prev, pieces: snap.pieces, currentTurn: snap.currentTurn ?? prev.currentTurn }));
        }
        clearOptimisticMoveSnapshot();
        showIllegalMoveWarning(message || "That move was vetoed. Choose a different move.", 3500);
      }
    });

    return () => {
      unsubscribeReposition();
      unsubscribeVetoWindow();
      unsubscribeVetoesUpdated();
      unsubscribeVetoState();
      unsubscribeVetoPreview();
      unsubscribeVetoSubmitted();
      unsubscribeVetoRejected();
      unsubscribeVetoCleared();
      unsubscribeVetoRetracted();
      unsubscribeVetoRetractRejected();
      unsubscribeMoveVetoed();
      unsubscribeBotThinking();
      unsubscribeMove();
      unsubscribeCheck();
      unsubscribeGameOver();
      unsubscribeStalemateNotice();
      unsubscribeReroll();
      unsubscribeSimulSubmitted();
      unsubscribeSimulOpponentSubmitted();
      unsubscribeCaptureActionRequired();
      unsubscribeRangedCaptureActionRequired();
      unsubscribeCaptureActionSkipped();
      unsubscribeSimulResolved();
      unsubscribeSimulReady();
      unsubscribePlayerListUpdated();
      unsubscribePlayerJoined();
      unsubscribeGameState();
      unsubscribeError();
      unsubscribeIllegalMove();
      unsubscribeFairyRejected();
      unsubscribeTimeUpdate();
      unsubscribeOpponentDisconnected();
      unsubscribeOpponentReconnected();
      unsubscribeDisconnectPaused();
      unsubscribeDisconnectResumed();
      unsubscribePremoveSet();
      unsubscribePremoveCancelled();
      unsubscribePremoveExecuted();
      unsubscribePremoveCleared();
      unsubscribePromotionRequired();
      unsubscribePromotionSkipped();
      unsubscribePromotionCancelled();
      unsubscribeSimulPromotionRequired();
      unsubscribePromotionAutoChosen();
      unsubscribeSimulFreeMove();
      unsubscribeSimulRestage();
      unsubscribePiecePromoted();
      unsubscribeDrawOffered();
      unsubscribeDrawDeclined();
      unsubscribeDrawCancelled();
      unsubscribeGameDeleted();
      unsubscribeSpectatorUpdate();
    };
  }, [gameId, onGameEvent, navigate, currentUser?.id, clearOptimisticMoveSnapshot, showIllegalMoveWarning]);

  // Get current player info
  /* eslint-disable react-hooks/exhaustive-deps */
  const currentPlayer = useMemo(() => {
    if (!gameState?.players) return null;
    if (currentUser) {
      return gameState.players.find(p => p.id === currentUser.id);
    }
    // Anonymous live player: match by anon_ + socket id
    if (socket?.id) {
      const liveMatch = gameState.players.find(p => p.id === `anon_${socket.id}`);
      if (liveMatch) return liveMatch;
    }
    // Anonymous correspondence player: match by stored token-based ID
    const storedCorresId = getStoredAnonCorresId ? getStoredAnonCorresId(String(gameId))?.playerId : null;
    if (storedCorresId) {
      return gameState.players.find(p => p.id === storedCorresId) || null;
    }
    return null;
  }, [gameState?.players, currentUser, socket?.id, gameId, getStoredAnonCorresId]);
  /* eslint-enable react-hooks/exhaustive-deps */
  useEffect(() => { currentPlayerRef.current = currentPlayer; }, [currentPlayer]);
  useEffect(() => { vetoStagedMoveRef.current = vetoStagedMove; }, [vetoStagedMove]);

  // Reset transient veto UI at each turn AND each action boundary (multi-action
  // turns record a move without flipping currentTurn). Crucially this must NOT
  // fire on the ready->active promotion (a held first move) — that would wipe a
  // veto window the moment it opens — so the clear is gated on the turn/action
  // boundary key, while the clock-charge derivation runs on every change.
  const vetoBoundaryRef = useRef(null);
  useEffect(() => {
    const boundaryKey = `${gameState?.currentTurn}:${gameState?.moveHistory?.length ?? 0}`;
    if (vetoBoundaryRef.current !== boundaryKey) {
      vetoBoundaryRef.current = boundaryKey;
      setVetoBanned([]);
      setVetoBannedMover(null);
      setVetoWindow(null);
      setVetoSelection([]);
      setVetoSelectedPiece(null);
      setVetoPieceMoves([]);
      setVetoMoveUnderReview(false);
      setVetoError(null);
      setVetoDoneThisTurn(false);
      setVetoOpponentSubmitted(false);
      setVetoPreviewSquares(null);
      setVetoPreviewMoves(null);
      setVetoRevealMove(null);
      setHeldMoveHighlight(null);
      setVetoStagedMove(null);
      vetoStagedMoveRef.current = null;
    }
    const gt = gameState?.gameType;
    if (gt?.veto_enabled && !gt?.simultaneous_turns && gt?.veto_style !== 'reactive'
        && gameState?.status === 'active' && gameState?.currentTurn != null) {
      const vetoerPos = gameState.currentTurn === 1 ? 2 : 1;
      const isBotVetoer = !!(gameState.botPlayer && gameState.botPlayer.position === vetoerPos);
      setVetoChargePos(isBotVetoer ? null : vetoerPos);
    } else {
      setVetoChargePos(null);
    }
  }, [gameState?.currentTurn, gameState?.moveHistory?.length, gameState?.status, gameState?.gameType, gameState?.botPlayer]);

  // Restore an in-progress REACTIVE veto window after a reconnect/refresh. The
  // reset effect above wipes transient veto UI on every gameState change; this
  // runs immediately after it (same commit) and re-opens the window from the
  // authoritative server vetoState so refreshing mid-veto doesn't strand the
  // game. Only fires when the server state actually has an open phase — normal
  // live holds are driven by the vetoWindowOpened event and clear phaseOpen via
  // moveMade/vetoSubmitted, so this won't double-fire during ordinary play.
  useEffect(() => {
    const vs = gameState?.vetoState;
    const gt = gameState?.gameType;
    if (!vs?.phaseOpen || !gt?.veto_enabled || gt?.veto_style !== 'reactive'
        || gameState?.status !== 'active' || gameState?.currentTurn == null) return;
    const moverPos = gameState.currentTurn;
    const vetoerPos = moverPos === 1 ? 2 : 1;
    const myPos = currentPlayerRef.current?.position ?? null;
    if (myPos == null) return;
    if (myPos === vetoerPos) {
      // If we already submitted/skipped this action but the confirmation was
      // lost to a refresh, re-send it so the veto registers and the game
      // continues (double-submit is safely rejected server-side).
      let pending = null;
      try { pending = JSON.parse(sessionStorage.getItem(`vetoPending_${gameId}`) || 'null'); } catch (_) { /* ignore */ }
      if (pending && pending.actionKey === vs.lastActionKey && Array.isArray(pending.vetoes)) {
        try { sessionStorage.removeItem(`vetoPending_${gameId}`); } catch (_) { /* ignore */ }
        submitVetoes(parseInt(gameId), pending.vetoes);
        return;
      }
      if (pending) { try { sessionStorage.removeItem(`vetoPending_${gameId}`); } catch (_) { /* ignore */ } }
      const reveal = vs.pendingBotMove || (vs.pendingMove && vs.pendingMove.move) || null;
      setVetoWindow({ style: 'reactive', revealMove: reveal, budget: null });
      setVetoRevealMove(reveal);
      setVetoChargePos(vetoerPos);
    } else if (myPos === moverPos && (vs.pendingMove || vs.pendingBotMove)) {
      setVetoMoveUnderReview(true);
    }
  }, [gameState?.vetoState, gameState?.currentTurn, gameState?.status, gameState?.gameType, gameId, submitVetoes]);

  // Pre-emptive: if the vetoer already committed their bans for this action
  // (phaseResolved), restore that on reload — mark the mover as good-to-move and
  // the vetoer as done — so a mid-veto refresh doesn't strand the game or let the
  // vetoer re-submit into a "0 left" rejection. Also recovers games stuck by the
  // old missing-gameId bug.
  useEffect(() => {
    const gt = gameState?.gameType;
    const vs = gameState?.vetoState;
    if (!gt?.veto_enabled || gt?.simultaneous_turns) return;
    const style = gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
    if (style !== 'preemptive' || gameState?.currentTurn == null) return;
    if (!vs?.phaseResolved) return;
    const myPos = currentPlayerRef.current?.position ?? null;
    if (myPos == null) return;
    if (myPos === gameState.currentTurn) setVetoOpponentSubmitted(true); // I'm the mover
    else setVetoDoneThisTurn(true); // I'm the vetoer — already submitted this action
  }, [gameState?.vetoState?.phaseResolved, gameState?.gameType, gameState?.currentTurn]);

  // Pre-emptive vs. a bot vetoer: the bot never submits vetoes interactively, so
  // my staged pre-move would wait forever. When it's my turn to move, ask the
  // server to commit the bot's blind vetoes (idempotent, once per action) — the
  // resulting vetoesUpdated unblocks me and reveals the bans.
  const botVetoRequestedRef = useRef(null);
  useEffect(() => {
    const gt = gameState?.gameType;
    if (!gt?.veto_enabled || gt?.simultaneous_turns) return;
    if ((gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive') !== 'preemptive') return;
    if (!gameState?.botPlayer || gameState?.currentTurn == null) return;
    if (gameState?.status !== 'active' && gameState?.status !== 'ready') return;
    const myPos = currentPlayer?.position ?? null;
    if (myPos == null || myPos !== gameState.currentTurn) return; // only the human mover
    if (vetoOpponentSubmitted) return; // bot already resolved this action
    const key = `${gameState.currentTurn}:${gameState.moveHistory?.length ?? 0}`;
    if (botVetoRequestedRef.current === key) return;
    botVetoRequestedRef.current = key;
    requestBotVeto(parseInt(gameId));
  }, [gameState?.gameType, gameState?.status, gameState?.currentTurn, gameState?.moveHistory?.length, gameState?.botPlayer, currentPlayer, vetoOpponentSubmitted, requestBotVeto, gameId]);

  // Initialize the veto bank display from the game type (both players start at the
  // per-game cap); server vetoStateUpdate events keep it current thereafter.
  useEffect(() => {
    const gt = gameState?.gameType;
    if (gt?.veto_enabled && gt?.veto_per_game_limit != null) {
      const cap = Math.max(1, Math.min(100, Number(gt.veto_per_game_limit)));
      setVetoPerGameLimit(cap);
      setVetoBank(prev => prev || { 1: cap, 2: cap });
    } else {
      setVetoPerGameLimit(null);
      setVetoBank(null);
    }
  }, [gameState?.gameType?.veto_enabled, gameState?.gameType?.veto_per_game_limit]);

  // Keep the confirmed bans visible until the move validates: the turn-boundary
  // reset clears them, so no extra lingering is needed.

  // Sync the veto clock-started flag from authoritative game state (covers load /
  // reconnect). Non-veto games are never frozen. Once started it stays started.
  useEffect(() => {
    const gt = gameState?.gameType;
    if (!gt?.veto_enabled || gt?.simultaneous_turns) { setVetoClockStarted(true); return; }
    if (gameState?.vetoState?.clockStarted) setVetoClockStarted(true);
  }, [gameState?.gameType, gameState?.vetoState?.clockStarted]);

  // Escape cancels a queued premove.
  useEffect(() => {
    if (!premove) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setPremove(null);
        sendClearPremove(parseInt(gameId));
        setSelectedPiece(null);
        setValidMoves([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [premove, sendClearPremove, gameId]);

  // Escape cancels a pre-emptive staged pre-move.
  useEffect(() => {
    if (!vetoStagedMove) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') cancelVetoStagedMove();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [vetoStagedMove, cancelVetoStagedMove]);

  // Escape retracts a reactive held move that's still under review (vetoer hasn't
  // responded yet). Allowed even though board input is otherwise locked.
  useEffect(() => {
    const style = gameState?.gameType?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
    if (style !== 'reactive' || !vetoMoveUnderReview) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') cancelReactiveHeldMove();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState?.gameType?.veto_style, vetoMoveUnderReview, cancelReactiveHeldMove]);

  // Live-broadcast the vetoer's in-progress selection so the opponent sees vetoes
  // arrive as they are picked (both pre-emptive and reactive).
  useEffect(() => {
    const gt = gameState?.gameType;
    if (!gt?.veto_enabled || gt?.simultaneous_turns) return;
    if ((gameState?.status !== 'active' && gameState?.status !== 'ready') || !currentPlayer) return;
    if (currentPlayer.position === gameState.currentTurn) return; // only the vetoer previews
    const sigs = (vetoSelection || []).map(vetoSignatureClient).filter(Boolean);
    sendVetoPreview(parseInt(gameId), sigs);
  }, [vetoSelection, gameState?.currentTurn, gameState?.status, gameState?.gameType, currentPlayer, gameId, sendVetoPreview]);

  // Shared veto UI state (used by the panel and the persistent Actions buttons).
  const vetoUi = useMemo(() => {
    const gt = gameState?.gameType;
    const on = !!(gt?.veto_enabled && !gt?.simultaneous_turns && (gameState?.status === 'active' || gameState?.status === 'ready') && currentPlayer);
    if (!on) return { on: false, canSelect: false };
    const isVetoer = currentPlayer.position !== gameState.currentTurn;
    const style = gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
    const canSelect = isVetoer && !vetoDoneThisTurn && (style === 'preemptive' || !!vetoWindow);
    return { on: true, isVetoer, style, canSelect };
  }, [gameState?.gameType, gameState?.status, gameState?.currentTurn, currentPlayer, vetoDoneThisTurn, vetoWindow]);

  // Add a veto descriptor to the current selection (respects budget + dedupe).
  const addVetoDescriptor = useCallback((desc) => {
    if (!desc) return;
    const cap = vetoMyBudget?.perGameRemaining == null
      ? (vetoMyBudget?.perTurnRemaining ?? 5)
      : Math.min(vetoMyBudget?.perTurnRemaining ?? 5, vetoMyBudget.perGameRemaining);
    setVetoError(null);
    setVetoSelection(prev => {
      const sig = vetoSignatureClient(desc);
      if (prev.some(d => vetoSignatureClient(d) === sig)) return prev;
      if (prev.length >= cap) return prev;
      return [...prev, desc];
    });
  }, [vetoMyBudget]);

  // Submit / skip / clear the current veto selection.
  // Persist the submission (keyed by the action being vetoed) so an instant
  // refresh re-sends it on reconnect instead of losing it and re-charging the
  // vetoer's clock.
  const persistPendingVeto = useCallback((vetoes) => {
    try {
      const actionKey = gameState?.vetoState?.lastActionKey ?? gameState?.moveHistory?.length ?? 0;
      sessionStorage.setItem(`vetoPending_${gameId}`, JSON.stringify({ actionKey, vetoes }));
    } catch (_) { /* ignore */ }
  }, [gameId, gameState?.vetoState?.lastActionKey, gameState?.moveHistory?.length]);
  const submitVetoSelection = useCallback(() => {
    if (!vetoUi.canSelect) return;
    persistPendingVeto(vetoSelection);
    submitVetoes(parseInt(gameId), vetoSelection);
  }, [vetoUi.canSelect, submitVetoes, gameId, vetoSelection, persistPendingVeto]);
  const skipVetoSelection = useCallback(() => {
    if (!vetoUi.canSelect) return;
    persistPendingVeto([]);
    submitVetoes(parseInt(gameId), []);
  }, [vetoUi.canSelect, submitVetoes, gameId, persistPendingVeto]);
  const clearVetoSelection = useCallback(() => {
    setVetoSelection([]);
    setVetoSelectedPiece(null);
    setVetoPieceMoves([]);
  }, []);
  // Reactive games that allow a single veto per turn collapse "veto this move"
  // and "submit" into one button: with one veto to spend there is never a reason
  // to ban a move the opponent did not just play - skipping is strictly better -
  // so selecting the revealed move and submitting it are the same action.
  // Falls back to whatever is selected if the player picked moves off the board.
  const submitSingleVeto = useCallback((revealDesc) => {
    if (!vetoUi.canSelect) return;
    const picks = vetoSelection.length > 0 ? vetoSelection : (revealDesc ? [revealDesc] : []);
    if (!picks.length) return;
    persistPendingVeto(picks);
    submitVetoes(parseInt(gameId), picks);
  }, [vetoUi.canSelect, vetoSelection, persistPendingVeto, submitVetoes, gameId]);

  // Enter submits the current veto selection during a veto phase.
  useEffect(() => {
    if (!vetoUi.canSelect) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault();
        submitVetoSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [vetoUi.canSelect, submitVetoSelection]);

  // Persistent veto action buttons (Submit / Skip / Clear) for the Actions panel,
  // always visible in veto games and greyed out when not applicable.
  // One condensed clock line, rendered above and below the board.
  //
  // Replaces four near-identical copies - a mobile top row, a mobile bottom row
  // and two in the desktop clocks column - that all drew the same thing at
  // different breakpoints. The player's side is now a small piece glyph beside
  // the name instead of a whole tinted panel, so each clock is a single line and
  // the board can sit closer to everything around it.
  const renderPlayerClock = (player, { isTop }) => {
    if (!player && !(isTop && gameState?.status === 'waiting')) return null;
    const isTheirTurn = !!player && gameState.currentTurn === player.position
      && gameState.status === 'active';
    const time = getDisplayTime(player?.id);
    const low = !!gameState.timeControl && (time ?? 999) < 60;
    const multiplier = gameState.clockMultipliers?.[player?.id];
    const showMultiplier = multiplier && Math.abs(multiplier - 1) >= 0.1;
    return (
      <div className={[
        styles["board-clock"],
        isTheirTurn ? styles["current-turn"] : '',
        gameState.winner === player?.id ? styles.winner : '',
      ].filter(Boolean).join(' ')}>
        <span
          className={`${styles["board-clock-side"]} ${player?.position === 1 ? styles["side-p1"] : styles["side-p2"]}`}
          title={player?.position === 1 ? 'Player 1' : 'Player 2'}
        >
          {player?.position === 1 ? '♔' : '♚'}
        </span>
        <span className={styles["board-clock-name"]}>
          {!player && gameState.status === 'waiting' ? (
            <span className={styles["waiting-for-opponent"]}>Waiting for opponent…</span>
          ) : player?.id === 'bot' ? (
            <>
              {player?.username}
              {gameState.botPlayer?.difficulty === 'stockfish' && gameState.botPlayer?.stockfishLevel != null && (
                <span className={styles["board-clock-sub"]}>
                  {({ 1: 'Beginner', 2: 'Casual', 3: 'Skilled', 4: 'Expert', 5: 'Maximum' })[gameState.botPlayer.stockfishLevel] || `Level ${gameState.botPlayer.stockfishLevel}`}
                </span>
              )}
            </>
          ) : (
            <Link to={`/profile/${player?.username}`} className={styles["player-name-link"]} onClick={(e) => e.stopPropagation()}>
              {player?.username}
            </Link>
          )}
          {player && player.id === currentPlayer?.id && (
            <span className={styles["board-clock-you"]}> (You)</span>
          )}
        </span>
        <span className={`${styles["player-indicator"]} ${isTheirTurn ? styles.active : ''}`} />
        {gameState.timeControl && (
          <span className={`${styles["board-clock-time"]} ${low ? styles["low-time"] : ''}`}>
            {formatTime(time)}
            {showMultiplier && (
              <span className={styles["clock-multiplier"]}>
                {' '}{multiplier > 1 ? multiplier.toFixed(1) + '×' : (1 / multiplier).toFixed(1) + '× slower'}
              </span>
            )}
          </span>
        )}
        {!gameState.timeControl && gameState.isCorrespondence && (
          <span className={styles["board-clock-time"]}>
            {formatCorrespondenceTime(isTheirTurn)}
          </span>
        )}
      </div>
    );
  };

  // Actions (Offer Draw / Resign / Pass / veto buttons). Rendered once, directly
  // under the board inside game-board-wrapper, so it sits beside the zoom widget
  // rather than at the bottom of the move-history column - on mobile that column
  // stacks below the board and the buttons ended up off-screen.
  //
  // Previously this JSX existed twice, once in the desktop sidebar and once in
  // the medium-screen bottom row, and the two had drifted: the bottom-row copy
  // was missing the Pass button entirely, so on a narrow screen you could not
  // pass in a game that allows passing.
  const renderActionsPanel = () => {
    if (!currentPlayer) return null;
    if (!(gameState?.status === 'active' || gameState?.status === 'ready')) return null;
    return (
      <div className={styles["game-controls-inline"]}>
        <div className={styles["control-buttons"]}>
          {drawOfferSent ? (
            <button
              className={`${styles.btn} ${styles["btn-warning"]}`}
              onClick={handleCancelDraw}
              title="Cancel your draw offer"
            >
              Cancel Draw
            </button>
          ) : (
            <button
              className={`${styles.btn} ${styles["btn-secondary"]}`}
              onClick={handleOfferDraw}
              disabled={!!pendingDrawOffer}
              title="Offer a draw to your opponent"
            >
              Offer Draw
            </button>
          )}
          <button
            className={`${styles.btn} ${styles["btn-danger"]}`}
            onClick={handleResign}
          >
            Resign
          </button>
        </div>
        {gameState?.otherGameData?.allow_pass && (
          <div className={styles["control-buttons-pass"]}>
            <button
              className={`${styles.btn} ${styles["btn-secondary"]}`}
              onClick={handlePass}
              disabled={!isMyTurn}
              title="Pass your turn"
            >
              Pass
            </button>
          </div>
        )}
        {renderVetoActionButtons()}
        <div className={styles["actions-zoom"]}>
          {/* Always horizontal. The hook stacks the widget vertically for tall
              boards, which suited it floating beside the board; in the actions
              row it should match the buttons it sits with. */}
          <BoardZoomControls {...boardVpHook.controlProps} placement="below" />
        </div>
      </div>
    );
  };
  const renderVetoActionButtons = useCallback(() => {
    if (!vetoUi.on) return null;
    const canAct = vetoUi.canSelect;
    const isReactive = gameState?.gameType?.veto_style === 'reactive';
    const revealDesc = vetoRevealMove ? {
      pieceId: vetoRevealMove.pieceId,
      from: vetoRevealMove.from,
      to: vetoRevealMove.to,
      isRangedAttack: !!vetoRevealMove.isRangedAttack,
      isCastling: !!vetoRevealMove.isCastling,
      castlingWith: vetoRevealMove.castlingWith,
      via: vetoRevealMove.via,
    } : null;
    const revealSelected = !!revealDesc && vetoSelection.some(d => vetoSignatureClient(d) === vetoSignatureClient(revealDesc));
    const canVetoMove = canAct && isReactive && !!revealDesc && !revealSelected;
    // One veto per turn in a reactive game means the revealed move is the only
    // thing worth banning, so Veto and Submit become a single button.
    const perTurnLimit = Math.max(1, Math.min(5, Number(gameState?.gameType?.veto_per_turn_limit) || 1));
    const singleShot = isReactive && perTurnLimit === 1;
    if (singleShot) {
      return (
        <div className={styles["control-buttons-pass"]}>
          <button
            className={`${styles.btn} ${styles["btn-danger"]}`}
            disabled={!canAct || (!revealDesc && vetoSelection.length === 0)}
            onClick={() => submitSingleVeto(revealDesc)}
            title="Veto the opponent's revealed move - they must play something else"
          >
            Veto Move
          </button>
          <button className={`${styles.btn} ${styles["btn-secondary"]}`} disabled={!canAct} onClick={skipVetoSelection} title="Decline to veto this turn">Skip Veto</button>
        </div>
      );
    }
    return (
      <>
        {isReactive && (
          <div className={styles["control-buttons-pass"]}>
            <button
              className={`${styles.btn} ${styles["btn-danger"]}`}
              disabled={!canVetoMove}
              onClick={() => revealDesc && addVetoDescriptor(revealDesc)}
              title="Veto the opponent's revealed move to force them to pick another"
            >
              {revealSelected ? 'Move vetoed ✓' : 'Veto this move'}
            </button>
          </div>
        )}
        <div className={styles["control-buttons-pass"]}>
          <button className={`${styles.btn} ${styles["btn-success"]}`} disabled={!canAct} onClick={submitVetoSelection} title="Submit your vetoes">
            Submit Veto{vetoSelection.length > 0 ? ` (${vetoSelection.length})` : ''}
          </button>
          <button className={`${styles.btn} ${styles["btn-secondary"]}`} disabled={!canAct} onClick={skipVetoSelection} title="Decline to veto this turn">Skip Veto</button>
          <button className={`${styles.btn} ${styles["btn-secondary"]}`} disabled={!canAct || vetoSelection.length === 0} onClick={clearVetoSelection} title="Clear your selected vetoes">Clear Veto</button>
        </div>
      </>
    );
  }, [vetoUi.on, vetoUi.canSelect, gameState?.gameType?.veto_style, gameState?.gameType?.veto_per_turn_limit, vetoRevealMove, vetoSelection, addVetoDescriptor, submitVetoSelection, submitSingleVeto, skipVetoSelection, clearVetoSelection]);

  // Board-overlay square counts for veto: candidate targets (vetoer), selected
  // bans (vetoer), and server-confirmed bans (mover). Multiple vetoes can stack
  // on one square (e.g. two pieces moving there, or a move + a ranged attack).
  const vetoBannedCounts = useMemo(() => {
    const m = new Map();
    // Only the mover (the player whose moves were banned) sees the X-marks.
    if (vetoBannedMover != null && (currentPlayer?.position ?? null) !== vetoBannedMover) return m;
    for (const sig of vetoBanned || []) {
      if (typeof sig !== 'string') continue;
      let key;
      if (sig.startsWith('place:')) key = sig.slice(6);
      else { const parts = sig.split('|'); key = parts[2]; }
      if (key) m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [vetoBanned, vetoBannedMover, currentPlayer?.position]);
  // Per-square list of vetoed-move labels (newest first) for hover tooltips.
  const vetoBannedMoves = useMemo(() => {
    const bh = gameState?.gameType?.board_height || 8;
    const m = new Map();
    if (vetoBannedMover != null && (currentPlayer?.position ?? null) !== vetoBannedMover) return m;
    const all = vetoBanned || [];
    for (let i = all.length - 1; i >= 0; i--) {
      const d = parseVetoSig(all[i]);
      if (!d) continue;
      const key = `${d.to.x},${d.to.y}`;
      const label = d.isPlace
        ? `place ${vetoSquareLabel(d.to, bh)}`
        : `${vetoSquareLabel(d.from, bh)}-${vetoSquareLabel(d.to, bh)}${d.ranged ? ' (ranged)' : ''}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(label);
    }
    return m;
  }, [vetoBanned, vetoBannedMover, gameState?.gameType?.board_height, currentPlayer?.position]);
  const vetoSelectedCounts = useMemo(() => {
    const m = new Map();
    for (const d of vetoSelection || []) {
      if (!d || !d.to) continue;
      const key = `${d.to.x},${d.to.y}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [vetoSelection]);
  // Per-square move labels (newest first) for the vetoer's own selection tooltips.
  const vetoSelectedMoves = useMemo(() => {
    const bh = gameState?.gameType?.board_height || 8;
    const m = new Map();
    const arr = vetoSelection || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const d = arr[i];
      if (!d || !d.to) continue;
      const key = `${d.to.x},${d.to.y}`;
      const label = (d.type === 'place' || d.isPlacement)
        ? `place ${vetoSquareLabel(d.to, bh)}`
        : `${vetoSquareLabel(d.from, bh)}-${vetoSquareLabel(d.to, bh)}${d.isRangedAttack ? ' (ranged)' : ''}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(label);
    }
    return m;
  }, [vetoSelection, gameState?.gameType?.board_height]);
  const vetoCandidateSquares = useMemo(
    () => new Set((vetoPieceMoves || []).map(m => `${m.x},${m.y}`)),
    [vetoPieceMoves]
  );

  // Fog permanent reveal: initialize accumulated set from localStorage when game+player is known
  useEffect(() => {
    const permanentFogReveal = gameState?.gameType?.permanent_fog_reveal;
    const playerPos = currentPlayer?.position;
    if (!permanentFogReveal || !gameId || playerPos == null) {
      fogRevealedRef.current = new Set();
      fogRevealedStorageKeyRef.current = null;
      return;
    }
    const key = `fog-revealed-${gameId}-p${playerPos}`;
    fogRevealedStorageKeyRef.current = key;
    try {
      const stored = localStorage.getItem(key);
      fogRevealedRef.current = stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      fogRevealedRef.current = new Set();
    }
  }, [gameId, currentPlayer?.position, gameState?.gameType?.permanent_fog_reveal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if it's the current user's turn
  const isMyTurn = useMemo(() => {
    if (!currentPlayer || !gameState) return false;
    // During reposition phase, isMyTurn is false so normal moves are blocked
    if (gameState.repositionPhase?.active) return false;
    // Simultaneous turns: a player is "on turn" any time they haven't yet
    // submitted their move for the current round. The board locks once
    // simulSubmittedThisRound is set, regardless of currentTurn.
    if (gameState.gameType?.simultaneous_turns) {
      return !simulSubmittedThisRound && (gameState.status === 'active' || gameState.status === 'ready');
    }
    return currentPlayer.position === gameState.currentTurn;
  }, [currentPlayer, gameState, simulSubmittedThisRound]);

  const isMyRepositionTurn = useMemo(() => {
    if (!currentPlayer || !gameState) return false;
    const rp = gameState.repositionPhase;
    return !!(rp?.active && rp.currentTurn === currentPlayer.position);
  }, [currentPlayer, gameState]);

  // Reactive veto: once I (the mover) submit a move, it's revealed to my opponent
  // and under review — I must not be able to submit or change another move until
  // they respond (veto → I re-pick; clear → it executes). Pre-emptive is exempt:
  // the vetoer bans blind, so the mover may freely change their premove.
  const reactiveMoveLocked = useMemo(() => {
    const gt = gameState?.gameType;
    if (!gt?.veto_enabled || gt?.simultaneous_turns) return false;
    const style = gt.veto_style === 'reactive' ? 'reactive' : 'preemptive';
    return style === 'reactive' && vetoMoveUnderReview;
  }, [gameState?.gameType, vetoMoveUnderReview]);

  // Phase-aware status line for veto games (replaces the plain "Your turn!").
  const vetoPhaseMessage = useMemo(() => {
    const gt = gameState?.gameType;
    if (!gt?.veto_enabled || gt?.simultaneous_turns) return null;
    // Allow 'ready' too so a fresh veto game never flashes the green "Your turn!".
    if ((gameState?.status !== 'active' && gameState?.status !== 'ready') || !currentPlayer) return null;
    if (gameState?.currentTurn == null) return null;
    const style = gt.veto_style === 'reactive' ? 'reactive' : 'preemptive';
    const iAmMover = currentPlayer.position === gameState.currentTurn;
    if (iAmMover) {
      if (style === 'reactive') {
        if (vetoMoveUnderReview) return "Opponent is deciding whether to veto your move…";
        return "It's your move — your opponent may veto it.";
      }
      // Pre-emptive: the opponent vetoes first; a premove doesn't change that.
      return vetoOpponentSubmitted ? "It's your move." : "Opponent is choosing vetoes…";
    }
    // I'm the vetoer
    if (vetoDoneThisTurn) return "Waiting for your opponent to move…";
    if (style === 'reactive') {
      return vetoWindow ? "Veto your opponent's move, or skip." : "Waiting for your opponent's move…";
    }
    return "Your veto phase — ban your opponent's moves, then submit.";
  }, [gameState?.gameType, gameState?.status, gameState?.currentTurn, currentPlayer, vetoMoveUnderReview, vetoOpponentSubmitted, vetoDoneThisTurn, vetoWindow]);

  // True when the current player has no remaining repositions (or is not in reposition phase).
  // Premoves are only allowed once this player's own repositions are done.
  const myRepositionsDone = useMemo(() => {
    if (!gameState?.repositionPhase?.active) return true;
    if (!currentPlayer) return true;
    const rp = gameState.repositionPhase;
    const remaining = currentPlayer.position === 1 ? rp.p1Remaining : rp.p2Remaining;
    return remaining === 0;
  }, [currentPlayer, gameState]);

  // Clear premove when it becomes your turn (premove didn't execute or was cancelled)
  // In bot games, don't clear — premove persists until bot moves and server executes it
  useEffect(() => {
    if (isMyTurn && premove && !gameState?.botPlayer) {
      console.log('Clearing premove because it\'s now your turn');
      setPremove(null);
    }
  }, [isMyTurn, premove, gameState?.botPlayer]);

  // Replay any sound missed while the browser tab was hidden
  const prevIsMyTurnRef = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current && soundEnabledRef.current) {
      soundManager.onTurnStart();
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  // Format time display (supports fractional seconds)
  const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return "∞";
    if (seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    if (seconds < 10) {
      // Under 10s: show tenths (e.g. "0:05.2")
      const wholeSecs = Math.floor(seconds % 60);
      const tenths = Math.floor((seconds % 1) * 10);
      return `${mins}:${wholeSecs.toString().padStart(2, '0')}.${tenths}`;
    }
    if (seconds < 60) {
      // Under 1 min: show tenths (e.g. "0:34.5")
      const wholeSecs = Math.floor(seconds % 60);
      const tenths = Math.floor((seconds % 1) * 10);
      return `${mins}:${wholeSecs.toString().padStart(2, '0')}.${tenths}`;
    }
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Local clock interpolation: smoothly count down between server ticks
  // Applies clock multiplier so the visual tick rate matches the real server drain rate
  useEffect(() => {
    if (!gameState?.timeControl || gameState?.status !== 'active') return;
    // Freeze the clock in a veto game until the first action starts it (mirrors
    // the server so no time is drained during the opening veto/premove phase).
    const isVetoGame = !!(gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns);
    const clockFrozen = isVetoGame && !vetoClockStarted;
    const interval = setInterval(() => {
      if (!lastServerTickRef.current || !serverTimesRef.current) return;
      if (clockFrozen) {
        // Keep the anchor fresh so unfreezing doesn't drain a backlog of time.
        lastServerTickRef.current = Date.now();
        displayTimesRef.current = { ...serverTimesRef.current };
        setDisplayTimes({ ...serverTimesRef.current });
        return;
      }
      const elapsed = (Date.now() - lastServerTickRef.current) / 1000;
      const newTimes = {};
      for (const [pid, srvTime] of Object.entries(serverTimesRef.current)) {
        if (!clockFrozen && pid === String(activeClockPlayerRef.current)) {
          const multiplier = gameState?.clockMultipliers?.[pid] || 1;
          newTimes[pid] = Math.max(0, srvTime - elapsed * multiplier);
        } else {
          newTimes[pid] = srvTime;
        }
      }
      displayTimesRef.current = newTimes;
      setDisplayTimes(newTimes);
    }, 100);
    return () => clearInterval(interval);
  }, [gameState?.timeControl, gameState?.status, gameState?.clockMultipliers, gameState?.gameType?.veto_enabled, gameState?.gameType?.simultaneous_turns, vetoClockStarted]);

  // Get display time for a player (interpolated if available, else server time)
  const getDisplayTime = useCallback((playerId) => {
    if (displayTimes[playerId] !== undefined) return displayTimes[playerId];
    return gameState?.playerTimes?.[playerId];
  }, [displayTimes, gameState?.playerTimes]);

  // Disconnect-forfeit live countdown tick (only when banner visible and not paused)
  useEffect(() => {
    if (!disconnectInfo || disconnectInfo.paused) return;
    setDisconnectNow(Date.now());
    const id = setInterval(() => setDisconnectNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [disconnectInfo]);

  // Format correspondence days remaining
  const formatCorrespondenceTime = (isCurrentTurnPlayer) => {
    if (!gameState?.isCorrespondence || !gameState?.correspondenceDays) return null;
    if (!isCurrentTurnPlayer) return `${gameState.correspondenceDays}d`;
    // Prefer absolute moveDeadline; fall back to lastMoveTime + correspondenceDays arithmetic
    let remainingMs;
    if (gameState.moveDeadline) {
      remainingMs = Math.max(0, gameState.moveDeadline - Date.now());
    } else if (gameState.lastMoveTime) {
      const allowedMs = gameState.correspondenceDays * 24 * 60 * 60 * 1000;
      remainingMs = Math.max(0, allowedMs - (Date.now() - gameState.lastMoveTime));
    } else {
      return `${gameState.correspondenceDays}d`;
    }
    const totalHours = remainingMs / (60 * 60 * 1000);
    const days = Math.floor(totalHours / 24);
    const hours = Math.floor(totalHours % 24);
    if (days >= 1) {
      return `${days}d ${hours}h`;
    }
    if (hours >= 1) {
      const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      return `${hours}h ${mins}m`;
    }
    const remainingMins = Math.ceil(remainingMs / (60 * 1000));
    return remainingMins > 0 ? `${remainingMins}m` : '0m';
  };

  // Piece movement rules live in helpers/moveEngine.js so the match-replay board
  // can highlight moves and attacks with the exact same logic the live board uses.
  // The thin wrappers below keep every existing call site in this file unchanged.
  const moveEngine = useMemo(() => createMoveEngine({
    specialSquares,
    gameType: gameState?.gameType,
    enPassantTarget: gameState?.enPassantTarget,
    currentPlayerPosition: currentPlayer?.position ?? null,
  }), [specialSquares, gameState?.gameType, gameState?.enPassantTarget, currentPlayer?.position]);

  const calculateValidMoves = useCallback(
    (...args) => moveEngine.calculateValidMoves(...args), [moveEngine]);
  const canReachStepByStepRanged = useCallback(
    (...args) => moveEngine.canReachStepByStepRanged(...args), [moveEngine]);
  const wouldMoveResolveCheck = useCallback(
    (...args) => moveEngine.wouldMoveResolveCheck(...args), [moveEngine]);

  // Handle square click
  /* eslint-disable react-hooks/exhaustive-deps */
  const handleSquareClick = useCallback((x, y) => {
    // Block interactions while a move is pending confirmation
    if (pendingMove) return;
    // Reactive veto: clicking my under-review held move's from/to square retracts
    // it (allowed before the opponent responds — runs BEFORE the review lock).
    if (reactiveMoveLocked && heldMoveHighlight) {
      const h = heldMoveHighlight;
      if ((h.from && h.from.x === x && h.from.y === y) || (h.to && h.to.x === x && h.to.y === y)) {
        cancelReactiveHeldMove();
        return;
      }
    }
    // Block interactions while my reactive move is awaiting the opponent's veto.
    if (reactiveMoveLocked) return;

    // Block interactions while a promotion choice is pending
    if (showPromotionModal) return;

    // Block all interactions for spectators
    if (!currentPlayer) return;

    // Clicking the staged pre-emptive pre-move's from/to square cancels it.
    if (vetoStagedMoveRef.current && heldMoveHighlight) {
      const h = heldMoveHighlight;
      if ((h.from && h.from.x === x && h.from.y === y) || (h.to && h.to.x === x && h.to.y === y)) {
        cancelVetoStagedMove();
        return;
      }
    }

    // ── Veto selection mode: the vetoer picks the opponent's moves to ban ──
    {
      const gt = gameState?.gameType;
      const vetoOn = gt?.veto_enabled && !gt?.simultaneous_turns;
      const iAmVetoer = vetoOn && (gameState?.status === 'active' || gameState?.status === 'ready') && currentPlayer.position !== gameState.currentTurn;
      const vStyle = gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
      const vetoSelectActive = iAmVetoer && !vetoDoneThisTurn && (vStyle === 'preemptive' || !!vetoWindow);
      if (vetoSelectActive) {
        const piecesV = parsePieces(gameState.pieces);
        const clicked = findPieceAtSquare(piecesV, x, y);
        const moverPos = gameState.currentTurn;
        const perTurnCap = vetoMyBudget?.perTurnRemaining ?? Math.max(1, Math.min(5, Number(gt.veto_per_turn_limit) || 1));
        const perGameCap = vetoMyBudget?.perGameRemaining;
        const cap = perGameCap == null ? perTurnCap : Math.min(perTurnCap, perGameCap);
        const addVeto = (desc) => {
          const sig = vetoSignatureClient(desc);
          setVetoError(null);
          setVetoSelection(prev => {
            if (prev.some(d => vetoSignatureClient(d) === sig)) return prev; // this exact veto already selected
            if (prev.length >= cap) return prev; // budget cap reached
            return [...prev, desc];
          });
        };
        // Clicking a candidate destination bans the next un-selected move-type to
        // that square (movement/capture first, then ranged) so a move and a ranged
        // attack to the same square can be vetoed separately, and vetoes stack.
        const targets = vetoSelectedPiece ? vetoPieceMoves.filter(m => m.x === x && m.y === y) : [];
        if (targets.length > 0) {
          const descs = targets.map(t => ({
            pieceId: vetoSelectedPiece.id,
            from: { x: vetoSelectedPiece.x, y: vetoSelectedPiece.y },
            to: { x, y },
            isRangedAttack: !!t.isRangedAttack,
            isCastling: !!t.isCastling,
            castlingWith: t.castlingWith,
            via: t.via,
          }));
          const notYet = descs.find(d => !vetoSelection.some(s => vetoSignatureClient(s) === vetoSignatureClient(d)));
          if (notYet) addVeto(notYet);
          return;
        }
        const isMoverPiece = clicked && (clicked.player_id === moverPos || clicked.team === moverPos || clicked.is_neutral);
        if (isMoverPiece) {
          setVetoSelectedPiece(clicked);
          setVetoPieceMoves(calculateValidMoves(
            clicked, piecesV, gt?.board_width || 8, gt?.board_height || 8, true, true, false, false
          ));
          return;
        }
        // Empty square + placement game + placement is vetoable → placement veto.
        if (!clicked && !gt.veto_disallow_placement && gameState?.otherGameData?.place_pieces_action) {
          addVeto({ type: 'place', to: { x, y } });
          return;
        }
        setVetoSelectedPiece(null);
        setVetoPieceMoves([]);
        return;
      }
    }

    // Clear ranged-twice selection on any left click
    if (rangedSelectedPiece) {
      setRangedSelectedPiece(null);
    }

    // Left-click on your premoved piece or the premove destination cancels the
    // premove. Runs only when NOT in a veto selection phase (that returns above),
    // so choosing a veto takes priority over cancelling the premove.
    if (premove) {
      const pmPw = premove.pieceWidth || 1;
      const pmPh = premove.pieceHeight || 1;
      const onFrom = premove.from && x >= premove.from.x && x < premove.from.x + pmPw && y >= premove.from.y && y < premove.from.y + pmPh;
      const onTo = premove.to && x >= premove.to.x && x < premove.to.x + pmPw && y >= premove.to.y && y < premove.to.y + pmPh;
      if (onFrom || onTo) {
        setPremove(null);
        sendClearPremove(parseInt(gameId));
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }
    }

    // Allow selecting pieces to preview moves when waiting or during gameplay
    const canInteract = gameState && gameState.status !== 'completed' && ghostMoveIndex === null;
    if (!canInteract) {
      return;
    }

    const pieces = parsePieces(gameState.pieces);
    const clickedPiece = findPieceAtSquare(pieces, x, y);

    // Check if clicking on own piece (or any piece when waiting/previewing)
    const isPreviewMode = gameState.status === 'waiting' || gameState.status === 'ready';
    const isOwnPiece = clickedPiece && (
      clickedPiece.player_id === currentPlayer?.position ||
      clickedPiece.team === currentPlayer?.position ||
      clickedPiece.is_neutral
    );
    
    // If clicking on opponent's piece, clear selection and return
    // Unless a valid capture move overlaps with this enemy piece's footprint.
    // Apply even in preview/ready mode when a piece is already selected — without
    // this, the first move of the game (which keeps status='ready' until the server
    // processes it) re-selects the enemy piece instead of executing a capture.
    // In preview mode with NO selected piece, we skip the guard so players can still
    // click enemy pieces to see their moves.
    if (clickedPiece && !isOwnPiece && (!isPreviewMode || selectedPiece)) {
      let hasCaptureForEnemy = false;
      if (selectedPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        hasCaptureForEnemy = validMoves.some(m => {
          if (!m.isCapture) return false;
          // Check if moving piece's footprint at destination overlaps clicked enemy
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              if (doesPieceOccupySquare(clickedPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
      if (!hasCaptureForEnemy) {
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }
    }

    // In preview mode, allow selecting any piece to see its moves
    // In game mode, only allow selecting own pieces when it's your turn
    // OR allow selecting own pieces when it's opponent's turn for premoves
    // In bot games, also allow premove selection on your own turn since the bot responds quickly
    const isBotGame = !!gameState.botPlayer;
    // Regular pre-moves are impossible in veto games — the mover instead makes a
    // client-staged "veto pre-move" (handled by canMakeMove). Only true regular
    // pre-moves (opponent's turn, no veto phase) go through this path.
    const vetoNoPremove = !!(gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns);
    const canSelectForPremove = ((!isMyTurn || isBotGame) && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false && isOwnPiece && myRepositionsDone && !vetoNoPremove);
    // If selected piece can capture allies and there's a valid capture move to this ally, skip re-selection
    const hasAllyCaptureMove = selectedPiece && isOwnPiece && clickedPiece && selectedPiece.can_capture_allies &&
      clickedPiece.id !== selectedPiece.id &&
      validMoves.some(m => m.isCapture && doesPieceOccupySquare(clickedPiece, m.x, m.y));
    // Close-range castling: the castling partner sits on the castle-destination square.
    // Clicking it must execute the castle, not re-select the partner.
    const hasCastlingMoveToPartner = !!(selectedPiece && isOwnPiece && clickedPiece &&
      clickedPiece.id !== selectedPiece.id &&
      validMoves.some(m => m.isCastling && m.castlingWith === clickedPiece.id));
    if (clickedPiece && !hasAllyCaptureMove && !hasCastlingMoveToPartner && (isPreviewMode || (isOwnPiece && isMyTurn) || canSelectForPremove)) {
      // If a capture action is pending, only allow selecting the designated piece
      if (captureActionPieceId != null && isMyTurn && clickedPiece.id !== captureActionPieceId) {
        showIllegalMoveWarning("You must use the highlighted piece for your capture action, or skip.", 2500);
        return;
      }
      setSelectedPiece(clickedPiece);
      const actuallyPremoving = canSelectForPremove && !isMyTurn;
      // In Hidden Enemy Pieces mode, the player must be able to probe with
      // attack-only moves (e.g. pawn diagonals into empty-looking squares).
      // forFog=true exposes those destinations as clickable; the server still
      // rejects them when truly empty and counts the attempt toward the
      // illegal-move limit.
      const fogProbe = !!(gameState?.hideEnemyPieces && isMyTurn && isOwnPiece);
      const moves = calculateValidMoves(
        clickedPiece, 
        pieces, 
        gameState.gameType?.board_width || 8, 
        gameState.gameType?.board_height || 8,
        actuallyPremoving, // skipCheckFilter - premoves skip check filter since board state will change
        actuallyPremoving, // forPremove - include potential capture squares
        false,             // forHoverDisplay
        fogProbe           // forFog - include attack-only-empty squares for hidden-piece probing
      );
      setValidMoves(moves);
      return;
    }

    // If piece is selected and clicking on valid move, make the move (during ready or active game)
    const canMakeMove = selectedPiece && isMyTurn && (gameState.status === 'active' || gameState.status === 'ready');
    const canPremove = selectedPiece && (!isMyTurn || isBotGame) && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false && myRepositionsDone && !vetoNoPremove;
    
    if (canMakeMove) {
      // Clean up any castle hold state.
      if (castleHoldTimerRef.current) { clearTimeout(castleHoldTimerRef.current); castleHoldTimerRef.current = null; }
      setCastleHoldSquare(null);
      // If the 1s-hold executed the castle via window.mouseup, skip (consumed).
      if (castleArmedRef.current === 'consumed') {
        castleArmedRef.current = null;
        setCastleArmedSquare(null);
        return;
      }
      castleArmedRef.current = null;
      setCastleArmedSquare(null);
      // On a normal (short) click always prefer the non-castling move so that
      // a dual-action square defaults to moving, not castling.
      // Exception: clicking directly on the castling partner always executes the castle
      // (close-range castling where the partner occupies the destination square).
      let move;
      if (hasCastlingMoveToPartner && clickedPiece) {
        move = validMoves.find(m => m.isCastling && m.castlingWith === clickedPiece.id);
      }
      if (!move) move = validMoves.find(m => m.x === x && m.y === y && !m.isCastling);
      if (!move) move = validMoves.find(m => m.x === x && m.y === y);
      if (!move && selectedPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        if (spw > 1 || sph > 1) {
          move = validMoves.find(m => !m.isRangedAttack &&
            x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph
          );
        }
      }
      // Multi-tile enemy fallback: clicking on a multi-tile enemy piece routes
      // to its anchor square due to DOM structure. Find any capture move whose
      // destination footprint overlaps the clicked enemy piece.
      if (!move && clickedPiece && !isOwnPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        move = validMoves.find(m => {
          if (!m.isCapture) return false;
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              if (doesPieceOccupySquare(clickedPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
      if (move) {
        // Ranged zone squares (no enemy piece) are display-only, not executable
        if (move.isRangedAttack && !move.isCapture) {
          setSelectedPiece(null);
          setValidMoves([]);
          return;
        }
        console.log('[MOVE ATTEMPT]', { 
          piece: selectedPiece.piece_name, 
          from: { x: selectedPiece.x, y: selectedPiece.y }, 
          to: { x: move.x, y: move.y },
          move 
        });
        const moveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x: move.x, y: move.y },
          pieceId: selectedPiece.id
        };
        // Include castling data if this is a castling move
        if (move.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = move.castlingWith;
          moveData.castlingDirection = move.castlingDirection;
        }
        // Include ranged attack flag
        if (move.isRangedAttack) {
          moveData.isRangedAttack = true;
        }
        // Include hop capture data (checkers-style capture)
        if (move.isHopCapture) {
          moveData.isHopCapture = true;
          moveData.hopCapturedPieceIds = move.hopCapturedPieceIds;
        }
        // Include direction-change via square
        if (move.via) {
          moveData.via = move.via;
        }
        submitMove(parseInt(gameId), moveData);
        setSelectedPiece(null);
        setValidMoves([]);
      } else {
        // Clicking elsewhere, deselect
        setSelectedPiece(null);
        setValidMoves([]);
      }
    } else if (canPremove) {
      let move = validMoves.find(m => m.x === x && m.y === y);
      if (!move && selectedPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        if (spw > 1 || sph > 1) {
          move = validMoves.find(m => !m.isRangedAttack &&
            x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph
          );
        }
      }
      // Multi-tile enemy fallback for premoves
      if (!move && clickedPiece && !isOwnPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        move = validMoves.find(m => {
          if (!m.isCapture) return false;
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              if (doesPieceOccupySquare(clickedPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
      if (move) {
        console.log('Setting premove!', { from: { x: selectedPiece.x, y: selectedPiece.y }, to: { x: move.x, y: move.y } });
        const premoveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x: move.x, y: move.y },
          pieceId: selectedPiece.id,
          pieceWidth: selectedPiece.piece_width || 1,
          pieceHeight: selectedPiece.piece_height || 1
        };
        if (move.isCastling) {
          premoveData.isCastling = true;
          premoveData.castlingWith = move.castlingWith;
          premoveData.castlingDirection = move.castlingDirection;
        }
        if (move.isHopCapture) {
          premoveData.isHopCapture = true;
          premoveData.hopCapturedPieceIds = move.hopCapturedPieceIds;
        }
        if (move.via) premoveData.via = move.via;
        setPremove(premoveData); // Set local state
        sendPremove(parseInt(gameId), premoveData); // Send to server
        setSelectedPiece(null);
        setValidMoves([]);
      } else {
        // Clicking elsewhere, deselect
        setSelectedPiece(null);
        setValidMoves([]);
      }
    } else {
      // Check for piece placement action (Othello-style) — only if left-click placement is enabled.
      // By default placement is triggered via right-click; this left-click path is an opt-in for mobile.
      const otherData = gameState.otherGameData || {};
      const canPlace = placementUseLeftClick && isMyTurn && otherData.place_pieces_action && !clickedPiece && 
        (gameState.status === 'active' || gameState.status === 'ready');
      if (canPlace) {
        // Check if the square is allowed for the current player (restriction + confinement)
        const isRestrictedToOther = !isDeployAllowed(specialSquares, currentPlayer?.position, x, y);
        if (isRestrictedToOther) {
          showIllegalMoveWarning("You cannot place a piece on this square");
          setSelectedPiece(null);
          setValidMoves([]);
          return;
        }
        const placeablePieces = getDeployablePieces(otherData, gameState.reserves, currentPlayer?.position);
        if (placeablePieces.length === 0) {
          showIllegalMoveWarning("You have no pieces left in your reserve");
        } else if (placeablePieces.length === 1) {
          // Single piece type — place directly without modal
          submitMove(parseInt(gameId), {
            type: 'place',
            to: { x, y },
            placePieceId: placeablePieces[0].piece_id
          });
        } else if (placeablePieces.length > 1) {
          // Multiple piece types — show placement modal
          setPlacementTarget({ x, y });
          setShowPlacementModal(true);
        } else {
          // No placeable pieces configured
          console.warn('Place pieces action enabled but no placeable pieces configured');
        }
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      console.log('Cannot make move:', { hasSelectedPiece: !!selectedPiece, isMyTurn, status: gameState?.status });
      // Clicking elsewhere, deselect
      setSelectedPiece(null);
      setValidMoves([]);
    }
  }, [isMyTurn, gameState, currentPlayer, selectedPiece, validMoves, calculateValidMoves, submitMove, sendPremove, setPremove, gameId, rangedSelectedPiece, setShowPlacementModal, setPlacementTarget, pendingMove, ghostMoveIndex, captureActionPieceId, showIllegalMoveWarning, placementUseLeftClick, specialSquares, showPromotionModal, vetoWindow, vetoSelectedPiece, vetoPieceMoves, vetoMyBudget, vetoDoneThisTurn, vetoSelection, premove, sendClearPremove, reactiveMoveLocked, heldMoveHighlight, cancelVetoStagedMove, cancelReactiveHeldMove]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Handle piece hover for movement helpers
  const handlePieceHover = useCallback((piece) => {
    if (!gameState?.showPieceHelpers) return;
    if (!piece) {
      setHoveredPiece(null);
      setHoveredMoves([]);
      return;
    }

    // During reposition phase, suppress movement arrows for pieces that cannot be repositioned.
    // Even for repositionable pieces, movement arrows are irrelevant — just don't show anything.
    if (gameState?.repositionPhase?.active) {
      setHoveredPiece(null);
      setHoveredMoves([]);
      return;
    }

    const pieces = parsePieces(gameState.pieces);
    const moves = calculateValidMoves(
      piece, 
      pieces, 
      gameState.gameType?.board_width || 8, 
      gameState.gameType?.board_height || 8,
      false, // skipCheckFilter
      false, // forPremove
      true   // forHoverDisplay — include all reachable ranged squares (empty + occupied)
    );
    setHoveredPiece(piece);
    setHoveredMoves(moves);
  }, [gameState, calculateValidMoves]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e, piece) => {
    // Block dragging while a move is pending confirmation
    if (pendingMove) {
      e.preventDefault();
      return;
    }
    // Block dragging while my reactive move is awaiting the opponent's veto.
    if (reactiveMoveLocked) {
      e.preventDefault();
      return;
    }

    // Block dragging while a promotion choice is pending
    if (showPromotionModal) {
      e.preventDefault();
      return;
    }

    const pieceTeam = piece.player_id || piece.team;
    const isOwnPiece = currentPlayer && (pieceTeam === currentPlayer.position || piece.is_neutral);

    // Reposition phase: allow dragging eligible pieces; skip normal move calculation
    if (gameState?.repositionPhase?.active) {
      const repoKeyOnly = !!gameState?.gameType?.reposition_key_pieces_only;
      const canReposition = isMyRepositionTurn && isOwnPiece &&
        (!repoKeyOnly || piece.ends_game_on_capture || piece.ends_game_on_checkmate);
      if (!canReposition) {
        e.preventDefault();
        return;
      }
      setDraggedPiece(piece);
      setDragValidMoves([]);
      setValidMoves([]);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(piece.id));
      const pieceEl = e.currentTarget;
      const rect = pieceEl.getBoundingClientRect();
      e.dataTransfer.setDragImage(pieceEl, rect.width / 2, rect.height / 2);
      e.currentTarget.style.opacity = '0.5';
      return;
    }

    // Allow dragging own pieces during your turn OR for premoves during opponent's turn
    const canDragForMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && isOwnPiece;
    const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece && !(gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns);

    // Veto phase: allow dragging the mover's (opponent's) piece to a square to
    // declare a veto of that move. Uses the same candidate-move set as clicking.
    {
      const gt = gameState?.gameType;
      const vetoOn = gt?.veto_enabled && !gt?.simultaneous_turns;
      const iAmVetoer = vetoOn && (gameState?.status === 'active' || gameState?.status === 'ready') && currentPlayer && currentPlayer.position !== gameState.currentTurn;
      const vStyle = gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
      const vetoSelectActive = iAmVetoer && !vetoDoneThisTurn && (vStyle === 'preemptive' || !!vetoWindow);
      const moverPos = gameState?.currentTurn;
      const isMoverPiece = !isOwnPiece && (pieceTeam === moverPos || piece.is_neutral);
      if (vetoSelectActive && isMoverPiece) {
        const pieces = parsePieces(gameState.pieces);
        const moves = calculateValidMoves(piece, pieces, gt?.board_width || 8, gt?.board_height || 8, true, true, false, false);
        setDraggedPiece(piece);
        setVetoSelectedPiece(piece);
        setVetoPieceMoves(moves);
        setDragValidMoves(moves);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(piece.id));
        const pieceEl = e.currentTarget;
        const rect = pieceEl.getBoundingClientRect();
        e.dataTransfer.setDragImage(pieceEl, rect.width / 2, rect.height / 2);
        e.currentTarget.style.opacity = '0.5';
        return;
      }
    }

    if (!canDragForMove && !canDragForPremove) {
      e.preventDefault();
      return;
    }

    setDraggedPiece(piece);
    setSelectedPiece(piece);
    
    // Calculate grab offset within the piece footprint for multi-tile pieces
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    if (pw > 1 || ph > 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const cellWidth = rect.width / pw;
      const cellHeight = rect.height / ph;
      dragGrabOffsetRef.current = {
        x: Math.floor(relX / cellWidth),
        y: Math.floor(relY / cellHeight)
      };
    } else {
      dragGrabOffsetRef.current = { x: 0, y: 0 };
    }
    
    // Calculate valid moves for the dragged piece
    const pieces = parsePieces(gameState.pieces);
    // Hidden Enemy Pieces: allow probing attack-only-empty squares (see click handler).
    const fogProbe = !!(gameState?.hideEnemyPieces && canDragForMove);
    const moves = calculateValidMoves(
      piece,
      pieces,
      gameState.gameType?.board_width || 8,
      gameState.gameType?.board_height || 8,
      canDragForPremove, // skipCheckFilter - premoves skip check filter since board state will change
      canDragForPremove, // forPremove - include potential capture squares for premoves
      false,             // forHoverDisplay
      fogProbe           // forFog - include attack-only-empty squares for hidden-piece probing
    );
    setDragValidMoves(moves);
    setValidMoves(moves);
    
    e.dataTransfer.effectAllowed = 'move';
    // Set drag data to make it work properly
    e.dataTransfer.setData('text/plain', piece.id);
    
    // Set drag image to just the piece element (prevents browser from ghosting nearby pieces)
    const pieceEl = e.currentTarget;
    const rect = pieceEl.getBoundingClientRect();
    e.dataTransfer.setDragImage(pieceEl, rect.width / 2, rect.height / 2);
    
    e.currentTarget.style.opacity = '0.5';
  }, [isMyTurn, gameState, currentPlayer, calculateValidMoves, pendingMove, showPromotionModal, vetoDoneThisTurn, vetoWindow, reactiveMoveLocked]);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedPiece(null);
    setDragValidMoves([]);
    setSelectedPiece(null);
    setValidMoves([]);
    dragOverSquareRef.current = null;
    setDragOverSquare(null);
    // Clear any in-progress castle-hold arming from the drag.
    if (castleHoldTimerRef.current) { clearTimeout(castleHoldTimerRef.current); castleHoldTimerRef.current = null; }
    dragCastleHoverRef.current = null;
    setCastleHoldSquare(null);
    setCastleArmedSquare(null);
  }, []);

  const handleDragOver = useCallback((e, x, y) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    // Hover feedback: track the square under the cursor (update only on change).
    if (x != null && y != null && (dragOverSquareRef.current?.x !== x || dragOverSquareRef.current?.y !== y)) {
      dragOverSquareRef.current = { x, y };
      setDragOverSquare({ x, y });
    }

    // Castle hold while dragging: if cursor hovers for 1 s over a square that
    // has BOTH a regular move and a castling move available, arm castle so
    // the drop submits the castle variant. Releasing earlier (or moving to a
    // different square) cancels and the regular move fires on drop.
    if (!draggedPiece || !dragValidMoves || dragValidMoves.length === 0 || x == null || y == null) return;
    const hasRegular = dragValidMoves.some(m => m.x === x && m.y === y && !m.isCastling && !m.isRangedAttack);
    const castleMove = dragValidMoves.find(m => m.x === x && m.y === y && m.isCastling);
    const dual = hasRegular && !!castleMove;
    const hovered = dragCastleHoverRef.current;

    if (!dual) {
      // Not on a dual-action square: clear any in-progress arming.
      if (hovered) {
        if (castleHoldTimerRef.current) { clearTimeout(castleHoldTimerRef.current); castleHoldTimerRef.current = null; }
        dragCastleHoverRef.current = null;
        setCastleHoldSquare(null);
        setCastleArmedSquare(null);
      }
      return;
    }
    // Same square we're already arming/armed on: no-op.
    if (hovered && hovered.x === x && hovered.y === y) return;
    // New dual-action square: reset and start a fresh 1 s timer.
    if (castleHoldTimerRef.current) { clearTimeout(castleHoldTimerRef.current); castleHoldTimerRef.current = null; }
    dragCastleHoverRef.current = { x, y };
    setCastleArmedSquare(null);
    setCastleHoldSquare({ x, y });
    castleHoldTimerRef.current = setTimeout(() => {
      castleHoldTimerRef.current = null;
      setCastleHoldSquare(null);
      setCastleArmedSquare({ x, y });
    }, 1000);
  }, [draggedPiece, dragValidMoves]);

  const handleDrop = useCallback((e, targetX, targetY) => {
    e.preventDefault();
    e.stopPropagation();
    dragOverSquareRef.current = null;
    setDragOverSquare(null);
    
    if (!draggedPiece) {
      return;
    }

    // Block drop while a correspondence move is awaiting confirmation
    if (pendingMove) {
      setDraggedPiece(null);
      setDragValidMoves([]);
      return;
    }

    // Block drop while my reactive move is awaiting the opponent's veto.
    if (reactiveMoveLocked) {
      setDraggedPiece(null);
      setDragValidMoves([]);
      return;
    }

    // Block drop while a promotion choice is pending
    if (showPromotionModal) {
      setDraggedPiece(null);
      setDragValidMoves([]);
      return;
    }

    // Veto phase: dropping the mover's piece on a valid square declares a veto.
    {
      const gt = gameState?.gameType;
      const vetoOn = gt?.veto_enabled && !gt?.simultaneous_turns;
      const iAmVetoer = vetoOn && (gameState?.status === 'active' || gameState?.status === 'ready') && currentPlayer && currentPlayer.position !== gameState.currentTurn;
      const vStyle = gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
      const vetoSelectActive = iAmVetoer && !vetoDoneThisTurn && (vStyle === 'preemptive' || !!vetoWindow);
      const moverPos = gameState?.currentTurn;
      const dpTeam = draggedPiece.player_id || draggedPiece.team;
      const isMoverPiece = (dpTeam === moverPos || draggedPiece.is_neutral) && !(currentPlayer && dpTeam === currentPlayer.position);
      if (vetoSelectActive && isMoverPiece) {
        const targets = (dragValidMoves || []).filter(m => m.x === targetX && m.y === targetY);
        if (targets.length > 0) {
          const perTurnCap = vetoMyBudget?.perTurnRemaining ?? Math.max(1, Math.min(5, Number(gt.veto_per_turn_limit) || 1));
          const perGameCap = vetoMyBudget?.perGameRemaining;
          const cap = perGameCap == null ? perTurnCap : Math.min(perTurnCap, perGameCap);
          const descs = targets.map(t => ({
            pieceId: draggedPiece.id,
            from: { x: draggedPiece.x, y: draggedPiece.y },
            to: { x: targetX, y: targetY },
            isRangedAttack: !!t.isRangedAttack,
            isCastling: !!t.isCastling,
            castlingWith: t.castlingWith,
            via: t.via,
          }));
          setVetoError(null);
          setVetoSelection(prev => {
            const notYet = descs.find(d => !prev.some(s => vetoSignatureClient(s) === vetoSignatureClient(d)));
            if (!notYet) return prev;
            if (prev.length >= cap) return prev;
            return [...prev, notYet];
          });
        }
        setDraggedPiece(null);
        setDragValidMoves([]);
        return;
      }
    }

    // Reposition phase: intercept drops to move own pieces to empty squares
    if (gameState?.repositionPhase?.active && isMyRepositionTurn) {
      const from = { x: draggedPiece.x, y: draggedPiece.y };
      const to = { x: targetX, y: targetY };
      // Don't submit if dropping on the same square
      if (from.x !== to.x || from.y !== to.y) {
        submitReposition(parseInt(gameId), { from, to });
      }
      setDraggedPiece(null);
      setDragValidMoves([]);
      return;
    }

    // Adjust drop coordinates for multi-tile grab offset
    const grabOffset = dragGrabOffsetRef.current;
    const anchorX = targetX - (grabOffset.x || 0);
    const anchorY = targetY - (grabOffset.y || 0);

    // Don't move if dropping within the piece's own current footprint
    const selfW = draggedPiece.piece_width || 1;
    const selfH = draggedPiece.piece_height || 1;
    if (anchorX >= draggedPiece.x && anchorX < draggedPiece.x + selfW &&
        anchorY >= draggedPiece.y && anchorY < draggedPiece.y + selfH) {
      setDraggedPiece(null);
      setDragValidMoves([]);
      return;
    }

    // Check if target is a valid move (exact match or multi-tile footprint overlap)
    let validMove = dragValidMoves.find(m => m.x === anchorX && m.y === anchorY);
    if (!validMove && draggedPiece) {
      const dpw = draggedPiece.piece_width || 1;
      const dph = draggedPiece.piece_height || 1;
      if (dpw > 1 || dph > 1) {
        validMove = dragValidMoves.find(m => !m.isRangedAttack &&
          anchorX >= m.x && anchorX < m.x + dpw && anchorY >= m.y && anchorY < m.y + dph
        );
      }
    }
    // Multi-tile enemy fallback: dropping on a multi-tile enemy may route to its
    // anchor square. Find any capture move whose footprint overlaps the target square.
    if (!validMove && draggedPiece) {
      const pieces = parsePieces(gameState?.pieces);
      const targetPiece = findPieceAtSquare(pieces, anchorX, anchorY);
      if (targetPiece && targetPiece.id !== draggedPiece.id) {
        const dpw = draggedPiece.piece_width || 1;
        const dph = draggedPiece.piece_height || 1;
        validMove = dragValidMoves.find(m => {
          if (!m.isCapture) return false;
          for (let dy = 0; dy < dph; dy++) {
            for (let dx = 0; dx < dpw; dx++) {
              if (doesPieceOccupySquare(targetPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
    }
    if (!validMove) {
      // User tried to make a move that's not in the valid moves list
      // Check if it's because of check restrictions
      if (draggedPiece && gameState?.gameType?.mate_condition && gameState?.pieces) {
        // Calculate moves WITHOUT check filter to see if this was a valid move mechanically
        const movesWithoutCheckFilter = calculateValidMoves(
          draggedPiece,
          gameState.pieces,
          gameState?.gameType?.board_width || 8,
          gameState?.gameType?.board_height || 8,
          true // Skip check filter
        );
        
        // Check if the attempted move would be valid without check restrictions
        const moveWithoutCheckFilter = movesWithoutCheckFilter.find(m => m.x === anchorX && m.y === anchorY);
        
        if (moveWithoutCheckFilter) {
          // The move is mechanically valid but was filtered out by check validation
          if (inCheck && currentPlayer?.position === gameState?.currentTurn) {
            setMoveError("You must get out of check");
          } else {
            setMoveError("This move would put you in check");
          }
          setTimeout(() => setMoveError(null), 3000);
          if (soundEnabledRef.current) {
            soundManager.playIllegalMove();
          }
        }
        // If moveWithoutCheckFilter is also undefined, the move is invalid for other reasons
        // (piece can't move that way), so don't show a warning
      }
      return;
    }
    
    // Castle-on-drag: if the user hovered ≥ 1 s over this square during the
    // drag, swap the regular move for its castling alternative.
    const armed = castleArmedSquare;
    if (armed && armed.x === anchorX && armed.y === anchorY) {
      const castleAlt = dragValidMoves.find(m => m.x === anchorX && m.y === anchorY && m.isCastling);
      if (castleAlt) validMove = castleAlt;
    }
    // Clear castle-hold drag state regardless of which variant fires.
    if (castleHoldTimerRef.current) { clearTimeout(castleHoldTimerRef.current); castleHoldTimerRef.current = null; }
    dragCastleHoverRef.current = null;
    if (castleHoldSquare) setCastleHoldSquare(null);
    if (castleArmedSquare) setCastleArmedSquare(null);

    if (validMove) {
      // Check if this is a regular move or premove
      const canMakeMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
      const canMakePremove = (!isMyTurn || !!gameState?.botPlayer) && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && myRepositionsDone && !(gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns);
      
      if (canMakeMove) {
        const moveData = {
          from: { x: draggedPiece.x, y: draggedPiece.y },
          to: { x: validMove.x, y: validMove.y },
          pieceId: draggedPiece.id
        };
        // Include castling data if this is a castling move
        if (validMove.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = validMove.castlingWith;
          moveData.castlingDirection = validMove.castlingDirection;
        }
        // Include hop capture data (checkers-style capture)
        if (validMove.isHopCapture) {
          moveData.isHopCapture = true;
          moveData.hopCapturedPieceIds = validMove.hopCapturedPieceIds;
        }
        // Include ranged attack flag
        if (validMove.isRangedAttack) {
          moveData.isRangedAttack = true;
        }
        // Include direction-change via square
        if (validMove.via) {
          moveData.via = validMove.via;
        }
        submitMove(parseInt(gameId), moveData);
      } else if (canMakePremove) {
        const premoveData = {
          from: { x: draggedPiece.x, y: draggedPiece.y },
          to: { x: validMove.x, y: validMove.y },
          pieceId: draggedPiece.id,
          pieceWidth: draggedPiece.piece_width || 1,
          pieceHeight: draggedPiece.piece_height || 1
        };
        if (validMove.isCastling) {
          premoveData.isCastling = true;
          premoveData.castlingWith = validMove.castlingWith;
          premoveData.castlingDirection = validMove.castlingDirection;
        }
        if (validMove.isHopCapture) {
          premoveData.isHopCapture = true;
          premoveData.hopCapturedPieceIds = validMove.hopCapturedPieceIds;
        }
        if (validMove.via) premoveData.via = validMove.via;
        setPremove(premoveData);
        sendPremove(parseInt(gameId), premoveData);
      }
    }

    setSelectedPiece(null);
    setValidMoves([]);
    setDraggedPiece(null);
    setDragValidMoves([]);
  }, [draggedPiece, dragValidMoves, isMyTurn, isMyRepositionTurn, myRepositionsDone, gameState, submitMove, submitReposition, sendPremove, gameId, inCheck, currentPlayer, soundEnabledRef, calculateValidMoves, pendingMove, showPromotionModal, castleArmedSquare, castleHoldSquare, vetoDoneThisTurn, vetoWindow, vetoMyBudget, reactiveMoveLocked]);

  // Check if board should be flipped (player 2 sees board from their perspective)
  const shouldFlipBoard = useMemo(() => {
    if (!currentPlayer) return false;
    return currentPlayer.position === 2;
  }, [currentPlayer]);

  // Compute captured pieces for each player from move history
  const capturedPieces = useMemo(() => {
    if (!gameState?.moveHistory) return { player1: [], player2: [] };
    
    const result = { player1: [], player2: [] };
    
    gameState.moveHistory.forEach(move => {
      if (!move.captured && !move.allCaptured) return;
      // Use allCaptured for multi-captures, otherwise single captured piece
      const captures = move.allCaptured && move.allCaptured.length > 1
        ? move.allCaptured
        : [move.captured];
      if (!captures.length || !captures[0]) return;

      // Tag pieces that were ally self-captures so material advantage can be
      // credited to the opponent (even though they display under the capturer).
      const allyCaptureIdSet = new Set(move.capturedAllyPieceIds || []);
      const taggedCaptures = captures.map(p =>
        allyCaptureIdSet.has(String(p.id)) ? { ...p, _isAllyCapture: true } : p
      );

      // move.position is 1 or 2 (the capturing player's position)
      if (move.position === 1) {
        result.player1.push(...taggedCaptures);
      } else if (move.position === 2) {
        result.player2.push(...taggedCaptures);
      }
    });
    
    return result;
  }, [gameState?.moveHistory]);

  // Compute approximate total value of captured pieces for each player.
  // Self-captured (ally) pieces count toward the OPPONENT's material advantage
  // since the capturing player lost their own material.
  //
  // Uses server-pre-computed pieceValues (piece_id → base value) when available;
  // falls back to client-side computation for older/in-flight game states.
  const capturedValues = useMemo(() => {
    const bw = gameState?.gameType?.board_width  || 8;
    const bh = gameState?.gameType?.board_height || 8;
    const pv = gameState?.pieceValues || null; // pre-computed map from server
    const p1Normal       = capturedPieces.player1.filter(p => !p._isAllyCapture);
    const p2Normal       = capturedPieces.player2.filter(p => !p._isAllyCapture);
    const p1SelfCaptures = capturedPieces.player1.filter(p =>  p._isAllyCapture);
    const p2SelfCaptures = capturedPieces.player2.filter(p =>  p._isAllyCapture);
    // Player 1's material = enemy pieces they took + Player 2's self-sacrifices
    const p1Val = totalMaterialValue(p1Normal,       bw, bh, pv)
                + totalMaterialValue(p2SelfCaptures, bw, bh, pv);
    // Player 2's material = enemy pieces they took + Player 1's self-sacrifices
    const p2Val = totalMaterialValue(p2Normal,       bw, bh, pv)
                + totalMaterialValue(p1SelfCaptures, bw, bh, pv);
    return {
      player1: Math.round(p1Val * 10) / 10,
      player2: Math.round(p2Val * 10) / 10,
      ready: true,
    };
  }, [capturedPieces, gameState?.gameType?.board_width, gameState?.gameType?.board_height, gameState?.pieceValues]);

  // Convert display coordinates to game coordinates
  const toGameCoords = useCallback((displayX, displayY, boardWidth, boardHeight) => {
    if (shouldFlipBoard) {
      return {
        x: boardWidth - 1 - displayX,
        y: boardHeight - 1 - displayY
      };
    }
    return { x: displayX, y: displayY };
  }, [shouldFlipBoard]);

  // Touch event handlers for mobile drag support
  const handleTouchStart = useCallback((e, piece) => {
    // Block dragging while a move is pending confirmation
    if (pendingMove) return;
    // Block dragging while my reactive move is awaiting the opponent's veto.
    if (reactiveMoveLocked) return;

    // Block dragging while a promotion choice is pending
    if (showPromotionModal) return;

    const pieceTeam = piece.player_id || piece.team;
    const isOwnPiece = currentPlayer && (pieceTeam === currentPlayer.position || piece.is_neutral);

    // Reposition phase: allow touch-dragging eligible pieces
    if (gameState?.repositionPhase?.active) {
      const repoKeyOnly = !!gameState?.gameType?.reposition_key_pieces_only;
      const canReposition = isMyRepositionTurn && isOwnPiece &&
        (!repoKeyOnly || piece.ends_game_on_capture || piece.ends_game_on_checkmate);
      if (!canReposition) return;
      const touch = e.touches[0];
      touchDragRef.current = { piece, moves: [], startX: touch.clientX, startY: touch.clientY, isDragging: false, grabOffset: { x: 0, y: 0 }, isReposition: true };
      setSelectedPiece(piece);
      setValidMoves([]);
      return;
    }

    const canDragForMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && isOwnPiece;
    const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece && !(gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns);

    if (!canDragForMove && !canDragForPremove) return;

    // If a capture action is pending, only allow dragging the designated piece
    if (captureActionPieceId != null && isMyTurn && piece.id !== captureActionPieceId) {
      showIllegalMoveWarning("You must use the highlighted piece for your capture action, or skip.", 2500);
      return;
    }

    const touch = e.touches[0];

    // Calculate grab offset within the piece footprint for multi-tile pieces
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    let grabOffset = { x: 0, y: 0 };
    if ((pw > 1 || ph > 1) && e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = touch.clientX - rect.left;
      const relY = touch.clientY - rect.top;
      const cellWidth = rect.width / pw;
      const cellHeight = rect.height / ph;
      grabOffset = {
        x: Math.floor(relX / cellWidth),
        y: Math.floor(relY / cellHeight)
      };
    }

    const pieces = parsePieces(gameState.pieces);
    const fogProbe = !!(gameState?.hideEnemyPieces && isMyTurn);
    const moves = calculateValidMoves(
      piece, pieces,
      gameState.gameType?.board_width || 8,
      gameState.gameType?.board_height || 8,
      canDragForPremove, // skipCheckFilter - premoves skip check filter since board state will change
      canDragForPremove,
      false,             // forHoverDisplay
      fogProbe           // forFog - include attack-only-empty squares for hidden-piece probing
    );

    touchDragRef.current = { piece, moves, startX: touch.clientX, startY: touch.clientY, isDragging: false, grabOffset };
    setSelectedPiece(piece);
    setValidMoves(moves);
  }, [isMyTurn, isMyRepositionTurn, gameState, currentPlayer, calculateValidMoves, pendingMove, captureActionPieceId, showIllegalMoveWarning, showPromotionModal, reactiveMoveLocked]);

  const handleTouchMove = useCallback((e) => {
    const td = touchDragRef.current;
    if (!td.piece) return;

    const touch = e.touches[0];
    const dx = touch.clientX - td.startX;
    const dy = touch.clientY - td.startY;

    // Start dragging after a small threshold to distinguish from taps
    if (!td.isDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      td.isDragging = true;
      setTouchDragPiece(td.piece);
    }

    if (td.isDragging) {
      e.preventDefault();
      setTouchDragPos({ x: touch.clientX, y: touch.clientY });
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const td = touchDragRef.current;
    if (!td.piece) return;

    if (td.isDragging && boardRef.current) {
      const touch = e.changedTouches[0];
      const boardRect = boardRef.current.getBoundingClientRect();
      const boardWidth = gameState?.gameType?.board_width || 8;
      const boardHeight = gameState?.gameType?.board_height || 8;

      const relX = touch.clientX - boardRect.left;
      const relY = touch.clientY - boardRect.top;

      let displayCol = Math.floor(relX / (boardRect.width / boardWidth));
      let displayRow = Math.floor(relY / (boardRect.height / boardHeight));

      // Convert from display coordinates to game coordinates (account for flip)
      let targetX = shouldFlipBoard ? (boardWidth - 1 - displayCol) : displayCol;
      let targetY = shouldFlipBoard ? (boardHeight - 1 - displayRow) : displayRow;

      // Adjust for multi-tile grab offset
      const grabOffset = td.grabOffset || { x: 0, y: 0 };
      const anchorX = targetX - (grabOffset.x || 0);
      const anchorY = targetY - (grabOffset.y || 0);

      // Bounds check
      if (anchorX >= 0 && anchorX < boardWidth && anchorY >= 0 && anchorY < boardHeight) {
        const piece = td.piece;
        const moves = td.moves;

        // Reposition phase: submit reposition instead of normal move
        if (td.isReposition) {
          const from = { x: piece.x, y: piece.y };
          const to = { x: anchorX, y: anchorY };
          if (from.x !== to.x || from.y !== to.y) {
            submitReposition(parseInt(gameId), { from, to });
          }
          touchDragRef.current = { piece: null, moves: [], startX: 0, startY: 0, isDragging: false, grabOffset: { x: 0, y: 0 } };
          setTouchDragPiece(null);
          setTouchDragPos(null);
          setSelectedPiece(null);
          setValidMoves([]);
          return;
        }

        const pw = piece.piece_width || 1;
        const ph = piece.piece_height || 1;

        // Don't move if dropping within the piece's own footprint
        if (!(anchorX >= piece.x && anchorX < piece.x + pw && anchorY >= piece.y && anchorY < piece.y + ph)) {
          let validMove = moves.find(m => m.x === anchorX && m.y === anchorY);

          // Multi-tile footprint overlap
          if (!validMove && (pw > 1 || ph > 1)) {
            validMove = moves.find(m => !m.isRangedAttack &&
              anchorX >= m.x && anchorX < m.x + pw && anchorY >= m.y && anchorY < m.y + ph
            );
          }

          // Multi-tile enemy fallback
          if (!validMove) {
            const pieces = parsePieces(gameState?.pieces);
            const targetPiece = findPieceAtSquare(pieces, anchorX, anchorY);
            if (targetPiece && targetPiece.id !== piece.id) {
              validMove = moves.find(m => {
                if (!m.isCapture) return false;
                for (let dy = 0; dy < ph; dy++) {
                  for (let dx = 0; dx < pw; dx++) {
                    if (doesPieceOccupySquare(targetPiece, m.x + dx, m.y + dy)) return true;
                  }
                }
                return false;
              });
            }
          }

          if (validMove) {
            const canMakeMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
            const canMakePremove = (!isMyTurn || !!gameState?.botPlayer) && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && myRepositionsDone && !(gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns);

            if (canMakeMove) {
              const moveData = {
                from: { x: piece.x, y: piece.y },
                to: { x: validMove.x, y: validMove.y },
                pieceId: piece.id
              };
              if (validMove.isCastling) {
                moveData.isCastling = true;
                moveData.castlingWith = validMove.castlingWith;
                moveData.castlingDirection = validMove.castlingDirection;
              }
              if (validMove.isHopCapture) {
                moveData.isHopCapture = true;
                moveData.hopCapturedPieceIds = validMove.hopCapturedPieceIds;
              }
              if (validMove.via) {
                moveData.via = validMove.via;
              }
              submitMove(parseInt(gameId), moveData);
            } else if (canMakePremove) {
              const premoveData = {
                from: { x: piece.x, y: piece.y },
                to: { x: validMove.x, y: validMove.y },
                pieceId: piece.id,
                pieceWidth: pw,
                pieceHeight: ph
              };
              if (validMove.isCastling) {
                premoveData.isCastling = true;
                premoveData.castlingWith = validMove.castlingWith;
                premoveData.castlingDirection = validMove.castlingDirection;
              }
              if (validMove.isHopCapture) {
                premoveData.isHopCapture = true;
                premoveData.hopCapturedPieceIds = validMove.hopCapturedPieceIds;
              }
              if (validMove.via) premoveData.via = validMove.via;
              setPremove(premoveData);
              sendPremove(parseInt(gameId), premoveData);
            }
          } else {
            // Check if the move was blocked by check restrictions
            if (piece && gameState?.gameType?.mate_condition && gameState?.pieces) {
              const movesWithoutCheckFilter = calculateValidMoves(
                piece,
                gameState.pieces,
                gameState?.gameType?.board_width || 8,
                gameState?.gameType?.board_height || 8,
                true // Skip check filter
              );
              const moveWithoutCheckFilter = movesWithoutCheckFilter.find(m => m.x === anchorX && m.y === anchorY);
              if (moveWithoutCheckFilter) {
                if (inCheck && currentPlayer?.position === gameState?.currentTurn) {
                  setMoveError("You must get out of check");
                } else {
                  setMoveError("This move would put you in check");
                }
                setTimeout(() => setMoveError(null), 3000);
                if (soundEnabledRef.current) {
                  soundManager.playIllegalMove();
                }
              }
            }
          }
        }
      }
    }
    // If not dragging, let onClick handle the tap

    touchDragRef.current = { piece: null, moves: [], startX: 0, startY: 0, isDragging: false, grabOffset: { x: 0, y: 0 } };
    setTouchDragPiece(null);
    setTouchDragPos(null);
    if (td.isDragging) {
      setSelectedPiece(null);
      setValidMoves([]);
    }
  }, [gameState, shouldFlipBoard, isMyTurn, isMyRepositionTurn, myRepositionsDone, submitMove, submitReposition, sendPremove, gameId, inCheck, currentPlayer, soundEnabledRef, calculateValidMoves]);

  // Handle right-click mousedown for ranged attack drag detection.
  // Global listeners are added synchronously here (not via a state-gated useEffect)
  // to ensure they are in place before the first mousemove fires, even for fast drags.
  const handleSquareMouseDown = useCallback((e, x, y) => {
    // Left-click hold on a dual-action square (regular move + castling on the
    // same destination): start a 1-second timer that arms the castling
    // variant. The onClick handler that fires on mouseup will then route to
    // the castle move when castleArmedRef matches; otherwise it falls through
    // to the regular move (the default).
    if (e.button === 0) {
      // Always cancel any previous hold state before starting a new one.
      if (castleHoldTimerRef.current) {
        clearTimeout(castleHoldTimerRef.current);
        castleHoldTimerRef.current = null;
      }
      castleArmedRef.current = null;
      setCastleArmedSquare(null);
      setCastleHoldSquare(null);

      if (selectedPiece && isMyTurn && validMoves.length > 0 &&
          (gameState?.status === 'active' || gameState?.status === 'ready')) {
        const hasRegular = validMoves.some(m => m.x === x && m.y === y && !m.isCastling && !m.isRangedAttack);
        const castleMove = validMoves.find(m => m.x === x && m.y === y && m.isCastling);
        if (hasRegular && castleMove) {
          // Capture current king piece + castle move data in closure so the
          // async handler can submit even if state changed by release time.
          const kingPiece = selectedPiece;
          setCastleHoldSquare({ x, y });

          castleHoldTimerRef.current = setTimeout(() => {
            castleHoldTimerRef.current = null;
            setCastleArmedSquare({ x, y });
            setCastleHoldSquare(null);

            // Execute the castle when the user releases (global so it fires
            // even if the cursor drifted off the square during the hold).
            function executeCastleOnRelease() {
              window.removeEventListener('mouseup', executeCastleOnRelease);
              setCastleArmedSquare(null);
              // Mark as consumed so onClick (which may fire just after) skips.
              castleArmedRef.current = 'consumed';
              const moveData = {
                from: { x: kingPiece.x, y: kingPiece.y },
                to: { x: castleMove.x, y: castleMove.y },
                pieceId: kingPiece.id,
                isCastling: true,
                castlingWith: castleMove.castlingWith,
                castlingDirection: castleMove.castlingDirection
              };
              submitMove(parseInt(gameId), moveData);
              setSelectedPiece(null);
              setValidMoves([]);
              setTimeout(() => { castleArmedRef.current = null; }, 500);
            }
            window.addEventListener('mouseup', executeCastleOnRelease);
          }, 1000);

          // Cancel the hold if the user releases before 1 s.
          function cancelCastleHold() {
            window.removeEventListener('mouseup', cancelCastleHold);
            if (castleHoldTimerRef.current) {
              clearTimeout(castleHoldTimerRef.current);
              castleHoldTimerRef.current = null;
              setCastleHoldSquare(null);
            }
          }
          window.addEventListener('mouseup', cancelCastleHold);
        }
      }
      return;
    }
    if (e.button !== 2) return;
    if (!gameState || gameState.status === 'completed') return;

    const pieces = parsePieces(gameState.pieces || []);
    const clickedPiece = findPieceAtSquare(pieces, x, y);
    const isOwnPiece = clickedPiece && currentPlayer &&
      (clickedPiece.player_id === currentPlayer.position || clickedPiece.team === currentPlayer.position);

    rightClickDataRef.current = {
      piece: clickedPiece, x, y, time: Date.now(),
      clientX: e.clientX, clientY: e.clientY,
      isDrag: false, isOwnRangedPiece: !!(isOwnPiece && clickedPiece?.can_capture_enemy_via_range)
    };

    const canPremoveRanged = (!isMyTurn || !!gameState.botPlayer) && gameState.allowPremoves !== false && myRepositionsDone;
    if (!isOwnPiece || !clickedPiece?.can_capture_enemy_via_range ||
        (!isMyTurn && !canPremoveRanged) ||
        (gameState?.status !== 'active' && gameState?.status !== 'ready')) {
      return;
    }

    // Add global drag listeners synchronously so fast drags are not missed
    const DRAG_DISTANCE_THRESHOLD = 5;
    const DRAG_TIME_THRESHOLD = 200;
    const bw = gameState?.gameType?.board_width || 8;
    const bh = gameState?.gameType?.board_height || 8;
    const isFlipped = currentPlayer?.position === 2;

    function getTargetSquare(clientX, clientY) {
      if (!boardRef.current) return null;
      const boardRect = boardRef.current.getBoundingClientRect();
      const squareW = boardRect.width / bw;
      const squareH = boardRect.height / bh;
      const relX = clientX - boardRect.left;
      const relY = clientY - boardRect.top;
      if (relX >= 0 && relX < boardRect.width && relY >= 0 && relY < boardRect.height) {
        const displayCol = Math.floor(relX / squareW);
        const displayRow = Math.floor(relY / squareH);
        const gameX = isFlipped ? (bw - 1 - displayCol) : displayCol;
        const gameY = isFlipped ? (bh - 1 - displayRow) : displayRow;
        return { x: gameX, y: gameY };
      }
      return null;
    }

    function cleanup() {
      rightClickDataRef.current = null;
      setRangedAttackSource(null);
      setRangedMousePos(null);
      setRangedTargetSquare(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      window.removeEventListener('resize', handleResize);
    }

    function handleMouseMove(ev) {
      const data = rightClickDataRef.current;
      if (!data || !data.isOwnRangedPiece) return;

      const dx = ev.clientX - data.clientX;
      const dy = ev.clientY - data.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - data.time;

      if (!data.isDrag && (dist > DRAG_DISTANCE_THRESHOLD || elapsed > DRAG_TIME_THRESHOLD)) {
        data.isDrag = true;
        setRangedAttackSource(data.piece);
      }

      if (data.isDrag) {
        setRangedMousePos({ x: ev.clientX, y: ev.clientY });
        setRangedTargetSquare(getTargetSquare(ev.clientX, ev.clientY));
      }
    }

    function handleMouseUp(ev) {
      if (ev.button !== 2) return;
      const data = rightClickDataRef.current;
      if (!data) { cleanup(); return; }

      if (data.isDrag) {
        const target = getTargetSquare(ev.clientX, ev.clientY);
        if (target && gameState?.pieces) {
          const allPieces = parsePieces(gameState.pieces);
          const targetPiece = findPieceAtSquare(allPieces, target.x, target.y);
          const sourceTeam = data.piece.player_id || data.piece.team;
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          const isStepRangedDrag = !!data.piece.step_by_step_attack_range;
          const isValidTarget = isStepRangedDrag
            ? canReachStepByStepRanged(data.piece, target.x, target.y, allPieces, bw, bh)
            : canRangedAttackTo(data.piece.y, data.piece.x, target.y, target.x, data.piece, sourceTeam);
          const isEnemyTarget = targetPiece && targetTeam !== sourceTeam && !targetPiece.cannot_be_captured && !targetPiece.ends_game_on_checkmate;
          const pathBlocked = !isStepRangedDrag && !isRangedPathClear(data.piece.x, data.piece.y, target.x, target.y, data.piece, allPieces, sourceTeam);

          if (isValidTarget && pathBlocked && (isEnemyTarget || canPremoveRanged)) {
            showIllegalMoveWarning("Ranged attack is blocked by another piece");
            cleanup();
            return;
          }

          if (isValidTarget && (isEnemyTarget || canPremoveRanged)) {
            if (isMyTurn) {
              if (isEnemyTarget) {
                submitMove(parseInt(gameId), {
                  from: { x: data.piece.x, y: data.piece.y },
                  to: { x: target.x, y: target.y },
                  pieceId: data.piece.id,
                  isRangedAttack: true
                });
              }
            } else if (canPremoveRanged) {
              const premoveData = {
                from: { x: data.piece.x, y: data.piece.y },
                to: { x: target.x, y: target.y },
                pieceId: data.piece.id,
                isRangedAttack: true,
                pieceWidth: data.piece.piece_width || 1,
                pieceHeight: data.piece.piece_height || 1
              };
              setPremove(premoveData);
              sendPremove(parseInt(gameId), premoveData);
            }
          }
        }
      } else {
        setRangedSelectedPiece(data.piece);
        cleanup();
        return;
      }
      // Defer cleanup so the contextmenu capture listener survives long enough
      // to suppress the browser's post-mouseup contextmenu event. Without this,
      // handleSquareContextMenu fires with a stale truthy premove and cancels it.
      setTimeout(cleanup, 0);
    }

    function handleContextMenu(ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }

    function handleResize() {
      if (rightClickDataRef.current?.isDrag) {
        setRangedMousePos(prev => prev ? { ...prev } : null);
      }
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu, { capture: true });
    window.addEventListener('resize', handleResize);
  }, [gameState, currentPlayer, isMyTurn, submitMove, gameId, sendPremove, setPremove, showIllegalMoveWarning, canReachStepByStepRanged, selectedPiece, validMoves]);

  // Handle contextmenu on square
  const handleSquareContextMenu = useCallback((e, x, y) => {
    e.preventDefault();

    // Veto mode: right-click removes the last veto stacked on this square.
    {
      const gt = gameState?.gameType;
      const vetoOn = gt?.veto_enabled && !gt?.simultaneous_turns;
      const iAmVetoer = vetoOn && (gameState?.status === 'active' || gameState?.status === 'ready') && currentPlayer && currentPlayer.position !== gameState.currentTurn;
      const vStyle = gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
      const vetoSelectActive = iAmVetoer && !vetoDoneThisTurn && (vStyle === 'preemptive' || !!vetoWindow);
      if (vetoSelectActive) {
        // Only intercept the right-click when there is actually a veto to remove
        // on this square; otherwise fall through so it can still clear a premove.
        const hasVetoHere = vetoSelection.some(d => d?.to?.x === x && d?.to?.y === y);
        if (hasVetoHere) {
          setVetoSelection(prev => {
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i]?.to?.x === x && prev[i]?.to?.y === y) {
                const next = prev.slice();
                next.splice(i, 1);
                return next;
              }
            }
            return prev;
          });
          return;
        }
      }
    }

    const data = rightClickDataRef.current;
    // If a ranged right-click is pending (hold detection active), skip normal handling
    if (data && data.isOwnRangedPiece) return;

    // Block interactions while a correspondence move is pending confirmation
    if (pendingMove) return;

    // Block interactions while a promotion choice is pending
    if (showPromotionModal) return;

    // Right-click cancels premove if one exists
    if (premove) {
      setPremove(null);
      sendClearPremove(parseInt(gameId));
      setSelectedPiece(null);
      setValidMoves([]);
      rightClickDataRef.current = null;
      return;
    }

    // Right-click-twice: if a ranged piece was previously selected, execute ranged attack or premove
    if (rangedSelectedPiece && (gameState?.status === 'active' || gameState?.status === 'ready')) {
      const pieces = parsePieces(gameState?.pieces || []);
      const targetPiece = findPieceAtSquare(pieces, x, y);
      const sourceTeam = rangedSelectedPiece.player_id || rangedSelectedPiece.team;
      const targetTeam = targetPiece?.player_id || targetPiece?.team;
      const bw = gameState?.gameType?.board_width || 8;
      const bh = gameState?.gameType?.board_height || 8;
      
      // Check if this is a valid ranged attack target (or potential target for premoves)
      const isStepRanged = !!rangedSelectedPiece.step_by_step_attack_range;
      const isValidTarget = isStepRanged
        ? canReachStepByStepRanged(rangedSelectedPiece, x, y, pieces, bw, bh)
        : canRangedAttackTo(rangedSelectedPiece.y, rangedSelectedPiece.x, y, x, rangedSelectedPiece, sourceTeam);
      const isEnemyTarget = targetPiece && targetTeam !== sourceTeam && !targetPiece.cannot_be_captured && !targetPiece.ends_game_on_checkmate;
      const canPremoveRanged = (!isMyTurn || !!gameState.botPlayer) && gameState.allowPremoves !== false && myRepositionsDone;
      const pathBlocked = !isStepRanged && !isRangedPathClear(rangedSelectedPiece.x, rangedSelectedPiece.y, x, y, rangedSelectedPiece, pieces, sourceTeam);

      if (isValidTarget && pathBlocked && (isEnemyTarget || canPremoveRanged)) {
        showIllegalMoveWarning("Ranged attack is blocked by another piece");
        setRangedSelectedPiece(null);
        rightClickDataRef.current = null;
        return;
      }

      if (isValidTarget && (isEnemyTarget || canPremoveRanged)) {
        if (isMyTurn) {
          // Execute ranged attack immediately
          if (isEnemyTarget) {
            submitMove(parseInt(gameId), {
              from: { x: rangedSelectedPiece.x, y: rangedSelectedPiece.y },
              to: { x, y },
              pieceId: rangedSelectedPiece.id,
              isRangedAttack: true
            });
          }
        } else if (canPremoveRanged) {
          // Set ranged premove
          const premoveData = {
            from: { x: rangedSelectedPiece.x, y: rangedSelectedPiece.y },
            to: { x, y },
            pieceId: rangedSelectedPiece.id,
            isRangedAttack: true,
            pieceWidth: rangedSelectedPiece.piece_width || 1,
            pieceHeight: rangedSelectedPiece.piece_height || 1
          };
          setPremove(premoveData);
          sendPremove(parseInt(gameId), premoveData);
        }
      }
      setRangedSelectedPiece(null);
      rightClickDataRef.current = null;
      return;
    }

    // Piece placement via right-click (default mode; left-click mode handled in handleSquareClick)
    if (!placementUseLeftClick && isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready')) {
      const otherData = gameState.otherGameData || {};
      if (otherData.place_pieces_action) {
        const pieces = parsePieces(gameState.pieces || []);
        const clickedPiece = findPieceAtSquare(pieces, x, y);
        if (!clickedPiece) {
          // Check if the square is allowed for the current player (restriction + confinement)
          const isRestrictedToOther = !isDeployAllowed(specialSquares, currentPlayer?.position, x, y);
          if (isRestrictedToOther) {
            showIllegalMoveWarning("You cannot place a piece on this square");
            rightClickDataRef.current = null;
            return;
          }
          if (!isRestrictedToOther) {
            const placeablePieces = getDeployablePieces(otherData, gameState.reserves, currentPlayer?.position);
            if (placeablePieces.length === 0) {
              showIllegalMoveWarning("You have no pieces left in your reserve");
            } else if (placeablePieces.length === 1) {
              submitMove(parseInt(gameId), {
                type: 'place',
                to: { x, y },
                placePieceId: placeablePieces[0].piece_id
              });
            } else if (placeablePieces.length > 1) {
              setPlacementTarget({ x, y });
              setShowPlacementModal(true);
            }
            rightClickDataRef.current = null;
            return;
          }
        }
      }
    }

    // If a piece is selected and it's our turn, try to move to the right-clicked square
    const canMoveSelected = selectedPiece && isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
    if (canMoveSelected) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      if (move) {
        const moveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        };
        if (move.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = move.castlingWith;
          moveData.castlingDirection = move.castlingDirection;
        }
        if (move.via) {
          moveData.via = move.via;
        }
        submitMove(parseInt(gameId), moveData);
        setSelectedPiece(null);
        setValidMoves([]);
      }
    } else {
      setSelectedPiece(null);
      setValidMoves([]);
    }
    rightClickDataRef.current = null;
  }, [selectedPiece, validMoves, isMyTurn, gameState, submitMove, gameId, premove, sendClearPremove, rangedSelectedPiece, sendPremove, showIllegalMoveWarning, placementUseLeftClick, currentPlayer, specialSquares, setPlacementTarget, setShowPlacementModal, canReachStepByStepRanged, setPremove, isRangedPathClear, pendingMove, showPromotionModal, vetoDoneThisTurn, vetoWindow, vetoSelection]);

  // Handle resign
  const handleResign = () => {
    if (window.confirm("Are you sure you want to resign?")) {
      resign(parseInt(gameId));
    }
  };

  // Handle pass (Allow Pass mechanic)
  const handlePass = () => {
    passTurn(parseInt(gameId));
  };

  // Handle draw offer
  const handleOfferDraw = () => {
    offerDraw(parseInt(gameId));
  };

  // Handle accepting draw offer
  const handleAcceptDraw = () => {
    acceptDraw(parseInt(gameId));
    setPendingDrawOffer(null);
  };

  // Handle declining draw offer
  const handleDeclineDraw = () => {
    declineDraw(parseInt(gameId));
    setPendingDrawOffer(null);
  };

  // Handle cancelling a draw offer you sent
  const handleCancelDraw = () => {
    cancelDraw(parseInt(gameId));
    setDrawOfferSent(false);
  };

  // Handle piece placement selection from modal
  const handlePlacementSelect = useCallback((piece) => {
    if (!placementTarget) return;
    submitMove(parseInt(gameId), {
      type: 'place',
      to: { x: placementTarget.x, y: placementTarget.y },
      placePieceId: piece.piece_id
    });
    setShowPlacementModal(false);
    setPlacementTarget(null);
  }, [gameId, submitMove, placementTarget]);

  const handlePlacementCancel = useCallback(() => {
    setShowPlacementModal(false);
    setPlacementTarget(null);
  }, []);

  // Handle promotion selection
  const handlePromotionSelect = useCallback((selectedPiece) => {
    if (!promotionData) return;

    // The chosen option may target a specific player (cross-player / neutral
    // promotion). Pass it along so the server hands the piece to the right side.
    const targetPlayer = selectedPiece.promotion_target_player != null
      ? selectedPiece.promotion_target_player
      : null;

    if (promotionIsSimul) {
      simulPromotionChoice(parseInt(gameId), promotionData.pieceId, selectedPiece.piece_id, targetPlayer);
      // Hide the modal immediately — server doesn't echo a per-player ack
      // before the round resolves and we don't want to leave it visible.
      setShowPromotionModal(false);
      setPromotionData(null);
      setPromotionIsSimul(false);
      setPrePromotionPieces(null);
      return;
    }

    promotePiece(parseInt(gameId), promotionData.pieceId, selectedPiece.piece_id, targetPlayer);
    // Don't close modal yet - wait for piecePromoted event
  }, [gameId, promotePiece, promotionData, promotionIsSimul, simulPromotionChoice]);

  // Handle promotion cancel — reverts the move on the server so the player can choose again
  const handlePromotionCancel = useCallback(() => {
    cancelPromotion(parseInt(gameId));
    // Modal closes when the server responds with promotionCancelled
  }, [gameId, cancelPromotion]);

  const handlePromotionMinimize = useCallback(() => {
    setPromotionMinimized(true);
  }, []);

  const handlePromotionRestore = useCallback(() => {
    setPromotionMinimized(false);
  }, []);

  // Helper to get special square type at a position.
  // Gated behind the global "Show all special squares" toggle so live games are not
  // visually noisy by default — players opt in to see promotion / range / control / custom squares.
  const getSpecialSquareType = useCallback((row, col) => {
    if (!showAllSpecialSquares) return null;
    const key = `${row},${col}`;
    if (specialSquares.promotion[key]) return 'promotion';
    if (specialSquares.range[key]) return 'range';
    if (specialSquares.control[key]) return 'control';
    if (specialSquares.special[key]) return 'special';
    return null;
  }, [specialSquares, showAllSpecialSquares]);

  // True when this game has ANY special squares of ANY type defined.
  const hasSpecialSquares = useMemo(() => {
    return Object.keys(specialSquares.promotion).length > 0 ||
           Object.keys(specialSquares.range).length > 0 ||
           Object.keys(specialSquares.control).length > 0 ||
           Object.keys(specialSquares.special).length > 0;
  }, [specialSquares]);

  // True when this game has any custom squares flagged as restriction zones.
  const hasRestrictionZones = useMemo(() => {
    return Object.values(specialSquares.special).some(cfg => cfg.asRestrictionZone);
  }, [specialSquares]);

  // Handle rematch / new game
  const handlePlayAgain = () => {
    // Save the last played game type to localStorage
    if (gameState?.gameTypeId) {
      localStorage.setItem('lastPlayedGameType', gameState.gameTypeId.toString());
    }
    navigate("/play/games");
  };

  // Upvote the game type from the game-over modal
  const handleGameOverUpvote = async () => {
    if (!gameState?.gameTypeId) return;
    try {
      await toggleUpvote(gameState.gameTypeId);
      setGameOverUpvoteState('just_upvoted');
    } catch {
      // Non-critical — silently fail
    }
  };

  // Check if user can join this game
  const canJoin = useMemo(() => {
    if (!gameState) return false;
    if (gameState.status !== 'waiting') return false;
    if (currentUser) {
      const isAlreadyPlayer = gameState.players?.some(p => p.id === currentUser.id);
      return !isAlreadyPlayer;
    }
    // Anonymous users can join unrated, non-challenge, non-correspondence games that aren't full
    return !gameState.rated && !gameState.isChallenge && !gameState.isCorrespondence && (gameState.players?.length || 0) < 2;
  }, [gameState, currentUser]);

  // Handle joining the game
  const handleJoinGame = async () => {
    if (!currentUser) {
      if (gameState?.rated || gameState?.isCorrespondence || gameState?.isChallenge) {
        navigate('/login', { state: { message: "Please log in to join this game." } });
      } else {
        setGuestJoinName('');
        setShowGuestJoinModal(true);
      }
      return;
    }
    try {
      await joinGame(parseInt(gameId));
    } catch (err) {
      setError(err.message);
    }
  };

  // Handle confirming join as guest from the modal
  const handleConfirmGuestJoin = async () => {
    setIsJoiningAsGuest(true);
    try {
      await joinOpenGameAsGuest(parseInt(gameId), guestJoinName || 'Guest');
      setShowGuestJoinModal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsJoiningAsGuest(false);
    }
  };

  // Get castling info for display
  const castlingInfo = useMemo(() => {
    if (!gameState?.pieces) return [];
    const pieces = parsePieces(gameState.pieces);
    const boardWidth = gameState.gameType?.board_width || 8;
    
    return pieces
      .filter(piece => piece.can_castle)
      .map(piece => {
        let leftPartner = piece.castling_partner_left_id 
          ? pieces.find(p => p.id === piece.castling_partner_left_id)
          : null;
        let rightPartner = piece.castling_partner_right_id 
          ? pieces.find(p => p.id === piece.castling_partner_right_id)
          : null;
        
        // Auto-discover partners on the client if server hasn't set them yet
        if (!leftPartner && piece.castling_partner_left_id === undefined) {
          const owner = piece.team || piece.player_id;
          for (let x = piece.x - 1; x >= 0; x--) {
            const found = pieces.find(p => p.x === x && p.y === piece.y && (p.team || p.player_id) === owner);
            if (found) leftPartner = found;
          }
        }
        if (!rightPartner && piece.castling_partner_right_id === undefined) {
          const owner = piece.team || piece.player_id;
          for (let x = piece.x + 1; x < boardWidth; x++) {
            const found = pieces.find(p => p.x === x && p.y === piece.y && (p.team || p.player_id) === owner);
            if (found) rightPartner = found;
          }
        }
        
        return {
          piece,
          leftPartner,
          rightPartner,
          distance: piece.castling_distance ?? 2
        };
      });
  }, [gameState?.pieces, gameState?.gameType?.board_width]);
  /* eslint-enable react-hooks/rules-of-hooks */

  // Render board
  const renderBoard = () => {
    if (!gameState) return null;

    const boardWidth = gameState.gameType?.board_width || 8;
    const boardHeight = gameState.gameType?.board_height || 8;
    const isGhostMode = ghostMoveIndex !== null && initialPiecesRef.current;
    const pieces = isGhostMode
      ? replayToMove(initialPiecesRef.current, gameState.moveHistory, ghostMoveIndex)
      : parsePieces(gameState.pieces);
    const lastMove = isGhostMode
      ? gameState.moveHistory[ghostMoveIndex] || null
      : gameState.moveHistory?.slice(-1)[0];
    // Collect all consecutive moves from the same player position as the last
    // move. This handles both multi-action-per-turn games and must_move_if_able
    // games where extra free moves add to the same turn without a turn switch.
    const lastMoves = (() => {
      if (!lastMove) return [];
      const history = gameState.moveHistory || [];
      const endIdx = isGhostMode ? ghostMoveIndex : history.length - 1;
      const turnPosition = history[endIdx]?.position;
      if (turnPosition == null) return [lastMove];
      const moves = [];
      for (let i = endIdx; i >= 0; i--) {
        if (history[i].position !== turnPosition) break;
        moves.push(history[i]);
      }
      return moves;
    })();
    const showHelpers = gameState.showPieceHelpers;
    
    // Calculate which of the current player's pieces can move (only if feature is enabled and it's their turn)
    const movablePieceIds = new Set();
    if (!isGhostMode && showMovableIndicators && isMyTurn && currentPlayer && (gameState.status === 'active' || gameState.status === 'ready')) {
      // Check if the current player is in check
      const playerInCheck = inCheck && currentPlayer.position === gameState.currentTurn;
      
      pieces.forEach(piece => {
        const pieceTeam = piece.player_id || piece.team;
        if (pieceTeam === currentPlayer.position || piece.is_neutral) {
          const moves = calculateValidMoves(piece, pieces, boardWidth, boardHeight);
          
          if (playerInCheck) {
            // When in check, only count moves that resolve the check
            const hasCheckResolvingMove = moves.some(move => 
              wouldMoveResolveCheck(piece, move.x, move.y, pieces, currentPlayer.position, boardWidth, boardHeight)
            );
            if (hasCheckResolvingMove) {
              movablePieceIds.add(piece.id);
            }
          } else {
            // Not in check - show all pieces with valid moves
            if (moves.length > 0) {
              movablePieceIds.add(piece.id);
            }
          }
        }
      });
    }

    // Calculate square size dynamically so the board always fits on screen
    const squareSize = boardVpHook.squareSize || 32;

    const squares = [];

    // Go-style board display: render as a wood-coloured grid of lines with pieces
    // on the intersections (display-only preference from Step 3 of the wizard).
    const intersectionBoard = gameState?.otherGameData?.intersection_board === true;

    // Whether this game has any points-based win or draw condition (controls points-square overlay visibility)
    const hasPointsCondition = gameState.gameType?.points_to_win != null ||
      gameState.gameType?.draw_equal_points_at_turn != null ||
      gameState.gameType?.draw_equal_points_consecutive != null;

    // Veto X colour: one shared shade for both players (slightly darker than the
    // old light red, but not the dark red), keeping the light-X drop shadow.
    const vetoMarkColor = '#ee5751';
    const vetoMarkShadow = '0 0 3px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.9)';

    // ── Fog of War visibility ────────────────────────────────────────────────
    // fogVisibleSquares is a Set<"x,y"> of squares the viewing player can see.
    // null means fog is disabled (all squares visible).
    //
    // When a move is staged/pending (awaiting confirmation), compute fog from the
    // PRE-MOVE piece positions so players can't probe opponent visibility by
    // sliding pieces around before committing their turn.
    const fogPieces = (gameState.fogOfWarEnabled && (pendingMove || stagedSimulMove) && preConfirmState)
      ? parsePieces(preConfirmState.pieces)
      : (gameState.fogOfWarEnabled && showPromotionModal && !promotionIsSimul && prePromotionPieces)
      ? parsePieces(prePromotionPieces)
      : pieces;

    const fogVisibleSquares = (() => {
      // Spectators in fog games see the union of both players' visible squares
      // (they see the combined board, not through any individual player's fog).
      // Fog is also lifted once the game ends and the player has dismissed the
      // game-over modal, so the full board is revealed for post-game review.
      const isGameCompleted = gameState.status === 'completed' || gameState.status === 'abandoned';
      const isFogActive = !isGhostMode && gameState.fogOfWarEnabled && (currentPlayer || isSpectator) && !(isGameCompleted && !showGameOver);
      if (!isFogActive) return null;

      // viewerPosition: player's own position, or null for spectators (see both sides).
      const viewerPosition = isSpectator ? null : currentPlayer.position;
      const visible = new Set();

      fogPieces.forEach(p => {
        const pTeam = p.player_id ?? p.team;
        // Players see squares reachable by their own pieces only.
        // Spectators see squares reachable by EITHER player's pieces.
        if (viewerPosition !== null && pTeam !== viewerPosition) return;
        // The piece's own footprint is always visible
        const pw = p.piece_width || 1;
        const ph = p.piece_height || 1;
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            visible.add(`${p.x + dx},${p.y + dy}`);
          }
        }
        // All squares the piece can move to or attack are visible.
        // skipCheckFilter=true: raw reachability, not legality.
        // forFog=true: also include capture-range squares even when empty (e.g. pawn diagonals)
        //   WITHOUT skipping path checks (unlike forPremove).
        const moves = calculateValidMoves(p, fogPieces, boardWidth, boardHeight, true, false, false, true);
        moves.forEach(m => {
          const mw = pw; // destination footprint width matches piece width
          const mh = ph;
          for (let dy = 0; dy < mh; dy++) {
            for (let dx = 0; dx < mw; dx++) {
              visible.add(`${m.x + dx},${m.y + dy}`);
            }
          }
        });
      });

      // Permanent reveal: merge current visibility into the running accumulated set.
      // Once a square is seen it stays revealed for the rest of the game session.
      if (gameState.gameType?.permanent_fog_reveal && fogRevealedRef.current) {
        visible.forEach(key => fogRevealedRef.current.add(key));
        return fogRevealedRef.current; // includes all squares ever visible
      }

      return visible;
    })();

    // Pre-compute attack radius splash squares for the hovered piece
    const attackRadiusSplashSquares = new Set();
    if (hoveredPiece && (hoveredPiece.attack_radius || 0) > 0 && hoveredMoves.length > 0) {
      const radius = hoveredPiece.attack_radius;
      const captureTargets = hoveredMoves.filter(m => m.isCapture || m.isRangedAttack);
      for (const target of captureTargets) {
        for (let sr = target.y - radius; sr <= target.y + radius; sr++) {
          for (let sc = target.x - radius; sc <= target.x + radius; sc++) {
            if (sr >= 0 && sr < boardHeight && sc >= 0 && sc < boardWidth) {
              if (sr !== target.y || sc !== target.x) {
                attackRadiusSplashSquares.add(`${sc},${sr}`);
              }
            }
          }
        }
      }
    }

    for (let displayY = 0; displayY < boardHeight; displayY++) {
      for (let displayX = 0; displayX < boardWidth; displayX++) {
        // Convert display position to actual game coordinates
        const { x: gameX, y: gameY } = toGameCoords(displayX, displayY, boardWidth, boardHeight);
        
        const isLight = (gameX + gameY) % 2 === 0;
        // Multi-tile aware: find piece whose footprint covers this square
        const piece = findPieceAtSquare(pieces, gameX, gameY);
        // Is this the anchor square (top-left) of the piece? Only render image here.
        const isAnchor = piece && piece.x === gameX && piece.y === gameY;
        const isSelected = (selectedPiece && doesPieceOccupySquare(selectedPiece, gameX, gameY))
          || (captureActionPieceId != null && piece?.id === captureActionPieceId && isMyTurn);
        // Find regular and ranged moves separately so both styles can overlap
        // Multi-tile aware: highlight all squares the piece would cover at each valid destination
        // But don't highlight squares within the selected piece's current footprint
        const spw = selectedPiece?.piece_width || 1;
        const sph = selectedPiece?.piece_height || 1;
        const inSelectedFootprint = selectedPiece && doesPieceOccupySquare(selectedPiece, gameX, gameY);
        const regularMove = !inSelectedFootprint ? validMoves.find(m => !m.isRangedAttack &&
          gameX >= m.x && gameX < m.x + spw && gameY >= m.y && gameY < m.y + sph
        ) : null;
        // Castle-alternative: when the same destination also yields a castling
        // move (alongside the matched regular move), render a secondary dot so
        // the user can see both options exist. Click = regular, hold 1s = castle.
        const castleAltMove = (regularMove && !regularMove.isCastling)
          ? validMoves.find(m => m.x === gameX && m.y === gameY && m.isCastling)
          : null;
        const isCastleCharging = !!castleAltMove && castleHoldSquare && castleHoldSquare.x === gameX && castleHoldSquare.y === gameY;
        const isCastleArmed = !!castleAltMove && castleArmedSquare && castleArmedSquare.x === gameX && castleArmedSquare.y === gameY;
        const rangedMove = validMoves.find(m => m.x === gameX && m.y === gameY && m.isRangedAttack);
        const isLastMoveFrom = lastMoves.some(lm => {
          const lmpw = lm.piece_width || 1;
          const lmph = lm.piece_height || 1;
          return lm.from && gameX >= lm.from.x && gameX < lm.from.x + lmpw
            && gameY >= lm.from.y && gameY < lm.from.y + lmph;
        });
        const isLastMoveTo = lastMoves.some(lm => {
          if (lm.isRangedAttack) return false; // ranged attacker doesn't move — don't highlight target as "moved to"
          const lmpw = lm.piece_width || 1;
          const lmph = lm.piece_height || 1;
          return lm.to && gameX >= lm.to.x && gameX < lm.to.x + lmpw
            && gameY >= lm.to.y && gameY < lm.to.y + lmph;
        });
        // Fading previous-move highlight (persists ~1s after a new move so the prior
        // move's squares fade out instead of disappearing instantly)
        const isFadingLastMoveFrom = !isLastMoveFrom && !isLastMoveTo && fadingLastMoves.some(lm => {
          const lmpw = lm.piece_width || 1;
          const lmph = lm.piece_height || 1;
          return lm.from && gameX >= lm.from.x && gameX < lm.from.x + lmpw
            && gameY >= lm.from.y && gameY < lm.from.y + lmph;
        });
        const isFadingLastMoveTo = !isLastMoveFrom && !isLastMoveTo && fadingLastMoves.some(lm => {
          if (lm.isRangedAttack) return false; // ranged attacker doesn't move — don't highlight target as "moved to"
          const lmpw = lm.piece_width || 1;
          const lmph = lm.piece_height || 1;
          return lm.to && gameX >= lm.to.x && gameX < lm.to.x + lmpw
            && gameY >= lm.to.y && gameY < lm.to.y + lmph;
        });
        
        // Check if this piece can move (only shown when it's your turn)
        const canMove = piece && movablePieceIds.has(piece.id);

        // Highlight pieces that are eligible to be repositioned this turn
        const isRepositionable = isMyRepositionTurn && isAnchor && !!piece && (() => {
          const pieceTeamLocal = piece.player_id != null ? Number(piece.player_id) : Number(piece.team);
          if (pieceTeamLocal !== currentPlayer?.position) return false;
          const repoKeyOnly = !!gameState?.gameType?.reposition_key_pieces_only;
          return !repoKeyOnly || piece.ends_game_on_capture || piece.ends_game_on_checkmate;
        })();
        
        // Check if this square shows a hovered piece's possible move (separate regular/ranged)
        const hpw = hoveredPiece?.piece_width || 1;
        const hph = hoveredPiece?.piece_height || 1;
        const inHoveredFootprint = hoveredPiece && doesPieceOccupySquare(hoveredPiece, gameX, gameY);
        const hoveredRegularMove = showHelpers && hoveredPiece && !selectedPiece && !inHoveredFootprint
          ? hoveredMoves.find(m => !m.isRangedAttack &&
              gameX >= m.x && gameX < m.x + hpw && gameY >= m.y && gameY < m.y + hph)
          : null;
        const hoveredRangedMove = showHelpers && hoveredPiece && !selectedPiece 
          ? hoveredMoves.find(m => m.x === gameX && m.y === gameY && m.isRangedAttack) 
          : null;

        // DC via squares: squares that are turning points for direction-change moves
        const isViaForDcMove = !inSelectedFootprint && validMoves.some(
          m => m.isDirectionChange && m.via && m.via.x === gameX && m.via.y === gameY && !m.isCapture
        );
        const isViaForDcCapture = !inSelectedFootprint && validMoves.some(
          m => m.isDirectionChange && m.via && m.via.x === gameX && m.via.y === gameY && !!m.isCapture
        );
        const isHoverViaForDcMove = showHelpers && hoveredPiece && !selectedPiece && hoveredMoves.some(
          m => m.isDirectionChange && m.via && m.via.x === gameX && m.via.y === gameY && !m.isCapture
        );
        const isHoverViaForDcCapture = showHelpers && hoveredPiece && !selectedPiece && hoveredMoves.some(
          m => m.isDirectionChange && m.via && m.via.x === gameX && m.via.y === gameY && !!m.isCapture
        );

        // Check if this piece is in check
        const isInCheck = piece && inCheck && checkedPieces.some(cp => cp.id === piece.id);

        // Check if this square is part of a premove (multi-tile aware)
        const pmPw = premove?.pieceWidth || 1;
        const pmPh = premove?.pieceHeight || 1;
        const isPremoveFrom = premove && gameX >= premove.from.x && gameX < premove.from.x + pmPw
          && gameY >= premove.from.y && gameY < premove.from.y + pmPh;
        const isPremoveTo = premove && gameX >= premove.to.x && gameX < premove.to.x + pmPw
          && gameY >= premove.to.y && gameY < premove.to.y + pmPh;
        // A move held pending the opponent's veto is shown with the same premove
        // styling so it persists visually instead of jumping when the veto resolves.
        const isHeldMoveFrom = !!(heldMoveHighlight?.from && gameX === heldMoveHighlight.from.x && gameY === heldMoveHighlight.from.y);
        const isHeldMoveTo = !!(heldMoveHighlight?.to && gameX === heldMoveHighlight.to.x && gameY === heldMoveHighlight.to.y);

        // Directional arrow for last-move "from" square (skip for ranged attacks and for moves where piece didn't change position)
        const arrowMoveData = isLastMoveFrom
          ? lastMoves.find(lm => lm.from && lm.from.x === gameX && lm.from.y === gameY && !lm.isRangedAttack && lm.type !== 'ranged' && !(lm.from.x === lm.to?.x && lm.from.y === lm.to?.y))
          : isFadingLastMoveFrom
            ? fadingLastMoves.find(lm => lm.from && lm.from.x === gameX && lm.from.y === gameY && !lm.isRangedAttack && lm.type !== 'ranged' && !(lm.from.x === lm.to?.x && lm.from.y === lm.to?.y))
            : null;
        const arrowAngleDeg = arrowMoveData ? (() => {
          const dx = shouldFlipBoard ? (arrowMoveData.from.x - arrowMoveData.to.x) : (arrowMoveData.to.x - arrowMoveData.from.x);
          const dy = shouldFlipBoard ? (arrowMoveData.from.y - arrowMoveData.to.y) : (arrowMoveData.to.y - arrowMoveData.from.y);
          return Math.atan2(dy, dx) * 180 / Math.PI;
        })() : null;

        // Check for special square type
        const specialSquareType = getSpecialSquareType(gameY, gameX);
        // Restriction zone highlight is shown by default (independent of showAllSpecialSquares)
        // unless the player has toggled it off.
        const sqCfg = specialSquares.special[`${gameY},${gameX}`];
        const isRestrictionZone = !!(sqCfg?.asRestrictionZone);
        const isImpassable = !!(sqCfg?.impassable);
        // Placement restriction: square where the current player cannot deploy
        // (either restricted to another player, or the player is confined elsewhere).
        const isPlacementRestricted = !!(gameState?.otherGameData?.place_pieces_action
          && !isDeployAllowed(specialSquares, currentPlayer?.position, gameX, gameY));

        // Ranged attack highlights
        const isRangedMove = !!rangedMove;
        const isRangedHover = !!hoveredRangedMove;
        // During ranged drag, highlight valid ranged target squares (path-checked)
        const isRangedDragTarget = rangedAttackSource
          && !(piece && ((piece.player_id || piece.team) === (rangedAttackSource.player_id || rangedAttackSource.team)))
          && !(piece?.cannot_be_captured)
          && !(piece?.ends_game_on_checkmate)
          && (rangedAttackSource.step_by_step_attack_range
            ? canReachStepByStepRanged(rangedAttackSource, gameX, gameY, pieces, gameState?.gameType?.board_width || 8, gameState?.gameType?.board_height || 8)
            : (canRangedAttackTo(rangedAttackSource.y, rangedAttackSource.x, gameY, gameX, rangedAttackSource, rangedAttackSource.player_id || rangedAttackSource.team)
              && isRangedPathClear(rangedAttackSource.x, rangedAttackSource.y, gameX, gameY, rangedAttackSource, pieces, rangedAttackSource.player_id || rangedAttackSource.team)));
        // Right-click-twice mode: highlight valid ranged squares (path-checked)
        const isRangedSelectedTarget = !rangedAttackSource && rangedSelectedPiece
          && !(piece && ((piece.player_id || piece.team) === (rangedSelectedPiece.player_id || rangedSelectedPiece.team)))
          && !(piece?.cannot_be_captured)
          && !(piece?.ends_game_on_checkmate)
          && (rangedSelectedPiece.step_by_step_attack_range
            ? canReachStepByStepRanged(rangedSelectedPiece, gameX, gameY, pieces, gameState?.gameType?.board_width || 8, gameState?.gameType?.board_height || 8)
            : (canRangedAttackTo(rangedSelectedPiece.y, rangedSelectedPiece.x, gameY, gameX, rangedSelectedPiece, rangedSelectedPiece.player_id || rangedSelectedPiece.team)
              && isRangedPathClear(rangedSelectedPiece.x, rangedSelectedPiece.y, gameX, gameY, rangedSelectedPiece, pieces, rangedSelectedPiece.player_id || rangedSelectedPiece.team)));
        const isRangedSelectedSource = rangedSelectedPiece && rangedSelectedPiece.x === gameX && rangedSelectedPiece.y === gameY;

        // Points-square overlay: always show for custom squares with control points when a points condition is active
        const squareCfgForPoints = specialSquares.special[`${gameY},${gameX}`];
        const squareControlPoints = hasPointsCondition ? (squareCfgForPoints?.controlPoints || 0) : 0;

        // Move indicator — type drives a CSS custom property rendered via ::after pseudo-element.
        // Using CSS avoids React DOM node creation/destruction on every hover, eliminating hover lag.
        // Suppress the dot on impassable squares: they cannot be valid destinations.
        // Also suppress the regular dot once the castle is armed on a dual-action square —
        // the secondary castle-armed indicator takes over so the user has unambiguous feedback.
        const activeRegularMove = regularMove || hoveredRegularMove;
        const activeIsRanged = isRangedMove || isRangedHover || isRangedDragTarget || isRangedSelectedTarget;
        const dotType = (activeRegularMove && !isImpassable && !isCastleArmed)
          ? getMoveDotType(activeRegularMove)
          : null;

        // Whether this square is hidden by fog (used to suppress piece/indicator rendering)
        const isFogged = !!(fogVisibleSquares && !fogVisibleSquares.has(`${gameX},${gameY}`));

        squares.push(
          <div
            key={`${displayX}-${displayY}`}
            className={`
              ${styles["board-square"]}
              ${isLight ? styles.light : styles.dark}
              ${isSelected ? styles.selected : ''}
              ${regularMove && !regularMove.isCapture && !regularMove.isFirstMoveOnly && !regularMove.isCustomMove ? styles["valid-move"] : ''}
              ${regularMove && !regularMove.isCapture && regularMove.isFirstMoveOnly && !regularMove.isCustomMove ? styles["valid-move-first-only"] : ''}
              ${regularMove && !regularMove.isCapture && regularMove.isCustomMove ? styles["valid-move-custom"] : ''}
              ${regularMove && regularMove.isCapture && !regularMove.isFirstMoveOnly && !regularMove.isCustomAttack ? styles["valid-capture"] : ''}
              ${regularMove && regularMove.isCapture && regularMove.isFirstMoveOnly && !regularMove.isCustomAttack ? styles["valid-capture-first-only"] : ''}
              ${regularMove && regularMove.isCapture && regularMove.isCustomAttack ? styles["valid-capture-custom"] : ''}
              ${isRangedMove ? styles["ranged-attack"] : ''}
              ${hoveredRegularMove && !hoveredRegularMove.isCapture && !hoveredRegularMove.isFirstMoveOnly && !hoveredRegularMove.isCustomMove ? styles["hover-move"] : ''}
              ${hoveredRegularMove && !hoveredRegularMove.isCapture && hoveredRegularMove.isFirstMoveOnly && !hoveredRegularMove.isCustomMove ? styles["hover-move-first-only"] : ''}
              ${hoveredRegularMove && !hoveredRegularMove.isCapture && hoveredRegularMove.isCustomMove ? styles["hover-move-custom"] : ''}
              ${hoveredRegularMove && hoveredRegularMove.isCapture && !hoveredRegularMove.isFirstMoveOnly && !hoveredRegularMove.isCustomAttack ? styles["hover-capture"] : ''}
              ${hoveredRegularMove && hoveredRegularMove.isCapture && hoveredRegularMove.isFirstMoveOnly && !hoveredRegularMove.isCustomAttack ? styles["hover-capture-first-only"] : ''}
              ${hoveredRegularMove && hoveredRegularMove.isCapture && hoveredRegularMove.isCustomAttack ? styles["hover-capture-custom"] : ''}
              ${isRangedHover ? styles["hover-ranged"] : ''}
              ${attackRadiusSplashSquares.has(`${gameX},${gameY}`) ? styles["hover-attack-radius"] : ''}
              ${isRangedDragTarget || isRangedSelectedTarget ? styles["ranged-drag-target"] : ''}
              ${isRangedSelectedSource ? styles["selected"] : ''}
              ${isViaForDcMove ? styles["dc-via-move"] : ''}
              ${isViaForDcCapture ? styles["dc-via-capture"] : ''}
              ${isHoverViaForDcMove ? styles["hover-dc-via-move"] : ''}
              ${isHoverViaForDcCapture ? styles["hover-dc-via-capture"] : ''}
              ${isLastMoveFrom && !isFogged ? (isLight ? styles["last-move-from-light"] : styles["last-move-from-dark"]) : ''}
              ${isLastMoveTo && !isFogged ? styles["last-move-to"] : ''}
              ${isFadingLastMoveFrom && !isFogged ? `${isLight ? styles["last-move-from-light"] : styles["last-move-from-dark"]} ${styles["last-move-fading"]}` : ''}
              ${isFadingLastMoveTo && !isFogged ? `${styles["last-move-to"]} ${styles["last-move-fading"]}` : ''}
              ${canMove ? styles["can-move"] : ''}
              ${isInCheck ? styles["in-check"] : ''}
              ${isPremoveFrom || isPremoveTo ? styles["premove"] : ''}
              ${isHeldMoveFrom || isHeldMoveTo ? styles["premove"] : ''}
              ${specialSquareType === 'promotion' ? styles["promotion-square"] : ''}
              ${specialSquareType === 'range' ? styles["range-square"] : ''}
              ${specialSquareType === 'control' ? styles["control-square"] : ''}
              ${specialSquareType === 'special' ? styles["special-square"] : ''}
              ${isRestrictionZone && !hideRestrictionZones && specialSquareType !== 'special' ? styles["restriction-zone-square"] : ''}
              ${isPlacementRestricted && !hidePlacementRestrictions ? styles["placement-restricted-square"] : ''}
              ${isImpassable ? styles["impassable-square"] : ''}
              ${dotType ? styles["has-move-dot"] : ''}
              ${activeIsRanged ? styles["has-ranged-dot"] : ''}
              ${isRepositionable ? styles["reposition-eligible"] : ''}
            `}
            onClick={() => handleSquareClick(gameX, gameY)}
            onDragOver={(e) => handleDragOver(e, gameX, gameY)}
            onDrop={(e) => handleDrop(e, gameX, gameY)}
            onMouseDown={(e) => handleSquareMouseDown(e, gameX, gameY)}
            onContextMenu={(e) => handleSquareContextMenu(e, gameX, gameY)}
            style={{
              backgroundColor: intersectionBoard
                ? '#e3b869'
                : (isLight
                  ? (currentUser?.light_square_color || '#cad5e8')
                  : (currentUser?.dark_square_color || '#08234d')),
              position: 'relative',
              ...(dotType ? { '--move-dot-bg': MOVE_DOT_BACKGROUNDS[dotType] } : {}),
              ...(isAnchor && piece && ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) ? { zIndex: 10 } : {})
            }}
          >
            {/* Go-style intersection grid: draw line segments through the cell centre
                so pieces appear to sit on the crossings. Segments stop at edge cells. */}
            {intersectionBoard && (() => {
              const bw = gameState?.gameType?.board_width || 8;
              const bh = gameState?.gameType?.board_height || 8;
              const lineColor = 'rgba(60,40,20,0.85)';
              return (
                <>
                  <div style={{
                    position: 'absolute', top: '50%', height: '1.5px', background: lineColor,
                    left: gameX === 0 ? '50%' : 0, right: gameX === bw - 1 ? '50%' : 0,
                    transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 0,
                  }} />
                  <div style={{
                    position: 'absolute', left: '50%', width: '1.5px', background: lineColor,
                    top: gameY === 0 ? '50%' : 0, bottom: gameY === bh - 1 ? '50%' : 0,
                    transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 0,
                  }} />
                </>
              );
            })()}
            {/* Ranged move indicator — single span, no container, avoids DOM churn */}
            {activeIsRanged && <span className={styles["ranged-icon"]}>{`\uD83D\uDCA5`}</span>}
            {/* Drag hover feedback: outline the square currently under the cursor. */}
            {draggedPiece && dragOverSquare && dragOverSquare.x === gameX && dragOverSquare.y === gameY && (
              <span style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 0 3px rgba(255,255,255,0.75)', borderRadius: 2, pointerEvents: 'none', zIndex: 5 }} />
            )}
            {/* Reactive veto: highlight the opponent's just-played move (from → to). */}
            {vetoRevealMove?.from && vetoRevealMove.from.x === gameX && vetoRevealMove.from.y === gameY && (
              <span style={{ position: 'absolute', inset: 0, background: 'rgba(80,140,255,0.22)', pointerEvents: 'none', zIndex: 4 }} />
            )}
            {vetoRevealMove?.to && vetoRevealMove.to.x === gameX && vetoRevealMove.to.y === gameY && (
              <span style={{ position: 'absolute', inset: 0, background: 'rgba(80,140,255,0.30)', boxShadow: 'inset 0 0 0 3px rgba(80,140,255,0.9)', pointerEvents: 'none', zIndex: 4 }} />
            )}
            {/* Veto overlays: candidate ban target (vetoer), selected ban(s)
                (vetoer), and server-confirmed ban(s) (mover), with a stacked
                quantity badge when more than one veto sits on the square. */}
            {vetoCandidateSquares.has(`${gameX},${gameY}`) && !vetoSelectedCounts.get(`${gameX},${gameY}`) && (
              <span style={{ position: 'absolute', inset: '18%', borderRadius: '50%', border: '2px dashed rgba(255,90,90,0.85)', pointerEvents: 'none', zIndex: 6 }} />
            )}
            {vetoSelectedCounts.get(`${gameX},${gameY}`) > 0 && (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: vetoMarkColor, textShadow: vetoMarkShadow, fontWeight: 900, fontSize: '1.5em', pointerEvents: 'none', zIndex: 7 }}>
                X
                {vetoSelectedCounts.get(`${gameX},${gameY}`) > 1 && (
                  <span style={{ position: 'absolute', top: '4%', right: '8%', fontSize: '0.42em', background: vetoMarkColor, color: '#fff', borderRadius: '999px', minWidth: '1.4em', height: '1.4em', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{vetoSelectedCounts.get(`${gameX},${gameY}`)}</span>
                )}
                {vetoSelectedMoves.get(`${gameX},${gameY}`)?.length > 0 && (
                  <span className={styles["veto-move-tooltip"]}>
                    {vetoSelectedMoves.get(`${gameX},${gameY}`).map((lbl, i) => (
                      <span key={i} className={styles["veto-move-tooltip-line"]}>{lbl}</span>
                    ))}
                  </span>
                )}
              </span>
            )}
            {vetoBannedCounts.get(`${gameX},${gameY}`) > 0 && (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: vetoMarkColor, textShadow: vetoMarkShadow, fontWeight: 900, fontSize: '1.3em', pointerEvents: 'none', zIndex: 7, background: 'rgba(0,0,0,0.2)' }}>
                X
                {vetoBannedCounts.get(`${gameX},${gameY}`) > 1 && (
                  <span style={{ position: 'absolute', top: '4%', right: '8%', fontSize: '0.48em', background: vetoMarkColor, color: '#fff', borderRadius: '999px', minWidth: '1.4em', height: '1.4em', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{vetoBannedCounts.get(`${gameX},${gameY}`)}</span>
                )}
                {vetoBannedMoves.get(`${gameX},${gameY}`)?.length > 0 && (
                  <span className={styles["veto-move-tooltip"]}>
                    {vetoBannedMoves.get(`${gameX},${gameY}`).map((lbl, i) => (
                      <span key={i} className={styles["veto-move-tooltip-line"]}>{lbl}</span>
                    ))}
                  </span>
                )}
              </span>
            )}
            {vetoPreviewSquares && vetoPreviewSquares.get(`${gameX},${gameY}`) > 0 && !vetoBannedCounts.get(`${gameX},${gameY}`) && (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: vetoMarkColor, textShadow: vetoMarkShadow, opacity: 0.72, fontWeight: 900, fontSize: '1.3em', pointerEvents: 'none', zIndex: 7 }}>
                X
                {vetoPreviewSquares.get(`${gameX},${gameY}`) > 1 && (
                  <span style={{ position: 'absolute', top: '4%', right: '8%', fontSize: '0.48em', background: vetoMarkColor, color: '#fff', borderRadius: '999px', minWidth: '1.4em', height: '1.4em', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{vetoPreviewSquares.get(`${gameX},${gameY}`)}</span>
                )}
                {vetoPreviewMoves && vetoPreviewMoves.get(`${gameX},${gameY}`)?.length > 0 && (
                  <span className={styles["veto-move-tooltip"]}>
                    {vetoPreviewMoves.get(`${gameX},${gameY}`).map((lbl, i) => (
                      <span key={i} className={styles["veto-move-tooltip-line"]}>{lbl}</span>
                    ))}
                  </span>
                )}
              </span>
            )}
            {/* Castle-alternative indicator: extra dot showing this square also
                permits castling (in addition to the regular move shown via the
                main move-dot). The charging/armed overlays appear while the
                user holds the mouse button on this square. */}
            {castleAltMove && (
              <span className={`${styles["castle-alt-dot"]}${isCastleArmed ? ` ${styles["castle-armed"]}` : ''}`} />
            )}
            {isCastleCharging && (
              <span className={styles["castle-charging-ring"]} />
            )}
            {/* Directional arrow on last-move "from" square */}
            {arrowAngleDeg !== null && !hideMoveArrow && !isFogged && (
              <svg
                className={`${styles["last-move-arrow"]}${isFadingLastMoveFrom ? ` ${styles["last-move-arrow-fading"]}` : ''}`}
                style={{ transform: `rotate(${arrowAngleDeg}deg)` }}
                viewBox="0 0 30 12"
                xmlns="http://www.w3.org/2000/svg"
              >
                <line x1="2" y1="6" x2="22" y2="6" stroke={isLight ? 'rgba(120,100,60,0.75)' : 'rgba(200,180,120,0.7)'} strokeWidth="3.5" strokeLinecap="round" />
                <polygon points="22,1.5 30,6 22,10.5" fill={isLight ? 'rgba(120,100,60,0.75)' : 'rgba(200,180,120,0.7)'} />
              </svg>
            )}
            {/* Special square indicator (letter overlay) */}
            {!isFogged && specialSquareType && (
              <div className={`${styles["special-square-indicator"]} ${styles[specialSquareType]}`}>
                {specialSquareType === 'promotion' && 'P'}
                {specialSquareType === 'range' && 'R'}
                {specialSquareType === 'control' && 'C'}
                {specialSquareType === 'special' && (() => {
                  const cfg = specialSquares.special[`${gameY},${gameX}`] || {};
                  const parts = [];
                  if (cfg.asRange) parts.push('R');
                  if (cfg.asPromotion) parts.push('P');
                  if (cfg.asControl) parts.push('C');
                  if (cfg.impassable) parts.push('I');
                  const label = parts.length > 0 ? parts.join('') : 'X';
                  const pts = cfg.controlPoints;
                  return (
                    <>
                      {label}
                      {pts > 0 && <span style={{ fontSize: '0.6em', display: 'block', lineHeight: 1 }}>{pts}pt</span>}
                    </>
                  );
                })()}
              </div>
            )}
            {/* Points-square background tint: always visible when square awards control points and game has points condition */}
            {squareControlPoints > 0 && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 2,
                backgroundColor: 'rgba(100, 180, 255, 0.18)',
                pointerEvents: 'none'
              }} />
            )}
            {isAnchor && !isFogged && (() => {
              const pieceTeam = piece.player_id || piece.team;
              const isOwnPiece = currentPlayer && (pieceTeam === currentPlayer.position || piece.is_neutral);
              const canDragForMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && isOwnPiece;
              const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece && !(gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns);
              // Veto phase: the vetoer may drag the mover's (opponent's) piece to veto a move.
              const _vetoOn = gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns;
              const _vStyle = gameState?.gameType?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
              const _iAmVetoer = _vetoOn && (gameState?.status === 'active' || gameState?.status === 'ready') && currentPlayer && currentPlayer.position !== gameState.currentTurn;
              const _canDragForVeto = _iAmVetoer && !vetoDoneThisTurn && (_vStyle === 'preemptive' || !!vetoWindow)
                && !isOwnPiece && (pieceTeam === gameState.currentTurn || piece.is_neutral);
              const _repoKeyOnly = !!gameState?.gameType?.reposition_key_pieces_only;
              const _canReposition = isMyRepositionTurn && isOwnPiece &&
                (!_repoKeyOnly || piece.ends_game_on_capture || piece.ends_game_on_checkmate);
              
              const pw = piece.piece_width || 1;
              const ph = piece.piece_height || 1;
              
              // Get the image URL - always process through helper to ensure ASSET_URL prefix
              let imageUrl = null;
              if (piece.image || piece.image_url) {
                const rawPath = piece.image || piece.image_url;
                // If it's already a full URL, use it; otherwise add ASSET_URL prefix
                imageUrl = rawPath.startsWith('http') ? rawPath : `${ASSET_URL}${rawPath}`;
              } else if (piece.image_location) {
                imageUrl = getFirstImageUrl(piece.image_location);
              }
              
              // Debug logging
              if (!imageUrl) {
                console.log('No image URL for piece:', {
                  piece_id: piece.piece_id,
                  piece_name: piece.piece_name,
                  image: piece.image,
                  image_url: piece.image_url,
                  image_location: piece.image_location
                });
              }
              
              // Multi-tile pieces span across grid cells
              const isMultiTile = pw > 1 || ph > 1;
              const isNonSquareMultiTile = isMultiTile && pw !== ph;
              const multiTileStyle = isMultiTile ? {
                width: `${pw * 100}%`,
                height: `${ph * 100}%`,
                zIndex: 5,
                position: 'absolute',
                overflow: 'hidden',
                // When the board is flipped, the anchor (top-left in game coords) is displayed
                // at the bottom-right of the piece's visual area, so we need to grow up-left
                ...(shouldFlipBoard
                  ? { bottom: 0, right: 0 }
                  : { top: 0, left: 0 })
              } : {};
              
              const isTouchDragging = touchDragPiece && touchDragPiece.x === piece.x && touchDragPiece.y === piece.y;
              
              return (
                <div 
                  className={styles.piece}
                  style={{
                    ...multiTileStyle,
                    ...(isTouchDragging ? { opacity: 0 } : {})
                  }}
                  draggable={canDragForMove || canDragForPremove || _canReposition || _canDragForVeto}
                  onDragStart={(e) => handleDragStart(e, piece)}
                  onDragEnd={handleDragEnd}
                  onTouchStart={(e) => handleTouchStart(e, piece)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onMouseEnter={() => (showHelpers || showMovableIndicators) && handlePieceHover(piece)}
                  onMouseLeave={() => (showHelpers || showMovableIndicators) && handlePieceHover(null)}
                >
                {boardAnimationsEnabled && isMultiTile && (
                  <>
                    <div className={styles["multi-tile-smoke"]} />
                    <div className={styles["multi-tile-electric"]} />
                  </>
                )}
                {imageUrl ? (
                  isNonSquareMultiTile ? (
                    <div
                      ref={(el) => applySvgStretchBackground(el, imageUrl)}
                      style={{
                        width: '100%',
                        height: '100%',
                        ...(pieceShadowEnabled ? { filter: 'drop-shadow(4px 5px 6px rgba(0, 0, 0, 0.65))' } : {})
                      }}
                    />
                  ) : (
                    <img 
                      src={imageUrl} 
                      alt="" 
                      draggable={false}
                      {...(pieceShadowEnabled ? { style: { filter: 'drop-shadow(4px 5px 6px rgba(0, 0, 0, 0.65))' } } : {})}
                      onError={(e) => {
                        // Try to load a matching library fallback image
                        const fallbackSrc = getFallbackPieceImage(piece.piece_name || piece.name, piece.player_id);
                        if (fallbackSrc && e.target.src !== fallbackSrc) {
                          e.target.src = fallbackSrc;
                        }
                      }}
                    />
                  )
                ) : (
                  // Fallback to unicode chess pieces
                  <span>{getPieceSymbol(piece)}</span>
                )}
                {/* HP/AD overlay - show when piece has show_hp_ad flag or HP > 1 */}
                {(piece.show_hp_ad || piece.hit_points > 1) && (
                  <div className={styles["hp-ad-overlay"]}>
                    <div className={styles["hp-bar"]}>
                      <div 
                        className={styles["hp-bar-fill"]}
                        style={{ width: `${Math.max(0, Math.min(100, ((piece.current_hp ?? piece.hit_points ?? 1) / (piece.hit_points || 1)) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Stat badges - anchored to corners via PieceBadges component */}
                <PieceBadges piece={piece} squareSize={squareSize} hidden={!showBadges} />
                {/* Fire icon for actively burning pieces */}
                {piece.burn_active_turns > 0 && (
                  <div className={styles["burn-active-icon"]} style={{ fontSize: `${Math.max(10, squareSize * 0.22)}px` }}>
                    🔥
                  </div>
                )}
              </div>
            );
            })()}
            {/* HP/AD: Floating damage numbers */}
            {damageAnimations.filter(a => a.x === gameX && a.y === gameY).map(anim => (
              <div key={anim.id} className={styles["damage-float"]} style={{ fontSize: `${Math.max(12, squareSize * 0.3)}px`, left: '35%' }}>-{anim.damage}</div>
            ))}
            {/* Points-square value label: displayed above pieces with 65% opacity */}
            {squareControlPoints > 0 && (
              <div style={{
                position: 'absolute', top: 2, right: 3, zIndex: 8,
                opacity: 0.65, pointerEvents: 'none',
                fontSize: `${Math.max(8, Math.round(squareSize * 0.22))}px`,
                fontWeight: 'bold', color: '#1a6fb5',
                textShadow: '0 0 3px rgba(255,255,255,0.9)',
                lineHeight: 1
              }}>
                {squareControlPoints}
              </div>
            )}
            {/* HP/AD: Floating regen numbers */}
            {regenAnimations.filter(a => a.x === gameX && a.y === gameY).map(anim => (
              <div key={anim.id} className={styles["regen-float"]} style={{ fontSize: `${Math.max(12, squareSize * 0.3)}px`, left: '65%' }}>+{anim.healed}</div>
            ))}
            {/* DOT/Burn: Floating burn damage numbers */}
            {burnAnimations.filter(a => a.x === gameX && a.y === gameY).map(anim => (
              <div key={anim.id} className={styles["burn-float"]} style={{ fontSize: `${Math.max(12, squareSize * 0.3)}px`, left: '50%' }}>🔥-{anim.damage}</div>
            ))}
            {/* Fog of War overlay — covers this square if not visible to the current player */}
            {isFogged && (
              <div className={styles["fog-overlay"]}>
                <span className={styles["fog-wisp"]} />
              </div>
            )}
          </div>
        );
      }
    }

    // Generate file labels (a, b, c, ... for columns)
    const fileLabels = [];
    for (let i = 0; i < boardWidth; i++) {
      const fileIndex = shouldFlipBoard ? (boardWidth - 1 - i) : i;
      fileLabels.push(
        <div key={`file-${i}`} className={styles["file-label"]}>
          {colToFile(fileIndex)}
        </div>
      );
    }

    // Generate rank labels (1, 2, 3, ... for rows)
    const rankLabels = [];
    for (let i = 0; i < boardHeight; i++) {
      const rankIndex = shouldFlipBoard ? i : (boardHeight - 1 - i);
      rankLabels.push(
        <div key={`rank-${i}`} className={styles["rank-label"]}>
          {rowToRank(rankIndex)}
        </div>
      );
    }

    return (
        <div className={`${styles["board-with-coords"]}${isGhostMode ? ` ${styles["ghost-mode"]}` : ''}`}>
        {showBoardNotation && (
        <div 
          className={styles["rank-labels"]}
          style={{
            gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`
          }}
        >
          {rankLabels}
        </div>
        )}
        
        {/* Board */}
        <div className={styles["board-and-files"]}>
          <div 
            ref={boardRef}
            className={styles["game-board"]}
            style={{
              gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`,
              gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`,
              position: 'relative',
              width: 'fit-content',
              maxWidth: 'none',
              aspectRatio: 'unset',
              // Set once here and inherited by every square, so indicators that
              // can't use percentages (emoji, offsets) still scale with the board.
              '--square-size': `${squareSize}px`
            }}
          >
            {squares}
            {rangedAttackSource && rangedMousePos && boardRef.current && (() => {
              const boardRect = boardRef.current.getBoundingClientRect();
              const squareWidth = boardRect.width / boardWidth;
              const squareHeight = boardRect.height / boardHeight;
              // Convert game coords to display coords (account for board flip)
              const displayX = shouldFlipBoard ? (boardWidth - 1 - rangedAttackSource.x) : rangedAttackSource.x;
              const displayY = shouldFlipBoard ? (boardHeight - 1 - rangedAttackSource.y) : rangedAttackSource.y;
              const startX = (displayX + 0.5) * squareWidth;
              const startY = (displayY + 0.5) * squareHeight;
              const endX = rangedMousePos.x - boardRect.left;
              const endY = rangedMousePos.y - boardRect.top;
              return (
                <svg
                  className={styles["ranged-arrow-overlay"]}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 100
                  }}
                >
                  <defs>
                    <marker
                      id="ranged-arrowhead-live"
                      markerWidth="10"
                      markerHeight="7"
                      refX="9"
                      refY="3.5"
                      orient="auto"
                    >
                      <polygon points="0 0, 10 3.5, 0 7" fill="#ff2222" />
                    </marker>
                  </defs>
                  <line
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke="#ff2222"
                    strokeWidth="3"
                    strokeLinecap="round"
                    markerEnd="url(#ranged-arrowhead-live)"
                    opacity="0.9"
                  />
                </svg>
              );
            })()}
            {/* Touch drag ghost piece for mobile */}
            {touchDragPiece && touchDragPos && (() => {
              const piece = touchDragPiece;
              const team = piece.player_id || piece.team || 1;
              let imageUrl = null;
              try {
                const images = JSON.parse(piece.image_location || piece.piece_images || '[]');
                if (Array.isArray(images) && images.length > 0) {
                  const idx = team === 2 && images.length > 1 ? 1 : 0;
                  const path = images[idx];
                  const ASSET_URL = process.env.REACT_APP_ASSET_URL || 'http://localhost:3001';
                  imageUrl = path.startsWith('http') ? path : `${ASSET_URL}${path}`;
                }
              } catch { /* no image */ }
              const boardRect = boardRef.current?.getBoundingClientRect();
              const cellSize = boardRect ? boardRect.width / (gameState?.gameType?.board_width || 8) : 60;
              return (
                <div style={{
                  position: 'fixed',
                  left: touchDragPos.x - cellSize / 2,
                  top: touchDragPos.y - cellSize / 2,
                  width: cellSize * (piece.piece_width || 1),
                  height: cellSize * (piece.piece_height || 1),
                  pointerEvents: 'none',
                  zIndex: 9999,
                  opacity: 0.8,
                }}>
                  {imageUrl ? (
                    <img src={imageUrl} alt="" style={{ width: '100%', height: '100%' }} draggable={false} />
                  ) : (
                    <span style={{ fontSize: cellSize * 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                      {team === 1 ? '♙' : '♟'}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
          
          {/* File labels (letters at the bottom) */}
          {showBoardNotation && (
          <div 
            className={styles["file-labels"]}
            style={{
              gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`
            }}
          >
            {fileLabels}
          </div>
          )}
        </div>
      </div>
    );
  };

  // Get piece symbol (fallback for pieces without images)
  const getPieceSymbol = (piece) => {
    // Use player_id or team to determine piece color
    const team = piece.player_id || piece.team || 1;
    return team === 1 ? '♙' : '♟';
  };

  // Loading state
  if (loading) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["loading-container"]}>
          <div className={styles["loading-spinner"]}></div>
          <p>Loading game...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/play/games" className={`${styles.btn} ${styles["btn-primary"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>
    );
  }

  // No game found
  if (!gameState) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          <h2>Game Not Found</h2>
          <p>This game doesn't exist or has been cancelled.</p>
          <Link to="/play/games" className={`${styles.btn} ${styles["btn-primary"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>
    );
  }

  // Check if user can join this game (for join button in waiting banner)
  const isHost = gameState.hostId === currentUser?.id || (socket?.id && gameState.hostId === `anon_${socket.id}`);
  const storedCorresIdForIsPlayer = getStoredAnonCorresId ? getStoredAnonCorresId(String(gameId))?.playerId : null;
  const isPlayer = !!gameState.players?.some((player) =>
    player.id === currentUser?.id ||
    (socket?.id && player.id === `anon_${socket.id}`) ||
    (storedCorresIdForIsPlayer && player.id === storedCorresIdForIsPlayer)
  );
  const isAdminOrOwner = ['admin', 'owner'].includes(currentUser?.role?.toLowerCase());
  const canSpectate = gameState.allowSpectators !== false || isPlayer || gameState.status === 'waiting' || gameState.status === 'ready' || isAdminOrOwner;
  const gameUrl = `${window.location.origin}/play/${gameId}`;

  if (!canSpectate) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          {!currentUser ? (
            <>
              <h2>Login Required</h2>
              <p>Please log in to play or spectate this game.</p>
            </>
          ) : (
            <>
              <h2>Spectating Disabled</h2>
              <p>Spectators are not allowed for this game.</p>
            </>
          )}
          <div className={styles["action-buttons"]}>
            {!currentUser && (
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={() => navigate('/login', { state: { message: "Please log in to play or spectate games where allowed." } })}
              >
                Login
              </button>
            )}
            <Link to="/play/games" className={`${styles.btn} ${styles["btn-secondary"]}`}>
              Back to Lobby
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Active, ready, waiting, or completed game - show the board
  const player1 = gameState.players?.find(p => p.position === 1);
  const player2 = gameState.players?.find(p => p.position === 2);

  // For spectators (no currentPlayer), show player1 on bottom and player2 on top
  const topPlayer = currentPlayer ? (currentPlayer.position === 1 ? player2 : player1) : player2;
  const bottomPlayer = currentPlayer ? currentPlayer : player1;

  return (
    <div className={styles["live-game-container"]}>
      <div className={styles["game-header"]}>
        <div className={styles["game-title"]}>
          <h1>
            {gameState.gameTypeId ? (
              <Link to={`/games/${gameState.gameTypeId}`} className={styles["game-type-link"]}>
                {gameState.gameType?.game_name || 'Game'}
              </Link>
            ) : (
              gameState.gameType?.game_name || 'Game'
            )}
          </h1>
          <div className={`${styles["game-status"]} ${styles[gameState.status]}`}>
            {gameState.status === 'active' ? 'In Progress' : 
             gameState.status === 'completed' ? 'Game Over' : 
             gameState.status === 'ready' ? (
               gameState.botPlayer ? 'vs Computer'
                 : (gameState.gameType?.simultaneous_turns ? 'Waiting for Ready' : 'In Progress')
             ) : 
             gameState.status === 'waiting' ? 'Waiting for Opponent' : gameState.status}
          </div>
          {fairyEngineDisabled && gameState.status !== 'completed' && (
            <div style={{
              marginTop: 6,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(255, 165, 0, 0.18)',
              border: '1px solid rgba(255, 165, 0, 0.55)',
              color: '#ffb84d',
              fontSize: '0.9rem',
              fontWeight: 500,
              maxWidth: 520,
            }}>
              Fairy Stockfish ran into repeated errors on this position and has been disabled for the rest of this game. The built-in bot will play out the remaining moves.
            </div>
          )}
          {gameState.status === 'completed' && gameOverData && (
            <div className={styles["game-result-line"]} style={{
              marginTop: 4,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.35)',
              fontSize: '0.95rem',
              color: gameOverData.winner != null && gameOverData.winner === (currentUser ? currentUser.id : currentPlayer?.id)
                ? '#7be38a'
                : gameOverData.winner
                  ? '#ff8a8a'
                  : '#ffd278',
              fontWeight: 600,
            }}>
              {(gameOverData.winner != null && gameOverData.winner === (currentUser ? currentUser.id : currentPlayer?.id)
                ? 'You won'
                : gameOverData.winner
                  ? `${gameOverData.winnerUsername || 'Opponent'} won`
                  : 'Draw')}
              {gameOverData.reason ? ` — ${formatGameOverReasonShort(gameOverData.reason)}` : ''}
            </div>
          )}
          {/* Live score display for points win condition */}
          {(playerScores || (gameState.gameType?.points_to_win != null)) && (
            <div style={{ marginTop: 6, display: 'flex', gap: '10px', fontSize: '0.85rem', color: '#ccc', flexWrap: 'wrap', justifyContent: 'center' }}>
              {gameState.players?.map(p => {
                const pos = p.position;
                const score = playerScores ? (playerScores[pos] ?? 0) : 0;
                const threshold = gameState.gameType?.points_to_win;
                const isMe = p.id === currentUser?.id;
                return (
                  <span key={pos} style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.35)', fontWeight: isMe ? 700 : 400, color: isMe ? '#ffd278' : '#bbb' }}>
                    {p.username || `P${pos}`}: {score}{threshold != null ? `/${threshold}` : ''}pts
                  </span>
                );
              })}
            </div>
          )}
        </div>
        
        {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
          <div className={styles["header-turn-indicator"]}>
            {gameState.gameType?.simultaneous_turns && gameState.status === 'ready' ? (
              <>
                {simulReadyPlayerIds.includes(currentUser?.id) ? (
                  <span className={styles["waiting-turn"]}>
                    Ready ✓ — waiting for opponent...
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => simulReadyToStart(gameState.gameId || gameState.id)}
                    style={{
                      background: 'linear-gradient(180deg, #4caf50, #2e7d32)',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 18px',
                      borderRadius: 6,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                    }}
                  >
                    I'm Ready
                  </button>
                )}
                {simulReadyPlayerIds.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: '0.85em', opacity: 0.85 }}>
                    Ready: {simulReadyPlayerIds.length}/{gameState.players?.length || 2}
                  </span>
                )}
              </>
            ) : gameState.gameType?.simultaneous_turns ? (
              <>
                {!simulSubmittedThisRound ? (
                  <span className={styles["your-turn"]}>
                    {stagedSimulMove ? 'Move staged — review then Submit' : `Pick your move${simulOpponentSubmitted ? ' — opponent has submitted!' : ''}`}
                  </span>
                ) : (
                  <span className={styles["waiting-turn"]}>
                    Submitted — waiting for opponent...
                  </span>
                )}
                {/* Stage-mode: explicit Submit / Clear buttons */}
                {gameState.gameType?.simul_turns_submit_mode === 'stage' && stagedSimulMove && !simulSubmittedThisRound && (
                  <>
                    <button
                      type="button"
                      onClick={submitStagedSimulMove}
                      style={{
                        marginLeft: 8,
                        background: 'linear-gradient(180deg, #4caf50, #2e7d32)',
                        color: '#fff',
                        border: 'none',
                        padding: '6px 14px',
                        borderRadius: 5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                      }}
                    >
                      {turnConfirmEnabled && gameState.isCorrespondence && !gameState.timeControl
                        ? 'Confirm & Submit'
                        : 'Submit'}
                    </button>
                    <button
                      type="button"
                      onClick={clearStagedSimulMove}
                      style={{
                        marginLeft: 6,
                        background: 'transparent',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.45)',
                        padding: '6px 12px',
                        borderRadius: 5,
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                      }}
                    >
                      Clear
                    </button>
                  </>
                )}
                {gameState.gameType?.simul_turns_draw_after_cancellations > 0 && (
                  <span style={{ marginLeft: 8, fontSize: '0.85em', opacity: 0.85 }}>
                    Cancellations: {simulCancellationCount}/{gameState.gameType.simul_turns_draw_after_cancellations}
                  </span>
                )}
              </>
            ) : gameState?.repositionPhase?.active ? (
              <>
                {isMyRepositionTurn ? (
                  <>
                    <span className={styles["your-turn"]}>
                      Reposition Phase &mdash; drag a piece to a new square
                      {' '}({currentPlayer?.position === 1 ? gameState.repositionPhase.p1Remaining : gameState.repositionPhase.p2Remaining} remaining)
                    </span>
                    <button
                      onClick={() => submitReposition(parseInt(gameId), { skip: true })}
                      style={{
                        marginLeft: 10,
                        background: 'transparent',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.45)',
                        padding: '4px 10px',
                        borderRadius: 5,
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      Skip remaining
                    </button>
                  </>
                ) : (
                  <span className={styles["waiting-turn"]}>
                    Reposition Phase &mdash; waiting for opponent to reposition
                    {' '}({gameState.repositionPhase.currentTurn === 1
                      ? gameState.repositionPhase.p1Remaining
                      : gameState.repositionPhase.p2Remaining} remaining)
                  </span>
                )}
              </>
            ) : vetoPhaseMessage ? (
              <>
                <span className={styles["veto-phase-msg"]}>{vetoPhaseMessage}</span>
                {inCheck && currentPlayer.position === gameState.currentTurn && (
                  <span className={styles["check-warning"]}>⚠️ You are in CHECK!</span>
                )}
              </>
            ) : isMyTurn ? (
              <>
                <span className={styles["your-turn"]}>Your turn!</span>
                {inCheck && currentPlayer.position === gameState.currentTurn && (
                  <span className={styles["check-warning"]}>⚠️ You are in CHECK!</span>
                )}
              </>
            ) : (
              <>
                <span className={styles["waiting-turn"]}>
                  {(botThinking || (gameState.botPlayer && gameState.currentTurn === gameState.botPlayer.position))
                    ? (isFairyClientBot && fairyStockfish.searchInfo?.depth
                        ? `Computer is thinking... (depth ${fairyStockfish.searchInfo.depth})`
                        : "Computer is thinking...")
                    : "Waiting for opponent..."}
                </span>
                {inCheck && currentPlayer.position !== gameState.currentTurn && (
                  <span className={styles["check-info"]}>Opponent is in check</span>
                )}
              </>
            )}
            {captureActionPieceId != null && isMyTurn && (
              <span className={styles["move-error"]} style={{ background: 'rgba(80, 220, 120, 0.18)', color: '#7fffb0', display: 'flex', alignItems: 'center', gap: 8 }}>
                {captureActionData?.isRanged
                  ? `Ranged capture action available! Fire again with the same piece, or skip.`
                  : `Capture action available! Move the highlighted piece to capture an enemy, or skip.`}
                {captureActionData?.actionsTotal !== -1 && captureActionData?.actionsUsed != null && (
                  <span style={{ opacity: 0.7, fontSize: '0.85em' }}>({captureActionData.actionsUsed}/{captureActionData.actionsTotal})</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (captureActionData?.isRanged) {
                      skipRangedCaptureAction(gameId);
                    } else {
                      skipCaptureAction(gameId);
                    }
                  }}
                  style={{ marginLeft: 4, padding: '2px 10px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4, color: 'inherit', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9em' }}
                >Skip</button>
              </span>
            )}
            {stalemateNotice && (
              <span className={styles["move-error"]} style={{ background: 'rgba(255, 193, 7, 0.18)', color: '#ffc107' }}>
                ⚠️ {stalemateNotice}
                <button
                  type="button"
                  onClick={() => setStalemateNotice(null)}
                  style={{ marginLeft: 8, background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 'bold' }}
                  aria-label="Dismiss notice"
                >×</button>
              </span>
            )}
            {rerollNotice && (
              <span className={styles["move-error"]} style={{ background: 'rgba(80, 160, 255, 0.18)', color: '#9bd0ff' }}>
                🎲 {rerollNotice}
                <button
                  type="button"
                  onClick={() => setRerollNotice(null)}
                  style={{ marginLeft: 8, background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 'bold' }}
                  aria-label="Dismiss notice"
                >×</button>
              </span>
            )}
            {simulRoundNotice && (
              <span className={styles["move-error"]} style={{ background: 'rgba(255, 152, 0, 0.18)', color: '#ffb74d' }}>
                ⚡ {simulRoundNotice}
                <button
                  type="button"
                  onClick={() => setSimulRoundNotice(null)}
                  style={{ marginLeft: 8, background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 'bold' }}
                  aria-label="Dismiss notice"
                >×</button>
              </span>
            )}
            {(gameState.illegalMoveLimit > 0) && (
              <div className={styles["illegal-move-counter-inline"]}>
                <span className={styles["illegal-move-counter-label"]}>{gameState.illegalMoveLabel || 'Illegal moves'}:</span>
                <span className={`${styles["illegal-move-counter-player"]} ${styles["player-white"]}`}>{player1?.username || 'P1'}</span>
                <span className={`${styles["illegal-move-counter-value"]}${
                  (illegalMoveCounts[1] || 0) >= Math.max(1, gameState.illegalMoveLimit - 1) ? ` ${styles["near-limit"]}` : ''
                }`}>{illegalMoveCounts[1] || 0}</span>
                <span className={styles["illegal-move-counter-sep"]}>/</span>
                <span className={styles["illegal-move-counter-limit"]}>{gameState.illegalMoveLimit}</span>
                <span className={styles["illegal-move-counter-divider"]}>·</span>
                <span className={`${styles["illegal-move-counter-player"]} ${styles["player-black"]}`}>{player2?.username || 'P2'}</span>
                <span className={`${styles["illegal-move-counter-value"]}${
                  (illegalMoveCounts[2] || 0) >= Math.max(1, gameState.illegalMoveLimit - 1) ? ` ${styles["near-limit"]}` : ''
                }`}>{illegalMoveCounts[2] || 0}</span>
                <span className={styles["illegal-move-counter-sep"]}>/</span>
                <span className={styles["illegal-move-counter-limit"]}>{gameState.illegalMoveLimit}</span>
              </div>
            )}
          </div>
        )}
        
        {/* Back to Lobby is only useful while the game is still short a player;
            once both have joined it is just a way to lose your place. */}
        {(gameState?.players?.length || 0) < 2 && (
          <div className={styles["header-actions"]}>
            <Link to="/play/games" className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}>
              Back to Lobby
            </Link>
          </div>
        )}
      </div>

      {/* Disconnect-forfeit banner — placed at the top so it's always visible */}
      {disconnectInfo && !showGameOver && (() => {
        const remainingMs = disconnectInfo.paused
          ? disconnectInfo.remainingMs
          : Math.max(0, disconnectInfo.expiresAt - disconnectNow);
        const remainingSecs = Math.ceil(remainingMs / 1000);
        return (
          <div
            style={{
              background: '#b91c1c',
              color: '#fff',
              padding: '10px 14px',
              borderRadius: 6,
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              fontWeight: 600
            }}
          >
            <span>
              {disconnectInfo.username} disconnected.{' '}
              {disconnectInfo.paused
                ? <>Timer paused &mdash; <strong>{remainingSecs}s</strong> remaining.</>
                : <>You win in <strong>{remainingSecs}s</strong>.</>
              }
            </span>
            {!showGameOver && (
              <div style={{ display: 'flex', gap: 8 }}>
                {disconnectInfo.paused ? (
                  <button
                    type="button"
                    onClick={() => resumeDisconnectTimer && resumeDisconnectTimer(gameId)}
                    style={{ background: '#fff', color: '#b91c1c', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => pauseDisconnectTimer && pauseDisconnectTimer(gameId)}
                    style={{ background: '#fff', color: '#b91c1c', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
                  >
                    Pause
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className={styles["game-layout"]}>
        {/* Top Clock Row - Only visible on small screens */}

        {/* Middle Row: Clocks | Board | Move History */}
        {/* Banners above the grid, not inside the board column: sitting in
            the column they pushed the board down while the sidebar stayed
            put, so the two stopped lining up at the top. */}
        <div className={styles["layout-row-banners"]}>
          {/* Waiting Banner */}
          {gameState.status === 'waiting' && (
            <div className={styles["waiting-banner"]}>
              <div className={styles["waiting-content"]}>
                {isHost ? (
                  <>
                    <div className={styles["waiting-spinner-small"]}></div>
                    <span>Waiting for opponent to join...</span>
                    {gameState.isAnonymous && gameState.inviteCode && (
                      <div style={{ margin: '8px 0', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Share this invite code:</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 700, letterSpacing: '4px', color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                          {gameState.inviteCode}
                        </div>
                      </div>
                    )}
                    <div className={styles["share-link-inline"]}>
                      <input 
                        type="text" 
                        value={gameUrl} 
                        readOnly 
                        onClick={(e) => e.target.select()}
                      />
                      <button 
                        className={`${styles.btn} ${styles["btn-small"]}`}
                        onClick={() => {
                          if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(gameUrl).catch(() => {});
                          } else {
                            // Fallback for Safari <13.1 and other browsers without Clipboard API
                            const el = document.createElement('textarea');
                            el.value = gameUrl;
                            el.style.position = 'fixed';
                            el.style.opacity = '0';
                            document.body.appendChild(el);
                            el.select();
                            try { document.execCommand('copy'); } catch (_) {}
                            document.body.removeChild(el);
                          }
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <button 
                      className={`${styles.btn} ${styles["btn-danger"]} ${styles["btn-small"]}`}
                      onClick={() => {
                        cancelGame(parseInt(gameId));
                        navigate('/play/games');
                      }}
                    >
                      Cancel Game
                    </button>
                  </>
                ) : canJoin ? (
                  <>
                    <span><strong>{gameState.hostUsername || 'A player'}</strong> is hosting this game</span>
                    <button 
                      className={`${styles.btn} ${styles["btn-primary"]}`}
                      onClick={handleJoinGame}
                    >
                      {currentUser ? 'Join Game' : 'Join as Guest'}
                    </button>
                  </>
                ) : !currentUser ? (
                  <>
                    <span><strong>{gameState.hostUsername || 'A player'}</strong> is hosting this game</span>
                    <button
                      className={`${styles.btn} ${styles["btn-primary"]}`}
                      onClick={() => navigate('/login', { state: { message: "Please log in to join this game." } })}
                    >
                      Login to Join
                    </button>
                  </>
                ) : (
                  <span>Waiting for another player to join...</span>
                )}
              </div>
              <p className={styles["preview-hint"]}>Click on pieces to preview their moves</p>
            </div>
          )}

          {/* Draw Offer Notification */}
          {pendingDrawOffer && (
            <div className={styles["draw-offer-notification"]}>
              <span>{pendingDrawOffer.fromUsername} offers a draw</span>
              <div className={styles["draw-offer-buttons"]}>
                <button 
                  className={`${styles.btn} ${styles["btn-success"]}`}
                  onClick={handleAcceptDraw}
                >
                  Accept
                </button>
                <button 
                  className={`${styles.btn} ${styles["btn-danger"]}`}
                  onClick={handleDeclineDraw}
                >
                  Decline
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles["layout-row-middle"]}>
          {/* Sidebar: move history, options, chat and spectators. This used to
              be a third column on the right, with the clocks on the left; the
              clocks now sit with the board, so this takes the (narrower) left
              column and the board gets everything to its right. */}
          <div className={styles["move-history-column"]}>
            <div className={styles["move-history"]}>
              <h3>Move History</h3>
              {/* Hide move history during active fog games — move notation reveals piece positions */}
              {gameState.fogOfWarEnabled && gameState.status === 'active' ? (
                <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '16px 12px', fontSize: '0.85rem', lineHeight: '1.5' }}>
                  Move history is hidden while a fog of war game is in progress.
                </div>
              ) : (
              <>
              <div className={styles["moves-list"]}>
                <div className={styles["moves-header"]}>
                  <span className={styles["move-number-header"]}>#</span>
                  <span className={styles["move-col-header"]}>P1</span>
                  <span className={styles["move-col-header"]}>P2</span>
                </div>
                {(() => {
                  const moves = gameState.moveHistory || [];
                  const bh = gameState?.gameType?.board_height || 8;
                  const rows = [];
                  for (let i = 0; i < moves.length; i += 2) {
                    const a = moves[i];
                    const b = moves[i + 1];
                    const p1Move = a?.position === 1 ? a : (b?.position === 1 ? b : a);
                    const p2Move = a?.position === 2 ? a : (b?.position === 2 ? b : (b && b !== p1Move ? b : null));
                    rows.push(
                      <div key={i} className={styles["move-row"]}>
                        <span className={styles["move-number"]}>{Math.floor(i / 2) + 1}.</span>
                        <span 
                          className={`${styles["move-white"]}${ghostMoveIndex === i ? ` ${styles["active-move"]}` : ''}`}
                          onClick={() => initialPiecesRef.current && setGhostMoveIndex(ghostMoveIndex === i ? null : i)}
                          style={{ cursor: initialPiecesRef.current ? 'pointer' : 'default' }}
                        >{formatMoveNotation(p1Move, true, bh)}</span>
                        <span 
                          className={`${styles["move-black"]}${ghostMoveIndex === i + 1 ? ` ${styles["active-move"]}` : ''}`}
                          onClick={() => p2Move && initialPiecesRef.current && setGhostMoveIndex(ghostMoveIndex === i + 1 ? null : i + 1)}
                          style={{ cursor: p2Move && initialPiecesRef.current ? 'pointer' : 'default' }}
                        >{p2Move ? formatMoveNotation(p2Move, true, bh) : ''}</span>
                      </div>
                    );
                  }
                  return rows;
                })()}
                {(!gameState.moveHistory || gameState.moveHistory.length === 0) && (
                  <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '12px' }}>
                    No moves yet
                  </div>
                )}
              </div>
              {initialPiecesRef.current && gameState.moveHistory && gameState.moveHistory.length > 0 && (
                <>
                  {ghostMoveIndex !== null && (
                    <div className={styles["ghost-banner"]}>
                      <span>{ghostMoveIndex < 0 ? 'Starting position' : `Reviewing move ${ghostMoveIndex + 1} of ${gameState.moveHistory.length}`}</span>
                      <button onClick={() => setGhostMoveIndex(null)}>&#x2715; Exit Review</button>
                    </div>
                  )}
                  <div className={styles["move-nav-arrows"]}>
                  <button onClick={() => setGhostMoveIndex(-1)} disabled={ghostMoveIndex === -1} title="Starting position">⏮</button>
                  <button onClick={() => setGhostMoveIndex(prev => prev === null ? (gameState.moveHistory.length - 1) : Math.max(-1, prev - 1))} disabled={ghostMoveIndex === -1} title="Previous move">◀</button>
                  <button onClick={() => setGhostMoveIndex(prev => prev === null ? 0 : (prev >= gameState.moveHistory.length - 1 ? null : prev + 1))} disabled={ghostMoveIndex === null || ghostMoveIndex >= gameState.moveHistory.length - 1} title="Next move">▶</button>
                  <button onClick={() => setGhostMoveIndex(null)} disabled={ghostMoveIndex === null} title="Live board">⏭</button>
                </div>
                </>
              )}
              </>)}
            </div>

            {/* In-Game Chat */}
            <GameChat gameId={gameId} currentUser={currentUser} gameState={gameState} isPlayer={isPlayer} onUpdatePreference={updateUserPreference} />

            {/* Game Options */}
            <div className={styles["game-options"]}>
              <div className={styles["options-header"]}>
                <h3>Options</h3>
                <div className={styles["options-header-buttons"]}>
                  <button
                    className={`${styles["sound-toggle-btn"]} ${soundEnabled ? styles["sound-on"] : styles["sound-off"]}`}
                    onClick={() => {
                      const enabled = !soundEnabled;
                      setSoundEnabled(enabled);
                      soundEnabledRef.current = enabled;
                      persistSoundPreference(enabled);
                    }}
                    title={soundEnabled ? 'Mute sound effects' : 'Unmute sound effects'}
                  >
                    {soundEnabled ? '🔊' : '🔇'}
                  </button>
                  <button
                    className={styles["options-collapse-btn"]}
                    onClick={() => setOptionsCollapsed(!optionsCollapsed)}
                    title={optionsCollapsed ? 'Show options' : 'Hide options'}
                  >
                    {optionsCollapsed ? '\u25B6' : '\u25BC'}
                  </button>
                </div>
              </div>
            {!optionsCollapsed && (<>
            <ToggleSwitch
              checked={showMovableIndicators}
              onChange={(v) => setShowMovableIndicators(v)}
              label="Show movable pieces"
            />
            {hasSpecialSquares && (
              <ToggleSwitch
                checked={showAllSpecialSquares}
                onChange={(v) => setShowAllSpecialSquares(v)}
                label="Show all special squares"
              />
            )}
            {hasRestrictionZones && (
              <ToggleSwitch
                checked={hideRestrictionZones}
                onChange={(v) => setHideRestrictionZones(v)}
                label="Hide restriction zones"
              />
            )}
            {gameState?.otherGameData?.place_pieces_action && currentPlayer && (
              <ToggleSwitch
                checked={hidePlacementRestrictions}
                onChange={(v) => setHidePlacementRestrictions(v)}
                label="Hide placement restrictions"
              />
            )}
            <ToggleSwitch
              checked={showBoardNotation}
              onChange={(v) => setShowBoardNotation(v)}
              label="Show board notation"
            />
            {gameState.pieces?.some(p => p.show_hp_ad || p.hit_points > 1 || (p.show_regen && p.hp_regen > 0) || (p.show_burn && p.burn_damage > 0)) && (
              <ToggleSwitch
                checked={showBadges}
                onChange={(v) => setShowBadges(v)}
                label="Show piece badges"
              />
            )}
            {currentUser && (
              <ToggleSwitch
                checked={currentUser.disable_game_chat === 1 || currentUser.disable_game_chat === true}
                onChange={(v) => updateUserPreference('disable_game_chat', v)}
                label="Disable chat"
              />
            )}
            {castlingInfo.length > 0 && (
              <ToggleSwitch
                checked={showCastlingInfo}
                onChange={(v) => setShowCastlingInfo(v)}
                label="Show castling info"
              />
            )}
            
            {showCastlingInfo && castlingInfo.length > 0 && (
              <div className={styles["castling-info"]}>
                <h4>Castling Pieces</h4>
                {castlingInfo.map((info, index) => (
                  <div key={index} className={styles["castling-piece-info"]}>
                    <span className={styles["piece-name"]}>
                      {info.piece.piece_name || info.piece.name}
                      <span className={styles["castle-distance"]}> (moves {info.distance} squares)</span>
                    </span>
                    <div className={styles["castling-partners"]}>
                      {info.leftPartner && (
                        <span className={styles["partner"]}>← {info.leftPartner.piece_name || info.leftPartner.name}</span>
                      )}
                      {info.rightPartner && (
                        <span className={styles["partner"]}>{info.rightPartner.piece_name || info.rightPartner.name} →</span>
                      )}
                      {!info.leftPartner && !info.rightPartner && (
                        <span className={styles["no-partner"]}>No partners assigned</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {gameState?.isCorrespondence && !gameState?.timeControl && (
              <ToggleSwitch
                checked={turnConfirmEnabled}
                onChange={(v) => {
                  setTurnConfirmEnabled(v);
                  localStorage.setItem('turnConfirmEnabled', v);
                  if (!v) {
                    // Revert any optimistic board preview before clearing the pending move
                    if (preConfirmState) {
                      setGameState(prev => ({
                        ...prev,
                        pieces: preConfirmState.pieces,
                        currentTurn: preConfirmState.currentTurn
                      }));
                    }
                    clearOptimisticMoveSnapshot();
                    setPendingMove(null);
                    setPreConfirmState(null);
                  }
                }}
                label="Confirm moves"
              />
            )}
            {gameState?.otherGameData?.place_pieces_action && currentPlayer && (
              <ToggleSwitch
                checked={placementUseLeftClick}
                onChange={(v) => setPlacementUseLeftClick(v)}
                label="Place pieces with left click (mobile)"
              />
            )}
            </>)}

            {/* Turn Confirmation — hidden in simul-stage mode since the Submit button serves this role.
                Also hidden for correspondence games — it's shown directly below the board instead. */}
            {pendingMove && !(gameState?.gameType?.simultaneous_turns && gameState?.gameType?.simul_turns_submit_mode === 'stage') && !(gameState?.isCorrespondence && !gameState?.timeControl) && (
              <div className={styles["move-confirm-section"]}>
                <span className={styles["move-confirm-label"]}>Confirm your move?</span>
                <div className={styles["move-confirm-buttons"]}>
                  <button className={`${styles.btn} ${styles["btn-confirm"]}`} onClick={confirmPendingMove}>Confirm</button>
                  <button className={`${styles.btn} ${styles["btn-cancel"]}`} onClick={cancelPendingMove}>Cancel</button>
                </div>
              </div>
            )}

            {/* Game Controls */}

            {/* Spectator List - Desktop */}
            {gameState.allowSpectators && spectators.length > 0 && (
              <div className={styles["spectator-section"]}>
                <div 
                  className={styles["spectator-header"]}
                  onClick={() => setShowSpectators(!showSpectators)}
                >
                  <span className={styles["spectator-title"]}>👁 Spectators ({spectators.length})</span>
                  <span className={`${styles["spectator-toggle"]} ${showSpectators ? styles.expanded : ''}`}>{`\u25BC`}</span>
                </div>
                {showSpectators && (
                  <div className={styles["spectator-list"]}>
                    {spectators.map((spec, i) => (
                      <span key={spec.id || i} className={styles["spectator-name"]}>{spec.username}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>

          {/* Board Column */}
          <div className={styles["board-column"]} ref={boardColRef}>
            {/* --board-px lets the clocks and the actions row size themselves to
                the board rather than the column, so the buttons spread out to the
                board's width instead of the full column width. */}
            <div
              ref={besideWrapRef}
              className={`${styles["game-board-wrapper"]}${actionsBeside ? ` ${styles["actions-beside"]}` : ''}`}
              style={{
                '--board-px': `${(boardVpHook.squareSize || 0) * (gameState?.gameType?.board_width || 8)}px`,
                '--coord-gutter': showBoardNotation ? '20px' : '0px',
                // Beside mode gives the board stack a definite width so the
                // wrapper can hug it and centre on the page. 16px of slack keeps
                // the width test inside useBoardViewport from rounding the board
                // down a square; it is capped so a board that would rather be
                // wider than the column allows still fits beside the panel.
                ...(actionsBeside ? {
                  '--beside-stack-px': `${Math.max(80, Math.min(
                    besideBoardPx + 16,
                    boardColWidth - BOARD_WRAP_PAD - BESIDE_PANEL_PX
                  ))}px`,
                  ...(besideMarginRight != null
                    ? { marginLeft: 'auto', marginRight: `${besideMarginRight}px` }
                    : {}),
                } : {}),
              }}
            >
              {/* Tall board: clocks and buttons share the empty column beside it.
                  The clocks are not capped to the board's width there, which on a
                  3-file board like kalimba chess left them unreadably narrow. */}
              {actionsBeside && (
                <div className={styles["board-side-panel"]}>
                  {renderPlayerClock(topPlayer, { isTop: true })}
                  {renderActionsPanel()}
                  {renderPlayerClock(bottomPlayer, { isTop: false })}
                </div>
              )}
              <div className={styles["board-stack"]}>
              {!actionsBeside && renderPlayerClock(topPlayer, { isTop: true })}
              <div style={boardVpHook.frameStyle}>
              {moveError && (
                <div className={boardVp.boardToast}>{moveError}</div>
              )}
              <div
                className={`${boardVp.viewport} ${boardVpHook.hideScrollbars ? boardVp.noScrollbars : ''}`}
                ref={boardVpHook.viewportRef}
                style={boardVpHook.viewportStyle}
              >
                <div style={boardVpHook.contentStyle}>
                  {renderBoard()}
                </div>
              </div>
              </div>
              {!actionsBeside && renderPlayerClock(bottomPlayer, { isTop: false })}
              {!actionsBeside && renderActionsPanel()}
              </div>
            </div>

            {/* Turn Confirmation - below board. Always visible on all screen sizes for
                correspondence games; on smaller screens for all other game types. Lives inside
                board-column so it is naturally centered under the board and capped to
                the board column's width. */}
            {pendingMove && (
              <div
                className={styles["layout-row-move-confirm"]}
                style={(gameState?.isCorrespondence && !gameState?.timeControl) ? { display: 'flex' } : undefined}
              >
                <span className={styles["move-confirm-label"]}>Confirm your move?</span>
                <div className={styles["move-confirm-buttons"]}>
                  <button className={`${styles.btn} ${styles["btn-confirm"]}`} onClick={confirmPendingMove}>Confirm</button>
                  <button className={`${styles.btn} ${styles["btn-cancel"]}`} onClick={cancelPendingMove}>Cancel</button>
                </div>
              </div>
            )}
          </div>


          {/* Running Piece Count - moved out of grid, positioned after layout-row-middle */}
      </div>

      {/* Veto Row — below the board/clock grid so it pushes the rows below it down
          without affecting the clock columns inside the grid. */}
      {!!gameState?.gameType?.veto_enabled && !gameState?.gameType?.simultaneous_turns && (
        <div className={styles["layout-row-veto"]}>
          {vetoPerGameLimit != null && vetoBank && (
            <div className={styles["veto-bank"]}>
              <span>Veto bank — {(gameState?.players?.find(pp => pp.position === 1)?.username) || 'Player 1'}: <span className={styles["veto-bank-value"]}>{vetoBank[1]}</span></span>
              <span>{(gameState?.players?.find(pp => pp.position === 2)?.username) || 'Player 2'}: <span className={styles["veto-bank-value"]}>{vetoBank[2]}</span></span>
            </div>
          )}
          {(() => {
            const gt = gameState?.gameType;
            const vetoOn = gt?.veto_enabled && !gt?.simultaneous_turns && (gameState?.status === 'active' || gameState?.status === 'ready');
            if (!vetoOn || !currentPlayer) return null;
            const iAmVetoer = currentPlayer.position !== gameState.currentTurn;
            const vStyle = gt?.veto_style === 'reactive' ? 'reactive' : 'preemptive';
            const canSelect = iAmVetoer && !vetoDoneThisTurn && (vStyle === 'preemptive' || !!vetoWindow);
            if (canSelect) {
              const perTurn = vetoMyBudget?.perTurnRemaining ?? Math.max(1, Math.min(5, Number(gt.veto_per_turn_limit) || 1));
              const perGame = vetoMyBudget?.perGameRemaining;
              const bh = gt?.board_height || 8;
              const sq = (p) => p ? `${String.fromCharCode(97 + p.x)}${bh - p.y}` : '?';
              return (
                <div className={styles["veto-panel"]}>
                  <div className={styles["veto-title"]}>Veto phase — ban your opponent's moves</div>
                  {vStyle === 'reactive' && vetoRevealMove ? (
                    <>
                      <div className={styles["veto-hint"]}>
                        Your opponent played <strong>{sq(vetoRevealMove.from)}→{sq(vetoRevealMove.to)}{vetoRevealMove.isRangedAttack ? ' (ranged)' : ''}</strong> (highlighted in blue). {(Math.max(1, Math.min(5, Number(gt.veto_per_turn_limit) || 1)) === 1)
                          ? 'Use "Veto Move" in the Actions panel to force them to play something else, or Skip Veto to let it stand.'
                          : 'Use "Veto this move" in the Actions panel to force a different move, and/or ban other potential moves, then Submit (or press Enter).'}
                      </div>
                    </>
                  ) : (
                    <div className={styles["veto-hint"]}>
                      Click an opponent piece, then a highlighted square to ban that move (or drag it there). Click again to also ban a ranged attack to the same square. Right-click a square to remove a veto.
                    </div>
                  )}
                  <div className={styles["veto-status"]}>
                    Selected: {vetoSelection.length} · Vetoes left this turn: {perTurn}
                    {perGame != null ? ` · This game: ${perGame}` : ''}
                  </div>
                  {vetoError && <div className={styles["veto-error"]}>{vetoError}</div>}
                </div>
              );
            }
            if (iAmVetoer) {
              return <div className={styles["veto-panel"]}>Veto ability is active. Wait for your opponent to submit a move, then you may veto it.</div>;
            }
            if (vetoMoveUnderReview) {
              return <div className={styles["veto-panel"]}>Your move is under veto review… <span style={{ opacity: 0.8 }}>(press Esc or click your moved piece to take it back)</span></div>;
            }
            if (vetoBanned && vetoBanned.length > 0) {
              return <div className={styles["veto-panel"]}>Your opponent vetoed {vetoBanned.length} move(s) this turn. Choose a different move.</div>;
            }
            return null;
          })()}
        </div>
      )}

      {/* Special Squares Legend Row - below board and clocks. Only render when it
          actually has content so the empty container doesn't add spacing. */}
      {hasSpecialSquares && (showAllSpecialSquares || Object.keys(specialSquares.control).length > 0) && (
        <div className={styles["layout-row-legend"]}>
          {showAllSpecialSquares && (
            <BoardLegend
              showMove={false}
              showFirstMove={false}
              showAttack={false}
              showFirstAttack={false}
              showRanged={false}
              showHopCapture={false}
              specialSquares={{
                promotion: Object.keys(specialSquares.promotion).length > 0,
                range: Object.keys(specialSquares.range).length > 0,
                control: Object.keys(specialSquares.control).length > 0,
              }}
            />
          )}
          
          {/* Control Square Progress Tracking */}
          {Object.keys(specialSquares.control).length > 0 && (
            <div className={styles["control-square-progress"]}>
              <div className={styles["control-progress-tooltip"]} title="Shows each player's progress toward winning by controlling special squares. A player must keep at least one piece on a control square for the required number of consecutive turns to win.">
                <span className={styles["control-progress-tooltip-icon"]}>ⓘ</span>
                <span>Control Square Progress</span>
              </div>
              {(() => {
                const byPlayer = gameState.controlSquareTracking?.byPlayer || {};
                const bySquare = gameState.controlSquareTracking?.bySquare || {};
                // Get turnsRequired from the first control square config
                const firstConfig = Object.values(specialSquares.control)[0] || {};
                const turnsRequired = firstConfig.turnsRequired || 1;
                const halfTurnsRequired = turnsRequired * 2;

                return (gameState.players || []).map((player) => {
                  const playerPosition = player.position;
                  const tracking = byPlayer[playerPosition];
                  const halfTurns = tracking?.halfTurns || 0;
                  const turnsControlled = Math.floor(halfTurns / 2);
                  const turnsRemaining = turnsRequired - turnsControlled;
                  const progressPercent = Math.min(100, (halfTurns / halfTurnsRequired) * 100);
                  
                  // Find which squares this player controls (for label)
                  const controlledSquares = Object.entries(bySquare)
                    .filter(([, sq]) => parseInt(sq.playerId) === parseInt(playerPosition))
                    .map(([key]) => {
                      const [row, col] = key.split(',').map(Number);
                      return `${String.fromCharCode(97 + col)}${row + 1}`;
                    });

                  const isControlling = controlledSquares.length > 0;

                  return (
                    <div key={playerPosition} className={styles["control-progress-item"]}>
                      <div className={styles["control-progress-header"]}>
                        <span className={styles["control-square-label"]}>{controlledSquares.join(', ') || '—'}</span>
                        <span className={styles["control-player-name"]}>
                          {player.username || `Player ${playerPosition}`}
                        </span>
                      </div>
                      <div className={styles["control-progress-bar-container"]}>
                        <div 
                          className={styles["control-progress-bar"]}
                          style={{ width: `${progressPercent}%` }}
                        />
                        <span className={styles["control-progress-text"]}>
                          {isControlling
                            ? (turnsRemaining > 0 ? `${turnsRemaining} turn${turnsRemaining !== 1 ? 's' : ''} to win` : 'Victory!')
                            : '\u00A0'}
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {/* Bottom Clock Row - Only visible on small screens */}

      {/* Mobile Chat - Only visible on small screens, below bottom clock */}
      <div className={styles["layout-row-mobile-chat"]}>
        <GameChat gameId={gameId} currentUser={currentUser} gameState={gameState} isPlayer={isPlayer} onUpdatePreference={updateUserPreference} />
        {/* Spectator List - Mobile */}
        {gameState.allowSpectators && spectators.length > 0 && (
          <div className={styles["spectator-section-mobile"]}>
            <div 
              className={styles["spectator-header"]}
              onClick={() => setShowSpectators(!showSpectators)}
            >
              <span className={styles["spectator-title"]}>👁 Spectators ({spectators.length})</span>
              <span className={`${styles["spectator-toggle"]} ${showSpectators ? styles.expanded : ''}`}>{`\u25BC`}</span>
            </div>
            {showSpectators && (
              <div className={styles["spectator-list-horizontal"]}>
                {spectators.map((spec, i) => (
                  <span key={spec.id || i} className={styles["spectator-name"]}>{spec.username}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Running Piece Count - below bottom clock */}
      {!!gameState.gameType?.piece_count_condition && gameState.pieces?.length > 0 && (
        <div className={styles["piece-count-tracker"]}>
          <div className={styles["piece-count-tracker-row"]}>
            <span className={`${styles["piece-count-tracker-player"]} ${styles["player-white"]}`}>
              {player1?.username || 'Player 1'}
            </span>
            <span className={styles["piece-count-tracker-value"]}>
              {gameState.pieces.filter(p => (p.team || p.player_id) === 1).length}
            </span>
          </div>
          <div className={styles["piece-count-tracker-divider"]}>—</div>
          <div className={styles["piece-count-tracker-row"]}>
            <span className={styles["piece-count-tracker-value"]}>
              {gameState.pieces.filter(p => (p.team || p.player_id) === 2).length}
            </span>
            <span className={`${styles["piece-count-tracker-player"]} ${styles["player-black"]}`}>
              {player2?.username || 'Player 2'}
            </span>
          </div>
        </div>
      )}

      {/* Score widget — shown for score-based (Highest Score Wins) games */}
      {gameState?.otherGameData?.high_score_win && gameState?.pieces && (() => {
        const parsed = parsePieces(gameState.pieces || []);
        const { scores, territory, stones, start, model } = computeGoScores(parsed, gameState.gameType, gameState.otherGameData);
        const nameFor = (pos) => gameState?.players?.find(p => p.position === pos)?.username || (pos === 1 ? 'Player 1' : 'Player 2');
        const regionOn = !!gameState.otherGameData.enclosed_region_scoring;
        const modelLabel = !regionOn ? 'points only' : (model === 'area' ? 'Area (stones + territory)' : 'Region (territory only)');
        const leader = scores[1] > scores[2] ? 1 : (scores[2] > scores[1] ? 2 : 0);
        return (
          <div className={styles["layout-row-captured"]}>
            <div className={styles["captured-pieces-section"]}>
              <div className={styles["captured-header"]} style={{ cursor: 'default' }}>
                <span className={styles["captured-title"]}>Score — {modelLabel}</span>
              </div>
              <div className={styles["captured-content"]} style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', padding: '8px 10px' }}>
                {[1, 2].map((pos) => (
                  <div key={pos} style={{ display: 'flex', flexDirection: 'column', minWidth: '150px' }}>
                    <span style={{ fontWeight: 700 }}>
                      {nameFor(pos)}: <span style={{ color: leader === pos ? 'var(--accent, #4ade80)' : 'inherit' }}>{scores[pos]}</span>
                    </span>
                    <span style={{ fontSize: '0.78em', color: 'var(--text-muted, #999)' }}>
                      {regionOn && model === 'area' && `${stones[pos]} stones + ${territory[pos]} territory`}
                      {regionOn && model === 'region' && `${territory[pos]} territory`}
                      {start[pos] ? `${regionOn ? ' + ' : ''}${start[pos]} start${pos === 2 ? ' (komi)' : ''}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <p className={styles["field-hint"]} style={{ padding: '0 10px 8px', margin: 0, fontSize: '0.72em', color: 'var(--text-muted, #888)' }}>
                Live estimate. Captured-piece and control-square points are added to the final tally at game end.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Reserve Bank — shown when the game uses a limited reserve (finite piece bank) */}
      {gameState?.otherGameData?.place_pieces_action && gameState?.reserves &&
        Array.isArray(gameState?.otherGameData?.placeable_pieces) &&
        gameState.otherGameData.placeable_pieces.length > 0 && (
        <div className={styles["layout-row-captured"]}>
          <div className={styles["captured-pieces-section"]}>
            <div
              className={styles["captured-header"]}
              onClick={() => setShowReserveBank(v => !v)}
            >
              <span className={styles["captured-title"]}>Reserve Bank</span>
              <span className={`${styles["captured-toggle"]} ${showReserveBank ? styles.expanded : ''}`}>
                {`\u25BC`}
              </span>
            </div>
            {showReserveBank && (
              <div className={styles["captured-content"]}>
                {[1, 2].map((pos) => {
                  const label = gameState?.players?.find(p => p.position === pos)?.username
                    || (pos === 1 ? 'White' : 'Black');
                  const entries = gameState.otherGameData.placeable_pieces;
                  return (
                    <div key={pos} className={styles["captured-row"]} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <span className={styles["captured-label"]} style={{ minWidth: '110px' }}>{label} reserve:</span>
                      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
                        {entries.map((pp, i) => {
                          const remaining = getReserveCount(gameState.reserves, pos, pp.piece_id);
                          const count = remaining === Infinity ? '∞' : remaining;
                          const imageUrl = reserveImageForPlayer(pp, pos);
                          return (
                            <div
                              key={`${pp.piece_id ?? 'pp'}_${i}`}
                              title={`${pp.name || pp.piece_name || 'Piece'}${pp.is_neutral ? ' (Neutral)' : ''} — ${count} left`}
                              style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                                opacity: remaining === 0 ? 0.35 : 1, minWidth: '44px'
                              }}
                            >
                              {imageUrl && (
                                <img
                                  src={imageUrl}
                                  alt={pp.name || 'Piece'}
                                  draggable={false}
                                  style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                                />
                              )}
                              <span style={{ fontWeight: 700, fontSize: '0.9em' }}>×{count}</span>
                              {pp.is_neutral && (
                                <span style={{ fontSize: '0.65em', color: 'var(--text-muted, #999)' }}>Neutral</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Captured Pieces Row — hidden during active Hidden-Enemy-Pieces games */}
      {!(gameState?.hideEnemyPieces && gameState?.status !== 'completed') &&
        (capturedPieces.player1.length > 0 || capturedPieces.player2.length > 0) && (
        <div className={styles["layout-row-captured"]}>
          <div className={styles["captured-pieces-section"]}>
            <div 
              className={styles["captured-header"]}
              onClick={() => setShowCapturedPieces(!showCapturedPieces)}
            >
              <span className={styles["captured-title"]}>Captured Pieces</span>
              <span className={`${styles["captured-toggle"]} ${showCapturedPieces ? styles.expanded : ''}`}>
                {`\u25BC`}
              </span>
            </div>
            {showCapturedPieces && (
              <div className={styles["captured-content"]}>
                {/* Player 1's captures (pieces they took from player 2) */}
                <div className={styles["captured-row"]}>
                  <span className={styles["captured-label"]}>
                    {gameState?.players?.find(p => p.position === 1)?.username || 'White'} captured:
                    {capturedPieces.player1.length > 0 && (
                      <span className={styles["captured-value"]}>
                        {capturedValues.ready ? (
                          <>
                            {' '}≈{capturedValues.player1}
                            {capturedValues.player1 > capturedValues.player2 && (
                              <span className={styles["material-advantage"]}> (+{Math.round((capturedValues.player1 - capturedValues.player2) * 10) / 10})</span>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: '0.75em', opacity: 0.6 }}> …</span>
                        )}
                      </span>
                    )}
                  </span>
                  <div className={styles["captured-pieces"]}>
                    {capturedPieces.player1.length > 0 ? (
                      capturedPieces.player1.map((piece, index) => {
                        let imgSrc = null;
                        if (piece.image || piece.image_url) {
                          const rawPath = piece.image || piece.image_url;
                          imgSrc = rawPath.startsWith('http') ? rawPath : `${ASSET_URL}${rawPath}`;
                        } else if (piece.image_location) {
                          imgSrc = getPlayerImageUrl(piece.image_location, piece.player_id || piece.team || 2);
                        }
                        return (
                          <div key={`p1-${index}`} className={styles["captured-piece"]} title={piece.piece_name}>
                            {imgSrc ? (
                              <img src={imgSrc} alt={piece.piece_name} onError={(e) => {
                                const fb = getFallbackPieceImage(piece.piece_name, piece.player_id);
                                if (fb && e.target.src !== fb) e.target.src = fb;
                              }} />
                            ) : (
                              <span className={styles["piece-symbol"]}>♟</span>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <span className={styles["no-captures"]}>None</span>
                    )}
                  </div>
                </div>
                {/* Player 2's captures (pieces they took from player 1) */}
                <div className={styles["captured-row"]}>
                  <span className={styles["captured-label"]}>
                    {gameState?.players?.find(p => p.position === 2)?.username || 'Black'} captured:
                    {capturedPieces.player2.length > 0 && (
                      <span className={styles["captured-value"]}>
                        {capturedValues.ready ? (
                          <>
                            {' '}≈{capturedValues.player2}
                            {capturedValues.player2 > capturedValues.player1 && (
                              <span className={styles["material-advantage"]}> (+{Math.round((capturedValues.player2 - capturedValues.player1) * 10) / 10})</span>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: '0.75em', opacity: 0.6 }}> …</span>
                        )}
                      </span>
                    )}
                  </span>
                  <div className={styles["captured-pieces"]}>
                    {capturedPieces.player2.length > 0 ? (
                      capturedPieces.player2.map((piece, index) => {
                        let imgSrc = null;
                        if (piece.image || piece.image_url) {
                          const rawPath = piece.image || piece.image_url;
                          imgSrc = rawPath.startsWith('http') ? rawPath : `${ASSET_URL}${rawPath}`;
                        } else if (piece.image_location) {
                          imgSrc = getPlayerImageUrl(piece.image_location, piece.player_id || piece.team || 1);
                        }
                        return (
                          <div key={`p2-${index}`} className={styles["captured-piece"]} title={piece.piece_name}>
                            {imgSrc ? (
                              <img src={imgSrc} alt={piece.piece_name} onError={(e) => {
                                const fb = getFallbackPieceImage(piece.piece_name, piece.player_id);
                                if (fb && e.target.src !== fb) e.target.src = fb;
                              }} />
                            ) : (
                              <span className={styles["piece-symbol"]}>♟</span>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <span className={styles["no-captures"]}>None</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Row - Move history for medium screens (1000-1200px) */}
      <div className={styles["layout-row-bottom"]}>
        <div className={styles["move-history"]}>
          <h3>Move History</h3>
          <div className={styles["moves-list"]}>
            <div className={styles["moves-header"]}>
              <span className={styles["move-number-header"]}>#</span>
              <span className={styles["move-col-header"]}>P1</span>
              <span className={styles["move-col-header"]}>P2</span>
            </div>
            {(() => {
              const moves = gameState.moveHistory || [];
              const bh = gameState?.gameType?.board_height || 8;
              const canReview = !!initialPiecesRef.current;
              // Group consecutive same-position moves into half-turns so that
              // multi-action turns, chain captures, and must-move pieces all
              // appear in the correct player column.
              const halfTurns = [];
              let htIdx = 0;
              while (htIdx < moves.length) {
                const pos = moves[htIdx]?.position;
                const group = [];
                while (htIdx < moves.length && moves[htIdx]?.position === pos) {
                  group.push({ move: moves[htIdx], origIndex: htIdx });
                  htIdx++;
                }
                halfTurns.push({ position: pos, moves: group });
              }
              const rows = [];
              for (let r = 0; r < halfTurns.length; r += 2) {
                const htA = halfTurns[r];
                const htB = halfTurns[r + 1] || null;
                const p1HT = htA?.position === 1 ? htA : htB;
                const p2HT = htA?.position === 2 ? htA : htB;
                const rowNum = Math.floor(r / 2) + 1;
                const renderHT = (ht, colStyle) => {
                  if (!ht) return <span key="empty" className={styles[colStyle]} />;
                  return (
                    <span key={ht.moves[0].origIndex} className={styles[colStyle]}>
                      {ht.moves.map((m, mi) => (
                        <React.Fragment key={m.origIndex}>
                          {mi > 0 && <span style={{ color: '#666', margin: '0 2px' }}>/</span>}
                          <span
                            className={ghostMoveIndex === m.origIndex ? styles["active-move"] : undefined}
                            onClick={() => canReview && setGhostMoveIndex(ghostMoveIndex === m.origIndex ? null : m.origIndex)}
                            style={{ cursor: canReview ? 'pointer' : 'default' }}
                          >{formatMoveNotation(m.move, true, bh)}</span>
                        </React.Fragment>
                      ))}
                    </span>
                  );
                };
                rows.push(
                  <div key={r} className={styles["move-row"]}>
                    <span className={styles["move-number"]}>{rowNum}.</span>
                    {renderHT(p1HT, "move-white")}
                    {renderHT(p2HT, "move-black")}
                  </div>
                );
              }
              return rows;
            })()}
            {(!gameState.moveHistory || gameState.moveHistory.length === 0) && (
              <div style={{ color: '#666', textAlign: 'center', padding: '12px' }}>
                No moves yet
              </div>
            )}
          </div>
          {initialPiecesRef.current && gameState.moveHistory && gameState.moveHistory.length > 0 && (
            <div className={styles["move-nav-arrows"]}>
              <button onClick={() => setGhostMoveIndex(0)} disabled={ghostMoveIndex === 0} title="First move">⏮</button>
              <button onClick={() => setGhostMoveIndex(prev => prev === null ? (gameState.moveHistory.length - 1) : Math.max(0, prev - 1))} disabled={ghostMoveIndex === 0} title="Previous move">◀</button>
              <button onClick={() => setGhostMoveIndex(prev => prev === null ? 0 : (prev >= gameState.moveHistory.length - 1 ? null : prev + 1))} disabled={ghostMoveIndex === null || ghostMoveIndex >= gameState.moveHistory.length - 1} title="Next move">▶</button>
              <button onClick={() => setGhostMoveIndex(null)} disabled={ghostMoveIndex === null} title="Live board">⏭</button>
            </div>
          )}
        </div>

        <div className={styles["game-options"]}>
          <div className={styles["options-header"]}>
            <h3>Options</h3>
            <button
              className={`${styles["sound-toggle-btn"]} ${soundEnabled ? styles["sound-on"] : styles["sound-off"]}`}
              onClick={() => {
                const enabled = !soundEnabled;
                setSoundEnabled(enabled);
                soundEnabledRef.current = enabled;
                persistSoundPreference(enabled);
              }}
              title={soundEnabled ? 'Mute sound effects' : 'Unmute sound effects'}
            >
              {soundEnabled ? '🔊' : '🔇'}
            </button>
          </div>
          <ToggleSwitch
            checked={showMovableIndicators}
            onChange={(v) => setShowMovableIndicators(v)}
            label="Show movable pieces"
          />
          {hasSpecialSquares && (
            <ToggleSwitch
              checked={showAllSpecialSquares}
              onChange={(v) => setShowAllSpecialSquares(v)}
              label="Show all special squares"
            />
          )}
          {hasRestrictionZones && (
            <ToggleSwitch
              checked={hideRestrictionZones}
              onChange={(v) => setHideRestrictionZones(v)}
              label="Hide restriction zones"
            />
          )}
          {gameState?.otherGameData?.place_pieces_action && currentPlayer && (
            <ToggleSwitch
              checked={hidePlacementRestrictions}
              onChange={(v) => setHidePlacementRestrictions(v)}
              label="Hide placement restrictions"
            />
          )}
          <ToggleSwitch
            checked={showBoardNotation}
            onChange={(v) => setShowBoardNotation(v)}
            label="Show board notation"
          />
          {gameState.pieces?.some(p => p.show_hp_ad || p.hit_points > 1 || (p.show_regen && p.hp_regen > 0) || (p.show_burn && p.burn_damage > 0)) && (
            <ToggleSwitch
              checked={showBadges}
              onChange={(v) => setShowBadges(v)}
              label="Show piece badges"
            />
          )}
          {currentUser && (
            <ToggleSwitch
              checked={currentUser.disable_game_chat === 1 || currentUser.disable_game_chat === true}
              onChange={(v) => updateUserPreference('disable_game_chat', v)}
              label="Disable chat"
            />
          )}
          {castlingInfo.length > 0 && (
            <ToggleSwitch
              checked={showCastlingInfo}
              onChange={(v) => setShowCastlingInfo(v)}
              label="Show castling info"
            />
          )}
          
          {showCastlingInfo && castlingInfo.length > 0 && (
            <div className={styles["castling-info"]}>
              <h4>Castling Pieces</h4>
              {castlingInfo.map((info, index) => (
                <div key={index} className={styles["castling-piece-info"]}>
                  <span className={styles["piece-name"]}>
                    {info.piece.piece_name || info.piece.name}
                    <span className={styles["castle-distance"]}> (moves {info.distance} squares)</span>
                  </span>
                  <div className={styles["castling-partners"]}>
                    {info.leftPartner && (
                      <span className={styles["partner"]}>← {info.leftPartner.piece_name || info.leftPartner.name}</span>
                    )}
                    {info.rightPartner && (
                      <span className={styles["partner"]}>{info.rightPartner.piece_name || info.rightPartner.name} →</span>
                    )}
                    {!info.leftPartner && !info.rightPartner && (
                      <span className={styles["no-partner"]}>No partners assigned</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Settings Row */}
      <div className={styles["layout-row-settings"]}>
        <div className={styles["game-settings"]}>
          <h3>Game Settings</h3>
          <div className={styles["settings-content"]}>
            <div className={styles["settings-row"]}>
              <span className={styles["setting-label"]}>Mode:</span>
              <span className={styles["setting-value"]}>{gameState.rated !== false ? 'Rated' : 'Casual'}</span>
            </div>
            {gameState.timeControl && (
              <div className={styles["settings-row"]}>
                <span className={styles["setting-label"]}>Time Control:</span>
                <span className={styles["setting-value"]}>{gameState.timeControl} min + {gameState.increment || 0}s</span>
              </div>
            )}
            <div className={styles["settings-row"]}>
              <span className={styles["setting-label"]}>Premoves:</span>
              <span className={styles["setting-value"]}>{gameState.allowPremoves !== false ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div className={styles["settings-row"]}>
              <span className={styles["setting-label"]}>Movement Helpers:</span>
              <span className={styles["setting-value"]}>{gameState.showPieceHelpers ? 'Enabled' : 'Disabled'}</span>
            </div>
            {gameState.allowSpectators !== undefined && (
              <div className={styles["settings-row"]}>
                <span className={styles["setting-label"]}>Spectators:</span>
                <span className={styles["setting-value"]}>{gameState.allowSpectators ? 'Allowed' : 'Not allowed'}</span>
              </div>
            )}
            {gameState.startingMode && gameState.startingMode !== 'none' && (
              <div className={styles["settings-row"]}>
                <span className={styles["setting-label"]}>Starting Positions:</span>
                <span className={styles["setting-value"]}>
                  {gameState.startingMode === 'mirrored' ? 'Mirrored' :
                   gameState.startingMode === 'backrow' ? 'Back Row Mirrored (960)' :
                   gameState.startingMode === 'independent' ? 'Independent' :
                   gameState.startingMode === 'shared' ? 'Shared' :
                   gameState.startingMode === 'full' ? 'Full Random' :
                   gameState.startingMode}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game Over Modal */}
      {showGameOver && gameOverData && (
        <div className={styles["game-over-overlay"]} onClick={() => setShowGameOver(false)}>
          <div className={styles["game-over-modal"]} onClick={(e) => e.stopPropagation()}>
            <button className={styles["modal-close-btn"]} onClick={() => setShowGameOver(false)} aria-label="Close">&times;</button>
            <h2>Game Over</h2>
            <div className={`
              ${styles.result}
              ${gameOverData.winner != null && gameOverData.winner === (currentUser ? currentUser.id : currentPlayer?.id) ? styles.win : 
                gameOverData.winner ? styles.loss : styles.draw}
            `}>
              {gameOverData.winner != null && gameOverData.winner === (currentUser ? currentUser.id : currentPlayer?.id) ? 'You Won!' : 
               gameOverData.winner ? `${gameOverData.winnerUsername || 'Opponent'} Wins!` : 'Draw!'}
            </div>
            <div className={styles.reason}>
              {gameOverData.reason === 'checkmate' ? 'By Checkmate' :
               gameOverData.reason === 'stalemate' ? 'By Stalemate' :
               gameOverData.reason === 'draw_move_limit' ? 'By Move Limit (No Captures)' :
               gameOverData.reason === 'repetition' ? 'By Repetition' :
               gameOverData.reason === 'insufficient_material' ? 'Insufficient Material' :
               gameOverData.reason === 'agreement' ? 'By Agreement' :
               gameOverData.reason === 'resignation' ? 'By Resignation' :
               gameOverData.reason === 'timeout' ? 'By Timeout' :
               gameOverData.reason === 'disconnect' ? 'By Disconnect' :
               gameOverData.reason === 'piece_count' ? 'By Piece Count' :
               gameOverData.reason === 'equal_piece_count' ? 'Equal Piece Count - Draw' :
               gameOverData.reason === 'promotion' ? 'By Promotion' :
               gameOverData.reason === 'lose_all_pieces' ? 'By Anti-Chess (Lost All Pieces)' :
               gameOverData.reason === 'stalemate_win' ? 'By Stalemate Win' :
               gameOverData.reason === 'no_moves' ? 'By No Legal Moves' :
               gameOverData.reason === 'no_legal_moves' ? 'By No Legal Moves' :
               gameOverData.reason === 'elimination' ? 'By Elimination' :
               gameOverData.reason === 'initial_position' ? 'Initial Position — No Moves Played (No ELO Change)' :
               gameOverData.reason === 'cancellation_draw' ? 'Draw — Cancellation Threshold Reached' :
               gameOverData.reason === 'simultaneous_capture_draw' ? 'Draw — Simultaneous Capture' :
               gameOverData.reason === 'simultaneous_checkmate_draw' ? 'Draw — Simultaneous Checkmate' :
               gameOverData.reason === 'points_win' ? 'By Points' :
               gameOverData.reason === 'score' ? 'By Highest Score' :
               gameOverData.reason === 'score_draw' ? 'Draw — Equal Score' :
               gameOverData.reason === 'passes_draw' ? 'Draw' :
               gameOverData.reason === 'draw_points_tie' ? 'Draw — Both Reached Point Threshold' :
               gameOverData.reason === 'draw_equal_points_at_turn' ? 'Draw — Equal Points at Turn Limit' :
               gameOverData.reason === 'draw_equal_points_consecutive' ? 'Draw — Equal Points Stalemate' :
               gameOverData.reason === 'illegal_move_limit' ? 'By Illegal-Move Limit' :
               gameOverData.reason}
            </div>
            {(gameOverData.player1Score != null || gameOverData.player2Score != null) && (
              <div className={styles["piece-count-result"]}>
                <div className={styles["piece-count-row"]}>
                  <span className={styles["piece-count-label"]}>
                    {(currentPlayer?.position === 1 ? player1 : player2)?.username || 'Player 1'} score
                  </span>
                  <span className={styles["piece-count-value"]}>
                    {currentPlayer?.position === 1 ? (gameOverData.player1Score ?? 0) : (gameOverData.player2Score ?? 0)}
                  </span>
                </div>
                <div className={styles["piece-count-row"]}>
                  <span className={styles["piece-count-label"]}>
                    {(currentPlayer?.position === 1 ? player2 : player1)?.username || 'Player 2'} score
                  </span>
                  <span className={styles["piece-count-value"]}>
                    {currentPlayer?.position === 1 ? (gameOverData.player2Score ?? 0) : (gameOverData.player1Score ?? 0)}
                  </span>
                </div>
              </div>
            )}
            {(gameOverData.reason === 'piece_count' || gameOverData.reason === 'equal_piece_count') && 
             gameOverData.player1Count != null && gameOverData.player2Count != null && (
              <div className={styles["piece-count-result"]}>
                <div className={styles["piece-count-row"]}>
                  <span className={styles["piece-count-label"]}>
                    {(currentPlayer?.position === 1 ? player1 : player2)?.username || 'Player 1'} (White)
                  </span>
                  <span className={styles["piece-count-value"]}>
                    {currentPlayer?.position === 1 ? gameOverData.player1Count : gameOverData.player2Count}
                  </span>
                </div>
                <div className={styles["piece-count-row"]}>
                  <span className={styles["piece-count-label"]}>
                    {(currentPlayer?.position === 1 ? player2 : player1)?.username || 'Player 2'} (Black)
                  </span>
                  <span className={styles["piece-count-value"]}>
                    {currentPlayer?.position === 1 ? gameOverData.player2Count : gameOverData.player1Count}
                  </span>
                </div>
              </div>
            )}
            {gameOverData.eloChanges && (
              <div className={styles.eloChanges}>
                <div className={styles.eloChange}>
                  <span className={styles.eloLabel}>Your ELO:</span>
                  <span className={`${styles.eloValue} ${
                    gameOverData.eloChanges.winner?.id === currentUser?.id 
                      ? (gameOverData.eloChanges.winner.change >= 0 ? styles.eloUp : styles.eloDown)
                      : (gameOverData.eloChanges.loser?.change >= 0 ? styles.eloUp : styles.eloDown)
                  }`}>
                    {gameOverData.eloChanges.winner?.id === currentUser?.id 
                      ? `${gameOverData.eloChanges.winner.oldElo} → ${gameOverData.eloChanges.winner.newElo} (${gameOverData.eloChanges.winner.change >= 0 ? '+' : ''}${gameOverData.eloChanges.winner.change})`
                      : `${gameOverData.eloChanges.loser?.oldElo} → ${gameOverData.eloChanges.loser?.newElo} (${gameOverData.eloChanges.loser?.change >= 0 ? '+' : ''}${gameOverData.eloChanges.loser?.change})`
                    }
                  </span>
                </div>
              </div>
            )}
            {gameOverUpvoteState === 'prompt' && (
              <div className={styles["upvote-prompt"]}>
                <span className={styles["upvote-prompt-text"]}>Enjoyed this game type?</span>
                <button
                  className={styles["upvote-prompt-btn"]}
                  onClick={handleGameOverUpvote}
                >
                  {`\u25B2`} Upvote
                </button>
              </div>
            )}
            {gameOverUpvoteState === 'just_upvoted' && (
              <div className={styles["upvote-thanks"]}>
                ✓ Thanks for the upvote!
              </div>
            )}
            <div className={styles["game-over-actions"]}>
              <button 
                className={`${styles.btn} ${styles["btn-secondary"]}`}
                onClick={() => navigate('/')}
              >
                View Home
              </button>
              {initialPiecesRef.current && gameState?.moveHistory?.length > 0 && (
                <button 
                  className={`${styles.btn} ${styles["btn-secondary"]}`}
                  onClick={() => {
                    setShowGameOver(false);
                    setGhostMoveIndex(gameState.moveHistory.length - 1);
                  }}
                >
                  Review Game
                </button>
              )}
              <button 
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handlePlayAgain}
              >
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promotion Modal */}
      {showPromotionModal && promotionData && !promotionMinimized && (
        <PromotionModal
          promotionOptions={promotionData.options}
          promotingPiece={promotionData.promotingPiece}
          onSelect={handlePromotionSelect}
          onCancel={handlePromotionCancel}
          onMinimize={handlePromotionMinimize}
        />
      )}
      {showPromotionModal && promotionData && promotionMinimized && (
        <button
          className={styles["promotion-restore-btn"]}
          onClick={handlePromotionRestore}
        >
          Choose Promotion ▲
        </button>
      )}

      {/* Piece Placement Modal */}
      {showPlacementModal && placementTarget && (
        <div className={styles["promotion-modal-overlay"]} onClick={handlePlacementCancel}>
          <div className={styles["promotion-modal"]} onClick={(e) => e.stopPropagation()}>
            <h3>Place a Piece</h3>
            <p>Select which piece to place at {String.fromCharCode(97 + placementTarget.x)}{placementTarget.y + 1}:</p>
            <div className={styles["promotion-options"]}>
              {(gameState?.otherGameData?.placeable_pieces || []).map((piece, index) => {
                if (!isPlaceableEligible(piece, currentPlayer?.position)) return null; // not deployable by this player
                const imageUrl = reserveImageForPlayer(piece, currentPlayer?.position);
                const remaining = getReserveCount(gameState?.reserves, currentPlayer?.position, piece.piece_id);
                const limited = gameState?.reserves != null && remaining !== Infinity;
                const depleted = limited && remaining <= 0;
                if (depleted) return null; // exhausted piece types are hidden
                return (
                  <button
                    key={`${piece.piece_id ?? 'pp'}_${index}`}
                    className={styles["promotion-option"]}
                    onClick={() => handlePlacementSelect(piece)}
                    title={piece.piece_name || piece.name || 'Piece'}
                    style={{ position: 'relative' }}
                  >
                    {limited && (
                      <span
                        style={{
                          position: 'absolute', top: '2px', right: '4px',
                          fontWeight: 700, fontSize: '0.8em', lineHeight: 1,
                          background: 'rgba(0,0,0,0.6)', color: '#fff',
                          borderRadius: '8px', padding: '1px 5px', pointerEvents: 'none'
                        }}
                      >
                        ×{remaining}
                      </span>
                    )}
                    {imageUrl ? (
                      <img src={imageUrl} alt={piece.piece_name || piece.name || 'Piece'} draggable={false} />
                    ) : (
                      <span className={styles["piece-name"]}>{piece.piece_name || piece.name || '?'}</span>
                    )}
                    <span className={styles["piece-label"]}>
                      {piece.piece_name || piece.name || 'Unknown'}
                      {piece.is_neutral ? ' (Neutral)' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <button className={styles["cancel-button"]} onClick={handlePlacementCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* Guest Join Modal — for anonymous users joining a non-rated open game */}
      {showGuestJoinModal && (
        <div className={styles["promotion-modal-overlay"]} onClick={() => setShowGuestJoinModal(false)}>
          <div className={styles["promotion-modal"]} onClick={(e) => e.stopPropagation()}>
            <h3>Join as Guest</h3>
            <p>Playing as a guest. This game is unrated.</p>
            <input
              type="text"
              maxLength={20}
              placeholder="Guest"
              value={guestJoinName}
              autoFocus
              onChange={(e) => setGuestJoinName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmGuestJoin(); }}
              style={{ width: '100%', padding: '8px', marginBottom: '16px', background: 'var(--bg-deep, #0d1b2e)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: 'var(--text-primary)', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className={styles["cancel-button"]} onClick={() => setShowGuestJoinModal(false)}>Cancel</button>
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handleConfirmGuestJoin}
                disabled={isJoiningAsGuest}
              >
                {isJoiningAsGuest ? 'Joining...' : 'Join Game'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default LiveGame;
