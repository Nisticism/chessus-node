import {
  WhitePawn, BlackPawn, WhiteKnight, BlackKnight, WhiteBishup, BlackBishup,
  WhiteRook, BlackRook, WhiteQueen, BlackQueen, WhiteKing, BlackKing
} from "../assets/piece-images";

const FALLBACK_KEYWORDS = [
  { pattern: /king/i, white: WhiteKing, black: BlackKing },
  { pattern: /queen/i, white: WhiteQueen, black: BlackQueen },
  { pattern: /rook|castle|tower/i, white: WhiteRook, black: BlackRook },
  { pattern: /bishop/i, white: WhiteBishup, black: BlackBishup },
  { pattern: /knight|horse/i, white: WhiteKnight, black: BlackKnight },
  { pattern: /pawn|soldier|foot/i, white: WhitePawn, black: BlackPawn },
];

/**
 * Get a fallback piece image from the legacy library based on piece name.
 * Matches common chess piece names (king, queen, rook, bishop, knight, pawn).
 * Falls back to pawn if no match found.
 * @param {string} pieceName - The piece name to match
 * @param {number} playerId - 1 for white, 2 for black
 * @returns {string} webpack-resolved image URL
 */
export const getFallbackPieceImage = (pieceName, playerId) => {
  const name = pieceName || '';
  for (const entry of FALLBACK_KEYWORDS) {
    if (entry.pattern.test(name)) {
      return playerId === 2 ? entry.black : entry.white;
    }
  }
  return playerId === 2 ? BlackPawn : WhitePawn;
};

/**
 * onError handler for piece <img> tags — swaps to a library fallback.
 * @param {Event} e - The error event
 * @param {string} pieceName - The piece name
 * @param {number} playerId - 1 for white, 2 for black
 */
export const handlePieceImageError = (e, pieceName, playerId) => {
  const fallbackSrc = getFallbackPieceImage(pieceName, playerId);
  if (fallbackSrc && e.target.src !== fallbackSrc) {
    e.target.src = fallbackSrc;
  }
};
