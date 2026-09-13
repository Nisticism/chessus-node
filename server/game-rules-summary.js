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

/**
 * @param {object} gameType - a row from `game_types`
 * @returns {{ groups: Array<{ title: string, items: Array<{ label: string, detail: string }> }> }}
 */
function summariseRules(gameType) {
  const gt = gameType || {};
  const groups = [];
  const push = (title, items) => {
    const kept = items.filter(Boolean);
    if (kept.length) groups.push({ title, items: kept });
  };
  const item = (cond, label, detail) => (cond ? { label, detail } : null);

  // ---- how the game is won -------------------------------------------------
  push('How the game is won', [
    item(T(gt.mate_condition), 'Checkmate',
      T(gt.mate_condition_requires_all)
        ? 'Win by checkmating your opponent. Every one of their key pieces must be mated.'
        : 'Win by checkmating your opponent.'),
    item(T(gt.capture_condition), 'Capture the key piece',
      T(gt.capture_condition_requires_all)
        ? 'Win by capturing every one of your opponent’s key pieces.'
        : 'Win by capturing your opponent’s key piece — no checkmate needed.'),
    item(T(gt.lose_all_pieces_condition), 'Lose everything to win',
      'This game is inverted: the first player with no pieces left wins.'),
    item(T(gt.stalemate_win_condition), 'Stalemate wins',
      'Leaving your opponent with no legal move while they are not in check wins the game.'),
    item(T(gt.no_moves_condition), 'No legal moves loses',
      'A player with no legal move loses, whether or not they are in check.'),
    item(T(gt.promotion_condition), 'Promotion wins',
      'Getting a piece to a promotion square wins the game outright.'),
    item(T(gt.squares_condition), 'Control squares',
      `Hold the marked control squares${I(gt.squares_count) ? ` for ${I(gt.squares_count)} turns` : ''} to win.`),
    item(T(gt.piece_count_condition), 'Most pieces wins',
      'The player with the most pieces on the board at the end wins.'),
    item(I(gt.points_to_win) > 0, 'Points',
      `Score ${I(gt.points_to_win)} points from captures to win.`),
    item(T(gt.value_condition), 'Material value',
      `Win by taking your opponent’s material below the set threshold${gt.value_title ? ` (${gt.value_title})` : ''}.`),
    item(T(gt.hill_condition), 'King of the hill',
      `Hold the hill square for ${I(gt.hill_turns) || 'the required number of'} turns to win.`),
    item(T(gt.optional_condition), 'Custom condition',
      'This game has a custom win condition set by its creator — see the game page.'),
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

module.exports = { summariseRules };
