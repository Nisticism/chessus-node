import { lPathWords } from './hopRuleWords';
import { firstMoveWords } from './firstMove';
import { pieceMovementPaths, pieceCapturePaths, pathWords } from './movePaths';

/*
 * Lines for a piece's rules description (the game page) that stand on their
 * own: what blocks its L-moves, its first-move movement, its paths. Each
 * says nothing when the piece has none.
 *
 * Kept out of GameTypeView, which sits at the hooks-lint limit (one more
 * branch there gives false rules-of-hooks errors); there it is one line.
 * The L-move and first-move words used to ride on the "Hop" line, so a piece
 * that did not hop - a xiangqi horse - never showed them.
 */
export function pieceDescriptionExtras(piece) {
  if (!piece) return '';
  const lines = [];
  const lWords = lPathWords(piece).replace(/^ · /, '');
  if (lWords) lines.push(`• **L-moves**: ${lWords.charAt(0).toUpperCase()}${lWords.slice(1)}.`);
  const fm = firstMoveWords(piece);
  if (fm) lines.push(`• **First Move**: ${fm.charAt(0).toUpperCase()}${fm.slice(1)}.`);
  const sentence = (p) => pathWords(p).replace(/\.$/, '');
  for (const p of pieceMovementPaths(piece)) lines.push(`• **Path**: ${sentence(p)}.`);
  for (const p of pieceCapturePaths(piece)) lines.push(`• **Attack Path**: ${sentence(p)}.`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}
