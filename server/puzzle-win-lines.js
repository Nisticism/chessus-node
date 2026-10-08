/*
 * How THIS puzzle's game is won, in exact sentences, for the rules card
 * (GameRulesModal, served by GET /api/puzzles/:id/rules).
 *
 * The card used to get the game's win-condition switches and turn each into a
 * generic line - "Checkmate a key piece and the game is over." A solver
 * looking at a board with a king, a prince and three generals cannot act on
 * that. So the sentences are built here, from the puzzle's own board and its
 * frozen rules, and from the solver's side (the side to move):
 *
 *   checkmate / capture   the opponent's pieces that end the game, named with
 *                         their squares; and the solver's own, which they must
 *                         not lose;
 *   a line                how many in a row and which way (win-line.js);
 *   control squares       how many squares at once, which ones, for how many
 *                         turns, and whether they must be held in a row;
 *   piece count, points   when the count is taken; what each capturable piece
 *                         on the board scores;
 *   the rest              game-rules-summary.js's own sentence.
 *
 * The engine ends a game on the key-piece flags whether or not the
 * win-condition switch is on (checkWinCondition), so a flagged piece gets its
 * sentence either way.
 */

const { squareLabel } = require('./square-label');
const { describeLineRule } = require('./win-line');
const { summariseRules, controlSquareRule } = require('./game-rules-summary');

const T = (v) => v === true || v === 1 || v === '1';
const ownerOf = (p) => Number(p.player_id ?? p.team ?? p.player_number);

/*
 * Pieces with their squares: "the King on e8", "the King on e8 and the Prince
 * on d7"; past two pieces, grouped by name so a long list stays readable -
 * "Bishop (e6, f8), Knight (f6, b8) or King (d8)".
 */
function namePieces(list, height, joiner) {
  const at = (p) => squareLabel(p.x, p.y, height);
  const join = (parts) => (parts.length <= 1 ? parts[0] || '' : `${parts.slice(0, -1).join(', ')} ${joiner} ${parts[parts.length - 1]}`);
  if (list.length <= 2) return join(list.map((p) => `the ${p.piece_name || 'piece'} on ${at(p)}`));
  const byName = new Map();
  for (const p of list) {
    const name = p.piece_name || 'piece';
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(at(p));
  }
  return join([...byName.entries()].map(([name, squares]) => `${name} (${squares.join(', ')})`));
}

/*
 * @param {object} game     the frozen game_types row
 * @param {Array}  pieces   the puzzle's board, hydrated (puzzle-hydrate), so the
 *                          ends_game_on_* flags and point values are on each piece
 * @param {number} side     the solver's side (side_to_move)
 * @param {object} extra    { placements, pieces } for game-rules-summary
 * @returns {string[]}
 */
function puzzleWinLines(game, pieces, side, extra = {}) {
  const gt = game || {};
  const height = Number(gt.board_height) || 8;
  const board = Array.isArray(pieces) ? pieces : [];
  const mine = board.filter((p) => ownerOf(p) === Number(side));
  const theirs = board.filter((p) => ownerOf(p) !== Number(side));
  const lines = [];

  // ---- checkmate -----------------------------------------------------------
  const mateTargets = theirs.filter((p) => T(p.ends_game_on_checkmate));
  const mateOwn = mine.filter((p) => T(p.ends_game_on_checkmate));
  if (mateTargets.length) {
    if (mateTargets.length === 1) {
      lines.push(`Checkmate the opponent's ${mateTargets[0].piece_name || 'piece'} on ${squareLabel(mateTargets[0].x, mateTargets[0].y, height)}.`);
    } else if (T(gt.mate_condition_requires_all)) {
      lines.push(`Checkmate all of the opponent's key pieces at once: ${namePieces(mateTargets, height, 'and')}.`);
    } else {
      lines.push(`Checkmate any one of the opponent's key pieces: ${namePieces(mateTargets, height, 'or')}.`);
    }
  } else if (T(gt.mate_condition)) {
    lines.push('Checkmate the opponent.');
  }
  // Only a checkmate game keeps a player from leaving their key piece attacked.
  if (mateOwn.length && T(gt.mate_condition)) {
    lines.push(`Keep your own ${namePieces(mateOwn, height, 'and').replace(/^the /, '')} out of check - you may not leave ${mateOwn.length === 1 ? 'it' : 'them'} attacked.`);
  }

  // ---- capture -------------------------------------------------------------
  const captureTargets = theirs.filter((p) => T(p.ends_game_on_capture));
  const captureOwn = mine.filter((p) => T(p.ends_game_on_capture));
  if (captureTargets.length) {
    if (captureTargets.length === 1) {
      lines.push(`Capture the opponent's ${captureTargets[0].piece_name || 'piece'} on ${squareLabel(captureTargets[0].x, captureTargets[0].y, height)} - no checkmate needed.`);
    } else if (T(gt.capture_condition_requires_all)) {
      lines.push(`Capture every one of the opponent's key pieces - no checkmate needed: ${namePieces(captureTargets, height, 'and')}.`);
    } else {
      lines.push(`Capture any one of the opponent's key pieces - no checkmate needed: ${namePieces(captureTargets, height, 'or')}.`);
    }
  }
  if (captureOwn.length === 1) {
    lines.push(`Losing your own ${captureOwn[0].piece_name || 'piece'} on ${squareLabel(captureOwn[0].x, captureOwn[0].y, height)} loses the game.`);
  } else if (captureOwn.length > 1) {
    const all = T(gt.capture_condition_requires_all);
    lines.push(`${all ? 'Losing all of your own key pieces' : 'Losing any one of your own key pieces'} loses the game: ${namePieces(captureOwn, height, all ? 'and' : 'or')}.`);
  }

  // ---- a line --------------------------------------------------------------
  if (T(gt.line_condition)) lines.push(describeLineRule(gt) || 'Arrange your pieces into a line to win.');

  // ---- control squares -----------------------------------------------------
  if (T(gt.squares_condition)) {
    const rule = controlSquareRule(gt, side);
    if (rule.squares.length) {
      const named = rule.squares.length <= 8 ? ` (${rule.squares.map(([x, y]) => squareLabel(x, y, height)).join(', ')})` : '';
      const howMany = rule.needed >= rule.squares.length
        ? (rule.squares.length === 1 ? 'the control square' : `all ${rule.squares.length} control squares`)
        : `${rule.needed} of the ${rule.squares.length} control squares`;
      const turns = `${rule.turns} ${rule.turns === 1 ? 'turn' : 'turns'}${rule.turns > 1 ? (rule.consecutive ? ' in a row' : ' in total') : ''}`;
      lines.push(`Hold ${howMany}${named}${rule.needed > 1 ? ' at once' : ''} for ${turns}${rule.specificPiece ? ' - only pieces that can control squares count' : ''}.`);
    }
    // No control squares at all: the switch is on but nothing can trigger it.
  }

  // ---- piece count -----------------------------------------------------------
  if (T(gt.piece_count_condition)) {
    let otherData = gt.other_game_data;
    if (typeof otherData === 'string') { try { otherData = JSON.parse(otherData); } catch (_) { otherData = {}; } }
    lines.push('When the board is full or neither player can move, whoever has more pieces on the board wins'
      + `${otherData?.equal_piece_count_draw ? ' (equal counts draw)' : ''}; a player left with no pieces loses.`
      + ` Now: you ${mine.length}, the opponent ${theirs.length}.`);
  }

  // ---- points --------------------------------------------------------------
  const pointsToWin = Number(gt.points_to_win) || 0;
  if (pointsToWin > 0) {
    const worth = new Map();
    for (const p of theirs) {
      const gain = Number(p.capture_points_gain) || 0;
      if (gain > 0 && !worth.has(p.piece_name)) worth.set(p.piece_name, gain);
    }
    const list = [...worth.entries()].map(([n, g]) => `${n || 'piece'} ${g}`).join(', ');
    lines.push(`First to ${pointsToWin} ${pointsToWin === 1 ? 'point' : 'points'} from captures wins.${list ? ` Taking the opponent's pieces scores: ${list}.` : ''}`);
  }

  // ---- everything else, in game-rules-summary's words ------------------------
  const covered = new Set(['Checkmate', 'Capture the key piece', 'Capture every key piece', 'Capture a key piece',
    'Make a line', 'Connect the sides', 'Control squares', 'Most pieces wins', 'Points', 'The board drops pieces']);
  const won = summariseRules(gt, extra).groups.find((g) => g.title === 'How the game is won');
  for (const it of won?.items || []) if (!covered.has(it.label)) lines.push(it.detail);

  return lines;
}

module.exports = { puzzleWinLines };
