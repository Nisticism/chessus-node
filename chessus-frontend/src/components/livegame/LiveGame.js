import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import {
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
  canRangedAttackTo,
  isRangedPathClear,
  colToFile,
  rowToRank,
  formatMoveNotation,
  findPieceAtSquare,
  doesPieceOccupySquare,
  doesPieceFitOnBoard,
  isDestinationClear,
  replayToMove,
  getDirectionChangeMoves
} from "../../helpers/pieceMovementUtils";
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
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredMoves, setHoveredMoves] = useState([]);
  const [draggedPiece, setDraggedPiece] = useState(null);
  const [dragValidMoves, setDragValidMoves] = useState([]);
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
  const [displayTimes, setDisplayTimes] = useState({}); // Locally interpolated clock times for sub-second display
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

  // Options menu collapse state
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);

  const boardAnimationsEnabled = typeof window !== 'undefined' && localStorage.getItem('boardAnimations') !== 'false';
  const pieceShadowEnabled = typeof window !== 'undefined' && localStorage.getItem('pieceShadow') === 'true';
  const persistLastMoveHighlight = typeof window !== 'undefined' && localStorage.getItem('persistLastMoveHighlight') === 'true';
  const hideMoveArrow = typeof window !== 'undefined' && localStorage.getItem('hideMoveArrow') === 'true';

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
      // Optimistic position update: move piece visually before server confirms
      if (moveData.type !== 'place') {
        optimisticMoveSnapshotRef.current = optimisticSnapshot;
        setGameState((prev) => applyOptimisticMovePreview(prev, moveData));
      }
      makeMove(gId, moveData);
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
  }, [turnConfirmEnabled, gameState?.isCorrespondence, gameState?.timeControl, gameState?.pieces, gameState?.currentTurn, gameState?.players, gameState?.gameType?.simultaneous_turns, gameState?.gameType?.simul_turns_submit_mode, gameState?.status, simulSubmittedThisRound, makeMove, createOptimisticSnapshot, applyOptimisticMovePreview]);

  /* eslint-disable react-hooks/rules-of-hooks -- False positive: all hooks below are unconditionally at the top level. eslint-plugin-react-hooks v4.4.0 CFG analysis limit reached in this large component. */
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
  ]);

  // Defensive re-anchor: any time the authoritative server-side currentTurn
  // changes, make sure the interpolation refs reflect the new active player.
  // This guards against initial load races and any state path that updates
  // gameState without going through the moveMade re-anchor block.
  useEffect(() => {
    if (gameState?.status !== 'active') return;
    if (!gameState?.playerTimes || !Array.isArray(gameState?.players)) return;
    if (gameState.currentTurn == null) return;
    const cp = gameState.players.find(p => p.position === gameState.currentTurn);
    const newActiveId = cp?.id ?? null;
    if (newActiveId == null) return;
    if (activeClockPlayerRef.current !== newActiveId) {
      // Active player changed (or never set) — re-anchor with the latest
      // server-authoritative times so we drain the correct player's clock.
      serverTimesRef.current = { ...gameState.playerTimes };
      lastServerTickRef.current = Date.now();
      activeClockPlayerRef.current = newActiveId;
    } else if (lastServerTickRef.current == null) {
      // First time we see playerTimes — anchor without changing active player.
      serverTimesRef.current = { ...gameState.playerTimes };
      lastServerTickRef.current = Date.now();
    }
  }, [gameState?.status, gameState?.currentTurn, gameState?.playerTimes, gameState?.players]);

  // Subscribe to game events
  useEffect(() => {
    const unsubscribeBotThinking = onGameEvent("botThinking", ({ gameId: botGameId, thinking }) => {
      if (parseInt(botGameId) === parseInt(gameId)) {
        setBotThinking(thinking);
      }
    });

    const unsubscribeMove = onGameEvent("moveMade", ({ gameId: moveGameId, move, gameState: newState, regenPieces, burnPieces, burnKilledPieces, clockMultipliers, midTurnCheckmate, midTurnCheck }) => {
      if (parseInt(moveGameId) === parseInt(gameId)) {
        clearOptimisticMoveSnapshot();
        setBotThinking(false);
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
            ...(clockMultipliers !== undefined ? { clockMultipliers } : {})
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
          if (newState.inCheck || midTurnCheck) {
            soundManager.playCheck();
          } else if (move.captured) {
            soundManager.playCapture();
          } else if (move.damagedPieces && move.damagedPieces.length > 0) {
            // HP/AD: play hit sound for damage that didn't kill
            soundManager.playHit();
          } else {
            soundManager.playMove();
          }
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
            if (move.captured) {
              soundManager.playCapture();
            } else if (move.damagedPieces && move.damagedPieces.length > 0) {
              soundManager.playHit();
            } else {
              soundManager.playMove();
            }
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

    const unsubscribeTimeUpdate = onGameEvent("timeUpdate", ({ gameId: timerGameId, playerTimes, currentTurn, clockMultipliers }) => {
      if (parseInt(timerGameId) === parseInt(gameId)) {
        serverTimesRef.current = playerTimes || {};
        lastServerTickRef.current = Date.now();
        const currentPlayer_ = playersRef.current?.find(p => p.position === currentTurn);
        activeClockPlayerRef.current = currentPlayer_?.id || null;
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
          if (newState.inCheck) {
            soundManager.playCheck();
          } else if (move.captured) {
            soundManager.playCapture();
          } else if (move.damagedPieces && move.damagedPieces.length > 0) {
            soundManager.playHit();
          } else {
            soundManager.playMove();
          }
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

    return () => {
      unsubscribeReposition();
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
    const interval = setInterval(() => {
      if (!lastServerTickRef.current || !serverTimesRef.current) return;
      const elapsed = (Date.now() - lastServerTickRef.current) / 1000;
      const newTimes = {};
      for (const [pid, srvTime] of Object.entries(serverTimesRef.current)) {
        if (pid === String(activeClockPlayerRef.current)) {
          const multiplier = gameState?.clockMultipliers?.[pid] || 1;
          newTimes[pid] = Math.max(0, srvTime - elapsed * multiplier);
        } else {
          newTimes[pid] = srvTime;
        }
      }
      setDisplayTimes(newTimes);
    }, 100);
    return () => clearInterval(interval);
  }, [gameState?.timeControl, gameState?.status, gameState?.clockMultipliers]);

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

  // Helper function to check if a value allows movement at a distance
  const checkMovement = (value, distance, repeating = false) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null || value === undefined) return false;
    if (value > 0) return distance <= value; // Up to X squares
    if (value < 0) {
      const exact = Math.abs(value);
      if (repeating) return distance > 0 && distance % exact === 0;
      return distance === exact; // Exact X squares
    }
    return false;
  };

  // Resolve a directional value + separate exact flag into the signed convention for checkMovement.
  // DB stores values as positive with a separate boolean _exact column.
  const resolveExact = (value, exactFlag) => {
    if (!value || value === 99) return value;
    if (exactFlag === true || exactFlag === 1) return -Math.abs(value);
    return value;
  };

  // Check if a move is from a first-move-only additional movement option
  const checkIfFirstMoveOnlyMove = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    if (!pieceData.special_scenario_moves) return 0;
    
    try {
      const parsed = typeof pieceData.special_scenario_moves === 'string'
        ? JSON.parse(pieceData.special_scenario_moves)
        : pieceData.special_scenario_moves;
      const additionalMovements = parsed?.additionalMovements || {};
      
      const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
      const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);
      const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      // Determine direction
      let direction = null;
      if (rowDiff < 0 && colDiff === 0) direction = 'up';
      else if (rowDiff > 0 && colDiff === 0) direction = 'down';
      else if (rowDiff === 0 && colDiff < 0) direction = 'left';
      else if (rowDiff === 0 && colDiff > 0) direction = 'right';
      else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
      
      if (!direction || !additionalMovements[direction]) return 0;
      
      // Check if any of the additional movements for this direction have firstMoves/availableForMoves value
      for (const movementOption of additionalMovements[direction]) {
        // Support both firstMoves and availableForMoves fields
        const firstMoves = movementOption.firstMoves || movementOption.availableForMoves || 0;
        // Also check firstMoveOnly boolean for backwards compatibility
        const isFirstMoveOnly = movementOption.firstMoveOnly || false;
        
        if (firstMoves === 0 && !isFirstMoveOnly) continue;
        
        const value = movementOption.value || 0;
        const matchesMove = (movementOption.infinite && distance > 0) ||
                           (movementOption.exact && distance === value) ||
                           (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value);
        
        // CRITICAL: Only return firstMoves if this specific move matches AND the distance doesn't match the regular movement
        // For example, pawn's 1-square move should NOT be affected by the 2-square special scenario
        if (matchesMove && distance === value) {
          // Return the number of first moves allowed (or 1 if just firstMoveOnly flag is set)
          return firstMoves || (isFirstMoveOnly ? 1 : 0);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return 0;
  };

  // Check if a capture is from a first-move-only additional capture option
  const checkIfFirstMoveOnlyCapture = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    if (!pieceData.special_scenario_captures) return 0;
    
    try {
      const parsed = typeof pieceData.special_scenario_captures === 'string'
        ? JSON.parse(pieceData.special_scenario_captures)
        : pieceData.special_scenario_captures;
      const additionalCaptures = parsed?.additionalCaptures || {};
      
      const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
      const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);
      const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      // Determine direction
      let direction = null;
      if (rowDiff < 0 && colDiff === 0) direction = 'up';
      else if (rowDiff > 0 && colDiff === 0) direction = 'down';
      else if (rowDiff === 0 && colDiff < 0) direction = 'left';
      else if (rowDiff === 0 && colDiff > 0) direction = 'right';
      else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
      
      if (!direction || !additionalCaptures[direction]) return 0;
      
      // Check if any of the additional captures for this direction have firstMoves/availableForMoves value
      for (const captureOption of additionalCaptures[direction]) {
        // Support both firstMoves and availableForMoves fields
        const firstMoves = captureOption.firstMoves || captureOption.availableForMoves || 0;
        // Also check firstMoveOnly boolean for backwards compatibility
        const isFirstMoveOnly = captureOption.firstMoveOnly || false;
        
        if (firstMoves === 0 && !isFirstMoveOnly) continue;
        
        const value = captureOption.value || 0;
        const matchesCapture = (captureOption.infinite && distance > 0) ||
                              (captureOption.exact && distance === value) ||
                              (!captureOption.exact && !captureOption.infinite && distance > 0 && distance <= value);
        
        // Only return firstMoves if this exact distance matches the special scenario value
        if (matchesCapture && distance === value) {
          // Return the number of first moves allowed (or 1 if just firstMoveOnly flag is set)
          return firstMoves || (isFirstMoveOnly ? 1 : 0);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return 0;
  };

  // Check if piece can move to a square (not capturing)
  // skipExactRatio: when true, skip exact directional and ratio checks (for hop-only validation)
  const canPieceMoveTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio = false, skipCustom = false) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    if (!skipExactRatio) {
    const utilResult = canPieceMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    if (utilResult.allowed && !(skipCustom && utilResult.isCustomOnly)) {
      return true;
    }
    }

    // For player 2, flip the perspective (so "up" is towards player 1 and "left" is towards player 1's left)
    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check directional movement - accept if style is set OR if any directional movement values are present
    const directionalStyle = pieceData.directional_movement_style;
    const hasDirectionalValues = pieceData.up_movement || pieceData.down_movement || 
                                  pieceData.left_movement || pieceData.right_movement ||
                                  pieceData.up_left_movement || pieceData.up_right_movement ||
                                  pieceData.down_left_movement || pieceData.down_right_movement;
    
    if (directionalStyle || hasDirectionalValues) {
      let directionalAllowed = false;
      const rep = pieceData.repeating_movement;

      // Check 8 directions
      if (rowDiff < 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.up_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_movement, pieceData.up_movement_exact), Math.abs(rowDiff), rep && pieceData.up_movement_exact);
      } else if (rowDiff > 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.down_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_movement, pieceData.down_movement_exact), Math.abs(rowDiff), rep && pieceData.down_movement_exact);
      } else if (rowDiff === 0 && colDiff < 0) {
        if (!(skipExactRatio && pieceData.left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.left_movement, pieceData.left_movement_exact), Math.abs(colDiff), rep && pieceData.left_movement_exact);
      } else if (rowDiff === 0 && colDiff > 0) {
        if (!(skipExactRatio && pieceData.right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.right_movement, pieceData.right_movement_exact), Math.abs(colDiff), rep && pieceData.right_movement_exact);
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_left_movement, pieceData.up_left_movement_exact), Math.abs(rowDiff), rep && pieceData.up_left_movement_exact);
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_right_movement, pieceData.up_right_movement_exact), Math.abs(rowDiff), rep && pieceData.up_right_movement_exact);
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_left_movement, pieceData.down_left_movement_exact), Math.abs(rowDiff), rep && pieceData.down_left_movement_exact);
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_right_movement, pieceData.down_right_movement_exact), Math.abs(rowDiff), rep && pieceData.down_right_movement_exact);
      }

      if (directionalAllowed) return true;
    }

    // Check ratio movement (L-shape like knight)
    if (!skipExactRatio) {
    const ratioStyle = pieceData.ratio_movement_style;
    const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
    const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
    
    if ((ratioStyle || (ratio1 > 0 && ratio2 > 0)) && ratio1 > 0 && ratio2 > 0) {
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      if (pieceData.repeating_ratio) {
        const maxK = pieceData.max_ratio_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            return true;
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          return true;
        }
      }
    }
    }

    // Check step-by-step movement
    const rawStepValue = pieceData.step_by_step_movement_value ?? pieceData.step_movement_value;
    const stepValue = Number(rawStepValue);
    if (!Number.isNaN(stepValue) && stepValue !== 0) {
      const maxSteps = Math.abs(stepValue);
      const noDiagonal = stepValue < 0;

      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        return manhattanDistance > 0 && manhattanDistance <= maxSteps;
      }

      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return chebyshevDistance > 0 && chebyshevDistance <= maxSteps;
    }

    // Check additional movements from special_scenario_moves
    if (pieceData.special_scenario_moves) {
      try {
        const parsed = typeof pieceData.special_scenario_moves === 'string'
          ? JSON.parse(pieceData.special_scenario_moves)
          : pieceData.special_scenario_moves;
        const additionalMovements = parsed?.additionalMovements || {};
        
        const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        
        // Determine direction
        let direction = null;
        if (rowDiff < 0 && colDiff === 0) direction = 'up';
        else if (rowDiff > 0 && colDiff === 0) direction = 'down';
        else if (rowDiff === 0 && colDiff < 0) direction = 'left';
        else if (rowDiff === 0 && colDiff > 0) direction = 'right';
        else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
        else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
        else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
        else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
        
        if (direction && additionalMovements[direction]) {
          for (const movementOption of additionalMovements[direction]) {
            if (skipExactRatio && movementOption.exact) continue;
            const value = movementOption.value || 0;
            const matches = (movementOption.infinite && distance > 0) ||
                           (movementOption.exact && distance === value) ||
                           (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value);
            if (matches) {
              return true;
            }
          }
        }
      } catch (e) {
        console.error('Error parsing special_scenario_moves:', e);
      }
    }

    // Check custom movement squares
    if (!skipCustom && pieceData.custom_movement_squares) {
      try {
        const customSquares = typeof pieceData.custom_movement_squares === 'string'
          ? JSON.parse(pieceData.custom_movement_squares)
          : pieceData.custom_movement_squares;
        if (Array.isArray(customSquares)) {
          for (const sq of customSquares) {
            if (rowDiff === sq.row && colDiff === sq.col) {
              return true;
            }
          }
        }
      } catch { /* ignore */ }
    }

    return false;
  }, []);

  // Check if piece can capture on a square
  // skipExactRatio: when true, skip exact directional and ratio checks (for hop-only validation)
  const canPieceCaptureTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio = false, skipCustom = false) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    if (!skipExactRatio) {
    const utilCaptureResult = canCaptureOnMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    if (utilCaptureResult.allowed && !(skipCustom && utilCaptureResult.isCustomOnly)) {
      return true;
    }
    }

    // For player 2, flip the perspective (mirror both row and column)
    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check if separate capture fields are defined
    const hasSeparateCaptureFields = pieceData.up_capture || pieceData.down_capture || 
                                     pieceData.left_capture || pieceData.right_capture || 
                                     pieceData.up_left_capture || pieceData.up_right_capture ||
                                     pieceData.down_left_capture || pieceData.down_right_capture ||
                                     pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                                     pieceData.step_capture_value ||
                                     pieceData.special_scenario_captures;

    // If piece can capture on move AND no separate capture fields, use movement logic
    if ((pieceData.can_capture_enemy_on_move === 1 || pieceData.can_capture_enemy_on_move === true) && !hasSeparateCaptureFields) {
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio);
    }

    // Check directional capture - check if any capture fields have values
    const hasDirectionalCapture = pieceData.up_capture || pieceData.down_capture || pieceData.left_capture || 
                                   pieceData.right_capture || pieceData.up_left_capture || pieceData.up_right_capture ||
                                   pieceData.down_left_capture || pieceData.down_right_capture;
    
    if (hasDirectionalCapture) {
      let directionalAllowed = false;
      const repC = pieceData.repeating_capture;

      if (rowDiff < 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.up_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_capture, pieceData.up_capture_exact), Math.abs(rowDiff), repC && pieceData.up_capture_exact);
      } else if (rowDiff > 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.down_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_capture, pieceData.down_capture_exact), Math.abs(rowDiff), repC && pieceData.down_capture_exact);
      } else if (rowDiff === 0 && colDiff < 0) {
        if (!(skipExactRatio && pieceData.left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.left_capture, pieceData.left_capture_exact), Math.abs(colDiff), repC && pieceData.left_capture_exact);
      } else if (rowDiff === 0 && colDiff > 0) {
        if (!(skipExactRatio && pieceData.right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.right_capture, pieceData.right_capture_exact), Math.abs(colDiff), repC && pieceData.right_capture_exact);
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_left_capture, pieceData.up_left_capture_exact), Math.abs(rowDiff), repC && pieceData.up_left_capture_exact);
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_right_capture, pieceData.up_right_capture_exact), Math.abs(rowDiff), repC && pieceData.up_right_capture_exact);
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_left_capture, pieceData.down_left_capture_exact), Math.abs(rowDiff), repC && pieceData.down_left_capture_exact);
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_right_capture, pieceData.down_right_capture_exact), Math.abs(rowDiff), repC && pieceData.down_right_capture_exact);
      }

      if (directionalAllowed) return true;
    }

    // Check ratio capture (L-shape)
    if (!skipExactRatio) {
    const ratio1 = pieceData.ratio_capture_1 || 0;
    const ratio2 = pieceData.ratio_capture_2 || 0;
    if (ratio1 > 0 && ratio2 > 0) {
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      if (pieceData.repeating_ratio_capture) {
        const maxK = pieceData.max_ratio_capture_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_capture_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            return true;
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          return true;
        }
      }
    }
    }

    // Check step-by-step capture - use sign-based diagonal exclusion
    const rawStepCaptureValue = pieceData.step_capture_value ?? pieceData.step_by_step_capture;
    const stepCaptureValue = Number(rawStepCaptureValue);
    if (!Number.isNaN(stepCaptureValue) && stepCaptureValue !== 0) {
      const maxSteps = Math.abs(stepCaptureValue);
      const noDiagonal = stepCaptureValue < 0;

      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        return manhattanDistance > 0 && manhattanDistance <= maxSteps;
      }

      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return chebyshevDistance > 0 && chebyshevDistance <= maxSteps;
    }

    // Check additional captures from special_scenario_captures
    if (pieceData.special_scenario_captures) {
      try {
        const parsed = typeof pieceData.special_scenario_captures === 'string'
          ? JSON.parse(pieceData.special_scenario_captures)
          : pieceData.special_scenario_captures;
        const additionalCaptures = parsed?.additionalCaptures || {};
        
        const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        
        // Determine direction
        let direction = null;
        if (rowDiff < 0 && colDiff === 0) direction = 'up';
        else if (rowDiff > 0 && colDiff === 0) direction = 'down';
        else if (rowDiff === 0 && colDiff < 0) direction = 'left';
        else if (rowDiff === 0 && colDiff > 0) direction = 'right';
        else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
        else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
        else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
        else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
        
        if (direction && additionalCaptures[direction]) {
          for (const captureOption of additionalCaptures[direction]) {
            if (skipExactRatio && captureOption.exact) continue;
            const value = captureOption.value || 0;
            if (captureOption.infinite && distance > 0) return true;
            if (captureOption.exact && distance === value) return true;
            if (!captureOption.exact && !captureOption.infinite && distance > 0 && distance <= value) return true;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    // If piece can capture where it moves AND has no separate capture fields, also check movement as fallback
    if ((pieceData.can_capture_enemy_on_move === 1 || pieceData.can_capture_enemy_on_move === true) && !hasSeparateCaptureFields) {
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio, skipCustom);
    }

    // Check custom attack squares
    if (!skipCustom && pieceData.custom_attack_squares) {
      try {
        const customSquares = typeof pieceData.custom_attack_squares === 'string'
          ? JSON.parse(pieceData.custom_attack_squares)
          : pieceData.custom_attack_squares;
        if (Array.isArray(customSquares)) {
          for (const sq of customSquares) {
            if (rowDiff === sq.row && colDiff === sq.col) {
              return true;
            }
          }
        }
      } catch { /* ignore */ }
    }

    return false;
  }, [canPieceMoveTo]);

  // Check if path is clear for sliding pieces (no pieces in between)
  const isPathClear = useCallback((fromX, fromY, toX, toY, pieces, pieceData, isCapture = false) => {
    // Ghostwalk: piece can pass through any piece
    const hasGhostwalk = pieceData?.ghostwalk === 1 || pieceData?.ghostwalk === true;
    if (hasGhostwalk) return true;

    const pieceTeam = pieceData?.player_id || pieceData?.team;
    let canHopAllies, canHopEnemies;
    if (isCapture) {
      const dirHopDisabledAtk = pieceData?.directional_hop_disabled_attack === 1 || pieceData?.directional_hop_disabled_attack === true;
      canHopAllies = !dirHopDisabledAtk && (pieceData?.can_hop_attack_over_allies === 1 || pieceData?.can_hop_attack_over_allies === true);
      canHopEnemies = !dirHopDisabledAtk && (pieceData?.can_hop_attack_over_enemies === 1 || pieceData?.can_hop_attack_over_enemies === true);
    } else {
      const directionalHopDisabled = pieceData?.directional_hop_disabled === 1 || pieceData?.directional_hop_disabled === true;
      canHopAllies = !directionalHopDisabled && (pieceData?.can_hop_over_allies === 1 || pieceData?.can_hop_over_allies === true);
      canHopEnemies = !directionalHopDisabled && (pieceData?.can_hop_over_enemies === 1 || pieceData?.can_hop_over_enemies === true);
    }

    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    
    // Check if it's a knight-like move (L-shape)
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      return true;
    }

    let x = fromX + dx;
    let y = fromY + dy;

    while (x !== toX || y !== toY) {
      const blockingPiece = findPieceAtSquare(pieces, x, y);
      if (blockingPiece) {
        const blockingTeam = blockingPiece.player_id || blockingPiece.team;
        const isAlly = blockingTeam === pieceTeam;
        
        if (isAlly && !canHopAllies) return false;
        if (!isAlly && !canHopEnemies) return false;
      }
      x += dx;
      y += dy;
    }

    return true;
  }, []);

  // Helper to check both possible L-shaped paths
  const checkBothLPaths = useCallback((fromX, fromY, dx, dy, absDx, absDy, pieces, canHopOver) => {
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const targetX = fromX + dx;
    const targetY = fromY + dy;
    
    // Path 1: Move along X axis first, then Y axis
    let path1Clear = true;
    // Move along X
    for (let i = 1; i <= absDx; i++) {
      const checkX = fromX + (stepX * i);
      const checkY = fromY;
      if (checkX !== targetX || checkY !== targetY) {
        const obstruction = findPieceAtSquare(pieces, checkX, checkY);
        if (obstruction && !canHopOver(obstruction)) {
          path1Clear = false;
          break;
        }
      }
    }
    // Then move along Y from the end of X movement
    if (path1Clear) {
      for (let i = 1; i <= absDy; i++) {
        const checkX = fromX + (stepX * absDx);
        const checkY = fromY + (stepY * i);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = findPieceAtSquare(pieces, checkX, checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path1Clear = false;
            break;
          }
        }
      }
    }
    
    // Path 2: Move along Y axis first, then X axis
    let path2Clear = true;
    // Move along Y
    for (let i = 1; i <= absDy; i++) {
      const checkX = fromX;
      const checkY = fromY + (stepY * i);
      if (checkX !== targetX || checkY !== targetY) {
        const obstruction = findPieceAtSquare(pieces, checkX, checkY);
        if (obstruction && !canHopOver(obstruction)) {
          path2Clear = false;
          break;
        }
      }
    }
    // Then move along X from the end of Y movement
    if (path2Clear) {
      for (let i = 1; i <= absDx; i++) {
        const checkX = fromX + (stepX * i);
        const checkY = fromY + (stepY * absDy);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = findPieceAtSquare(pieces, checkX, checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path2Clear = false;
            break;
          }
        }
      }
    }
    
    return path1Clear || path2Clear;
  }, []);

  // Check if L-shape path is clear considering hopping abilities
  const checkRatioPathClear = useCallback((piece, targetX, targetY, pieces) => {
    const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
    const canHopEnemies = piece.can_hop_over_enemies === 1 || piece.can_hop_over_enemies === true;
    const hasGhostwalk = piece.ghostwalk === 1 || piece.ghostwalk === true;
    
    // If ghostwalk or can hop over everything, path is always clear
    if (hasGhostwalk || (canHopAllies && canHopEnemies)) {
      return true;
    }
    
    const pieceOwner = piece.player_id || piece.team;
    const dx = targetX - piece.x;
    const dy = targetY - piece.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    // If no hopping ability, check if both L-shape paths are clear
    if (!canHopAllies && !canHopEnemies) {
      return checkBothLPaths(piece.x, piece.y, dx, dy, absDx, absDy, pieces, () => false);
    }
    
    // Helper to check if piece can hop over an obstruction
    const canHopOver = (obstruction) => {
      const obstructionOwner = obstruction.player_id || obstruction.team;
      const isAlly = obstructionOwner === pieceOwner;
      return (isAlly && canHopAllies) || (!isAlly && canHopEnemies);
    };
    
    return checkBothLPaths(piece.x, piece.y, dx, dy, absDx, absDy, pieces, canHopOver);
  }, [checkBothLPaths]);

  const getStepMovementConfig = useCallback((piece) => {
    const stepValueRaw = piece?.step_by_step_movement_value ?? piece?.step_movement_value;
    const stepValue = Number(stepValueRaw);
    if (Number.isNaN(stepValue) || stepValue === 0) {
      return null;
    }

    return {
      maxSteps: Math.abs(stepValue),
      noDiagonal: stepValue < 0
    };
  }, []);

  const isStepByStepTarget = useCallback((piece, fromX, fromY, toX, toY) => {
    const config = getStepMovementConfig(piece);
    if (!config) {
      return false;
    }

    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    if (dx === 0 && dy === 0) {
      return false;
    }

    if (config.noDiagonal) {
      return dx + dy <= config.maxSteps;
    }

    return Math.max(dx, dy) <= config.maxSteps;
  }, [getStepMovementConfig]);

  const canReachStepByStep = useCallback((piece, targetX, targetY, pieces, boardWidth, boardHeight, allowOccupiedTarget = false) => {
    const config = getStepMovementConfig(piece);
    if (!config) {
      return false;
    }

    const hasGhostwalk = piece.ghostwalk === 1 || piece.ghostwalk === true;

    const occupied = new Set();
    if (!hasGhostwalk) {
      pieces.filter(p => p.id !== piece.id).forEach(p => {
        const pw = p.piece_width || 1;
        const ph = p.piece_height || 1;
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            occupied.add(`${p.x + dx},${p.y + dy}`);
          }
        }
      });
    }

    const queue = [{ x: piece.x, y: piece.y, steps: 0 }];
    const visited = new Set([`${piece.x},${piece.y}`]);
    const directions = config.noDiagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.steps >= config.maxSteps) {
        continue;
      }

      for (const [dirX, dirY] of directions) {
        const nextX = current.x + dirX;
        const nextY = current.y + dirY;

        if (nextX < 0 || nextY < 0 || nextX >= boardWidth || nextY >= boardHeight) {
          continue;
        }

        const isTarget = nextX === targetX && nextY === targetY;
        const nextKey = `${nextX},${nextY}`;
        const hasPiece = occupied.has(nextKey);

        if (hasPiece && !(allowOccupiedTarget && isTarget)) {
          continue;
        }

        if (isTarget) {
          return true;
        }

        if (visited.has(nextKey)) {
          continue;
        }

        visited.add(nextKey);
        queue.push({ x: nextX, y: nextY, steps: current.steps + 1 });
      }
    }

    return false;
  }, [getStepMovementConfig]);

  // BFS path-finding for step-by-step ranged attacks.
  // Respects can_fire_over_allies / can_fire_over_enemies so walls of pieces
  // correctly block the projectile.
  const canReachStepByStepRanged = useCallback((piece, targetX, targetY, allPieces, boardWidth, boardHeight) => {
    const stepAttackValue = piece.step_by_step_attack_range;
    if (!stepAttackValue) return false;
    const maxSteps = Math.abs(stepAttackValue);
    const noDiagonal = stepAttackValue < 0;
    const canFireOverAllies = piece.can_fire_over_allies === 1 || piece.can_fire_over_allies === true;
    const canFireOverEnemies = piece.can_fire_over_enemies === 1 || piece.can_fire_over_enemies === true;
    const pieceTeam = piece.player_id || piece.team;
    const directions = noDiagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const queue = [{ x: piece.x, y: piece.y, steps: 0 }];
    const visited = new Set([`${piece.x},${piece.y}`]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.steps >= maxSteps) continue;
      for (const [dirX, dirY] of directions) {
        const nx = current.x + dirX;
        const ny = current.y + dirY;
        if (nx < 0 || ny < 0 || nx >= boardWidth || ny >= boardHeight) continue;
        const isTarget = nx === targetX && ny === targetY;
        const nextKey = `${nx},${ny}`;
        const pieceAtSquare = findPieceAtSquare(allPieces, nx, ny);
        const squareTeam = pieceAtSquare?.player_id || pieceAtSquare?.team;
        const isAlly = pieceAtSquare && squareTeam === pieceTeam;
        const isEnemy = pieceAtSquare && squareTeam !== pieceTeam;
        if (isAlly) {
          // Ally blocks unless can fire over allies
          if (canFireOverAllies && !visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push({ x: nx, y: ny, steps: current.steps + 1 });
          }
          // Ally squares are never valid targets
        } else if (isEnemy) {
          // Enemy: always a valid target; can continue BFS only if can fire over enemies
          if (isTarget) return true;
          if (canFireOverEnemies && !visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push({ x: nx, y: ny, steps: current.steps + 1 });
          }
        } else {
          // Empty square: valid target (for hover/premove display); always traversable
          if (isTarget) return true;
          if (!visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push({ x: nx, y: ny, steps: current.steps + 1 });
          }
        }
      }
    }
    return false;
  }, []);

  // Apply range square bonus to a piece: +1 to all non-infinite, non-zero movement/capture/attack values
  const applyRangeSquareBonus = useCallback((piece) => {
    const rangeSquares = specialSquares?.range;
    if (!rangeSquares || Object.keys(rangeSquares).length === 0) return piece;

    const key = `${piece.y},${piece.x}`;
    if (!rangeSquares[key]) return piece;

    const bonus = rangeSquares[key].rangeBonus || 1;
    const boosted = { ...piece };

    const boost = (val) => {
      if (!val || val === 0 || val === 99) return val;
      if (val < 0) return val - bonus;
      return val + bonus;
    };

    const directions = ['up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'];
    for (const dir of directions) {
      if (boosted[`${dir}_movement`]) boosted[`${dir}_movement`] = boost(boosted[`${dir}_movement`]);
      if (boosted[`${dir}_capture`]) boosted[`${dir}_capture`] = boost(boosted[`${dir}_capture`]);
      if (boosted[`${dir}_attack_range`]) boosted[`${dir}_attack_range`] = boost(boosted[`${dir}_attack_range`]);
    }

    if (boosted.step_by_step_movement_value) boosted.step_by_step_movement_value = boost(boosted.step_by_step_movement_value);
    if (boosted.step_movement_value) boosted.step_movement_value = boost(boosted.step_movement_value);
    if (boosted.step_capture_value) boosted.step_capture_value = boost(boosted.step_capture_value);
    if (boosted.step_by_step_attack_range) boosted.step_by_step_attack_range = boost(boosted.step_by_step_attack_range);

    if (boosted.ratio_movement_1) boosted.ratio_movement_1 = boost(boosted.ratio_movement_1);
    if (boosted.ratio_movement_2) boosted.ratio_movement_2 = boost(boosted.ratio_movement_2);
    if (boosted.ratio_one_attack_range) boosted.ratio_one_attack_range = boost(boosted.ratio_one_attack_range);
    if (boosted.ratio_two_attack_range) boosted.ratio_two_attack_range = boost(boosted.ratio_two_attack_range);

    if (boosted.special_scenario_moves) {
      try {
        const parsed = typeof boosted.special_scenario_moves === 'string'
          ? JSON.parse(boosted.special_scenario_moves)
          : { ...boosted.special_scenario_moves };
        if (parsed.additionalMovements) {
          const boostedMoves = {};
          for (const [dir, moveOptions] of Object.entries(parsed.additionalMovements)) {
            boostedMoves[dir] = moveOptions.map(opt => {
              if (opt.infinite || !opt.value) return opt;
              return { ...opt, value: opt.value + bonus };
            });
          }
          parsed.additionalMovements = boostedMoves;
        }
        if (parsed.additionalCaptures) {
          const boostedCaptures = {};
          for (const [dir, captureOptions] of Object.entries(parsed.additionalCaptures)) {
            boostedCaptures[dir] = captureOptions.map(opt => {
              if (opt.infinite || !opt.value) return opt;
              return { ...opt, value: opt.value + bonus };
            });
          }
          parsed.additionalCaptures = boostedCaptures;
        }
        boosted.special_scenario_moves = typeof piece.special_scenario_moves === 'string'
          ? JSON.stringify(parsed) : parsed;
        boosted.special_scenario_captures = typeof piece.special_scenario_captures === 'string'
          ? JSON.stringify(parsed) : parsed;
      } catch (e) { /* ignore */ }
    }

    return boosted;
  }, [specialSquares]);

  // Check if a specific piece is under attack by any enemy piece
  const isPieceUnderAttack = useCallback((targetPiece, pieces, boardWidth, boardHeight) => {
    if (targetPiece.cannot_be_captured) return false;
    const targetTeam = targetPiece.player_id || targetPiece.team;
    const tw = targetPiece.piece_width || 1;
    const th = targetPiece.piece_height || 1;
    
    // Check all enemy pieces against ALL occupied squares of the target
    for (let enemyPiece of pieces) {
      const enemyTeam = enemyPiece.player_id || enemyPiece.team;
      if (enemyTeam === targetTeam) continue; // Skip friendly pieces
      
      // Apply range square bonus to attacking piece
      enemyPiece = applyRangeSquareBonus(enemyPiece);
      
      const ew = enemyPiece.piece_width || 1;
      const eh = enemyPiece.piece_height || 1;
      
      // For multi-tile target, check each occupied square
      for (let dy = 0; dy < th; dy++) {
        for (let dx = 0; dx < tw; dx++) {
          const sx = targetPiece.x + dx;
          const sy = targetPiece.y + dy;
          
          // For multi-tile attackers, check all anchor destinations that put (sx, sy) in footprint
          for (let edy = 0; edy < eh; edy++) {
            for (let edx = 0; edx < ew; edx++) {
              const adx = sx - edx; // potential anchor destination x
              const ady = sy - edy; // potential anchor destination y
              
              if (canPieceCaptureTo(enemyPiece.x, enemyPiece.y, adx, ady, enemyPiece, enemyTeam)) {
                const isRatioMove = enemyPiece.ratio_capture_1 > 0 && enemyPiece.ratio_capture_2 > 0 &&
                                   ((Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_capture_1 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_capture_2) ||
                                    (Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_capture_2 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_capture_1));
                
                const usesRatioForCapture = !isRatioMove && enemyPiece.attacks_like_movement && 
                                             enemyPiece.ratio_movement_1 > 0 && enemyPiece.ratio_movement_2 > 0 &&
                                             ((Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_movement_1 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_movement_2) ||
                                              (Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_movement_2 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_movement_1));
                
                const isStepMove = isStepByStepTarget(enemyPiece, enemyPiece.x, enemyPiece.y, adx, ady);

                let pathClear = false;
                if (isRatioMove || usesRatioForCapture) {
                  pathClear = checkRatioPathClear(enemyPiece, adx, ady, pieces);
                } else if (isStepMove) {
                  pathClear = canReachStepByStep(enemyPiece, adx, ady, pieces, boardWidth, boardHeight, true);
                } else {
                  pathClear = isPathClear(enemyPiece.x, enemyPiece.y, adx, ady, pieces, enemyPiece, true);
                }
                
                if (pathClear) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  }, [canPieceCaptureTo, isPathClear, checkRatioPathClear, isStepByStepTarget, canReachStepByStep, applyRangeSquareBonus]);

  // Check if a player is in check (any piece with ends_game_on_checkmate is under attack)
  const checkForCheck = useCallback((pieces, playerPosition, boardWidth, boardHeight) => {
    // Find all pieces belonging to this player that have ends_game_on_checkmate
    const checkmatePieces = pieces.filter(p => {
      const pieceOwnerPosition = p.team || p.player_id;
      return pieceOwnerPosition === playerPosition && p.ends_game_on_checkmate;
    });
    
    if (checkmatePieces.length === 0) {
      return { inCheck: false, checkedPieces: [] };
    }
    
    const checkedPieces = [];
    for (const piece of checkmatePieces) {
      if (isPieceUnderAttack(piece, pieces, boardWidth, boardHeight)) {
        checkedPieces.push(piece);
      }
    }
    
    return {
      inCheck: checkedPieces.length > 0,
      checkedPieces
    };
  }, [isPieceUnderAttack]);

  // Check if a move would resolve check (or not leave the player in check)
  const wouldMoveResolveCheck = useCallback((piece, toX, toY, pieces, playerPosition, boardWidth, boardHeight) => {
    // Create a simulated pieces array
    const simulatedPieces = pieces.map(p => ({ ...p }));
    
    // Find and remove ALL enemy pieces in the destination footprint (multi-tile captures all)
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    const pieceOwner = piece.player_id || piece.team;
    const capturedIds = new Set();
    if (pw > 1 || ph > 1) {
      for (let fdy = 0; fdy < ph; fdy++) {
        for (let fdx = 0; fdx < pw; fdx++) {
          const found = simulatedPieces.find(p => {
            if (p.id === piece.id || capturedIds.has(p.id)) return false;
            if (!doesPieceOccupySquare(p, toX + fdx, toY + fdy)) return false;
            const pOwner = p.player_id || p.team;
            return pOwner !== pieceOwner;
          });
          if (found) capturedIds.add(found.id);
        }
      }
    } else {
      const found = simulatedPieces.find(p => p.id !== piece.id && doesPieceOccupySquare(p, toX, toY));
      if (found) {
        const fOwner = found.player_id || found.team;
        if (fOwner !== pieceOwner) capturedIds.add(found.id);
      }
    }
    if (capturedIds.size > 0) {
      for (let i = simulatedPieces.length - 1; i >= 0; i--) {
        if (capturedIds.has(simulatedPieces[i].id)) {
          simulatedPieces.splice(i, 1);
        }
      }
    }
    
    // Update the moving piece's position
    const movingPieceIndex = simulatedPieces.findIndex(p => p.id === piece.id);
    if (movingPieceIndex !== -1) {
      simulatedPieces[movingPieceIndex] = { ...simulatedPieces[movingPieceIndex], x: toX, y: toY };
    }
    
    // Check if player would still be in check after this move
    const checkResult = checkForCheck(simulatedPieces, playerPosition, boardWidth, boardHeight);
    return !checkResult.inCheck;
  }, [checkForCheck]);

  // Calculate valid moves for a piece using actual piece movement data
  // forPremove: when true, includes potential capture squares even when empty (for premove highlighting)
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight, skipCheckFilter = false, forPremove = false, forHoverDisplay = false, forFog = false) => {
    // Apply range square bonus
    piece = applyRangeSquareBonus(piece);

    let moves = [];
    const pieceTeam = piece.player_id || piece.team;
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;

    // Determine whether this piece's first-move-only abilities are blocked because of
    // custom-square configuration:
    //   - "Disable first-move abilities here" (disableFirstMoveHere) on the piece's CURRENT square
    //   - "Restrict first-move to these squares" (restrictFirstMoveToCustom) set somewhere on the
    //      board, with the piece NOT currently on one of those squares.
    // When true, any move tagged isFirstMoveOnly should be filtered out (highlights match the
    // server-side rules in shouldBlockFirstMoveAbilities).
    const customSquareMap = specialSquares?.special || {};
    let blockFirstMove = false;
    {
      const currentCfg = customSquareMap[`${piece.y},${piece.x}`];
      if (currentCfg && currentCfg.disableFirstMoveHere) {
        blockFirstMove = true;
      } else {
        let restrictExists = false;
        let onAllowed = false;
        for (const [key, cfg] of Object.entries(customSquareMap)) {
          if (cfg && cfg.restrictFirstMoveToCustom) {
            restrictExists = true;
            if (key === `${piece.y},${piece.x}`) onAllowed = true;
          }
        }
        if (restrictExists && !onAllowed) blockFirstMove = true;
      }
    }

    for (let toY = 0; toY < boardHeight; toY++) {
      for (let toX = 0; toX < boardWidth; toX++) {
        // Skip current position
        if (toX === piece.x && toY === piece.y) continue;

        // For multi-tile pieces, check the piece would fit on the board
        if (!doesPieceFitOnBoard(toX, toY, pw, ph, boardWidth, boardHeight)) continue;

        // For multi-tile pieces, scan entire destination footprint for enemies
        let occupyingPiece = null;
        let blockedByInvincible = false;
        if (pw > 1 || ph > 1) {
          // Find any enemy (or ally if can_capture_allies) in the destination footprint
          for (let dy = 0; dy < ph && !blockedByInvincible; dy++) {
            for (let dx = 0; dx < pw && !blockedByInvincible; dx++) {
              const found = pieces.find(p =>
                p.id !== piece.id && doesPieceOccupySquare(p, toX + dx, toY + dy)
              );
              if (found) {
                const foundTeam = found.player_id || found.team;
                const isFriendly = foundTeam === pieceTeam;
                if (forPremove && isFriendly && !piece.can_capture_allies) {
                  // For premoves: block only own checkmate piece, ignore other friendlies
                  if (found.ends_game_on_checkmate) {
                    blockedByInvincible = true;
                  }
                } else if (forPremove && !isFriendly && found.ends_game_on_checkmate) {
                  // For premoves: allow targeting enemy checkmate pieces (they might move away)
                  // but still block invincible pieces
                  if (found.cannot_be_captured) blockedByInvincible = true;
                } else if (found.cannot_be_captured || found.ends_game_on_checkmate) {
                  blockedByInvincible = true;
                } else if ((foundTeam !== pieceTeam || piece.can_capture_allies) && !occupyingPiece) {
                  occupyingPiece = found; // Track first enemy for capture flag
                }
              }
            }
          }
          if (blockedByInvincible) continue;
          // Only friendly pieces should block the destination (enemies are captured)
          // For premoves, skip this check (friendly pieces might be captured before premove executes)
          if (!forPremove && !isDestinationClear(piece, toX, toY, pieces.filter(p => {
            const pTeam = p.player_id || p.team;
            return pTeam === pieceTeam && p.id !== piece.id;
          }), null)) continue;
        } else {
          occupyingPiece = findPieceAtSquare(pieces, toX, toY);
          const occupyingTeam = occupyingPiece?.player_id || occupyingPiece?.team;
          const isFriendlyTarget = occupyingPiece && occupyingPiece.id !== piece.id && occupyingTeam === pieceTeam;
          // Skip if enemy piece cannot be captured or is a checkmate piece
          // For premoves: allow targeting enemy checkmate pieces (they might move away)
          if (occupyingPiece && occupyingPiece.id !== piece.id && !isFriendlyTarget) {
            if (occupyingPiece.cannot_be_captured) continue;
            if (occupyingPiece.ends_game_on_checkmate && !forPremove) continue;
          }
          // Handle friendly pieces at target
          const simulAllyCapture = !!(gameState?.gameType?.simultaneous_turns && (piece.can_capture_enemy_on_move || piece.can_capture_enemy_via_range));
          if (isFriendlyTarget && !piece.can_capture_allies && !simulAllyCapture) {
            if (forPremove) {
              // Allow premove targeting friendly pieces (enemy might capture them first)
              // Exception: never premove-target own checkmate piece (e.g. your king)
              if (occupyingPiece.ends_game_on_checkmate) continue;
              occupyingPiece = null; // Treat as potentially empty
            } else {
              continue;
            }
          }
          // Skip moves to squares within the piece's own footprint
          if (occupyingPiece && occupyingPiece.id === piece.id) continue;
        }

        const isCapture = !!(occupyingPiece && occupyingPiece.id !== piece.id);

        // Check if move is valid based on piece movement rules
        let isValidMove = false;
        let isPotentialCapture = false; // For premoves: empty square that could be a capture
        
        if (isCapture) {
          // Check capture rules
          isValidMove = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
        } else {
          // Check movement rules
          isValidMove = canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          
          // For premoves or fog: also check if this empty square is a valid capture square
          // (e.g., pawn diagonal attack - for premoves the piece might move there;
          //  for fog the piece can "see" squares it can attack even without a target).
          if ((forPremove || forFog) && !isValidMove) {
            const canCaptureThere = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
            if (canCaptureThere) {
              isValidMove = true;
              isPotentialCapture = true;
            }
          }
        }

        // Check if this is a custom-square-only move (direct jump, no path check needed).
        // Use raw absolute offsets (toY - piece.y, toX - piece.x) — this matches the server-side
        // logic which applies custom squares as (cy + sq.row, cx + sq.col) with no perspective flip.
        // This avoids the perspective-flip mismatch that can occur when using canPieceMoveTo/
        // canPieceCaptureTo with skipCustom=true to detect custom squares for opponent pieces.
        let isCustomSquareMove = false;
        if (isValidMove) {
          const rawRowOffset = toY - piece.y;
          const rawColOffset = toX - piece.x;
          // For captures, prefer custom_attack_squares; fall back to custom_movement_squares
          // when can_capture_enemy_on_move is set (piece captures using its movement pattern).
          const atkCustom = piece.custom_attack_squares;
          const movCustom = piece.custom_movement_squares;
          const toCheckCustom = isCapture
            ? (atkCustom || (piece.can_capture_enemy_on_move ? movCustom : null))
            : movCustom;
          if (toCheckCustom) {
            try {
              const customs = typeof toCheckCustom === 'string' ? JSON.parse(toCheckCustom) : toCheckCustom;
              if (Array.isArray(customs) && customs.some(sq => sq.row === rawRowOffset && sq.col === rawColOffset)) {
                isCustomSquareMove = true;
              }
            } catch { /* ignore */ }
          }
        }

        // If move is valid, check if path is clear
        // For ratio movements (L-shape), use special path checking
        const ratio1m = piece.ratio_movement_1 || 0;
        const ratio2m = piece.ratio_movement_2 || 0;
        const absRowDist = Math.abs(toY - piece.y);
        const absColDist = Math.abs(toX - piece.x);
        let isRatioMove = false;
        if (ratio1m > 0 && ratio2m > 0) {
          if ((absColDist === ratio1m && absRowDist === ratio2m) ||
              (absColDist === ratio2m && absRowDist === ratio1m)) {
            isRatioMove = true;
          } else if (piece.repeating_ratio) {
            const maxK = piece.max_ratio_iterations === -1 ? Math.max(absRowDist, absColDist) : (piece.max_ratio_iterations || 1);
            for (let k = 2; k <= maxK; k++) {
              if ((absRowDist === k * ratio2m && absColDist === k * ratio1m) ||
                  (absRowDist === k * ratio1m && absColDist === k * ratio2m)) {
                isRatioMove = true;
                break;
              }
            }
          }
        }
        // Also check ratio capture
        const rc1 = piece.ratio_capture_1 || 0;
        const rc2 = piece.ratio_capture_2 || 0;
        if (!isRatioMove && rc1 > 0 && rc2 > 0 && isCapture) {
          if ((absRowDist === rc1 && absColDist === rc2) ||
              (absRowDist === rc2 && absColDist === rc1)) {
            isRatioMove = true;
          } else if (piece.repeating_ratio_capture) {
            const maxK = piece.max_ratio_capture_iterations === -1 ? Math.max(absRowDist, absColDist) : (piece.max_ratio_capture_iterations || 1);
            for (let k = 2; k <= maxK; k++) {
              if ((absRowDist === k * rc1 && absColDist === k * rc2) ||
                  (absRowDist === k * rc2 && absColDist === k * rc1)) {
                isRatioMove = true;
                break;
              }
            }
          }
        }
        
        const isStepMove = isStepByStepTarget(piece, piece.x, piece.y, toX, toY);

        let pathClear = false;
        if (forPremove) {
          // Premoves skip path checking — pieces may move out of the way before execution
          pathClear = true;
        } else if (isCustomSquareMove) {
          // Custom square moves are direct jumps — no path obstruction
          pathClear = true;
        } else if (isRatioMove) {
          // Check L-shape paths with hopping abilities
          pathClear = checkRatioPathClear(piece, toX, toY, pieces);
        } else if (isStepMove) {
          pathClear = canReachStepByStep(piece, toX, toY, pieces, boardWidth, boardHeight, isCapture);
        } else if (pw > 1 || ph > 1) {
          // For multi-tile pieces, check path from ALL sub-squares to their destination sub-squares
          pathClear = true;
          for (let sdy = 0; sdy < ph && pathClear; sdy++) {
            for (let sdx = 0; sdx < pw && pathClear; sdx++) {
              if (!isPathClear(piece.x + sdx, piece.y + sdy, toX + sdx, toY + sdy, pieces, piece, isCapture)) {
                pathClear = false;
              }
            }
          }
        } else {
          pathClear = isPathClear(piece.x, piece.y, toX, toY, pieces, piece, isCapture);
        }

        // For repeating ratio moves, check intermediate landing positions are clear.
        // Only applies when hop_stop_at_occupied is explicitly true (1).
        // When false/null/undefined the piece hops past occupied intermediate multiples.
        const hopStopAtOccupied = piece.hop_stop_at_occupied === 1 || piece.hop_stop_at_occupied === true;
        if (pathClear && isRatioMove && hopStopAtOccupied) {
          const rr1 = isCapture ? (rc1 || ratio1m) : ratio1m;
          const rr2 = isCapture ? (rc2 || ratio2m) : ratio2m;
          if (rr1 > 0 && rr2 > 0) {
            let stepRow = 0, stepCol = 0;
            const rowSign = Math.sign(toY - piece.y);
            const colSign = Math.sign(toX - piece.x);
            if (absRowDist > 0 && absColDist > 0) {
              if (absRowDist % rr1 === 0 && absColDist % rr2 === 0 && absRowDist / rr1 === absColDist / rr2) {
                stepRow = rr1 * rowSign; stepCol = rr2 * colSign;
              } else if (absRowDist % rr2 === 0 && absColDist % rr1 === 0 && absRowDist / rr2 === absColDist / rr1) {
                stepRow = rr2 * rowSign; stepCol = rr1 * colSign;
              }
            }
            if (stepRow !== 0 || stepCol !== 0) {
              let cx = piece.x + stepCol;
              let cy = piece.y + stepRow;
              while (cx !== toX || cy !== toY) {
                const blocking = findPieceAtSquare(pieces, cx, cy);
                if (blocking && blocking.id !== piece.id) {
                  pathClear = false;
                  break;
                }
                cx += stepCol;
                cy += stepRow;
              }
            }
          }
        }

        // Hop capture: piece has capture_on_hop, destination is empty, enemies are in the path.
        // capture_on_hop inherently means the piece hops over enemies to capture them (like checkers),
        // so enemies in the path are always hoppable — no separate can_hop_over_enemies flag needed.
        // The destination must be within the piece's normal movement/capture range.
        let isHopCapture = false;
        let hopCapturedPieceIds = [];
        if (!isCapture && piece.capture_on_hop && !isStepMove && !isRatioMove) {
          // Hop capture only works if the destination is within the piece's actual movement/capture range.
          // isValidMove already tells us if normal movement covers this square.
          // If not, check if the capture range covers it.
          let hopDirValid = isValidMove;
          if (!hopDirValid) {
            hopDirValid = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          }
          if (hopDirValid) {
            // Walk the path: enemies are capture targets (always hoppable for capture_on_hop),
            // allies block unless the piece has ally-hop ability.
            const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
            const hopCapturedSet = new Set();
            let hopBlocked = false;
            const hdx = Math.sign(toX - piece.x);
            const hdy = Math.sign(toY - piece.y);
            const hxDiff = Math.abs(toX - piece.x);
            const hyDiff = Math.abs(toY - piece.y);
            if (hxDiff === hyDiff || hxDiff === 0 || hyDiff === 0) {
              let cx = piece.x + hdx;
              let cy = piece.y + hdy;
              while ((cx !== toX || cy !== toY) && !hopBlocked) {
                const hopPiece = findPieceAtSquare(pieces, cx, cy);
                if (hopPiece && hopPiece.id !== piece.id) {
                  const hopTeam = hopPiece.player_id || hopPiece.team;
                  if (hopTeam !== pieceTeam) {
                    if (hopPiece.cannot_be_captured || hopPiece.ends_game_on_checkmate) {
                      hopBlocked = true;
                    } else {
                      hopCapturedSet.add(hopPiece.id);
                    }
                  } else if (!canHopAllies) {
                    hopBlocked = true;
                  }
                }
                cx += hdx;
                cy += hdy;
              }
            }
            if (!hopBlocked && hopCapturedSet.size > 0) {
              hopCapturedPieceIds = [...hopCapturedSet];
              isHopCapture = true;
              isValidMove = true;
              pathClear = true;
            }
          }
        }

        // Hop-only restriction: if exact_ratio_hop_only is set and no hop occurred,
        // re-validate excluding exact directional and ratio abilities.
        // If the move only works via exact/ratio, reject it (nothing was hopped over).
        // Skip for premoves — the server validates the actual board state when the premove executes.
        const isAttackMove = isCapture || isPotentialCapture;
        const exactRatioHopOnlyApplies = isAttackMove
          ? (piece.exact_ratio_hop_only_attack === 1 || piece.exact_ratio_hop_only_attack === true)
          : (piece.exact_ratio_hop_only === 1 || piece.exact_ratio_hop_only === true);
        if (!forPremove && exactRatioHopOnlyApplies && isValidMove && pathClear && !isHopCapture && !isStepMove && !isRatioMove) {
          const stillValid = isCapture
            ? canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true)
            : canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true);
          if (!stillValid) {
            // Move relies on exact/ratio — only allow if something was hopped in the path
            let hasHop = false;
            const hdx2 = Math.sign(toX - piece.x);
            const hdy2 = Math.sign(toY - piece.y);
            const hxDiff = Math.abs(toX - piece.x);
            const hyDiff = Math.abs(toY - piece.y);
            if (hxDiff === hyDiff || hxDiff === 0 || hyDiff === 0) {
              let hx2 = piece.x + hdx2;
              let hy2 = piece.y + hdy2;
              while (hx2 !== toX || hy2 !== toY) {
                const hp = findPieceAtSquare(pieces, hx2, hy2);
                if (hp && hp.id !== piece.id) { hasHop = true; break; }
                hx2 += hdx2;
                hy2 += hdy2;
              }
            }
            if (!hasHop) isValidMove = false;
          }
        }
        // For ratio moves with hop-only: always require a hop
        if (!forPremove && exactRatioHopOnlyApplies && isValidMove && pathClear && !isHopCapture && isRatioMove) {
          isValidMove = false;
        }

        // directional_hop_only: directional movement requires a piece to be hopped in the path
        if (!forPremove && isValidMove && !isCapture && !isPotentialCapture && !isHopCapture &&
            (piece.directional_hop_only === 1 || piece.directional_hop_only === true)) {
          const xDiff = toX - piece.x;
          const yDiff = toY - piece.y;
          if (xDiff === 0 || yDiff === 0 || Math.abs(xDiff) === Math.abs(yDiff)) {
            const dx = Math.sign(xDiff);
            const dy = Math.sign(yDiff);
            let hasHopPiece = false;
            let cx = piece.x + dx;
            let cy = piece.y + dy;
            while ((cx !== toX || cy !== toY) && !hasHopPiece) {
              if (findPieceAtSquare(pieces, cx, cy)) hasHopPiece = true;
              cx += dx;
              cy += dy;
            }
            if (!hasHopPiece) isValidMove = false;
          }
        }

        // max_directional_hop_pieces: limit how many pieces may be hopped over per directional move
        if (!forPremove && isValidMove && !isCapture && !isPotentialCapture && !isHopCapture &&
            piece.max_directional_hop_pieces != null && piece.max_directional_hop_pieces > 0) {
          const xDiff = toX - piece.x;
          const yDiff = toY - piece.y;
          if (xDiff === 0 || yDiff === 0 || Math.abs(xDiff) === Math.abs(yDiff)) {
            const dx = Math.sign(xDiff);
            const dy = Math.sign(yDiff);
            let hopCount = 0;
            let cx = piece.x + dx;
            let cy = piece.y + dy;
            while (cx !== toX || cy !== toY) {
              if (findPieceAtSquare(pieces, cx, cy)) hopCount++;
              cx += dx;
              cy += dy;
            }
            if (hopCount > piece.max_directional_hop_pieces) isValidMove = false;
          }
        }

        // directional_hop_only_attack: directional attacks require a piece to be hopped in the path
        if (!forPremove && isValidMove && (isCapture || isPotentialCapture) && !isHopCapture &&
            (piece.directional_hop_only_attack === 1 || piece.directional_hop_only_attack === true)) {
          const xDiff = toX - piece.x;
          const yDiff = toY - piece.y;
          if (xDiff === 0 || yDiff === 0 || Math.abs(xDiff) === Math.abs(yDiff)) {
            const dx = Math.sign(xDiff);
            const dy = Math.sign(yDiff);
            let hasHopPiece = false;
            let cx = piece.x + dx;
            let cy = piece.y + dy;
            while ((cx !== toX || cy !== toY) && !hasHopPiece) {
              if (findPieceAtSquare(pieces, cx, cy)) hasHopPiece = true;
              cx += dx;
              cy += dy;
            }
            if (!hasHopPiece) isValidMove = false;
          }
        }

        // max_directional_hop_pieces_attack: limit how many pieces may be hopped over per directional attack
        if (!forPremove && isValidMove && (isCapture || isPotentialCapture) && !isHopCapture &&
            piece.max_directional_hop_pieces_attack != null && piece.max_directional_hop_pieces_attack > 0) {
          const xDiff = toX - piece.x;
          const yDiff = toY - piece.y;
          if (xDiff === 0 || yDiff === 0 || Math.abs(xDiff) === Math.abs(yDiff)) {
            const dx = Math.sign(xDiff);
            const dy = Math.sign(yDiff);
            let hopCount = 0;
            let cx = piece.x + dx;
            let cy = piece.y + dy;
            while (cx !== toX || cy !== toY) {
              if (findPieceAtSquare(pieces, cx, cy)) hopCount++;
              cx += dx;
              cy += dy;
            }
            if (hopCount > piece.max_directional_hop_pieces_attack) isValidMove = false;
          }
        }
        
        if (isValidMove && pathClear) {
          // Check if this move requires a certain number of first moves
          const firstMovesRequired = (isCapture || isPotentialCapture || isHopCapture)
            ? checkIfFirstMoveOnlyCapture(piece, piece.x, piece.y, toX, toY, pieceTeam)
            : checkIfFirstMoveOnlyMove(piece, piece.x, piece.y, toX, toY, pieceTeam);
          
          // If this move requires first moves, check if the piece has moved too many times
          if (firstMovesRequired > 0) {
            // Custom-square first-move blockers (restrictFirstMoveToCustom on another square,
            // or disableFirstMoveHere on the piece's current square) gate first-move-only moves
            // entirely regardless of moveCount.
            if (blockFirstMove) {
              continue;
            }
            // Use the server-maintained moveCount on the piece directly.
            // This is more reliable than filtering moveHistory (avoids type-coercion
            // mismatches and missing entries for games restored from the DB).
            const pieceMovesCount = piece.moveCount || 0;
            if (pieceMovesCount >= firstMovesRequired) {
              continue;
            }
          }
          
          // Use already-computed custom square detection
          const isCustomMove = !isCapture && !isPotentialCapture && !isHopCapture && isCustomSquareMove;
          const isCustomAttack = (isCapture || isPotentialCapture || isHopCapture) && isCustomSquareMove;
          
          moves.push({
            x: toX,
            y: toY,
            isCapture: isCapture || isPotentialCapture || isHopCapture,
            isHopCapture,
            hopCapturedPieceIds,
            isFirstMoveOnly: firstMovesRequired > 0,
            isCustomMove,
            isCustomAttack,
            isPotentialCapture
          });
        }
      }
    }
    
    // Check for castling moves
    if (piece.can_castle && !piece.hasMoved) {
      const castleDist = piece.castling_distance || 2;
      // Check left castling
      if (piece.castling_partner_left_id) {
        const partner = pieces.find(p => p.id === piece.castling_partner_left_id);
        if (partner && !partner.hasMoved) {
          const targetX = piece.x - castleDist;
          const targetY = piece.y;
          // King-traversal path must be clear. Partner is exempt because it
          // teleports during castling (so castling_distance=1 with the partner
          // at the corner is fine — only the king's own path matters).
          let pathClear = true;
          for (let x = piece.x - 1; x >= piece.x - castleDist; x--) {
            const occupant = pieces.find(p => p.id !== partner.id && doesPieceOccupySquare(p, x, piece.y));
            if (occupant) { pathClear = false; break; }
          }
          if (pathClear) {
            moves.push({
              x: targetX,
              y: targetY,
              isCapture: false,
              isCastling: true,
              castlingWith: piece.castling_partner_left_id,
              castlingDirection: 'left'
            });
          }
        }
      }
      
      // Check right castling
      if (piece.castling_partner_right_id) {
        const partner = pieces.find(p => p.id === piece.castling_partner_right_id);
        if (partner && !partner.hasMoved) {
          const targetX = piece.x + castleDist;
          const targetY = piece.y;
          // King-traversal path must be clear. Partner is exempt because it
          // teleports during castling (so castling_distance=1 with the partner
          // at the corner is fine — only the king's own path matters).
          let pathClear = true;
          for (let x = piece.x + 1; x <= piece.x + castleDist; x++) {
            const occupant = pieces.find(p => p.id !== partner.id && doesPieceOccupySquare(p, x, piece.y));
            if (occupant) { pathClear = false; break; }
          }
          if (pathClear) {
            moves.push({
              x: targetX,
              y: targetY,
              isCapture: false,
              isCastling: true,
              castlingWith: piece.castling_partner_right_id,
              castlingDirection: 'right'
            });
          }
        }
      }
    }
    
    // Check for en passant capture
    if (piece.can_en_passant && gameState?.enPassantTarget) {
      const ept = gameState.enPassantTarget;
      // Check if capturing piece is horizontally adjacent to the vulnerable piece
      const vulnerablePiece = pieces.find(p => 
        p.id === ept.pieceId && p.x === ept.piecePosition.x && p.y === ept.piecePosition.y
      );
      if (vulnerablePiece) {
        const vulnerableTeam = vulnerablePiece.player_id || vulnerablePiece.team;
        // Must be enemy piece
        if (vulnerableTeam !== pieceTeam && !vulnerablePiece.cannot_be_captured && !vulnerablePiece.ends_game_on_checkmate) {
          // Must be same piece type (e.g., pawn can only en passant capture another pawn)
          if (piece.piece_id === vulnerablePiece.piece_id) {
            // Check if current piece is horizontally adjacent to the vulnerable piece
            if (piece.y === vulnerablePiece.y && Math.abs(piece.x - vulnerablePiece.x) === 1) {
              // Check if capture square isn't already in moves
              const captureSquare = ept.captureSquare;
              if (!moves.some(m => m.x === captureSquare.x && m.y === captureSquare.y)) {
                moves.push({
                  x: captureSquare.x,
                  y: captureSquare.y,
                  isCapture: true,
                  isEnPassant: true,
                  enPassantVictimId: vulnerablePiece.id
                });
              }
            }
          }
        }
      }
    }
    
    // Check for ranged attack targets
    if (piece.can_capture_enemy_via_range) {
      // Restriction zone: if the piece is on a zone square, only ranged attacks
      // to other zone squares are legal — unless the current zone square also
      // has allowRangedOutsideZone enabled.
      const zoneSquares = piece.cannot_move_outside_zone
        ? Object.entries(customSquareMap)
            .filter(([, cfg]) => cfg && cfg.asRestrictionZone)
            .map(([key]) => key)
        : null;
      const pieceZoneKey = `${piece.y},${piece.x}`;
      const pieceIsOnZone = zoneSquares && zoneSquares.includes(pieceZoneKey);
      const rangedOutsideAllowed = pieceIsOnZone
        && !!(customSquareMap[pieceZoneKey]?.allowRangedOutsideZone);

      for (let toY = 0; toY < boardHeight; toY++) {
        for (let toX = 0; toX < boardWidth; toX++) {
          if (toX === piece.x && toY === piece.y) continue;
          // Restriction zone: skip ranged attacks that exit the zone (unless exempted).
          if (pieceIsOnZone && !rangedOutsideAllowed && !zoneSquares.includes(`${toY},${toX}`)) continue;
          const targetPiece = findPieceAtSquare(pieces, toX, toY);
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          // Skip friendly pieces - in simul-turns games, self-sacrifice is allowed
          const isSimulGame = !!(gameState?.gameType?.simultaneous_turns);
          if (targetPiece && targetTeam === pieceTeam && !isSimulGame) continue;
          // Skip pieces that cannot be captured or are checkmate pieces
          if (targetPiece && (targetPiece.cannot_be_captured || targetPiece.ends_game_on_checkmate)) continue;
          // Skip if a ranged entry already exists for this square (avoid duplicates).
          // Do NOT skip when only a regular move exists — a piece can both move to a square
          // and ranged-attack it, and both indicators should be shown simultaneously.
          if (moves.some(m => m.x === toX && m.y === toY && m.isRangedAttack)) continue;
          const isStepByStepRanged = !!piece.step_by_step_attack_range;
          if (isStepByStepRanged) {
            // Use BFS path-finding for step-by-step ranged attacks so walls block correctly
            if (!canReachStepByStepRanged(piece, toX, toY, pieces, boardWidth, boardHeight)) {
              continue;
            }
          } else if (canRangedAttackTo(piece.y, piece.x, toY, toX, piece, pieceTeam)) {
            // Check if ranged path is clear (blocked by pieces unless can fire over)
            if (!isRangedPathClear(piece.x, piece.y, toX, toY, piece, pieces, pieceTeam)) {
              continue;
            }
          } else {
            continue;
          }
          {
            const hasTarget = !!targetPiece;
            // For premoves, include empty ranged squares as potential targets
            // For hover display, include all reachable ranged squares (even empty) to show the full threat zone
            if (hasTarget || forPremove || forHoverDisplay) {
              moves.push({
                x: toX,
                y: toY,
                isCapture: hasTarget,
                isFirstMoveOnly: false,
                isRangedAttack: true,
                isPotentialRangedTarget: !hasTarget && (forPremove || forHoverDisplay)
              });
            }
          }
        }
      }
    }
    
    // Check for direction-change moves
    if (piece.directional_movement_change || piece.directional_capture_change ||
        (piece.attacks_like_movement && piece.directional_movement_change)) {
      const dcMovement = getDirectionChangeMoves(piece, piece.x, piece.y, pieceTeam, boardWidth, boardHeight, 'movement', pieces);
      const dcCapture = getDirectionChangeMoves(piece, piece.x, piece.y, pieceTeam, boardWidth, boardHeight, 'capture', pieces);
      for (const dcMove of [...dcMovement, ...dcCapture]) {
        // Deduplicate by coordinate + via (same destination reachable via different via squares = distinct moves)
        if (!moves.some(m => m.isDirectionChange && m.x === dcMove.x && m.y === dcMove.y && !!m.isCapture === !!dcMove.isCapture && m.via?.x === dcMove.via?.x && m.via?.y === dcMove.via?.y)) {
          moves.push(dcMove);
        }
      }
    }

    // Enforce require_direction_change (movement) and require_direction_change_capture:
    // when set, straight-line destinations only accessible if they also appear as a DC destination.
    const requireDCMov = !!(piece.directional_movement_change && piece.require_direction_change);
    const requireDCCap = !!(piece.require_direction_change_capture &&
      (piece.directional_capture_change || (piece.attacks_like_movement && piece.directional_movement_change)));
    if (requireDCMov || requireDCCap) {
      const dcMovDests = new Set();
      const dcCapDests = new Set();
      for (const m of moves) {
        if (!m.isDirectionChange) continue;
        if (m.isCapture) dcCapDests.add(`${m.x},${m.y}`);
        else dcMovDests.add(`${m.x},${m.y}`);
      }
      moves = moves.filter(m => {
        if (m.isDirectionChange) return true;
        if (m.isCapture && requireDCCap) return dcCapDests.has(`${m.x},${m.y}`);
        if (!m.isCapture && requireDCMov) return dcMovDests.has(`${m.x},${m.y}`);
        return true;
      });
    }

    // Filter out moves that would leave the player in check (if mate_condition is enabled and not skipped).
    // Only apply this filter to the current player's own pieces — applying it to opponent pieces
    // would incorrectly remove the opponent's check-giving moves from their hover display.
    const pieceTeamForCheckFilter = piece.player_id || piece.team;
    const isOwnPieceForCheckFilter = !!piece.is_neutral || (currentPlayer && pieceTeamForCheckFilter === currentPlayer.position);
    if (!skipCheckFilter && gameState?.gameType?.mate_condition && currentPlayer && isOwnPieceForCheckFilter) {
      // Don't filter ranged attacks through check filter (they don't move the piece)
      const regularMoves = moves.filter(m => !m.isRangedAttack);
      const rangedMoves = moves.filter(m => m.isRangedAttack);
      const filteredRegular = regularMoves.filter(move => 
        wouldMoveResolveCheck(piece, move.x, move.y, pieces, currentPlayer.position, boardWidth, boardHeight)
      );
      return [...filteredRegular, ...rangedMoves];
    }
    
    return moves;
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear, checkRatioPathClear, isStepByStepTarget, canReachStepByStep, canReachStepByStepRanged, gameState, currentPlayer, wouldMoveResolveCheck, applyRangeSquareBonus, specialSquares]);

  // Handle square click
  /* eslint-disable react-hooks/exhaustive-deps */
  const handleSquareClick = useCallback((x, y) => {
    // Block interactions while a move is pending confirmation
    if (pendingMove) return;

    // Block interactions while a promotion choice is pending
    if (showPromotionModal) return;

    // Block all interactions for spectators
    if (!currentPlayer) return;

    // Clear ranged-twice selection on any left click
    if (rangedSelectedPiece) {
      setRangedSelectedPiece(null);
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
    const canSelectForPremove = ((!isMyTurn || isBotGame) && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false && isOwnPiece && myRepositionsDone);
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
    const canPremove = selectedPiece && (!isMyTurn || isBotGame) && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false && myRepositionsDone;
    
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
  }, [isMyTurn, gameState, currentPlayer, selectedPiece, validMoves, calculateValidMoves, submitMove, sendPremove, setPremove, gameId, rangedSelectedPiece, setShowPlacementModal, setPlacementTarget, pendingMove, ghostMoveIndex, captureActionPieceId, showIllegalMoveWarning, placementUseLeftClick, specialSquares, showPromotionModal]);
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
    const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece;
    
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
  }, [isMyTurn, gameState, currentPlayer, calculateValidMoves, pendingMove, showPromotionModal]);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedPiece(null);
    setDragValidMoves([]);
    setSelectedPiece(null);
    setValidMoves([]);
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
    
    if (!draggedPiece) {
      return;
    }

    // Block drop while a correspondence move is awaiting confirmation
    if (pendingMove) {
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
      const canMakePremove = (!isMyTurn || !!gameState?.botPlayer) && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && myRepositionsDone;
      
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
  }, [draggedPiece, dragValidMoves, isMyTurn, isMyRepositionTurn, myRepositionsDone, gameState, submitMove, submitReposition, sendPremove, gameId, inCheck, currentPlayer, soundEnabledRef, calculateValidMoves, pendingMove, showPromotionModal, castleArmedSquare, castleHoldSquare]);

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
    const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece;

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
  }, [isMyTurn, isMyRepositionTurn, gameState, currentPlayer, calculateValidMoves, pendingMove, captureActionPieceId, showIllegalMoveWarning, showPromotionModal]);

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
            const canMakePremove = (!isMyTurn || !!gameState?.botPlayer) && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && myRepositionsDone;

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
  }, [selectedPiece, validMoves, isMyTurn, gameState, submitMove, gameId, premove, sendClearPremove, rangedSelectedPiece, sendPremove, showIllegalMoveWarning, placementUseLeftClick, currentPlayer, specialSquares, setPlacementTarget, setShowPlacementModal, canReachStepByStepRanged, setPremove, isRangedPathClear, pendingMove, showPromotionModal]);

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
    let squareSize;
    if (windowWidth > 1200) {
      // 3-column layout: sidebars (~280px each), gaps (24px each), container padding (40px), coord labels (~24px)
      const containerWidth = Math.min(windowWidth, 1800);
      const sidebarWidth = containerWidth <= 1400 ? 240 : 280;
      const availableWidth = containerWidth - sidebarWidth * 2 - 24 * 2 - 40 - 24;
      // Leave room for header (~120px), padding, and some breathing room
      const availableHeight = windowHeight - 180;
      const maxByWidth = Math.floor(availableWidth / boardWidth);
      const maxByHeight = Math.floor(availableHeight / boardHeight);
      squareSize = Math.max(20, Math.min(120, maxByWidth, maxByHeight));
    } else {
      // Single-column layout: board is centered, use most of viewport width
      const availableWidth = windowWidth - 24 - 32 - 24; // viewport minus coord labels, wrapper padding, margin
      const availableHeight = windowHeight - 200;
      const maxByWidth = Math.floor(availableWidth / boardWidth);
      const maxByHeight = Math.floor(availableHeight / boardHeight);
      squareSize = Math.max(16, Math.min(65, maxByWidth, maxByHeight));
    }

    const squares = [];

    // Go-style board display: render as a wood-coloured grid of lines with pieces
    // on the intersections (display-only preference from Step 3 of the wizard).
    const intersectionBoard = gameState?.otherGameData?.intersection_board === true;

    // Whether this game has any points-based win or draw condition (controls points-square overlay visibility)
    const hasPointsCondition = gameState.gameType?.points_to_win != null ||
      gameState.gameType?.draw_equal_points_at_turn != null ||
      gameState.gameType?.draw_equal_points_consecutive != null;

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
        const dotBg = { move: 'rgba(33,150,243,0.55)', capture: 'rgba(220,60,60,0.7)', first: 'rgba(255,215,0,0.65)', custom: 'rgba(0,188,150,0.55)', castle: 'rgba(255,200,60,0.85)' };
        const dotType = (activeRegularMove && !isImpassable && !isCastleArmed)
          ? (activeRegularMove.isCustomMove || activeRegularMove.isCustomAttack ? 'custom'
            : activeRegularMove.isFirstMoveOnly ? 'first'
            : activeRegularMove.isCapture ? 'capture'
            : activeRegularMove.isCastling ? 'castle'
            : 'move')
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
              ...(dotType ? { '--move-dot-bg': dotBg[dotType] } : {}),
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
              const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece;
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
                  draggable={canDragForMove || canDragForPremove || _canReposition}
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
                      alt={piece.piece_name || piece.name || 'piece'} 
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
              aspectRatio: 'unset'
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
            {moveError && (
              <span className={styles["move-error"]}>❌ {moveError}</span>
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
        
        <div className={styles["header-actions"]}>
          <Link to="/play/games" className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}>
            Back to Lobby
          </Link>
        </div>
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
        <div className={styles["layout-row-top-clock"]}>
          <div className={`
            ${styles["player-clock"]} 
            ${topPlayer?.position === 1 ? styles["player-1-color"] : styles["player-2-color"]}
            ${topPlayer && gameState.currentTurn === topPlayer.position && gameState.status === 'active' ? styles["current-turn"] : ''}
            ${gameState.winner === topPlayer?.id ? styles.winner : ''}
          `}>
            <div className={styles["player-info"]}>
              <div className={styles["player-header"]}>
                <span className={styles["player-name"]}>
                  {!topPlayer && gameState.status === 'waiting' ? (
                    <span className={styles["waiting-for-opponent"]}>Waiting for opponent…</span>
                  ) : topPlayer?.id === 'bot' ? (
                    topPlayer?.username
                  ) : (
                    <Link to={`/profile/${topPlayer?.username}`} className={styles["player-name-link"]} onClick={(e) => e.stopPropagation()}>
                      {topPlayer?.username}
                    </Link>
                  )}
                  {topPlayer && topPlayer.id === currentPlayer?.id && ' (You)'}
                </span>
                <span className={`${styles["player-indicator"]} ${topPlayer && gameState.currentTurn === topPlayer.position && gameState.status === 'active' ? styles.active : ''}`}></span>
              </div>
              {gameState.timeControl && (
                <div className={styles["player-time"]}>
                  <div className={`${styles["time-value"]} ${(getDisplayTime(topPlayer?.id) ?? 999) < 60 ? styles["low-time"] : ''}`}>
                    {formatTime(getDisplayTime(topPlayer?.id))}
                    {(() => { const m = gameState.clockMultipliers?.[topPlayer?.id]; if (!m || Math.abs(m - 1) < 0.1) return null; return <span className={styles["clock-multiplier"]}> {m > 1 ? m.toFixed(1) + '×' : (1/m).toFixed(1) + '× slower'}</span>; })()} 
                  </div>
                </div>
              )}
              {!gameState.timeControl && gameState.isCorrespondence && (
                <div className={styles["player-time"]}>
                  <div className={styles["time-value"]}>
                    {formatCorrespondenceTime(topPlayer && gameState.currentTurn === topPlayer.position)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Middle Row: Clocks | Board | Move History */}
        <div className={styles["layout-row-middle"]}>
          {/* Clocks Column */}
          <div className={styles["clocks-column"]}>
            {/* Opponent Clock */}
            <div className={`
              ${styles["player-clock"]} 
              ${styles["top-clock"]}
              ${topPlayer?.position === 1 ? styles["player-1-color"] : styles["player-2-color"]}
              ${topPlayer && gameState.currentTurn === topPlayer.position && gameState.status === 'active' ? styles["current-turn"] : ''}
              ${gameState.winner === topPlayer?.id ? styles.winner : ''}
            `}>
              <div className={styles["player-info"]}>
                <div className={styles["player-header"]}>
                  <span className={styles["player-name"]}>
                    {!topPlayer && gameState.status === 'waiting' ? (
                      <span className={styles["waiting-for-opponent"]}>Waiting for opponent…</span>
                    ) : topPlayer?.id === 'bot' ? (
                      <>
                        {topPlayer?.username}
                        {gameState.botPlayer?.difficulty === 'stockfish' && gameState.botPlayer?.stockfishLevel != null && (
                          <span style={{ display: 'block', fontSize: '0.75em', opacity: 0.7, fontWeight: 400 }}>
                            {({ 1: 'Beginner', 2: 'Casual', 3: 'Skilled', 4: 'Expert', 5: 'Maximum' })[gameState.botPlayer.stockfishLevel] || `Level ${gameState.botPlayer.stockfishLevel}`}
                          </span>
                        )}
                      </>
                    ) : (
                      <Link to={`/profile/${topPlayer?.username}`} className={styles["player-name-link"]} onClick={(e) => e.stopPropagation()}>
                        {topPlayer?.username}
                      </Link>
                    )}
                    {topPlayer && topPlayer.id === currentPlayer?.id && ' (You)'}
                  </span>
                  <span className={`${styles["player-indicator"]} ${topPlayer && gameState.currentTurn === topPlayer.position && gameState.status === 'active' ? styles.active : ''}`}></span>
                </div>
                {gameState.timeControl && (
                  <div className={styles["player-time"]}>
                    <div className={`${styles["time-value"]} ${(getDisplayTime(topPlayer?.id) ?? 999) < 60 ? styles["low-time"] : ''}`}>
                      {formatTime(getDisplayTime(topPlayer?.id))}
                      {(() => { const m = gameState.clockMultipliers?.[topPlayer?.id]; if (!m || Math.abs(m - 1) < 0.1) return null; return <span className={styles["clock-multiplier"]}> {m > 1 ? m.toFixed(1) + '×' : (1/m).toFixed(1) + '× slower'}</span>; })()}
                    </div>
                  </div>
                )}
                {!gameState.timeControl && gameState.isCorrespondence && (
                  <div className={styles["player-time"]}>
                    <div className={styles["time-value"]}>
                      {formatCorrespondenceTime(topPlayer && gameState.currentTurn === topPlayer.position)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* In-Game Chat */}
            <GameChat gameId={gameId} currentUser={currentUser} gameState={gameState} isPlayer={isPlayer} onUpdatePreference={updateUserPreference} />

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

            {/* Your Clock */}
            <div className={`
              ${styles["player-clock"]} 
              ${styles["bottom-clock"]}
              ${bottomPlayer?.position === 1 ? styles["player-1-color"] : styles["player-2-color"]}
              ${bottomPlayer && gameState.currentTurn === bottomPlayer.position && gameState.status === 'active' ? styles["current-turn"] : ''}
              ${gameState.winner === bottomPlayer?.id ? styles.winner : ''}
            `}>
              <div className={styles["player-info"]}>
                {gameState.timeControl && (
                  <div className={styles["player-time"]}>
                    <div className={`${styles["time-value"]} ${(getDisplayTime(bottomPlayer?.id) ?? 999) < 60 ? styles["low-time"] : ''}`}>
                      {formatTime(getDisplayTime(bottomPlayer?.id))}
                      {(() => { const m = gameState.clockMultipliers?.[bottomPlayer?.id]; if (!m || Math.abs(m - 1) < 0.1) return null; return <span className={styles["clock-multiplier"]}> {m > 1 ? m.toFixed(1) + '×' : (1/m).toFixed(1) + '× slower'}</span>; })()}
                    </div>
                  </div>
                )}
                {!gameState.timeControl && gameState.isCorrespondence && (
                  <div className={styles["player-time"]}>
                    <div className={styles["time-value"]}>
                      {formatCorrespondenceTime(bottomPlayer && gameState.currentTurn === bottomPlayer.position)}
                    </div>
                  </div>
                )}
                <div className={styles["player-header"]}>
                  <span className={styles["player-name"]}>
                    {bottomPlayer?.id === 'bot' ? (
                      <>
                        {bottomPlayer?.username}
                        {gameState.botPlayer?.difficulty === 'stockfish' && gameState.botPlayer?.stockfishLevel != null && (
                          <span style={{ display: 'block', fontSize: '0.75em', opacity: 0.7, fontWeight: 400 }}>
                            {({ 1: 'Beginner', 2: 'Casual', 3: 'Skilled', 4: 'Expert', 5: 'Maximum' })[gameState.botPlayer.stockfishLevel] || `Level ${gameState.botPlayer.stockfishLevel}`}
                          </span>
                        )}
                      </>
                    ) : (
                      <Link to={`/profile/${bottomPlayer?.username}`} className={styles["player-name-link"]} onClick={(e) => e.stopPropagation()}>
                        {bottomPlayer?.username}
                      </Link>
                    )}
                    {currentPlayer && bottomPlayer?.id === currentPlayer?.id && ' (You)'}
                  </span>
                  <span className={`${styles["player-indicator"]} ${bottomPlayer && gameState.currentTurn === bottomPlayer.position && gameState.status === 'active' ? styles.active : ''}`}></span>
                </div>
              </div>
            </div>
          </div>

          {/* Board Column */}
          <div className={styles["board-column"]}>
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
            
            <div className={styles["game-board-wrapper"]}>
              {renderBoard()}
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

          {/* Move History Column */}
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
            {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
              <div className={styles["game-controls-inline"]}>
                <h4>Actions</h4>
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
              </div>
            )}
          </div>

          {/* Running Piece Count - moved out of grid, positioned after layout-row-middle */}
        </div>
      </div>

      {/* Special Squares Legend Row - below board and clocks */}
      {hasSpecialSquares && (
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
      <div className={styles["layout-row-bottom-clock"]}>
        <div className={`
          ${styles["player-clock"]} 
          ${bottomPlayer && gameState.currentTurn === bottomPlayer.position && gameState.status === 'active' ? styles["current-turn"] : ''}
          ${gameState.winner === bottomPlayer?.id ? styles.winner : ''}
        `}>
          <div className={styles["player-info"]}>
            {gameState.timeControl && (
              <div className={styles["player-time"]}>
                <div className={`${styles["time-value"]} ${(getDisplayTime(bottomPlayer?.id) ?? 999) < 60 ? styles["low-time"] : ''}`}>
                  {formatTime(getDisplayTime(bottomPlayer?.id))}
                </div>
              </div>
            )}
            {!gameState.timeControl && gameState.isCorrespondence && (
              <div className={styles["player-time"]}>
                <div className={styles["time-value"]}>
                  {formatCorrespondenceTime(bottomPlayer && gameState.currentTurn === bottomPlayer.position)}
                </div>
              </div>
            )}
            <div className={styles["player-header"]}>
              <span className={styles["player-name"]}>
                {bottomPlayer?.id === 'bot' ? (
                  bottomPlayer?.username
                ) : (
                  <Link to={`/profile/${bottomPlayer?.username}`} className={styles["player-name-link"]} onClick={(e) => e.stopPropagation()}>
                    {bottomPlayer?.username}
                  </Link>
                )}
                {currentPlayer && bottomPlayer?.id === currentPlayer?.id && ' (You)'}
              </span>
              <span className={`${styles["player-indicator"]} ${bottomPlayer && gameState.currentTurn === bottomPlayer.position && gameState.status === 'active' ? styles.active : ''}`}></span>
            </div>
          </div>
        </div>
      </div>

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

          {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
            <div className={styles["game-controls-inline"]}>
              <h4>Actions</h4>
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
