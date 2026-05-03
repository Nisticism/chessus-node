/**
 * AI Engine for SquareStrat
 * 
 * Uses minimax with alpha-beta pruning and heuristic evaluation.
 * Works with ANY game variant by reading rules from game state at runtime.
 * No game-specific knowledge is hardcoded.
 */

// Lazy require to avoid circular dependency with game-socket.js
let _gameSocket = null;
function getGameSocket() {
  if (!_gameSocket) _gameSocket = require('../game-socket');
  return _gameSocket;
}

// =============================================
// Constants
// =============================================

const SCORE_WIN = 100000;
const SCORE_LOSS = -100000;
const SCORE_DRAW = 0;

const DIFFICULTY = {
  easy:   { depth: 1, timeLimit: 1000,  randomness: 0.35, thinkDelay: 600, quiescenceDepth: 0 },
  medium: { depth: 4, timeLimit: 8000, randomness: 0.03, thinkDelay: 400, quiescenceDepth: 3 },
  hard:   { depth: 5, timeLimit: 12000, randomness: 0.00, thinkDelay: 200, quiescenceDepth: 5 },
  // Baseline for "adaptive" — should always be at least as strong as
  // hard (we hide it from the UI when no training data exists, so this
  // baseline is only ever reached as a defensive fallback).
  adaptive: { depth: 5, timeLimit: 12000, randomness: 0, thinkDelay: 200, quiescenceDepth: 5 },
};

/**
 * Build per-decision search settings for the "adaptive" difficulty tier.
 * Reads the game type's training metadata at decision time so the bot
 * automatically gets stronger as more training games accumulate.
 *
 * Today the strength scaling comes from search depth + quiescence (the
 * model artifact is a placeholder visit-count blob — see
 * AI_OVERHAUL_PLAN.md). When a real policy/value net or opening book
 * is wired up, this is also where it would attach.
 */
async function resolveAdaptiveSettings(gameTypeId) {
  const base = { ...DIFFICULTY.adaptive };
  if (!gameTypeId) return base;
  let trainingManager;
  try {
    trainingManager = require('./training-manager');
  } catch (_) {
    return base;
  }
  let meta;
  try {
    meta = await trainingManager.getModelMetaForGameType(gameTypeId);
  } catch (_) {
    return base;
  }
  if (!meta || !meta.totalGamesPlayed) return base;
  const games = meta.totalGamesPlayed;
  // Adaptive is gated by the UI on `available: true` (which requires at
  // least some training), so the base case here is already hard-tier.
  // Each milestone adds another ply or quiescence ply.
  let depth = base.depth;
  let quiescenceDepth = base.quiescenceDepth;
  let timeLimit = base.timeLimit;
  if (games >= 100) { depth = 5; quiescenceDepth = 5; }
  if (games >= 500) { depth = 6; quiescenceDepth = 6; timeLimit = 15000; }
  if (games >= 2000) { depth = 7; quiescenceDepth = 7; timeLimit = 20000; }
  return {
    ...base,
    depth,
    quiescenceDepth,
    timeLimit,
    randomness: 0,
    _adaptiveMeta: meta,
  };
}

// =============================================
// Console suppression (game-socket functions log heavily)
// =============================================

// Suppress console.log during AI computation by temporarily replacing it.
// This is safe because minimax is fully synchronous (no awaits or event loop yields).
let _silentDepth = 0;
let _origLog = null;

function silent(fn) {
  if (_silentDepth === 0) {
    _origLog = console.log;
    console.log = () => {};
  }
  _silentDepth++;
  try {
    return fn();
  } finally {
    _silentDepth--;
    if (_silentDepth === 0 && _origLog) {
      console.log = _origLog;
      _origLog = null;
    }
  }
}

// =============================================
// Game State Cloning
// =============================================

/**
 * Fast clone of game state for search simulation.
 * Only clones mutable data; immutable refs (gameType, players) are shared.
 */
function cloneState(state) {
  return {
    pieces: state.pieces.map(p => ({ ...p })),
    currentTurn: state.currentTurn,
    gameType: state.gameType,
    players: state.players,
    moveCount: state.moveCount || 0,
    gamePly: state.gamePly ?? (state.totalHalfMoves || 0),
    movesWithoutCapture: state.movesWithoutCapture || 0,
    enPassantTarget: state.enPassantTarget ? { ...state.enPassantTarget } : null,
    controlSquareTracking: state.controlSquareTracking
      ? JSON.parse(JSON.stringify(state.controlSquareTracking))
      : {},
    lastMovedPieceId: state.lastMovedPieceId || null,
    lastMoveFrom: state.lastMoveFrom || null,
    lastMoveTo: state.lastMoveTo || null,
    moveHistory: state.moveHistory || []
  };
}

// =============================================
// Lightweight Move Application (for search tree)
// =============================================

/**
 * Apply a move to a cloned state. Mutates in place.
 * Handles movement, captures, and HP/AD damage.
 * Returns array of captured pieces for win-condition checking.
 */
function applyMove(state, move) {
  // Placement action: add a new piece to the board, switch turns, no captures.
  if (move.type === 'place' || move.isPlacement) {
    const playerToMove = state.currentTurn;
    const otherData = state.otherGameData || {};
    const placeable = Array.isArray(otherData.placeable_pieces) ? otherData.placeable_pieces : [];
    const template = move.placePieceId != null
      ? placeable.find(pp => pp.piece_id === move.placePieceId) || placeable[0]
      : placeable[0];
    const newId = `placed_${state.moveCount || 0}_${move.to.x}_${move.to.y}`;
    state.pieces.push({
      ...(template || {}),
      id: newId,
      x: move.to.x,
      y: move.to.y,
      team: playerToMove,
      player_id: playerToMove,
      hasMoved: true,
      moveCount: 1,
    });
    state.currentTurn = state.currentTurn === 1 ? 2 : 1;
    state.moveCount = (state.moveCount || 0) + 1;
    state.gamePly = (state.gamePly ?? 0) + 1;
    state.movesWithoutCapture = (state.movesWithoutCapture || 0) + 1;
    return [];
  }
  const piece = state.pieces.find(p => p.id === move.pieceId);
  if (!piece) return [];

  const pieceOwner = piece.team || piece.player_id;
  const pw = piece.piece_width || 1;
  const ph = piece.piece_height || 1;
  const captured = [];

  // Find and handle enemy pieces at destination
  for (let i = state.pieces.length - 1; i >= 0; i--) {
    const target = state.pieces[i];
    if (target.id === piece.id) continue;
    const targetOwner = target.team || target.player_id;
    if (targetOwner === pieceOwner) continue;

    // Check overlap between moving piece destination footprint and target footprint
    const tw = target.piece_width || 1;
    const th = target.piece_height || 1;
    let overlaps = false;
    for (let dy = 0; dy < ph && !overlaps; dy++) {
      for (let dx = 0; dx < pw && !overlaps; dx++) {
        const cx = move.to.x + dx;
        const cy = move.to.y + dy;
        if (cx >= target.x && cx < target.x + tw &&
            cy >= target.y && cy < target.y + th) {
          overlaps = true;
        }
      }
    }

    if (overlaps) {
      const targetHp = target.current_hp ?? target.hit_points ?? 1;
      const attackDmg = piece.attack_damage || 1;
      if (!target.cannot_be_captured && targetHp <= attackDmg) {
        captured.push(state.pieces.splice(i, 1)[0]);
      } else if (!target.cannot_be_captured) {
        // Damage but don't kill
        target.current_hp = (target.current_hp ?? target.hit_points ?? 1) - attackDmg;
      }
    }
  }

  // Move the piece
  piece.x = move.to.x;
  piece.y = move.to.y;
  piece.hasMoved = true;
  piece.moveCount = (piece.moveCount || 0) + 1;

  // Track last moved piece (for same-piece penalty detection)
  state.lastMovedPieceId = move.pieceId;
  state.lastMoveFrom = move.from;
  state.lastMoveTo = move.to;

  // Handle castling (move the partner piece too)
  if (move.to.isCastling && move.to.castlingWith) {
    const rook = state.pieces.find(p => p.id === move.to.castlingWith);
    if (rook) {
      if (move.to.castlingDirection === 'left') {
        rook.x = move.to.x + 1;
      } else {
        rook.x = move.to.x - 1;
      }
      rook.hasMoved = true;
    }
  }

  // Switch turns
  state.currentTurn = state.currentTurn === 1 ? 2 : 1;
  state.moveCount = (state.moveCount || 0) + 1;
  state.gamePly = (state.gamePly ?? 0) + 1;

  if (captured.length > 0) {
    state.movesWithoutCapture = 0;
  } else {
    state.movesWithoutCapture = (state.movesWithoutCapture || 0) + 1;
  }

  return captured;
}

// =============================================
// Terminal State Detection
// =============================================

/**
 * Check if game is over.
 * Returns { over: false } or { over: true, winner: position|null, reason }
 */
function checkTerminal(state, captured = []) {
  const { gameType, players } = state;
  if (!gameType || !players || players.length < 2) return { over: false };

  // Check captured piece flags
  for (const cp of captured) {
    if (cp.ends_game_on_capture || cp.ends_game_on_checkmate) {
      const loserPos = cp.team || cp.player_id;
      const winnerPos = loserPos === 1 ? 2 : 1;
      return { over: true, winner: winnerPos, reason: 'capture' };
    }
  }

  // Check if either player has no pieces (elimination)
  for (const player of players) {
    const count = state.pieces.filter(p =>
      (p.team || p.player_id) === player.position
    ).length;
    if (count === 0) {
      const winnerPos = player.position === 1 ? 2 : 1;
      return { over: true, winner: winnerPos, reason: 'elimination' };
    }
  }

  // Draw by move limit
  if (gameType.draw_move_limit && state.movesWithoutCapture >= gameType.draw_move_limit) {
    return { over: true, winner: null, reason: 'draw' };
  }

  return { over: false };
}

/**
 * Extended terminal check that includes checkmate/stalemate detection.
 * More expensive — only used at shallow depths or for final evaluation.
 */
function checkTerminalFull(state) {
  const basic = checkTerminal(state);
  if (basic.over) return basic;

  if (!state.gameType?.mate_condition) {
    // No mate condition: just check if current player has any moves
    const moves = getMovesForSearch(state, state.currentTurn);
    if (moves.length === 0) {
      return { over: true, winner: null, reason: 'stalemate' };
    }
    return { over: false };
  }

  // Check if current player is in checkmate or stalemate
  const { checkForCheck } = getGameSocket();
  const checkResult = silent(() => checkForCheck(state, state.currentTurn));
  const moves = getMovesForSearch(state, state.currentTurn);

  if (checkResult.inCheck && moves.length === 0) {
    const winnerPos = state.currentTurn === 1 ? 2 : 1;
    return { over: true, winner: winnerPos, reason: 'checkmate' };
  }

  if (!checkResult.inCheck && moves.length === 0) {
    return { over: true, winner: null, reason: 'stalemate' };
  }

  return { over: false };
}

// =============================================
// Move Generation for Search
// =============================================

/**
 * Get moves for search. Reuses game-socket's getPossibleMovesForPiece.
 * Filters for check legality when mate_condition is enabled.
 */
function getMovesForSearch(state, playerPosition) {
  const { getPossibleMovesForPiece, wouldMoveLeaveInCheck } = getGameSocket();
  const playerPieces = state.pieces.filter(p =>
    (p.team || p.player_id) === playerPosition
  );

  const moves = [];
  for (const piece of playerPieces) {
    const possibleMoves = silent(() =>
      getPossibleMovesForPiece(piece, state.pieces, state.gameType, state.gamePly ?? (state.totalHalfMoves || 0))
    );

    for (const toSquare of possibleMoves) {
      const move = {
        pieceId: piece.id,
        from: { x: piece.x, y: piece.y },
        to: toSquare
      };

      if (state.gameType?.mate_condition) {
        const illegal = silent(() =>
          wouldMoveLeaveInCheck(state, move, playerPosition)
        );
        if (!illegal) {
          moves.push(move);
        }
      } else {
        moves.push(move);
      }
    }
  }

  return moves;
}

// =============================================
// Move Ordering (critical for alpha-beta efficiency)
// =============================================

/**
 * Estimate the value of a piece for evaluation and move ordering.
 * Board size is used to scale value of infinite-range pieces on larger boards.
 */
function getPieceValue(piece, boardSize) {
  if (!piece) return 0;
  let value = piece.piece_value || 1;

  // Critical piece flags
  if (piece.ends_game_on_checkmate) value += 1000;
  if (piece.ends_game_on_capture) value += 1000;
  if (piece.can_control_squares) value += 3;

  // Board scale factor: infinite pieces are worth more on larger boards
  const bs = boardSize || 8;
  const boardScale = bs / 8; // 1.0 for standard, 1.5 for 12x12, etc.

  // Mobility proxy from movement AND capture properties
  const moveDirs = [
    'up_movement', 'down_movement', 'left_movement', 'right_movement',
    'up_left_movement', 'up_right_movement', 'down_left_movement', 'down_right_movement'
  ];
  const capDirs = [
    'up_capture', 'down_capture', 'left_capture', 'right_capture',
    'up_left_capture', 'up_right_capture', 'down_left_capture', 'down_right_capture'
  ];

  let moveDirections = 0;
  let hasInfiniteMove = false;
  for (const dir of moveDirs) {
    if (piece[dir] && piece[dir] > 0) {
      moveDirections++;
      if (piece[dir] === 99) {
        hasInfiniteMove = true;
        value += 1.5 * boardScale; // Infinite range scales with board
      } else {
        value += Math.min(piece[dir], 8) * 0.3;
      }
    }
  }

  let captureDirections = 0;
  let hasInfiniteCapture = false;
  for (const dir of capDirs) {
    if (piece[dir] && piece[dir] > 0) {
      captureDirections++;
      if (piece[dir] === 99) {
        hasInfiniteCapture = true;
        value += 1.0 * boardScale;
      } else {
        value += Math.min(piece[dir], 8) * 0.2;
      }
    }
  }

  // Total mobility bonus: more directions = more versatile
  value += moveDirections * 0.5;
  value += captureDirections * 0.3;

  // Bonus for pieces that can both move and capture in many directions
  if (moveDirections >= 4 && captureDirections >= 4) value += 2 * boardScale;

  // Board coverage: cardinal directions let a piece reach every square;
  // diagonal-only pieces are color-bound (can never reach half the board).
  const hasCardinalMove = !!(
    piece.up_movement > 0 || piece.down_movement > 0 ||
    piece.left_movement > 0 || piece.right_movement > 0
  );
  const hasDiagonalMove = !!(
    piece.up_left_movement > 0 || piece.up_right_movement > 0 ||
    piece.down_left_movement > 0 || piece.down_right_movement > 0
  );
  const hasCardinalCap = !!(
    piece.up_capture > 0 || piece.down_capture > 0 ||
    piece.left_capture > 0 || piece.right_capture > 0
  );
  const hasDiagonalCap = !!(
    piece.up_left_capture > 0 || piece.up_right_capture > 0 ||
    piece.down_left_capture > 0 || piece.down_right_capture > 0
  );

  // Full board coverage bonus (can reach any square given enough moves)
  if (hasCardinalMove && hasDiagonalMove) {
    // Queen-like: covers all squares and all angles
    value += 1.5 * boardScale;
  } else if (hasCardinalMove) {
    // Rook-like: covers all squares via two axes
    value += 0.75 * boardScale;
  }
  // Diagonal-only (bishop-like): color-bound — subtract a penalty scaled by
  // how infinite the diagonals are, since the limitation is most costly on
  // long-range sliders that can never switch color.
  if (!hasCardinalMove && !hasCardinalCap && hasDiagonalMove) {
    const infiniteDiagonals = [
      'up_left_movement', 'up_right_movement', 'down_left_movement', 'down_right_movement'
    ].filter(d => piece[d] === 99).length;
    value -= 1.0 + infiniteDiagonals * 0.4;
  }

  if (piece.ratio_movement_1 && piece.ratio_movement_2) value += 2.5 * boardScale;
  if (piece.step_movement_value) value += Math.abs(piece.step_movement_value) * 0.8;
  if (piece.can_capture_enemy_via_range) value += 2;
  if (piece.can_hop_over_allies || piece.can_hop_over_enemies) value += 1;

  // HP scaling
  const hp = piece.current_hp ?? piece.hit_points ?? 1;
  const maxHp = piece.hit_points || 1;
  if (maxHp > 1) value *= (0.5 + 0.5 * hp / maxHp);

  return value;
}

/**
 * Order moves for better alpha-beta pruning.
 * Captures of high-value targets come first, then center moves.
 */
function orderMoves(moves, state) {
  const bw = state.gameType?.board_width || 8;
  const bh = state.gameType?.board_height || 8;
  const bs = Math.max(bw, bh);

  // Build a quick position map for O(1) lookup
  const posMap = new Map();
  for (const p of state.pieces) {
    posMap.set(`${p.x},${p.y}`, p);
  }

  const isPieceCountGame = !!(state.gameType?.piece_count_condition || state.otherGameData?.place_pieces_action);
  moves.sort((a, b) => {
    if (isPieceCountGame) {
      const aPlace = a.type === 'place' ? 1 : 0;
      const bPlace = b.type === 'place' ? 1 : 0;
      if (aPlace !== bPlace) return bPlace - aPlace;
    }
    const targetA = posMap.get(`${a.to.x},${a.to.y}`);
    const targetB = posMap.get(`${b.to.x},${b.to.y}`);

    // Captures before non-captures
    const aCap = targetA ? 1 : 0;
    const bCap = targetB ? 1 : 0;
    if (aCap !== bCap) return bCap - aCap;

    // Among captures, use MVV-LVA: prefer capturing high-value targets with low-value attackers
    if (aCap && bCap) {
      const attackerA = posMap.get(`${a.from.x},${a.from.y}`);
      const attackerB = posMap.get(`${b.from.x},${b.from.y}`);
      const victimValA = getPieceValue(targetA, bs);
      const victimValB = getPieceValue(targetB, bs);
      const attackerValA = attackerA ? getPieceValue(attackerA, bs) : 0;
      const attackerValB = attackerB ? getPieceValue(attackerB, bs) : 0;
      // MVV-LVA: maximize (victim value - attacker value)
      const scoreA = victimValA - attackerValA;
      const scoreB = victimValB - attackerValB;
      return scoreB - scoreA;
    }

    // Among non-captures, prefer moves toward center
    const cx = bw / 2, cy = bh / 2;
    const distA = Math.abs(a.to.x - cx) + Math.abs(a.to.y - cy);
    const distB = Math.abs(b.to.x - cx) + Math.abs(b.to.y - cy);
    return distA - distB;
  });
}

// =============================================
// Heuristic Position Evaluation
// =============================================

/**
 * Evaluate a position from a specific player's perspective.
 * Positive = good for perspective player.
 * 
 * Evaluation factors:
 * - Material advantage (weighted by piece mobility/capabilities, scaled for board size)
 * - Center control (strong weight, encourages controlling the board)
 * - Piece safety (high-value pieces threatened = penalty)
 * - Check awareness (small bonus, only when it leads to advantage)
 * - Development (penalize moving same piece twice when it could have reached target in 1 move)
 * - Hill / control square objectives
 */
function evaluatePosition(state, perspective) {
  const { pieces, gameType } = state;

  // Quick terminal check
  const terminal = checkTerminal(state);
  if (terminal.over) {
    if (terminal.winner === perspective) return SCORE_WIN - state.moveCount;
    if (terminal.winner === null) return SCORE_DRAW;
    return SCORE_LOSS + state.moveCount;
  }

  let score = 0;

  const bw = gameType?.board_width || 8;
  const bh = gameType?.board_height || 8;
  const bs = Math.max(bw, bh);
  const centerX = bw / 2;
  const centerY = bh / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY) || 1;
  const opponentPos = perspective === 1 ? 2 : 1;

  // --- Material ---
  let myMaterial = 0;
  let opponentMaterial = 0;
  const myPieces = [];
  const opPieces = [];
  for (const piece of pieces) {
    const owner = piece.team || piece.player_id;
    const value = getPieceValue(piece, bs);
    if (owner === perspective) {
      myMaterial += value;
      myPieces.push(piece);
    } else {
      opponentMaterial += value;
      opPieces.push(piece);
    }
  }
  score += (myMaterial - opponentMaterial) * 15;

  // --- Piece count ---
  score += (myPieces.length - opPieces.length) * 5;

  // --- Center control (strong weight) ---
  // Award more points for pieces near the center, especially high-value ones
  for (const piece of myPieces) {
    const dist = Math.sqrt(
      Math.pow(piece.x - centerX, 2) + Math.pow(piece.y - centerY, 2)
    );
    const proximity = 1 - dist / maxDist; // 0 to 1
    const pieceImportance = Math.min(getPieceValue(piece, bs), 10) / 10; // normalized
    // Higher value pieces get bigger center bonus
    score += proximity * (4 + pieceImportance * 4);
  }
  for (const piece of opPieces) {
    const dist = Math.sqrt(
      Math.pow(piece.x - centerX, 2) + Math.pow(piece.y - centerY, 2)
    );
    const proximity = 1 - dist / maxDist;
    const pieceImportance = Math.min(getPieceValue(piece, bs), 10) / 10;
    score -= proximity * (4 + pieceImportance * 4);
  }

  // --- Piece safety: penalize pieces that can be captured by lower-value enemies ---
  // Build position map for fast lookup of what's on each square
  const pieceAtSquare = new Map();
  for (const p of pieces) {
    const pw = p.piece_width || 1;
    const ph = p.piece_height || 1;
    for (let dy = 0; dy < ph; dy++) {
      for (let dx = 0; dx < pw; dx++) {
        pieceAtSquare.set(`${p.x + dx},${p.y + dy}`, p);
      }
    }
  }
  
  // For each opponent piece, look at what they could plausibly threaten
  // using their movement/capture directions (fast approximation)
  // Map: threatened piece id -> minimum attacker value (for exchange evaluation)
  const threatenedByOpponent = new Map();
  for (const opPiece of opPieces) {
    const opAttackerValue = getPieceValue(opPiece, bs);
    const capDirs = [];
    // Collect capture directions with their range
    if (opPiece.up_capture) capDirs.push([0, -1, opPiece.up_capture]);
    if (opPiece.down_capture) capDirs.push([0, 1, opPiece.down_capture]);
    if (opPiece.left_capture) capDirs.push([-1, 0, opPiece.left_capture]);
    if (opPiece.right_capture) capDirs.push([1, 0, opPiece.right_capture]);
    if (opPiece.up_left_capture) capDirs.push([-1, -1, opPiece.up_left_capture]);
    if (opPiece.up_right_capture) capDirs.push([1, -1, opPiece.up_right_capture]);
    if (opPiece.down_left_capture) capDirs.push([-1, 1, opPiece.down_left_capture]);
    if (opPiece.down_right_capture) capDirs.push([1, 1, opPiece.down_right_capture]);
    // If attacks_like_movement, also use movement directions
    if (opPiece.can_capture_enemy_on_move || opPiece.attacks_like_movement) {
      if (opPiece.up_movement && !opPiece.up_capture) capDirs.push([0, -1, opPiece.up_movement]);
      if (opPiece.down_movement && !opPiece.down_capture) capDirs.push([0, 1, opPiece.down_movement]);
      if (opPiece.left_movement && !opPiece.left_capture) capDirs.push([-1, 0, opPiece.left_movement]);
      if (opPiece.right_movement && !opPiece.right_capture) capDirs.push([1, 0, opPiece.right_movement]);
      if (opPiece.up_left_movement && !opPiece.up_left_capture) capDirs.push([-1, -1, opPiece.up_left_movement]);
      if (opPiece.up_right_movement && !opPiece.up_right_capture) capDirs.push([1, -1, opPiece.up_right_movement]);
      if (opPiece.down_left_movement && !opPiece.down_left_capture) capDirs.push([-1, 1, opPiece.down_left_movement]);
      if (opPiece.down_right_movement && !opPiece.down_right_capture) capDirs.push([1, 1, opPiece.down_right_movement]);
    }
    // Flip directions for player 2
    const opOwner = opPiece.team || opPiece.player_id;
    const flipY = opOwner === 2 ? -1 : 1;
    
    for (const [ddx, ddy, range] of capDirs) {
      const limit = range === 99 ? Math.max(bw, bh) : Math.min(range, Math.max(bw, bh));
      const dy = ddy * flipY;
      for (let dist = 1; dist <= limit; dist++) {
        const tx = opPiece.x + ddx * dist;
        const ty = opPiece.y + dy * dist;
        if (tx < 0 || tx >= bw || ty < 0 || ty >= bh) break;
        const target = pieceAtSquare.get(`${tx},${ty}`);
        if (target) {
          const targetOwner = target.team || target.player_id;
          if (targetOwner === perspective) {
            const existing = threatenedByOpponent.get(target.id);
            if (existing === undefined || opAttackerValue < existing) {
              threatenedByOpponent.set(target.id, opAttackerValue);
            }
          }
          // Path blocked (unless hopping)
          if (!opPiece.can_hop_over_allies && !opPiece.can_hop_over_enemies && !opPiece.ghostwalk) break;
        }
      }
    }
    // Ratio captures (knight-like)
    const rc1 = opPiece.ratio_capture_1 || opPiece.ratio_movement_1 || 0;
    const rc2 = opPiece.ratio_capture_2 || opPiece.ratio_movement_2 || 0;
    if (rc1 > 0 && rc2 > 0) {
      const jumps = [
        [rc1, rc2], [rc1, -rc2], [-rc1, rc2], [-rc1, -rc2],
        [rc2, rc1], [rc2, -rc1], [-rc2, rc1], [-rc2, -rc1]
      ];
      for (const [jdx, jdy] of jumps) {
        const tx = opPiece.x + jdx;
        const ty = opPiece.y + jdy;
        if (tx >= 0 && tx < bw && ty >= 0 && ty < bh) {
          const target = pieceAtSquare.get(`${tx},${ty}`);
          if (target && (target.team || target.player_id) === perspective) {
            const existing = threatenedByOpponent.get(target.id);
            if (existing === undefined || opAttackerValue < existing) {
              threatenedByOpponent.set(target.id, opAttackerValue);
            }
          }
        }
      }
    }
  }
  
  // Penalize our threatened pieces heavily
  // Also check if the piece is defended (another friendly piece can recapture)
  for (const myPiece of myPieces) {
    if (!threatenedByOpponent.has(myPiece.id)) continue;
    const myValue = getPieceValue(myPiece, bs);
    if (myPiece.is_royal || myPiece.ends_game_on_capture || myPiece.ends_game_on_checkmate) {
      score -= 60; // Royal piece under attack
    } else {
      // Check if the piece is defended by any ally
      let isDefended = false;
      for (const ally of myPieces) {
        if (ally.id === myPiece.id) continue;
        // Quick check: can this ally reach the threatened piece's square?
        const adx = Math.abs(ally.x - myPiece.x);
        const ady = Math.abs(ally.y - myPiece.y);
        // Ratio movement (knight-like) defense
        const ar1 = ally.ratio_capture_1 || ally.ratio_movement_1 || 0;
        const ar2 = ally.ratio_capture_2 || ally.ratio_movement_2 || 0;
        if (ar1 > 0 && ar2 > 0) {
          if ((adx === ar1 && ady === ar2) || (adx === ar2 && ady === ar1)) {
            isDefended = true; break;
          }
        }
        // Directional defense (1-square check for simplicity)
        if (adx <= 1 && ady <= 1 && (adx + ady) > 0) {
          // Check if ally has a capture direction covering that offset
          const hasCap = ally.up_capture || ally.down_capture || ally.left_capture ||
            ally.right_capture || ally.up_left_capture || ally.up_right_capture ||
            ally.down_left_capture || ally.down_right_capture ||
            ally.can_capture_enemy_on_move;
          if (hasCap) { isDefended = true; break; }
        }
      }
      if (isDefended) {
        // Defended: evaluate the exchange quality
        // If attacker is lower value, we lose the value difference in a trade
        const attackerValue = threatenedByOpponent.get(myPiece.id) || 0;
        const exchangeLoss = myValue - attackerValue;
        if (exchangeLoss > 0) {
          // Bad trade — we'd lose more material. Penalize proportional to loss.
          score -= exchangeLoss * 8 + myValue * 2;
        } else {
          // Favorable or equal trade — mild penalty for being under attack
          score -= myValue * 2;
        }
      } else {
        // Undefended piece under attack — very severe
        score -= myValue * 12;
      }
    }
  }
  
  // Repeat for our attacks on opponent
  // Map: threatened piece id -> minimum attacker value (for exchange evaluation)
  const threatenedByUs = new Map();
  for (const myPiece of myPieces) {
    const myAttackerValue = getPieceValue(myPiece, bs);
    const capDirs = [];
    if (myPiece.up_capture) capDirs.push([0, -1, myPiece.up_capture]);
    if (myPiece.down_capture) capDirs.push([0, 1, myPiece.down_capture]);
    if (myPiece.left_capture) capDirs.push([-1, 0, myPiece.left_capture]);
    if (myPiece.right_capture) capDirs.push([1, 0, myPiece.right_capture]);
    if (myPiece.up_left_capture) capDirs.push([-1, -1, myPiece.up_left_capture]);
    if (myPiece.up_right_capture) capDirs.push([1, -1, myPiece.up_right_capture]);
    if (myPiece.down_left_capture) capDirs.push([-1, 1, myPiece.down_left_capture]);
    if (myPiece.down_right_capture) capDirs.push([1, 1, myPiece.down_right_capture]);
    if (myPiece.can_capture_enemy_on_move || myPiece.attacks_like_movement) {
      if (myPiece.up_movement && !myPiece.up_capture) capDirs.push([0, -1, myPiece.up_movement]);
      if (myPiece.down_movement && !myPiece.down_capture) capDirs.push([0, 1, myPiece.down_movement]);
      if (myPiece.left_movement && !myPiece.left_capture) capDirs.push([-1, 0, myPiece.left_movement]);
      if (myPiece.right_movement && !myPiece.right_capture) capDirs.push([1, 0, myPiece.right_movement]);
      if (myPiece.up_left_movement && !myPiece.up_left_capture) capDirs.push([-1, -1, myPiece.up_left_movement]);
      if (myPiece.up_right_movement && !myPiece.up_right_capture) capDirs.push([1, -1, myPiece.up_right_movement]);
      if (myPiece.down_left_movement && !myPiece.down_left_capture) capDirs.push([-1, 1, myPiece.down_left_movement]);
      if (myPiece.down_right_movement && !myPiece.down_right_capture) capDirs.push([1, 1, myPiece.down_right_movement]);
    }
    const myOwner = myPiece.team || myPiece.player_id;
    const flipY = myOwner === 2 ? -1 : 1;
    
    for (const [ddx, ddy, range] of capDirs) {
      const limit = range === 99 ? Math.max(bw, bh) : Math.min(range, Math.max(bw, bh));
      const dy = ddy * flipY;
      for (let dist = 1; dist <= limit; dist++) {
        const tx = myPiece.x + ddx * dist;
        const ty = myPiece.y + dy * dist;
        if (tx < 0 || tx >= bw || ty < 0 || ty >= bh) break;
        const target = pieceAtSquare.get(`${tx},${ty}`);
        if (target) {
          const targetOwner = target.team || target.player_id;
          if (targetOwner === opponentPos) {
            const existing = threatenedByUs.get(target.id);
            if (existing === undefined || myAttackerValue < existing) {
              threatenedByUs.set(target.id, myAttackerValue);
            }
          }
          if (!myPiece.can_hop_over_allies && !myPiece.can_hop_over_enemies && !myPiece.ghostwalk) break;
        }
      }
    }
    const rc1 = myPiece.ratio_capture_1 || myPiece.ratio_movement_1 || 0;
    const rc2 = myPiece.ratio_capture_2 || myPiece.ratio_movement_2 || 0;
    if (rc1 > 0 && rc2 > 0) {
      const jumps = [
        [rc1, rc2], [rc1, -rc2], [-rc1, rc2], [-rc1, -rc2],
        [rc2, rc1], [rc2, -rc1], [-rc2, rc1], [-rc2, -rc1]
      ];
      for (const [jdx, jdy] of jumps) {
        const tx = myPiece.x + jdx;
        const ty = myPiece.y + jdy;
        if (tx >= 0 && tx < bw && ty >= 0 && ty < bh) {
          const target = pieceAtSquare.get(`${tx},${ty}`);
          if (target && (target.team || target.player_id) === opponentPos) {
            const existing = threatenedByUs.get(target.id);
            if (existing === undefined || myAttackerValue < existing) {
              threatenedByUs.set(target.id, myAttackerValue);
            }
          }
        }
      }
    }
  }
  
  // Bonus for threatening opponent pieces
  for (const opPiece of opPieces) {
    if (!threatenedByUs.has(opPiece.id)) continue;
    const opValue = getPieceValue(opPiece, bs);
    if (opPiece.is_royal || opPiece.ends_game_on_capture || opPiece.ends_game_on_checkmate) {
      score += 30;
    } else {
      // Factor in exchange quality: trading a low-value piece for a high-value one is great
      const ourAttackerValue = threatenedByUs.get(opPiece.id) || 0;
      const tradeAdvantage = opValue - ourAttackerValue;
      if (tradeAdvantage > 0) {
        // We can trade up — big bonus proportional to the gain
        score += opValue * 2 + tradeAdvantage * 6;
      } else {
        score += opValue * 2;
      }
    }
  }

  // --- Development: penalize moving same piece consecutively with no capture ---
  if (state.lastMovedPieceId && state.movesWithoutCapture > 0) {
    const lastPiece = pieces.find(p => p.id === state.lastMovedPieceId);
    if (lastPiece && lastPiece.moveCount >= 2) {
      const lastOwner = lastPiece.team || lastPiece.player_id;
      const pValue = getPieceValue(lastPiece, bs);
      // Stronger penalty for low-value pieces (pawns shuffling), smaller for high-value
      const penalty = pValue < 5 ? 8 : 4;
      score += (lastOwner === perspective ? -penalty : penalty);
    }
  }

  // --- Back-and-forth detection: penalize pieces returning to recent positions ---
  if (state.lastMovedPieceId && state.lastMoveFrom && state.lastMoveTo) {
    const lastPiece = pieces.find(p => p.id === state.lastMovedPieceId);
    if (lastPiece) {
      const lastOwner = lastPiece.team || lastPiece.player_id;
      // Check if the piece just moved back to where it came from
      if (lastPiece.x === state.lastMoveFrom.x && lastPiece.y === state.lastMoveFrom.y) {
        score += (lastOwner === perspective ? -12 : 12);
      }
    }
  }

  // --- Hill condition awareness ---
  if (gameType?.hill_condition && gameType.hill_x != null && gameType.hill_y != null) {
    for (const piece of pieces) {
      const owner = piece.team || piece.player_id;
      const dist = Math.abs(piece.x - gameType.hill_x) + Math.abs(piece.y - gameType.hill_y);
      if (dist === 0) score += (owner === perspective ? 50 : -50);
      else if (dist <= 2) score += (owner === perspective ? 10 : -10);
    }
  }

  // --- Control square awareness ---
  if (gameType?.control_squares_string) {
    try {
      const controlSquares = JSON.parse(gameType.control_squares_string);
      for (const key of Object.keys(controlSquares)) {
        const [x, y] = key.split(',').map(Number);
        const occupant = pieces.find(p => p.x === x && p.y === y);
        if (occupant) {
          const owner = occupant.team || occupant.player_id;
          score += (owner === perspective ? 30 : -30);
        }
      }
    } catch (e) { /* ignore */ }
  }

  // --- Check awareness (reduced weight — only valuable when it restricts opponent) ---
  // Checking the opponent is worth a small bonus, but not enough to drive bad trades.
  // Being in check yourself is penalized more heavily.
  // Checkmate threats are penalized/rewarded very heavily to ensure the AI prevents them.
  if (gameType?.mate_condition) {
    const { checkForCheck } = getGameSocket();

    const opponentCheck = silent(() => checkForCheck(state, opponentPos));
    if (opponentCheck.inCheck) {
      // Check if this is actually checkmate for the opponent
      const opMoves = getMovesForSearch(state, opponentPos);
      if (opMoves.length === 0) {
        score += SCORE_WIN / 2; // Near-win: opponent is in checkmate
      } else {
        score += 8;
        // Fewer escape moves = stronger check
        if (opMoves.length <= 2) score += 10;
      }
    }

    const myCheck = silent(() => checkForCheck(state, perspective));
    if (myCheck.inCheck) {
      // Check if we're actually in checkmate
      const myMoves = getMovesForSearch(state, perspective);
      if (myMoves.length === 0) {
        score += SCORE_LOSS / 2; // Near-loss: we're in checkmate
      } else {
        score -= 15;
        // Fewer escape moves = more dangerous
        if (myMoves.length <= 2) score -= 15;
      }
    }

    // Detect opponent's checkmate-in-1 threat: if it were the opponent's turn,
    // could they deliver checkmate? This catches positions where the opponent
    // threatens forced mate that the search depth might not fully explore.
    if (!myCheck.inCheck && state.currentTurn === perspective) {
      // Simulate it being the opponent's turn and check if any move mates
      const simState = { ...state, currentTurn: opponentPos };
      const oppMoves = silent(() => getMovesForSearch(simState, opponentPos));
      let mateThreats = 0;
      for (let i = 0; i < oppMoves.length; i++) {
        if (mateThreats >= 3) break; // Found enough threats
        const om = oppMoves[i];
        const child = cloneState(simState);
        applyMove(child, om);
        const childCheck = silent(() => checkForCheck(child, perspective));
        if (childCheck.inCheck) {
          const escapes = silent(() => getMovesForSearch(child, perspective));
          if (escapes.length === 0) {
            mateThreats++;
          }
        }
      }
      if (mateThreats >= 3) {
        score -= 500; // Multiple mate threats — extremely dangerous
      } else if (mateThreats >= 2) {
        score -= 300; // Two mate threats — very dangerous
      } else if (mateThreats >= 1) {
        score -= 120; // Single mate threat — must address
      }
    }
  }

  // --- Royal piece pawn-shield bonus ---
  // Reward having friendly pieces immediately adjacent to royal pieces (defenders).
  // Threat detection is handled by the ray-casting section above.
  for (const myPiece of myPieces) {
    if (!myPiece.is_royal && !myPiece.ends_game_on_capture && !myPiece.ends_game_on_checkmate) continue;
    let nearbyAllies = 0;
    for (const ally of myPieces) {
      if (ally.id === myPiece.id) continue;
      const dx = Math.abs(ally.x - myPiece.x);
      const dy = Math.abs(ally.y - myPiece.y);
      if (dx <= 1 && dy <= 1) nearbyAllies++;
    }
    score += nearbyAllies * 3;
  }
  for (const opPiece of opPieces) {
    if (!opPiece.is_royal && !opPiece.ends_game_on_capture && !opPiece.ends_game_on_checkmate) continue;
    let nearbyAllies = 0;
    for (const ally of opPieces) {
      if (ally.id === opPiece.id) continue;
      const dx = Math.abs(ally.x - opPiece.x);
      const dy = Math.abs(ally.y - opPiece.y);
      if (dx <= 1 && dy <= 1) nearbyAllies++;
    }
    score -= nearbyAllies * 3;
  }

  // --- Forward development bonus ---
  // Encourage advancing pieces (especially pawns/low-value) toward the opponent's side.
  // Also give small mobility bonus from the threat sets already computed.
  score += threatenedByUs.size * 1.5;    // More squares we threaten = better mobility
  score -= threatenedByOpponent.size * 1.5;

  // --- Pawn promotion incentive ---
  // Reward promotable pieces for advancing toward promotion squares.
  // Bonus scales with proximity; extra bonus if the path is clear.
  if (gameType?.promotion_squares_string) {
    let promoSquares = null;
    try { promoSquares = JSON.parse(gameType.promotion_squares_string); } catch {}
    if (promoSquares && typeof promoSquares === 'object') {
      const promoCoords = Object.keys(promoSquares).map(k => {
        const [py, px] = k.split(',').map(Number);
        return { x: px, y: py };
      });

      if (promoCoords.length > 0) {
        const maxBoardDist = bw + bh;
        for (const myPiece of myPieces) {
          if (!myPiece.can_promote) continue;
          let minDist = maxBoardDist;
          for (const sq of promoCoords) {
            const d = Math.abs(myPiece.x - sq.x) + Math.abs(myPiece.y - sq.y);
            if (d < minDist) minDist = d;
          }
          // Scale: the closer, the higher the bonus (max ~15 when 1 step away)
          const proximityBonus = Math.max(0, (maxBoardDist - minDist) / maxBoardDist) * 8;
          score += proximityBonus;

          // Extra bonus if the file ahead is clear (no blocking pieces)
          if (minDist > 0) {
            const targetPromo = promoCoords.reduce((best, sq) => {
              const d = Math.abs(myPiece.x - sq.x) + Math.abs(myPiece.y - sq.y);
              return d < best.d ? { sq, d } : best;
            }, { sq: null, d: maxBoardDist });
            if (targetPromo.sq && myPiece.x === targetPromo.sq.x) {
              // Same file — check if path is clear
              const dy = targetPromo.sq.y > myPiece.y ? 1 : -1;
              let pathClear = true;
              for (let cy = myPiece.y + dy; cy !== targetPromo.sq.y; cy += dy) {
                if (pieces.some(p => p.x === myPiece.x && p.y === cy && !p.captured)) {
                  pathClear = false;
                  break;
                }
              }
              if (pathClear) score += 6;
            }
          }
        }
        for (const opPiece of opPieces) {
          if (!opPiece.can_promote) continue;
          let minDist = maxBoardDist;
          for (const sq of promoCoords) {
            const d = Math.abs(opPiece.x - sq.x) + Math.abs(opPiece.y - sq.y);
            if (d < minDist) minDist = d;
          }
          const proximityBonus = Math.max(0, (maxBoardDist - minDist) / maxBoardDist) * 8;
          score -= proximityBonus;
          if (minDist > 0) {
            const targetPromo = promoCoords.reduce((best, sq) => {
              const d = Math.abs(opPiece.x - sq.x) + Math.abs(opPiece.y - sq.y);
              return d < best.d ? { sq, d } : best;
            }, { sq: null, d: maxBoardDist });
            if (targetPromo.sq && opPiece.x === targetPromo.sq.x) {
              const dy = targetPromo.sq.y > opPiece.y ? 1 : -1;
              let pathClear = true;
              for (let cy = opPiece.y + dy; cy !== targetPromo.sq.y; cy += dy) {
                if (pieces.some(p => p.x === opPiece.x && p.y === cy && !p.captured)) {
                  pathClear = false;
                  break;
                }
              }
              if (pathClear) score -= 6;
            }
          }
        }
      }
    }
  }

  // --- Opening development: penalize unmoved minor/pawn pieces in early game ---
  // Encourage moving different pieces rather than shuffling the same few
  const totalMoves = state.moveCount || 0;
  if (totalMoves < 20) {
    const openingWeight = Math.max(0, (20 - totalMoves) / 20);
    for (const myPiece of myPieces) {
      if (myPiece.ends_game_on_checkmate || myPiece.ends_game_on_capture || myPiece.is_royal) continue;
      const pValue = getPieceValue(myPiece, bs);
      if (pValue > 20) continue; // Skip very high-value pieces
      if (!myPiece.hasMoved && (myPiece.moveCount || 0) === 0) {
        // Undeveloped piece penalty: stronger in early game
        score -= 3 * openingWeight;
      }
      // Bonus for pawns that advanced 2 squares in the opening (controlling center better)
      if (myPiece.can_promote && (myPiece.moveCount || 0) === 1 && myPiece.hasMoved) {
        const startRow = perspective === 1 ? bh - 2 : 1;
        const distFromStart = Math.abs(myPiece.y - startRow);
        if (distFromStart >= 2) {
          score += 4 * openingWeight; // Double-pushed pawn bonus
        }
      }
    }
    for (const opPiece of opPieces) {
      if (opPiece.ends_game_on_checkmate || opPiece.ends_game_on_capture || opPiece.is_royal) continue;
      const pValue = getPieceValue(opPiece, bs);
      if (pValue > 20) continue;
      if (!opPiece.hasMoved && (opPiece.moveCount || 0) === 0) {
        score += 3 * openingWeight;
      }
      if (opPiece.can_promote && (opPiece.moveCount || 0) === 1 && opPiece.hasMoved) {
        const startRow = opponentPos === 1 ? bh - 2 : 1;
        const distFromStart = Math.abs(opPiece.y - startRow);
        if (distFromStart >= 2) {
          score -= 4 * openingWeight;
        }
      }
    }
  }

  return score;
}

// =============================================
// Quiescence Search
// =============================================

/**
 * Quiescence search: at leaf nodes, continue searching capture moves
 * to avoid the "horizon effect" where the engine pushes bad consequences
 * just past its search depth (e.g. not seeing a recapture).
 */
function quiescence(state, alpha, beta, perspective, startTime, timeLimit, qDepth) {
  if (Date.now() - startTime > timeLimit) {
    return { score: evaluatePosition(state, perspective), timedOut: true };
  }

  const standPat = evaluatePosition(state, perspective);

  // Stand-pat: the player can choose not to capture (their position is already this good)
  const maximizing = state.currentTurn === perspective;
  if (maximizing) {
    if (standPat >= beta) return { score: beta };
    if (standPat > alpha) alpha = standPat;
  } else {
    if (standPat <= alpha) return { score: alpha };
    if (standPat < beta) beta = standPat;
  }

  if (qDepth <= 0) return { score: standPat };

  // Generate only capture moves
  const allMoves = getMovesForSearch(state, state.currentTurn);
  const posMap = new Map();
  for (const p of state.pieces) {
    const pw = p.piece_width || 1;
    const ph = p.piece_height || 1;
    for (let dy = 0; dy < ph; dy++) {
      for (let dx = 0; dx < pw; dx++) {
        posMap.set(`${p.x + dx},${p.y + dy}`, p);
      }
    }
  }

  const currentPlayer = state.currentTurn;
  const captureMoves = allMoves.filter(m => {
    const target = posMap.get(`${m.to.x},${m.to.y}`);
    return target && (target.team || target.player_id) !== currentPlayer;
  });

  if (captureMoves.length === 0) return { score: standPat };

  orderMoves(captureMoves, state);

  if (maximizing) {
    let maxScore = standPat;
    for (const move of captureMoves) {
      const child = cloneState(state);
      applyMove(child, move);
      const result = quiescence(child, alpha, beta, perspective, startTime, timeLimit, qDepth - 1);
      if (result.timedOut) return { score: maxScore, timedOut: true };
      if (result.score > maxScore) maxScore = result.score;
      alpha = Math.max(alpha, result.score);
      if (beta <= alpha) break;
    }
    return { score: maxScore };
  } else {
    let minScore = standPat;
    for (const move of captureMoves) {
      const child = cloneState(state);
      applyMove(child, move);
      const result = quiescence(child, alpha, beta, perspective, startTime, timeLimit, qDepth - 1);
      if (result.timedOut) return { score: minScore, timedOut: true };
      if (result.score < minScore) minScore = result.score;
      beta = Math.min(beta, result.score);
      if (beta <= alpha) break;
    }
    return { score: minScore };
  }
}

// =============================================
// Minimax with Alpha-Beta Pruning
// =============================================

/**
 * Minimax search with alpha-beta pruning.
 * @returns {{ score: number, timedOut?: boolean }}
 */
function minimax(state, depth, alpha, beta, maximizing, perspective, startTime, timeLimit, qDepth) {
  // Time check
  if (Date.now() - startTime > timeLimit) {
    return { score: evaluatePosition(state, perspective), timedOut: true };
  }

  // Leaf node: use quiescence search if available, otherwise static eval
  if (depth === 0) {
    if (qDepth > 0) {
      return quiescence(state, alpha, beta, perspective, startTime, timeLimit, qDepth);
    }
    return { score: evaluatePosition(state, perspective) };
  }

  // Terminal state check
  const terminal = checkTerminal(state);
  if (terminal.over) {
    if (terminal.winner === perspective) return { score: SCORE_WIN - state.moveCount };
    if (terminal.winner === null) return { score: SCORE_DRAW };
    return { score: SCORE_LOSS + state.moveCount };
  }

  // Generate and order moves
  const moves = getMovesForSearch(state, state.currentTurn);
  if (moves.length === 0) {
    // No moves: stalemate or checkmate depending on check status
    if (state.gameType?.mate_condition) {
      const { checkForCheck } = getGameSocket();
      const inCheck = silent(() => checkForCheck(state, state.currentTurn)).inCheck;
      if (inCheck) {
        // Checkmate
        const isMyCheckmate = state.currentTurn === perspective;
        return { score: isMyCheckmate ? SCORE_LOSS + state.moveCount : SCORE_WIN - state.moveCount };
      }
    }
    return { score: SCORE_DRAW }; // Stalemate
  }

  orderMoves(moves, state);

  if (maximizing) {
    let maxScore = -Infinity;
    for (const move of moves) {
      const child = cloneState(state);
      applyMove(child, move);

      const result = minimax(child, depth - 1, alpha, beta, false, perspective, startTime, timeLimit, qDepth);
      if (result.timedOut) return { score: maxScore !== -Infinity ? maxScore : 0, timedOut: true };

      if (result.score > maxScore) maxScore = result.score;
      alpha = Math.max(alpha, result.score);
      if (beta <= alpha) break; // Beta cutoff
    }
    return { score: maxScore };
  } else {
    let minScore = Infinity;
    for (const move of moves) {
      const child = cloneState(state);
      applyMove(child, move);

      const result = minimax(child, depth - 1, alpha, beta, true, perspective, startTime, timeLimit, qDepth);
      if (result.timedOut) return { score: minScore !== Infinity ? minScore : 0, timedOut: true };

      if (result.score < minScore) minScore = result.score;
      beta = Math.min(beta, result.score);
      if (beta <= alpha) break; // Alpha cutoff
    }
    return { score: minScore };
  }
}

// =============================================
// Top-Level API
// =============================================

/**
 * Get the best move for a bot player.
 * 
 * @param {Object} gameState - Current game state (from activeGames)
 * @param {number} botPosition - Bot's player position (1 or 2)
 * @param {string} difficulty - 'easy', 'medium', or 'hard'
 * @returns {Object|null} - Best move { pieceId, from, to } or null if no moves
 */
function getBestMove(gameState, botPosition, difficulty = 'medium') {
  // Adaptive difficulty needs to look up training metadata at decision time,
  // which is async. Return a Promise in that case; the single caller in
  // game-socket.js awaits the result.
  if (difficulty === 'adaptive') {
    const gtid = gameState?.gameTypeId
      ?? gameState?.gameType?.id
      ?? gameState?.gameType?.game_type_id
      ?? null;
    return resolveAdaptiveSettings(gtid).then(async (settings) => {
      // Phase 1 model consumption: try the opening book before falling
      // back to minimax. Only consults book inside its ply window.
      const bookMove = await tryOpeningBook(gtid, gameState, botPosition);
      if (bookMove) {
        console.log(
          `[AI] Adaptive: opening-book move chosen (W/L/D = ${bookMove._book.w}/${bookMove._book.l}/${bookMove._book.d}, winRate=${bookMove._book.winRate.toFixed(2)})`,
        );
        return bookMove;
      }
      // Phase 2: MCTS inference via Rust engine.
      // Gate on 50+ recorded games so the policy has meaningful training data
      // before paying the process-spawn overhead on every turn.
      if (settings._adaptiveMeta && settings._adaptiveMeta.totalGamesPlayed >= 50) {
        try {
          const rustMove = await tryRustEngine(gtid, gameState, botPosition);
          if (rustMove) {
            console.log('[AI] Adaptive: Rust MCTS move chosen');
            return rustMove;
          }
        } catch (e) {
          console.warn('[adaptive] Rust engine error:', e.message);
        }
      }
      return getBestMoveSync(gameState, botPosition, difficulty, settings);
    });
  }
  return getBestMoveSync(gameState, botPosition, difficulty, null);
}

/**
 * Try to pick a move from the opening book for the current position.
 * Returns a legal-move object (with `_book` metadata attached) or null.
 *
 * Async because in REMOTE_MODE the book is fetched over HTTP from the
 * trainer-service; locally it hits the filesystem (still async for a
 * single code path).
 */
async function tryOpeningBook(gameTypeId, gameState, botPosition) {
  if (!gameTypeId) return null;
  let book;
  try {
    book = require('./opening-book');
  } catch (_) {
    return null;
  }
  const legalMoves = silent(() => {
    const { getAllLegalMovesForPlayer } = getGameSocket();
    return getAllLegalMovesForPlayer(gameState, botPosition);
  });
  if (!legalMoves || legalMoves.length === 0) return null;
  let doc;
  try {
    doc = await book.loadBook(gameTypeId);
  } catch (_) {
    return null;
  }
  if (!doc) return null;
  const lookup = book.lookupBookMove(doc, gameState, botPosition);
  if (!lookup) return null;
  const matched = book.matchBookMove(legalMoves, lookup.moveString);
  if (!matched) return null;
  matched._book = lookup;
  return matched;
}

/**
 * Run the Rust MCTS engine as a child process and translate its move back
 * to the JS live-game format.  Returns a legal-move object or null on any
 * failure (binary missing, timeout, illegal move, etc.).
 */
async function tryRustEngine(gameTypeId, gameState, botPosition) {
  if (!gameTypeId) return null;
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');

  const binaryPath = path.resolve(__dirname, '../../ai-engine-rs/target/release/ai-engine.exe');
  const rulesPath = path.resolve(__dirname, `../../ai-training/${gameTypeId}/rules.json`);
  if (!fs.existsSync(binaryPath) || !fs.existsSync(rulesPath)) return null;

  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  } catch (_) {
    return null;
  }

  // Map real_piece_id (DB) → virtual template id used inside the Rust engine.
  const realToVirtual = new Map();
  for (const t of (rules.pieces || [])) {
    realToVirtual.set(t.real_piece_id, t.id);
  }

  // Build Rust board pieces, tracking Rust instance id → JS piece id.
  const livePieces = gameState.pieces || [];
  const instanceToJsId = new Map();
  let nextId = 1;
  const rustPieces = [];
  for (const p of livePieces) {
    const templateId = realToVirtual.get(p.piece_id);
    if (templateId == null) continue; // unrecognized piece type — skip
    const instanceId = nextId++;
    instanceToJsId.set(instanceId, p.id);
    rustPieces.push({
      id: instanceId,
      piece_id: templateId,
      player: p.player_id ?? p.team ?? p.player_number ?? 1,
      x: p.x,
      y: p.y,
      move_count: p.moveCount ?? p.move_count ?? 0,
      has_moved: !!(p.hasMoved ?? p.has_moved ?? (p.moveCount > 0)),
    });
  }
  if (rustPieces.length === 0) return null;

  const boardJson = JSON.stringify({
    width: gameState.gameType?.board_width || 8,
    height: gameState.gameType?.board_height || 8,
    pieces: rustPieces,
    turn: gameState.currentTurn ?? botPosition ?? 1,
    plies_since_capture: gameState.movesWithoutCapture ?? 0,
    ply: gameState.moveCount ?? 0,
    next_id: nextId,
    control_half_turns: [0, 0],
  });

  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    let child;
    try {
      child = spawn(binaryPath, ['play', '--rules', rulesPath, '--mcts-iters', '400'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      console.warn('[adaptive] Rust engine spawn failed:', e.message);
      return done(null);
    }

    const timeoutHandle = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      done(null);
    }, 5000);

    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.on('close', () => {
      clearTimeout(timeoutHandle);
      try {
        const line = output.trim().split('\n')[0];
        if (!line) return done(null);
        const mv = JSON.parse(line);
        if (!mv || mv.error) return done(null);

        const jsId = instanceToJsId.get(mv.piece_id);
        if (!jsId) return done(null);

        // Match against the JS legal-move list so the returned object carries
        // the full JS format (isCastling, castlingWith, etc.).
        const legalMoves = silent(() => {
          const { getAllLegalMovesForPlayer } = getGameSocket();
          return getAllLegalMovesForPlayer(gameState, botPosition) || [];
        });
        // eslint-disable-next-line eqeqeq
        const matched = legalMoves.find((lm) =>
          lm.pieceId == jsId &&
          lm.from?.x === mv.from.x && lm.from?.y === mv.from.y &&
          lm.to?.x === mv.to.x && lm.to?.y === mv.to.y,
        );
        if (!matched) {
          console.warn('[adaptive] Rust move not in JS legal set; falling back to minimax');
          return done(null);
        }
        done(matched);
      } catch (e) {
        console.warn('[adaptive] Rust engine parse failed:', e.message);
        done(null);
      }
    });
    child.on('error', () => { clearTimeout(timeoutHandle); done(null); });
    try {
      child.stdin.write(boardJson + '\n');
      child.stdin.end();
    } catch (_) {
      done(null);
    }
  });
}

function getBestMoveSync(gameState, botPosition, difficulty, settingsOverride) {
  const baseSettings = settingsOverride || DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const startTime = Date.now();

  // Scale time budget and depth down when the bot is in clock trouble.
  // botTimeRemaining is in seconds (set by the game timer).
  const settings = { ...baseSettings };
  const botId = gameState.botPlayer?.id;
  const botTimeRemaining = botId != null ? (gameState.playerTimes?.[botId] ?? null) : null;
  const gameTimeControl = gameState.timeControl; // minutes (null = unlimited)

  if (botTimeRemaining != null && gameTimeControl) {
    // We want to spend at most a fraction of remaining time per move.
    // Target: use ~3 % of remaining time, capped by the base timeLimit.
    // On very low time (< 10 s) drop to depth 1 with a hard 500 ms cap.
    const remainingMs = botTimeRemaining * 1000;
    if (remainingMs < 5000) {
      // Under 5 seconds — absolute emergency, instant move
      settings.timeLimit = Math.min(settings.timeLimit, 300);
      settings.depth = 1;
      settings.quiescenceDepth = 0;
    } else if (remainingMs < 15000) {
      // Under 15 seconds — very fast
      settings.timeLimit = Math.min(settings.timeLimit, 800);
      settings.depth = Math.min(settings.depth, 2);
      settings.quiescenceDepth = Math.min(settings.quiescenceDepth, 1);
    } else if (remainingMs < 30000) {
      // Under 30 seconds — fast
      settings.timeLimit = Math.min(settings.timeLimit, 2000);
      settings.depth = Math.min(settings.depth, 3);
      settings.quiescenceDepth = Math.min(settings.quiescenceDepth, 2);
    } else {
      // Healthy clock: cap to 3 % of remaining time so moves don't eat
      // disproportionate chunks on long games.
      const timeCap = Math.max(1000, Math.min(remainingMs * 0.03, settings.timeLimit));
      settings.timeLimit = Math.round(timeCap);
    }
  } else if (gameTimeControl && gameTimeControl <= 1) {
    // Bullet time control (≤ 1 min) even without a live clock reading
    settings.timeLimit = Math.min(settings.timeLimit, 1500);
    settings.depth = Math.min(settings.depth, 3);
    settings.quiescenceDepth = Math.min(settings.quiescenceDepth, 2);
  } else if (gameTimeControl && gameTimeControl <= 3) {
    // Blitz (≤ 3 min)
    settings.timeLimit = Math.min(settings.timeLimit, 3000);
    settings.depth = Math.min(settings.depth, 4);
  }


  const legalMoves = silent(() => {
    const { getAllLegalMovesForPlayer } = getGameSocket();
    return getAllLegalMovesForPlayer(gameState, botPosition);
  });

  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  // Random move chance (for lower difficulties / variety)
  if (Math.random() < settings.randomness) {
    const idx = Math.floor(Math.random() * legalMoves.length);
    console.log(`[AI] Random move selected (difficulty: ${difficulty})`);
    return legalMoves[idx];
  }

  // Detect back-and-forth patterns from recent bot move history
  const botMoveHistory = gameState.moveHistory?.filter(m => m.isBot) || [];
  const lastBotMove = botMoveHistory.length > 0 ? botMoveHistory[botMoveHistory.length - 1] : null;
  const secondLastBotMove = botMoveHistory.length > 1 ? botMoveHistory[botMoveHistory.length - 2] : null;

  // Build a set of recent bot piece positions for reverse-move detection
  // recentBotPositions[pieceId] = array of {x,y} positions the piece has been at recently
  const recentBotPositions = {};
  const lookback = Math.min(botMoveHistory.length, 6);
  for (let i = botMoveHistory.length - lookback; i < botMoveHistory.length; i++) {
    const m = botMoveHistory[i];
    if (!m) continue;
    if (!recentBotPositions[m.pieceId]) recentBotPositions[m.pieceId] = [];
    recentBotPositions[m.pieceId].push({ x: m.from.x, y: m.from.y });
  }

  // Iterative deepening with time limit
  let bestMove = legalMoves[0];
  let bestScore = -Infinity;

  for (let depth = 1; depth <= settings.depth; depth++) {
    // Don't start a new depth if 75% of time budget is used
    if (Date.now() - startTime > settings.timeLimit * 0.75) break;

    const orderedMoves = [...legalMoves];
    orderMoves(orderedMoves, gameState);

    let depthBestMove = null;
    let depthBestScore = -Infinity;
    let timedOut = false;

    for (const move of orderedMoves) {
      const child = cloneState(gameState);
      applyMove(child, move);

      // After our move, it's opponent's turn → minimizing
      const result = minimax(
        child, depth - 1, -Infinity, Infinity,
        false, botPosition, startTime, settings.timeLimit, settings.quiescenceDepth || 0
      );

      if (result.timedOut) { timedOut = true; break; }

      let moveScore = result.score;

      // Penalize moving the same piece as last bot move (encourages developing different pieces)
      if (lastBotMove && move.pieceId === lastBotMove.pieceId && !lastBotMove.captured) {
        const piece = gameState.pieces.find(p => p.id === move.pieceId);
        if (piece) {
          const pValue = getPieceValue(piece, Math.max(
            gameState.gameType?.board_width || 8,
            gameState.gameType?.board_height || 8
          ));
          const penalty = pValue < 5 ? 15 : 6;
          moveScore -= penalty;
        }
      }

      // Heavy penalty for moving a piece back to a position it was recently at (back-and-forth)
      const positions = recentBotPositions[move.pieceId];
      if (positions) {
        for (const pos of positions) {
          if (pos.x === move.to.x && pos.y === move.to.y) {
            moveScore -= 25; // Strong penalty for reverting to a recent position
            break;
          }
        }
      }

      // Extra penalty for undoing the last move exactly (A→B then B→A)
      if (lastBotMove && move.pieceId === lastBotMove.pieceId &&
          move.to.x === lastBotMove.from.x && move.to.y === lastBotMove.from.y) {
        moveScore -= 30;
      }

      if (moveScore > depthBestScore) {
        depthBestScore = moveScore;
        depthBestMove = move;
      }
    }

    if (depthBestMove && !timedOut) {
      bestMove = depthBestMove;
      bestScore = depthBestScore;
      console.log(`[AI] Depth ${depth} complete: score=${bestScore} (${Date.now() - startTime}ms)`);
    }
  }

  console.log(`[AI] Move chosen in ${Date.now() - startTime}ms (difficulty: ${difficulty}):`, {
    pieceId: bestMove.pieceId,
    from: bestMove.from,
    to: { x: bestMove.to.x, y: bestMove.to.y },
    score: bestScore
  });

  return bestMove;
}

/**
 * Choose the best promotion option for the bot.
 * Picks the piece with the highest estimated value.
 */
function chooseBestPromotion(options) {
  if (!options || options.length === 0) return null;
  if (options.length === 1) return options[0];

  let best = options[0];
  let bestValue = getPieceValue(options[0]);

  for (let i = 1; i < options.length; i++) {
    const value = getPieceValue(options[i]);
    if (value > bestValue) {
      bestValue = value;
      best = options[i];
    }
  }

  return best;
}

module.exports = {
  getBestMove,
  chooseBestPromotion,
  evaluatePosition,
  getPieceValue,
  DIFFICULTY,
  cloneState,
  // Exposed for testing
  getMovesForSearch,
  checkTerminal,
  applyMove
};
