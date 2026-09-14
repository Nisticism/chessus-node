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

/** Does this game place pieces at all? */
export const placesPieces = (game) => !!game?.place_pieces_action
  && Array.isArray(game.placeable_pieces) && game.placeable_pieces.length > 0;

/** The name to show for a tray item. */
export const placeableName = (item) =>
  item?.template?.name || item?.template?.piece_name || `Piece ${item?.template?.piece_id}`;
