/**
 * Fairy-Stockfish Translation Layer (server)
 *
 * Converts a Chessus game_type + piece definitions + live board state into
 * the inputs expected by the Fairy-Stockfish UCI engine:
 *
 *   - A `variants.ini` block (Betza notation per piece + variant rule flags)
 *   - A FEN string for the current position
 *   - A UCI move-history string (for opening-book awareness)
 *
 * It also converts a UCI bestmove string back into the
 * `{ pieceId, from:{x,y}, to:{x,y} }` shape that
 * `validateAndApplyMove(gameState, move)` expects.
 *
 * The functions here are deliberately PURE (no DB, no IO). The caller is
 * responsible for fetching the rows and shaping the inputs.
 *
 * Coordinate system note
 * ----------------------
 * Chessus stores piece positions as { x, y } where x in [1..board_width]
 * and y in [1..board_height]. Player 1's home rank is y=1. Player 2's home
 * rank is y=board_height. We map x -> file (a + x - 1) and y -> rank y.
 * Player 1 is "white" (uppercase), Player 2 is "black" (lowercase).
 *
 * Char map
 * --------
 * Fairy-Stockfish identifies piece types by single ASCII letters. We pick
 * stable letters per piece-type id within a single game type:
 *   - 'K' for the royal (mate / capture-loss) piece if exactly one is found.
 *   - 'P' for any piece that looks like a pawn (forward-only single-step
 *     movement + diagonal capture).
 *   - Remaining unique piece-type ids get the next free letter from
 *     'QRBNACDEFGHIJLMOSTUVWXYZ' (any letter we haven't already assigned).
 * The map is keyed by `piece.id` (the entry in the `pieces` table). When a
 * placement references the same piece id, it gets the same char.
 */

// ---------- helpers ----------

function toBool(v) {
  return v === true || v === 1 || v === '1';
}
function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Movement value semantics in the DB:
//   0  = none
//  99  = infinite slider
//  N>0 = step of length up to N (or exact if `_exact`)
const INF = 99;

function isInf(v) { return toInt(v, 0) === INF; }

const DIRS = ['up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'];
const ORTHO_DIRS = ['up', 'down', 'left', 'right'];
const DIAG_DIRS = ['up_left', 'up_right', 'down_left', 'down_right'];

// Betza direction modifier for a given chessus direction (from Player 1's POV).
// f = forward (toward higher y), b = backward, l = left (file--), r = right (file++).
// Diagonals use combinations: fl, fr, bl, br.
const DIR_TO_BETZA = {
  up:         'f',
  down:       'b',
  left:       'l',
  right:      'r',
  up_left:    'fl',
  up_right:   'fr',
  down_left:  'bl',
  down_right: 'br',
};

// ---------- char map ----------

/**
 * Decide which piece template "looks like" a king (royal) or a pawn.
 * Inputs:
 *   pieceDefs - piece template rows
 *   placements - game_type_pieces rows; used to identify royal placement
 *                because the king-ness lives on the placement.
 */
function classifyPieces(pieceDefs, placements) {
  // True royals: pieces marked as the checkmate-target. These become 'K'
  // and Fairy-Stockfish handles them with check/checkmate logic.
  const royalIds = new Set();
  // Extinction-loss pieces: pieces whose CAPTURE ends the game without going
  // through check/checkmate (e.g. Knightfall's knights). Fairy-Stockfish
  // models these with `extinctionValue = loss` + `extinctionPieceTypes`.
  // Important: do NOT assign them 'K' or treat them as checkmate-royals,
  // because there can be multiple per side and the variant has no king.
  const extinctionLossIds = new Set();
  for (const pl of placements || []) {
    if (pl.piece_id == null) continue;
    if (toBool(pl.ends_game_on_checkmate)) {
      royalIds.add(pl.piece_id);
    } else if (toBool(pl.ends_game_on_capture)) {
      extinctionLossIds.add(pl.piece_id);
    }
  }

  const pawnIds = new Set();
  for (const p of pieceDefs) {
    if (!p) continue;
    // Pawn-ish: a forward orthogonal/diagonal single-step move-only that
    // captures only via a forward diagonal.
    const fwdMove = toInt(p.up_movement) > 0 && toInt(p.up_movement) <= 2;
    const fwdCapL = toInt(p.up_left_capture) > 0;
    const fwdCapR = toInt(p.up_right_capture) > 0;
    const noBack = toInt(p.down_movement) === 0 && toInt(p.down_capture) === 0;
    const noSide = toInt(p.left_movement) === 0 && toInt(p.right_movement) === 0;
    if (fwdMove && (fwdCapL || fwdCapR) && noBack && noSide && !royalIds.has(p.id) && !extinctionLossIds.has(p.id)) {
      pawnIds.add(p.id);
    }
  }

  return { royalIds, extinctionLossIds, pawnIds };
}

const LETTER_POOL = 'QRBNACDEGHIJLMOSTUVWXYZ'; // K and P are reserved

/**
 * Build the per-piece-template character mapping used in FEN and Betza
 * definitions. Returns:
 *   { byPieceId: Map<pieceId, char>, royalChars: Set<char>, pawnChars: Set<char> }
 */
function buildCharMap(pieceDefs, placements) {
  const { royalIds, extinctionLossIds, pawnIds } = classifyPieces(pieceDefs, placements);
  const byPieceId = new Map();
  const usedChars = new Set();
  const royalChars = new Set();
  const pawnChars = new Set();
  const extinctionLossChars = new Set();
  // Track piece IDs that have cannot_be_captured (excluding royals, which are
  // already uncapturable in FS via the checkmate / capture-loss mechanic).
  const cannotBeCapturedIds = new Set();
  for (const p of pieceDefs) {
    if (p && toBool(p.cannot_be_captured) && !royalIds.has(p.id)) {
      cannotBeCapturedIds.add(p.id);
    }
  }

  // Assign K to first royal piece template (only one supported as primary royal).
  let kingAssigned = false;
  for (const id of royalIds) {
    if (!kingAssigned) {
      byPieceId.set(id, 'K');
      usedChars.add('K');
      royalChars.add('K');
      kingAssigned = true;
    }
  }

  // Assign P to first pawn-like template.
  let pawnAssigned = false;
  for (const id of pawnIds) {
    if (!pawnAssigned && !byPieceId.has(id)) {
      byPieceId.set(id, 'P');
      usedChars.add('P');
      pawnChars.add('P');
      pawnAssigned = true;
    }
  }

  // Assign remaining piece-type ids from the pool, in id order for stability.
  const remaining = pieceDefs
    .filter((p) => p && !byPieceId.has(p.id))
    .sort((a, b) => a.id - b.id);

  let poolIdx = 0;
  for (const p of remaining) {
    while (poolIdx < LETTER_POOL.length && usedChars.has(LETTER_POOL[poolIdx])) {
      poolIdx++;
    }
    if (poolIdx >= LETTER_POOL.length) {
      // Ran out of letters — cannot translate
      return null;
    }
    const ch = LETTER_POOL[poolIdx++];
    byPieceId.set(p.id, ch);
    usedChars.add(ch);
    if (royalIds.has(p.id)) royalChars.add(ch);
    if (pawnIds.has(p.id)) pawnChars.add(ch);
    if (extinctionLossIds.has(p.id)) extinctionLossChars.add(ch);
  }

  // Track extinction-loss chars for any piece that already had a letter
  // assigned (defensive; usually no overlap).
  for (const id of extinctionLossIds) {
    const ch = byPieceId.get(id);
    if (ch) extinctionLossChars.add(ch);
  }

  return { byPieceId, royalChars, pawnChars, extinctionLossChars, cannotBeCapturedIds };
}

// ---------- Betza translation ----------

/**
 * Group directional movement values into atoms. For each (orthogonal,
 * diagonal) group we look at whether all four values are equal (covers all
 * directions of that group), or whether only forward/backward/sideways
 * subsets are filled, and emit Betza atoms with direction prefixes.
 *
 * Returns an array of Betza chunks ready to be joined into a single Betza
 * string. Each chunk is one of:
 *    "{prefix?}{n?}{atom}"     e.g. "R", "fW", "2fW", "fmW", etc.
 *
 * isCapture: when true, only use these directions for captures (we emit a
 *            "c" prefix). When false, only for movement (emit "m").
 */
function emitAtomsForGroup(piece, group, isCapture, mcPrefixOverride) {
  // group = ORTHO_DIRS or DIAG_DIRS
  const atom = group === ORTHO_DIRS ? 'W' : 'F';
  const sliderAtom = group === ORTHO_DIRS ? 'R' : 'B';
  const suffix = group === ORTHO_DIRS ? 'movement' : 'movement';
  const capSuffix = 'capture';

  // Pull per-direction value + exact flag.
  const vals = {};
  for (const d of group) {
    const colVal = isCapture ? `${d}_${capSuffix}` : `${d}_${suffix}`;
    const colExact = isCapture ? `${d}_capture_exact` : `${d}_movement_exact`;
    vals[d] = {
      v: toInt(piece[colVal], 0),
      exact: toBool(piece[colExact]),
    };
  }

  const chunks = [];
  const prefix = (mcPrefixOverride != null) ? mcPrefixOverride : (isCapture ? 'c' : 'm');

  // Group adjacent directions sharing the same (v, exact) signature.
  // First, try the "all four directions identical" shortcut for nicer output.
  const allSame = group.every(d =>
    vals[d].v === vals[group[0]].v && vals[d].exact === vals[group[0]].exact
  );
  const allZero = group.every(d => vals[d].v === 0);
  if (allZero) return chunks;

  if (allSame) {
    const sig = vals[group[0]];
    chunks.push(buildAtomChunk(sig, atom, sliderAtom, prefix, ''));
    return chunks;
  }

  // Otherwise, emit one chunk per non-zero direction with that direction's
  // Betza prefix (f / b / l / r / fl / fr / bl / br).
  for (const d of group) {
    if (vals[d].v === 0) continue;
    const dirPrefix = DIR_TO_BETZA[d] || '';
    chunks.push(buildAtomChunk(vals[d], atom, sliderAtom, prefix, dirPrefix));
  }
  return chunks;
}

// ---------- custom squares -> Betza ----------

/**
 * Pick a Betza atom name for a leaper of canonical size (m, n).
 * m = max(|row|, |col|), n = min(|row|, |col|).
 */
function atomForLeaper(m, n) {
  if (n === 0) {
    if (m === 1) return 'W'; // wazir
    if (m === 2) return 'D'; // dabbaba
  }
  if (m === n) {
    if (m === 1) return 'F'; // ferz
    if (m === 2) return 'A'; // alfil
  }
  if (m === 2 && n === 1) return 'N'; // knight
  if (m === 3 && n === 1) return 'C'; // camel
  if (m === 3 && n === 2) return 'Z'; // zebra
  return `(${m},${n})`;
}

/**
 * For a canonical (m, n) leaper, return a map from Betza direction prefix
 * to the set of `{row, col}` offset keys it covers.
 * Offset keys are formatted "row,col" with explicit signs (e.g. "-2,1").
 *
 * Convention: row < 0 = forward (toward opponent home, matching Chessus's
 * "up" direction which maps to Betza 'f'); col > 0 = right (Betza 'r').
 */
function directionGroupsFor(m, n) {
  if (n === 0) {
    // Orthogonal leaper (W, D): 4 distinct squares.
    return {
      f:  [`-${m},0`],
      b:  [`${m},0`],
      r:  [`0,${m}`],
      l:  [`0,-${m}`],
    };
  }
  if (m === n) {
    // Diagonal leaper (F, A): 4 distinct squares.
    return {
      f:  [`-${m},${m}`, `-${m},-${m}`],
      b:  [`${m},${m}`, `${m},-${m}`],
      r:  [`-${m},${m}`, `${m},${m}`],
      l:  [`-${m},-${m}`, `${m},-${m}`],
      fr: [`-${m},${m}`],
      fl: [`-${m},-${m}`],
      br: [`${m},${m}`],
      bl: [`${m},-${m}`],
    };
  }
  // Oblique leaper (N, C, Z, etc.): 8 distinct squares.
  return {
    f:  [`-${m},${n}`, `-${m},-${n}`, `-${n},${m}`, `-${n},-${m}`],
    b:  [`${m},${n}`,  `${m},-${n}`,  `${n},${m}`,  `${n},-${m}`],
    r:  [`-${m},${n}`, `${m},${n}`,   `-${n},${m}`, `${n},${m}`],
    l:  [`-${m},-${n}`,`${m},-${n}`,  `-${n},-${m}`,`${n},-${m}`],
    fr: [`-${m},${n}`, `-${n},${m}`],
    fl: [`-${m},-${n}`,`-${n},-${m}`],
    br: [`${m},${n}`,  `${n},${m}`],
    bl: [`${m},-${n}`, `${n},-${m}`],
  };
}

function allOffsetsFor(m, n) {
  if (n === 0)   return [`-${m},0`, `${m},0`, `0,${m}`, `0,-${m}`];
  if (m === n)   return [`-${m},${m}`, `-${m},-${m}`, `${m},${m}`, `${m},-${m}`];
  return [
    `-${m},${n}`, `-${m},-${n}`, `${m},${n}`, `${m},-${n}`,
    `-${n},${m}`, `-${n},-${m}`, `${n},${m}`, `${n},-${m}`,
  ];
}

/**
 * Parse a custom-squares JSON value into a Set<"row,col"> of non-zero offsets.
 */
function parseOffsetSet(raw) {
  const out = new Set();
  if (raw == null) return out;
  let arr;
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (_) { return out; }
  if (!Array.isArray(arr)) return out;
  for (const sq of arr) {
    const row = toInt(sq && sq.row, 0);
    const col = toInt(sq && sq.col, 0);
    if (row === 0 && col === 0) continue;
    out.add(`${row},${col}`);
  }
  return out;
}

/**
 * Emit Betza chunks for a subset of a (m,n) leaper ring with the given
 * mc prefix ('' = move+capture, 'm' = move-only, 'c' = capture-only).
 * Returns null when the subset can't be expressed with our supported
 * direction prefixes.
 */
function emitLeaperSubset(m, n, atom, have, mcPrefix) {
  const all = allOffsetsFor(m, n);
  if (have.size === all.length && all.every(k => have.has(k))) {
    return [`${mcPrefix}${atom}`];
  }
  const dirGroups = directionGroupsFor(m, n);
  const remaining = new Set(have);
  const used = [];

  const tryCover = (label, keys) => {
    if (used.includes(label)) return;
    if (keys.length > 0 && keys.every(k => remaining.has(k))) {
      used.push(label);
      for (const k of keys) remaining.delete(k);
    }
  };

  // v (vertical = f+b) and s (sideways = l+r) help for orthogonal leapers
  // where each cardinal direction covers a single square: vW collapses fW+bW.
  if (n === 0) {
    tryCover('v', [`-${m},0`, `${m},0`]);
    tryCover('s', [`0,${m}`, `0,-${m}`]);
  }

  // For oblique leapers (n>0, m!=n), try the 4-square cardinal prefixes first
  // to produce shorter output, then fall back to the 2-square wedges.
  if (n !== 0 && m !== n) {
    for (const pref of ['f', 'b', 'r', 'l']) tryCover(pref, dirGroups[pref] || []);
  }
  for (const pref of ['fr', 'fl', 'br', 'bl', 'f', 'b', 'r', 'l']) {
    tryCover(pref, dirGroups[pref] || []);
  }

  if (remaining.size > 0) return null;
  return used.map(pref => `${mcPrefix}${pref}${atom}`);
}

/**
 * Joint translation of a piece's custom movement + custom attack offsets
 * into Betza chunks. Considering both sides together lets us:
 *   - Emit an unprefixed atom when a (m,n) leaper offset is BOTH a movement
 *     and an attack square (Betza atoms without m/c default to move+capture).
 *     This unlocks arbitrary unnamed (m,n) leapers, which Fairy-Stockfish
 *     v1.1.11 mis-handles when combined with an m/c prefix.
 *   - Split a named leaper ring into shared / move-only / capture-only
 *     subsets and emit each with the right prefix.
 *
 * Returns Betza chunks (possibly empty) or null when the pattern can't be
 * expressed (used by the compatibility checker to flag the game).
 */
function customSquaresPairToBetza(moveRaw, atkRaw) {
  const moveSet = parseOffsetSet(moveRaw);
  const atkSet = parseOffsetSet(atkRaw);
  if (moveSet.size === 0 && atkSet.size === 0) return [];

  // Bucket every offset into its canonical (m,n) ring.
  const groups = new Map(); // key "m,n" -> { m, n, shared, moveOnly, atkOnly }
  const ensureGroup = (m, n) => {
    const k = `${m},${n}`;
    if (!groups.has(k)) groups.set(k, { m, n, shared: new Set(), moveOnly: new Set(), atkOnly: new Set() });
    return groups.get(k);
  };
  for (const k of new Set([...moveSet, ...atkSet])) {
    const [row, col] = k.split(',').map(Number);
    const m = Math.max(Math.abs(row), Math.abs(col));
    const n = Math.min(Math.abs(row), Math.abs(col));
    const g = ensureGroup(m, n);
    const inMove = moveSet.has(k);
    const inAtk = atkSet.has(k);
    if (inMove && inAtk) g.shared.add(k);
    else if (inMove) g.moveOnly.add(k);
    else g.atkOnly.add(k);
  }

  const chunks = [];
  for (const g of groups.values()) {
    const atom = atomForLeaper(g.m, g.n);
    const isUnnamed = atom.startsWith('(');

    if (isUnnamed) {
      // Unnamed (m,n) atoms can only be emitted UNPREFIXED in FS v1.1.11.
      // That means: every offset must be shared between movement and attack,
      // and the full ring must be present (no direction prefix either).
      if (g.moveOnly.size > 0 || g.atkOnly.size > 0) return null;
      const all = allOffsetsFor(g.m, g.n);
      if (g.shared.size !== all.length || !all.every(k => g.shared.has(k))) return null;
      chunks.push(atom);
      continue;
    }

    // Named atom: emit each non-empty subset with the right prefix.
    const subsets = [
      { set: g.shared, prefix: '' },
      { set: g.moveOnly, prefix: 'm' },
      { set: g.atkOnly, prefix: 'c' },
    ];
    for (const sub of subsets) {
      if (sub.set.size === 0) continue;
      const subChunks = emitLeaperSubset(g.m, g.n, atom, sub.set, sub.prefix);
      if (subChunks === null) return null;
      chunks.push(...subChunks);
    }
  }
  return chunks;
}

/**
 * Back-compat wrapper around the joint translator. Accepts the original
 * single-side signature (squares array + 'm'/'c' prefix) and delegates to
 * customSquaresPairToBetza by passing the other side as empty.
 */
function customSquaresToBetza(squaresRaw, mcPrefix) {
  if (mcPrefix === 'c') return customSquaresPairToBetza(null, squaresRaw);
  return customSquaresPairToBetza(squaresRaw, null);
}

/**
 * Returns true when the piece's custom_movement_squares /
 * custom_attack_squares can be translated. Used by the compatibility checker.
 */
function canTranslateCustomSquares(piece) {
  if (!piece) return true;
  return customSquaresPairToBetza(
    piece.custom_movement_squares,
    piece.custom_attack_squares,
  ) !== null;
}

function buildAtomChunk(sig, atom, sliderAtom, mcPrefix, dirPrefix) {
  // sig = { v, exact }
  // - v=99   -> infinite slider: prefix + dirPrefix + sliderAtom (R or B)
  // - v=1    -> single-step leaper: prefix + dirPrefix + atom (W or F)
  // - v=N>1  -> N-step slider: prefix + dirPrefix + N + atom (e.g. "2fW")
  //            (Betza: nW means up to n squares; for exact, we use n + atom
  //            and the engine treats it as the only length when isolated.
  //            Fairy-Stockfish doesn't have a separate "exact" prefix; we
  //            approximate by using the slider syntax limited to N.)
  if (isInf(sig.v)) {
    return `${mcPrefix}${dirPrefix}${sliderAtom}`;
  }
  if (sig.v === 1) {
    return `${mcPrefix}${dirPrefix}${atom}`;
  }
  // Limited-range slider: nW or nF
  return `${mcPrefix}${dirPrefix}${sig.v}${atom}`;
}

/**
 * Convert a piece-template row into a Betza string for Fairy-Stockfish
 * `customPieceN = X:{betza}`. Returns null when the piece uses features the
 * translator cannot express (caller should mark game incompatible).
 */
function pieceToBetza(piece) {
  if (!piece) return null;

  // Untranslatable: must be filtered by compatibility checker, but we
  // double-check here.
  if (toBool(piece.step_by_step_movement_style)) return null;
  if (toBool(piece.directional_movement_change) || toBool(piece.directional_capture_change)) return null;

  const chunks = [];

  // "Move and capture identically" detection. When the piece captures on its
  // movement squares (attacks_like_movement or can_capture_enemy_on_move) AND
  // has no separate capture fields, we emit movement chunks UNPREFIXED.
  // Betza atoms without an m/c prefix default to move+capture; with the `m`
  // prefix they become move-only and the engine refuses to capture along
  // them, which would silently break the bot for rook/queen/bishop-style
  // pieces that rely on can_capture_enemy_on_move.
  const hasAttackDir = hasAnyDir(piece, true);
  const hasAttackCustom = parseOffsetSet(piece.custom_attack_squares).size > 0;
  const attacksByMovement =
    (toBool(piece.attacks_like_movement) || toBool(piece.can_capture_enemy_on_move))
    && !hasAttackDir
    && !hasAttackCustom;
  const movePrefix = attacksByMovement ? '' : 'm';

  // Ratio leaper (e.g. knight = 2:1). Adds an "N" (for 2:1) or generic
  // "(m,n)" leaper. Fairy-Stockfish supports parenthesised leapers.
  if (toBool(piece.ratio_movement_style)) {
    const r1 = toInt(piece.ratio_movement_1 ?? piece.ratio_one_movement);
    const r2 = toInt(piece.ratio_movement_2 ?? piece.ratio_two_movement);
    if (r1 > 0 && r2 > 0) {
      let atom;
      if ((r1 === 2 && r2 === 1) || (r1 === 1 && r2 === 2)) {
        atom = 'N';
      } else if (r1 === 2 && r2 === 2) {
        atom = 'A';
      } else if ((r1 === 2 && r2 === 0) || (r1 === 0 && r2 === 2)) {
        atom = 'D';
      } else if ((r1 === 3 && r2 === 1) || (r1 === 1 && r2 === 3)) {
        atom = 'C';
      } else if ((r1 === 3 && r2 === 2) || (r1 === 2 && r2 === 3)) {
        atom = 'Z';
      } else {
        atom = `(${Math.max(r1, r2)},${Math.min(r1, r2)})`;
      }
      // Ratio leapers in Chessus naturally move-and-capture (the bot has no
      // "capture-only ratio" concept here), so emit unprefixed even when
      // attacksByMovement is false. For unnamed (m,n) atoms this matches the
      // FS constraint that m/c-prefixed parenthesised atoms mis-behave.
      chunks.push(atom);
    }
  }

  // Direction-style movement & capture.
  if (toBool(piece.directional_movement_style) || hasAnyDir(piece, false)) {
    for (const grp of [ORTHO_DIRS, DIAG_DIRS]) {
      chunks.push(...emitAtomsForGroup(piece, grp, false, movePrefix));
    }
  }
  if (hasAttackDir) {
    for (const grp of [ORTHO_DIRS, DIAG_DIRS]) {
      chunks.push(...emitAtomsForGroup(piece, grp, true, 'c'));
    }
  }

  // Hop prefixes ("p" = cannon-style: hop over exactly one piece to capture;
  // "g" = grasshopper: hop over a piece and land immediately beyond it).
  // We append hop variants as additional chunks for capture only when the
  // piece can hop over enemies during attack.
  if (toBool(piece.can_hop_attack_over_enemies)) {
    // Approximate: emit "pR" / "pB" allowing slider-style hop captures along
    // any direction the piece already moves on. We re-use the slider atoms
    // (R for orthogonal sliders, B for diagonal sliders) when the piece has
    // any infinite slider direction in that group.
    if (anyInfInGroup(piece, ORTHO_DIRS, true)) chunks.push('pR');
    if (anyInfInGroup(piece, DIAG_DIRS, true)) chunks.push('pB');
  }
  if (toBool(piece.can_hop_over_allies)) {
    // Grasshopper-style: allies as hurdles for movement.
    if (anyInfInGroup(piece, ORTHO_DIRS, false)) chunks.push('gR');
    if (anyInfInGroup(piece, DIAG_DIRS, false)) chunks.push('gB');
  }

  // En passant (placement flag, but if any direction has it on the piece...).
  if (toBool(piece.can_en_passant)) {
    // Append 'e' modifier to forward diagonal capture chunks (best-effort).
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i] === 'cfF' || chunks[i] === 'cflF' || chunks[i] === 'cfrF') {
        chunks[i] = chunks[i].replace(/^c/, 'ce');
      }
    }
  }

  // Custom movement / attack squares. The joint translator emits unprefixed
  // atoms for offsets shared between movement and attack, which is what we
  // want when the piece captures along its movement squares. When
  // attacksByMovement is true, treat custom_movement_squares as ALSO being
  // attack squares so the joint translator emits them unprefixed.
  const customAtkArg = attacksByMovement
    ? piece.custom_movement_squares
    : piece.custom_attack_squares;
  const customChunks = customSquaresPairToBetza(
    piece.custom_movement_squares,
    customAtkArg,
  );
  if (customChunks === null) return null;
  chunks.push(...customChunks);

  const out = chunks.join('').trim();
  return out.length > 0 ? out : null;
}

function hasAnyDir(piece, isCapture) {
  for (const d of DIRS) {
    const col = isCapture ? `${d}_capture` : `${d}_movement`;
    if (toInt(piece[col]) > 0) return true;
  }
  return false;
}
function anyInfInGroup(piece, group, isCapture) {
  for (const d of group) {
    const col = isCapture ? `${d}_capture` : `${d}_movement`;
    if (isInf(piece[col])) return true;
  }
  return false;
}

// ---------- variant INI ----------

/**
 * Build a Fairy-Stockfish `variants.ini` section for this game type.
 * Returns { ini: string, variantName: string }.
 */
function buildVariantINI(gameType, pieceDefs, placements, charMap) {
  if (!charMap) return null;
  const variantName = `chessus_${gameType.id}`;
  const lines = [];
  lines.push(`[${variantName}:chess]`);

  const boardWidth = toInt(gameType.board_width, 8);
  const boardHeight = toInt(gameType.board_height, 8);
  if (boardWidth !== 8) lines.push(`maxFile = ${boardWidth}`);
  if (boardHeight !== 8) lines.push(`maxRank = ${boardHeight}`);

  // Starting FEN. Build from placements (positions in y=initial coords).
  const startFen = buildFENFromPlacements(placements, boardWidth, boardHeight, charMap);
  if (startFen) lines.push(`startFen = ${startFen}`);

  // ---- Rule flags ----
  if (toBool(gameType.forced_capture_condition)) {
    lines.push('mustCapture = true');
  }

  if (toBool(gameType.no_moves_condition)) {
    // Stalemate = loss for side with no moves (e.g. losing chess).
    lines.push('stalemateValue = loss');
  }

  if (toInt(gameType.draw_move_limit) > 0) {
    lines.push(`nMoveRule = ${toInt(gameType.draw_move_limit)}`);
  }
  if (toInt(gameType.repetition_draw_count) > 0) {
    lines.push(`nFoldRule = ${toInt(gameType.repetition_draw_count)}`);
    lines.push('nFoldValue = draw');
  }

  // Lose-all-pieces / extinction. Combines two flavours:
  //  1) lose_all_pieces_condition (e.g. Anti-Chess): every non-royal piece
  //     is a loss target.
  //  2) per-piece ends_game_on_capture without ends_game_on_checkmate
  //     (e.g. Knightfall): only the flagged piece types are loss targets.
  // Either flavour produces `extinctionValue = loss` with the union of the
  // piece-type letters in `extinctionPieceTypes`.
  //
  // extinctionPseudoRoyal is intentionally kept FALSE even for flavour (2).
  // When true, FS treats extinction pieces as pseudo-royals and marks moves
  // that leave them "in check" as illegal. This breaks win-in-1 captures:
  // if capturing the opponent's last extinction piece would incidentally
  // leave the bot's own last extinction piece under attack, FS declares the
  // winning capture illegal and the engine never takes it. Chessus games
  // like Knightfall have no such "must protect" constraint — you only lose
  // when the piece IS captured, not when it is threatened. Without the flag,
  // the engine still defends extinction pieces via normal alpha-beta
  // evaluation (any line ending in their capture scores as -infinity); the
  // only difference is that weakly-defended positions at the exact search
  // horizon are slightly less covered — a small and acceptable tradeoff.
  const extinctionChars = new Set();
  if (toBool(gameType.lose_all_pieces_condition)) {
    for (const c of charMap.byPieceId.values()) {
      if (!charMap.royalChars.has(c)) extinctionChars.add(c.toLowerCase());
    }
  }
  for (const c of (charMap.extinctionLossChars || new Set())) {
    extinctionChars.add(c.toLowerCase());
  }
  if (extinctionChars.size > 0) {
    lines.push('extinctionValue = loss');
    lines.push('extinctionPseudoRoyal = false');
    lines.push(`extinctionPieceTypes = ${Array.from(extinctionChars).join('')}`);
  }

  // Promotion piece types. Without an explicit list the FS engine may not
  // promote at all when the pawn 'P' is mapped to a custom piece. Emit the
  // set of non-royal, non-pawn letters as the available promotion targets.
  // This isn't perfect (per-placement promotion overrides aren't honoured),
  // but it's correct for the common case (regular chess, Capablanca, etc.).
  const promoChars = Array.from(charMap.byPieceId.values())
    .filter(c => !charMap.royalChars.has(c) && !charMap.pawnChars.has(c))
    .map(c => c.toLowerCase());
  if (promoChars.length > 0) {
    // Deduplicate while preserving order.
    const seen = new Set();
    const uniq = [];
    for (const c of promoChars) {
      if (!seen.has(c)) { seen.add(c); uniq.push(c); }
    }
    // promotionRank defaults to 8 (standard chess back rank); on non-8 boards
    // the pawn needs to know which rank promotes.
    if (boardHeight !== 8) lines.push(`promotionRank = ${boardHeight}`);
    lines.push(`promotionPieceTypes = ${uniq.join('')}`);
  }

  // Hill-style win (king reaches centre)
  if (toBool(gameType.hill_condition)) {
    const kingChar = [...charMap.royalChars][0] || 'K';
    lines.push(`flagPiece = ${kingChar}`);
    const cx = Math.floor(boardWidth / 2);
    const cy = Math.floor(boardHeight / 2);
    const sq = squareName(cx, cy, boardHeight);
    lines.push(`whiteFlag = ${sq}`);
    lines.push(`blackFlag = ${sq}`);
  }

  // Castling: Fairy-Stockfish's base `chess` variant has castling enabled by
  // default. Disable it when there's no royal piece, or when the royal piece's
  // `can_castle` flag is off, so the engine doesn't try castling moves that
  // Chessus's validator will reject.
  let castlingEnabled = false;
  if (charMap.royalChars && charMap.royalChars.size > 0) {
    // Find the royal piece template and check can_castle.
    for (const [pid, ch] of charMap.byPieceId.entries()) {
      if (!charMap.royalChars.has(ch)) continue;
      const royalPiece = pieceDefs.find(p => p && p.id === pid);
      if (royalPiece && toBool(royalPiece.can_castle)) {
        castlingEnabled = true;
        break;
      }
    }
  }
  if (!castlingEnabled) lines.push('castling = false');

  // chess960 mode whenever the game uses backrow/mirrored randomization
  if (gameType.starting_mode === 'backrow' || gameType.starting_mode === 'mirrored') {
    lines.push('chess960 = true');
  }

  // ---- Custom piece definitions ----
  let customIdx = 1;
  const pieceById = new Map(pieceDefs.map((p) => [p.id, p]));
  const charByPiece = charMap.byPieceId;
  const seenChars = new Set();
  for (const [pid, ch] of charByPiece.entries()) {
    if (seenChars.has(ch)) continue;
    seenChars.add(ch);
    const piece = pieceById.get(pid);
    if (!piece) continue;
    if (ch === 'K' || ch === 'P') continue; // builtin
    // `cannot_be_captured` pieces get an off-board leaper Betza so FS can
    // never legally move them (the board max is 12×12, so a (13,0) hop is
    // always off-board). Combined with being rendered as the side-to-move's
    // own piece in every FEN, the engine treats them as immovable obstacles
    // it can neither capture nor move.
    const betza = charMap.cannotBeCapturedIds.has(pid)
      ? '(13,0)'
      : pieceToBetza(piece);
    if (!betza) return null;
    lines.push(`customPiece${customIdx} = ${ch.toLowerCase()}:${betza}`);
    customIdx++;
  }

  // ---- pieceToCharTable ----
  // Required by Fairy-Stockfish to map piece types to their FEN characters.
  // Order matters: it's a fixed slot table. Default is standard chess.
  // For simplicity, we omit this line when we only have K/P + customPieces,
  // since Fairy-Stockfish auto-derives slots from customPiece definitions.

  return { ini: lines.join('\n') + '\n', variantName };
}

// ---------- FEN ----------

/**
 * Compute the FEN file letter for a 0-indexed chessus x.
 *   chessus x=0  -> 'a', x=1 -> 'b', ...
 */
function fileChar(x) {
  return String.fromCharCode(97 + x); // 0 -> 'a'
}

/**
 * FEN square name for chessus 0-indexed (x, y) on a board of height
 * `boardHeight`. chessus y=0 is the TOP of the screen (team 2's home),
 * which corresponds to FEN rank=boardHeight; chessus y=boardHeight-1
 * is the bottom (team 1's home) = FEN rank 1.
 *
 *   chessus (4, 6) on 8-high board -> file 'e', rank 8 - 6 = 2 -> 'e2'
 */
function squareName(x, y, boardHeight) {
  const rank = (boardHeight != null) ? (boardHeight - y) : y;
  return `${fileChar(x)}${rank}`;
}

function buildFENFromPlacements(placements, boardWidth, boardHeight, charMap) {
  if (!placements || placements.length === 0) return null;
  // Build grid[rankIdx][fileIdx] where rankIdx 0 = top FEN rank (=boardHeight),
  // rankIdx (boardHeight-1) = bottom FEN rank (=1). fileIdx is 0-indexed.
  const grid = [];
  for (let r = 0; r < boardHeight; r++) {
    grid.push(new Array(boardWidth).fill(null));
  }
  for (const pl of placements) {
    const x = toInt(pl.x);
    const y = toInt(pl.y);
    // chessus coords are 0-indexed: x in [0..boardWidth-1], y in [0..boardHeight-1].
    if (x < 0 || x >= boardWidth || y < 0 || y >= boardHeight) continue;
    const ch = charMap.byPieceId.get(pl.piece_id);
    if (!ch) continue;
    // Neutral pieces (no owner) are rendered as Player 2 in the start FEN.
    // The start FEN only seeds the engine at boot - per-move FENs from
    // buildFEN() will re-render them as the opponent of side-to-move.
    const neutral = toBool(pl.is_neutral) || toInt(pl.player_number) === 0;
    // cannot_be_captured pieces are rendered as Player 1 (white) in the start
    // FEN. The start position always has white to move, so this is consistent
    // with the live-FEN rule of "render as same side as mover". Their off-board
    // Betza ensures FS never tries to move or capture them.
    const cannotCapture = charMap.cannotBeCapturedIds
      ? charMap.cannotBeCapturedIds.has(toInt(pl.piece_id))
      : false;
    const player = cannotCapture ? 1 : (neutral ? 2 : toInt(pl.player_number, 1));
    // chessus y=0 (team 2's screen-top home) maps to grid row 0 (top FEN rank).
    grid[y][x] = player === 1 ? ch.toUpperCase() : ch.toLowerCase();
  }
  const rankStrs = [];
  for (let r = 0; r < boardHeight; r++) {
    let s = '';
    let blanks = 0;
    for (let f = 0; f < boardWidth; f++) {
      const c = grid[r][f];
      if (!c) {
        blanks++;
      } else {
        if (blanks > 0) { s += blanks; blanks = 0; }
        s += c;
      }
    }
    if (blanks > 0) s += blanks;
    rankStrs.push(s);
  }
  // Castling/ep/half/full defaults for start position.
  return `${rankStrs.join('/')} w KQkq - 0 1`;
}

/**
 * Build a FEN from a live in-game state (after moves have been played).
 *
 *   pieces            - gameState.pieces (each has { id, x, y, team, piece_id })
 *   currentTurn       - 1 or 2; whose move it is
 *   movesWithoutCapture - half-move clock
 *   totalHalfMoves    - total half-moves played
 *   moveHistory       - optional, used to derive castling rights
 *   charMap           - from buildCharMap
 */
function buildFEN(pieces, boardWidth, boardHeight, currentTurn, movesWithoutCapture, totalHalfMoves, moveHistory, charMap) {
  if (!charMap) return null;
  // grid[rankIdx][fileIdx] where rankIdx 0 = top FEN rank (boardHeight),
  // fileIdx is 0-indexed. chessus coords are 0-indexed throughout.
  const grid = [];
  for (let r = 0; r < boardHeight; r++) {
    grid.push(new Array(boardWidth).fill(null));
  }
  for (const p of pieces || []) {
    const x = toInt(p.x);
    const y = toInt(p.y);
    if (x < 0 || x >= boardWidth || y < 0 || y >= boardHeight) continue;
    // pieces[*].piece_id matches pieces table id; team field varies by code path.
    const ch = charMap.byPieceId.get(p.piece_id) || charMap.byPieceId.get(p.real_piece_id);
    if (!ch) continue;
    // Live pieces use `player_id` (1 or 2); DB rows use `team`. Match the
    // convention everywhere else: player_id wins, fall back to team.
    const rawTeam = toInt(p.player_id, toInt(p.team, 1));
    // Neutral pieces (is_neutral=true or player_id=0) are rendered as the
    // enemy of the side-to-move so the engine treats them as captureable
    // targets and never tries to move them itself.
    const neutral = toBool(p.is_neutral) || rawTeam === 0;
    // cannot_be_captured pieces are rendered as the same side as the
    // side-to-move. Combined with their off-board (13,0) leaper Betza in the
    // variant INI, FS treats them as immovable obstacles: it can neither
    // capture them (own pieces are never capturable) nor move them (no legal
    // moves). This lets games with cannot_be_captured pieces use FS normally.
    const cannotCapture = charMap.cannotBeCapturedIds
      ? charMap.cannotBeCapturedIds.has(toInt(p.piece_id))
        || charMap.cannotBeCapturedIds.has(toInt(p.real_piece_id))
      : false;
    const team = cannotCapture
      ? toInt(currentTurn, 1)
      : neutral
        ? (toInt(currentTurn, 1) === 1 ? 2 : 1)
        : rawTeam;
    grid[y][x] = team === 1 ? ch.toUpperCase() : ch.toLowerCase();
  }
  const rankStrs = [];
  for (let r = 0; r < boardHeight; r++) {
    let s = '';
    let blanks = 0;
    for (let f = 0; f < boardWidth; f++) {
      const c = grid[r][f];
      if (!c) blanks++;
      else {
        if (blanks > 0) { s += blanks; blanks = 0; }
        s += c;
      }
    }
    if (blanks > 0) s += blanks;
    rankStrs.push(s);
  }

  const turn = toInt(currentTurn, 1) === 2 ? 'b' : 'w';

  // Castling rights: best-effort. Mark "KQkq" if king + rooks have not moved.
  // Without rich move history, default to "-" to be safe.
  let castling = '-';
  if (moveHistory && Array.isArray(moveHistory) && moveHistory.length > 0) {
    castling = deriveCastlingRights(pieces, moveHistory, boardWidth);
  }

  // En passant target square from last move.
  let ep = '-';
  if (moveHistory && moveHistory.length > 0) {
    const last = moveHistory[moveHistory.length - 1];
    if (last && last.from && last.to && Math.abs(toInt(last.to.y) - toInt(last.from.y)) === 2) {
      // Pawn double-step: ep target is the square between from and to.
      const midY = (toInt(last.from.y) + toInt(last.to.y)) / 2;
      ep = squareName(toInt(last.from.x), midY, boardHeight);
    }
  }

  const halfClock = toInt(movesWithoutCapture, 0);
  const fullMove = Math.max(1, Math.floor(toInt(totalHalfMoves, 0) / 2) + 1);

  return `${rankStrs.join('/')} ${turn} ${castling} ${ep} ${halfClock} ${fullMove}`;
}

function deriveCastlingRights(pieces, moveHistory, boardWidth) {
  // Track which kings/rooks have moved. If we have no move history, assume
  // all rights present.
  const moved = new Set();
  for (const mv of moveHistory) {
    if (mv && mv.pieceId != null) moved.add(mv.pieceId);
  }
  // Approximate: KQkq if neither king has moved and the respective rooks
  // haven't moved. Without per-piece-type info we can't easily map back to
  // chess sides � return "KQkq" if any king + 2 rooks per side still on
  // their home rank.
  const rights = [];
  // White (team 1) home rank y=1; Black (team 2) home rank y=boardHeight or 8.
  // We just attempt all four; Fairy-Stockfish will discard invalid ones.
  rights.push('K', 'Q', 'k', 'q');
  return rights.join('');
}

// ---------- UCI move history ----------

/**
 * Encode a single chessus move object to UCI coordinate notation.
 *   { from:{x,y}, to:{x,y}, promotedTo? }  ->  "e2e4" or "e7e8q"
 */
function moveToUci(move, boardHeight) {
  if (!move || !move.from || !move.to) return null;
  let s = squareName(toInt(move.from.x), toInt(move.from.y), boardHeight);
  s += squareName(toInt(move.to.x), toInt(move.to.y), boardHeight);
  if (move.promotedTo && typeof move.promotedTo === 'string') {
    s += move.promotedTo.toLowerCase().slice(0, 1);
  }
  return s;
}

function buildMoveHistoryUci(moveHistory, boardHeight) {
  if (!Array.isArray(moveHistory)) return '';
  return moveHistory
    .map((m) => moveToUci(m, boardHeight))
    .filter((s) => !!s)
    .join(' ');
}

// ---------- UCI bestmove -> game move ----------

/**
 * Parse a UCI move ("e2e4", "e7e8q") and resolve it to a chessus move shape.
 *
 *   pieces       - gameState.pieces (live board state)
 *   boardHeight  - used to validate y range
 *
 * Returns { pieceId, from:{x,y}, to:{x,y}, promotionChar? } or null on failure.
 */
function uciMoveToGameMove(uciMove, pieces, boardHeight) {
  if (!uciMove || typeof uciMove !== 'string') return null;
  if (uciMove === '(none)' || uciMove === '0000') return null;
  const m = uciMove.trim().toLowerCase();
  const re = /^([a-l])(\d{1,2})([a-l])(\d{1,2})([qrbnack-z])?$/;
  const match = re.exec(m);
  if (!match) return null;
  const [, f1, r1, f2, r2, promo] = match;
  // FEN file 'a'..'j' -> chessus x 0..9.  FEN rank R -> chessus y = boardHeight - R.
  const bh = (boardHeight != null) ? boardHeight : 8;
  const from = { x: f1.charCodeAt(0) - 97, y: bh - parseInt(r1, 10) };
  const to   = { x: f2.charCodeAt(0) - 97, y: bh - parseInt(r2, 10) };
  const piece = (pieces || []).find((p) => toInt(p.x) === from.x && toInt(p.y) === from.y);
  if (!piece) return null;
  const out = { pieceId: piece.id, from, to };
  if (promo) out.promotionChar = promo;
  return out;
}

module.exports = {
  buildCharMap,
  pieceToBetza,
  customSquaresToBetza,
  customSquaresPairToBetza,
  canTranslateCustomSquares,
  buildVariantINI,
  buildFEN,
  buildFENFromPlacements,
  buildMoveHistoryUci,
  moveToUci,
  uciMoveToGameMove,
  squareName,
  fileChar,
};
