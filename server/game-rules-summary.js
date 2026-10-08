/*
 * Plain-English rules for one game type.
 *
 * A puzzle can be met by somebody who has never played the game it came from -
 * that is the whole point of a daily puzzle that rotates across games. They need
 * to be able to find out how the game is won and what is unusual about it
 * without leaving the puzzle, so the solver page carries this list behind an
 * expander.
 *
 * Deliberately a SUMMARY, not a dump of all 89 columns. A rule earns a line here
 * when a solver could otherwise be confused by it: how the game ends, anything
 * that changes what a legal move is, and anything that changes what they can
 * see. Cosmetics and scoring dials nobody would notice in a five-move puzzle are
 * left out.
 */

const { describeLineRule } = require('./win-line');
const { describeGravity } = require('./board-gravity');
const { isDesignationGame, designationCount } = require('./designated-piece');

const T = (v) => v === true || v === 1 || v === '1';
const I = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

const parse = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return null; }
};
const countSquares = (v) => {
  const p = parse(v);
  return p && typeof p === 'object' ? Object.keys(p).length : 0;
};

/*
 * The pieces a side loses the game by losing, per player, from the game's own
 * placements (game_type_pieces) or, for a game with none, its starting layout.
 * `flag` is 'ends_game_on_checkmate' or 'ends_game_on_capture'.
 *
 * Returns { 1: [{ name, count }], 2: [...] }, names in the order first met.
 */
function keyPiecesBySide(gt, placements, pieces, flag) {
  const nameOf = new Map((pieces || []).map((p) => [Number(p.id), p.piece_name]));
  let rows = (placements || []).map((r) => ({
    piece_id: r.piece_id, player: Number(r.player_number ?? r.player_id ?? 1), flagged: T(r[flag]),
    name: r.piece_name,
  }));
  if (!rows.length) {
    const layout = parse(gt.pieces_string);
    if (layout && typeof layout === 'object') {
      rows = Object.values(layout).map((v) => ({
        piece_id: v?.piece_id, player: Number(v?.player_id ?? v?.team ?? v?.player_number ?? 1),
        flagged: T(v?.[flag]), name: v?.piece_name,
      }));
    }
  }
  const out = {};
  for (const r of rows) {
    if (!r.flagged) continue;
    const name = nameOf.get(Number(r.piece_id)) || r.name || 'a marked piece';
    const side = out[r.player] || (out[r.player] = []);
    const have = side.find((x) => x.name === name);
    if (have) have.count += 1; else side.push({ name, count: 1 });
  }
  return out;
}

/*
 * The control-square rule as the engine applies it (updateControlSquareTracking
 * in game-socket.js): the squares - control_squares_string plus custom squares
 * marked "acts as a control square" - that count for `side` (all of them when
 * no side is given), how many must be held AT ONCE (squares_count, else every
 * one that counts), for how many turns (the most any square asks), whether in a
 * row, and whether only pieces that can control squares count.
 */
function controlSquareRule(gt, side = null) {
  const squares = {};
  const control = parse(gt.control_squares_string);
  if (control && typeof control === 'object') Object.assign(squares, control);
  const custom = parse(gt.special_squares_string);
  if (custom && typeof custom === 'object') {
    for (const [key, cfg] of Object.entries(custom)) {
      if (cfg && cfg.asControl && !squares[key]) squares[key] = { ...(cfg.controlConfig || {}) };
    }
  }
  const all = Object.entries(squares);
  const applies = (cfg) => {
    const ap = cfg?.appliesToPlayer || 'both';
    return side == null || ap === 'both' || ap === 'all' || ap === `p${side}`;
  };
  const mine = all.filter(([, cfg]) => applies(cfg));
  const count = I(gt.squares_count);
  return {
    squares: mine.map(([key]) => { const [row, col] = key.split(',').map(Number); return [col, row]; }),
    needed: count ? Math.min(count, all.length) : Math.max(1, mine.length),
    turns: Math.max(1, ...all.map(([, cfg]) => Number(cfg?.turnsRequired) || 1)),
    consecutive: !!(all[0] && all[0][1]?.consecutiveTurns),
    specificPiece: all.some(([, cfg]) => cfg?.requireSpecificPiece),
  };
}

/** "Rook ×2, Knight ×2, Bishop ×2 and King" */
function listPieces(list, joiner = 'and') {
  const parts = list.map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name));
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} ${joiner} ${parts[parts.length - 1]}`;
}

const total = (list) => list.reduce((n, p) => n + p.count, 0);

/*
 * One sentence naming the key pieces: once when both armies have the same
 * ones, per player when they do not.
 */
function describeKeyPieces(bySide, requiresAll, { what, verbOne, verbAll, verbAny }) {
  const sides = Object.keys(bySide).sort();
  if (!sides.length) return null;
  const sig = (list) => JSON.stringify(list);
  const same = sides.length === 1 || sides.every((k) => sig(bySide[k]) === sig(bySide[sides[0]]));
  const phrase = (list) => {
    if (total(list) === 1) return `${verbOne} ${list[0].name}`;
    return requiresAll
      ? `${verbAll}: ${listPieces(list, 'and')}`
      : `${verbAny}: ${listPieces(list, 'or')}. Any one is enough`;
  };
  if (same) return `${what} ${phrase(bySide[sides[0]])}.`;
  // Armies with different key pieces: name each side's, then the one rule.
  const several = sides.some((k) => total(bySide[k]) > 1);
  return `${what} your opponent’s key ${several ? 'pieces' : 'piece'} — `
    + sides.map((k) => `Player ${k}’s: ${listPieces(bySide[k], requiresAll ? 'and' : 'or')}`).join('; ')
    + (several ? (requiresAll ? '. Every one of them has to go.' : '. Any one is enough.') : '.');
}

/**
 * @param {object} gameType - a row from `game_types`
 * @param {object} [extra] - { placements, pieces } (a rule snapshot, or readLive),
 *   so the key pieces can be named. Without them the win lines stay generic.
 * @returns {{ groups: Array<{ title: string, items: Array<{ label: string, detail: string }> }> }}
 */
function summariseRules(gameType, extra = {}) {
  const gt = gameType || {};
  /*
   * Key pieces, named. "Capture the key piece" told a solver nothing in a game
   * whose key pieces are both rooks, both knights, both bishops and the king
   * (Game With Bisasam). And the engine ends the game on these flags whether or
   * not the win-condition switch is on, so flagged pieces get their line even
   * then.
   */
  const mateKeys = keyPiecesBySide(gt, extra.placements, extra.pieces, 'ends_game_on_checkmate');
  const captureKeys = keyPiecesBySide(gt, extra.placements, extra.pieces, 'ends_game_on_capture');
  const hasMateKeys = Object.keys(mateKeys).length > 0;
  const hasCaptureKeys = Object.keys(captureKeys).length > 0;
  const keyWords = {
    verbOne: 'your opponent’s',
    verbAll: 'every one of your opponent’s key pieces',
    verbAny: 'any one of your opponent’s key pieces',
  };
  let mateDetail;
  if (hasMateKeys) {
    // Capturing a checkmate key piece ends the game too (checkGameEnd).
    mateDetail = describeKeyPieces(mateKeys, T(gt.mate_condition_requires_all), { what: 'Win by checkmating', ...keyWords })
      + (T(gt.mate_condition_requires_all) ? ' Capturing them counts too, once none are left.' : ' Capturing it wins as well.');
  } else {
    mateDetail = T(gt.mate_condition_requires_all)
      ? 'Win by checkmating your opponent. Every one of their key pieces must be mated.'
      : 'Win by checkmating your opponent.';
  }
  let captureDetail;
  if (hasCaptureKeys) {
    captureDetail = describeKeyPieces(captureKeys, T(gt.capture_condition_requires_all), { what: 'Win by capturing', ...keyWords })
      + ' No checkmate needed.';
  } else {
    captureDetail = T(gt.capture_condition_requires_all)
      ? 'Win by capturing every one of your opponent’s key pieces.'
      : 'Win by capturing your opponent’s key piece — no checkmate needed.';
  }
  const manyCaptureKeys = Object.values(captureKeys).some((list) => total(list) > 1);
  // Survival defaults to ON (the wizard's toggle reads "!== false").
  const survives = gt.promotion_condition_requires_survival == null || T(gt.promotion_condition_requires_survival);
  const promotionTerms = [
    T(gt.promotion_condition_requires_empty) && 'onto an empty square',
    T(gt.promotion_condition_requires_no_capture) && 'with a move that captures nothing',
    survives && 'and the piece has to survive the move',
  ].filter(Boolean);
  const groups = [];
  const push = (title, items) => {
    const kept = items.filter(Boolean);
    if (kept.length) groups.push({ title, items: kept });
  };
  const item = (cond, label, detail) => (cond ? { label, detail } : null);

  // ---- how the game is won -------------------------------------------------
  push('How the game is won', [
    item(T(gt.mate_condition) || hasMateKeys, 'Checkmate', mateDetail),
    item(T(gt.capture_condition) || hasCaptureKeys,
      !manyCaptureKeys ? 'Capture the key piece'
        : (T(gt.capture_condition_requires_all) ? 'Capture every key piece' : 'Capture a key piece'),
      captureDetail),
    item(T(gt.lose_all_pieces_condition), 'Lose everything to win',
      'This game is inverted: the first player with no pieces left wins.'),
    item(T(gt.stalemate_win_condition), 'Stalemate wins',
      'Leaving your opponent with no legal move while they are not in check wins the game.'),
    item(T(gt.no_moves_condition), 'No legal moves loses',
      'A player with no legal move loses, whether or not they are in check.'),
    item(T(gt.promotion_condition), 'Promotion wins',
      `Getting a piece to a promotion square wins the game outright${promotionTerms.length ? ` — ${promotionTerms.join(', ')}` : ''}.`),
    /*
     * squares_count is how many squares must be held AT ONCE, not for how many
     * turns (this said "for N turns"); the turns come from the squares
     * themselves (controlSquareRule).
     */
    item(T(gt.squares_condition), 'Control squares', (() => {
      const rule = controlSquareRule(gt);
      const n = rule.squares.length;
      const howMany = !n ? 'the marked control squares'
        : (rule.needed >= n ? (n === 1 ? 'the marked control square' : `all ${n} marked control squares`) : `${rule.needed} of the ${n} marked control squares`);
      const turns = `${rule.turns} ${rule.turns === 1 ? 'turn' : 'turns'}${rule.turns > 1 ? (rule.consecutive ? ' in a row' : ' in total') : ''}`;
      return `Hold ${howMany}${rule.needed > 1 ? ' at once' : ''} for ${turns} to win.`;
    })()),
    item(T(gt.piece_count_condition), 'Most pieces wins',
      'The player with the most pieces on the board at the end wins.'),
    /*
     * The sentence is written by win-line.js from the same settings the engine
     * applies, rather than assembled again here - the rule has four knobs and a
     * second description of it would be a second thing to keep right.
     */
    item(T(gt.line_condition),
      gt.line_win_type === 'edge_to_edge' ? 'Connect the sides' : 'Make a line',
      describeLineRule(gt) || 'Win by arranging your pieces into a line.'),
    /*
     * Gravity changes how a turn is TAKEN rather than how the game is won, but
     * it earns a line here for the same reason: a solver who does not know the
     * board drops pieces cannot read the position in front of them.
     */
    item(!!describeGravity(gt), 'The board drops pieces',
      describeGravity(gt) || ''),
    item(I(gt.points_to_win) > 0, 'Points',
      `Score ${I(gt.points_to_win)} points from captures to win.`),
    item(T(gt.value_condition), 'Material value',
      `Win by taking your opponent’s material below the set threshold${gt.value_title ? ` (${gt.value_title})` : ''}.`),
    item(T(gt.hill_condition), 'King of the hill',
      `Hold the hill square for ${I(gt.hill_turns) || 'the required number of'} turns to win.`),
    item(I(gt.illegal_move_limit) > 0, 'Too many illegal moves loses',
      `A player who tries ${I(gt.illegal_move_limit)} illegal ${I(gt.illegal_move_limit) === 1 ? 'move' : 'moves'} loses the game`
      + `${gt.illegal_move_label ? ` (counted as “${gt.illegal_move_label}”)` : ''}.`),
  ]);

  // ---- rules that change what a legal move is ------------------------------
  push('Rules that change how you move', [
    item(T(gt.forced_capture_condition), 'Captures are forced',
      'If any capture is available to you, you must play one.'),
    item(I(gt.actions_per_turn) > 1, 'Multiple actions per turn',
      `You take ${I(gt.actions_per_turn)} actions each turn, not one.`),
    item(T(gt.veto_enabled), 'Veto',
      gt.veto_style === 'reactive'
        ? `Your opponent can veto ${I(gt.veto_per_turn_limit) || 1} of your moves after you play it, forcing you to choose again.`
        : `Your opponent bans ${I(gt.veto_per_turn_limit) || 1} of your possible moves before you play.`),
    item(isDesignationGame(gt), 'Opponent chooses the piece type',
      designationCount(gt) === 1
        ? 'Before each move your opponent picks a piece type, and you must move a piece of that type if one can move.'
        : `Before each move your opponent picks ${designationCount(gt)} piece types, and you must move a piece of one of them if one can move.`),
    item(T(gt.simultaneous_turns), 'Simultaneous turns',
      'Both players choose their move at the same time.'),
    item(countSquares(gt.promotion_squares_string) > 0, 'Promotion squares',
      `${countSquares(gt.promotion_squares_string)} squares promote a piece that reaches them.`),
    item(countSquares(gt.special_squares_string) > 0, 'Special squares',
      `${countSquares(gt.special_squares_string)} squares on this board behave differently — they are marked.`),
    item(countSquares(gt.range_squares_string) > 0, 'Range squares',
      `${countSquares(gt.range_squares_string)} marked squares affect ranged attacks.`),
    item(countSquares(gt.control_squares_string) > 0, 'Control squares',
      `${countSquares(gt.control_squares_string)} marked squares can be controlled.`),
  ]);

  // ---- what you can see ----------------------------------------------------
  push('What you can see', [
    item(T(gt.fog_of_war), 'Fog of war',
      T(gt.permanent_fog_reveal)
        ? 'You only see squares your pieces can reach. Squares you have revealed stay revealed.'
        : 'You only see the squares your own pieces can reach. Everything else is hidden.'),
    item(T(gt.hide_enemy_pieces), 'Hidden enemy pieces',
      'You can see that an enemy piece is there, but not which piece it is.'),
  ]);

  // ---- draws ---------------------------------------------------------------
  push('Draws', [
    item(T(gt.stalemate_draw_condition), 'Stalemate is a draw',
      'A player with no legal move who is not in check draws the game.'),
    item(I(gt.draw_move_limit) > 0, 'Move limit',
      `${I(gt.draw_move_limit)} moves without a capture is a draw.`),
    item(I(gt.repetition_draw_count) > 0, 'Repetition',
      `Repeating the same position ${I(gt.repetition_draw_count)} times is a draw.`),
  ]);

  return { groups };
}

module.exports = { summariseRules, controlSquareRule };
