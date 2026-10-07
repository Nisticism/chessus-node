import React from "react";
import { firstMoveWords } from "../../helpers/firstMove";

/*
 * "Has its own first-move movement", on the piece page - a tag beside the
 * other movement properties. Its own component so the page gains no branch
 * (giant components sit at the hooks-lint limit). Nothing without one.
 */
export default function FirstMoveTag({ piece, className, iconClassName }) {
  const words = firstMoveWords(piece);
  if (!words) return null;
  return (
    <div className={className}>
      <span className={iconClassName}>🌱</span>
      {words.charAt(0).toUpperCase() + words.slice(1)}
    </div>
  );
}
