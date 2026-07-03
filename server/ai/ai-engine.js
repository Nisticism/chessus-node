console.log('[AI] ai-engine loaded -- threat-first build (getTacticalCandidates active)');

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
  easy:   { depth: 3, timeLimit: 2000,  randomness: 0.20, thinkDelay: 600, quiescenceDepth: 2 },
  medium: { depth: 6, timeLimit: 10000, randomness: 0.02, thinkDelay: 400, quiescenceDepth: 4 },
  hard:   { depth: 8, timeLimit: 25000, randomness: 0.00, thinkDelay: 200, quiescenceDepth: 6 },
  // Baseline for "adaptive" — should always be at least as strong as
  // hard (we hide it from the UI when no training data exists, so this
  // baseline is only ever reached as a defensive fallback).
  adaptive: { depth: 8, timeLimit: 25000, randomness: 0, thinkDelay: 200, quiescenceDepth: 6 },
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
    moveHistory: state.moveHistory || [],
    // Required so applyMove can find placeable_pieces templates and orderMoves knows it's a
    // placement game. Shared by reference (read-only in search — never mutated).
    otherGameData: state.otherGameData || {},
    // Per-player limited-reserve inventory. Cloned (one level deep) so a deploy in one
    // search branch does not mutate sibling branches. null when not a limited-reserve game.
    reserves: state.reserves
      ? Object.fromEntries(Object.entries(state.reserves).map(([k, v]) => [k, { ...v }]))
      : null,
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
  // Pass action: no board change, just hand the turn to the opponent.
  if (move.type === 'pass' || move.isPass) {
    state.currentTurn = state.currentTurn === 1 ? 2 : 1;
    state.moveCount = (state.moveCount || 0) + 1;
    state.gamePly = (state.gamePly ?? 0) + 1;
    state.consecutivePasses = (state.consecutivePasses || 0) + 1;
    return [];
  }
  // Placement action: add a new piece to the board, switch turns, no captures.
  if (move.type === 'place' || move.isPlacement) {
    const playerToMove = state.currentTurn;
    const otherData = state.otherGameData || {};
    const placeable = Array.isArray(otherData.placeable_pieces) ? otherData.placeable_pieces : [];
    const template = move.placePieceId != null
      ? placeable.find(pp => pp.piece_id === move.placePieceId) || placeable[0]
      : placeable[0];
    const newId = `placed_${state.moveCount || 0}_${move.to.x}_${move.to.y}`;
    const placedNeutral = !!(template && template.is_neutral);
    const placedTeam = placedNeutral ? 0 : playerToMove;
    state.pieces.push({
      ...(template || {}),
      id: newId,
      x: move.to.x,
      y: move.to.y,
      team: placedTeam,
      player_id: placedTeam,
      is_neutral: placedNeutral,
      hasMoved: true,
      moveCount: 1,
    });
    state.consecutivePasses = 0; // a real move breaks a pass run
    // Apply flanking captures for Othello-style games so the search tree
    // evaluates the correct board state (flipped pieces change piece counts).
    if (otherData.flanking_captures) {
      try {
        const { applyFlankingCaptures: afc } = getGameSocket();
        if (typeof afc === 'function') {
          silent(() => afc(state, move.to.x, move.to.y, playerToMove));
        }
      } catch (_) { /* ignore — search tree flanking is best-effort */ }
    }
    // Surround (enclosure) capture: remove enemy groups with no liberties so the
    // search tree sees the correct board (Go-style capture).
    if (otherData.surround_capture) {
      try {
        const { resolveSurroundCaptures: rsc } = getGameSocket();
        if (typeof rsc === 'function') silent(() => rsc(state, playerToMove));
      } catch (_) { /* best-effort */ }
    }
    state.currentTurn = state.currentTurn === 1 ? 2 : 1;
    state.moveCount = (state.moveCount || 0) + 1;
    state.gamePly = (state.gamePly ?? 0) + 1;
    // A deploy advances material like a pawn move — reset the 50-move counter.
    state.movesWithoutCapture = 0;
    // Decrement the deploying player's limited reserve, if in use.
    if (state.reserves && template && template.piece_id != null) {
      const inv = state.reserves[playerToMove] || state.reserves[String(playerToMove)];
      if (inv && inv[template.piece_id] != null) {
        inv[template.piece_id] = Math.max(0, inv[template.piece_id] - 1);
      }
    }
    return [];
  }
  const piece = state.pieces.find(p => p.id === move.pieceId);
  if (!piece) return [];

  const pieceOwner = piece.team || piece.player_id;
  const captured = [];

  // Ranged attack: deal damage to the target but do NOT move the attacker
  if (move.isRangedAttack) {
    const targetIdx = state.pieces.findIndex(p => p.x === move.to.x && p.y === move.to.y && p.id !== move.pieceId);
    if (targetIdx !== -1) {
      const target = state.pieces[targetIdx];
      const targetOwner = target.team || target.player_id;
      if (targetOwner !== pieceOwner && !target.cannot_be_captured) {
        const targetHp = target.current_hp ?? target.hit_points ?? 1;
        const attackDmg = piece.attack_damage || 1;
        if (targetHp <= attackDmg) {
          captured.push(state.pieces.splice(targetIdx, 1)[0]);
        } else {
          target.current_hp = targetHp - attackDmg;
        }
      }
    }
    // Attacker does not move; just switch turns
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

  const pw = piece.piece_width || 1;
  const ph = piece.piece_height || 1;

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

  // NOTE: capture_actions_per_turn (bonus extra-capture actions) are not modelled in the
  // search tree — the AI skips them in live play (processBotTurn). A future improvement
  // could extend the minimax tree to consider bonus captures.

  if (captured.length > 0) {
    state.movesWithoutCapture = 0;
  } else {
    state.movesWithoutCapture = (state.movesWithoutCapture || 0) + 1;
  }

  // Update control square tracking (mirrors updateControlSquareTracking in game-socket.js)
  {
    let controlSquares = {};
    try {
      if (state.gameType?.control_squares_string) {
        const parsed = JSON.parse(state.gameType.control_squares_string);
        if (parsed && typeof parsed === 'object') controlSquares = { ...parsed };
      }
    } catch (_) {}
    try {
      if (state.gameType?.special_squares_string) {
        const custom = typeof state.gameType.special_squares_string === 'string'
          ? JSON.parse(state.gameType.special_squares_string)
          : state.gameType.special_squares_string;
        if (custom && typeof custom === 'object') {
          for (const [key, cfg] of Object.entries(custom)) {
            if (cfg && cfg.asControl && !controlSquares[key]) {
              controlSquares[key] = { type: 'control', fromCustom: true, ...(cfg.controlConfig || {}) };
            }
          }
        }
      }
    } catch (_) {}
    if (Object.keys(controlSquares).length > 0) {
      if (!state.controlSquareTracking) state.controlSquareTracking = {};
      if (!state.controlSquareTracking.bySquare) state.controlSquareTracking.bySquare = {};
      if (!state.controlSquareTracking.byPlayer) state.controlSquareTracking.byPlayer = {};

      const consecutiveTurns = !!(Object.values(controlSquares)[0]?.consecutiveTurns);
      const squaresApplicableTo = (playerPosition) =>
        Object.values(controlSquares).filter(cfg => {
          const ap = cfg?.appliesToPlayer || 'both';
          return ap === 'both' || ap === 'all' || ap === `p${playerPosition}`;
        }).length;

      const squaresHeld = {};
      for (const player of (state.players || [])) squaresHeld[player.position] = 0;

      for (const [squareKey, config] of Object.entries(controlSquares)) {
        const [row, col] = squareKey.split(',').map(Number);
        const requireSpecific = !!config?.requireSpecificPiece;
        const piecesOnSquare = state.pieces.filter(p => p.x === col && p.y === row);
        const controllingPiece = requireSpecific
          ? piecesOnSquare.find(p => p.can_control_squares)
          : piecesOnSquare[0];
        if (controllingPiece) {
          const owner = parseInt(controllingPiece.team || controllingPiece.player_id);
          const appliesToPlayer = config?.appliesToPlayer || 'both';
          const squareApplies = appliesToPlayer === 'both' || appliesToPlayer === 'all'
            || appliesToPlayer === `p${owner}`;
          if (squareApplies && squaresHeld[owner] !== undefined) squaresHeld[owner]++;
          state.controlSquareTracking.bySquare[squareKey] = { playerId: owner };
        } else {
          delete state.controlSquareTracking.bySquare[squareKey];
        }
      }

      for (const player of (state.players || [])) {
        const pos = player.position;
        const held = squaresHeld[pos] || 0;
        const needed = state.gameType?.squares_count
          ? Math.min(state.gameType.squares_count, Object.keys(controlSquares).length)
          : Math.max(1, squaresApplicableTo(pos));
        if (held >= needed) {
          if (!state.controlSquareTracking.byPlayer[pos]) {
            state.controlSquareTracking.byPlayer[pos] = { halfTurns: 0 };
          }
          state.controlSquareTracking.byPlayer[pos].halfTurns++;
        } else if (consecutiveTurns) {
          delete state.controlSquareTracking.byPlayer[pos];
        }
      }
    }
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
  const otherData = state.otherGameData || {};
  const isPlacementGame = !!otherData.place_pieces_action;

  // Game ends after N consecutive passes (Go-style). Decide by final score when
  // "highest score wins" is on, otherwise a draw.
  if (otherData.allow_pass && otherData.end_on_consecutive_passes !== 0) {
    const endN = Number(otherData.end_on_consecutive_passes) > 0 ? Number(otherData.end_on_consecutive_passes) : 2;
    if ((state.consecutivePasses || 0) >= endN) {
      if (otherData.high_score_win) {
        try {
          const { computeFinalScores: cfs } = getGameSocket();
          if (typeof cfs === 'function') {
            const s = silent(() => cfs(state)) || { 1: 0, 2: 0 };
            if (s[1] > s[2]) return { over: true, winner: 1, reason: 'score' };
            if (s[2] > s[1]) return { over: true, winner: 2, reason: 'score' };
          }
        } catch (_) { /* fall through to draw */ }
      }
      return { over: true, winner: null, reason: 'draw' };
    }
  }

  // Check captured piece flags — collect eliminations first to detect simultaneous draws
  const eliminatedPositions = new Set();
  for (const cp of captured) {
    if (cp.ends_game_on_capture || cp.ends_game_on_checkmate) {
      const loserPos = cp.team || cp.player_id;
      eliminatedPositions.add(loserPos);
    }
  }
  if (eliminatedPositions.size > 0) {
    const allElim = players.every(p => eliminatedPositions.has(p.position));
    if (allElim) {
      // Simultaneous — check die_on_capture_grants_win
      const grantsWin = captured.find(p =>
        (p.die_on_capture === true || p.die_on_capture === 1) &&
        (p.die_on_capture_grants_win === true || p.die_on_capture_grants_win === 1)
      );
      if (grantsWin) {
        const attackerPos = grantsWin.team || grantsWin.player_id;
        return { over: true, winner: attackerPos, reason: 'capture' };
      }
      return { over: true, winner: null, reason: 'draw' };
    }
    const loserPos = [...eliminatedPositions][0];
    const winnerPos = loserPos === 1 ? 2 : 1;
    return { over: true, winner: winnerPos, reason: 'capture' };
  }

  // Check if either player has no pieces (elimination). Skipped for placement
  // games, where an empty (or nearly empty) board is normal, not a loss.
  if (!isPlacementGame) {
    for (const player of players) {
      const count = state.pieces.filter(p =>
        (p.team || p.player_id) === player.position
      ).length;
      if (count === 0) {
        const winnerPos = player.position === 1 ? 2 : 1;
        return { over: true, winner: winnerPos, reason: 'elimination' };
      }
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

  // Check control square win condition
  {
    const { gameType, pieces, players } = state;
    let controlSquares = {};
    try {
      if (gameType?.control_squares_string) {
        const parsed = JSON.parse(gameType.control_squares_string);
        if (parsed && typeof parsed === 'object') controlSquares = { ...parsed };
      }
    } catch (_) {}
    try {
      if (gameType?.special_squares_string) {
        const custom = typeof gameType.special_squares_string === 'string'
          ? JSON.parse(gameType.special_squares_string)
          : gameType.special_squares_string;
        if (custom && typeof custom === 'object') {
          for (const [key, cfg] of Object.entries(custom)) {
            if (cfg && cfg.asControl && !controlSquares[key]) {
              controlSquares[key] = { type: 'control', fromCustom: true, ...(cfg.controlConfig || {}) };
            }
          }
        }
      }
    } catch (_) {}
    if (Object.keys(controlSquares).length > 0 && state.controlSquareTracking?.byPlayer) {
      const turnsRequired = Math.max(1, ...Object.values(controlSquares).map(cfg => cfg?.turnsRequired || 1));
      const halfTurnsRequired = turnsRequired * 2;
      for (const [playerPosStr, tracking] of Object.entries(state.controlSquareTracking.byPlayer)) {
        if (tracking.halfTurns >= halfTurnsRequired) {
          return { over: true, winner: parseInt(playerPosStr), reason: 'control' };
        }
      }
    }
  }

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
// Tactical Candidate Generation
// =============================================

/**
 * Scan the position for immediate tactical threats and opportunities.
 *
 * Returns:
 *   hasTactics   – true if any immediate threat / free capture exists
 *   hangingMyPieces – array of {piece, see, value} where opponent wins exchange (SEE > 0.5)
 *   freeCaptures    – array of {piece: opPiece, attackerId, atkValue, see} where we win exchange
 *
 * Both lists are sorted by urgency (largest SEE first).
 */
function getTacticalCandidates(state, player, bs) {
  const opponent = player === 1 ? 2 : 1;
  const hangingMyPieces = [];
  const freeCaptures = [];

  for (const p of state.pieces) {
    const owner = p.team || p.player_id;
    if (owner !== player && owner !== opponent) continue;
    const pVal = getPieceValue(p, bs);
    if (pVal === 0) continue;

    if (owner === player) {
      // Check if one of our pieces is under a winning attack
      const attackers = getAttackersTo(state, p.x, p.y, opponent, bs);
      if (attackers.length === 0) continue;
      let see;
      if (p.is_royal || p.ends_game_on_capture || p.ends_game_on_checkmate) {
        see = pVal + 20;
      } else {
        see = staticExchangeEval(state, p.x, p.y,
          attackers[0].piece.id, attackers[0].value, pVal, opponent, bs);
      }
      if (see > 0.5) hangingMyPieces.push({ piece: p, see, value: pVal });
    } else {
      // Check if an opponent piece is vulnerable to a winning capture by us
      const ourAttackers = getAttackersTo(state, p.x, p.y, player, bs);
      if (ourAttackers.length === 0) continue;
      const see = staticExchangeEval(state, p.x, p.y,
        ourAttackers[0].piece.id, ourAttackers[0].value, pVal, player, bs);
      if (see > 0.5) {
        freeCaptures.push({ piece: p, attackerId: ourAttackers[0].piece.id, atkValue: ourAttackers[0].value, see });
      }
    }
  }

  hangingMyPieces.sort((a, b) => b.see - a.see);
  freeCaptures.sort((a, b) => b.see - a.see);

  return {
    hasTactics: hangingMyPieces.length > 0 || freeCaptures.length > 0,
    hangingMyPieces,
    freeCaptures,
  };
}

/**
 * Build a focused candidate list from tactical threats/opportunities.
 * Only includes legal moves that directly address the most urgent tactics:
 *   - Escape moves for each hanging piece (move it away)
 *   - Captures of the cheapest attacker threatening a hanging piece
 *   - The specific winning capture(s) of hanging opponent pieces
 *
 * Falls back to full legalMoves if no focused candidates can be found.
 */
function buildTacticalCandidates(legalMoves, tactics, state, player, bs) {
  const seen = new Set();
  const candidates = [];

  const add = (m) => {
    const key = `${m.pieceId}:${m.to.x},${m.to.y}`;
    if (!seen.has(key)) { seen.add(key); candidates.push(m); }
  };

  // 1. For each hanging piece: add its legal escapes and captures of its cheapest attacker
  for (const { piece, see } of tactics.hangingMyPieces) {
    // Escape moves: legal moves by the threatened piece itself
    for (const m of legalMoves) {
      if (m.pieceId === piece.id) add(m);
    }

    // Capture moves that take the piece's cheapest attacker
    const attackers = getAttackersTo(state, piece.x, piece.y, player === 1 ? 2 : 1, bs);
    if (attackers.length > 0) {
      const cheapest = attackers[0].piece;
      for (const m of legalMoves) {
        if (m.to.x === cheapest.x && m.to.y === cheapest.y) {
          const target = state.pieces.find(p =>
            p.x === m.to.x && p.y === m.to.y && (p.team || p.player_id) !== player
          );
          if (target) add(m);
        }
      }
    }
  }

  // 2. Add winning captures of hanging opponent pieces
  for (const { piece } of tactics.freeCaptures) {
    for (const m of legalMoves) {
      if (m.to.x === piece.x && m.to.y === piece.y) {
        const target = state.pieces.find(p =>
          p.x === m.to.x && p.y === m.to.y && (p.team || p.player_id) !== player
        );
        if (target) add(m);
      }
    }
  }

  return candidates;
}

// =============================================
// Move Generation for Search
// =============================================

/**
 * Get moves for search. Reuses game-socket's getPossibleMovesForPiece.
 * Filters for check legality when mate_condition is enabled.
 */
function getMovesForSearch(state, playerPosition) {
  const { getPossibleMovesForPiece, wouldMoveLeaveInCheck, canRangedAttackTo, isRangedPathClear } = getGameSocket();
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
      // Direction-change moves carry a via square — hoist it to top-level for validateAndApplyMove
      if (toSquare.via) move.via = toSquare.via;

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

    // Also generate ranged attack moves (piece stays in place; targets enemies in range)
    if (piece.can_capture_enemy_via_range && canRangedAttackTo && isRangedPathClear) {  // (label kept for diff clarity)
      for (const target of state.pieces) {
        if (target.id === piece.id) continue;
        const targetOwner = target.team || target.player_id;
        if (targetOwner === playerPosition) continue;
        if (target.cannot_be_captured) continue;
        const inRange = silent(() =>
          canRangedAttackTo(piece.y, piece.x, target.y, target.x, piece, playerPosition, state.gameType)
        );
        if (!inRange) continue;
        const pathClear = silent(() =>
          isRangedPathClear(piece.x, piece.y, target.x, target.y, piece, state.pieces, playerPosition, state.gameType)
        );
        if (!pathClear) continue;
        const rangedMove = {
          pieceId: piece.id,
          from: { x: piece.x, y: piece.y },
          to: { x: target.x, y: target.y },
          isRangedAttack: true
        };
        if (state.gameType?.mate_condition) {
          const illegal = silent(() =>
            wouldMoveLeaveInCheck(state, rangedMove, playerPosition)
          );
          if (!illegal) moves.push(rangedMove);
        } else {
          moves.push(rangedMove);
        }
      }
    }
  }

  // --- Placement moves (Othello-style / free-placement variants) ---
  // Mirror the enumeration in getAllLegalMovesForPlayer so the search tree
  // evaluates placement options alongside normal piece moves.
  try {
    const otherData = state.otherGameData || {};
    if (otherData.place_pieces_action) {
      const boardWidth = state.gameType?.board_width || 8;
      const boardHeight = state.gameType?.board_height || 8;
      const placeable = Array.isArray(otherData.placeable_pieces) ? otherData.placeable_pieces : [];

      // Per-entry ownership: only entries this player may deploy.
      const eligibleFor = (pp) => pp.is_neutral || pp.player === 'neutral' || pp.player === 'all' || pp.player == null || Number(pp.player) === Number(playerPosition);
      // Limited reserve: only deploy piece types the current player still has.
      let piecesToPlace;
      if (state.reserves) {
        const inv = state.reserves[playerPosition] || state.reserves[String(playerPosition)] || {};
        piecesToPlace = placeable.filter(pp => pp.piece_id != null && (inv[pp.piece_id] ?? 0) > 0 && eligibleFor(pp));
      } else {
        piecesToPlace = (placeable.length > 0 ? placeable : [{ piece_id: null }]).filter(eligibleFor);
      }

      // Parse custom-square placement restrictions once (own-first-rank etc.).
      let customSquares = null;
      if (state.gameType?.special_squares_string) {
        try {
          customSquares = typeof state.gameType.special_squares_string === 'string'
            ? JSON.parse(state.gameType.special_squares_string)
            : state.gameType.special_squares_string;
        } catch (_) { customSquares = null; }
      }
      // Confinement zone: squares the player is restricted to (null = not confined).
      let placementZone = null;
      if (customSquares) {
        for (const key of Object.keys(customSquares)) {
          const cfg = customSquares[key];
          if (!cfg || !cfg.restrictPiecePlacement || !cfg.confinePlacementToHere) continue;
          const to = cfg.restrictPiecePlacementTo || 'all';
          if (to === 'all' || to === `p${playerPosition}`) {
            if (!placementZone) placementZone = new Set();
            placementZone.add(key);
          }
        }
      }
      const isPlacementAllowedHere = (x, y) => {
        if (!customSquares) return true;
        const cfg = customSquares[`${y},${x}`];
        if (cfg && cfg.restrictPiecePlacement) {
          const restriction = cfg.restrictPiecePlacementTo || 'all';
          if (restriction === 'neutral') return false;
          if (restriction !== 'all') {
            const m = String(restriction).match(/^p(\d+)$/);
            const allowedPosition = m ? parseInt(m[1], 10) : null;
            if (allowedPosition !== null && playerPosition !== allowedPosition) return false;
          }
        }
        // Confinement: if the player has any "confine to here" square, they may
        // only deploy on those squares.
        if (placementZone && !placementZone.has(`${y},${x}`)) return false;
        return true;
      };

      // Collect all occupied squares once for O(1) lookup
      const occupiedSet = new Set();
      for (const p of state.pieces) {
        occupiedSet.add(`${p.x},${p.y}`);
      }

      // For must_flank games, restrict to valid flanking squares only
      let validFlankSet = null;
      if (otherData.flanking_captures && otherData.must_flank) {
        try {
          const { getValidFlankingPlacements: gvfp } = getGameSocket();
          if (typeof gvfp === 'function') {
            const validSquares = silent(() => gvfp(state, playerPosition)) || [];
            validFlankSet = new Set(validSquares.map(sq => `${sq.x},${sq.y}`));
          }
        } catch (_) { /* fall back to all empty squares */ }
      }

      // Shared legality predicates (self-capture / repeating-position bans).
      let gsHelpers = null;
      if (otherData.forbid_self_capture || otherData.forbid_position_repetition) {
        try { gsHelpers = getGameSocket(); } catch (_) { gsHelpers = null; }
      }

      if (piecesToPlace.length > 0) {
        for (let y = 0; y < boardHeight; y++) {
          for (let x = 0; x < boardWidth; x++) {
            if (occupiedSet.has(`${x},${y}`)) continue;
            if (validFlankSet !== null && !validFlankSet.has(`${x},${y}`)) continue;
            if (!isPlacementAllowedHere(x, y)) continue;
            for (const pt of piecesToPlace) {
              if (gsHelpers) {
                try {
                  if (otherData.forbid_self_capture && typeof gsHelpers.placementViolatesSelfCapture === 'function'
                    && gsHelpers.placementViolatesSelfCapture(state, x, y, playerPosition, pt)) continue;
                  if (otherData.forbid_position_repetition && typeof gsHelpers.placementRepeatsBannedPosition === 'function'
                    && gsHelpers.placementRepeatsBannedPosition(state, x, y, playerPosition, pt)) continue;
                } catch (_) { /* best-effort — include the move if the check throws */ }
              }
              moves.push({
                type: 'place',
                from: { x, y },
                to: { x, y },
                placePieceId: pt.piece_id ?? null,
                isPlacement: true,
              });
            }
          }
        }
      }

      // A pass is always available when the game allows it (lets the bot end a
      // scoring game and avoids false stalemate when no placement is worthwhile).
      if (otherData.allow_pass) {
        moves.push({ type: 'pass', isPass: true });
      }
    }
  } catch (_) { /* ignore */ }

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
  if (piece.is_neutral || piece.player_id === 0) return 0;

  // Use pre-computed value from game state if available
  // (pieceValues is keyed by piece_id and set on the state object)
  const bw = boardSize || 8;
  const bh = boardSize || 8; // AI engine uses a single boardSize; treat as square

  const cx = Math.floor((bw - 1) / 2);
  const cy = Math.floor((bh - 1) / 2);
  const DIVISOR = 5.5;
  const isOnBoard = (x, y) => x >= 0 && x < bw && y >= 0 && y < bh;

  const moveSet      = new Set();
  const stepMoveSet   = new Set(); // squares reached via step-by-step movement (weighted ×1.2)
  const attackMap    = new Map();
  const stepAttackSet = new Set(); // squares attacked via step movement/capture (weighted ×1.2)
  const addAttack = (key, w) => {
    const cur = attackMap.get(key);
    if (cur === undefined || w > cur) attackMap.set(key, w);
  };

  function walkDir(dx, dy, range, exact, repeating) {
    if (!range || range === 0) return [];
    const absRange = Math.abs(range);
    const isExact  = exact || range < 0;
    const limit    = absRange === 99 ? Math.max(bw, bh) : absRange;
    const maxIter  = (isExact && repeating) ? Math.max(bw, bh) : limit;
    const result   = [];
    for (let dist = 1; dist <= maxIter; dist++) {
      const x = cx + dx * dist, y = cy + dy * dist;
      if (!isOnBoard(x, y)) break;
      if (!isExact || (repeating ? dist % absRange === 0 : dist === absRange)) result.push(`${x},${y}`);
    }
    return result;
  }

  const hasDedicatedCap = !!(
    piece.up_capture || piece.down_capture || piece.left_capture || piece.right_capture ||
    piece.up_left_capture || piece.up_right_capture || piece.down_left_capture || piece.down_right_capture ||
    piece.ratio_capture_1 || piece.ratio_capture_2
  );
  const canCaptureOnMove     = !!(piece.can_capture_enemy_on_move);
  const firstMoveOnlyCapture = !!(piece.first_move_only_capture);
  const repM = !!piece.repeating_movement;
  const repC = !!piece.repeating_capture;
  const dirs = [
    { name: 'up', dx: 0, dy: -1 }, { name: 'down', dx: 0, dy: 1 },
    { name: 'left', dx: -1, dy: 0 }, { name: 'right', dx: 1, dy: 0 },
    { name: 'up_left', dx: -1, dy: -1 }, { name: 'up_right', dx: 1, dy: -1 },
    { name: 'down_left', dx: -1, dy: 1 }, { name: 'down_right', dx: 1, dy: 1 },
  ];
  for (const dir of dirs) {
    const moveRange = piece[`${dir.name}_movement`] || 0;
    const capRange  = piece[`${dir.name}_capture`]  || 0;
    const dirFMO    = (piece[`${dir.name}_movement_available_for`] || 0) > 0;
    if (moveRange > 0) {
      for (const key of walkDir(dir.dx, dir.dy, moveRange, !!piece[`${dir.name}_movement_exact`], repM && !!piece[`${dir.name}_movement_exact`])) {
        moveSet.add(key);
        if (canCaptureOnMove && (!hasDedicatedCap || capRange > 0)) addAttack(key, (firstMoveOnlyCapture || dirFMO) ? 0.5 : 1.0);
      }
    }
    if (capRange > 0) {
      for (const key of walkDir(dir.dx, dir.dy, capRange, !!piece[`${dir.name}_capture_exact`], repC && !!piece[`${dir.name}_capture_exact`])) {
        addAttack(key, firstMoveOnlyCapture ? 0.5 : 1.0);
      }
    }
  }

  if (piece.can_capture_enemy_via_range) {
    const rd = [
      { f: 'up_attack_range', dx: 0, dy: -1 }, { f: 'down_attack_range', dx: 0, dy: 1 },
      { f: 'left_attack_range', dx: -1, dy: 0 }, { f: 'right_attack_range', dx: 1, dy: 0 },
      { f: 'up_left_attack_range', dx: -1, dy: -1 }, { f: 'up_right_attack_range', dx: 1, dy: -1 },
      { f: 'down_left_attack_range', dx: -1, dy: 1 }, { f: 'down_right_attack_range', dx: 1, dy: 1 },
    ];
    for (const d of rd) {
      const range = piece[d.f] || 0;
      if (!range) continue;
      for (const key of walkDir(d.dx, d.dy, range, !!piece[`${d.f}_exact`], false)) addAttack(key, 1.5);
    }
    const sar = piece.step_by_step_attack_range;
    if (sar != null && sar !== 0) {
      const sarSteps = Math.abs(sar);
      const sarDirs  = sar < 0 ? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const vis = new Set([`${cx},${cy}`]);
      const q   = [{ x: cx, y: cy, steps: 0 }];
      while (q.length) {
        const c = q.shift();
        if (c.steps >= sarSteps) continue;
        for (const [dx, dy] of sarDirs) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!isOnBoard(nx, ny)) continue;
          const key = `${nx},${ny}`;
          if (vis.has(key)) continue;
          vis.add(key); stepAttackSet.add(key); addAttack(key, 1.5);
          q.push({ x: nx, y: ny, steps: c.steps + 1 });
        }
      }
    }
    const rar1 = piece.ratio_one_attack_range || 0, rar2 = piece.ratio_two_attack_range || 0;
    if (rar1 > 0 && rar2 > 0) {
      for (const [dx, dy] of [[rar1,rar2],[rar1,-rar2],[-rar1,rar2],[-rar1,-rar2],[rar2,rar1],[rar2,-rar1],[-rar2,rar1],[-rar2,-rar1]]) {
        const x = cx + dx, y = cy + dy;
        if (isOnBoard(x, y)) addAttack(`${x},${y}`, 1.5);
      }
    }
  }

  const r1 = piece.ratio_movement_1 || 0, r2 = piece.ratio_movement_2 || 0;
  if (r1 > 0 && r2 > 0) {
    const maxK = piece.repeating_ratio ? (piece.max_ratio_iterations === -1 ? Math.max(bw, bh) : (piece.max_ratio_iterations || 2)) : 1;
    for (const [dx, dy] of [[r1,r2],[r1,-r2],[-r1,r2],[-r1,-r2],[r2,r1],[r2,-r1],[-r2,r1],[-r2,-r1]]) {
      for (let k = 1; k <= maxK; k++) {
        const x = cx + dx * k, y = cy + dy * k;
        if (!isOnBoard(x, y)) break;
        const key = `${x},${y}`; moveSet.add(key);
        if (canCaptureOnMove && !hasDedicatedCap) addAttack(key, firstMoveOnlyCapture ? 0.5 : 1.0);
      }
    }
  }

  const rc1 = piece.ratio_capture_1 || 0, rc2 = piece.ratio_capture_2 || 0;
  if (rc1 > 0 && rc2 > 0) {
    const maxK = piece.repeating_ratio_capture ? (piece.max_ratio_capture_iterations === -1 ? Math.max(bw, bh) : (piece.max_ratio_capture_iterations || 2)) : 1;
    for (const [dx, dy] of [[rc1,rc2],[rc1,-rc2],[-rc1,rc2],[-rc1,-rc2],[rc2,rc1],[rc2,-rc1],[-rc2,rc1],[-rc2,-rc1]]) {
      for (let k = 1; k <= maxK; k++) {
        const x = cx + dx * k, y = cy + dy * k;
        if (!isOnBoard(x, y)) break;
        addAttack(`${x},${y}`, firstMoveOnlyCapture ? 0.5 : 1.0);
      }
    }
  }

  const stepStyle = piece.step_by_step_movement_style || piece.step_movement_style;
  if (stepStyle) {
    const stepVal = Number(piece.step_by_step_movement_value ?? piece.step_movement_value ?? 0);
    if (!isNaN(stepVal) && stepVal !== 0) {
      const maxS   = Math.abs(stepVal);
      const mDirs  = stepVal < 0 ? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const vis    = new Set([`${cx},${cy}`]);
      const q      = [{ x: cx, y: cy, steps: 0 }];
      while (q.length) {
        const c = q.shift();
        if (c.steps >= maxS) continue;
        for (const [dx, dy] of mDirs) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!isOnBoard(nx, ny)) continue;
          const key = `${nx},${ny}`;
          if (vis.has(key)) continue; vis.add(key); moveSet.add(key); stepMoveSet.add(key);
          q.push({ x: nx, y: ny, steps: c.steps + 1 });
        }
      }
      const capVal     = Number(piece.step_capture_value ?? 0);
      const hasStepCap = piece.step_capture_value != null && piece.step_capture_value !== 0 && !isNaN(capVal);
      if (hasStepCap) {
        const cS   = Math.abs(capVal);
        const cDirs = capVal < 0 ? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
        const cv = new Set([`${cx},${cy}`]); const cq = [{ x: cx, y: cy, steps: 0 }];
        while (cq.length) {
          const c = cq.shift();
          for (const [dx, dy] of cDirs) { const nx = c.x+dx, ny = c.y+dy; if (!isOnBoard(nx,ny)) continue; if (c.steps+1<=cS) { stepAttackSet.add(`${nx},${ny}`); addAttack(`${nx},${ny}`, firstMoveOnlyCapture?0.5:1.0); } }
          if (c.steps < maxS) {
            for (const [dx, dy] of mDirs) { const nx=c.x+dx, ny=c.y+dy; if (!isOnBoard(nx,ny)) continue; const key=`${nx},${ny}`; if (!cv.has(key)){cv.add(key);cq.push({x:nx,y:ny,steps:c.steps+1});} }
          }
        }
      } else if (canCaptureOnMove && !hasDedicatedCap) {
        for (const sq of moveSet) {
          if (stepMoveSet.has(sq)) stepAttackSet.add(sq);
          addAttack(sq, firstMoveOnlyCapture ? 0.5 : 1.0);
        }
      }
    }
  }

  let additionalMovements = {};
  if (piece.special_scenario_moves) {
    try {
      const p = typeof piece.special_scenario_moves === 'string' ? JSON.parse(piece.special_scenario_moves) : piece.special_scenario_moves;
      additionalMovements = p.additionalMovements || {};
    } catch (_) {}
  }
  const dmap = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0], up_left:[-1,-1], up_right:[1,-1], down_left:[-1,1], down_right:[1,1] };
  for (const [dir, opts] of Object.entries(additionalMovements)) {
    const [dx, dy] = dmap[dir] || [0, 0];
    if (!dx && !dy) continue;
    for (const opt of opts) {
      const fmo = !!(opt.firstMoveOnly || opt.availableForMoves > 0);
      let maxD = opt.value || 0; if (opt.infinite) maxD = 99;
      for (const key of walkDir(dx, dy, maxD, !!opt.exact, false)) {
        moveSet.add(key);
        if (canCaptureOnMove && !hasDedicatedCap) addAttack(key, (firstMoveOnlyCapture || fmo) ? 0.5 : 1.0);
      }
    }
  }

  // ---- Direction-change moves -----------------------------------------
  // Pieces with `directional_movement_change` / `directional_capture_change`
  // can string two directional legs together (turn mid-flight). On an empty
  // hypothetical board this dramatically expands their coverage. We
  // enumerate all (dir1, step1) -> (dir2, step2) combinations and add the
  // landing squares to `dcMoveSet` / `dcAttackSet`. These squares are
  // discounted heavily in the aggregation loop below (weight 0.45) because
  // the second leg is contingent on (a) the piece actually having the
  // direction-change ability and (b) the via-square being usable in the
  // current position. Squares already covered by ordinary movement are
  // not added again.
  const dcMoveKeys   = new Set();
  const dcAttackKeys = new Set();
  if (piece.directional_movement_change || piece.directional_capture_change) {
    const dcDirs = dirs; // reuse the 8-direction table from above
    const sameOrOpposite = (ax, ay, bx, by) =>
      (ax === bx && ay === by) || (ax === -bx && ay === -by);

    const enumerateDC = (legSuffix, addToSet, isCaptureType) => {
      // For each first-leg direction with a non-zero range...
      for (const d1 of dcDirs) {
        const r1 = piece[`${d1.name}${legSuffix}`] || 0;
        if (!r1) continue;
        const r1abs   = Math.abs(r1);
        const exact1  = !!piece[`${d1.name}${legSuffix}_exact`] || r1 < 0;
        const max1    = r1abs === 99 ? Math.max(bw, bh) : r1abs;
        for (let s1 = 1; s1 <= max1; s1++) {
          if (exact1 && s1 !== r1abs) continue;
          const viaX = cx + d1.dx * s1;
          const viaY = cy + d1.dy * s1;
          if (!isOnBoard(viaX, viaY)) break;
          // Second leg
          const secondSuffix = `${legSuffix}_change`;
          for (const d2 of dcDirs) {
            if (sameOrOpposite(d1.dx, d1.dy, d2.dx, d2.dy)) continue;
            const r2 = piece[`${d2.name}${secondSuffix}`] || 0;
            if (!r2) continue;
            const r2abs  = Math.abs(r2);
            const exact2 = !!piece[`${d2.name}${secondSuffix}_exact`] || r2 < 0;
            const max2   = r2abs === 99 ? Math.max(bw, bh) : r2abs;
            for (let s2 = 1; s2 <= max2; s2++) {
              if (exact2 && s2 !== r2abs) continue;
              const toX = viaX + d2.dx * s2;
              const toY = viaY + d2.dy * s2;
              if (!isOnBoard(toX, toY)) break;
              const key = `${toX},${toY}`;
              // Don't re-add a square that already counted via normal moves
              if (isCaptureType) {
                if (!attackMap.has(key) && !dcAttackKeys.has(key)) {
                  dcAttackKeys.add(key);
                  addToSet.add(key);
                }
              } else {
                if (!moveSet.has(key) && !dcMoveKeys.has(key)) {
                  dcMoveKeys.add(key);
                  addToSet.add(key);
                }
              }
            }
          }
          if (exact1) break;
        }
      }
    };

    if (piece.directional_movement_change) {
      enumerateDC('_movement', dcMoveKeys, false);
      // If the piece captures-on-move it also gains attack coverage via DC
      if (canCaptureOnMove && !hasDedicatedCap) {
        for (const k of dcMoveKeys) dcAttackKeys.add(k);
      }
    }
    if (piece.directional_capture_change ||
        (piece.attacks_like_movement && piece.directional_movement_change)) {
      enumerateDC('_capture', dcAttackKeys, true);
    }

    // Fold into the main aggregation sets so existing color-bound /
    // attack-presence checks still see the full coverage. The discount is
    // applied in the moveContrib / attackContrib loops below via the
    // dc-key sets.
    for (const k of dcMoveKeys)   moveSet.add(k);
    for (const k of dcAttackKeys) if (!attackMap.has(k)) addAttack(k, 1.0);
  }

  // Snapshot pre-custom sets so we can identify squares NEWLY added by custom squares
  const preCustMoveKeys   = new Set(moveSet);
  const preCustAttackKeys = new Set(attackMap.keys());

  if (piece.custom_movement_squares) {
    try {
      const c = typeof piece.custom_movement_squares === 'string' ? JSON.parse(piece.custom_movement_squares) : piece.custom_movement_squares;
      if (Array.isArray(c)) for (const sq of c) { const x=cx+(sq.col||0), y=cy+(sq.row||0); if (!isOnBoard(x,y)) continue; const key=`${x},${y}`; moveSet.add(key); if (canCaptureOnMove && !hasDedicatedCap) addAttack(key, firstMoveOnlyCapture?0.5:1.0); }
    } catch (_) {}
  }
  if (piece.custom_attack_squares) {
    try {
      const c = typeof piece.custom_attack_squares === 'string' ? JSON.parse(piece.custom_attack_squares) : piece.custom_attack_squares;
      if (Array.isArray(c)) for (const sq of c) { const x=cx+(sq.col||0), y=cy+(sq.row||0); if (isOnBoard(x,y)) addAttack(`${x},${y}`, firstMoveOnlyCapture?0.5:1.0); }
    } catch (_) {}
  }

  // Keys newly contributed by custom squares (used for 1.25x bonus)
  const customMoveKeys   = new Set([...moveSet].filter(k => !preCustMoveKeys.has(k)));
  const customAttackKeys = new Set([...attackMap.keys()].filter(k => !preCustAttackKeys.has(k)));

  const centerParity = (cx + cy) % 2;
  function isColorBound(keys) {
    const arr = [...keys];
    if (arr.length === 0) return false;
    return arr.every(k => { const [x, y] = k.split(',').map(Number); return (x + y) % 2 === centerParity; });
  }

  // Direction-change-only squares get a heavy discount (~0.45x) since reaching
  // them requires the DC ability and an empty via square in the live position.
  const DC_WEIGHT = 0.45;

  let moveContrib = 0;
  for (const key of moveSet) {
    const base = stepMoveSet.has(key) ? 1.2 : 1.0;
    let v = customMoveKeys.has(key) ? base * 1.25 : base;
    if (dcMoveKeys.has(key) && !customMoveKeys.has(key)) v *= DC_WEIGHT;
    moveContrib += v;
  }
  if (isColorBound(moveSet)) moveContrib *= 0.7;

  let attackContrib = 0;
  for (const [key, w] of attackMap) {
    const base = stepAttackSet.has(key) ? w * 1.2 : w;
    let v = customAttackKeys.has(key) ? base * 1.25 : base;
    if (dcAttackKeys.has(key) && !customAttackKeys.has(key)) v *= DC_WEIGHT;
    attackContrib += v;
  }
  if (isColorBound(attackMap.keys())) attackContrib *= 0.7;

  if ((piece.attack_radius || 0) > 0 || (piece.trample_radius || 0) > 0) attackContrib *= 1.25;
  let internal = moveContrib + attackContrib;

  if (attackContrib === 0)                            internal *= 0.6;
  if (piece.ghostwalk)                                internal *= 1.4;
  if (piece.can_promote)                              internal *= 1.2;
  if (piece.cannot_be_captured)                       internal *= 1.6;
  if (piece.die_on_capture || piece.dies_on_capture)  internal *= 0.8;

  // Hop bonus / penalty
  const canHopAllies  = !!(piece.can_hop_over_allies);
  const canHopEnemies = !!(piece.can_hop_over_enemies);
  if (canHopAllies && canHopEnemies) internal *= 1.15;
  else if (canHopAllies || canHopEnemies) internal *= 1.1;
  // exact_ratio_hop_only: piece can only use ratio/exact moves when hopping over
  // something — a significant restriction that reduces practical mobility.
  if (piece.exact_ratio_hop_only) internal *= 0.8;
  // directional_hop_disabled: hopping is disabled for directional (sliding) moves,
  // reducing the piece's ability to pass through blockers.
  if (piece.directional_hop_disabled) internal *= 0.92;
  // directional_hop_only: hopping only works on directional moves, not on ratio
  // (knight-like) moves. Modest penalty since ratio hops are a niche case.
  if (piece.directional_hop_only) internal *= 0.96;
  // max_directional_hop_pieces: limits pieces that can be hopped per directional move — restriction
  const maxDirHopPieces = piece.max_directional_hop_pieces;
  if (maxDirHopPieces === 1) internal *= 0.88;
  else if (maxDirHopPieces === 2) internal *= 0.93;
  else if (maxDirHopPieces === 3) internal *= 0.96;

  // Additional wizard-level attack/mobility features
  const captureActionsPerTurn = piece.capture_actions_per_turn || 1;
  if (captureActionsPerTurn > 1 || captureActionsPerTurn === -1) {
    const extra = captureActionsPerTurn === -1 ? 4 : Math.min(captureActionsPerTurn - 1, 4);
    internal *= 1 + extra * 0.08;
  }
  const rangedCaptureActionsPerTurn = piece.ranged_capture_actions_per_turn || 1;
  if (rangedCaptureActionsPerTurn > 1 || rangedCaptureActionsPerTurn === -1) {
    const extra = rangedCaptureActionsPerTurn === -1 ? 4 : Math.min(rangedCaptureActionsPerTurn - 1, 4);
    internal *= 1 + extra * 0.07;
  }
  if (piece.capture_on_hop && (canHopAllies || canHopEnemies)) internal *= 1.1;
  if (piece.chain_capture_enabled) {
    internal *= 1.1;
    // max_chain_hops limits chain-capture hops per turn — restriction reduces practical value
    const maxChainHops = piece.max_chain_hops;
    if (maxChainHops === 1) internal *= 0.90;
    else if (maxChainHops === 2) internal *= 0.94;
  }
  if (piece.can_capture_enemy_via_range) {
    const canFireOverAllies  = !!(piece.can_fire_over_allies);
    const canFireOverEnemies = !!(piece.can_fire_over_enemies);
    if (canFireOverAllies || canFireOverEnemies)
      internal *= (canFireOverAllies && canFireOverEnemies) ? 1.15 : 1.1;
    const canHopAtkAllies  = !!(piece.can_hop_attack_over_allies);
    const canHopAtkEnemies = !!(piece.can_hop_attack_over_enemies);
    if (canHopAtkAllies || canHopAtkEnemies)
      internal *= (canHopAtkAllies && canHopAtkEnemies) ? 1.15 : 1.1;
    if (piece.exact_ratio_hop_only_attack) internal *= 0.8;
    if (piece.directional_hop_disabled_attack) internal *= 0.92;
    // directional_hop_only_attack: directional attacks require hopping — significant restriction
    if (piece.directional_hop_only_attack) internal *= 0.88;
    // max_directional_hop_pieces_attack: limits pieces hopped per directional attack
    const maxDirHopAtk = piece.max_directional_hop_pieces_attack;
    if (maxDirHopAtk === 1) internal *= 0.88;
    else if (maxDirHopAtk === 2) internal *= 0.93;
    else if (maxDirHopAtk === 3) internal *= 0.96;
  }
  const minTurns = piece.min_turns_per_move || piece.min_turns_until_movement || 0;
  if (minTurns > 0) internal *= Math.max(0.5, 1 - minTurns * 0.1);

  const hasRatioMove = r1 > 0 && r2 > 0;
  const hasStepMove  = !!(stepStyle && Number(piece.step_by_step_movement_value ?? piece.step_movement_value ?? 0) !== 0);
  // Also check moveSet for custom_movement_squares / special_scenario_moves coverage
  const hasMoveSetForward  = [...moveSet].some(k => { const [,y] = k.split(',').map(Number); return y < cy; });
  const hasMoveSetBackward = [...moveSet].some(k => { const [,y] = k.split(',').map(Number); return y > cy; });
  const hasForward  = !!(piece.up_movement    || piece.up_capture    || piece.up_left_movement    || piece.up_right_movement    || piece.up_left_capture    || piece.up_right_capture)   || hasRatioMove || hasStepMove || hasMoveSetForward;
  const hasBackward = !!(piece.down_movement  || piece.down_capture  || piece.down_left_movement  || piece.down_right_movement  || piece.down_left_capture  || piece.down_right_capture) || hasRatioMove || hasStepMove || hasMoveSetBackward;
  if (!hasForward || !hasBackward) internal *= 0.7;

  // HP scaling
  const hp    = piece.current_hp ?? piece.hit_points ?? 1;
  const maxHp = piece.hit_points || 1;
  if (maxHp > 1) internal *= (0.5 + 0.5 * hp / maxHp);

  const baseVal = Math.max(0.1, Math.round((internal / DIVISOR) * 10) / 10);
  return piece.can_promote ? Math.round((baseVal + 0.5) * 10) / 10 : baseVal;
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

  const otherData = state.otherGameData || {};
  const isPlacementGame = !!otherData.place_pieces_action;
  const isPieceCountGame = !!(state.gameType?.piece_count_condition || isPlacementGame);

  // Determine whether placements should be ordered before regular moves.
  // Default: yes for any piece-count / placement game.
  // Refinement: if the current player already has pieces on the board, only
  // prefer placement when the best placeable piece is at least as valuable as
  // the average of their existing pieces (so the bot doesn't blindly place
  // weak pieces when moving a strong existing piece is better).
  let preferPlacement = isPieceCountGame;
  if (isPlacementGame && isPieceCountGame) {
    const curPos = state.currentTurn;
    const myExisting = state.pieces.filter(p => (p.team || p.player_id) === curPos);
    if (myExisting.length > 0) {
      const avgVal = myExisting.reduce((s, p) => s + getPieceValue(p, bs), 0) / myExisting.length;
      const placeables = Array.isArray(otherData.placeable_pieces) ? otherData.placeable_pieces : [];
      const maxPlaceVal = placeables.length > 0
        ? Math.max(...placeables.map(pp => getPieceValue(pp, bs)))
        : 1; // unknown template — assume minimal value
      preferPlacement = maxPlaceVal >= avgVal;
    }
  }

  // Pre-compute placement quality score for each unique (x,y).
  // Used for ordering placement moves so α-β explores the most promising
  // squares first (threatening opponent pieces, avoiding immediate recapture).
  // This is heuristic-only — correctness is handled by evaluatePosition.
  const placementQuality = new Map();
  if (isPlacementGame) {
    const curPos = state.currentTurn;
    const opponentPos = curPos === 1 ? 2 : 1;
    const opponentPieces = state.pieces.filter(p => (p.team || p.player_id) === opponentPos);
    const scoredKeys = new Set();

    for (const move of moves) {
      if (move.type !== 'place') continue;
      const key = `${move.to.x},${move.to.y}`;
      if (scoredKeys.has(key)) continue;
      scoredKeys.add(key);

      const x = move.to.x;
      const y = move.to.y;
      let q = 0;

      for (const op of opponentPieces) {
        const adx = Math.abs(op.x - x);
        const ady = Math.abs(op.y - y);

        // Proximity bonus: being near opponent pieces is tactically valuable
        // (potential future threats, flanking, control pressure).
        const dist = adx + ady;
        if (dist === 1)      q += 20;
        else if (dist === 2) q += 8;
        else if (dist <= 3)  q += 3;

        // Safety penalty: can this opponent piece immediately capture the placed square?
        // Use the same coordinate-flip logic as evaluatePosition (player 2's "up"
        // direction points toward increasing y in screen coordinates).
        const dx = x - op.x;
        const dy = y - op.y;
        const flipY_op = (op.team || op.player_id) === 2 ? -1 : 1;
        const ddx = dx;
        const ddy = dy * flipY_op; // logical direction: negative = "up" for that player
        const absDdx = Math.abs(ddx);
        const absDdy = Math.abs(ddy);

        let canCapture = false;

        // Ratio (knight-like) captures
        const rc1 = op.ratio_capture_1 || op.ratio_movement_1 || 0;
        const rc2 = op.ratio_capture_2 || op.ratio_movement_2 || 0;
        if (!canCapture && rc1 > 0 && rc2 > 0) {
          if ((absDdx === rc1 && absDdy === rc2) || (absDdx === rc2 && absDdy === rc1)) canCapture = true;
        }

        // Directional (orthogonal / diagonal) captures — only relevant when aligned
        if (!canCapture && (absDdx === 0 || absDdy === 0 || absDdx === absDdy)) {
          const dist2 = Math.max(absDdx, absDdy);
          if (dist2 > 0) {
            let capRange = 0;
            if      (absDdx === 0 && ddy < 0) capRange = op.up_capture || 0;
            else if (absDdx === 0 && ddy > 0) capRange = op.down_capture || 0;
            else if (absDdy === 0 && ddx < 0) capRange = op.left_capture || 0;
            else if (absDdy === 0 && ddx > 0) capRange = op.right_capture || 0;
            else if (ddx < 0 && ddy < 0)      capRange = op.up_left_capture || 0;
            else if (ddx > 0 && ddy < 0)      capRange = op.up_right_capture || 0;
            else if (ddx < 0 && ddy > 0)      capRange = op.down_left_capture || 0;
            else if (ddx > 0 && ddy > 0)      capRange = op.down_right_capture || 0;
            if (capRange >= dist2) canCapture = true;

            // can_capture_enemy_on_move: movement directions also capture
            if (!canCapture && op.can_capture_enemy_on_move) {
              let moveRange = 0;
              if      (absDdx === 0 && ddy < 0) moveRange = op.up_movement || 0;
              else if (absDdx === 0 && ddy > 0) moveRange = op.down_movement || 0;
              else if (absDdy === 0 && ddx < 0) moveRange = op.left_movement || 0;
              else if (absDdy === 0 && ddx > 0) moveRange = op.right_movement || 0;
              else if (ddx < 0 && ddy < 0)      moveRange = op.up_left_movement || 0;
              else if (ddx > 0 && ddy < 0)      moveRange = op.up_right_movement || 0;
              else if (ddx < 0 && ddy > 0)      moveRange = op.down_left_movement || 0;
              else if (ddx > 0 && ddy > 0)      moveRange = op.down_right_movement || 0;
              if (moveRange >= dist2) canCapture = true;
            }
          }
        }

        if (canCapture) q -= 30; // Opponent can immediately recapture — heavily penalise
      }

      placementQuality.set(key, q);
    }
  }

  moves.sort((a, b) => {
    // Placement vs. regular move priority
    if (isPieceCountGame) {
      const aPlace = a.type === 'place' ? 1 : 0;
      const bPlace = b.type === 'place' ? 1 : 0;
      if (aPlace !== bPlace) return preferPlacement ? (bPlace - aPlace) : (aPlace - bPlace);
    }

    // Among placement moves: rank by strategic quality (safe + threatening first)
    if (a.type === 'place' && b.type === 'place') {
      const qA = placementQuality.get(`${a.to.x},${a.to.y}`) ?? 0;
      const qB = placementQuality.get(`${b.to.x},${b.to.y}`) ?? 0;
      if (qA !== qB) return qB - qA;
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
      const isNeutralA = targetA?.is_neutral || (targetA?.player_id === 0 && !targetA?.team);
      const isNeutralB = targetB?.is_neutral || (targetB?.player_id === 0 && !targetB?.team);
      // Neutral pieces are not worth capturing — assign 0 victim value so they sort last
      const victimValA = isNeutralA ? 0 : getPieceValue(targetA, bs);
      const victimValB = isNeutralB ? 0 : getPieceValue(targetB, bs);
      const attackerValA = attackerA ? getPieceValue(attackerA, bs) : 0;
      const attackerValB = attackerB ? getPieceValue(attackerB, bs) : 0;
      // SEE-based ordering: winning captures first, losing captures last.
      // Falls back to MVV-LVA for neutral targets or missing piece data.
      const currentTurn = state.currentTurn;
      const seeA = !isNeutralA && attackerA && targetA
        ? staticExchangeEval(state, a.to.x, a.to.y, attackerA.id, attackerValA, victimValA, currentTurn, bs)
        : (victimValA - attackerValA);
      const seeB = !isNeutralB && attackerB && targetB
        ? staticExchangeEval(state, b.to.x, b.to.y, attackerB.id, attackerValB, victimValB, currentTurn, bs)
        : (victimValB - attackerValB);
      return seeB - seeA;
    }

    // Among non-captures, prefer moves toward center
    const cx = bw / 2, cy = bh / 2;
    const distA = Math.abs(a.to.x - cx) + Math.abs(a.to.y - cy);
    const distB = Math.abs(b.to.x - cx) + Math.abs(b.to.y - cy);
    return distA - distB;
  });
}

// =============================================
// Attacker Enumeration & Static Exchange Evaluation (SEE)
// =============================================

/**
 * Return all pieces belonging to `player` that can capture the square (tx, ty).
 * Covers directional 8-way captures, can_capture_enemy_on_move movement-as-capture,
 * ratio/knight jumps, step-by-step captures, and special_scenario_captures JSON.
 * Results are sorted cheapest-attacker-first for SEE iteration.
 *
 * @param {object} state   - Game state (.pieces, .gameType)
 * @param {number} tx, ty  - Target square coordinates
 * @param {number} player  - Player whose attackers to enumerate (1 or 2)
 * @param {number} bs      - Board size hint (Math.max(boardWidth, boardHeight))
 * @returns {{ piece: object, value: number }[]}  sorted cheapest first
 */
function getAttackersTo(state, tx, ty, player, bs) {
  const bw = state.gameType?.board_width || bs || 8;
  const bh = state.gameType?.board_height || bs || 8;

  // Build position map for path-blocking checks (supports multi-tile pieces)
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

  const attackers = [];

  for (const piece of state.pieces) {
    const owner = piece.team || piece.player_id;
    if (owner !== player) continue;
    if (piece.x === tx && piece.y === ty) continue; // already on the target square

    const flipY = owner === 2 ? -1 : 1;
    let canAttack = false;

    // --- Directional captures + movement-as-capture ---
    // For each of the 8 directions, use the MAX of dedicated capture range and
    // (if can_capture_enemy_on_move) the movement range, so pieces that can capture
    // via movement are never underestimated when they also have a shorter capture range.
    const _ceim = piece.can_capture_enemy_on_move || piece.attacks_like_movement;
    // directional_hop_disabled_attack: can_hop_over_* only applies to ratio jumps, not directional
    // sliding (matching game-socket.js: canHopDirAtk = canHopBase && (!dirHopDisabledAtk || exactFlag))
    const _dhda = !!(piece.directional_hop_disabled_attack === 1 || piece.directional_hop_disabled_attack === true);
    const dirDefs = [
      [0, -1, Math.max(piece.up_capture    || 0, _ceim ? (piece.up_movement    || 0) : 0), !!(piece.up_capture_exact    || (_ceim && piece.up_movement_exact))],
      [0,  1, Math.max(piece.down_capture  || 0, _ceim ? (piece.down_movement  || 0) : 0), !!(piece.down_capture_exact  || (_ceim && piece.down_movement_exact))],
      [-1, 0, Math.max(piece.left_capture  || 0, _ceim ? (piece.left_movement  || 0) : 0), !!(piece.left_capture_exact  || (_ceim && piece.left_movement_exact))],
      [1,  0, Math.max(piece.right_capture || 0, _ceim ? (piece.right_movement || 0) : 0), !!(piece.right_capture_exact || (_ceim && piece.right_movement_exact))],
      [-1,-1, Math.max(piece.up_left_capture    || 0, _ceim ? (piece.up_left_movement    || 0) : 0), !!(piece.up_left_capture_exact    || (_ceim && piece.up_left_movement_exact))],
      [1, -1, Math.max(piece.up_right_capture   || 0, _ceim ? (piece.up_right_movement   || 0) : 0), !!(piece.up_right_capture_exact   || (_ceim && piece.up_right_movement_exact))],
      [-1, 1, Math.max(piece.down_left_capture  || 0, _ceim ? (piece.down_left_movement  || 0) : 0), !!(piece.down_left_capture_exact  || (_ceim && piece.down_left_movement_exact))],
      [1,  1, Math.max(piece.down_right_capture || 0, _ceim ? (piece.down_right_movement || 0) : 0), !!(piece.down_right_capture_exact || (_ceim && piece.down_right_movement_exact))],
    ];

    for (const [ddx, ddy, range, exactFlag] of dirDefs) {
      if (canAttack) break;
      if (!range) continue;
      const limit = range === 99 ? Math.max(bw, bh) : range;
      const dyA = ddy * flipY;
      for (let dist = 1; dist <= limit; dist++) {
        const cx = piece.x + ddx * dist;
        const cy = piece.y + dyA * dist;
        if (cx < 0 || cx >= bw || cy < 0 || cy >= bh) break;
        if (cx === tx && cy === ty) { canAttack = true; break; }
        const blocker = posMap.get(`${cx},${cy}`);
        if (blocker && !piece.ghostwalk) {
          const blockerIsAlly = (blocker.team || blocker.player_id) === player;
          const baseCanHop = blockerIsAlly ? !!piece.can_hop_over_allies : !!piece.can_hop_over_enemies;
          if (!(baseCanHop && (!_dhda || exactFlag))) break;
        }
      }
    }

    // --- Ratio / knight-like jumps ---
    if (!canAttack) {
      const rc1 = piece.ratio_capture_1 || piece.ratio_movement_1 || 0;
      const rc2 = piece.ratio_capture_2 || piece.ratio_movement_2 || 0;
      if (rc1 > 0 && rc2 > 0) {
        const jumps = [
          [rc1, rc2], [rc1, -rc2], [-rc1, rc2], [-rc1, -rc2],
          [rc2, rc1], [rc2, -rc1], [-rc2, rc1], [-rc2, -rc1],
        ];
        for (const [jdx, jdy] of jumps) {
          if (piece.x + jdx === tx && piece.y + jdy === ty) { canAttack = true; break; }
        }
      }
    }

    // --- Step-by-step captures ---
    if (!canAttack) {
      const stepStyle = piece.step_by_step_movement_style || piece.step_movement_style;
      if (stepStyle && (piece.can_capture_enemy_on_move || piece.step_capture_value != null)) {
        const rawVal = piece.step_capture_value ?? piece.step_by_step_movement_value ?? piece.step_movement_value ?? 0;
        const stepVal = Number(rawVal);
        if (!isNaN(stepVal) && stepVal !== 0) {
          const maxS = Math.abs(stepVal);
          const ddxS = tx - piece.x, ddyS = ty - piece.y;
          const dist = stepVal < 0
            ? Math.abs(ddxS) + Math.abs(ddyS)
            : Math.max(Math.abs(ddxS), Math.abs(ddyS));
          if (dist > 0 && dist <= maxS) canAttack = true;
        }
      }
    }

    // --- special_scenario_captures JSON ---
    if (!canAttack && piece.special_scenario_captures) {
      try {
        const ssc = typeof piece.special_scenario_captures === 'string'
          ? JSON.parse(piece.special_scenario_captures)
          : piece.special_scenario_captures;
        if (ssc?.additionalCaptures) {
          const dmap = {
            up: [0,-1], down: [0,1], left: [-1,0], right: [1,0],
            up_left: [-1,-1], up_right: [1,-1], down_left: [-1,1], down_right: [1,1],
          };
          outer: for (const [dir, opts] of Object.entries(ssc.additionalCaptures)) {
            const dd = dmap[dir];
            if (!dd) continue;
            const [ddx2, ddy2] = dd;
            const dyB = ddy2 * flipY;
            for (const opt of (Array.isArray(opts) ? opts : [])) {
              let maxD = opt.value || 0;
              if (opt.infinite) maxD = 99;
              const limit = maxD === 99 ? Math.max(bw, bh) : maxD;
              for (let dist = 1; dist <= limit; dist++) {
                const cx = piece.x + ddx2 * dist;
                const cy = piece.y + dyB * dist;
                if (cx < 0 || cx >= bw || cy < 0 || cy >= bh) break;
                if (cx === tx && cy === ty) { canAttack = true; break outer; }
                if (!opt.canJump) {
                  const blocker = posMap.get(`${cx},${cy}`);
                  if (blocker) break;
                }
              }
            }
          }
        }
      } catch (_) {}
    }

    if (canAttack) {
      attackers.push({ piece, value: getPieceValue(piece, bs) });
    }
  }

  // Cheapest attacker first (essential for correct SEE backward induction)
  attackers.sort((a, b) => a.value - b.value);
  return attackers;
}

/**
 * Static Exchange Evaluation.
 *
 * Simulates the full capture-recapture chain on square (toX, toY), starting
 * with `firstPlayer` capturing a piece worth `capturedValue` using their piece
 * identified by `firstAttackerId` (value `firstAttackerValue`).
 *
 * Both sides always use their cheapest available attacker next, and either side
 * can decline to recapture if it would lose material (backward induction).
 *
 * @returns {number} Net material gain for firstPlayer.
 *                   Positive = winning exchange, negative = losing exchange.
 */
function staticExchangeEval(state, toX, toY, firstAttackerId, firstAttackerValue, capturedValue, firstPlayer, bs) {
  const opponent = firstPlayer === 1 ? 2 : 1;

  // All remaining attackers for each side (cheapest first).
  // The first attacker is already committed — exclude it from the "my remaining" list.
  const myAtks = getAttackersTo(state, toX, toY, firstPlayer, bs)
    .filter(a => a.piece.id !== firstAttackerId);
  const opAtks = getAttackersTo(state, toX, toY, opponent, bs);

  // gains[i] = value of the piece captured on exchange step i.
  // gains[0] = capturedValue (the initial capture, already decided).
  // After step 0, firstAttacker (worth firstAttackerValue) sits on the square.
  // gains[1] = firstAttackerValue if opponent recaptures, etc.
  const gains = [capturedValue];
  let lastVal = firstAttackerValue;
  let myIdx = 0, opIdx = 0;
  let side = opponent; // opponent replies to the initial capture

  for (let step = 0; step < 32; step++) {
    const atks = side === firstPlayer ? myAtks : opAtks;
    const idx  = side === firstPlayer ? myIdx  : opIdx;
    if (idx >= atks.length) break;            // this side has no more attackers

    gains.push(lastVal);                      // capture the piece now on the square
    lastVal = atks[idx].value;                // that attacker is now the next capturable

    if (side === firstPlayer) myIdx++; else opIdx++;
    side = side === firstPlayer ? opponent : firstPlayer;
  }

  // Backward induction: each side can choose not to recapture if it would be a loss.
  // Starting from the last potential capture, work backward: max(0, gains[i] - score).
  let score = 0;
  for (let i = gains.length - 1; i >= 1; i--) {
    score = Math.max(0, gains[i] - score);
  }
  return gains[0] - score;
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
    // Neutral pieces (player 0) belong to neither player — exclude from both sides' material
    if (owner === 0) continue;
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

  // --- Enclosed-region (territory) scoring ---
  // When the game scores enclosed regions (Go-style area/region), value the
  // difference in surrounded territory so the bot plays for the board, not just captures.
  if ((state.otherGameData || {}).enclosed_region_scoring) {
    try {
      const { computeEnclosedRegionScores: cers } = getGameSocket();
      if (typeof cers === 'function') {
        const terr = silent(() => cers(state)) || {};
        score += ((terr[perspective] || 0) - (terr[opponentPos] || 0)) * 12;
      }
    } catch (_) { /* ignore */ }
  }

  // --- Center control (reduced weight) ---
  // Pieces near the center score slightly better, but this is a weak signal
  // that cannot compete with material safety. Max ~2 pts per piece.
  // Edge files (x=0 / x=bw-1) get an explicit small penalty for low-value pieces
  // (pawn-like). A pawn on an edge file controls only one diagonal and cannot
  // contribute to central control — so without this penalty the engine sees
  // pushing an a-pawn as roughly equivalent to pushing a d-pawn.
  const _totalMoves = state.moveCount || 0;
  const edgeFile = (x) => (x === 0 || x === bw - 1);
  const edgeRank = (y) => (y === 0 || y === bh - 1);
  for (const piece of myPieces) {
    const dist = Math.sqrt(
      Math.pow(piece.x - centerX, 2) + Math.pow(piece.y - centerY, 2)
    );
    const proximity = 1 - dist / maxDist;
    const pv = getPieceValue(piece, bs);
    const pieceImportance = Math.min(pv, 10) / 10;
    score += proximity * (1 + pieceImportance * 1);
    // Edge-file penalty for low-value pieces that have left their starting rank.
    // Threshold pv <= 2 covers pawn-class pieces across custom games.
    if (pv > 0 && pv <= 2 && edgeFile(piece.x) && !edgeRank(piece.y)) {
      score -= 3;
    }
  }
  for (const piece of opPieces) {
    const dist = Math.sqrt(
      Math.pow(piece.x - centerX, 2) + Math.pow(piece.y - centerY, 2)
    );
    const proximity = 1 - dist / maxDist;
    const pv = getPieceValue(piece, bs);
    const pieceImportance = Math.min(pv, 10) / 10;
    score -= proximity * (1 + pieceImportance * 1);
    if (pv > 0 && pv <= 2 && edgeFile(piece.x) && !edgeRank(piece.y)) {
      score += 3;
    }
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
    const _dhdaOp = !!(opPiece.directional_hop_disabled_attack === 1 || opPiece.directional_hop_disabled_attack === true);
    
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
            if (existing === undefined || opAttackerValue < existing.value) {
              threatenedByOpponent.set(target.id, { attackerId: opPiece.id, value: opAttackerValue });
            }
          }
          // Path blocked unless hop flags permit AND directional_hop_disabled_attack is not set.
          if (!opPiece.ghostwalk) {
            const blockerIsAlly = targetOwner === opOwner;
            const baseCanHop = blockerIsAlly ? !!opPiece.can_hop_over_allies : !!opPiece.can_hop_over_enemies;
            if (!(baseCanHop && !_dhdaOp)) break;
          }
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
            if (existing === undefined || opAttackerValue < existing.value) {
              threatenedByOpponent.set(target.id, { attackerId: opPiece.id, value: opAttackerValue });
            }
          }
        }
      }
    }
  }
  
  // Penalize our threatened pieces using SEE — this correctly accounts for the full
  // capture-recapture chain, so defending with a lower-value piece still scores correctly.
  for (const myPiece of myPieces) {
    if (!threatenedByOpponent.has(myPiece.id)) continue;
    const myValue = getPieceValue(myPiece, bs);
    if (myPiece.is_royal || myPiece.ends_game_on_capture || myPiece.ends_game_on_checkmate) {
      score -= 60; // Royal piece under attack
    } else {
      const { attackerId, value: atkValue } = threatenedByOpponent.get(myPiece.id);
      // SEE from opponent's perspective: positive means opponent wins the exchange
      const see = staticExchangeEval(state, myPiece.x, myPiece.y,
        attackerId, atkValue, myValue, opponentPos, bs);
      if (see > 0.5) {
        // Opponent wins the exchange — penalize proportionally to material loss.
        // Multiplier is large so a hanging piece can't be outweighed by minor
        // positional gains elsewhere in the eval.
        score -= see * 50;
      } else if (see > -0.5) {
        // Roughly even exchange — mild penalty for being under pressure
        score -= myValue;
      }
      // If see < -0.5: exchange favors us (opponent loses material) — no penalty
    }
  }
  
  // Repeat for our attacks on opponent
  // Map: threatened piece id -> { attackerId, value } of our cheapest attacker
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
    const _dhdaMy = !!(myPiece.directional_hop_disabled_attack === 1 || myPiece.directional_hop_disabled_attack === true);
    
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
            if (existing === undefined || myAttackerValue < existing.value) {
              threatenedByUs.set(target.id, { attackerId: myPiece.id, value: myAttackerValue });
            }
          }
          if (!myPiece.ghostwalk) {
            const blockerIsAlly = (target.team || target.player_id) === myOwner;
            const baseCanHop = blockerIsAlly ? !!myPiece.can_hop_over_allies : !!myPiece.can_hop_over_enemies;
            if (!(baseCanHop && !_dhdaMy)) break;
          }
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
            if (existing === undefined || myAttackerValue < existing.value) {
              threatenedByUs.set(target.id, { attackerId: myPiece.id, value: myAttackerValue });
            }
          }
        }
      }
    }
  }
  
  // Bonus for threatening opponent pieces — use SEE to confirm the threat is real.
  // A big bonus only fires when our capture would win material; an even exchange still
  // scores positive (puts pressure); a losing capture scores nothing.
  for (const opPiece of opPieces) {
    if (!threatenedByUs.has(opPiece.id)) continue;
    const opValue = getPieceValue(opPiece, bs);
    if (opPiece.is_royal || opPiece.ends_game_on_capture || opPiece.ends_game_on_checkmate) {
      score += 30;
    } else {
      const { attackerId, value: atkValue } = threatenedByUs.get(opPiece.id);
      // SEE from our perspective: positive means we win the exchange
      const see = staticExchangeEval(state, opPiece.x, opPiece.y,
        attackerId, atkValue, opValue, perspective, bs);
      if (see > 0.5) {
        // Winning capture available — reward proportionally
        score += see * 30;
      } else if (see > -0.5) {
        // Roughly even exchange — still a mild bonus (puts opponent under pressure)
        score += opValue * 2;
      }
      // If see < -0.5: capturing would lose material — no bonus (SEE root filter at call site handles it)
    }
  }

  // --- Development: penalize moving same piece consecutively with no capture ---
  if (state.lastMovedPieceId && state.movesWithoutCapture > 0) {
    const lastPiece = pieces.find(p => p.id === state.lastMovedPieceId);
    if (lastPiece && lastPiece.moveCount >= 2) {
      const lastOwner = lastPiece.team || lastPiece.player_id;
      const pValue = getPieceValue(lastPiece, bs);
      // Stronger penalty for low-value pieces shuffling, smaller for high-value
      const penalty = pValue < 4 ? 12 : 7;
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
        score += (lastOwner === perspective ? -22 : 22);
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
  {
    let controlSquares = {};
    try {
      if (gameType?.control_squares_string) {
        const parsed = JSON.parse(gameType.control_squares_string);
        if (parsed && typeof parsed === 'object') controlSquares = { ...parsed };
      }
    } catch (e) { /* ignore */ }
    try {
      if (gameType?.special_squares_string) {
        const custom = typeof gameType.special_squares_string === 'string'
          ? JSON.parse(gameType.special_squares_string)
          : gameType.special_squares_string;
        if (custom && typeof custom === 'object') {
          for (const [key, cfg] of Object.entries(custom)) {
            if (cfg && cfg.asControl && !controlSquares[key]) {
              controlSquares[key] = { type: 'control', fromCustom: true, ...(cfg.controlConfig || {}) };
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
    for (const key of Object.keys(controlSquares)) {
      const [x, y] = key.split(',').map(Number);
      const occupant = pieces.find(p => p.x === x && p.y === y);
      if (occupant) {
        const owner = occupant.team || occupant.player_id;
        score += (owner === perspective ? 30 : -30);
      }
    }
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
        score -= 30;
        // Fewer escape moves = more dangerous
        if (myMoves.length <= 2) score -= 25;
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

  // --- Mobility signal (small weight) ---
  score += threatenedByUs.size * 0.5;
  score -= threatenedByOpponent.size * 0.5;

  // --- Opening development: penalise unmoved minor pieces and reward good development ---
  // Uses value tiers (not hardcoded piece names) so it generalises across all game types.
  const totalMoves = _totalMoves;
  if (totalMoves < 20) {
    const openingWeight = Math.max(0, (20 - totalMoves) / 20);
    for (const myPiece of myPieces) {
      if (myPiece.ends_game_on_checkmate || myPiece.ends_game_on_capture || myPiece.is_royal) continue;
      const pValue = getPieceValue(myPiece, bs);
      if (pValue > 20) continue;
      if (!myPiece.hasMoved && (myPiece.moveCount || 0) === 0) {
        score -= 3 * openingWeight;
      }
      // Low-value piece tier: permanent edge-file penalty, small center reward
      if (pValue < 4 && (myPiece.moveCount || 0) >= 1) {
        const edgeDist = Math.min(myPiece.x, bw - 1 - myPiece.x);
        if (edgeDist === 0) score -= 10;
        else if (edgeDist === 1) score -= 5;
        else if (edgeDist >= Math.floor(bw / 4)) score += 2 * openingWeight;
      }
    }
    for (const opPiece of opPieces) {
      if (opPiece.ends_game_on_checkmate || opPiece.ends_game_on_capture || opPiece.is_royal) continue;
      const pValue = getPieceValue(opPiece, bs);
      if (pValue > 20) continue;
      if (!opPiece.hasMoved && (opPiece.moveCount || 0) === 0) {
        score += 3 * openingWeight;
      }
      if (pValue < 4 && (opPiece.moveCount || 0) >= 1) {
        const edgeDist = Math.min(opPiece.x, bw - 1 - opPiece.x);
        if (edgeDist === 0) score += 10;
        else if (edgeDist === 1) score += 5;
        else if (edgeDist >= Math.floor(bw / 4)) score -= 2 * openingWeight;
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

  // SEE filter: skip captures with a negative static exchange to avoid wasting
  // quiescence depth on clearly losing trades (e.g. queen takes defended pawn).
  // If no captures pass the filter, fall back to the full list so forced recaptures
  // in losing positions are still considered.
  const bsQ = Math.max(state.gameType?.board_width || 8, state.gameType?.board_height || 8);
  const goodCaptures = captureMoves.filter(m => {
    if (m.isRangedAttack) return true; // ranged attacks: always consider
    const attacker = state.pieces.find(p => p.id === m.pieceId);
    const target = posMap.get(`${m.to.x},${m.to.y}`);
    if (!attacker || !target) return true; // incomplete data — keep
    if ((target.team || target.player_id) === currentPlayer) return false; // ally — skip
    const see = staticExchangeEval(state, m.to.x, m.to.y,
      attacker.id, getPieceValue(attacker, bsQ), getPieceValue(target, bsQ), currentPlayer, bsQ);
    return see >= 0;
  });
  const capturesToSearch = goodCaptures.length > 0 ? goodCaptures : captureMoves;

  if (maximizing) {
    let maxScore = standPat;
    for (const move of capturesToSearch) {
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
    for (const move of capturesToSearch) {
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
    // Budget per move = a fraction of remaining time, targeting ~8 moves worth of
    // thinking before the clock runs out. Minimum 1s, maximum = base timeLimit.
    // The 1/8 fraction is more generous than the old 3%, letting the hard bot
    // actually reach depth 7-8 on long time controls.
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
      // Healthy clock: spend at most 1/8 of remaining time this move,
      // capped at base timeLimit. Leaves plenty of time for the rest of the game.
      const timeCap = Math.max(1000, Math.min(remainingMs / 8, settings.timeLimit));
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

  // NOTE: the random-move chance (for easy/medium variety) is checked AFTER
  // the instant tactical bailouts below. Otherwise easy/medium would skip
  // obvious escape/capture moves in favor of a 20%/2% random blunder.

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
    if (!m || !m.from) continue; // placement moves have no `from`; skip them
    if (!recentBotPositions[m.pieceId]) recentBotPositions[m.pieceId] = [];
    recentBotPositions[m.pieceId].push({ x: m.from.x, y: m.from.y });
  }

  // Iterative deepening with time limit
  let bestMove = legalMoves[0];
  let bestScore = -Infinity;
  // Board size constant for SEE calls at root (computed once, used in inner loop)
  const bsRoot = Math.max(gameState.gameType?.board_width || 8, gameState.gameType?.board_height || 8);

  // Opening variation seed: a per-game integer used inside the depth loop to add
  // tiny deterministic jitter to positional move scores in the opening.  Seeded
  // from game ID + bot position so it differs each game but is stable within one
  // game's move sequence.  Multiplied by a fraction so the jitter stays ±4 units
  // (negligible vs. tactical scores of 100+, but enough to break equal-score ties
  // and explore different openings between games).
  const gameIdSeed = (typeof gameState.gameId === 'number'
    ? gameState.gameId
    : String(gameState.gameId || '').split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 17)) | 0;
  const openingVariationSeed = (gameIdSeed * 1000003 + botPosition * 7919) | 0;

  // --- Tactical priority ordering ---
  // Scan for immediate threats and opportunities. Tactical moves are sorted to the FRONT
  // of the search at every depth iteration so alpha-beta quickly establishes a tight window
  // from the most critical moves. Non-tactical moves are still searched — the bot needs them
  // for indirect defenses (blocking, developing defenders) that pure-escape enumeration misses.
  // With good moves first, alpha-beta prunes most non-tactical moves automatically.
  const tactics = getTacticalCandidates(gameState, botPosition, bsRoot);
  const tacticalCandidates = tactics.hasTactics
    ? buildTacticalCandidates(legalMoves, tactics, gameState, botPosition, bsRoot)
    : [];

  // --- Instant bailouts for unambiguous tactical situations ---
  // When there is a clearly winning capture or a piece about to be lost for
  // free, return the obvious move immediately without spending the full time
  // budget on search.  Threshold 2.5 catches bishop/knight-level threats; any
  // smaller and even-trade noise starts firing.  All difficulties run these
  // bailouts — a "medium" bot that hangs a free bishop just feels broken.
  // The per-difficulty random-move chance below is still applied for the
  // non-tactical case so easy/medium remain beatable in quiet positions.
  {
    const INSTANT_THRESHOLD = 2.5;
    const opponent = botPosition === 1 ? 2 : 1;
    const urgentCapture = tactics.freeCaptures.length > 0 ? tactics.freeCaptures[0] : null;
    const urgentHang    = tactics.hangingMyPieces.length > 0 ? tactics.hangingMyPieces[0] : null;

    // Bailout A — instant free capture:
    // We have a winning capture worth ≥ 5 pawns AND no hanging piece of ours
    // has a HIGHER urgency (if we're about to lose something more valuable,
    // escaping it is higher priority than capturing).
    if (urgentCapture && urgentCapture.see >= INSTANT_THRESHOLD) {
      const hangUrgency = urgentHang ? urgentHang.see : 0;
      if (hangUrgency < urgentCapture.see + 1.0) {
        // Find legal moves that land on the target square
        const capMoves = legalMoves.filter(m => {
          if (m.to.x !== urgentCapture.piece.x || m.to.y !== urgentCapture.piece.y) return false;
          const atk = gameState.pieces.find(p => p.id === m.pieceId);
          return atk && (atk.team || atk.player_id) === botPosition;
        });
        if (capMoves.length > 0) {
          // Among valid capturers, prefer the cheapest attacker (best SEE)
          capMoves.sort((a, b) => {
            const av = getPieceValue(gameState.pieces.find(p => p.id === a.pieceId), bsRoot);
            const bv = getPieceValue(gameState.pieces.find(p => p.id === b.pieceId), bsRoot);
            return av - bv;
          });
          const chosen = capMoves[0];
          console.log(`[AI] Instant capture: target (${urgentCapture.piece.x},${urgentCapture.piece.y}) SEE=${urgentCapture.see.toFixed(1)}`);
          return chosen;
        }
      }
    }

    // Bailout B — instant escape:
    // A piece of ours is about to be lost with SEE ≥ threshold.
    // Applies even when multiple pieces are hanging — focus on the most urgent.
    // Skip if a free capture has equal or higher priority (taking it first
    // offsets the material and keeps the tempo advantage).
    if (urgentHang && urgentHang.see >= INSTANT_THRESHOLD) {
      const capPriority = urgentCapture ? urgentCapture.see : 0;
      if (capPriority < urgentHang.see - 1.0) {
        const { piece: hungPiece, see: hungSee } = urgentHang;
        const escapeMoves = legalMoves.filter(m => m.pieceId === hungPiece.id);
        if (escapeMoves.length > 0) {
          // Pick the destination with lowest opponent threat (best SEE for us)
          let bestEscape = escapeMoves[0];
          let bestEscapeSee = -Infinity;
          for (const em of escapeMoves) {
            const movedPieces = gameState.pieces.map(p =>
              p.id === hungPiece.id ? { ...p, x: em.to.x, y: em.to.y } : p
            );
            const oppAtks = getAttackersTo(
              { ...gameState, pieces: movedPieces },
              em.to.x, em.to.y, opponent, bsRoot
            );
            const destSee = oppAtks.length === 0 ? 0 :
              -staticExchangeEval(gameState, em.to.x, em.to.y,
                oppAtks[0].piece.id, oppAtks[0].value, hungSee, opponent, bsRoot);
            if (destSee > bestEscapeSee) { bestEscapeSee = destSee; bestEscape = em; }
          }
          console.log(`[AI] Instant escape: piece ${hungPiece.id} SEE=${hungSee.toFixed(1)} -> (${bestEscape.to.x},${bestEscape.to.y})`);
          return bestEscape;
        }
      }
    }
  }

  // Random move chance for easy/medium variety. Runs AFTER instant bailouts
  // so urgent tactical situations are still handled correctly.
  if (settings.randomness > 0 && Math.random() < settings.randomness) {
    const idx = Math.floor(Math.random() * legalMoves.length);
    console.log(`[AI] Random move selected (difficulty: ${difficulty})`);
    return legalMoves[idx];
  }

  const tacticalSet = tacticalCandidates.length > 0
    ? new Set(tacticalCandidates.map(m => `${m.pieceId}:${m.to.x},${m.to.y}`))
    : null;

  if (tactics.hasTactics) {
    console.log(`[AI-TACTICAL] hang=${tactics.hangingMyPieces.length} freecap=${tactics.freeCaptures.length} priority=${tacticalCandidates.length}/${legalMoves.length} depth=${settings.depth}`);
  }

  for (let depth = 1; depth <= settings.depth; depth++) {
    // Don't start a new depth if 75% of time budget is used
    if (Date.now() - startTime > settings.timeLimit * 0.75) break;

    // Build ordered move list: tactical candidates first (sorted by standard ordering),
    // then the remaining legal moves (also sorted). Alpha-beta sees the best tactical
    // moves first, sets a tight window, and prunes non-tactical moves cheaply.
    let orderedMoves;
    if (tacticalSet) {
      const tacticalFirst = legalMoves.filter(m => tacticalSet.has(`${m.pieceId}:${m.to.x},${m.to.y}`));
      const rest = legalMoves.filter(m => !tacticalSet.has(`${m.pieceId}:${m.to.x},${m.to.y}`));
      orderMoves(tacticalFirst, gameState);
      orderMoves(rest, gameState);
      orderedMoves = [...tacticalFirst, ...rest];
    } else {
      orderedMoves = [...legalMoves];
      orderMoves(orderedMoves, gameState);
    }

    // Opening variation: in the first 16 plies add a tiny game-seed jitter to
    // positional (non-capture) move scores so the bot explores different openings
    // each game.  Tactical scores are hundreds of units — a ±8 jitter is invisible
    // there but enough to break ties between equal positional moves.
    const currentPly = gameState.gamePly ?? (gameState.totalHalfMoves || 0);
    const openingJitter = (currentPly < 16 && settings.randomness === 0)
      ? openingVariationSeed : 0;

    let depthBestMove = null;
    let depthBestScore = -Infinity;
    let depthSecondScore = -Infinity;
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

      // Opening jitter: tiny per-move hash perturbation so the bot explores
      // different openings between games.  Only applied in the first 16 plies
      // and only for non-capture positional moves so tactics are unaffected.
      if (openingJitter !== 0) {
        const isCapture = !!gameState.pieces.find(p =>
          p.x === move.to.x && p.y === move.to.y && (p.team || p.player_id) !== botPosition
        );
        if (!isCapture) {
          // Deterministic hash per move so the same position always gets the
          // same jitter within this search, but varies across games via seed.
          const _pid = move.pieceId ?? move.placePieceId;
          const moveSig = (_pid != null ? (_pid.charCodeAt ? _pid.charCodeAt(0) : _pid) : 0) +
            move.to.x * 13 + move.to.y * 97;
          moveScore += ((moveSig * openingJitter) % 8) - 4; // range ±4 units
        }
      }

      // Penalize moving the same piece as last bot move (encourages developing different pieces)
      if (lastBotMove && move.pieceId === lastBotMove.pieceId && !lastBotMove.captured) {
        const piece = gameState.pieces.find(p => p.id === move.pieceId);
        if (piece) {
          const pValue = getPieceValue(piece, bsRoot);
          const penalty = pValue < 4 ? 25 : 12;
          moveScore -= penalty;
        }
      }

      // Heavy penalty for moving a piece back to a position it was recently at (back-and-forth)
      const positions = recentBotPositions[move.pieceId];
      if (positions) {
        for (const pos of positions) {
          if (pos.x === move.to.x && pos.y === move.to.y) {
            moveScore -= 40;
            break;
          }
        }
      }

      // Extra penalty for undoing the last move exactly (A→B then B→A)
      if (lastBotMove && lastBotMove.from && move.pieceId === lastBotMove.pieceId &&
          move.to.x === lastBotMove.from.x && move.to.y === lastBotMove.from.y) {
        moveScore -= 50;
      }

      // SEE root penalty: strongly penalize losing captures so the bot never sacrifices
      // a high-value piece for a defended low-value target (e.g. queen for a defended pawn).
      if (move.to) {
        const attackerPiece = gameState.pieces.find(p => p.id === move.pieceId);
        const targetPiece = gameState.pieces.find(p =>
          p.x === move.to.x && p.y === move.to.y && (p.team || p.player_id) !== botPosition
        );
        if (attackerPiece && targetPiece) {
          const see = staticExchangeEval(gameState, move.to.x, move.to.y,
            attackerPiece.id, getPieceValue(attackerPiece, bsRoot),
            getPieceValue(targetPiece, bsRoot), botPosition, bsRoot);
          if (see < -1.0) {
            moveScore += see * 25; // raised from ×15: bigger penalty for losing captures
          }
        }
      }

      if (moveScore > depthBestScore) {
        depthSecondScore = depthBestScore; // track runner-up for early-exit check
        depthBestScore = moveScore;
        depthBestMove = move;
      } else if (moveScore > depthSecondScore) {
        depthSecondScore = moveScore;
      }
    }

    if (depthBestMove && !timedOut) {
      const prevBestId  = bestMove ? `${bestMove.pieceId}:${bestMove.to?.x},${bestMove.to?.y}` : null;
      const thisBestId  = `${depthBestMove.pieceId}:${depthBestMove.to?.x},${depthBestMove.to?.y}`;
      const prevScore   = bestScore;
      bestMove  = depthBestMove;
      bestScore = depthBestScore;
      console.log(`[AI] Depth ${depth} complete: score=${bestScore} margin=${(depthBestScore - depthSecondScore).toFixed(1)} (${Date.now() - startTime}ms)`);

      // Early termination: if the best move has been stable for 2 consecutive depths
      // and it wins by a large margin over the 2nd best, there is no point searching
      // deeper — the extra depth will almost certainly confirm the same choice.
      // Only apply at depth ≥ 3 to avoid stopping on shallow flukes.
      if (depth >= 3 && thisBestId === prevBestId) {
        const margin = depthBestScore - depthSecondScore;
        if (margin > 80) {
          console.log(`[AI] Early exit at depth ${depth}: stable move, margin=${margin.toFixed(1)}`);
          break;
        }
      }
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
  // Exposed for testing / analysis scripts
  getMovesForSearch,
  checkTerminal,
  applyMove,
  getAttackersTo,
  staticExchangeEval,
};
