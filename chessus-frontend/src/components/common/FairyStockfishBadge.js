import React from "react";

/**
 * Tiny inline badge used inside the game-wizard and piece-wizard pages
 * to flag whether a given setting is compatible with the Fairy-Stockfish
 * bot. Keep usage to the most confusing settings - the goal is to help
 * builders avoid surprises, not to label every option.
 *
 * Usage:
 *   <FairyStockfishBadge compatible />
 *   <FairyStockfishBadge incompatible />
 */
export default function FairyStockfishBadge({ compatible, incompatible, note }) {
  const isIncompatible = !!incompatible || (compatible === false);
  const isCompatible = !!compatible && !isIncompatible;
  const color = isIncompatible ? "#ff7a7a" : isCompatible ? "#7bd88f" : "#aaa";
  const text = isIncompatible
    ? "Not compatible with Fairy Stockfish"
    : isCompatible
      ? "Compatible with Fairy Stockfish"
      : "Fairy Stockfish";
  const title = note || text;
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        marginLeft: 6,
        padding: "1px 6px",
        fontSize: 10,
        lineHeight: "14px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        color,
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      {isIncompatible ? "FS: No" : "FS: Yes"}
    </span>
  );
}
