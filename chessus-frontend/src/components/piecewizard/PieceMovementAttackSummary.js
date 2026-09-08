import React from "react";
import styles from "./piecewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import {
  hasAnyMovement, hasAnyAttack, movementToAttackUpdates, attackToMovementUpdates,
} from "../../helpers/pieceMovementAttackCopy";

/*
 * The movement and attack half of the review step, spelled out.
 *
 * The general summary below this one answers "is directional movement on?".
 * This answers "what does this piece actually do?" - every direction, distance,
 * L-shape and step budget it will have once saved - because that is the thing
 * worth checking before you commit, and it is the only place a piece that can
 * do NOTHING becomes obvious.
 *
 * When one side is empty the whole panel is outlined in red, says so, and
 * offers to copy the other side across. It never blocks saving: a piece that
 * only moves, or one that sits still and takes whatever comes near it, is a
 * legitimate design, and the site already has several.
 */

const DIRS = [
  { key: 'up_left', arrow: '↖', label: 'Up-Left' },
  { key: 'up', arrow: '↑', label: 'Up' },
  { key: 'up_right', arrow: '↗', label: 'Up-Right' },
  { key: 'left', arrow: '←', label: 'Left' },
  { key: 'right', arrow: '→', label: 'Right' },
  { key: 'down_left', arrow: '↙', label: 'Down-Left' },
  { key: 'down', arrow: '↓', label: 'Down' },
  { key: 'down_right', arrow: '↘', label: 'Down-Right' },
];

const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

/** 99 is the wizard's "infinite"; an exact flag means that distance only. */
const describeDistance = (value, exact) => {
  const n = num(value);
  if (n === 99) return 'any distance';
  if (exact) return `exactly ${n}`;
  return `up to ${n}`;
};

const countCustomSquares = (raw) => {
  if (!raw) return 0;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch (_) {
    return 0;
  }
};

/**
 * Everything one side of the piece can do, as a list of rows.
 * `suffix` picks the column family: '_movement', '_capture' or '_attack_range'.
 */
const describeSide = (pieceData, suffix, extras = {}) => {
  const rows = [];

  const dirs = DIRS
    .filter((d) => num(pieceData[`${d.key}${suffix}`]) !== 0)
    .map((d) => ({
      arrow: d.arrow,
      label: d.label,
      text: describeDistance(pieceData[`${d.key}${suffix}`], pieceData[`${d.key}${suffix}_exact`]),
    }));
  if (dirs.length) rows.push({ kind: 'directions', label: 'Directions', dirs });

  const r1 = num(pieceData[extras.ratioOne]);
  const r2 = num(pieceData[extras.ratioTwo]);
  if (r1 && r2) {
    rows.push({
      kind: 'text',
      label: 'L-shape',
      text: `${r1} then ${r2}${extras.repeatingRatio ? ', repeating' : ''}`,
    });
  }

  const step = num(pieceData[extras.step]);
  if (step) {
    const noDiagonal = step < 0;
    const noOrthogonal = !!pieceData[extras.stepNoOrthogonal];
    const shape = noDiagonal ? 'orthogonal steps only'
      : noOrthogonal ? 'diagonal steps only'
        : 'any direction';
    rows.push({ kind: 'text', label: 'Step-by-step', text: `${Math.abs(step)} steps, ${shape}` });
  }

  const custom = countCustomSquares(pieceData[extras.custom]);
  if (custom) rows.push({ kind: 'text', label: 'Custom squares', text: `${custom} square${custom === 1 ? '' : 's'}` });

  if (pieceData[extras.scenario]) {
    rows.push({ kind: 'text', label: 'Situational', text: 'extra options on certain moves' });
  }

  return rows;
};

const SideRows = ({ rows }) => (
  <>
    {rows.map((row, i) => (
      <div key={i} className={styles["ma-row"]}>
        <span className={styles["ma-row-label"]}>{row.label}</span>
        {row.kind === 'directions' ? (
          <span className={styles["ma-dirs"]}>
            {row.dirs.map((d) => (
              <span key={d.label} className={styles["ma-dir"]} title={d.label}>
                <span className={styles["ma-arrow"]}>{d.arrow}</span> {d.text}
              </span>
            ))}
          </span>
        ) : (
          <span className={styles["ma-row-value"]}>{row.text}</span>
        )}
      </div>
    ))}
  </>
);

const PieceMovementAttackSummary = ({ pieceData, updatePieceData }) => {
  const canMove = hasAnyMovement(pieceData);
  const canAttack = hasAnyAttack(pieceData);

  const movementRows = describeSide(pieceData, '_movement', {
    ratioOne: 'ratio_one_movement',
    ratioTwo: 'ratio_two_movement',
    repeatingRatio: pieceData.repeating_ratio,
    step: 'step_by_step_movement_value',
    stepNoOrthogonal: 'step_by_step_movement_no_orthogonal',
    custom: 'custom_movement_squares',
    scenario: 'special_scenario_moves',
  });

  /*
   * The attack side has two families - capturing by moving onto the square, and
   * capturing at range - and each only counts when its own toggle is on, since
   * the save route clears capture-on-move values when that toggle is off.
   */
  const captureRows = pieceData.can_capture_enemy_on_move
    ? describeSide(pieceData, '_capture', {
      ratioOne: 'ratio_one_capture',
      ratioTwo: 'ratio_two_capture',
      repeatingRatio: pieceData.repeating_ratio_capture,
      step: 'step_by_step_capture',
      stepNoOrthogonal: 'step_by_step_capture_no_orthogonal',
      custom: 'custom_attack_squares',
      scenario: 'special_scenario_captures',
    })
    : [];

  const rangedRows = pieceData.can_capture_enemy_via_range
    ? describeSide(pieceData, '_attack_range', {
      ratioOne: 'ratio_one_attack_range',
      ratioTwo: 'ratio_two_attack_range',
      repeatingRatio: pieceData.repeating_ratio_ranged_attack,
      step: 'step_by_step_attack_range',
      stepNoOrthogonal: 'step_by_step_attack_no_orthogonal',
      custom: null,
      scenario: null,
    })
    : [];

  const attacksLikeMovement = !!pieceData.attacks_like_movement && canMove;
  const incomplete = !canMove || !canAttack;

  return (
    <div className={`${styles["ma-summary"]}${incomplete ? ` ${styles["ma-incomplete"]}` : ''}`}>
      <h3>Movement &amp; Attack</h3>

      <div className={styles["ma-columns"]}>
        <div className={styles["ma-column"]}>
          <h4>Movement</h4>
          {canMove
            ? <SideRows rows={movementRows} />
            : <p className={styles["ma-empty"]}>This piece cannot move.</p>}
          {canMove && (pieceData.can_hop_over_allies || pieceData.can_hop_over_enemies) && (
            <div className={styles["ma-row"]}>
              <span className={styles["ma-row-label"]}>Hopping</span>
              <span className={styles["ma-row-value"]}>
                over {[pieceData.can_hop_over_allies && 'allies', pieceData.can_hop_over_enemies && 'enemies']
                  .filter(Boolean).join(' and ')}
              </span>
            </div>
          )}
        </div>

        <div className={styles["ma-column"]}>
          <h4>Attack</h4>
          {!canAttack && <p className={styles["ma-empty"]}>This piece cannot capture anything.</p>}

          {attacksLikeMovement && (
            <div className={styles["ma-row"]}>
              <span className={styles["ma-row-label"]}>Captures</span>
              <span className={styles["ma-row-value"]}>using its movement pattern</span>
            </div>
          )}
          {!!captureRows.length && (
            <>
              <div className={styles["ma-subhead"]}>By moving onto the square</div>
              <SideRows rows={captureRows} />
            </>
          )}
          {!!rangedRows.length && (
            <>
              <div className={styles["ma-subhead"]}>At range, without moving</div>
              <SideRows rows={rangedRows} />
            </>
          )}
          {canAttack && (pieceData.can_hop_attack_over_allies || pieceData.can_hop_attack_over_enemies) && (
            <div className={styles["ma-row"]}>
              <span className={styles["ma-row-label"]}>Hopping</span>
              <span className={styles["ma-row-value"]}>
                over {[pieceData.can_hop_attack_over_allies && 'allies', pieceData.can_hop_attack_over_enemies && 'enemies']
                  .filter(Boolean).join(' and ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {incomplete && (
        <div className={styles["ma-warning"]}>
          <p>
            {!canMove && !canAttack
              ? 'This piece can neither move nor capture, so it will do nothing in a game. You can still save it — but there is nothing to copy across, so give it a movement or an attack first.'
              : !canAttack
                ? 'This piece can move but cannot capture anything. You can still save it — a piece that only moves is a valid design — or give it the same pattern for attacking as it uses for moving.'
                : 'This piece can capture but cannot move, so it will never leave its starting square. You can still save it — an immobile piece is a valid design — or give it the same pattern for moving as it uses for attacking.'}
          </p>
          {!canAttack && canMove && (
            <StandardButton
              buttonText="Copy Movement to Attack"
              onClick={() => updatePieceData(movementToAttackUpdates(pieceData))}
            />
          )}
          {!canMove && canAttack && (
            <StandardButton
              buttonText="Copy Attack to Movement"
              onClick={() => updatePieceData(attackToMovementUpdates(pieceData))}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default PieceMovementAttackSummary;
