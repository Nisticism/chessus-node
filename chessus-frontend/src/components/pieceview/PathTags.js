import React from "react";
import { pieceMovementPaths, pieceCapturePaths, pathWords } from "../../helpers/movePaths";
import { firstMoveWords } from "../../helpers/firstMove";
import FirstMoveTag from "./FirstMoveTag";
import { wrapValue, wrapWords } from "../../helpers/boardWrap";

/*
 * Movement properties of the piece page that do not belong to one movement
 * style: its first-move movement (helpers/firstMove.js) and its paths - moves
 * made of legs (helpers/movePaths.js), one tag each. Shown under "Movement
 * Details" whatever else the piece has (a rose has nothing but a path).
 * Nothing at all when the piece has neither. Its own component so the page
 * gains no branch (giant components sit at the hooks-lint limit).
 */
export default function PathTags({ piece, wrapperClassName, className, iconClassName }) {
  const tags = [
    ...pieceMovementPaths(piece).map((p) => ['Path', p]),
    ...pieceCapturePaths(piece).map((p) => ['Attack path', p]),
  ];
  const wraps = wrapValue(piece.piece_wrap) !== 'off';
  if (!tags.length && !firstMoveWords(piece) && !wraps) return null;
  return (
    <div className={wrapperClassName}>
      <FirstMoveTag piece={piece} className={className} iconClassName={iconClassName} />
      {wraps && (
        <div className={className}>
          <span className={iconClassName}>🔁</span>
          Wraps round the board: {wrapWords(piece.piece_wrap)}
        </div>
      )}
      {tags.map(([label, p], i) => (
        <div key={i} className={className}>
          <span className={iconClassName}>🧭</span>
          {label}: {pathWords(p)}
        </div>
      ))}
    </div>
  );
}
