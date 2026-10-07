import React from "react";
import InfoTooltip from "./InfoTooltip";
import ToggleSwitch from "../common/ToggleSwitch";
import styles from "./piecewizard.module.scss";

/*
 * How pieces in the way block an L-shaped move (lPathRule in the move engines).
 *
 * The move is two straight legs. Leg one is the longer; when they are equal,
 * leg one is the sideways leg. The settings say which route the piece takes,
 * which legs a piece in the way blocks, and whether the corner square where
 * the legs meet blocks. The defaults are the rule L-moves always had: either
 * route, both legs, corner included - blocked only when both routes are.
 *
 * Moving and capturing are set separately (attack: the *_attack settings).
 * A piece that hops over allies and enemies jumps, and none of this applies.
 */
const ORDERS = [
  ['', 'Either route (blocked only when both are)'],
  ['long_first', 'Leg one (the longer) first'],
  ['short_first', 'Leg two (the shorter) first'],
];
const LEGS = [
  ['', 'Both legs'],
  ['long', 'Leg one (the longer) only'],
  ['short', 'Leg two (the shorter) only'],
];

export default function LPathControls({ pieceData, handleChange, attack = false }) {
  const field = (name) => (attack ? `${name}_attack` : name);
  const r1 = Number(pieceData[attack ? 'ratio_one_capture' : 'ratio_one_movement']) || 0;
  const r2 = Number(pieceData[attack ? 'ratio_two_capture' : 'ratio_two_movement']) || 0;
  if (!(r1 > 0 && r2 > 0)) return null;
  if (pieceData.can_hop_over_allies && pieceData.can_hop_over_enemies) {
    return (
      <p className={styles["field-hint"]}>
        This piece hops over allies and enemies (Hopping, step 2), so nothing in the way blocks its L-shaped {attack ? 'captures' : 'moves'}.
      </p>
    );
  }
  const order = pieceData[field('ratio_path_order')] || '';
  const legs = pieceData[field('ratio_path_blocking')] || '';
  const cornerRaw = pieceData[field('ratio_path_corner_blocks')];
  const corner = cornerRaw === null || cornerRaw === undefined || cornerRaw === '' ? true : !!Number(cornerRaw) || cornerRaw === true;
  const set = (name, v) => handleChange(field(name), v || null);
  const xiangqi = () => {
    handleChange(field('ratio_path_order'), 'long_first');
    handleChange(field('ratio_path_blocking'), 'long');
    handleChange(field('ratio_path_corner_blocks'), 0);
  };

  return (
    <div className={styles["sub-option"]} style={{ marginTop: '10px' }}>
      <label style={{ display: 'block', marginBottom: '4px' }}>
        What blocks the L-shaped {attack ? 'capture' : 'move'}{' '}
        <InfoTooltip text="The move is two straight legs. Leg one is the longer (the sideways leg when they are equal). Choose which route the piece takes, which legs a piece in the way blocks, and whether the corner where the legs meet counts. The default - either route, both legs, corner included - is blocked only when both routes are. A Xiangqi horse is blocked only by the square beside it in the long direction." />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <select value={order} onChange={(e) => set('ratio_path_order', e.target.value)} aria-label="Route">
          {ORDERS.map(([v, l]) => <option key={v || 'either'} value={v}>{l}</option>)}
        </select>
        <select value={legs} onChange={(e) => set('ratio_path_blocking', e.target.value)} aria-label="Blocking legs">
          {LEGS.map(([v, l]) => <option key={v || 'both'} value={v}>{l}</option>)}
        </select>
        <button type="button" className={styles["betza-link"]} onClick={xiangqi}>Like a Xiangqi horse</button>
      </div>
      <ToggleSwitch
        checked={corner}
        onChange={(v) => handleChange(field('ratio_path_corner_blocks'), v ? null : 0)}
        label="The corner square blocks it"
        tooltip={<InfoTooltip text="The square where the two legs meet. Off for a Xiangqi horse, which is blocked only by the square beside it." />}
      />
    </div>
  );
}
