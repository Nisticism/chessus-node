import React from "react";
import { BLOCKED_DOT_MODES } from "../../helpers/moveEngine";
import { BLOCKED_DOT_MODE_LABELS, useBlockedDotMode } from "../../helpers/blockedDotMode";
import InfoTooltip from "../piecewizard/InfoTooltip";

/*
 * The setting for the hollow "blocked" dots, for any options panel. Its own
 * component so the big boards that show it gain no state for it.
 */
const BlockedDotModeSelect = ({ className, labelClassName }) => {
  const [mode, setMode] = useBlockedDotMode();
  return (
    <label className={className} style={className ? undefined : { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "6px 0" }}>
      <span className={labelClassName}>
        Blocked-move dots{" "}
        <InfoTooltip text="Hollow, dashed dots show where a piece's pattern reaches but it cannot go right now - your own piece, a piece it cannot capture, an impassable square, or a move check rules out. 'Full pattern' shows every such square and is fast on any board. 'Only what's in the way' marks just the square that stops the piece; it can be slower on very large boards." />
      </span>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        aria-label="Blocked-move dots"
        style={{
          background: "var(--bg-input, #0d1f14)",
          color: "var(--text-main, #c8e6d0)",
          border: "1px solid var(--border-medium, #2a8b5d)",
          borderRadius: 4,
          padding: "3px 6px",
          fontSize: "0.9rem",
          maxWidth: "100%",
        }}
      >
        {BLOCKED_DOT_MODES.map((m) => (
          <option key={m} value={m}>{BLOCKED_DOT_MODE_LABELS[m]}</option>
        ))}
      </select>
    </label>
  );
};

export default BlockedDotModeSelect;
