import React from "react";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "./InfoTooltip";
import ToggleSwitch from "../common/ToggleSwitch";

/*
 * "Repeat at most N times", under "Repeating exact movement / capture".
 *
 * A dabbaba rider (exact 2, repeating) lands on 2, 4, 6, ... to the edge; with
 * a limit of 3 it stops at 6 (Betza DD3). 1-8; off = no limit, the rule
 * repeating exact moves always had. The move engines read it as repeatCap.
 * Renders nothing unless repeating is on.
 */
const MAX = 8;

export default function RepeatLimitControl({ pieceData, handleChange, attack = false }) {
  const repeatingField = attack ? 'repeating_capture' : 'repeating_movement';
  const field = attack ? 'max_repeating_capture' : 'max_repeating_movement';
  if (!pieceData[repeatingField]) return null;
  const limit = pieceData[field];
  const noun = attack ? 'capture' : 'move';
  return (
    <div style={{ marginLeft: '24px', marginTop: '6px' }}>
      <ToggleSwitch
        checked={limit != null}
        onChange={(v) => handleChange(field, v ? 2 : null)}
        label="Limit how many times it repeats"
        tooltip={<InfoTooltip text={`When enabled, the exact ${noun} repeats at most this many times in one ${noun}: Exact 2 repeating at most 3 times lands on 2, 4 and 6 only. When disabled, it repeats to the edge of the board.`} />}
      />
      {limit != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', paddingLeft: '4px' }}>
          <span style={{ fontSize: '0.9em' }}>Repeat at most this many times:</span>
          <NumberInput
            value={limit}
            onChange={(v) => handleChange(field, Math.min(MAX, Math.max(1, Number(v) || 1)))}
            options={{ min: 1, max: MAX, placeholder: "2" }}
          />
        </div>
      )}
    </div>
  );
}
