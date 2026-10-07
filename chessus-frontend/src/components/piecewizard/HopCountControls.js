import React from "react";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "./InfoTooltip";
import ToggleSwitch from "../common/ToggleSwitch";

/*
 * How many pieces a straight-line move (or capture) hops, and where it lands.
 *
 * Shown under "Require hopping for any directional movement / attack". The
 * three settings are one rule in the move engines (straightHopRule), each from
 * 1 to 8:
 *   at least N pieces hopped   ("require hopping" alone is at least 1)
 *   at most N pieces hopped
 *   land at most N squares past the last piece hopped
 * Together they make the classic hoppers from settings any piece can combine:
 * a xiangqi cannon captures over exactly one piece (attack: at least 1, at most
 * 1); a grasshopper hops exactly one and lands right behind it (at least 1, at
 * most 1, land within 1).
 */
const MAX = 8;
const row = { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', paddingLeft: '4px' };

export default function HopCountControls({ pieceData, handleChange, attack = false }) {
  const field = (name) => (attack ? `${name}_attack` : name);
  const noun = attack ? 'attack' : 'move';
  const min = Number(pieceData[field('min_directional_hop_pieces')]) || 1;
  const max = pieceData[field('max_directional_hop_pieces')];
  const landing = pieceData[field('hop_landing_distance')];
  const clamp = (v) => Math.min(MAX, Math.max(1, Number(v) || 1));

  return (
    <>
      <div style={row}>
        <span style={{ fontSize: '0.9em' }}>At least this many pieces to hop over per directional {noun}:</span>
        <NumberInput
          value={min}
          // 1 is what "require hopping" already means, so it is stored as no extra rule.
          onChange={(v) => {
            const next = clamp(v);
            handleChange(field('min_directional_hop_pieces'), next > 1 ? next : null);
            if (max != null && Number(max) < next) handleChange(field('max_directional_hop_pieces'), next);
          }}
          options={{ min: 1, max: MAX, placeholder: "1" }}
        />
        <InfoTooltip text={`The ${noun} must pass over at least this many pieces before it lands. 1 is a cannon's screen; more needs more pieces in the way.`} />
      </div>
      <ToggleSwitch
        checked={max != null}
        onChange={(v) => handleChange(field('max_directional_hop_pieces'), v ? min : null)}
        label={`Limit max pieces in path per directional ${noun}`}
        tooltip={<InfoTooltip text={`When enabled, this piece can hop over at most this many pieces in a single directional ${noun} (1 to ${MAX}). Set it equal to the minimum to require an exact number - a xiangqi cannon hops exactly one. When disabled, there is no limit.`} />}
      />
      {max != null && (
        <div style={row}>
          <span style={{ fontSize: '0.9em' }}>Max pieces to hop over per directional {noun}:</span>
          <NumberInput
            value={max}
            onChange={(v) => handleChange(field('max_directional_hop_pieces'), Math.max(min, clamp(v)))}
            options={{ min, max: MAX, placeholder: String(min) }}
          />
        </div>
      )}
      <ToggleSwitch
        checked={landing != null}
        onChange={(v) => handleChange(field('hop_landing_distance'), v ? 1 : null)}
        label="Land close behind the last piece hopped"
        tooltip={<InfoTooltip text={`When enabled, after hopping the ${noun} must end within this many squares past the last piece it hopped over. 1 means right behind it, as a grasshopper lands. When disabled, it may land anywhere further along the line.`} />}
      />
      {landing != null && (
        <div style={row}>
          <span style={{ fontSize: '0.9em' }}>Land at most this many squares past the last piece hopped:</span>
          <NumberInput
            value={landing}
            onChange={(v) => handleChange(field('hop_landing_distance'), clamp(v))}
            options={{ min: 1, max: MAX, placeholder: "1" }}
          />
        </div>
      )}
    </>
  );
}
