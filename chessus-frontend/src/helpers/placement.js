/*
 * Games where a turn is "put a piece down" rather than "move a piece".
 *
 * Go is the pure case - a stone has no movement at all - and Othello, Boss
 * Battle and a dozen others place pieces alongside moving them. Every board on
 * the site that can be played has to be able to offer a placement, so the way
 * a game's placeable list turns into a row of choosable items lives here
 * rather than in each of them.
 */

/**
 * One tray item per piece-and-owner a player could actually deploy.
 *
 * An entry may name a player, say "all", or be neutral. "all" expands to one
 * item per player so a colour is chosen by choosing an item, rather than
 * through a second control that has to be kept in step with the first; a
 * neutral piece gets a single item, because it belongs to nobody (player 0 is
 * how the engine spells that everywhere else).
 */
export const expandPlaceable = (placeablePieces, playerCount = 2) => {
  const list = Array.isArray(placeablePieces) ? placeablePieces : [];
  const players = Math.max(2, Number(playerCount) || 2);
  const out = [];

  for (const entry of list) {
    const pieceId = Number(entry?.piece_id);
    if (!Number.isFinite(pieceId)) continue;

    if (entry.is_neutral) {
      out.push({ key: `${pieceId}:0`, template: entry, player: 0 });
      continue;
    }
    const who = entry.player == null || entry.player === 'all' ? 'all' : String(entry.player);
    const match = who === 'all' ? null : who.match(/^p?(\d+)$/);
    if (match) {
      out.push({ key: `${pieceId}:${match[1]}`, template: entry, player: Number(match[1]) });
    } else {
      for (let p = 1; p <= players; p++) {
        out.push({ key: `${pieceId}:${p}`, template: entry, player: p });
      }
    }
  }
  return out;
};

/*
 * What a SOLVER may put down: only their own side's pieces, and neutral ones.
 *
 * A piece placeable by "all" expands to one item per player, which is right
 * for the builder - its creator plays both sides of the line - and wrong for
 * someone solving, who was offered the opponent's colour as well as their own
 * and could drop a piece that is not theirs. The server makes every placement
 * the mover's regardless, so the board showed one colour and the game recorded
 * the other.
 */
export const solverTrayItems = (puzzle) => (
  placesPieces(puzzle)
    ? expandPlaceable(puzzle.placeable_pieces, puzzle.player_count)
      .filter((item) => item.player === 0 || item.player === Number(puzzle.side_to_move))
    : []
);

/*
 * A solution line with every placement told whose it is, and what it looks like.
 *
 * The server stores a placement as three fields - type, piece, square - so a
 * placement read back from a line does not say who made it. It is the side
 * whose turn it was, which is the ply's position in the line: even plies are
 * the solver's, odd ones the opponent's. Boards drawing a line used to default
 * the owner to player 1, so the opponent's placements came out in the solver's
 * colour, and with no artwork either.
 *
 * `startIndex` is where `line` begins in the full line, for a slice.
 */
export const withPlacers = (line, puzzle, startIndex = 0) => {
  if (!Array.isArray(line)) return line;
  const side = Number(puzzle?.side_to_move) || 1;
  const other = side === 1 ? 2 : 1;
  const templates = Array.isArray(puzzle?.placeable_pieces) ? puzzle.placeable_pieces : [];
  return line.map((ply, i) => {
    if (!ply || ply.type !== 'place') return ply;
    const template = templates.find((t) => Number(t.piece_id) === Number(ply.placePieceId)) || {};
    const neutral = !!template.is_neutral;
    return {
      ...ply,
      placedBy: ply.placedBy ?? (neutral ? 0 : ((startIndex + i) % 2 === 0 ? side : other)),
      placedName: ply.placedName ?? (template.name || template.piece_name || null),
      placedImage: ply.placedImage ?? (template.image_location || null),
    };
  });
};

/** Does this game place pieces at all? */
export const placesPieces = (game) => !!game?.place_pieces_action
  && Array.isArray(game.placeable_pieces) && game.placeable_pieces.length > 0;

/** The name to show for a tray item. */
export const placeableName = (item) =>
  item?.template?.name || item?.template?.piece_name || `Piece ${item?.template?.piece_id}`;
