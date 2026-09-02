import React from "react";

/**
 * Small info banner shown at the top of game-wizard and piece-wizard
 * pages to summarize which settings are compatible with the
 * Fairy-Stockfish computer player.
 *
 * Pass `kind` to select the relevant copy for each wizard step.
 */
const COPY = {
  winConditions: {
    title: "Fairy Stockfish compatibility - Win Conditions",
    yes:  "Checkmate, Capture, No-Moves, Hill (squares), Lose-All-Pieces, Forced Capture, draw-by-move-limit, repetition draw",
    no:   "Piece Count, Points to Win, Simultaneous Turns, Optional Condition (custom)",
  },
  piecePlacement: {
    title: "Fairy Stockfish compatibility - Board & Placement",
    yes:  "no placement-action, no start repositions; randomization 'none', 'backrow' or 'mirrored' (the Chess960 / Fischer-random style)",
    no:   "place-pieces action, start repositions; randomization 'independent', 'shared' or 'full'",
    safe: "Fog of War, Hidden Enemy Pieces, and Veto Power - the game is playable, but the engine sees the full board / doesn't strategically model these mechanics",
  },
  pieceMovement: {
    title: "Fairy Stockfish compatibility - Piece Movement",
    yes:  "Standard sliders, leapers, ratio jumps (e.g. knight 2:1), pawn-style move/capture splits, hop-over-enemy (cannon) and hop-over-ally (grasshopper)",
    no:   "Step-by-step movement, directional movement change",
  },
  pieceAttack: {
    title: "Fairy Stockfish compatibility - Piece Attack",
    yes:  "Standard capture-by-replacement, en-passant, pawn-style capture directions",
    no:   "Ranged fire-over-allies / fire-over-enemies",
  },
  pieceSpecial: {
    title: "Fairy Stockfish compatibility - Special Abilities",
    yes:  "Castling, promotion, en-passant, cannot-be-captured (treated as immovable obstacle)",
    no:   "Trample, ghostwalk, attack radius, capture allies, must-move-if-able, chain capture, hit-points / attack damage",
  },
};

export default function FairyStockfishInfoNote({ kind }) {
  const c = COPY[kind] || COPY.winConditions;
  return (
    <div
      style={{
        background: "rgba(80, 100, 140, 0.10)",
        border: "1px solid rgba(120, 160, 220, 0.30)",
        borderRadius: 6,
        padding: "8px 12px",
        margin: "10px 0",
        fontSize: 12,
        lineHeight: 1.5,
      }}
      title="The Fairy Stockfish bot is a strong, classical chess-engine-style computer opponent. Settings outside its compatible set will disable it for this game type."
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{c.title}</div>
      <div><span style={{ color: "#7bd88f" }}>Compatible:</span> {c.yes}</div>
      <div><span style={{ color: "#ff7a7a" }}>Not compatible:</span> {c.no}</div>
      {c.safe && (
        <div><span style={{ color: "#e2c14d" }}>Playable, but not modeled:</span> {c.safe}</div>
      )}
    </div>
  );
}
