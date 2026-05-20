/**
 * Fairy-Stockfish Compatibility Checker
 *
 * Determines whether a given game_type + its pieces + placements can be
 * expressed as a Fairy-Stockfish variant. Used both server-side (API
 * endpoint, admin tab) and indirectly by the client (Play.js gates the
 * "Fairy Stockfish" computer player option on this result).
 *
 * A `compatible: true` result does NOT depend on randomization mode; the
 * frontend additionally gates the FS option when the user picks an
 * incompatible randomization mode at lobby time (independent / shared / full).
 */

const MAX_BOARD_DIM = 12;

const RANDOMIZATION_INCOMPATIBLE = new Set(['independent', 'shared', 'full']);

const PIECE_DIRECTIONAL_KEYS = [
  'up_left', 'up', 'up_right', 'right',
  'down_right', 'down', 'down_left', 'left'
];

function toBool(v) {
  if (v === true || v === 1 || v === '1') return true;
  return false;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseJsonSafe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

/**
 * Inspect the raw piece row (from the `pieces` table) for any feature that
 * cannot be expressed in Betza / Fairy-Stockfish variant config.
 *
 * Returns an array of structured reason objects of the form:
 *   { category, source, sourceName, field, message, fix? }
 *
 * - `category` is one of: 'game' | 'piece' | 'placement'
 * - `source` identifies which row triggered it (e.g. piece_name)
 * - `field` is the DB column / flag name
 * - `message` is human-readable
 * - `fix` (optional) suggests how to make the game compatible
 *
 * @param {object}  piece    - row from the `pieces` table.
 * @param {boolean} isRoyal  - true when this piece is the royal (checkmate-target)
 *                             piece for this game. Royal pieces are inherently
 *                             uncapturable in Fairy-Stockfish, so cannot_be_captured
 *                             on a royal piece is not an incompatibility.
 */
function pieceIncompatReasons(piece, isRoyal = false) {
  const reasons = [];
  if (!piece) return reasons;
  const name = piece.piece_name || `Piece #${piece.id}`;
  const push = (field, message, fix) => reasons.push({
    category: 'piece', source: 'pieces', sourceName: name, field, message, fix,
  });

  if (toInt(piece.piece_width) > 1 || toInt(piece.piece_height) > 1) {
    push('piece_width/piece_height',
      `Multi-tile piece (${piece.piece_width}×${piece.piece_height}). Fairy-Stockfish only supports 1×1 pieces.`,
      'Edit the piece in the piece wizard (Step 1) and set both width and height to 1.');
  }
  if (toBool(piece.step_by_step_movement_style) || toBool(piece.step_by_step_attack_style)) {
    push('step_by_step_movement_style',
      'Uses step-by-step movement (no equivalent in classical chess engines).',
      'In the piece wizard, disable "Step-by-step movement / attack style" in Step 2 / Step 3.');
  }
  if (toBool(piece.directional_movement_change) || toBool(piece.directional_capture_change)) {
    push('directional_movement_change',
      'Uses direction-change (two-leg) movement.',
      'In the piece wizard, disable directional movement / capture change in Step 2 / Step 3.');
  }
  if (toBool(piece.trample)) {
    push('trample', 'Has trample.',
      'Disable "Trample" in the piece wizard (Step 4 Special Abilities).');
  }
  if (toBool(piece.ghostwalk)) {
    push('ghostwalk', 'Has ghostwalk.',
      'Disable "Ghostwalk" in the piece wizard (Step 4 Special Abilities).');
  }
  if (toInt(piece.attack_radius) > 0) {
    push('attack_radius', `Has AoE attack radius (${piece.attack_radius}).`,
      'Set Attack Radius to 0 in the piece wizard (Step 4).');
  }
  if (toBool(piece.die_on_capture) && !toBool(piece.die_on_capture_grants_win)) {
    push('die_on_capture',
      'Dies on capture without granting a win.',
      'Disable "Die on capture" in the piece wizard, or enable "Die on capture grants win".');
  }
  if (toBool(piece.can_fire_over_allies) || toBool(piece.can_fire_over_enemies)) {
    push('can_fire_over_allies',
      'Has ranged firing (attack-without-moving).',
      'Disable ranged firing in the piece wizard (Step 3).');
  }
  if (toBool(piece.can_capture_allies)) {
    push('can_capture_allies', 'Can capture allies (friendly fire).',
      'Disable "Can capture allies" in the piece wizard.');
  }
  // Royal pieces (checkmate/capture-loss targets) are inherently uncapturable
  // in Fairy-Stockfish via the checkmate mechanic - don't flag them.
  if (toBool(piece.cannot_be_captured) && !isRoyal) {
    push('cannot_be_captured', 'Cannot be captured (non-royal).',
      'Disable "Cannot be captured" in the piece wizard, or mark this piece as the checkmate / capture-loss target in Step 4 of the game wizard.');
  }
  if (toBool(piece.must_move_if_able)) {
    push('must_move_if_able', 'Must move if able.',
      'Disable "Must move if able" in the piece wizard (Step 4).');
  }
  if (toBool(piece.chain_capture_enabled)) {
    push('chain_capture_enabled', 'Has chain capture (checkers-style multi-jump).',
      'Disable "Chain capture" in the piece wizard (Step 4).');
  }

  // Custom freeform movement / attack squares: incompatible only when the
  // pattern can't be expressed as a Betza leaper subset (e.g. single isolated
  // squares within an oblique leaper, which would need v/s sub-modifiers).
  const translator = require('./fairy-stockfish-translator');
  const customMove = parseJsonSafe(piece.custom_movement_squares, []);
  const customAtk = parseJsonSafe(piece.custom_attack_squares, []);
  if (Array.isArray(customMove) && customMove.length > 0) {
    const chunks = translator.customSquaresToBetza(customMove, 'm');
    if (chunks === null) {
      push('custom_movement_squares',
        'Custom movement squares use a pattern that has no Betza equivalent (an oblique-leaper subset that can\'t be expressed as a forward/back/left/right or quadrant slice).',
        'Edit the custom movement squares in the piece wizard (Step 2) so they cover a full leaper ring or a symmetric subset (e.g. all 4 forward squares, or a quadrant pair).');
    }
  }
  if (Array.isArray(customAtk) && customAtk.length > 0) {
    const chunks = translator.customSquaresToBetza(customAtk, 'c');
    if (chunks === null) {
      push('custom_attack_squares',
        'Custom attack squares use a pattern that has no Betza equivalent.',
        'Edit the custom attack squares in the piece wizard (Step 3) so they cover a full leaper ring or a symmetric subset.');
    }
  }

  // Additional movements / scenarios on direction (the `special_scenario_*` JSON columns)
  const ssMoves = parseJsonSafe(piece.special_scenario_moves, null);
  if (ssMoves && typeof ssMoves === 'object') {
    for (const key of Object.keys(ssMoves)) {
      const arr = ssMoves[key];
      if (Array.isArray(arr) && arr.some(a => a && (toInt(a.value) !== 0 || a.infinite))) {
        push('special_scenario_moves',
          'Has additional alternate movements (multiple movement options per direction).',
          'Remove the alternate movements in the piece wizard (Step 2 - Additional movements).');
        break;
      }
    }
  }
  const ssCap = parseJsonSafe(piece.special_scenario_capture, null);
  if (ssCap && typeof ssCap === 'object') {
    for (const key of Object.keys(ssCap)) {
      const arr = ssCap[key];
      if (Array.isArray(arr) && arr.some(a => a && (toInt(a.value) !== 0 || a.infinite))) {
        push('special_scenario_capture',
          'Has additional alternate captures.',
          'Remove the alternate captures in the piece wizard (Step 3 - Additional captures).');
        break;
      }
    }
  }

  return reasons;
}

/**
 * Inspect a single placement row (from `game_type_pieces`) for per-placement
 * overrides that the engine cannot handle (HP/AD combat, etc.).
 *
 * Note: hit_points=1 and attack_damage=1 are the DEFAULT values that represent
 * regular one-hit capture, so we only flag HP/AD when they exceed 1 (true HP combat).
 */
function placementIncompatReasons(placement, pieceName) {
  const reasons = [];
  if (!placement) return reasons;
  const label = pieceName
    ? `${pieceName} at (${placement.x},${placement.y}) p${placement.player_number}`
    : `placement #${placement.id}`;
  const push = (field, message, fix, safeToIgnore = false) => reasons.push({
    category: 'placement', source: 'game_type_pieces', sourceName: label, field, message, fix, safeToIgnore,
  });

  // Default HP=1, AD=1 means regular capture. Only > 1 is real HP combat.
  if (toInt(placement.hit_points) > 1 || toInt(placement.attack_damage) > 1) {
    push('hit_points/attack_damage',
      `HP/AD combat (HP=${placement.hit_points}, AD=${placement.attack_damage}). Fairy-Stockfish only supports one-hit captures.`,
      'In the game wizard (Step 4 Piece Placement), set HP and Attack Damage both to 1 on this placement.');
  }
  if (toInt(placement.burn_damage) > 0) {
    push('burn_damage', `Uses burn damage (${placement.burn_damage}).`,
      'Set Burn Damage to 0 on this placement.');
  }
  if (toBool(placement.trample) || toInt(placement.trample_radius) > 0) {
    push('trample', 'Placement override enables trample.',
      'Disable Trample on this placement in the game wizard.');
  }
  if (toBool(placement.ghostwalk)) {
    push('ghostwalk', 'Placement override enables ghostwalk.',
      'Disable Ghostwalk on this placement.');
  }
  if (toInt(placement.attack_radius) > 0) {
    push('attack_radius', `Placement override gives AoE attack radius (${placement.attack_radius}).`,
      'Set Attack Radius to 0 on this placement.');
  }
  if (toBool(placement.die_on_capture) && !toBool(placement.die_on_capture_grants_win)) {
    push('die_on_capture', 'Placement override enables die-on-capture without grants-win.',
      'Disable Die-On-Capture on this placement, or enable Die-On-Capture Grants Win.');
  }
  if (toBool(placement.cannot_be_captured)) {
    push('cannot_be_captured', 'Placement override marks this piece uncapturable.',
      'Disable "Cannot be captured" on this placement.');
  }
  if (toBool(placement.is_neutral)) {
    // Safe-to-ignore: the translator renders neutral pieces as the
    // opponent of the side-to-move in every per-move FEN, so the engine
    // sees them as captureable enemy pieces and never tries to move them
    // itself. The server's real move validator still enforces chessus's
    // actual neutral-piece rules. The bot doesn't "understand" that
    // neutrals are shared (e.g. that the human could also capture them),
    // but in practice this plays acceptably.
    push('is_neutral',
      'Neutral piece (belongs to no player).',
      'Fairy-Stockfish treats neutral pieces as enemy pieces it can capture. The engine doesn\'t fully understand them. Play anyway, or reassign this piece to a player in Step 4 Piece Placement.',
      true);
  }
  return reasons;
}

/**
 * Check whether a game type can be played by Fairy-Stockfish.
 *
 * @param {object} gameType   - row from `game_types` (may include parsed
 *                              other_game_data via `otherGameData`).
 * @param {Array}  pieceDefs  - array of piece rows referenced by this game.
 * @param {Array}  placements - rows from `game_type_pieces` for this game.
 * @returns {{compatible: boolean, reasons: string[]}}
 */
function checkCompatibility(gameType, pieceDefs = [], placements = []) {
  const reasons = [];
  if (!gameType) {
    return {
      compatible: false,
      reasons: [{ category: 'game', source: 'game_types', sourceName: '(missing)', field: 'id', message: 'Game type not found.' }],
    };
  }
  const pushGame = (field, message, fix, safeToIgnore = false) => reasons.push({
    category: 'game', source: 'game_types', sourceName: gameType.game_name || `Game #${gameType.id}`,
    field, message, fix, safeToIgnore,
  });

  // ---- Game-level rule flags ----
  // `safe` (4th arg to pushGame) means the engine can ignore this rule and
  // still produce legal moves -- it only affects scoring/visibility, not how
  // pieces move. The translation endpoint will let users "play anyway" past
  // these without blocking, but real movement-changing rules still block.
  if (toBool(gameType.simultaneous_turns)) pushGame('simultaneous_turns',
    'Simultaneous turns.',
    'Disable "Simultaneous turns" in the game wizard (Step 1).');
  if (toBool(gameType.fog_of_war)) pushGame('fog_of_war',
    'Fog of war: the engine sees the full board (gameState.pieces is unfiltered on the client), so play is legal, but the engine itself does not model fog -- it picks its moves with full information rather than respecting hidden squares.',
    'Disable "Fog of war" in the game wizard (Step 1).', true);
  if (toInt(gameType.actions_per_turn) > 1) pushGame('actions_per_turn',
    `Multiple actions per turn (${gameType.actions_per_turn}).`,
    'Set Actions Per Turn to 1 in the game wizard (Step 1).');
  if (toBool(gameType.start_repositions)) pushGame('start_repositions',
    'Pre-game repositioning.',
    'Disable "Allow start repositions" in the game wizard (Step 4).');
  if (toBool(gameType.piece_count_condition)) pushGame('piece_count_condition',
    'Piece-count (Othello-style) win condition -- engine will not optimize for it.',
    'Disable "Piece Count Condition" in the game wizard (Step 2 Win Conditions).', true);
  if (toBool(gameType.squares_condition)) pushGame('squares_condition',
    'Squares-controlled win condition -- engine will not optimize for it.',
    'Disable "Control Squares Condition" in the game wizard (Step 2).', true);
  if (toInt(gameType.points_to_win) > 0) pushGame('points_to_win',
    'Points-to-win scoring -- engine will not optimize for it.',
    'Disable "Points Win Condition" in the game wizard (Step 2).', true);
  if (toBool(gameType.optional_condition)) pushGame('optional_condition',
    'Optional / custom win condition -- engine will not optimize for it.',
    'Clear the Optional Condition ID in the game wizard (Step 2).', true);

  // other_game_data flags
  const ogd = parseJsonSafe(gameType.other_game_data ?? gameType.otherGameData, {}) || {};
  if (toBool(ogd.place_pieces_action)) pushGame('place_pieces_action',
    'In-game piece placement action.',
    'Disable the in-game placement action in the game wizard (Step 4).');

  // Board size cap (hard limit of the shipped fairy-stockfish-nnue.wasm build)
  if (toInt(gameType.board_width) > MAX_BOARD_DIM || toInt(gameType.board_height) > MAX_BOARD_DIM) {
    pushGame('board_width/board_height',
      `Board is ${gameType.board_width}x${gameType.board_height}; the Fairy Stockfish WebAssembly build we ship is hard-capped at ${MAX_BOARD_DIM}x${MAX_BOARD_DIM}.`,
      `Reduce board dimensions to at most ${MAX_BOARD_DIM}x${MAX_BOARD_DIM} in the game wizard (Step 3), or play against our built-in bot which has no board-size limit.`);
  }

  // ---- Piece-level checks ----
  const pieceById = new Map();
  for (const p of pieceDefs) {
    if (p && p.id != null) pieceById.set(p.id, p);
  }

  // Only check pieces that are actually placed in the game (avoid penalising
  // a creator for unrelated pieces that happen to exist).
  const usedPieceIds = new Set();
  // Identify royal pieces: placements marked as checkmate or capture-loss targets.
  const royalIds = new Set();
  for (const pl of placements) {
    const pid = pl?.piece_id ?? pl?.pieceId;
    if (pid != null) {
      usedPieceIds.add(pid);
      if (toBool(pl.ends_game_on_checkmate) || toBool(pl.ends_game_on_capture)) {
        royalIds.add(pid);
      }
    }
  }

  for (const pid of usedPieceIds) {
    const piece = pieceById.get(pid);
    if (!piece) continue;
    for (const r of pieceIncompatReasons(piece, royalIds.has(pid))) reasons.push(r);
  }

  // ---- Placement override checks ----
  for (const pl of placements) {
    const piece = pl?.piece_id != null ? pieceById.get(pl.piece_id) : null;
    const pieceName = piece?.piece_name;
    for (const r of placementIncompatReasons(pl, pieceName)) reasons.push(r);
  }

  // Dedupe reasons by (category, sourceName, field) - keeps the count tight
  // while preserving distinct issues across different sources.
  const seen = new Set();
  const dedup = [];
  for (const r of reasons) {
    const key = `${r.category}|${r.sourceName}|${r.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(r);
  }
  return {
    compatible: dedup.length === 0,
    reasons: dedup,
  };
}

/**
 * Whether the given starting mode (from the host game lobby) is compatible
 * with Fairy-Stockfish. Modes that produce asymmetric/unconstrained random
 * positions cannot be expressed as a single FEN startpos.
 */
function isStartingModeCompatible(mode) {
  if (!mode) return true;
  return !RANDOMIZATION_INCOMPATIBLE.has(String(mode));
}

module.exports = {
  checkCompatibility,
  isStartingModeCompatible,
  pieceIncompatReasons,
  placementIncompatReasons,
  RANDOMIZATION_INCOMPATIBLE,
  MAX_BOARD_DIM,
};
