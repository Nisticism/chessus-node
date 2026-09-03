import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { getGameById } from "../../actions/games";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import PiecesService from "../../services/pieces.service";
import PieceSelector from "../../components/gamewizard/PieceSelector";
import { canRangedAttackTo, isRangedPathClear, isDestinationClear, doesPieceOccupySquare, getSquareHighlightStyle, canHopCaptureToUtil, canPieceMoveTo as canPieceMoveToUtil, canCaptureOnMoveTo as canCaptureOnMoveToUtil } from "../../helpers/pieceMovementUtils";
import styles from "./sandbox.module.scss";
import { isMobileDevice, isTouchDevice } from "../../helpers/mobileUtils";
import ToggleSwitch from "../../components/common/ToggleSwitch";
import NumberInput from "../../components/common/NumberInput";
import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import SquareHighlightOverlay from "../../components/common/SquareHighlightOverlay";
import { handlePieceImageError } from "../../utils/pieceFallback";
import { normalizePromotionOverride } from "../../helpers/promotionOverride";
import useBoardViewport from "../../components/common/useBoardViewport";
import BoardZoomControls from "../../components/common/BoardZoomControls";
import boardVp from "../../components/common/boardViewport.module.scss";

/* eslint-disable react-hooks/exhaustive-deps */

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";
const MAX_SANDBOXES = 4;

// Special square type definitions
const SPECIAL_SQUARE_TYPES = {
  range: { name: 'Range Square', color: '#ff8c00' },
  promotion: { name: 'Promotion Square', color: '#9b59b6' },
  control: { name: 'Control Square', color: '#32CD32' },
  custom: { name: 'Custom Square', color: '#ffd700' }
};

// =============================================
// Sandbox game-logic helpers (pure functions)
// =============================================

const DEFAULT_SANDBOX_RULES = {
  // win
  mate_condition: true,
  mate_condition_requires_all: false,
  capture_condition: false,
  capture_condition_requires_all: false,
  squares_condition: false,
  piece_count_condition: false,
  no_moves_condition: false,
  promotion_condition: false,
  lose_all_pieces_condition: false,
  stalemate_win_condition: false,
  // draw
  stalemate_draw_condition: true,
  draw_move_limit: null,
  repetition_draw_count: null,
  equal_piece_count_draw: false,
  // mechanics
  actions_per_turn: 1,
  simultaneous_turns: false,
  flanking_captures: false,
  place_pieces_action: false,
  forced_capture_condition: false,
};

// Build a rules object from a loaded game_type record
const buildRulesFromGameType = (gt) => {
  if (!gt) return { ...DEFAULT_SANDBOX_RULES };
  let otherData = {};
  try {
    if (gt.other_game_data) {
      otherData = typeof gt.other_game_data === 'string' ? JSON.parse(gt.other_game_data) : gt.other_game_data;
    }
  } catch (_) { /* ignore */ }
  return {
    // win
    mate_condition: !!gt.mate_condition,
    mate_condition_requires_all: !!gt.mate_condition_requires_all,
    capture_condition: !!gt.capture_condition,
    capture_condition_requires_all: !!gt.capture_condition_requires_all,
    squares_condition: !!gt.squares_condition,
    piece_count_condition: !!gt.piece_count_condition,
    no_moves_condition: !!gt.no_moves_condition,
    promotion_condition: !!gt.promotion_condition,
    lose_all_pieces_condition: !!gt.lose_all_pieces_condition,
    stalemate_win_condition: !!gt.stalemate_win_condition,
    // draw
    stalemate_draw_condition: gt.stalemate_draw_condition === undefined ? true : !!gt.stalemate_draw_condition,
    draw_move_limit: gt.draw_move_limit || null,
    repetition_draw_count: gt.repetition_draw_count || null,
    equal_piece_count_draw: !!gt.equal_piece_count_draw,
    // mechanics
    actions_per_turn: Number(gt.actions_per_turn) || 1,
    simultaneous_turns: !!gt.simultaneous_turns,
    flanking_captures: !!(gt.flanking_captures || otherData.flanking_captures),
    place_pieces_action: !!otherData.place_pieces_action,
    forced_capture_condition: !!gt.forced_capture_condition,
  };
};

// Initial state for a fresh sandbox (any kind)
const buildInitialSandboxState = (rules) => ({
  rules: rules || { ...DEFAULT_SANDBOX_RULES },
  moveCount: 0,
  positionHistory: [],
  actionsThisTurn: 0,
  gameOver: null,
  placementPool: [],
  placementSelected: null,
});

// Apply capture (HP/AD) to a list of pieces. captureIds is a Set of piece ids
// that an attacker is hitting (move-capture targets and/or hop-capture targets).
// Returns { pieces: newArray, justCaptured: [array of fully-removed pieces] }.
const applyCapturesWithHp = (pieces, captureIds, attacker) => {
  if (!captureIds || captureIds.size === 0) {
    return { pieces: [...pieces], justCaptured: [] };
  }
  const ad = Number(attacker?.attack_damage ?? 1) || 1;
  const justCaptured = [];
  const updated = [];
  for (const p of pieces) {
    if (!captureIds.has(p.id)) { updated.push(p); continue; }
    if (p.cannot_be_captured) { updated.push(p); continue; }
    const maxHp = Number(p.hit_points ?? 1) || 1;
    const curHp = Number(p.current_hp ?? maxHp) || maxHp;
    const newHp = curHp - ad;
    if (newHp <= 0) {
      justCaptured.push(p);
      // Fully removed: omit from updated
    } else {
      updated.push({ ...p, current_hp: newHp });
    }
  }
  return { pieces: updated, justCaptured };
};

// Stable position hash (for repetition draw detection)
const hashSandboxPosition = (pieces, currentTurn) => {
  const arr = pieces.map(p =>
    `${p.piece_id || p.id || ''}:${p.player_id || p.team || 0}:${p.x},${p.y}:${p.current_hp ?? ''}`
  );
  arr.sort();
  return arr.join('|') + `#t${currentTurn}`;
};

// Pure game-over detection. Returns { gameOver: true, winner, reason } or null.
// calculateValidMovesFn may be null (skips stalemate/checkmate check).
const evaluateSandboxEndGame = (sandbox, justCaptured, calculateValidMovesFn) => {
  const rules = sandbox.rules || DEFAULT_SANDBOX_RULES;
  const pieces = sandbox.pieces || [];
  const players = [1, 2];

  // 1. Captures of ends_game_on_capture / ends_game_on_checkmate pieces
  const eliminated = new Set();
  let mateReason = false;
  for (const cap of (justCaptured || [])) {
    if (cap.ends_game_on_capture || cap.ends_game_on_checkmate) {
      eliminated.add(cap.player_id || cap.team);
      if (cap.ends_game_on_checkmate) mateReason = true;
    }
  }
  if (eliminated.size > 0) {
    const survivors = players.filter(p => !eliminated.has(p));
    if (survivors.length === 0) {
      return { gameOver: true, winner: null, reason: 'simultaneous_capture_draw' };
    }
    if (survivors.length === 1) {
      return { gameOver: true, winner: survivors[0], reason: mateReason ? 'checkmate' : 'capture' };
    }
  }

  // 2. Elimination by zero-pieces (skip for placement games — players can re-place)
  if (!rules.place_pieces_action) {
    for (const player of players) {
      const myPieces = pieces.filter(p => (p.player_id || p.team) === player);
      // Only treat zero pieces as a loss if some win condition is set, OR no win conditions
      // are set (fallback). For mate-only games, leave handling to the ends_game_on_* check.
      const hasAnyWinCondition = rules.mate_condition || rules.capture_condition ||
        rules.squares_condition || rules.piece_count_condition || rules.lose_all_pieces_condition;
      if (myPieces.length === 0) {
        if (rules.lose_all_pieces_condition) {
          // Player wins by losing all pieces
          return { gameOver: true, winner: player, reason: 'lose_all_wins' };
        }
        if (rules.capture_condition || rules.piece_count_condition || !hasAnyWinCondition) {
          const winner = players.find(p => p !== player);
          return { gameOver: true, winner, reason: 'elimination' };
        }
      }
    }
  }

  // 2b. Equal piece count draw
  if (rules.equal_piece_count_draw) {
    const p1Count = pieces.filter(p => (p.player_id || p.team) === 1).length;
    const p2Count = pieces.filter(p => (p.player_id || p.team) === 2).length;
    if (p1Count > 0 && p1Count === p2Count && (sandbox.moveCount || 0) > 0) {
      // Only fire at end of full round (when player 1 about to move again) to avoid initial-state draws
      if (sandbox.currentTurn === 1) {
        return { gameOver: true, winner: null, reason: 'equal_piece_count' };
      }
    }
  }

  // 3. Draw by move limit
  if (rules.draw_move_limit && (sandbox.moveCount || 0) >= rules.draw_move_limit) {
    return { gameOver: true, winner: null, reason: 'draw_move_limit' };
  }

  // 4. Repetition draw
  if (rules.repetition_draw_count && Array.isArray(sandbox.positionHistory)) {
    const counts = {};
    for (const h of sandbox.positionHistory) counts[h] = (counts[h] || 0) + 1;
    if (Object.values(counts).some(c => c >= rules.repetition_draw_count)) {
      return { gameOver: true, winner: null, reason: 'repetition' };
    }
  }

  // 5. Stalemate / checkmate (no legal moves for current player)
  if (calculateValidMovesFn) {
    const bw = sandbox.gameType?.board_width || 8;
    const bh = sandbox.gameType?.board_height || 8;
    const turn = sandbox.currentTurn;
    const myPieces = pieces.filter(p => (p.player_id || p.team) === turn);
    if (myPieces.length > 0) {
      let hasAnyMove = false;
      for (const p of myPieces) {
        try {
          const moves = calculateValidMovesFn(p, pieces, bw, bh);
          if (moves && moves.length > 0) { hasAnyMove = true; break; }
        } catch (_) { /* ignore per-piece errors */ }
      }
      if (!hasAnyMove) {
        if (rules.mate_condition) {
          const winner = turn === 1 ? 2 : 1;
          return { gameOver: true, winner, reason: 'checkmate' };
        }
        if (rules.no_moves_condition) {
          const winner = turn === 1 ? 2 : 1;
          return { gameOver: true, winner, reason: 'no_moves' };
        }
        if (rules.stalemate_win_condition) {
          // Player who has no moves wins
          return { gameOver: true, winner: turn, reason: 'stalemate_win' };
        }
        if (rules.stalemate_draw_condition !== false) {
          return { gameOver: true, winner: null, reason: 'stalemate' };
        }
        // No applicable rule — continue (do nothing)
      }
    }
  }

  // 6. squares_condition: player wins by controlling all designated control squares
  if (rules.squares_condition) {
    const controlData = sandbox.gameSpecialSquares?.control || {};
    const specialData = sandbox.gameSpecialSquares?.special || {};
    // Collect all control-square keys (row,col format) from both sources
    const controlKeys = [
      ...Object.keys(controlData),
      ...Object.entries(specialData).filter(([, cfg]) => cfg?.asControl).map(([k]) => k),
    ];
    if (controlKeys.length > 0) {
      for (const player of players) {
        const allControlled = controlKeys.every(k => {
          const [ky, kx] = k.split(',').map(Number);
          return pieces.some(p =>
            (p.player_id || p.team) === player && doesPieceOccupySquare(p, kx, ky)
          );
        });
        if (allControlled) {
          return { gameOver: true, winner: player, reason: 'squares_controlled' };
        }
      }
    }
  }

  return null;
};

// Friendly reason -> label
const GAME_OVER_REASON_LABELS = {
  capture: 'by capture',
  checkmate: 'by checkmate',
  elimination: 'by elimination',
  stalemate: 'by stalemate',
  stalemate_win: 'stalemate (no-moves player wins)',
  draw_move_limit: 'by move limit',
  repetition: 'by repetition',
  simultaneous_capture_draw: 'simultaneous capture',
  no_moves: 'no legal moves',
  lose_all_wins: 'by losing all pieces',
  equal_piece_count: 'equal piece count draw',
  promotion_win: 'by promotion',
  squares_controlled: 'by controlling all squares',
};

const Sandbox = () => {
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  // Local game list loaded directly from server (not Redux) so search isn't limited to 20 items
  const [gamesList, setGamesList] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesTotal, setGamesTotal] = useState(0);
  const sandboxGamesPageRef = useRef(1);
  const sandboxGamesSearchRef = useRef("");
  const gamesAbortRef = useRef(null);
  // Declare searchGameTerm here so the useEffect below can close over it
  const [searchGameTerm, setSearchGameTerm] = useState("");

  const loadSandboxGames = useCallback(async (search, page, replace) => {
    if (gamesAbortRef.current) gamesAbortRef.current.abort();
    const controller = new AbortController();
    gamesAbortRef.current = controller;
    if (replace) setGamesLoading(true);
    try {
      const params = { page, limit: 20, sort: 'alphabetical' };
      if (search) params.search = search;
      const response = await axios.get(API_URL + "games", {
        params,
        headers: authHeader(),
        signal: controller.signal
      });
      const data = response.data;
      const fetched = data.games || [];
      setGamesTotal(data.pagination?.total || fetched.length);
      setGamesList(prev => replace ? fetched : [...prev, ...fetched]);
    } catch (err) {
      if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
        console.error('Failed to load sandbox games:', err);
      }
    } finally {
      setGamesLoading(false);
    }
  }, []);

  // Initial load + debounced search: fires immediately on mount, debounced on subsequent searchGameTerm changes
  const isFirstGameLoadRef = useRef(true);
  useEffect(() => {
    if (isFirstGameLoadRef.current) {
      isFirstGameLoadRef.current = false;
      sandboxGamesPageRef.current = 1;
      sandboxGamesSearchRef.current = "";
      loadSandboxGames("", 1, true);
      return;
    }
    const timer = setTimeout(() => {
      sandboxGamesPageRef.current = 1;
      sandboxGamesSearchRef.current = searchGameTerm;
      setGameTypePage(1);
      loadSandboxGames(searchGameTerm, 1, true);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchGameTerm, loadSandboxGames]);

  // Full pieces with movement data (loaded directly from API)
  const [fullPiecesList, setFullPiecesList] = useState([]);
  const [piecesLoading, setPiecesLoading] = useState(true);

  // Load full pieces with movement data
  useEffect(() => {
    const loadPieces = async () => {
      setPiecesLoading(true);
      try {
        const response = await PiecesService.getPiecesWithMovement();
        setFullPiecesList(response.data || []);
      } catch (err) {
        console.error('Failed to load pieces with movement:', err);
        // Fallback: try loading regular pieces
        try {
          const fallbackResponse = await PiecesService.getPieces();
          const fallbackData = fallbackResponse.data;
          const fallbackPieces = Array.isArray(fallbackData) ? fallbackData : (fallbackData?.pieces || []);
          setFullPiecesList(fallbackPieces);
        } catch (fallbackErr) {
          console.error('Fallback also failed:', fallbackErr);
          setFullPiecesList([]);
        }
      } finally {
        setPiecesLoading(false);
      }
    };
    loadPieces();
  }, []);

  // State for multiple sandboxes
  const [sandboxes, setSandboxes] = useState([]);
  const [activeSandboxId, setActiveSandboxId] = useState(null);
  const sandboxesLoadedRef = useRef(false);
  
  // UI state
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredHighlights, setHoveredHighlights] = useState({});
  const [showGameTypes, setShowGameTypes] = useState(true);
  const [showPieceLibrary, setShowPieceLibrary] = useState(true);
  const [showWinConditions, setShowWinConditions] = useState(true);
  const [showDrawConditions, setShowDrawConditions] = useState(false);
  const [showGameMechanics, setShowGameMechanics] = useState(false);
  // searchGameTerm already declared near top of component — do not re-declare here
  const [searchPieceTerm, setSearchPieceTerm] = useState("");
  const [showHighlights, setShowHighlights] = useState(true);
  const [showAllSpecialSquares, setShowAllSpecialSquares] = useState(true);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [playingAs, setPlayingAs] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const touchDragRef = useRef({ piece: null, startX: 0, startY: 0, isDragging: false, grabOffsetX: 0, grabOffsetY: 0 });
  const [touchDragPos, setTouchDragPos] = useState(null);
  const [touchDragPiece, setTouchDragPiece] = useState(null);
  // Holds structured special-square data (LiveGame format) for the active sandbox.
  // Updated synchronously each render so it is always current when event handlers run.
  const gameSpecialSquaresRef = useRef({ range: {}, promotion: {}, control: {}, special: {} });

  // Pagination for sidebars
  const ITEMS_PER_PAGE = 20;
  const [piecePage, setPiecePage] = useState(1);

  // Per-sandbox rules now live on each sandbox object. We expose helpers that
  // forward reads/writes to the active sandbox so existing sidebar JSX keeps working.
  // (Initialized after activeSandbox is computed below.)
  // Promotion modal state
  const [promotionPending, setPromotionPending] = useState(null);
  
  // Initialize sidebarPlayerView from localStorage
  const getInitialSidebarPlayerView = () => {
    const saved = localStorage.getItem('sandboxSidebarPlayerView');
    return saved ? parseInt(saved) : 1;
  };
  const [sidebarPlayerView, setSidebarPlayerView] = useState(getInitialSidebarPlayerView());
  const boardAnimationsEnabled = localStorage.getItem('boardAnimations') !== 'false';
  const pieceShadowEnabled = localStorage.getItem('pieceShadow') === 'true';
  
  // Save sidebarPlayerView to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('sandboxSidebarPlayerView', sidebarPlayerView.toString());
  }, [sidebarPlayerView]);
  
  // Right-click modal state
  const [showRightClickModal, setShowRightClickModal] = useState(false);
  const [rightClickPosition, setRightClickPosition] = useState(null);
  const [rightClickMode, setRightClickMode] = useState('piece'); // 'piece' or 'special'
  const [isMobile, setIsMobile] = useState(false);
  const longPressTimeoutRef = useRef(null);
  
  // Ranged attack state
  const [rangedAttackSource, setRangedAttackSource] = useState(null); // piece being right-click-dragged
  const [rangedMousePos, setRangedMousePos] = useState(null); // current mouse position for arrow
  const [, setRangedTargetSquare] = useState(null); // square under cursor
  const boardRef = useRef(null);
  const rightClickDataRef = useRef(null); // tracks right-click start for click-vs-drag detection
  const [isRightClickActive, setIsRightClickActive] = useState(false);

  // Detect if on mobile device
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('chessus-sandboxes');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setSandboxes(parsed.slice(0, MAX_SANDBOXES));
          if (parsed.length > 0) {
            setActiveSandboxId(parsed[0].id);
          }
        } else {
          console.warn('Saved sandboxes is not an array, resetting');
          localStorage.removeItem('chessus-sandboxes');
        }
      } catch (e) {
        console.error('Failed to load sandboxes:', e);
        localStorage.removeItem('chessus-sandboxes');
      }
    }
    sandboxesLoadedRef.current = true;
  }, []);

  // Handle pending piece from PieceView "Try in Sandbox" button
  useEffect(() => {
    if (!sandboxesLoadedRef.current) return;
    const pendingRaw = localStorage.getItem('chessus-sandbox-pending-piece');
    if (!pendingRaw) return;
    localStorage.removeItem('chessus-sandbox-pending-piece');

    const loadPendingPiece = async () => {
      try {
        const pending = JSON.parse(pendingRaw);
        const response = await PiecesService.getPieceById(pending.pieceId);
        const fullPiece = response.data;
        if (!fullPiece) return;

        // Parse piece images
        let images = [];
        if (fullPiece.image_location) {
          try {
            const parsed = JSON.parse(fullPiece.image_location);
            if (Array.isArray(parsed)) {
              images = parsed.map(img => img.startsWith('http') ? img : `${ASSET_URL}${img}`);
            }
          } catch {
            const p = fullPiece.image_location;
            images = [p.startsWith('http') ? p : `${ASSET_URL}${p.startsWith('/uploads/') ? p : `/uploads/pieces/${p}`}`];
          }
        }

        const pieceForSandbox = {
          ...fullPiece,
          ratio_movement_1: fullPiece.ratio_movement_1 || fullPiece.ratio_one_movement,
          ratio_movement_2: fullPiece.ratio_movement_2 || fullPiece.ratio_two_movement,
          step_movement_style: fullPiece.step_by_step_movement_style ?? fullPiece.step_movement_style,
          step_movement_value: fullPiece.step_by_step_movement_value ?? fullPiece.step_movement_value,
          ratio_capture_1: fullPiece.ratio_capture_1 || fullPiece.ratio_one_capture,
          ratio_capture_2: fullPiece.ratio_capture_2 || fullPiece.ratio_two_capture,
          step_capture_value: fullPiece.step_capture_value || fullPiece.step_by_step_capture,
          step_by_step_attack_range: (fullPiece.step_by_step_attack_value != null && fullPiece.step_by_step_attack_value !== 0)
            ? (fullPiece.step_by_step_attack_style ? -Math.abs(fullPiece.step_by_step_attack_value) : fullPiece.step_by_step_attack_value)
            : (fullPiece.step_by_step_attack_range || null),
          id: `piece-${Date.now()}-0`,
          piece_id: fullPiece.piece_id,
          x: pending.centerX,
          y: pending.centerY,
          team: 1,
          player_id: 1,
          piece_image_urls: images,
          name: fullPiece.piece_name,
          move_count: 0,
        };

        const newSandbox = {
          id: Date.now(),
          name: fullPiece.piece_name || 'Piece Preview',
          gameType: { board_width: pending.boardWidth, board_height: pending.boardHeight, game_name: fullPiece.piece_name || 'Piece Preview' },
          pieces: [pieceForSandbox],
          specialSquares: {},
          gameSpecialSquares: { range: {}, promotion: {}, control: {}, special: {} },
          currentTurn: 1,
          moveHistory: [],
          ...buildInitialSandboxState(null),
        };

        setSandboxes(prev => {
          let updated = [...prev];
          if (updated.length >= MAX_SANDBOXES) {
            // Remove the first (least recent) sandbox
            updated = updated.slice(1);
            // Re-label any auto-named sandboxes
            updated = updated.map((s, index) => {
              if (s.name.match(/^Sandbox \d+$/)) {
                return { ...s, name: `Sandbox ${index + 1}` };
              }
              return s;
            });
          }
          return [...updated, newSandbox];
        });
        setActiveSandboxId(newSandbox.id);
      } catch (e) {
        console.error('Failed to load pending piece for sandbox:', e);
      }
    };

    loadPendingPiece();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to localStorage whenever sandboxes change
  useEffect(() => {
    if (sandboxes.length > 0) {
      localStorage.setItem('chessus-sandboxes', JSON.stringify(sandboxes.slice(0, MAX_SANDBOXES)));
    } else {
      localStorage.removeItem('chessus-sandboxes');
    }
  }, [sandboxes]);

  // Get active sandbox
  const activeSandbox = useMemo(() => {
    return sandboxes.find(s => s.id === activeSandboxId);
  }, [sandboxes, activeSandboxId]);

  // Fit-to-container sizing + zoom for the sandbox board.
  const boardVpHook = useBoardViewport({
    boardWidth: activeSandbox?.gameType?.board_width,
    boardHeight: activeSandbox?.gameType?.board_height,
    maxHeight: () => Math.max(360, (typeof window !== 'undefined' ? window.innerHeight : 800) - 140),
    fitMaxSquare: 92,
    insetW: 28,
    insetH: 28,
  });

  // Keep gameSpecialSquaresRef current (synchronous render-time ref update)
  gameSpecialSquaresRef.current = activeSandbox?.gameSpecialSquares || { range: {}, promotion: {}, control: {}, special: {} };

  // Per-sandbox rules adapter: existing JSX reads `sandboxRules` and calls
  // `setSandboxRules`. These now mirror to the active sandbox's `rules` field.
  const sandboxRules = activeSandbox?.rules || DEFAULT_SANDBOX_RULES;
  const setSandboxRules = useCallback((updater) => {
    setSandboxes(prev => prev.map(s => {
      if (s.id !== activeSandboxId) return s;
      const current = s.rules || DEFAULT_SANDBOX_RULES;
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...s, rules: next };
    }));
  }, [activeSandboxId]);

  // Helper to merge updates onto the active sandbox
  const updateActiveSandbox = useCallback((updater) => {
    setSandboxes(prev => prev.map(s => {
      if (s.id !== activeSandboxId) return s;
      const patch = typeof updater === 'function' ? updater(s) : updater;
      return { ...s, ...patch };
    }));
  }, [activeSandboxId]);

  // Get the last move for highlighting
  const lastMove = useMemo(() => {
    if (!activeSandbox?.moveHistory?.length) return null;
    return activeSandbox.moveHistory[activeSandbox.moveHistory.length - 1];
  }, [activeSandbox]);

  // Generate unique sandbox name
  const getNextSandboxName = useCallback(() => {
    const existingNumbers = sandboxes
      .map(s => {
        const match = s.name.match(/^Sandbox (\d+)$/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(n => n > 0);
    
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }
    return `Sandbox ${nextNumber}`;
  }, [sandboxes]);

  // Create a new blank sandbox
  const createBlankSandbox = useCallback(() => {
    if (sandboxes.length >= MAX_SANDBOXES) {
      alert(`Maximum of ${MAX_SANDBOXES} sandboxes allowed. Please close one to create a new one.`);
      return;
    }
    
    const newSandbox = {
      id: Date.now(),
      name: getNextSandboxName(),
      gameType: { board_width: 8, board_height: 8, game_name: "Blank Board" },
      pieces: [],
      specialSquares: {},
      gameSpecialSquares: { range: {}, promotion: {}, control: {}, special: {} },
      currentTurn: 1,
      moveHistory: [],
      ...buildInitialSandboxState(null),
    };
    setSandboxes(prev => [...prev, newSandbox]);
    setActiveSandboxId(newSandbox.id);
  }, [sandboxes.length, getNextSandboxName]);

  // Helper to get full piece data by ID
  const getFullPieceData = useCallback((pieceId) => {
    // Try multiple ID formats
    const numId = parseInt(pieceId);
    return fullPiecesList.find(p => 
      p.id === pieceId || 
      p.piece_id === pieceId ||
      p.id === numId ||
      p.piece_id === numId
    );
  }, [fullPiecesList]);

  // Helper to normalize piece data from database to frontend-expected format
  const normalizePieceData = useCallback((dbPiece) => {
    if (!dbPiece) return null;
    return {
      ...dbPiece,
      // Movement properties - map DB column names to what movement logic expects
      ratio_movement_1: dbPiece.ratio_movement_1 || dbPiece.ratio_one_movement,
      ratio_movement_2: dbPiece.ratio_movement_2 || dbPiece.ratio_two_movement,
      step_movement_style: dbPiece.step_by_step_movement_style ?? dbPiece.step_movement_style,
      step_movement_value: dbPiece.step_by_step_movement_value ?? dbPiece.step_movement_value,
      // Capture properties - map DB column names
      ratio_capture_1: dbPiece.ratio_capture_1 || dbPiece.ratio_one_capture,
      ratio_capture_2: dbPiece.ratio_capture_2 || dbPiece.ratio_two_capture,
      step_capture_value: dbPiece.step_capture_value || dbPiece.step_by_step_capture,
      // Ranged attack properties - normalize field names
      step_by_step_attack_range: (dbPiece.step_by_step_attack_value != null && dbPiece.step_by_step_attack_value !== 0)
        ? (dbPiece.step_by_step_attack_style ? -Math.abs(dbPiece.step_by_step_attack_value) : dbPiece.step_by_step_attack_value)
        : (dbPiece.step_by_step_attack_range || null),
    };
  }, []);

  // Load a game type into a new sandbox - fetch full piece data
  const loadGameType = useCallback(async (gameType) => {
    if (sandboxes.length >= MAX_SANDBOXES) {
      alert(`Maximum of ${MAX_SANDBOXES} sandboxes allowed. Please close one to create a new one.`);
      return;
    }
    
    // Fetch fresh game data from the server (includes junction table pieces)
    let freshGameData = gameType;
    try {
      freshGameData = await dispatch(getGameById(gameType.id));
    } catch (err) {
      console.warn('Failed to fetch fresh game data, using cached:', err);
    }
    
    // The field is called pieces_string in the database, not piece_layout
    const pieceLayoutRaw = freshGameData.pieces_string || freshGameData.piece_layout;
    
    let pieces = [];
    if (pieceLayoutRaw) {
      try {
        const parsedLayout = JSON.parse(pieceLayoutRaw);
        
        // Convert to array format - handle both object {"row,col": {...}} and array [{...}] formats
        let layout;
        if (Array.isArray(parsedLayout)) {
          layout = parsedLayout;
        } else if (typeof parsedLayout === 'object') {
          // Convert object format to array, extracting coordinates from keys
          layout = Object.entries(parsedLayout).map(([key, pieceData]) => {
            const [row, col] = key.split(',').map(Number);
            return {
              ...pieceData,
              x: col,
              y: row
            };
          });
        } else {
          layout = [];
        }
        
        // Enrich each piece with full movement data
        pieces = await Promise.all(layout.map(async (p, index) => {
          const pieceId = p.piece_id || p.id;
          
          // Try to find in our cached full pieces first
          let fullPiece = getFullPieceData(pieceId);
          
          // If not found, fetch it individually
          if (!fullPiece && pieceId) {
            try {
              const response = await PiecesService.getPieceById(pieceId);
              fullPiece = response.data;
            } catch (err) {
              console.error('Failed to fetch piece:', pieceId, err);
            }
          }
          
          // Normalize piece data to ensure movement/capture properties are accessible
          const normalizedPiece = normalizePieceData(fullPiece);
          
          // Get position and player ID (support both player_id and player_number)
          const posY = p.y ?? p.row ?? p.yLocation ?? 0;
          const playerId = p.player_id || p.player_number || p.player || p.team || 1;
          
          // Don't flip Y - render pieces in same orientation as GameTypeView
          // pieces_string stores positions exactly as placed in game wizard
          
          const resultPiece = {
            ...normalizedPiece,
            ...p,
            // Re-apply normalized movement after spreading p (p may override with stale/empty values)
            ratio_movement_1: normalizedPiece?.ratio_movement_1,
            ratio_movement_2: normalizedPiece?.ratio_movement_2,
            step_movement_style: normalizedPiece?.step_movement_style,
            step_movement_value: normalizedPiece?.step_movement_value,
            ratio_capture_1: normalizedPiece?.ratio_capture_1,
            ratio_capture_2: normalizedPiece?.ratio_capture_2,
            step_capture_value: normalizedPiece?.step_capture_value,
            // Re-apply ranged attack data after spreading p
            can_capture_enemy_via_range: normalizedPiece?.can_capture_enemy_via_range,
            up_attack_range: normalizedPiece?.up_attack_range,
            down_attack_range: normalizedPiece?.down_attack_range,
            left_attack_range: normalizedPiece?.left_attack_range,
            right_attack_range: normalizedPiece?.right_attack_range,
            up_left_attack_range: normalizedPiece?.up_left_attack_range,
            up_right_attack_range: normalizedPiece?.up_right_attack_range,
            down_left_attack_range: normalizedPiece?.down_left_attack_range,
            down_right_attack_range: normalizedPiece?.down_right_attack_range,
            up_attack_range_exact: normalizedPiece?.up_attack_range_exact,
            down_attack_range_exact: normalizedPiece?.down_attack_range_exact,
            left_attack_range_exact: normalizedPiece?.left_attack_range_exact,
            right_attack_range_exact: normalizedPiece?.right_attack_range_exact,
            up_left_attack_range_exact: normalizedPiece?.up_left_attack_range_exact,
            up_right_attack_range_exact: normalizedPiece?.up_right_attack_range_exact,
            down_left_attack_range_exact: normalizedPiece?.down_left_attack_range_exact,
            down_right_attack_range_exact: normalizedPiece?.down_right_attack_range_exact,
            ratio_one_attack_range: normalizedPiece?.ratio_one_attack_range,
            ratio_two_attack_range: normalizedPiece?.ratio_two_attack_range,
            step_by_step_attack_range: (normalizedPiece?.step_by_step_attack_value != null && normalizedPiece?.step_by_step_attack_value !== 0)
              ? (normalizedPiece?.step_by_step_attack_style ? -Math.abs(normalizedPiece.step_by_step_attack_value) : normalizedPiece.step_by_step_attack_value)
              : (normalizedPiece?.step_by_step_attack_range || null),
            ranged_capture_actions_per_turn: normalizedPiece?.ranged_capture_actions_per_turn,
            exact_ratio_hop_only: normalizedPiece?.exact_ratio_hop_only,
            directional_hop_disabled: normalizedPiece?.directional_hop_disabled,
            id: `piece-${Date.now()}-${index}`,
            piece_id: pieceId,
            x: p.x ?? p.col ?? p.xLocation ?? 0,
            y: posY,
            team: playerId,
            player_id: playerId,
            move_count: 0,
            // Junction-table / per-piece-instance fields with sensible defaults so the
            // sandbox HP/damage system and end-game detection work.
            hit_points: p.hit_points ?? normalizedPiece?.hit_points ?? 1,
            current_hp: p.current_hp ?? p.hit_points ?? normalizedPiece?.hit_points ?? 1,
            attack_damage: p.attack_damage ?? normalizedPiece?.attack_damage ?? 1,
            show_hp_ad: p.show_hp_ad ?? false,
            ends_game_on_capture: p.ends_game_on_capture ?? normalizedPiece?.ends_game_on_capture ?? false,
            ends_game_on_checkmate: p.ends_game_on_checkmate ?? normalizedPiece?.ends_game_on_checkmate ?? false,
            cannot_be_captured: p.cannot_be_captured ?? normalizedPiece?.cannot_be_captured ?? false,
            trample: p.trample ?? normalizedPiece?.trample ?? false,
            trample_radius: p.trample_radius ?? normalizedPiece?.trample_radius ?? 0,
            ghostwalk: p.ghostwalk ?? normalizedPiece?.ghostwalk ?? false,
            die_on_capture: p.die_on_capture ?? normalizedPiece?.die_on_capture ?? false,
            die_on_capture_grants_win: p.die_on_capture_grants_win ?? normalizedPiece?.die_on_capture_grants_win ?? false,
            can_promote: p.can_promote ?? normalizedPiece?.can_promote ?? false,
            promotion_pieces_override: p.promotion_pieces_override ?? null,
            disable_promotion: p.disable_promotion ?? false,
          };
          
          return resultPiece;
        }));
      } catch (e) {
        console.error('Failed to parse piece layout:', e);
      }
    }
    
    // Build placement pool from other_game_data.placeable_pieces (if any)
    let placementPool = [];
    try {
      const od = freshGameData.other_game_data ? (typeof freshGameData.other_game_data === 'string' ? JSON.parse(freshGameData.other_game_data) : freshGameData.other_game_data) : {};
      if (Array.isArray(od.placeable_pieces)) {
        placementPool = od.placeable_pieces;
      }
    } catch (_) { /* ignore */ }

    const initState = buildInitialSandboxState(buildRulesFromGameType(freshGameData));
    initState.placementPool = placementPool;

    // Parse special square strings from the game type into structured LiveGame-format data
    const gameSpecialSquares = { range: {}, promotion: {}, control: {}, special: {} };
    try { if (freshGameData.range_squares_string) gameSpecialSquares.range = JSON.parse(freshGameData.range_squares_string) || {}; } catch (_) {}
    try { if (freshGameData.promotion_squares_string) gameSpecialSquares.promotion = JSON.parse(freshGameData.promotion_squares_string) || {}; } catch (_) {}
    try { if (freshGameData.control_squares_string) gameSpecialSquares.control = JSON.parse(freshGameData.control_squares_string) || {}; } catch (_) {}
    try { if (freshGameData.special_squares_string) gameSpecialSquares.special = JSON.parse(freshGameData.special_squares_string) || {}; } catch (_) {}

    // Build display format (x,y keys → type string) for board coloring
    // LiveGame stores these with "y,x" (row,col) keys; display format uses "x,y" (col,row)
    const displaySpecialSquares = {};
    Object.keys(gameSpecialSquares.range).forEach(k => { const [y, x] = k.split(','); displaySpecialSquares[`${x},${y}`] = 'range'; });
    Object.keys(gameSpecialSquares.promotion).forEach(k => { const [y, x] = k.split(','); displaySpecialSquares[`${x},${y}`] = 'promotion'; });
    Object.keys(gameSpecialSquares.control).forEach(k => { const [y, x] = k.split(','); displaySpecialSquares[`${x},${y}`] = 'control'; });
    Object.keys(gameSpecialSquares.special).forEach(k => { const [y, x] = k.split(','); displaySpecialSquares[`${x},${y}`] = 'custom'; });

    const newSandbox = {
      id: Date.now(),
      name: freshGameData.game_name || gameType.game_name,
      gameType: freshGameData,
      pieces: pieces,
      specialSquares: displaySpecialSquares,
      gameSpecialSquares,
      currentTurn: 1,
      moveHistory: [],
      ...initState,
    };
    setSandboxes(prev => [...prev, newSandbox]);
    setActiveSandboxId(newSandbox.id);
  }, [sandboxes.length, getFullPieceData, normalizePieceData, dispatch]);

  // Delete a sandbox and relabel remaining ones
  const deleteSandbox = useCallback((sandboxId) => {
    setSandboxes(prev => {
      const filtered = prev.filter(s => s.id !== sandboxId);
      const relabeled = filtered.map((s, index) => {
        if (s.name.match(/^Sandbox \d+$/)) {
          return { ...s, name: `Sandbox ${index + 1}` };
        }
        return s;
      });
      
      if (activeSandboxId === sandboxId) {
        if (relabeled.length > 0) {
          setTimeout(() => setActiveSandboxId(relabeled[0].id), 0);
        } else {
          setTimeout(() => setActiveSandboxId(null), 0);
        }
      }
      
      return relabeled;
    });
  }, [activeSandboxId]);

  // Multi-tile aware piece finder: finds a piece whose footprint covers (x, y)
  const findPieceAt = useCallback((pieces, x, y) => {
    return pieces.find(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      return x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph;
    });
  }, []);

  // Add a piece from library to the board
  const addPieceToBoard = useCallback((pieceData, x, y, playerId = null) => {
    if (!activeSandbox) return;
    
    const targetPlayer = playerId || sidebarPlayerView;
    
    const newPiece = {
      id: `piece-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      piece_id: pieceData.piece_id || pieceData.id,
      piece_name: pieceData.piece_name,
      image_location: pieceData.image_location,
      image_url: pieceData.image_url,
      x: x,
      y: y,
      team: targetPlayer,
      player_id: targetPlayer,
      // Copy ALL movement/capture properties
      directional_movement_style: pieceData.directional_movement_style,
      up_movement: pieceData.up_movement,
      down_movement: pieceData.down_movement,
      left_movement: pieceData.left_movement,
      right_movement: pieceData.right_movement,
      up_left_movement: pieceData.up_left_movement,
      up_right_movement: pieceData.up_right_movement,
      down_left_movement: pieceData.down_left_movement,
      down_right_movement: pieceData.down_right_movement,
      ratio_movement_style: pieceData.ratio_movement_style,
      ratio_movement_1: pieceData.ratio_movement_1 || pieceData.ratio_one_movement,
      ratio_movement_2: pieceData.ratio_movement_2 || pieceData.ratio_two_movement,
      step_movement_style: pieceData.step_by_step_movement_style ?? pieceData.step_movement_style,
      step_movement_value: pieceData.step_by_step_movement_value ?? pieceData.step_movement_value,
      can_hop_over_allies: pieceData.can_hop_over_allies,
      can_hop_over_enemies: pieceData.can_hop_over_enemies,
      exact_ratio_hop_only: pieceData.exact_ratio_hop_only,
      directional_hop_disabled: pieceData.directional_hop_disabled,
      can_capture_enemy_on_move: pieceData.can_capture_enemy_on_move,
      attacks_like_movement: pieceData.attacks_like_movement,
      // Movement exact flags
      up_movement_exact: pieceData.up_movement_exact,
      down_movement_exact: pieceData.down_movement_exact,
      left_movement_exact: pieceData.left_movement_exact,
      right_movement_exact: pieceData.right_movement_exact,
      up_left_movement_exact: pieceData.up_left_movement_exact,
      up_right_movement_exact: pieceData.up_right_movement_exact,
      down_left_movement_exact: pieceData.down_left_movement_exact,
      down_right_movement_exact: pieceData.down_right_movement_exact,
      // Capture exact flags
      up_capture_exact: pieceData.up_capture_exact,
      down_capture_exact: pieceData.down_capture_exact,
      left_capture_exact: pieceData.left_capture_exact,
      right_capture_exact: pieceData.right_capture_exact,
      up_left_capture_exact: pieceData.up_left_capture_exact,
      up_right_capture_exact: pieceData.up_right_capture_exact,
      down_left_capture_exact: pieceData.down_left_capture_exact,
      down_right_capture_exact: pieceData.down_right_capture_exact,
      up_capture: pieceData.up_capture,
      down_capture: pieceData.down_capture,
      left_capture: pieceData.left_capture,
      right_capture: pieceData.right_capture,
      up_left_capture: pieceData.up_left_capture,
      up_right_capture: pieceData.up_right_capture,
      down_left_capture: pieceData.down_left_capture,
      down_right_capture: pieceData.down_right_capture,
      ratio_capture_1: pieceData.ratio_capture_1,
      ratio_capture_2: pieceData.ratio_capture_2,
      step_capture_value: pieceData.step_capture_value || pieceData.step_by_step_capture,
      // Repeating movement/capture
      repeating_movement: pieceData.repeating_movement,
      repeating_capture: pieceData.repeating_capture,
      repeating_ratio: pieceData.repeating_ratio,
      repeating_ratio_capture: pieceData.repeating_ratio_capture,
      max_ratio_iterations: pieceData.max_ratio_iterations,
      max_ratio_capture_iterations: pieceData.max_ratio_capture_iterations,
      // Copy special scenario data (additional/first-move movements and captures)
      special_scenario_moves: pieceData.special_scenario_moves,
      special_scenario_captures: pieceData.special_scenario_captures,
      // Copy castling/promotion data
      can_castle: pieceData.can_castle,
      can_promote: pieceData.can_promote,
      promotion_options: pieceData.promotion_options,
      // Copy ranged attack data
      can_capture_enemy_via_range: pieceData.can_capture_enemy_via_range,
      up_attack_range: pieceData.up_attack_range,
      down_attack_range: pieceData.down_attack_range,
      left_attack_range: pieceData.left_attack_range,
      right_attack_range: pieceData.right_attack_range,
      up_left_attack_range: pieceData.up_left_attack_range,
      up_right_attack_range: pieceData.up_right_attack_range,
      down_left_attack_range: pieceData.down_left_attack_range,
      down_right_attack_range: pieceData.down_right_attack_range,
      up_attack_range_exact: pieceData.up_attack_range_exact,
      down_attack_range_exact: pieceData.down_attack_range_exact,
      left_attack_range_exact: pieceData.left_attack_range_exact,
      right_attack_range_exact: pieceData.right_attack_range_exact,
      up_left_attack_range_exact: pieceData.up_left_attack_range_exact,
      up_right_attack_range_exact: pieceData.up_right_attack_range_exact,
      down_left_attack_range_exact: pieceData.down_left_attack_range_exact,
      down_right_attack_range_exact: pieceData.down_right_attack_range_exact,
      ratio_one_attack_range: pieceData.ratio_one_attack_range,
      ratio_two_attack_range: pieceData.ratio_two_attack_range,
      step_by_step_attack_range: (pieceData.step_by_step_attack_value != null && pieceData.step_by_step_attack_value !== 0)
        ? (pieceData.step_by_step_attack_style ? -Math.abs(pieceData.step_by_step_attack_value) : pieceData.step_by_step_attack_value)
        : (pieceData.step_by_step_attack_range || null),
      ranged_capture_actions_per_turn: pieceData.ranged_capture_actions_per_turn,
      can_fire_over_allies: pieceData.can_fire_over_allies,
      can_fire_over_enemies: pieceData.can_fire_over_enemies,
      // Multi-tile dimensions
      piece_width: pieceData.piece_width || 1,
      piece_height: pieceData.piece_height || 1,
      // Checkers-style capture
      capture_on_hop: pieceData.capture_on_hop,
      chain_capture_enabled: pieceData.chain_capture_enabled,
      chain_hop_over_allies: pieceData.chain_hop_over_allies,
      // Attack hopping
      can_hop_attack_over_allies: pieceData.can_hop_attack_over_allies,
      can_hop_attack_over_enemies: pieceData.can_hop_attack_over_enemies,
      // Special abilities
      can_en_passant: pieceData.can_en_passant,
      free_move_after_promotion: pieceData.free_move_after_promotion,
      can_capture_allies: pieceData.can_capture_allies,
      cannot_be_captured: pieceData.cannot_be_captured,
      // Custom square movement/attack
      custom_movement_squares: pieceData.custom_movement_squares,
      custom_attack_squares: pieceData.custom_attack_squares,
      // Track move count so first-move-only restrictions apply correctly
      move_count: 0,
      // Junction-table / per-instance fields (HP/AD, win-condition flags, etc.)
      hit_points: pieceData.hit_points ?? 1,
      current_hp: pieceData.current_hp ?? pieceData.hit_points ?? 1,
      attack_damage: pieceData.attack_damage ?? 1,
      show_hp_ad: pieceData.show_hp_ad ?? false,
      ends_game_on_capture: pieceData.ends_game_on_capture ?? false,
      ends_game_on_checkmate: pieceData.ends_game_on_checkmate ?? false,
      trample: pieceData.trample ?? false,
      trample_radius: pieceData.trample_radius ?? 0,
      ghostwalk: pieceData.ghostwalk ?? false,
      die_on_capture: pieceData.die_on_capture ?? false,
      die_on_capture_grants_win: pieceData.die_on_capture_grants_win ?? false,
      promotion_pieces_override: pieceData.promotion_pieces_override ?? null,
      disable_promotion: pieceData.disable_promotion ?? false,
    };

    setSandboxes(prev => prev.map(s => {
      if (s.id !== activeSandboxId) return s;
      // Multi-tile bounds check
      const pw = newPiece.piece_width || 1;
      const ph = newPiece.piece_height || 1;
      const bw = s.gameType?.board_width || 8;
      const bh = s.gameType?.board_height || 8;
      if (x + pw > bw || y + ph > bh) return s;
      const existingPiece = findPieceAt(s.pieces, x, y);
      const filtered = existingPiece 
        ? s.pieces.filter(p => p.id !== existingPiece.id) 
        : s.pieces;
      return { ...s, pieces: [...filtered, newPiece] };
    }));
  }, [activeSandbox, activeSandboxId, sidebarPlayerView, findPieceAt]);

  // Remove a piece from the board
  const removePieceFromBoard = useCallback((pieceId) => {
    if (!activeSandbox) return;
    
    setSandboxes(prev => prev.map(s =>
      s.id === activeSandboxId
        ? { ...s, pieces: s.pieces.filter(p => p.id !== pieceId) }
        : s
    ));
    setSelectedPiece(null);
    setValidMoves([]);
  }, [activeSandbox, activeSandboxId]);

  // Mirror pieces from one player to the other
  const handleMirrorPieces = useCallback((sourcePlayerId, targetPlayerId) => {
    if (!activeSandbox) return;

    const boardWidth = activeSandbox.gameType.board_width || 8;
    const boardHeight = activeSandbox.gameType.board_height || 8;
    const pieces = activeSandbox.pieces || [];

    const sourcePieces = pieces.filter(p => p.player_id === sourcePlayerId || p.team === sourcePlayerId);

    if (sourcePieces.length === 0) {
      alert(`Player ${sourcePlayerId} has no pieces to mirror.`);
      return;
    }

    const targetPieceCount = pieces.filter(p => p.player_id === targetPlayerId || p.team === targetPlayerId).length;

    if (targetPieceCount > 0) {
      if (!window.confirm(
        `Player ${targetPlayerId} already has ${targetPieceCount} piece(s). These will be replaced with mirrored pieces from Player ${sourcePlayerId}. Continue?`
      )) {
        return;
      }
    }

    // Remove all target player pieces
    let newPieces = pieces.filter(p => p.player_id !== targetPlayerId && p.team !== targetPlayerId);

    // Build a set of all squares occupied by source pieces for overlap detection
    const sourceOccupiedSquares = new Set();
    sourcePieces.forEach(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      for (let dy = 0; dy < ph; dy++) {
        for (let dx = 0; dx < pw; dx++) {
          sourceOccupiedSquares.add(`${p.x + dx},${p.y + dy}`);
        }
      }
    });

    let skipped = 0;
    sourcePieces.forEach(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      // Mirror the piece so the entire footprint is reflected across the board center
      // For a piece occupying rows p.y to p.y+ph-1, the mirrored anchor is boardHeight - p.y - ph
      const mirroredY = boardHeight - p.y - ph;

      // Bounds check: mirrored piece must fit on the board
      if (mirroredY < 0 || mirroredY + ph > boardHeight || p.x + pw > boardWidth) {
        skipped++;
        return;
      }

      // Check if any square of the mirrored piece overlaps with source player's pieces
      let overlaps = false;
      for (let dy = 0; dy < ph && !overlaps; dy++) {
        for (let dx = 0; dx < pw && !overlaps; dx++) {
          if (sourceOccupiedSquares.has(`${p.x + dx},${mirroredY + dy}`)) {
            overlaps = true;
          }
        }
      }
      if (overlaps) {
        skipped++;
        return;
      }

      // Remove any existing pieces at the mirrored location
      newPieces = newPieces.filter(existing => {
        const ew = existing.piece_width || 1;
        const eh = existing.piece_height || 1;
        // Check if any square of the mirrored piece overlaps with existing piece
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            const mx = p.x + dx;
            const my = mirroredY + dy;
            if (mx >= existing.x && mx < existing.x + ew &&
                my >= existing.y && my < existing.y + eh) {
              return false;
            }
          }
        }
        return true;
      });

      newPieces.push({
        ...p,
        id: `piece-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        y: mirroredY,
        team: targetPlayerId,
        player_id: targetPlayerId,
        image_url: undefined,
      });
    });

    setSandboxes(prev => prev.map(s =>
      s.id === activeSandboxId
        ? { ...s, pieces: newPieces }
        : s
    ));

    if (skipped > 0) {
      alert(`${skipped} piece(s) could not be mirrored because they would overlap with Player ${sourcePlayerId}'s own pieces or exceed the board.`);
    }
  }, [activeSandbox, activeSandboxId]);

  // Add/remove special square
  const setSpecialSquare = useCallback((x, y, type) => {
    if (!activeSandbox) return;
    
    const displayKey = `${x},${y}`;
    const dataKey = `${y},${x}`; // LiveGame format: row,col
    setSandboxes(prev => prev.map(s => {
      if (s.id !== activeSandboxId) return s;
      
      const newSpecialSquares = { ...s.specialSquares };
      const gss = s.gameSpecialSquares || { range: {}, promotion: {}, control: {}, special: {} };
      const newGss = {
        range: { ...gss.range },
        promotion: { ...gss.promotion },
        control: { ...gss.control },
        special: { ...gss.special },
      };
      // Remove from all data maps first
      delete newGss.range[dataKey];
      delete newGss.promotion[dataKey];
      delete newGss.control[dataKey];
      delete newGss.special[dataKey];

      if (type) {
        newSpecialSquares[displayKey] = type;
        if (type === 'range') newGss.range[dataKey] = { rangeBonus: 1 };
        else if (type === 'promotion') newGss.promotion[dataKey] = {};
        else if (type === 'control') newGss.control[dataKey] = {};
        // 'custom' type: no config without a wizard; treated as decorative only
      } else {
        delete newSpecialSquares[displayKey];
      }
      return { ...s, specialSquares: newSpecialSquares, gameSpecialSquares: newGss };
    }));
  }, [activeSandbox, activeSandboxId]);

  // Check if a value allows movement at a distance
  // repeating: when true and value is exact (negative), allows multiples of the exact value
  const checkMovement = (value, distance, repeating = false) => {
    if (value === 99) return true;
    if (value === 0 || value === null || value === undefined) return false;
    if (value > 0) return distance <= value;
    if (value < 0) {
      const exact = Math.abs(value);
      if (repeating) return distance > 0 && distance % exact === 0;
      return distance === exact;
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

  const getStepMovementConfig = useCallback((pieceData) => {
    const stepValueRaw = pieceData?.step_by_step_movement_value ?? pieceData?.step_movement_value;
    const stepValue = Number(stepValueRaw);

    if (Number.isNaN(stepValue) || stepValue === 0) {
      return null;
    }

    return {
      maxSteps: Math.abs(stepValue),
      noDiagonal: stepValue < 0
    };
  }, []);

  const isStepByStepTarget = useCallback((pieceData, fromX, fromY, toX, toY) => {
    const config = getStepMovementConfig(pieceData);
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

    const occupied = hasGhostwalk ? new Set() : new Set(
      pieces
        .filter(p => p.id !== piece.id)
        .map(p => `${p.x},${p.y}`)
    );

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

  // Check if a move is from a first-move-only additional movement option.
  // Delegates to the centralized helper so we cover every flavour of
  // first-move-only flag (top-level `first_move_only`, per-direction
  // `${direction}_movement_available_for`, ratio/step `availableForMoves`,
  // and additionalMovements `availableForMoves`).
  /* eslint-disable react-hooks/exhaustive-deps */
  const checkIfFirstMoveOnlyMove = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    const result = canPieceMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    return !!result?.isFirstMoveOnly;
  };

  // Check if a capture is from a first-move-only additional capture option.
  const checkIfFirstMoveOnlyCapture = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    const result = canCaptureOnMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    return !!result?.isFirstMoveOnly;
  };

  // Check if piece can move to a square
  // skipExactRatio: when true, skip exact directional and ratio checks (for hop-only validation)
  const canPieceMoveTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio = false, skipCustom = false) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check directional movement (value-only: active iff any direction value is non-zero)
    const hasDirectionalValues = pieceData.up_movement || pieceData.down_movement || 
                                  pieceData.left_movement || pieceData.right_movement ||
                                  pieceData.up_left_movement || pieceData.up_right_movement ||
                                  pieceData.down_left_movement || pieceData.down_right_movement;
    
    if (hasDirectionalValues) {
      let directionalAllowed = false;
      const rep = pieceData.repeating_movement;

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
    const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
    const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
    
    if (ratio1 > 0 && ratio2 > 0) {
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

    // Check step-by-step movement - use sign-based diagonal exclusion
    const rawStepValue = pieceData.step_by_step_movement_value ?? pieceData.step_movement_value;
    const stepValue = Number(rawStepValue);
    if (!Number.isNaN(stepValue) && stepValue !== 0) {
      const maxSteps = Math.abs(stepValue);
      const noDiagonal = stepValue < 0;

      if (noDiagonal) {
        // Only cardinal directions (manhattan distance)
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        return manhattanDistance > 0 && manhattanDistance <= maxSteps;
      }

      // Allow diagonals (chebyshev distance)
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return chebyshevDistance > 0 && chebyshevDistance <= maxSteps;
    }

    // Check additional movements from special scenarios (e.g. pawn double-step)
    if (pieceData.special_scenario_moves) {
      try {
        const parsed = typeof pieceData.special_scenario_moves === 'string'
          ? JSON.parse(pieceData.special_scenario_moves)
          : pieceData.special_scenario_moves;
        const additionalMovements = parsed?.additionalMovements || {};
        
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
          const dist = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
          for (const opt of additionalMovements[direction]) {
            if (skipExactRatio && opt.exact) continue;
            const value = opt.value || 0;
            if (opt.infinite && dist > 0) return true;
            if (opt.exact && dist === value) return true;
            if (!opt.exact && !opt.infinite && dist > 0 && dist <= value) return true;
          }
        }
      } catch (e) {
        // Ignore parse errors
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

    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    const hasSeparateCaptureFields = pieceData.up_capture || pieceData.down_capture || 
                                     pieceData.left_capture || pieceData.right_capture || 
                                     pieceData.up_left_capture || pieceData.up_right_capture ||
                                     pieceData.down_left_capture || pieceData.down_right_capture ||
                                     pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                                     pieceData.step_capture_value ||
                                     pieceData.special_scenario_captures;

    // If piece can capture on move AND no separate capture fields, use movement logic.
    // Skip custom_movement_squares: those are MOVEMENT ONLY and never produce captures
    // (captures must come from custom_attack_squares).
    if ((pieceData.can_capture_enemy_on_move === 1 || pieceData.can_capture_enemy_on_move === true) && !hasSeparateCaptureFields) {
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio, /* skipCustom */ true);
    }

    // Check directional capture
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

    // Check ratio capture
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

    // Check step capture - use sign-based diagonal exclusion
    const rawStepCaptureValue = pieceData.step_capture_value ?? pieceData.step_by_step_capture;
    const stepCaptureValue = Number(rawStepCaptureValue);
    if (!Number.isNaN(stepCaptureValue) && stepCaptureValue !== 0) {
      const maxSteps = Math.abs(stepCaptureValue);
      const noDiagonal = stepCaptureValue < 0;

      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        if (manhattanDistance > 0 && manhattanDistance <= maxSteps) return true;
      } else {
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance > 0 && chebyshevDistance <= maxSteps) return true;
      }
    }

    // Check additional captures from special scenarios
    if (pieceData.special_scenario_captures) {
      try {
        const parsed = typeof pieceData.special_scenario_captures === 'string'
          ? JSON.parse(pieceData.special_scenario_captures)
          : pieceData.special_scenario_captures;
        const additionalCaptures = parsed?.additionalCaptures || {};
        
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
          const dist = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
          for (const opt of additionalCaptures[direction]) {
            if (skipExactRatio && opt.exact) continue;
            const value = opt.value || 0;
            if (opt.infinite && dist > 0) return true;
            if (opt.exact && dist === value) return true;
            if (!opt.exact && !opt.infinite && dist > 0 && dist <= value) return true;
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

  const isPathClear = useCallback((fromX, fromY, toX, toY, pieces, pieceData, isCapture = false, isExactDirectional = false) => {
    // Ghostwalk: piece can pass through any piece
    const hasGhostwalk = pieceData?.ghostwalk === 1 || pieceData?.ghostwalk === true;
    if (hasGhostwalk) return true;

    const directionalHopDisabled = pieceData?.directional_hop_disabled === 1 || pieceData?.directional_hop_disabled === true;
    const baseCanHopAllies = pieceData?.can_hop_over_allies === 1 || pieceData?.can_hop_over_allies === true;
    const baseCanHopEnemies = pieceData?.can_hop_over_enemies === 1 || pieceData?.can_hop_over_enemies === true;
    const pieceTeam = pieceData?.player_id || pieceData?.team;
    const movingPieceId = pieceData?.id;
    
    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    
    // L-shape or knight-like move
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      // Ratio/L-shape: directionalHopDisabled does NOT affect these — always use full hop ability
      const canHopAllies = baseCanHopAllies;
      const canHopEnemies = baseCanHopEnemies;

      // If piece can hop over both allies and enemies, no path check needed
      if (canHopAllies && canHopEnemies) return true;

      // Non-hopping ratio piece: check both L-paths, valid if EITHER is clear
      const signX = dx;
      const signY = dy;
      const checkLPath = (squares) => {
        for (const [sx, sy] of squares) {
          const bp = findPieceAt(pieces, sx, sy);
          if (bp && bp.id !== movingPieceId) {
            const bTeam = bp.player_id || bp.team;
            const isAlly = bTeam === pieceTeam;
            if (isAlly && !canHopAllies) return false;
            if (!isAlly && !canHopEnemies) return false;
          }
        }
        return true;
      };
      // Path 1: horizontal first, then vertical
      const path1 = [];
      for (let i = 1; i <= xDiff; i++) path1.push([fromX + signX * i, fromY]);
      for (let j = 1; j < yDiff; j++) path1.push([toX, fromY + signY * j]);
      // Path 2: vertical first, then horizontal
      const path2 = [];
      for (let j = 1; j <= yDiff; j++) path2.push([fromX, fromY + signY * j]);
      for (let i = 1; i < xDiff; i++) path2.push([fromX + signX * i, toY]);

      return checkLPath(path1) || checkLPath(path2);
    }

    // Straight-line (directional) move: apply directionalHopDisabled
    // Hopping allowed if: piece has hop ability AND (flag is off OR move is exact directional)
    const canHopAllies = baseCanHopAllies && (!directionalHopDisabled || isExactDirectional);
    const canHopEnemies = baseCanHopEnemies && (!directionalHopDisabled || isExactDirectional);

    let x = fromX + dx;
    let y = fromY + dy;

    while (x !== toX || y !== toY) {
      const blockingPiece = findPieceAt(pieces, x, y);
      if (blockingPiece && blockingPiece.id !== movingPieceId) {
        const blockingTeam = blockingPiece.player_id || blockingPiece.team;
        const isAlly = blockingTeam === pieceTeam;
        
        if (isAlly && !canHopAllies) return false;
        if (!isAlly && !canHopEnemies) return false;
      }
      x += dx;
      y += dy;
    }

    return true;
  }, [findPieceAt]);

  // Apply range boost when a piece is on a range square or custom+asRange square.
  // Reads from gameSpecialSquaresRef (kept current each render) so the dep array stays empty.
  const applyRangeSquareBonusSandbox = useCallback((piece) => {
    const gss = gameSpecialSquaresRef.current;
    if (!gss) return piece;
    const key = `${piece.y},${piece.x}`; // LiveGame format: row,col
    const rangeEntry = (gss.range || {})[key];
    const customEntry = (gss.special || {})[key];
    if (!rangeEntry && !customEntry?.asRange) return piece;
    const bonus = rangeEntry?.rangeBonus || 1;
    const boosted = { ...piece };
    const boost = (val) => {
      if (!val || val === 0 || val === 99) return val;
      if (val < 0) return val - bonus;
      return val + bonus;
    };
    const dirs = ['up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'];
    for (const dir of dirs) {
      if (boosted[`${dir}_movement`]) boosted[`${dir}_movement`] = boost(boosted[`${dir}_movement`]);
      if (boosted[`${dir}_capture`]) boosted[`${dir}_capture`] = boost(boosted[`${dir}_capture`]);
      if (boosted[`${dir}_attack_range`]) boosted[`${dir}_attack_range`] = boost(boosted[`${dir}_attack_range`]);
    }
    if (boosted.step_movement_value) boosted.step_movement_value = boost(boosted.step_movement_value);
    if (boosted.step_capture_value) boosted.step_capture_value = boost(boosted.step_capture_value);
    if (boosted.step_by_step_attack_range) boosted.step_by_step_attack_range = boost(boosted.step_by_step_attack_range);
    if (boosted.ratio_movement_1) boosted.ratio_movement_1 = boost(boosted.ratio_movement_1);
    if (boosted.ratio_movement_2) boosted.ratio_movement_2 = boost(boosted.ratio_movement_2);
    if (boosted.ratio_one_attack_range) boosted.ratio_one_attack_range = boost(boosted.ratio_one_attack_range);
    if (boosted.ratio_two_attack_range) boosted.ratio_two_attack_range = boost(boosted.ratio_two_attack_range);
    return boosted;
  }, []); // no deps — reads from stable ref

  // Calculate valid moves for a piece (includes ranged attacks)
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight) => {
    // Apply range bonus if the piece is on a range or custom+asRange square
    piece = applyRangeSquareBonusSandbox(piece);

    // Compute special-square effects on first-move-only moves and zone restriction
    const gss = gameSpecialSquaresRef.current;
    const customMap = gss.special || {};
    const currentKey = `${piece.y},${piece.x}`; // row,col format
    const currentCfg = customMap[currentKey];

    // blockFirstMove: disableFirstMoveHere on current square, OR piece not on any
    // restrictFirstMoveToCustom square when at least one such square exists
    let blockFirstMove = false;
    if (currentCfg?.disableFirstMoveHere) {
      blockFirstMove = true;
    } else {
      const hasRestrict = Object.values(customMap).some(cfg => cfg?.restrictFirstMoveToCustom);
      if (hasRestrict && !currentCfg) blockFirstMove = true;
    }

    // Restriction zone: if piece has cannot_move_outside_zone and zone squares exist,
    // build the set of allowed destination keys (row,col format)
    let zoneSquareKeys = null;
    if (piece.cannot_move_outside_zone) {
      const zoneKeys = Object.entries(customMap)
        .filter(([, cfg]) => cfg?.asRestrictionZone)
        .map(([k]) => k);
      if (zoneKeys.length > 0) zoneSquareKeys = new Set(zoneKeys);
    }

    const moves = [];
    const pieceTeam = piece.player_id || piece.team;
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;

    // Main loop: check normal moves and captures
    for (let toY = 0; toY < boardHeight; toY++) {
      for (let toX = 0; toX < boardWidth; toX++) {
        if (toX === piece.x && toY === piece.y) continue;

        // Multi-tile bounds check: piece must fit entirely on the board
        if (toX + pw > boardWidth || toY + ph > boardHeight) continue;

        // For multi-tile pieces, find any enemy (or ally if can_capture_allies) in the destination footprint
        let occupyingPiece = null;
        let blockedByInvincible = false;
        if (pw > 1 || ph > 1) {
          for (let dy = 0; dy < ph && !occupyingPiece && !blockedByInvincible; dy++) {
            for (let dx = 0; dx < pw && !occupyingPiece && !blockedByInvincible; dx++) {
              const found = pieces.find(p =>
                p.id !== piece.id && doesPieceOccupySquare(p, toX + dx, toY + dy)
              );
              if (found) {
                const foundTeam = found.player_id || found.team;
                if (found.cannot_be_captured) {
                  blockedByInvincible = true;
                } else if (foundTeam !== pieceTeam || piece.can_capture_allies) {
                  occupyingPiece = found;
                }
              }
            }
          }
          if (blockedByInvincible) continue;
          // Check if any friendly piece (not ourselves) blocks the footprint
          if (!occupyingPiece) {
            const capturedId = null;
            if (!isDestinationClear(piece, toX, toY, pieces.filter(p => {
              const pTeam = p.player_id || p.team;
              return pTeam === pieceTeam && p.id !== piece.id;
            }), capturedId)) continue;
          } else {
            // Even with capture, check destination is clear of friendlies (excluding captured)
            if (!isDestinationClear(piece, toX, toY, pieces.filter(p => {
              const pTeam = p.player_id || p.team;
              return pTeam === pieceTeam && p.id !== piece.id && p.id !== occupyingPiece.id;
            }), null)) continue;
          }
        } else {
          occupyingPiece = findPieceAt(pieces, toX, toY);
          const occupyingTeam = occupyingPiece?.player_id || occupyingPiece?.team;
          // Skip if target piece cannot be captured
          if (occupyingPiece && occupyingPiece.id !== piece.id && occupyingPiece.cannot_be_captured) continue;
          // Skip if a friendly piece (not ourselves) occupies the target (unless can_capture_allies)
          if (occupyingPiece && occupyingPiece.id !== piece.id && occupyingTeam === pieceTeam && !piece.can_capture_allies) continue;
          // Skip moves to squares within the piece's own footprint
          if (occupyingPiece && occupyingPiece.id === piece.id) continue;
        }

        const isCapture = !!(occupyingPiece && occupyingPiece.id !== piece.id);
        const isMultiTile = pw > 1 || ph > 1;
        let isValidMove = false;
        
        // For multi-tile pieces, check movement/capture from all sub-squares
        if (isMultiTile) {
          for (let dy = 0; dy < ph && !isValidMove; dy++) {
            for (let dx = 0; dx < pw && !isValidMove; dx++) {
              if (isCapture) {
                isValidMove = canPieceCaptureTo(piece.x + dx, piece.y + dy, toX + dx, toY + dy, piece, pieceTeam);
              } else {
                isValidMove = canPieceMoveTo(piece.x + dx, piece.y + dy, toX + dx, toY + dy, piece, pieceTeam);
              }
            }
          }
        } else {
          if (isCapture) {
            isValidMove = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          } else {
            isValidMove = canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          }
        }

        // Check if this is a custom-square-only move (direct jump, no path check needed)
        let isCustomSquareMove = false;
        if (isValidMove) {
          const hasCustom = isCapture ? piece.custom_attack_squares : piece.custom_movement_squares;
          if (hasCustom) {
            const standardValid = isCapture
              ? canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam, false, true)
              : canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam, false, true);
            if (!standardValid) isCustomSquareMove = true;
          }
        }

        const isStepMove = isMultiTile
          ? (() => {
              for (let dy = 0; dy < ph; dy++) {
                for (let dx = 0; dx < pw; dx++) {
                  if (isStepByStepTarget(piece, piece.x + dx, piece.y + dy, toX + dx, toY + dy)) return true;
                }
              }
              return false;
            })()
          : isStepByStepTarget(piece, piece.x, piece.y, toX, toY);

        // Check if this is a ratio (L-shape) move
        const ratio1 = piece.ratio_movement_1 || piece.ratio_one_movement || 0;
        const ratio2 = piece.ratio_movement_2 || piece.ratio_two_movement || 0;
        const absRowDist = Math.abs(toY - piece.y);
        const absColDist = Math.abs(toX - piece.x);
        let isRatioMove = false;
        if (ratio1 > 0 && ratio2 > 0) {
          if ((absRowDist === ratio1 && absColDist === ratio2) ||
              (absRowDist === ratio2 && absColDist === ratio1)) {
            isRatioMove = true;
          } else if (piece.repeating_ratio) {
            const maxK = piece.max_ratio_iterations === -1 ? Math.max(absRowDist, absColDist) : (piece.max_ratio_iterations || 1);
            for (let k = 2; k <= maxK; k++) {
              if ((absRowDist === k * ratio1 && absColDist === k * ratio2) ||
                  (absRowDist === k * ratio2 && absColDist === k * ratio1)) {
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

        // Determine if this is an exact directional move (for hopping logic)
        const isExactDir = (() => {
          if (isRatioMove || isStepMove) return false;
          const rowDist = toY - piece.y;
          const colDist = toX - piece.x;
          const aR = Math.abs(rowDist);
          const aC = Math.abs(colDist);
          // Determine effective direction (flip for player 2)
          const isP2 = pieceTeam === 2;
          const eR = isP2 ? -rowDist : rowDist;
          const eC = isP2 ? -colDist : colDist;
          if (aC === 0 && aR > 0) {
            return !!(eR < 0 ? piece.up_movement_exact : piece.down_movement_exact);
          }
          if (aR === 0 && aC > 0) {
            return !!(eC < 0 ? piece.left_movement_exact : piece.right_movement_exact);
          }
          if (aR === aC && aR > 0) {
            if (eR < 0 && eC < 0) return !!piece.up_left_movement_exact;
            if (eR < 0 && eC > 0) return !!piece.up_right_movement_exact;
            if (eR > 0 && eC < 0) return !!piece.down_left_movement_exact;
            if (eR > 0 && eC > 0) return !!piece.down_right_movement_exact;
          }
          return false;
        })();

        let pathClear = false;
        if (isCustomSquareMove) {
          // Custom square moves are direct jumps — no path obstruction
          pathClear = true;
        } else if (isStepMove) {
          pathClear = canReachStepByStep(piece, toX, toY, pieces, boardWidth, boardHeight, isCapture);
        } else if (isMultiTile) {
          // For multi-tile, check path from ALL sub-squares to their destination sub-squares
          pathClear = true;
          for (let dy = 0; dy < ph && pathClear; dy++) {
            for (let dx = 0; dx < pw && pathClear; dx++) {
              if (!isPathClear(piece.x + dx, piece.y + dy, toX + dx, toY + dy, pieces, piece, isCapture, isExactDir)) {
                pathClear = false;
              }
            }
          }
        } else {
          pathClear = isPathClear(piece.x, piece.y, toX, toY, pieces, piece, isCapture, isExactDir);
        }

        // For repeating ratio moves, check intermediate landing positions are clear
        if (pathClear && isRatioMove) {
          const rr1 = isCapture ? (rc1 || ratio1) : ratio1;
          const rr2 = isCapture ? (rc2 || ratio2) : ratio2;
          if (rr1 > 0 && rr2 > 0) {
            // Determine which ratio orientation matches: (r1,r2) or (r2,r1)
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
                const blocking = findPieceAt(pieces, cx, cy);
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
          // If not, check if the capture range covers it (since destination is empty, normal capture
          // wouldn't apply, but hop capture uses the same directional ranges).
          let hopDirValid = isValidMove;
          if (!hopDirValid) {
            // Check if the piece's capture range covers this destination distance
            hopDirValid = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          }
          if (hopDirValid) {
            // Walk the path: enemies are capture targets (always hoppable for capture_on_hop),
            // allies block unless the piece has ally-hop ability.
            const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
            const hopCapturedSet = new Set();
            let hopBlocked = false;
            const subSquareCount = isMultiTile ? pw * ph : 1;
            for (let si = 0; si < subSquareCount && !hopBlocked; si++) {
              const sdx = si % pw;
              const sdy = Math.floor(si / pw);
              const fx = piece.x + sdx;
              const fy = piece.y + sdy;
              const tx = toX + sdx;
              const ty = toY + sdy;
              const dx = Math.sign(tx - fx);
              const dy = Math.sign(ty - fy);
              const xDiff = Math.abs(tx - fx);
              const yDiff = Math.abs(ty - fy);
              if (xDiff === yDiff || xDiff === 0 || yDiff === 0) {
                let cx = fx + dx;
                let cy = fy + dy;
                while ((cx !== tx || cy !== ty) && !hopBlocked) {
                  const hopPiece = findPieceAt(pieces, cx, cy);
                  if (hopPiece && hopPiece.id !== piece.id) {
                    const hopTeam = hopPiece.player_id || hopPiece.team;
                    if (hopTeam !== pieceTeam) {
                      hopCapturedSet.add(hopPiece.id);
                    } else if (!canHopAllies) {
                      hopBlocked = true;
                    }
                  }
                  cx += dx;
                  cy += dy;
                }
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
        if (piece.exact_ratio_hop_only && isValidMove && pathClear && !isHopCapture && !isStepMove && !isRatioMove) {
          const stillValid = isCapture
            ? canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true)
            : canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true);
          if (!stillValid) {
            // Move relies on exact/ratio — only allow if something was hopped in the path
            let hasHop = false;
            const hdx = Math.sign(toX - piece.x);
            const hdy = Math.sign(toY - piece.y);
            const hxDiff = Math.abs(toX - piece.x);
            const hyDiff = Math.abs(toY - piece.y);
            if (hxDiff === hyDiff || hxDiff === 0 || hyDiff === 0) {
              let hx = piece.x + hdx;
              let hy = piece.y + hdy;
              while (hx !== toX || hy !== toY) {
                const hp = findPieceAt(pieces, hx, hy);
                if (hp && hp.id !== piece.id) { hasHop = true; break; }
                hx += hdx;
                hy += hdy;
              }
            }
            if (!hasHop) isValidMove = false;
          }
        }
        // For ratio moves with hop-only: always require a hop
        if (piece.exact_ratio_hop_only && isValidMove && pathClear && !isHopCapture && isRatioMove) {
          isValidMove = false;
        }

        if (isValidMove && pathClear) {
          const isFirstMoveOnly = (isCapture || isHopCapture)
            ? checkIfFirstMoveOnlyCapture(piece, piece.x, piece.y, toX, toY, pieceTeam)
            : checkIfFirstMoveOnlyMove(piece, piece.x, piece.y, toX, toY, pieceTeam);
          
          // Use already-computed custom square detection
          const isCustomMove = !isCapture && !isHopCapture && isCustomSquareMove;
          const isCustomAttack = (isCapture || isHopCapture) && isCustomSquareMove;
          
          moves.push({ x: toX, y: toY, isCapture: isCapture || isHopCapture, isHopCapture, hopCapturedPieceIds, isFirstMoveOnly, isCustomMove, isCustomAttack, isRangedAttack: false });
        }
      }
    }

    // --- Direction Change moves ---
    // Walks first leg in one direction, then turns at the via square and walks
    // a second leg in a different (non-parallel) direction. Mirrors the server
    // implementation in game-socket.js.
    const dcDirDefs = {
      up:         { dx:  0, dy: -1 },
      down:       { dx:  0, dy:  1 },
      left:       { dx: -1, dy:  0 },
      right:      { dx:  1, dy:  0 },
      up_left:    { dx: -1, dy: -1 },
      up_right:   { dx:  1, dy: -1 },
      down_left:  { dx: -1, dy:  1 },
      down_right: { dx:  1, dy:  1 },
    };
    const isP2 = pieceTeam === 2;
    const dcFlip = (vec) => ({ dx: vec.dx, dy: isP2 ? -vec.dy : vec.dy });
    const isSameOrOppositeDir = (ax, ay, bx, by) => (ax === bx && ay === by) || (ax === -bx && ay === -by);

    const generateDCMoves = (type) => {
      // type: 'movement' or 'capture'
      const masterKey = type === 'capture' ? 'directional_capture_change' : 'directional_movement_change';
      const useMovColsForCapture = type === 'capture' && piece.attacks_like_movement && !piece[masterKey];
      const effectiveMaster = useMovColsForCapture ? 'directional_movement_change' : masterKey;
      if (!piece[effectiveMaster]) return;

      const firstLegSuffix = type === 'capture' ? '_capture' : '_movement';
      const secondLegSuffix = useMovColsForCapture ? '_movement_change' : `_${type}_change`;

      for (const [dir1Name, baseVec1] of Object.entries(dcDirDefs)) {
        const firstLegDist = parseInt(piece[`${dir1Name}${firstLegSuffix}`], 10) || 0;
        if (!firstLegDist) continue;
        const { dx: fdx, dy: fdy } = dcFlip(baseVec1);
        const firstExact = !!piece[`${dir1Name}${firstLegSuffix}_exact`];
        const maxFirst = firstLegDist === 99 ? Math.max(boardWidth, boardHeight) : firstLegDist;

        for (let step1 = 1; step1 <= maxFirst; step1++) {
          if (firstExact && step1 !== firstLegDist) continue;
          const viaX = piece.x + fdx * step1;
          const viaY = piece.y + fdy * step1;
          if (viaX < 0 || viaY < 0 || viaX >= boardWidth || viaY >= boardHeight) break;
          // Path to via must be empty
          let blocked = false;
          for (let k = 1; k < step1; k++) {
            const cx = piece.x + fdx * k;
            const cy = piece.y + fdy * k;
            const bp = findPieceAt(pieces, cx, cy);
            if (bp && bp.id !== piece.id) { blocked = true; break; }
          }
          if (blocked) break;
          // Via must be empty
          const viaPiece = findPieceAt(pieces, viaX, viaY);
          if (viaPiece && viaPiece.id !== piece.id) break;

          for (const [dir2Name, baseVec2] of Object.entries(dcDirDefs)) {
            const secondLegDist = parseInt(piece[`${dir2Name}${secondLegSuffix}`], 10) || 0;
            if (!secondLegDist) continue;
            const { dx: sdx, dy: sdy } = dcFlip(baseVec2);
            if (isSameOrOppositeDir(fdx, fdy, sdx, sdy)) continue;
            const secondExact = !!piece[`${dir2Name}${secondLegSuffix}_exact`];
            const maxSecond = secondLegDist === 99 ? Math.max(boardWidth, boardHeight) : secondLegDist;

            for (let step2 = 1; step2 <= maxSecond; step2++) {
              if (secondExact && step2 !== secondLegDist) continue;
              const toX = viaX + sdx * step2;
              const toY = viaY + sdy * step2;
              if (toX < 0 || toY < 0 || toX >= boardWidth || toY >= boardHeight) break;
              // Path via->landing must be clear (except the landing)
              let sBlocked = false;
              for (let k = 1; k < step2; k++) {
                const cx = viaX + sdx * k;
                const cy = viaY + sdy * k;
                const bp = findPieceAt(pieces, cx, cy);
                if (bp && bp.id !== piece.id) { sBlocked = true; break; }
              }
              if (sBlocked) break;

              const target = findPieceAt(pieces, toX, toY);
              if (target && target.id === piece.id) continue;
              if (target) {
                const targetTeam = target.player_id || target.team;
                if (target.cannot_be_captured) break;
                const canCap = (type === 'capture' || piece.can_capture_enemy_on_move);
                if (canCap && (targetTeam !== pieceTeam || piece.can_capture_allies)) {
                  // Avoid duplicating a move at same (toX,toY)
                  if (!moves.some(m => m.x === toX && m.y === toY && !m.isRangedAttack)) {
                    moves.push({ x: toX, y: toY, isCapture: true, isHopCapture: false, hopCapturedPieceIds: [], isFirstMoveOnly: false, isCustomMove: false, isCustomAttack: false, isRangedAttack: false, isDirectionChange: true, via: { x: viaX, y: viaY } });
                  }
                }
                break;
              } else if (type !== 'capture') {
                if (!moves.some(m => m.x === toX && m.y === toY && !m.isRangedAttack)) {
                  moves.push({ x: toX, y: toY, isCapture: false, isHopCapture: false, hopCapturedPieceIds: [], isFirstMoveOnly: false, isCustomMove: false, isCustomAttack: false, isRangedAttack: false, isDirectionChange: true, via: { x: viaX, y: viaY } });
                }
              }
            }
          }
          if (firstExact) break;
        }
      }
    };

    if (piece.directional_movement_change) generateDCMoves('movement');
    if (piece.directional_capture_change || (piece.attacks_like_movement && piece.directional_movement_change)) {
      generateDCMoves('capture');
    }

    // require_direction_change: piece MUST use a direction-change move
    if (piece.require_direction_change) {
      for (let i = moves.length - 1; i >= 0; i--) {
        if (!moves[i].isDirectionChange) moves.splice(i, 1);
      }
    }

    // Separate loop: check ranged attack targets (matches LiveGame pattern)
    if (piece.can_capture_enemy_via_range) {
      for (let toY = 0; toY < boardHeight; toY++) {
        for (let toX = 0; toX < boardWidth; toX++) {
          if (toX === piece.x && toY === piece.y) continue;
          const targetPiece = findPieceAt(pieces, toX, toY);
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          // Skip friendly pieces - show all other squares within range
          if (targetPiece && targetTeam === pieceTeam) continue;
          // Skip pieces that cannot be captured
          if (targetPiece && targetPiece.cannot_be_captured) continue;
          // Already in moves as a regular capture? Skip to avoid duplicates
          if (moves.some(m => m.x === toX && m.y === toY)) continue;
          // For multi-tile, check ranged from any sub-square
          let canRanged = false;
          for (let dr = 0; dr < ph && !canRanged; dr++) {
            for (let dc = 0; dc < pw && !canRanged; dc++) {
              canRanged = canRangedAttackTo(piece.y + dr, piece.x + dc, toY, toX, piece, pieceTeam);
            }
          }
          if (canRanged) {
            // Check if ranged path is clear (blocked by pieces unless can fire over)
            if (!isRangedPathClear(piece.x, piece.y, toX, toY, piece, pieces, pieceTeam)) {
              continue;
            }
            moves.push({
              x: toX,
              y: toY,
              isCapture: !!targetPiece,
              isFirstMoveOnly: false,
              isRangedAttack: true
            });
          }
        }
      }
    }

    // Apply first-move-only restriction: pieces that have already moved cannot use
    // first-move-only moves/captures. Mirrors the live-game behaviour.
    // blockFirstMove also suppresses first-move-only moves based on custom-square rules.
    const hasMoved = (piece.move_count || 0) > 0;
    let filtered = (hasMoved || blockFirstMove) ? moves.filter(m => !m.isFirstMoveOnly) : moves;

    // Apply restriction zone: pieces with cannot_move_outside_zone may only move to zone squares
    if (zoneSquareKeys) {
      filtered = filtered.filter(m => zoneSquareKeys.has(`${m.y},${m.x}`));
    }

    return filtered;
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear, isStepByStepTarget, canReachStepByStep, findPieceAt, checkIfFirstMoveOnlyMove, checkIfFirstMoveOnlyCapture, applyRangeSquareBonusSandbox]);

  // forced_capture_condition: if any piece of the current player has a capture
  // available, that player MUST capture. Filters a piece's valid moves to
  // captures only when the piece has captures, or returns [] when other pieces
  // are obligated to capture instead.
  const applyForcedCaptureFilter = useCallback((piece, moves) => {
    if (!activeSandbox || !activeSandbox.rules?.forced_capture_condition) return moves;
    const myTeam = piece.player_id || piece.team;
    if (myTeam !== activeSandbox.currentTurn) return moves;
    const myCaptures = moves.filter(m => m.isCapture);
    if (myCaptures.length > 0) return myCaptures;
    const bw = activeSandbox.gameType?.board_width || 8;
    const bh = activeSandbox.gameType?.board_height || 8;
    const others = activeSandbox.pieces.filter(p => (p.player_id || p.team) === myTeam && p.id !== piece.id);
    for (const p of others) {
      try {
        const m = calculateValidMoves(p, activeSandbox.pieces, bw, bh);
        if (m.some(mm => mm.isCapture)) return [];
      } catch (_) { /* ignore */ }
    }
    return moves;
  }, [activeSandbox, calculateValidMoves]);

  // =============================================
  // commitMove — single source of truth for applying a move to a sandbox.
  // Handles capture HP/AD, multi-action turns, position history, end-game
  // detection, and promotion-pending detection.
  // Returns the new sandbox object (does NOT call setSandboxes).
  // =============================================
  const commitMove = useCallback((sandbox, opts) => {
    const {
      movingPieceId,
      anchorX,
      anchorY,
      captureIds,        // Set<string> of piece ids hit by this move (includes hop captures + main target)
      isRangedAttack = false,
      moveHistoryEntry,  // object pushed into moveHistory
      isPlacement = false,
      newPieceForPlacement = null,
    } = opts;

    const beforePieces = sandbox.pieces;
    const attacker = beforePieces.find(p => p.id === movingPieceId);

    // 1. Apply captures with HP/AD
    const captureSet = captureIds instanceof Set ? captureIds : new Set(captureIds || []);
    let { pieces: afterCapture, justCaptured } = applyCapturesWithHp(beforePieces, captureSet, attacker);

    // die_on_capture: attacker removes itself if it captured anyone
    let attackerDies = false;
    if (attacker && attacker.die_on_capture && justCaptured.length > 0) {
      attackerDies = true;
    }

    // 2. Move / place the piece
    let afterMove;
    if (isPlacement && newPieceForPlacement) {
      afterMove = [...afterCapture, newPieceForPlacement];
    } else if (isRangedAttack) {
      afterMove = afterCapture.map(p =>
        p.id === movingPieceId ? { ...p, move_count: (p.move_count || 0) + 1 } : p
      );
    } else {
      afterMove = afterCapture.map(p =>
        p.id === movingPieceId ? { ...p, x: anchorX, y: anchorY, move_count: (p.move_count || 0) + 1 } : p
      );
    }
    if (attackerDies) {
      afterMove = afterMove.filter(p => p.id !== movingPieceId);
      // Treat the attacker as a justCaptured for end-game purposes
      if (attacker) justCaptured = [...justCaptured, attacker];
    }

    // 3. Turn / action accounting
    const rules = sandbox.rules || DEFAULT_SANDBOX_RULES;
    const actionsPerTurn = Math.max(1, Number(rules.actions_per_turn) || 1);
    const actionsThisTurn = (sandbox.actionsThisTurn || 0) + 1;
    let nextTurn = sandbox.currentTurn;
    let nextActions = actionsThisTurn;
    if (actionsThisTurn >= actionsPerTurn) {
      nextTurn = sandbox.currentTurn === 1 ? 2 : 1;
      nextActions = 0;
    }

    // 4. Move count & position history
    const newMoveCount = (sandbox.moveCount || 0) + 1;
    const newPositionHistory = [...(sandbox.positionHistory || []), hashSandboxPosition(afterMove, nextTurn)];

    const intermediate = {
      ...sandbox,
      pieces: afterMove,
      currentTurn: nextTurn,
      actionsThisTurn: nextActions,
      moveCount: newMoveCount,
      positionHistory: newPositionHistory,
      moveHistory: [...sandbox.moveHistory, moveHistoryEntry],
    };

    // 5. End-game evaluation
    const verdict = evaluateSandboxEndGame(intermediate, justCaptured, calculateValidMoves);
    if (verdict) {
      intermediate.gameOver = verdict;
    }

    // 6. Promotion detection (returned in a side channel via the result so the
    //    caller can show the modal). We don't actually mutate the piece here —
    //    promotion is applied after the user chooses a target piece.
    let promotionInfo = null;
    if (!attackerDies && !isPlacement && !isRangedAttack) {
      const moved = afterMove.find(p => p.id === movingPieceId);
      if (moved && moved.can_promote && !moved.disable_promotion) {
        // Check promotion squares
        const promoSquares = (() => {
          try {
            const raw = sandbox.gameType?.promotion_squares_string;
            if (!raw) return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch (_) { return null; }
        })();
        let isPromoSquare = false;
        if (promoSquares) {
          // promoSquares may be array of {x,y,player} or object keyed by "y,x"
          if (Array.isArray(promoSquares)) {
            isPromoSquare = promoSquares.some(s =>
              ((s.x === anchorX && s.y === anchorY) || (s.col === anchorX && s.row === anchorY)) &&
              (!s.player || s.player === moved.player_id || s.player === moved.team)
            );
          } else if (typeof promoSquares === 'object') {
            isPromoSquare = !!promoSquares[`${anchorY},${anchorX}`] || !!promoSquares[`${anchorX},${anchorY}`];
          }
        }
        // Also check custom squares with promotion flag
        if (!isPromoSquare && sandbox.specialSquares) {
          const key = `${anchorX},${anchorY}`;
          const sq = sandbox.specialSquares[key];
          // sq may be a plain string ('promotion') or legacy object ({ type: 'promotion' })
          if (sq && (sq === 'promotion' || sq.type === 'promotion' || (sq.type === 'custom' && sq.config?.asPromotion))) {
            isPromoSquare = true;
          }
        }
        // Also check gameSpecialSquares.special for asPromotion (from loaded game type)
        if (!isPromoSquare) {
          const spe = sandbox.gameSpecialSquares?.special || {};
          const specialKey = `${anchorY},${anchorX}`; // LiveGame row,col format
          if (spe[specialKey]?.asPromotion) isPromoSquare = true;
        }
        if (isPromoSquare) {
          promotionInfo = { pieceId: movingPieceId, x: anchorX, y: anchorY, player: moved.player_id || moved.team };
          // If promotion_condition rule is active, reaching a promotion square wins immediately
          if (rules.promotion_condition) {
            intermediate.gameOver = { gameOver: true, winner: moved.player_id || moved.team, reason: 'promotion_win' };
          }
        }
      }
    }
    intermediate._promotionInfo = promotionInfo;

    return intermediate;
  }, [calculateValidMoves]);

  // Handle square click - free repositioning (click piece, click destination)
  const handleSquareClick = useCallback((x, y) => {
    if (!activeSandbox) return;

    const pieces = activeSandbox.pieces;
    const clickedPiece = findPieceAt(pieces, x, y);

    // Placement mode: if a placement piece is selected and the square is empty,
    // place it as a "place" action.
    if (!clickedPiece && activeSandbox.placementSelected && activeSandbox.rules?.place_pieces_action) {
      const placeData = activeSandbox.placementSelected;
      const fullPiece = fullPiecesList.find(p => p.piece_id === placeData.piece_id || p.id === placeData.piece_id) || placeData;
      const playerId = activeSandbox.currentTurn;
      const newPiece = {
        ...fullPiece,
        ratio_movement_1: fullPiece.ratio_movement_1 || fullPiece.ratio_one_movement,
        ratio_movement_2: fullPiece.ratio_movement_2 || fullPiece.ratio_two_movement,
        ratio_capture_1: fullPiece.ratio_capture_1 || fullPiece.ratio_one_capture,
        ratio_capture_2: fullPiece.ratio_capture_2 || fullPiece.ratio_two_capture,
        step_movement_style: fullPiece.step_by_step_movement_style ?? fullPiece.step_movement_style,
        step_movement_value: fullPiece.step_by_step_movement_value ?? fullPiece.step_movement_value,
        id: `piece-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        piece_id: fullPiece.piece_id || fullPiece.id,
        x, y,
        team: playerId,
        player_id: playerId,
        move_count: 0,
        hit_points: fullPiece.hit_points ?? 1,
        current_hp: fullPiece.hit_points ?? 1,
        attack_damage: fullPiece.attack_damage ?? 1,
        show_hp_ad: false,
      };
      const sbSnap = sandboxes.find(s => s.id === activeSandboxId);
      if (sbSnap) {
        const result = commitMove(sbSnap, {
          movingPieceId: newPiece.id,
          anchorX: x, anchorY: y,
          captureIds: new Set(),
          isPlacement: true,
          newPieceForPlacement: newPiece,
          moveHistoryEntry: { type: 'place', to: { x, y }, piece: newPiece.piece_name },
        });
        delete result._promotionInfo;
        const next = { ...result, placementSelected: null };
        setSandboxes(prev => prev.map(s => s.id === activeSandboxId ? next : s));
      }
      return;
    }

    if (selectedPiece) {
      // If clicking the anchor square of the same piece, deselect
      if (clickedPiece && clickedPiece.id === selectedPiece.id &&
          x === selectedPiece.x && y === selectedPiece.y) {
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      // If clicking another piece of the same team (not an extension of selected piece), select it instead
      // Unless the selected piece can capture allies and the clicked ally is a valid capture target
      const selectedTeam = selectedPiece.team || selectedPiece.player_id;
      if (clickedPiece && clickedPiece.id !== selectedPiece.id &&
          (clickedPiece.team === selectedTeam || clickedPiece.player_id === selectedTeam)) {
        if (!selectedPiece.can_capture_allies || !validMoves.some(m => m.isCapture && m.x === x && m.y === y)) {
          setSelectedPiece(clickedPiece);
          setValidMoves([]);
          return;
        }
      }

      // Check if the click target is a valid game move (including hop captures)
      const spw = selectedPiece.piece_width || 1;
      const sph = selectedPiece.piece_height || 1;
      const boardWidth = activeSandbox.gameType.board_width || 8;
      const boardHeight = activeSandbox.gameType.board_height || 8;
      let move = validMoves.find(m => m.x === x && m.y === y);
      // Multi-tile: when exact anchor match fails, find the valid move whose footprint covers the clicked square
      if (!move && (spw > 1 || sph > 1)) {
        const candidates = validMoves.filter(m => !m.isRangedAttack &&
          x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph);
        if (candidates.length === 1) {
          move = candidates[0];
        } else if (candidates.length > 1) {
          move = candidates.reduce((best, m) => {
            const d = Math.abs(m.x - selectedPiece.x) + Math.abs(m.y - selectedPiece.y);
            const bd = Math.abs(best.x - selectedPiece.x) + Math.abs(best.y - selectedPiece.y);
            return d < bd ? m : best;
          });
        }
      }
      if (move) {
        // Execute game move with hop capture support
        // Use the move's anchor position, which may differ from click position for multi-tile pieces
        const targetX = move.x;
        const targetY = move.y;
        let piecesToRemove = new Set();
        if (move.isHopCapture && move.hopCapturedPieceIds) {
          move.hopCapturedPieceIds.forEach(id => piecesToRemove.add(id));
        }
        if (move.isCapture && !move.isRangedAttack && !move.isHopCapture) {
          const pieceTeam = selectedPiece.player_id || selectedPiece.team;
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              const found = findPieceAt(pieces, targetX + dx, targetY + dy);
              if (found && found.id !== selectedPiece.id) {
                const foundTeam = found.player_id || found.team;
                if (foundTeam !== pieceTeam || selectedPiece.can_capture_allies) {
                  piecesToRemove.add(found.id);
                }
              }
            }
          }
        }
        if (move.isRangedAttack && move.isCapture) {
          const target = findPieceAt(pieces, targetX, targetY);
          if (target) piecesToRemove.add(target.id);
        }

        const sbSnap2 = sandboxes.find(s => s.id === activeSandboxId);
        if (sbSnap2) {
          const result = commitMove(sbSnap2, {
            movingPieceId: selectedPiece.id,
            anchorX: targetX,
            anchorY: targetY,
            captureIds: piecesToRemove,
            isRangedAttack: !!move.isRangedAttack,
            moveHistoryEntry: {
              from: { x: selectedPiece.x, y: selectedPiece.y },
              to: { x: targetX, y: targetY },
              piece: selectedPiece.piece_name,
              piece_width: spw,
              piece_height: sph
            }
          });
          const pendingPromo = result._promotionInfo ? { ...result._promotionInfo, sandboxId: activeSandboxId } : null;
          delete result._promotionInfo;
          setSandboxes(prev => prev.map(s => s.id === activeSandboxId ? result : s));
          if (pendingPromo) setPromotionPending(pendingPromo);
        }

        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      // Free reposition: move piece to target (fallback when no valid game move)
      // Snap to board edge if piece would extend off-board
      if (x + spw > boardWidth) x = boardWidth - spw;
      if (y + sph > boardHeight) y = boardHeight - sph;
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      // Block reposition if any other piece occupies the destination footprint
      let blocked = false;
      for (let dy = 0; dy < sph; dy++) {
        for (let dx = 0; dx < spw; dx++) {
          const found = findPieceAt(pieces, x + dx, y + dy);
          if (found && found.id !== selectedPiece.id) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }
      if (blocked) {
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      const movedPieces = pieces.map(p =>
        p.id === selectedPiece.id ? { ...p, x, y } : p
      );

      setSandboxes(prev => prev.map(s =>
        s.id === activeSandboxId
          ? {
              ...s,
              pieces: movedPieces,
              moveHistory: [...s.moveHistory, {
                from: { x: selectedPiece.x, y: selectedPiece.y },
                to: { x, y },
                piece: selectedPiece.piece_name,
                piece_width: selectedPiece.piece_width || 1,
                piece_height: selectedPiece.piece_height || 1,
                repositioned: true
              }]
            }
          : s
      ));

      setSelectedPiece(null);
      setValidMoves([]);
    } else {
      // No piece selected - select any piece for repositioning
      if (clickedPiece) {
        setSelectedPiece(clickedPiece);
        const boardWidth = activeSandbox.gameType.board_width || 8;
        const boardHeight = activeSandbox.gameType.board_height || 8;
        const moves = calculateValidMoves(clickedPiece, pieces, boardWidth, boardHeight);
        setValidMoves(applyForcedCaptureFilter(clickedPiece, moves));
      }
    }
  }, [activeSandbox, activeSandboxId, selectedPiece, validMoves, findPieceAt, calculateValidMoves, commitMove, fullPiecesList, sandboxes, applyForcedCaptureFilter]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Handle Delete key to remove selected piece
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedPiece && activeSandbox) {
          e.preventDefault();
          removePieceFromBoard(selectedPiece.id);
          setSelectedPiece(null);
          setValidMoves([]);
        }
      } else if (e.key === 'Escape') {
        setSelectedPiece(null);
        setValidMoves([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPiece, activeSandbox, removePieceFromBoard]);

  // Handle long press for mobile - only for adding pieces
  const handleLongPress = useCallback((x, y) => {
    if (!activeSandbox) return;

    const piece = findPieceAt(activeSandbox.pieces, x, y);
    if (!piece) {
      // Long press on empty square opens add-piece modal
      setRightClickPosition({ row: y, col: x });
      setRightClickMode('piece');
      setShowRightClickModal(true);
    }
    // If there's a piece, do nothing - use the Delete button instead
  }, [activeSandbox, findPieceAt]);

  // Handle touch start for long press detection
  const handleTouchStart = useCallback((e, x, y) => {
    if (!isTouchDevice()) return;
    
    longPressTimeoutRef.current = setTimeout(() => {
      handleLongPress(x, y);
    }, 500);
  }, [handleLongPress]);

  // Handle touch end/move to cancel long press
  const handleTouchEnd = useCallback(() => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  // Touch drag handlers for mobile piece dragging
  const handlePieceTouchStart = useCallback((e, piece) => {
    if (!activeSandbox) return;
    // Cancel any long press from square
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    const touch = e.touches[0];
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    let grabOffsetX = 0, grabOffsetY = 0;
    if ((pw > 1 || ph > 1) && e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      const cellWidth = rect.width / pw;
      const cellHeight = rect.height / ph;
      grabOffsetX = Math.floor((touch.clientX - rect.left) / cellWidth);
      grabOffsetY = Math.floor((touch.clientY - rect.top) / cellHeight);
    }
    const moves = calculateValidMoves(piece, activeSandbox.pieces, activeSandbox.gameType.board_width, activeSandbox.gameType.board_height);
    const filteredMoves = applyForcedCaptureFilter(piece, moves);
    touchDragRef.current = { piece, startX: touch.clientX, startY: touch.clientY, isDragging: false, grabOffsetX, grabOffsetY, moves: filteredMoves };
    setSelectedPiece(piece);
    setValidMoves(filteredMoves);
  }, [activeSandbox, calculateValidMoves, applyForcedCaptureFilter]);

  const handlePieceTouchMove = useCallback((e) => {
    const td = touchDragRef.current;
    if (!td.piece) return;
    // Cancel long press on any movement
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    const touch = e.touches[0];
    const dx = touch.clientX - td.startX;
    const dy = touch.clientY - td.startY;
    if (!td.isDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      td.isDragging = true;
      setTouchDragPiece(td.piece);
      setIsDragging(true);
    }
    if (td.isDragging) {
      e.preventDefault();
      setTouchDragPos({ x: touch.clientX, y: touch.clientY });
    }
  }, []);

  const handlePieceTouchEnd = useCallback((e) => {
    const td = touchDragRef.current;
    if (td.isDragging && boardRef.current && activeSandbox) {
      const touch = e.changedTouches[0];
      const rect = boardRef.current.getBoundingClientRect();
      const boardWidth = activeSandbox.gameType.board_width || 8;
      const boardHeight = activeSandbox.gameType.board_height || 8;
      const cellW = rect.width / boardWidth;
      const cellH = rect.height / boardHeight;
      const dropX = Math.floor((touch.clientX - rect.left) / cellW);
      const dropY = Math.floor((touch.clientY - rect.top) / cellH);

      if (dropX >= 0 && dropX < boardWidth && dropY >= 0 && dropY < boardHeight) {
        const piece = td.piece;
        const pw = piece.piece_width || 1;
        const ph = piece.piece_height || 1;
        let anchorX = dropX - (td.grabOffsetX || 0);
        let anchorY = dropY - (td.grabOffsetY || 0);

        if (!(piece.x === anchorX && piece.y === anchorY)) {
          const moves = td.moves || [];
          let move = moves.find(m => m.x === anchorX && m.y === anchorY);
          if (!move && (pw > 1 || ph > 1)) {
            const candidates = moves.filter(m => !m.isRangedAttack && dropX >= m.x && dropX < m.x + pw && dropY >= m.y && dropY < m.y + ph);
            if (candidates.length === 1) move = candidates[0];
            else if (candidates.length > 1) {
              move = candidates.reduce((best, m) => {
                const d = Math.abs(m.x - anchorX) + Math.abs(m.y - anchorY);
                const bd = Math.abs(best.x - anchorX) + Math.abs(best.y - anchorY);
                return d < bd ? m : best;
              });
            }
            if (move) { anchorX = move.x; anchorY = move.y; }
          }
          if (move) {
            const pieces = activeSandbox.pieces;
            let targetPiece = null;
            if (move.isCapture && !move.isRangedAttack) {
              const pieceTeam = piece.player_id || piece.team;
              for (let dy = 0; dy < ph && !targetPiece; dy++) {
                for (let dx = 0; dx < pw && !targetPiece; dx++) {
                  const found = findPieceAt(pieces, anchorX + dx, anchorY + dy);
                  if (found && found.id !== piece.id) {
                    const foundTeam = found.player_id || found.team;
                    if (foundTeam !== pieceTeam || piece.can_capture_allies) targetPiece = found;
                  }
                }
              }
            }
            let piecesToRemove = new Set();
            if (move.isHopCapture && move.hopCapturedPieceIds) move.hopCapturedPieceIds.forEach(id => piecesToRemove.add(id));
            if (targetPiece) piecesToRemove.add(targetPiece.id);
            const sbSnap3 = sandboxes.find(s => s.id === activeSandboxId);
            if (sbSnap3) {
              const result = commitMove(sbSnap3, {
                movingPieceId: piece.id,
                anchorX, anchorY,
                captureIds: piecesToRemove,
                isRangedAttack: false,
                moveHistoryEntry: { from: { x: piece.x, y: piece.y }, to: { x: anchorX, y: anchorY }, piece: piece.piece_name, piece_width: pw, piece_height: ph }
              });
              const pendingPromo = result._promotionInfo ? { ...result._promotionInfo, sandboxId: activeSandboxId } : null;
              delete result._promotionInfo;
              setSandboxes(prev => prev.map(s => s.id === activeSandboxId ? result : s));
              if (pendingPromo) setPromotionPending(pendingPromo);
            }
          }
        }
      }
    }
    touchDragRef.current = { piece: null, startX: 0, startY: 0, isDragging: false, grabOffsetX: 0, grabOffsetY: 0, moves: [] };
    setTouchDragPiece(null);
    setTouchDragPos(null);
    setIsDragging(false);
    setSelectedPiece(null);
    setValidMoves([]);
  }, [activeSandbox, activeSandboxId, findPieceAt, commitMove, sandboxes]);

  // Handle right-click mousedown on square (for ranged click-vs-drag detection)
  const handleSquareMouseDown = useCallback((e, x, y) => {
    if (e.button !== 2) return; // Only right-click
    if (!activeSandbox) return;

    const piece = findPieceAt(activeSandbox.pieces, x, y);
    rightClickDataRef.current = {
      piece, x, y, time: Date.now(),
      clientX: e.clientX, clientY: e.clientY,
      isDrag: false
    };

    if (piece && piece.can_capture_enemy_via_range) {
      // For ranged pieces, activate global listeners to detect drag vs click
      setIsRightClickActive(true);
    }
  }, [activeSandbox, findPieceAt]);

  // Handle contextmenu on square - only for adding pieces to empty squares
  const handleSquareContextMenu = useCallback((e, x, y) => {
    e.preventDefault();
    if (!activeSandbox) return;

    const data = rightClickDataRef.current;
    // If a ranged right-click is pending (global listeners active), don't do normal action
    if (data && data.piece?.can_capture_enemy_via_range) return;

    // Only open add-piece modal on empty squares (don't delete on right-click)
    const piece = findPieceAt(activeSandbox.pieces, x, y);
    if (!piece) {
      setRightClickPosition({ row: y, col: x });
      setRightClickMode('piece');
      setShowRightClickModal(true);
    }
    // If there's a piece, do nothing - use select + Delete key instead
    rightClickDataRef.current = null;
  }, [activeSandbox, findPieceAt]);

  // Global listeners for ranged right-click drag detection
  useEffect(() => {
    if (!isRightClickActive) return;

    const DRAG_DISTANCE_THRESHOLD = 5;
    const DRAG_TIME_THRESHOLD = 200; // ms

    const getTargetSquare = (clientX, clientY) => {
      if (!boardRef.current) return null;
      const boardRect = boardRef.current.getBoundingClientRect();
      const bw = activeSandbox?.gameType?.board_width || 8;
      const bh = activeSandbox?.gameType?.board_height || 8;
      const squareW = boardRect.width / bw;
      const squareH = boardRect.height / bh;
      const relX = clientX - boardRect.left;
      const relY = clientY - boardRect.top;
      if (relX >= 0 && relX < boardRect.width && relY >= 0 && relY < boardRect.height) {
        return { x: Math.floor(relX / squareW), y: Math.floor(relY / squareH) };
      }
      return null;
    };

    const handleMouseMove = (e) => {
      const data = rightClickDataRef.current;
      if (!data || !data.piece?.can_capture_enemy_via_range) return;

      const dx = e.clientX - data.clientX;
      const dy = e.clientY - data.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - data.time;

      // Transition to drag mode if mouse moved enough or held long enough
      if (!data.isDrag && (dist > DRAG_DISTANCE_THRESHOLD || elapsed > DRAG_TIME_THRESHOLD)) {
        data.isDrag = true;
        setRangedAttackSource(data.piece);
      }

      if (data.isDrag) {
        setRangedMousePos({ x: e.clientX, y: e.clientY });
        setRangedTargetSquare(getTargetSquare(e.clientX, e.clientY));
      }
    };

    const handleMouseUp = (e) => {
      if (e.button !== 2) return;
      const data = rightClickDataRef.current;
      if (!data) { cleanup(); return; }

      if (data.isDrag) {
        // Was a drag — execute ranged attack if valid
        const target = getTargetSquare(e.clientX, e.clientY);
        if (target && activeSandbox) {
          const pieces = activeSandbox.pieces;
          const targetPiece = findPieceAt(pieces, target.x, target.y);
          const sourceTeam = data.piece.player_id || data.piece.team;
          const targetTeam = targetPiece?.player_id || targetPiece?.team;

          if (targetPiece && targetTeam !== sourceTeam &&
              canRangedAttackTo(data.piece.y, data.piece.x, target.y, target.x, data.piece, sourceTeam) &&
              isRangedPathClear(data.piece.x, data.piece.y, target.x, target.y, data.piece, pieces, sourceTeam)) {
            const sbSnap4 = sandboxes.find(s => s.id === activeSandboxId);
            if (sbSnap4) {
              const result = commitMove(sbSnap4, {
                movingPieceId: data.piece.id,
                anchorX: data.piece.x,
                anchorY: data.piece.y,
                captureIds: new Set([targetPiece.id]),
                isRangedAttack: true,
                moveHistoryEntry: {
                  from: { x: data.piece.x, y: data.piece.y },
                  to: { x: target.x, y: target.y },
                  piece: data.piece.piece_name,
                  rangedAttack: true
                }
              });
              const pendingPromo = result._promotionInfo ? { ...result._promotionInfo, sandboxId: activeSandboxId } : null;
              delete result._promotionInfo;
              setSandboxes(prev => prev.map(s => s.id === activeSandboxId ? result : s));
              if (pendingPromo) setPromotionPending(pendingPromo);
            }
          }
        }
      } else {
        // Was a quick click — select the piece for potential deletion instead
        if (data.piece) {
          setSelectedPiece(data.piece);
          setValidMoves([]);
        }
      }
      cleanup();
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Re-render on resize so arrow repositions
    const handleResize = () => {
      if (rightClickDataRef.current?.isDrag) {
        setRangedMousePos(prev => prev ? { ...prev } : null);
      }
    };

    const cleanup = () => {
      rightClickDataRef.current = null;
      setIsRightClickActive(false);
      setRangedAttackSource(null);
      setRangedMousePos(null);
      setRangedTargetSquare(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu, { capture: true });
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      window.removeEventListener('resize', handleResize);
    };
  }, [isRightClickActive, activeSandbox, activeSandboxId, removePieceFromBoard, findPieceAt, commitMove, sandboxes]);

  // Handle piece selection from modal
  const handlePieceSelect = useCallback((pieceData) => {
    if (!rightClickPosition) return;
    
    addPieceToBoard(pieceData, rightClickPosition.col, rightClickPosition.row, pieceData.player_id);
    setShowRightClickModal(false);
    setRightClickPosition(null);
  }, [rightClickPosition, addPieceToBoard]);

  // Handle special square selection
  const handleSpecialSquareSelect = useCallback((typeId) => {
    if (!rightClickPosition) return;
    
    setSpecialSquare(rightClickPosition.col, rightClickPosition.row, typeId);
    setShowRightClickModal(false);
    setRightClickPosition(null);
  }, [rightClickPosition, setSpecialSquare]);

  // Handle piece hover - compute independent per-square move/capture/ranged like GameTypeView
  const handlePieceHover = useCallback((piece) => {
    if (!activeSandbox || !piece || !showHighlights) {
      setHoveredPiece(null);
      setHoveredHighlights({});
      return;
    }

    const boardWidth = activeSandbox.gameType.board_width || 8;
    const boardHeight = activeSandbox.gameType.board_height || 8;
    const hpw = piece.piece_width || 1;
    const hph = piece.piece_height || 1;
    const hTeam = piece.player_id || piece.team;
    const highlights = {};

    for (let ty = 0; ty < boardHeight; ty++) {
      for (let tx = 0; tx < boardWidth; tx++) {
        // Skip squares within the piece's own footprint
        if (tx >= piece.x && tx < piece.x + hpw && ty >= piece.y && ty < piece.y + hph) continue;

        let canMove = false, canCapture = false, canRanged = false, canHopCapture = false;
        let isCustomMove = false, isCustomAttack = false;
        for (let dr = 0; dr < hph && !canMove; dr++) {
          for (let dc = 0; dc < hpw && !canMove; dc++) {
            if (canPieceMoveTo(piece.x + dc, piece.y + dr, tx, ty, piece, hTeam)) canMove = true;
          }
        }
        // Check if move is custom-only (not reachable by standard movement)
        if (canMove && piece.custom_movement_squares) {
          let standardMove = false;
          for (let dr = 0; dr < hph && !standardMove; dr++) {
            for (let dc = 0; dc < hpw && !standardMove; dc++) {
              if (canPieceMoveTo(piece.x + dc, piece.y + dr, tx, ty, piece, hTeam, false, true)) standardMove = true;
            }
          }
          if (!standardMove) isCustomMove = true;
        }
        for (let dr = 0; dr < hph && !canCapture; dr++) {
          for (let dc = 0; dc < hpw && !canCapture; dc++) {
            if (canPieceCaptureTo(piece.x + dc, piece.y + dr, tx, ty, piece, hTeam)) canCapture = true;
          }
        }
        // Check if capture is custom-only
        if (canCapture && piece.custom_attack_squares) {
          let standardCapture = false;
          for (let dr = 0; dr < hph && !standardCapture; dr++) {
            for (let dc = 0; dc < hpw && !standardCapture; dc++) {
              if (canPieceCaptureTo(piece.x + dc, piece.y + dr, tx, ty, piece, hTeam, false, true)) standardCapture = true;
            }
          }
          if (!standardCapture) isCustomAttack = true;
        }
        if (piece.can_capture_enemy_via_range) {
          for (let dr = 0; dr < hph && !canRanged; dr++) {
            for (let dc = 0; dc < hpw && !canRanged; dc++) {
              canRanged = canRangedAttackTo(piece.y + dr, piece.x + dc, ty, tx, piece, hTeam);
            }
          }
        }
        if (piece.capture_on_hop) {
          for (let dr = 0; dr < hph && !canHopCapture; dr++) {
            for (let dc = 0; dc < hpw && !canHopCapture; dc++) {
              canHopCapture = canHopCaptureToUtil(piece.y + dr, piece.x + dc, ty, tx, piece, hTeam);
            }
          }
        }

        if (canMove || canCapture || canRanged || canHopCapture) {
          // Determine first-move-only flags so we can render the purple highlight
          // (matching the piece detail page / live game). These only apply when
          // the piece has not moved yet — once it has, the move was already
          // filtered out of validMoves by calculateValidMoves.
          const hasMoved = (piece.move_count || 0) > 0;
          let isMoveFirstOnly = false;
          let isCaptureFirstOnly = false;
          if (!hasMoved) {
            if (canMove) {
              for (let dr = 0; dr < hph && !isMoveFirstOnly; dr++) {
                for (let dc = 0; dc < hpw && !isMoveFirstOnly; dc++) {
                  if (checkIfFirstMoveOnlyMove(piece, piece.x + dc, piece.y + dr, tx, ty, hTeam)) {
                    isMoveFirstOnly = true;
                  }
                }
              }
            }
            if (canCapture) {
              for (let dr = 0; dr < hph && !isCaptureFirstOnly; dr++) {
                for (let dc = 0; dc < hpw && !isCaptureFirstOnly; dc++) {
                  if (checkIfFirstMoveOnlyCapture(piece, piece.x + dc, piece.y + dr, tx, ty, hTeam)) {
                    isCaptureFirstOnly = true;
                  }
                }
              }
            }
          }
          highlights[`${tx},${ty}`] = { canMove, canCapture, canRanged, canHopCapture, isCustomMove, isCustomAttack, isMoveFirstOnly, isCaptureFirstOnly };
        }
      }
    }

    setHoveredPiece(piece);
    setHoveredHighlights(highlights);
  }, [activeSandbox, canPieceMoveTo, canPieceCaptureTo, showHighlights]);

  // Handle drag start for pieces on the board (game movement with validation)
  const handleBoardPieceDragStart = useCallback((e, piece) => {
    if (!activeSandbox) return;
    
    // Calculate grab offset within the piece footprint for multi-tile pieces
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    if (pw > 1 || ph > 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const cellWidth = rect.width / pw;
      const cellHeight = rect.height / ph;
      grabOffsetX = Math.floor(relX / cellWidth);
      grabOffsetY = Math.floor(relY / cellHeight);
    }
    
    setTimeout(() => {
    
    setIsDragging(true);
    }, 0);
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      ...piece,
      fromBoard: true,
      originalX: piece.x,
      originalY: piece.y,
      grabOffsetX,
      grabOffsetY
    }));
    
    // Calculate valid moves so highlights show during drag
    const moves = calculateValidMoves(
      piece,
      activeSandbox.pieces,
      activeSandbox.gameType.board_width,
      activeSandbox.gameType.board_height
    );
    setSelectedPiece(piece);
    setValidMoves(applyForcedCaptureFilter(piece, moves));
  }, [activeSandbox, calculateValidMoves, applyForcedCaptureFilter]);

  // Handle drag from piece library
  const handleLibraryDragStart = useCallback((e, pieceData) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify({
      ...pieceData,
      player_id: sidebarPlayerView,
      fromLibrary: true
    }));
  }, [sidebarPlayerView]);

  // Handle drop on board - game movement with validation
  const handleBoardDrop = useCallback((e, x, y) => {
    e.preventDefault();
    e.stopPropagation();

    if (!activeSandbox) return;

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const pieceData = JSON.parse(data);
        
        if (pieceData.fromBoard) {
          // Adjust drop coordinates for multi-tile grab offset
          let anchorX = x - (pieceData.grabOffsetX || 0);
          let anchorY = y - (pieceData.grabOffsetY || 0);
          
          // Don't allow dropping on the same square
          if (pieceData.originalX === anchorX && pieceData.originalY === anchorY) {
            setSelectedPiece(null);
            setValidMoves([]);
            return;
          }
          
          // Check if target is a valid move
          const pw = pieceData.piece_width || 1;
          const ph = pieceData.piece_height || 1;
          let move = validMoves.find(m => m.x === anchorX && m.y === anchorY);
          // Multi-tile: when exact anchor match fails, find the valid move whose footprint covers the drop square
          if (!move && (pw > 1 || ph > 1)) {
            const candidates = validMoves.filter(m => !m.isRangedAttack &&
              x >= m.x && x < m.x + pw && y >= m.y && y < m.y + ph);
            if (candidates.length === 1) {
              move = candidates[0];
            } else if (candidates.length > 1) {
              move = candidates.reduce((best, m) => {
                const d = Math.abs(m.x - anchorX) + Math.abs(m.y - anchorY);
                const bd = Math.abs(best.x - anchorX) + Math.abs(best.y - anchorY);
                return d < bd ? m : best;
              });
            }
            if (move) {
              anchorX = move.x;
              anchorY = move.y;
            }
          }
          if (move) {
            // Execute game move with turn switch
            const pieces = activeSandbox.pieces;
            
            // Scan the entire destination footprint for the capture target
            // (for multi-tile pieces the enemy may not be at the anchor)
            let targetPiece = null;
            if (move.isCapture && !move.isRangedAttack) {
              const pieceTeam = pieceData.player_id || pieceData.team;
              for (let dy = 0; dy < ph && !targetPiece; dy++) {
                for (let dx = 0; dx < pw && !targetPiece; dx++) {
                  const found = findPieceAt(pieces, anchorX + dx, anchorY + dy);
                  if (found && found.id !== pieceData.id) {
                    const foundTeam = found.player_id || found.team;
                    if (foundTeam !== pieceTeam || pieceData.can_capture_allies) {
                      targetPiece = found;
                    }
                  }
                }
              }
            }
            
            // For hop captures, remove all hopped-over enemies
            let piecesToRemove = new Set();
            if (move.isHopCapture && move.hopCapturedPieceIds) {
              move.hopCapturedPieceIds.forEach(id => piecesToRemove.add(id));
            }
            if (targetPiece) {
              piecesToRemove.add(targetPiece.id);
            }

            const sbSnap5 = sandboxes.find(s => s.id === activeSandboxId);
            if (sbSnap5) {
              const result = commitMove(sbSnap5, {
                movingPieceId: pieceData.id,
                anchorX, anchorY,
                captureIds: piecesToRemove,
                isRangedAttack: false,
                moveHistoryEntry: {
                  from: { x: pieceData.originalX, y: pieceData.originalY },
                  to: { x: anchorX, y: anchorY },
                  piece: pieceData.piece_name,
                  piece_width: pieceData.piece_width || 1,
                  piece_height: pieceData.piece_height || 1
                }
              });
              const pendingPromo = result._promotionInfo ? { ...result._promotionInfo, sandboxId: activeSandboxId } : null;
              delete result._promotionInfo;
              setSandboxes(prev => prev.map(s => s.id === activeSandboxId ? result : s));
              if (pendingPromo) setPromotionPending(pendingPromo);
            }
          }
          // Clear selection state whether move succeeded or not
          setIsDragging(false);
          setSelectedPiece(null);
          setValidMoves([]);
        } else {
          // Dropping from library - add new piece
          addPieceToBoard(pieceData, x, y, pieceData.player_id);
        }
      }
    } catch (err) {
      console.error('Failed to handle drop:', err);
    }
  }, [activeSandbox, activeSandboxId, addPieceToBoard, validMoves, findPieceAt, commitMove, sandboxes]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    // Allow both copy and move - browser will use what's allowed
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
  }, []);

  // Get piece image with player index support
  const getPieceImage = useCallback((imageLocation, playerIndex = 0) => {
    if (!imageLocation) return null;
    
    try {
      const images = JSON.parse(imageLocation);
      if (Array.isArray(images) && images.length > 0) {
        const index = Math.min(playerIndex, images.length - 1);
        const imagePath = images[index];
        return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
      }
    } catch {
      if (imageLocation.startsWith('http')) {
        return imageLocation;
      } else if (imageLocation.startsWith('/uploads/')) {
        return `${ASSET_URL}${imageLocation}`;
      } else {
        return `${ASSET_URL}/uploads/pieces/${imageLocation}`;
      }
    }
    
    return null;
  }, []);

  // Get piece image for board display
  const getBoardPieceImage = useCallback((piece) => {
    if (piece.image_url) {
      return piece.image_url.startsWith('http') ? piece.image_url : `${ASSET_URL}${piece.image_url}`;
    }
    const playerIndex = (piece.player_id || piece.team || 1) - 1;
    return getPieceImage(piece.image_location, playerIndex);
  }, [getPieceImage]);

  // Numbered pagination for game types
  const [gameTypePage, setGameTypePage] = useState(1);
  const GAMES_PER_PAGE = 20;
  const totalGamePages = gamesTotal > 0 ? Math.ceil(gamesTotal / GAMES_PER_PAGE) : 1;
  const pagedGameTypes = gamesList;

  const handleGameTypePageChange = useCallback((page) => {
    const clamped = Math.max(1, Math.min(page, totalGamePages));
    setGameTypePage(clamped);
    sandboxGamesPageRef.current = clamped;
    sandboxGamesSearchRef.current = searchGameTerm;
    loadSandboxGames(searchGameTerm, clamped, true);
  }, [loadSandboxGames, searchGameTerm, totalGamePages]);

  // Filter pieces
  const filteredPieces = fullPiecesList.filter(piece =>
    piece.piece_name?.toLowerCase().includes(searchPieceTerm.toLowerCase())
  );
  const totalPiecePages = Math.ceil(filteredPieces.length / ITEMS_PER_PAGE) || 1;
  const pagedPieces = filteredPieces.slice((piecePage - 1) * ITEMS_PER_PAGE, piecePage * ITEMS_PER_PAGE);
  const handlePiecePageChange = (page) => {
    setPiecePage(Math.max(1, Math.min(page, totalPiecePages)));
  };

  // Render the board
  const renderBoard = () => {
    if (!activeSandbox) {
      return (
        <div className={styles["empty-state"]}>
          <h2>No Board Loaded</h2>
          <p>Create a blank board or load a game type to get started</p>
          <button onClick={createBlankSandbox} className={styles["btn-primary"]}>
            Create Blank Board
          </button>
        </div>
      );
    }

    const boardWidth = activeSandbox.gameType.board_width || 8;
    const boardHeight = activeSandbox.gameType.board_height || 8;
    const squareSize = boardVpHook.squareSize || 40;
    const pieces = activeSandbox.pieces;
    const specialSquares = activeSandbox.specialSquares || {};

    const squares = [];

    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        const x = boardFlipped ? (boardWidth - 1 - col) : col;
        const y = boardFlipped ? (boardHeight - 1 - row) : row;
        const isLight = (x + y) % 2 === 0;
        // Multi-tile aware: find piece whose footprint covers this square
        const piece = pieces.find(p => {
          const pw = p.piece_width || 1;
          const ph = p.piece_height || 1;
          return x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph;
        });
        const isAnchor = piece && piece.x === x && piece.y === y;
        const isSelected = selectedPiece && (
          x >= selectedPiece.x && x < selectedPiece.x + (selectedPiece.piece_width || 1) &&
          y >= selectedPiece.y && y < selectedPiece.y + (selectedPiece.piece_height || 1)
        );
        // Find regular and ranged moves separately so both styles can overlap
        // Multi-tile aware: highlight all squares the piece would cover at each valid destination
        // But don't highlight squares within the selected piece's current footprint
        const spw = selectedPiece?.piece_width || 1;
        const sph = selectedPiece?.piece_height || 1;
        const inSelectedFootprint = selectedPiece && (
          x >= selectedPiece.x && x < selectedPiece.x + spw &&
          y >= selectedPiece.y && y < selectedPiece.y + sph
        );
        const regularMove = showHighlights && !inSelectedFootprint ? validMoves.find(m => !m.isRangedAttack &&
          x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph
        ) : null;
        const rangedMove = showHighlights ? validMoves.find(m => m.x === x && m.y === y && m.isRangedAttack) : null;

        // Hover highlight: look up pre-computed per-square move/capture/ranged from hoveredHighlights
        const hovHighlight = (!selectedPiece && hoveredPiece) ? hoveredHighlights[`${x},${y}`] : null;

        const isLastMoveFrom = showHighlights && lastMove && (() => {
          const lmpw = lastMove.piece_width || 1;
          const lmph = lastMove.piece_height || 1;
          return x >= lastMove.from.x && x < lastMove.from.x + lmpw
            && y >= lastMove.from.y && y < lastMove.from.y + lmph;
        })();
        const isLastMoveTo = showHighlights && lastMove && (() => {
          const lmpw = lastMove.piece_width || 1;
          const lmph = lastMove.piece_height || 1;
          return x >= lastMove.to.x && x < lastMove.to.x + lmpw
            && y >= lastMove.to.y && y < lastMove.to.y + lmph;
        })();
        const specialSquareType = showAllSpecialSquares ? specialSquares[`${x},${y}`] : null;

        // Check ranged attack highlights
        const isRangedMove = !!rangedMove;
        // During ranged drag, highlight all valid ranged target squares (including empty)
        const rangedSourceTeam = rangedAttackSource?.player_id || rangedAttackSource?.team;
        const isRangedDragTarget = rangedAttackSource && showHighlights
          && !(piece && ((piece.player_id || piece.team) === rangedSourceTeam))
          && canRangedAttackTo(rangedAttackSource.y, rangedAttackSource.x, y, x, rangedAttackSource, rangedSourceTeam)
          && isRangedPathClear(rangedAttackSource.x, rangedAttackSource.y, x, y, rangedAttackSource, activeSandbox?.pieces || [], rangedSourceTeam);

        // Compute overlay highlight style for selected/dragged piece (validMoves)
        const selCanMove = !!(regularMove && !regularMove.isCapture);
        const selMoveFirstOnly = selCanMove && !!regularMove.isFirstMoveOnly;
        const selCanCapture = !!(regularMove && regularMove.isCapture);
        const selCaptureFirstOnly = selCanCapture && !!regularMove.isFirstMoveOnly;
        const selIsCustomMove = selCanMove && !!regularMove.isCustomMove;
        const selIsCustomAttack = selCanCapture && !!regularMove.isCustomAttack;
        const selCanRanged = isRangedMove || isRangedDragTarget;
        const { style: selHighlightStyle, icon: selHighlightIcon } = (selCanMove || selCanCapture || selCanRanged)
          ? getSquareHighlightStyle(selCanMove, selMoveFirstOnly, selCanCapture, selCaptureFirstOnly, selCanRanged, isLight, selIsCustomMove, selIsCustomAttack)
          : { style: {}, icon: null };

        // Compute overlay highlight style for hovered piece (independent per-square checks, like GameTypeView)
        const hovCanMove = !!hovHighlight?.canMove;
        const hovCanCapture = !!hovHighlight?.canCapture;
        const hovCanRanged = !!hovHighlight?.canRanged;
        const hovCanHopCapture = !!hovHighlight?.canHopCapture;
        const hovIsCustomMove = !!hovHighlight?.isCustomMove;
        const hovIsCustomAttack = !!hovHighlight?.isCustomAttack;
        const hovMoveFirstOnly = !!hovHighlight?.isMoveFirstOnly;
        const hovCaptureFirstOnly = !!hovHighlight?.isCaptureFirstOnly;
        const { style: hovHighlightStyle, icon: hovHighlightIcon } = (hovCanMove || hovCanCapture || hovCanRanged)
          ? getSquareHighlightStyle(hovCanMove, hovMoveFirstOnly, hovCanCapture, hovCaptureFirstOnly, hovCanRanged, isLight, hovIsCustomMove, hovIsCustomAttack)
          : { style: {}, icon: null };

        // Use selected piece highlights if active, otherwise use hovered piece highlights
        // Hop capture green is additive — shown as a separate overlay on top of other highlights
        const showHopCaptureOverlay = !selectedPiece && hovCanHopCapture;
        const activeHighlightStyle = (selHighlightStyle.outline || selHighlightStyle.borderTop) ? selHighlightStyle : hovHighlightStyle;
        const activeHighlightIcon = selHighlightIcon || hovHighlightIcon;

        squares.push(
          <div
            key={`${x}-${y}`}
            className={`
              ${styles["board-square"]}
              ${isLight ? styles.light : styles.dark}
              ${isSelected ? styles.selected : ''}
              ${isLastMoveFrom ? (isLight ? styles["last-move-from-light"] : styles["last-move-from-dark"]) : ''}
              ${isLastMoveTo ? styles["last-move-to"] : ''}
              ${specialSquareType === 'promotion' ? styles["promotion-square"] : ''}
              ${specialSquareType === 'range' ? styles["range-square"] : ''}
              ${specialSquareType === 'control' ? styles["control-square"] : ''}
              ${specialSquareType === 'custom' ? styles["special-square"] : ''}
            `}
            onClick={() => handleSquareClick(x, y)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleBoardDrop(e, x, y)}
            onMouseDown={(e) => handleSquareMouseDown(e, x, y)}
            onContextMenu={(e) => handleSquareContextMenu(e, x, y)}
            onTouchStart={(e) => handleTouchStart(e, x, y)}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
            style={{
              backgroundColor: isLight 
                ? (currentUser?.light_square_color || '#cad5e8')
                : (currentUser?.dark_square_color || '#08234d'),
              ...(isAnchor && piece && ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) ? { zIndex: 10 } : {})
            }}
          >
            <SquareHighlightOverlay
              highlightStyle={activeHighlightStyle}
              highlightIcon={activeHighlightIcon}
              canHopCapture={showHopCaptureOverlay}
              squareSize={squareSize}
              isLight={isLight}
            />
            {isAnchor && (() => {
              const pw = piece.piece_width || 1;
              const ph = piece.piece_height || 1;
              const isMultiTile = pw > 1 || ph > 1;
              const isNonSquareMultiTile = isMultiTile && pw !== ph;
              const multiTileStyle = isMultiTile ? {
                width: `${pw * 100}%`,
                height: `${ph * 100}%`,
                zIndex: 5,
                position: 'absolute',
                overflow: 'hidden',
                top: 0,
                left: 0,
                ...(isDragging ? { pointerEvents: 'none' } : {})
              } : {};
              const isTouchDragging = touchDragPiece && touchDragPiece.x === piece.x && touchDragPiece.y === piece.y;
              return (
              <div
                className={`${styles.piece} ${styles.draggable}`}
                style={{ ...multiTileStyle, ...(isTouchDragging ? { opacity: 0 } : {}) }}
                draggable={true}
                onDragStart={(e) => handleBoardPieceDragStart(e, piece)}
                onDragEnd={() => {
                  setIsDragging(false);
                  setSelectedPiece(null);
                  setValidMoves([]);
                }}
                onTouchStart={(e) => handlePieceTouchStart(e, piece)}
                onTouchMove={handlePieceTouchMove}
                onTouchEnd={handlePieceTouchEnd}
                onMouseEnter={() => handlePieceHover(piece)}
                onMouseLeave={() => handlePieceHover(null)}
              >
                {boardAnimationsEnabled && isMultiTile && (
                  <>
                    <div className={styles["multi-tile-smoke"]} />
                    <div className={styles["multi-tile-electric"]} />
                  </>
                )}
                {isNonSquareMultiTile ? (
                  <div
                    ref={(el) => applySvgStretchBackground(el, getBoardPieceImage(piece))}
                    style={{
                      width: '100%',
                      height: '100%',
                      ...(pieceShadowEnabled ? { filter: 'drop-shadow(4px 5px 6px rgba(0, 0, 0, 0.65))' } : {})
                    }}
                    draggable={false}
                  />
                ) : (
                  <img
                    src={getBoardPieceImage(piece)}
                    alt={piece.piece_name}
                    draggable={false}
                    {...(pieceShadowEnabled ? { style: { filter: 'drop-shadow(4px 5px 6px rgba(0, 0, 0, 0.65))' } } : {})}
                    onError={(e) => handlePieceImageError(e, piece.piece_name, piece.player_id || piece.team)}
                  />
                )}
                {piece.show_hp_ad && (
                  <div className={styles["sandbox-hp-badge"]}>
                    {`${piece.current_hp ?? piece.hit_points ?? 1}/${piece.attack_damage ?? 1}`}
                  </div>
                )}
              </div>
              );
            })()}
            {specialSquareType && (
              <div className={`${styles["special-square-indicator"]} ${styles[specialSquareType]}`}>
                {SPECIAL_SQUARE_TYPES[specialSquareType]?.name?.charAt(0)}
              </div>
            )}
          </div>
        );
      }
    }

    return (
      <div className={styles["board-wrapper"]}>
        {activeSandbox.gameOver && (
          <div className={styles["sandbox-gameover-banner"]}>
            <strong>
              {activeSandbox.gameOver.winner
                ? `Player ${activeSandbox.gameOver.winner} wins`
                : 'Draw'}
              :
            </strong>
            <span>{GAME_OVER_REASON_LABELS[activeSandbox.gameOver.reason] || activeSandbox.gameOver.reason}</span>
            <button
              className={styles["btn-primary"]}
              onClick={() => {
                setSandboxes(prev => prev.map(s => {
                  if (s.id !== activeSandboxId) return s;
                  return {
                    ...s,
                    currentTurn: 1,
                    moveHistory: [],
                    moveCount: 0,
                    positionHistory: [],
                    actionsThisTurn: 0,
                    gameOver: null,
                    pieces: s.pieces.map(p => ({ ...p, move_count: 0, current_hp: p.hit_points ?? p.current_hp ?? 1 })),
                  };
                }));
              }}
            >
              Reset Game
            </button>
            <button
              className={styles["btn-secondary"]}
              onClick={() => updateActiveSandbox(() => ({ gameOver: null }))}
              title="Dismiss the banner and keep editing"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className={styles["board-header"]}>
          <h2>
            {activeSandbox.gameType?.id
              ? <Link to={`/games/${activeSandbox.gameType.id}`} target="_blank" rel="noopener noreferrer" className={styles["game-name-link"]}>{activeSandbox.name}</Link>
              : activeSandbox.name}
          </h2>
          <div className={styles["header-controls"]}>
            <ToggleSwitch
              checked={showHighlights}
              onChange={(v) => setShowHighlights(v)}
              label="Show move highlights"
            />
            <ToggleSwitch
              checked={showAllSpecialSquares}
              onChange={(v) => setShowAllSpecialSquares(v)}
              label="Show special squares"
            />
          </div>
        </div>
        <div className={styles["turn-banner"]}>
          {activeSandbox.currentTurn === playingAs
            ? `Your turn (Player ${playingAs})`
            : `Opponent's turn (Player ${activeSandbox.currentTurn === 1 ? 1 : 2})`}
        </div>
        {activeSandbox.rules?.place_pieces_action && Array.isArray(activeSandbox.placementPool) && activeSandbox.placementPool.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', padding: '0.5rem', flexWrap: 'wrap', background: 'rgba(0,0,0,0.15)', borderRadius: 4, marginBottom: '0.4rem' }}>
            <span style={{ fontSize: 12, alignSelf: 'center', opacity: 0.8 }}>Place:</span>
            {activeSandbox.placementPool.map((pp, idx) => {
              const full = fullPiecesList.find(fp => fp.piece_id === pp.piece_id || fp.id === pp.piece_id) || pp;
              let imgSrc = '';
              try {
                const loc = full.image_location;
                if (loc) {
                  const parsed = typeof loc === 'string' ? JSON.parse(loc) : loc;
                  const first = Array.isArray(parsed) ? parsed[0] : parsed;
                  imgSrc = first?.startsWith('http') ? first : `${ASSET_URL}${first}`;
                }
              } catch (_) { /* ignore */ }
              const isSelected = activeSandbox.placementSelected?.piece_id === (full.piece_id || full.id);
              return (
                <button
                  key={`${full.piece_id || full.id}-${idx}`}
                  onClick={() => updateActiveSandbox(s => ({
                    ...s,
                    placementSelected: isSelected ? null : { ...full, piece_id: full.piece_id || full.id },
                  }))}
                  title={full.piece_name}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '0.25rem 0.4rem',
                    background: isSelected ? 'rgba(80,160,240,0.4)' : 'rgba(255,255,255,0.05)',
                    border: isSelected ? '2px solid #5aa8ff' : '1px solid #444',
                    borderRadius: 4, cursor: 'pointer', color: 'inherit', minWidth: 56,
                  }}
                >
                  {imgSrc && <img src={imgSrc} alt={full.piece_name} style={{ width: 32, height: 32, objectFit: 'contain' }}
                    onError={(e) => handlePieceImageError(e, full.piece_name, activeSandbox.currentTurn)} />}
                  <span style={{ fontSize: 11, marginTop: 2 }}>{full.piece_name}</span>
                </button>
              );
            })}
            {activeSandbox.placementSelected && (
              <button
                onClick={() => updateActiveSandbox(s => ({ ...s, placementSelected: null }))}
                style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, padding: '0.25rem 0.5rem' }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        <div style={boardVpHook.frameStyle}>
        <div
          className={`${boardVp.viewport} ${boardVpHook.hideScrollbars ? boardVp.noScrollbars : ''}`}
          ref={boardVpHook.viewportRef}
          style={boardVpHook.viewportStyle}
        >
          <div style={boardVpHook.contentStyle}>
        <div className={styles["board-with-notation"]}>
          {/* Rank labels (left side) */}
          <div className={styles["rank-labels"]} style={{ gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)` }}>
            {Array.from({ length: boardHeight }, (_, row) => {
              const rank = boardFlipped ? row + 1 : boardHeight - row;
              return <div key={row} className={styles["rank-label"]}>{rank}</div>;
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              ref={boardRef}
              className={styles.board}
              style={{
                gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`,
                gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`,
                width: 'fit-content',
                maxWidth: 'none',
                maxHeight: 'none',
                aspectRatio: 'unset'
              }}
            >
          {squares}
          {rangedAttackSource && rangedMousePos && boardRef.current && (() => {
            const boardRect = boardRef.current.getBoundingClientRect();
            const squareWidth = boardRect.width / boardWidth;
            const squareHeight = boardRect.height / boardHeight;
            const visualX = boardFlipped ? (boardWidth - 1 - rangedAttackSource.x) : rangedAttackSource.x;
            const visualY = boardFlipped ? (boardHeight - 1 - rangedAttackSource.y) : rangedAttackSource.y;
            const startX = (visualX + 0.5) * squareWidth;
            const startY = (visualY + 0.5) * squareHeight;
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
                    id="ranged-arrowhead"
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
                  markerEnd="url(#ranged-arrowhead)"
                  opacity="0.9"
                />
              </svg>
            );
          })()}
            </div>
            {touchDragPiece && touchDragPos && (() => {
              const imgUrl = getBoardPieceImage(touchDragPiece);
              const pw = touchDragPiece.piece_width || 1;
              const ph = touchDragPiece.piece_height || 1;
              const cellSize = boardRef.current ? boardRef.current.getBoundingClientRect().width / (activeSandbox?.gameType?.board_width || 8) : 60;
              return (
                <div style={{
                  position: 'fixed',
                  left: touchDragPos.x - (cellSize * pw) / 2,
                  top: touchDragPos.y - (cellSize * ph) / 2,
                  width: cellSize * pw,
                  height: cellSize * ph,
                  pointerEvents: 'none',
                  zIndex: 9999,
                  opacity: 0.85,
                }}>
                  {imgUrl && <img src={imgUrl} alt="" draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'fill' }}
                    onError={(e) => handlePieceImageError(e, touchDragPiece.piece_name, touchDragPiece.player_id || touchDragPiece.team)} />}
                </div>
              );
            })()}
            {/* File labels (bottom) */}
            <div className={styles["file-labels"]} style={{ gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)` }}>
              {Array.from({ length: boardWidth }, (_, col) => {
                const fileIndex = boardFlipped ? (boardWidth - 1 - col) : col;
                return <div key={col} className={styles["file-label"]}>{String.fromCharCode(97 + fileIndex)}</div>;
              })}
            </div>
          </div>
        </div>
          </div>
        </div>
        <BoardZoomControls {...boardVpHook.controlProps} />
        </div>
        <div className={styles["board-controls"]}>
          <button
            onClick={() => {
              setBoardFlipped(f => !f);
              setPlayingAs(p => p === 1 ? 2 : 1);
            }}
            className={styles["btn-secondary"]}
            title="Flip the board perspective"
          >
            🔄 Flip Board
          </button>
          <button
            onClick={() => {
              setSandboxes(prev => prev.map(s =>
                s.id === activeSandboxId
                  ? { ...s, currentTurn: s.currentTurn === 1 ? 2 : 1 }
                  : s
              ));
            }}
            className={styles["btn-secondary"]}
          >
            Switch Turn
          </button>
          <button
            onClick={() => {
              if (window.confirm('Clear all pieces from the board?')) {
                setSandboxes(prev => prev.map(s =>
                  s.id === activeSandboxId
                    ? { ...s, pieces: [], moveHistory: [], moveCount: 0, positionHistory: [], actionsThisTurn: 0, gameOver: null }
                    : s
                ));
              }
            }}
            className={styles["btn-secondary"]}
          >
            Clear Board
          </button>
          <button
            onClick={() => {
              // Reset game-progress state without clearing pieces
              setSandboxes(prev => prev.map(s => {
                if (s.id !== activeSandboxId) return s;
                return {
                  ...s,
                  currentTurn: 1,
                  moveHistory: [],
                  moveCount: 0,
                  positionHistory: [],
                  actionsThisTurn: 0,
                  gameOver: null,
                  pieces: s.pieces.map(p => ({
                    ...p,
                    move_count: 0,
                    current_hp: p.hit_points ?? p.current_hp ?? 1,
                  })),
                };
              }));
            }}
            className={styles["btn-secondary"]}
            title="Reset turn, move history, HP, and game-over state"
          >
            Reset Game
          </button>
          <button
            onClick={() => {
              if (window.confirm('Clear all special squares?')) {
                setSandboxes(prev => prev.map(s =>
                  s.id === activeSandboxId
                    ? { ...s, specialSquares: {}, gameSpecialSquares: { range: {}, promotion: {}, control: {}, special: {} } }
                    : s
                ));
              }
            }}
            className={styles["btn-secondary"]}
          >
            Clear Special Squares
          </button>
          <button
            onClick={() => handleMirrorPieces(1, 2)}
            className={styles["btn-mirror"]}
            title="Copy Player 1's pieces to Player 2's side (mirrored vertically)"
          >
            Mirror P1 → P2
          </button>
          <button
            onClick={() => handleMirrorPieces(2, 1)}
            className={styles["btn-mirror"]}
            title="Copy Player 2's pieces to Player 1's side (mirrored vertically)"
          >
            Mirror P2 → P1
          </button>
          {selectedPiece && (
            <button
              onClick={() => {
                removePieceFromBoard(selectedPiece.id);
                setSelectedPiece(null);
                setValidMoves([]);
              }}
              className={styles["btn-delete"]}
              title="Delete selected piece (or press Delete key)"
            >
              🗑️ Delete {selectedPiece.piece_name || 'Piece'}
            </button>
          )}
        </div>
        {showHighlights && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            justifyContent: 'center',
            margin: '10px 0',
            fontSize: '0.85rem',
            color: '#ccc'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(33, 150, 243, 0.55)', outlineOffset: '-3px', background: 'rgba(33, 150, 243, 0.1)', borderRadius: '3px' }}></div>
              <span>Movement</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(156, 39, 176, 0.55)', outlineOffset: '-3px', background: 'rgba(156, 39, 176, 0.1)', borderRadius: '3px' }}></div>
              <span>First Move</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(255, 152, 0, 0.55)', outlineOffset: '-3px', background: 'rgba(255, 152, 0, 0.1)', borderRadius: '3px' }}></div>
              <span>Attack</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(233, 30, 99, 0.55)', outlineOffset: '-3px', background: 'rgba(233, 30, 99, 0.1)', borderRadius: '3px' }}></div>
              <span>First Attack</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', borderTop: '3px solid rgba(33, 150, 243, 0.55)', borderLeft: '3px solid rgba(33, 150, 243, 0.55)', borderBottom: '3px solid rgba(255, 152, 0, 0.55)', borderRight: '3px solid rgba(255, 152, 0, 0.55)', boxSizing: 'border-box', background: 'linear-gradient(135deg, rgba(33, 150, 243, 0.1) 50%, rgba(255, 152, 0, 0.1) 50%)', borderRadius: '3px' }}></div>
              <span>Move + Attack</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(244, 67, 54, 0.55)', outlineOffset: '-3px', background: 'rgba(244, 67, 54, 0.1)', borderRadius: '3px' }}></div>
              <span>Ranged 💥</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(76, 175, 80, 0.7)', outlineOffset: '-3px', background: 'rgba(76, 175, 80, 0.2)', borderRadius: '3px' }}></div>
              <span>Capture on Hop</span>
            </div>
          </div>
        )}
        <div className={styles["board-instructions"]}>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>♟</span>
            <strong>Move &amp; Capture:</strong> Drag piece to a valid square
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>✋</span>
            <strong>Reposition:</strong> Click piece, then click any square
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>➕</span>
            <strong>Add:</strong> {isMobile ? 'Long press empty square' : 'Right-click empty square'}
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>❌</span>
            <strong>Remove:</strong> {isMobile ? 'Select piece, tap Delete button' : 'Select piece, press Delete key'}
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>🎯</span>
            <strong>Ranged Attack:</strong> Right-click and drag from ranged piece to target
          </div>
        </div>
      </div>
    );
  };

  // Combined modal for piece/special square selection
  const renderRightClickModal = () => {
    if (!showRightClickModal || !rightClickPosition) return null;

    return (
      <div className={styles["modal-overlay"]} onClick={() => setShowRightClickModal(false)}>
        <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
          <div className={styles["modal-header"]}>
            <h2>Square ({rightClickPosition.row}, {rightClickPosition.col})</h2>
            <button className={styles["close-button"]} onClick={() => setShowRightClickModal(false)}>✕</button>
          </div>
          
          <div className={styles["modal-tabs"]}>
            <button
              className={`${styles["modal-tab"]} ${rightClickMode === 'piece' ? styles.active : ''}`}
              onClick={() => setRightClickMode('piece')}
            >
              Add Piece
            </button>
            <button
              className={`${styles["modal-tab"]} ${rightClickMode === 'special' ? styles.active : ''}`}
              onClick={() => setRightClickMode('special')}
            >
              Special Square
            </button>
          </div>

          {rightClickMode === 'piece' ? (
            <PieceSelector
              onSelect={handlePieceSelect}
              onRemove={() => setShowRightClickModal(false)}
              onCancel={() => setShowRightClickModal(false)}
              playerCount={2}
              currentPlacement={null}
              squarePosition={rightClickPosition}
              mateCondition={false}
              captureCondition={false}
              embedded={true}
            />
          ) : (
            <div className={styles["special-squares-grid"]}>
              {Object.entries(SPECIAL_SQUARE_TYPES).map(([id, type]) => (
                <button
                  key={id}
                  className={styles["special-square-btn"]}
                  style={{ borderColor: type.color }}
                  onClick={() => handleSpecialSquareSelect(id)}
                >
                  <div 
                    className={styles["special-square-color"]}
                    style={{ backgroundColor: type.color }}
                  >
                    {type.name.charAt(0)}
                  </div>
                  <span>{type.name}</span>
                </button>
              ))}
              <button
                className={`${styles["special-square-btn"]} ${styles["remove-btn"]}`}
                onClick={() => handleSpecialSquareSelect(null)}
              >
                <div className={styles["special-square-color"]}>✕</div>
                <span>Remove Special</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles["sandbox-container"]}>
      {/* Left Sidebar - Game Types */}
      <div className={`${styles.sidebar} ${styles.left}`}>
        <div className={styles["sidebar-section"]}>
          <div className={styles["sidebar-header"]}>
            <h3>Game Types</h3>
            <button
              onClick={() => setShowGameTypes(!showGameTypes)}
              className={styles["toggle-btn"]}
              title={showGameTypes ? "Collapse" : "Expand"}
            >
              {showGameTypes ? '▼' : '▶'}
            </button>
          </div>

          {showGameTypes && (
            <>
              <div className={styles["search-box"]}>
                <input
                  type="text"
                  placeholder="Search games..."
                  value={searchGameTerm}
                  onChange={(e) => setSearchGameTerm(e.target.value)}
                />
              </div>

              {totalGamePages > 1 && (() => {
                const cur = gameTypePage;
                const pageNums = [];
                let start = Math.max(1, cur - 1);
                let end = Math.min(totalGamePages, start + 2);
                if (end - start < 2) start = Math.max(1, end - 2);
                for (let p = start; p <= end; p++) pageNums.push(p);
                return (
                  <div className={styles["pagination-bar"]}>
                    <button className={styles["page-btn"]} onClick={() => handleGameTypePageChange(1)} disabled={cur === 1 || gamesLoading} title="First page">&laquo;</button>
                    <button className={styles["page-btn"]} onClick={() => handleGameTypePageChange(cur - 1)} disabled={cur === 1 || gamesLoading} title="Previous">&lsaquo;</button>
                    {pageNums.map(p => (
                      <button key={p} className={`${styles["page-btn"]}${p === cur ? ' ' + styles["page-btn-active"] : ''}`} onClick={() => handleGameTypePageChange(p)} disabled={gamesLoading}>{p}</button>
                    ))}
                    <button className={styles["page-btn"]} onClick={() => handleGameTypePageChange(cur + 1)} disabled={cur === totalGamePages || gamesLoading} title="Next">&rsaquo;</button>
                    <button className={styles["page-btn"]} onClick={() => handleGameTypePageChange(totalGamePages)} disabled={cur === totalGamePages || gamesLoading} title="Last page">&raquo;</button>
                  </div>
                );
              })()}

              {gamesLoading && gamesList.length === 0 && (
                <div style={{ padding: '8px', opacity: 0.6, fontSize: '0.85em' }}>Loading games...</div>
              )}

              <div className={styles["item-list"]}>
                <button
                  onClick={createBlankSandbox}
                  className={`${styles["list-item"]} ${styles["blank-board-btn"]}`}
                  disabled={sandboxes.length >= MAX_SANDBOXES}
                >
                  <strong>✦ Blank Board</strong>
                  <span>8×8 empty board</span>
                </button>

                {pagedGameTypes.map((game) => (
                  <button
                    key={game.id}
                    onClick={() => loadGameType(game)}
                    className={styles["list-item"]}
                    disabled={sandboxes.length >= MAX_SANDBOXES}
                  >
                    <strong>{game.game_name}</strong>
                    <span>{game.board_width}×{game.board_height}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Win Conditions Section */}
        <div className={styles["sidebar-section"]}>
          <div className={styles["sidebar-header"]}>
            <h3>Win Conditions</h3>
            <button
              onClick={() => setShowWinConditions(v => !v)}
              className={styles["toggle-btn"]}
              title={showWinConditions ? "Collapse" : "Expand"}
            >
              {showWinConditions ? '▼' : '▶'}
            </button>
          </div>
          {showWinConditions && (
            <div className={styles["game-rules"]}>
              <ToggleSwitch checked={sandboxRules.mate_condition} onChange={(v) => setSandboxRules(r => ({ ...r, mate_condition: v }))} label="Checkmate" />
              {sandboxRules.mate_condition && (
                <ToggleSwitch checked={sandboxRules.mate_condition_requires_all} onChange={(v) => setSandboxRules(r => ({ ...r, mate_condition_requires_all: v }))} label="…requires ALL royal pieces" />
              )}
              <ToggleSwitch checked={sandboxRules.capture_condition} onChange={(v) => setSandboxRules(r => ({ ...r, capture_condition: v }))} label="Capture to win" />
              {sandboxRules.capture_condition && (
                <ToggleSwitch checked={sandboxRules.capture_condition_requires_all} onChange={(v) => setSandboxRules(r => ({ ...r, capture_condition_requires_all: v }))} label="…requires ALL targets" />
              )}
              <ToggleSwitch checked={sandboxRules.no_moves_condition} onChange={(v) => setSandboxRules(r => ({ ...r, no_moves_condition: v }))} label="No moves = loss" />
              <ToggleSwitch checked={sandboxRules.squares_condition} onChange={(v) => setSandboxRules(r => ({ ...r, squares_condition: v }))} label="Control squares" />
              <ToggleSwitch checked={sandboxRules.piece_count_condition} onChange={(v) => setSandboxRules(r => ({ ...r, piece_count_condition: v }))} label="Piece count wins" />
              <ToggleSwitch checked={sandboxRules.promotion_condition} onChange={(v) => setSandboxRules(r => ({ ...r, promotion_condition: v }))} label="Promotion wins" />
              <ToggleSwitch checked={sandboxRules.lose_all_pieces_condition} onChange={(v) => setSandboxRules(r => ({ ...r, lose_all_pieces_condition: v }))} label="Lose all pieces wins" />
              <ToggleSwitch checked={sandboxRules.stalemate_win_condition} onChange={(v) => setSandboxRules(r => ({ ...r, stalemate_win_condition: v }))} label="Stalemate = win" />
            </div>
          )}
        </div>

        {/* Draw Conditions Section */}
        <div className={styles["sidebar-section"]}>
          <div className={styles["sidebar-header"]}>
            <h3>Draw Conditions</h3>
            <button
              onClick={() => setShowDrawConditions(v => !v)}
              className={styles["toggle-btn"]}
              title={showDrawConditions ? "Collapse" : "Expand"}
            >
              {showDrawConditions ? '▼' : '▶'}
            </button>
          </div>
          {showDrawConditions && (
            <div className={styles["game-rules"]}>
              <ToggleSwitch checked={sandboxRules.stalemate_draw_condition} onChange={(v) => setSandboxRules(r => ({ ...r, stalemate_draw_condition: v }))} label="Stalemate = draw" />
              <ToggleSwitch checked={sandboxRules.equal_piece_count_draw} onChange={(v) => setSandboxRules(r => ({ ...r, equal_piece_count_draw: v }))} label="Equal piece count = draw" />
              <label className={styles["rule-input"]}>
                <span>Draw move limit</span>
                <NumberInput value={sandboxRules.draw_move_limit || ''} onChange={(val) => setSandboxRules(r => ({ ...r, draw_move_limit: val ? Math.max(1, Math.min(500, val)) : null }))} options={{ min: 1, max: 500, placeholder: 'Off' }} />
              </label>
              <label className={styles["rule-input"]}>
                <span>Repetition draw</span>
                <NumberInput value={sandboxRules.repetition_draw_count || ''} onChange={(val) => setSandboxRules(r => ({ ...r, repetition_draw_count: val ? Math.max(2, Math.min(9, val)) : null }))} options={{ min: 2, max: 9, placeholder: 'Off' }} />
              </label>
            </div>
          )}
        </div>

        {/* Game Mechanics Section */}
        <div className={styles["sidebar-section"]}>
          <div className={styles["sidebar-header"]}>
            <h3>Game Mechanics</h3>
            <button
              onClick={() => setShowGameMechanics(v => !v)}
              className={styles["toggle-btn"]}
              title={showGameMechanics ? "Collapse" : "Expand"}
            >
              {showGameMechanics ? '▼' : '▶'}
            </button>
          </div>
          {showGameMechanics && (
            <div className={styles["game-rules"]}>
              <label className={styles["rule-input"]}>
                <span>Actions per turn</span>
                <NumberInput value={sandboxRules.actions_per_turn} onChange={(val) => setSandboxRules(r => ({ ...r, actions_per_turn: Math.max(1, Math.min(8, val || 1)) }))} options={{ min: 1, max: 8 }} />
              </label>
              <ToggleSwitch checked={sandboxRules.place_pieces_action} onChange={(v) => setSandboxRules(r => ({ ...r, place_pieces_action: v }))} label="Place pieces action" />
              <ToggleSwitch checked={sandboxRules.forced_capture_condition} onChange={(v) => setSandboxRules(r => ({ ...r, forced_capture_condition: v }))} label="Forced capture" />
              <ToggleSwitch checked={sandboxRules.flanking_captures} onChange={(v) => setSandboxRules(r => ({ ...r, flanking_captures: v }))} label="Flanking captures" />
              <ToggleSwitch checked={sandboxRules.simultaneous_turns} onChange={(v) => setSandboxRules(r => ({ ...r, simultaneous_turns: v }))} label="Simultaneous turns" />
            </div>
          )}
        </div>
      </div>

      {/* Center - Board */}
      <div className={styles["main-area"]}>
        {/* Sandbox Tabs */}
        <div className={styles["sandbox-tabs"]}>
          {sandboxes.map((sandbox) => (
            <div
              key={sandbox.id}
              className={`${styles.tab} ${sandbox.id === activeSandboxId ? styles.active : ''}`}
              onClick={() => setActiveSandboxId(sandbox.id)}
            >
              <span>{sandbox.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSandbox(sandbox.id);
                }}
                className={styles["close-tab"]}
              >
                ×
              </button>
            </div>
          ))}
          {sandboxes.length < MAX_SANDBOXES && (
            <button
              onClick={createBlankSandbox}
              className={styles["add-tab"]}
              title="Create new sandbox"
            >
              +
            </button>
          )}
          {sandboxes.length >= MAX_SANDBOXES && (
            <span className={styles["max-reached"]}>Max {MAX_SANDBOXES} sandboxes</span>
          )}
        </div>

        {renderBoard()}
      </div>

      {/* Right Sidebar - Piece Library */}
      <div className={`${styles.sidebar} ${styles.right}`}>
        <div className={styles["sidebar-header"]}>
          <h3>Piece Library</h3>
          <button
            onClick={() => setShowPieceLibrary(!showPieceLibrary)}
            className={styles["toggle-btn"]}
            title={showPieceLibrary ? "Collapse" : "Expand"}
          >
            {showPieceLibrary ? '▼' : '▶'}
          </button>
        </div>

        {showPieceLibrary && (
          <>
            <div className={styles["search-box"]}>
              <input
                type="text"
                placeholder="Search pieces..."
                value={searchPieceTerm}
                onChange={(e) => { setSearchPieceTerm(e.target.value); setPiecePage(1); }}
              />
            </div>

            <div className={styles["player-toggle"]}>
              <span className={styles["toggle-label"]}>Add pieces as:</span>
              <div className={styles["toggle-buttons"]}>
                <button
                  className={`${styles["player-btn"]} ${sidebarPlayerView === 1 ? styles.active : ''}`}
                  onClick={() => setSidebarPlayerView(1)}
                >
                  Player 1
                </button>
                <button
                  className={`${styles["player-btn"]} ${sidebarPlayerView === 2 ? styles.active : ''}`}
                  onClick={() => setSidebarPlayerView(2)}
                >
                  Player 2
                </button>
              </div>
            </div>

            <div className={styles["instructions"]}>
              <p>Drag pieces onto the board to add them.</p>
            </div>

            {piecesLoading ? (
              <div className={styles["loading"]}>Loading pieces...</div>
            ) : (
              <>
              {totalPiecePages > 1 && (() => {
                const cur = piecePage;
                const pageNums = [];
                let start = Math.max(1, cur - 1);
                let end = Math.min(totalPiecePages, start + 2);
                if (end - start < 2) start = Math.max(1, end - 2);
                for (let p = start; p <= end; p++) pageNums.push(p);
                return (
                  <div className={styles["pagination-bar"]}>
                    <button className={styles["page-btn"]} onClick={() => handlePiecePageChange(1)} disabled={cur === 1} title="First page">&laquo;</button>
                    <button className={styles["page-btn"]} onClick={() => handlePiecePageChange(cur - 1)} disabled={cur === 1} title="Previous">&lsaquo;</button>
                    {pageNums.map(p => (
                      <button key={p} className={`${styles["page-btn"]}${p === cur ? ' ' + styles["page-btn-active"] : ''}`} onClick={() => handlePiecePageChange(p)}>{p}</button>
                    ))}
                    <button className={styles["page-btn"]} onClick={() => handlePiecePageChange(cur + 1)} disabled={cur === totalPiecePages} title="Next">&rsaquo;</button>
                    <button className={styles["page-btn"]} onClick={() => handlePiecePageChange(totalPiecePages)} disabled={cur === totalPiecePages} title="Last page">&raquo;</button>
                  </div>
                );
              })()}
              <div className={styles["piece-grid"]}>
                {pagedPieces.map((piece) => {
                  const imageUrl = getPieceImage(piece.image_location, sidebarPlayerView - 1);
                  if (!imageUrl) {
                    console.warn('Missing image for piece:', piece.piece_name, piece);
                  }
                  return (
                  <div
                    key={piece.id || piece.piece_id}
                    className={styles["piece-item"]}
                    draggable
                    onDragStart={(e) => handleLibraryDragStart(e, piece)}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={piece.piece_name}
                        onError={(e) => {
                          console.error('Failed to load image:', imageUrl, 'for piece:', piece.piece_name);
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div style={{ width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a2b3d', borderRadius: '4px', color: '#666', fontSize: '0.7rem' }}>
                        No Image
                      </div>
                    )}
                    <span>{piece.piece_name}</span>
                  </div>
                  );
                })}
              </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Right-click Modal */}
      {renderRightClickModal()}

      {/* Promotion Modal */}
      {promotionPending && (() => {
        const sb = sandboxes.find(s => s.id === promotionPending.sandboxId);
        if (!sb) return null;
        const movedPiece = sb.pieces.find(p => p.id === promotionPending.pieceId);
        const promoterPlayer = movedPiece?.player_id ?? movedPiece?.team ?? 1;
        // Determine promotion candidates. Each candidate carries a
        // promotion_target_player describing which side it becomes when chosen
        // (own side, opponent, or neutral).
        let candidates = [];
        if (movedPiece?.promotion_pieces_override) {
          const entries = normalizePromotionOverride(movedPiece.promotion_pieces_override);
          candidates = entries.map(entry => {
            const full = fullPiecesList.find(p => p.piece_id === entry.id || p.id === entry.id);
            if (!full) return null;
            return { ...full, promotion_target_player: entry.player == null ? promoterPlayer : entry.player };
          }).filter(Boolean);
        }
        if (candidates.length === 0) {
          // Fallback: all pieces from the same game-type (pieces_string), excluding the moved one
          const seen = new Set();
          const gameTypePieces = (() => {
            try {
              const raw = sb.gameType?.pieces_string;
              if (!raw) return [];
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const arr = Array.isArray(parsed) ? parsed : Object.values(parsed);
              return arr.map(p => p.piece_id || p.id).filter(Boolean);
            } catch (_) { return []; }
          })();
          for (const pid of gameTypePieces) {
            if (seen.has(pid)) continue;
            seen.add(pid);
            const full = fullPiecesList.find(p => p.piece_id === pid || p.id === pid);
            if (full && full.piece_id !== movedPiece?.piece_id) candidates.push({ ...full, promotion_target_player: promoterPlayer });
          }
        }
        if (candidates.length === 0) candidates = fullPiecesList.slice(0, 12).map(c => ({ ...c, promotion_target_player: promoterPlayer }));

        const applyPromotion = (chosen) => {
          if (chosen && movedPiece) {
            const targetPlayer = chosen.promotion_target_player != null ? Number(chosen.promotion_target_player) : promoterPlayer;
            const isNeutralTarget = targetPlayer === 0;
            const normalized = {
              ...chosen,
              ratio_movement_1: chosen.ratio_movement_1 || chosen.ratio_one_movement,
              ratio_movement_2: chosen.ratio_movement_2 || chosen.ratio_two_movement,
              ratio_capture_1: chosen.ratio_capture_1 || chosen.ratio_one_capture,
              ratio_capture_2: chosen.ratio_capture_2 || chosen.ratio_two_capture,
            };
            setSandboxes(prev => prev.map(s => {
              if (s.id !== sb.id) return s;
              return {
                ...s,
                pieces: s.pieces.map(p => p.id === movedPiece.id ? {
                  ...p,
                  ...normalized,
                  // Preserve identity / position / instance-state
                  id: p.id,
                  x: p.x,
                  y: p.y,
                  // Ownership follows the chosen promotion target (cross-player
                  // / neutral promotion transfers control).
                  team: isNeutralTarget ? 0 : targetPlayer,
                  player_id: isNeutralTarget ? 0 : targetPlayer,
                  is_neutral: isNeutralTarget,
                  move_count: p.move_count,
                  current_hp: chosen.hit_points ?? p.current_hp,
                  piece_id: chosen.piece_id || chosen.id,
                  piece_name: chosen.piece_name,
                  image_location: chosen.image_location,
                } : p),
              };
            }));
          }
          setPromotionPending(null);
        };

        return (
          <div className={styles["modal-overlay"]} onClick={() => setPromotionPending(null)}>
            <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
              <div className={styles["modal-header"]}>
                <h3>Promote piece</h3>
                <button className={styles["close-button"]} onClick={() => setPromotionPending(null)}>✕</button>
              </div>
              <div style={{ padding: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.5rem' }}>
                {candidates.map(c => {
                  const targetPlayer = c.promotion_target_player != null ? Number(c.promotion_target_player) : promoterPlayer;
                  let imgSrc = '';
                  try {
                    const loc = c.image_location;
                    if (loc) {
                      const parsed = typeof loc === 'string' ? JSON.parse(loc) : loc;
                      if (Array.isArray(parsed) && parsed.length > 0) {
                        const idx = targetPlayer === 0 ? 0 : Math.min(Math.max(0, targetPlayer - 1), parsed.length - 1);
                        const sel = parsed[idx] || parsed[0];
                        imgSrc = sel?.startsWith('http') ? sel : `${ASSET_URL}${sel}`;
                      } else {
                        const first = Array.isArray(parsed) ? parsed[0] : parsed;
                        imgSrc = first?.startsWith('http') ? first : `${ASSET_URL}${first}`;
                      }
                    }
                  } catch (_) { /* ignore */ }
                  const ownerBadge = targetPlayer !== promoterPlayer
                    ? (targetPlayer === 0 ? 'Neutral' : `Player ${targetPlayer}`)
                    : null;
                  return (
                    <button
                      key={`${c.piece_id || c.id}-${targetPlayer}`}
                      onClick={() => applyPromotion(c)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.5rem', background: 'none', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', color: 'inherit' }}
                    >
                      {imgSrc && <img src={imgSrc} alt={c.piece_name} style={{ width: 48, height: 48, objectFit: 'contain' }}
                        onError={(e) => handlePieceImageError(e, c.piece_name, targetPlayer || 1)} />}
                      <span style={{ fontSize: 12, marginTop: 4 }}>{c.piece_name}</span>
                      {ownerBadge && <span style={{ fontSize: 10, marginTop: 2, padding: '1px 5px', borderRadius: 8, background: 'rgba(117,124,252,0.3)' }}>{ownerBadge}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Sandbox;
