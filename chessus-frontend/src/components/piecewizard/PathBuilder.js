import React from "react";
import styles from "./piecewizard.module.scss";
import InfoTooltip from "./InfoTooltip";
import NumberInput from "../common/NumberInput";
import {
  parsePaths, pathWords, stepVectors, DEFAULT_TURN,
  MAX_PATHS, MAX_PATH_LEGS, MAX_PATH_COUNT, MAX_STEP,
} from "../../helpers/movePaths";

/*
 * Steps 2 and 3: a piece's PATHS - moves made of legs (helpers/movePaths.js).
 *
 * Each path is a list of legs walked in order; each leg has a step (one
 * square orthogonally or diagonally, a knight's jump, any (a,b) jump), how
 * many steps it goes in a line, how many times it repeats (turning between),
 * where it may go - absolute directions for the first leg, turns relative to
 * the step before for every other - and what it may pass over. The Betza
 * presets in Step 1 fill these in (a griffon, a rose ...); this is where they
 * can be changed or built from scratch.
 *
 * Stored as JSON in `field` (movement_paths / capture_paths); null for none.
 */
const STEP_KINDS = [
  { key: 'orth', label: 'One square orthogonally', step: [[1, 0]] },
  { key: 'diag', label: 'One square diagonally', step: [[1, 1]] },
  { key: 'king', label: 'One square, any direction', step: [[1, 0], [1, 1]] },
  { key: 'knight', label: 'A knight jump', step: [[2, 1]] },
  { key: 'jump', label: 'Another jump...', step: null },
];
const stepKey = (step) => {
  const k = step.map((s) => s.join(',')).sort().join('|');
  const found = STEP_KINDS.find((s) => s.step && s.step.map((x) => x.join(',')).sort().join('|') === k);
  return found ? found.key : 'jump';
};
const TURN_GRID = [['fl', 'f', 'fr'], ['l', null, 'r'], ['bl', 'b', 'br']];
const TURN_ARROWS = { f: '↑', fr: '↗', r: '→', br: '↘', b: '↓', bl: '↙', l: '←', fl: '↖' };
const TURN_NAMES = {
  f: 'Straight on', fr: 'A slight turn right', r: 'A right-angle turn right', br: 'A sharp turn right',
  b: 'Straight back', bl: 'A sharp turn left', l: 'A right-angle turn left', fl: 'A slight turn left',
};
const OVER_OPTIONS = [
  ['none', 'Only empty squares'],
  ['allies', 'Its own pieces too'],
  ['enemies', 'Enemy pieces too'],
  ['any', 'Any piece'],
];
const TURNING_OPTIONS = [
  ['any', 'Any way it is allowed to'],
  ['same', 'Always the same way round (like a rose)'],
  ['alternate', 'Left and right in turn (zig-zag)'],
];

const newLeg = (first) => ({ step: [[1, 0]], dirs: null, turn: null, dist: [1, 1], times: [1, 1], over: 'none' });
const clampCount = (v, lo) => Math.min(MAX_PATH_COUNT, Math.max(lo, Number(v) || lo));

/* A min-max pair with an "no limit" switch for the max. */
function RangeControl({ label, tip, value, min, onChange }) {
  const [lo, hi] = value;
  return (
    <div className={styles["path-range"]}>
      <span className={styles["path-range-label"]}>{label} <InfoTooltip text={tip} /></span>
      <NumberInput
        value={lo}
        onChange={(v) => { const n = clampCount(v, min); onChange([n, hi == null ? null : Math.max(hi, n, 1)]); }}
        options={{ min, max: MAX_PATH_COUNT, placeholder: String(min), className: styles["form-input-small"] }}
      />
      <span>to</span>
      {hi != null && (
        <NumberInput
          value={hi}
          onChange={(v) => onChange([lo, Math.max(clampCount(v, 1), lo, 1)])}
          options={{ min: Math.max(lo, 1), max: MAX_PATH_COUNT, placeholder: String(Math.max(lo, 1)), className: styles["form-input-small"] }}
        />
      )}
      <label className={styles["path-check"]}>
        <input type="checkbox" checked={hi == null} onChange={(e) => onChange([lo, e.target.checked ? null : Math.max(lo, 1)])} />
        no limit
      </label>
    </div>
  );
}

/* The first leg's directions: the squares one step reaches, around the piece. */
function DirectionPicker({ step, dirs, onChange }) {
  const all = stepVectors(step);
  const reach = Math.max(...step.map((s) => s[0]));
  const on = (v) => !dirs || dirs.some((d) => d[0] === v[0] && d[1] === v[1]);
  const toggle = (v) => {
    const current = dirs || all;
    const next = on(v) ? current.filter((d) => !(d[0] === v[0] && d[1] === v[1])) : [...current, v];
    onChange(next.length >= all.length ? null : next);
  };
  const size = reach * 2 + 1;
  const cells = [];
  for (let y = -reach; y <= reach; y++) {
    for (let x = -reach; x <= reach; x++) {
      const v = all.find((d) => d[0] === x && d[1] === y);
      if (x === 0 && y === 0) {
        cells.push(<div key={`${x},${y}`} className={`${styles["path-dir-cell"]} ${styles["path-dir-piece"]}`} title="The piece (forward is up)" />);
      } else if (v) {
        cells.push(
          <button
            type="button"
            key={`${x},${y}`}
            className={`${styles["path-dir-cell"]} ${on(v) ? styles["path-dir-on"] : styles["path-dir-off"]}`}
            onClick={() => toggle(v)}
            aria-pressed={on(v)}
            title={`${on(v) ? 'Goes' : 'Does not go'} this way - click to change`}
          />,
        );
      } else {
        cells.push(<div key={`${x},${y}`} className={styles["path-dir-cell"]} />);
      }
    }
  }
  return (
    <div className={styles["path-dirs"]}>
      <div className={styles["path-dir-grid"]} style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, width: `${Math.min(size, 9) * 1.5}rem` }}>
        {cells}
      </div>
      <div className={styles["path-dirs-note"]}>
        Click the squares to choose which ways it starts (forward is up).
        {dirs && <> <button type="button" className={styles["betza-link"]} onClick={() => onChange(null)}>All ways</button></>}
      </div>
    </div>
  );
}

/* Turns relative to the step before: a compass with "the way it was going" pointing up. */
function TurnPicker({ turn, onChange }) {
  const set = turn || DEFAULT_TURN;
  const toggle = (h) => {
    const next = set.includes(h) ? set.filter((x) => x !== h) : [...set, h];
    const isDefault = next.length === DEFAULT_TURN.length && DEFAULT_TURN.every((x) => next.includes(x));
    onChange(isDefault ? null : next);
  };
  return (
    <div className={styles["path-turns"]}>
      <div className={styles["path-turn-grid"]}>
        {TURN_GRID.flat().map((h, i) => (h ? (
          <button
            type="button"
            key={h}
            className={`${styles["path-turn"]} ${set.includes(h) ? styles["path-turn-on"] : ''}`}
            onClick={() => toggle(h)}
            aria-pressed={set.includes(h)}
            title={TURN_NAMES[h]}
          >
            {TURN_ARROWS[h]}
          </button>
        ) : (
          <div key={`c${i}`} className={styles["path-turn-center"]} title="The way it was going is up">&#9679;</div>
        )))}
      </div>
      <div className={styles["path-dirs-note"]}>
        Which ways it may turn, with the way it was going pointing up.
      </div>
    </div>
  );
}

function LegEditor({ leg, index, count, onChange, onRemove }) {
  const first = index === 0;
  const key = stepKey(leg.step);
  const setStep = (k) => {
    const kind = STEP_KINDS.find((s) => s.key === k);
    onChange({ ...leg, step: kind.step || [[2, 0]], dirs: null });
  };
  const jump = leg.step[0];
  const repeats = leg.times[1] == null || leg.times[1] > 1;
  return (
    <div className={styles["path-leg"]}>
      <div className={styles["path-leg-head"]}>
        <strong>Leg {index + 1}</strong>
        {count > 1 && <button type="button" className={styles["betza-link"]} onClick={onRemove}>Remove leg</button>}
      </div>
      <div className={styles["path-row"]}>
        <span className={styles["path-range-label"]}>Each step <InfoTooltip text="What one step of this leg is. A jump lands on its square without touching any in between; one-square steps go square by square." /></span>
        <select className={styles["form-select"]} value={key} onChange={(e) => setStep(e.target.value)}>
          {STEP_KINDS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {key === 'jump' && (
          <>
            <NumberInput
              value={jump[0]}
              onChange={(v) => onChange({ ...leg, step: [[Math.min(MAX_STEP, Math.max(1, Number(v) || 1)), jump[1]]], dirs: null })}
              options={{ min: 1, max: MAX_STEP, placeholder: "2", className: styles["form-input-small"] }}
            />
            <span>by</span>
            <NumberInput
              value={jump[1]}
              onChange={(v) => onChange({ ...leg, step: [[jump[0], Math.min(MAX_STEP, Math.max(0, Number(v) || 0))]], dirs: null })}
              options={{ min: 0, max: MAX_STEP, placeholder: "0", className: styles["form-input-small"] }}
            />
            <InfoTooltip text="A jump of so many squares one way and so many the other: 2 by 0 is a dabbaba's jump, 3 by 1 a camel's, 2 by 2 an alfil's. Up to 8 each way." />
          </>
        )}
      </div>
      <RangeControl
        label="Steps in a line"
        tip="How far this leg goes in a straight line, in steps: 1 to 1 is a single step; 1 to no limit slides (or rides) as far as the board and the pieces allow. The path may stop after any number of steps in this range."
        value={leg.dist}
        min={1}
        onChange={(dist) => onChange({ ...leg, dist })}
      />
      <RangeControl
        label="Times"
        tip={first
          ? 'How many times this leg is made, turning between each (a rose makes its knight jump up to 7 times). The first leg is made at least once.'
          : 'How many times this leg is made, turning between each. 0 makes the leg optional: the path may end before it (a griffon may stop after its diagonal step).'}
        value={leg.times}
        min={first ? 1 : 0}
        onChange={(times) => onChange({ ...leg, times })}
      />
      {first && (
        <div className={styles["path-row"]}>
          <span className={styles["path-range-label"]}>Starts</span>
          <DirectionPicker step={leg.step} dirs={leg.dirs} onChange={(dirs) => onChange({ ...leg, dirs })} />
        </div>
      )}
      {(!first || repeats) && (
        <div className={styles["path-row"]}>
          <span className={styles["path-range-label"]}>{first ? 'Then turns' : 'Turns'} <InfoTooltip text={first
            ? 'Between one time of this leg and the next, which way it may turn from its last step.'
            : 'Which way it may turn onto this leg from the step before it (and between its own times). Straight on is allowed, straight back is not, unless you choose it.'} /></span>
          <TurnPicker turn={leg.turn} onChange={(turn) => onChange({ ...leg, turn })} />
        </div>
      )}
      <div className={styles["path-row"]}>
        <span className={styles["path-range-label"]}>May pass <InfoTooltip text="What may stand on the squares this leg lands on before the path ends - the corners it turns at and the steps of a slide. A path always ends on an empty square, or on a piece it captures." /></span>
        <select className={styles["form-select"]} value={leg.over} onChange={(e) => onChange({ ...leg, over: e.target.value })}>
          {OVER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}

export default function PathBuilder({ pieceData, updatePieceData, field, noun }) {
  const paths = parsePaths(pieceData[field]);
  const save = (next) => updatePieceData({ [field]: next.length ? JSON.stringify(next) : null });
  const setPath = (i, p) => save(paths.map((x, j) => (j === i ? p : x)));
  const addPath = () => save([...paths, { legs: [newLeg(true)], turning: 'any' }]);

  return (
    <div className={styles["path-builder"]}>
      {paths.map((p, i) => (
        <div key={i} className={styles["path-card"]}>
          <div className={styles["path-card-head"]}>
            <strong>Path {i + 1}</strong>
            <span className={styles["path-words"]}>{pathWords(p)}</span>
            <button type="button" className={styles["betza-link"]} onClick={() => save(paths.filter((_, j) => j !== i))}>Remove path</button>
          </div>
          {p.legs.map((leg, li) => (
            <LegEditor
              key={li}
              leg={leg}
              index={li}
              count={p.legs.length}
              onChange={(l) => setPath(i, { ...p, legs: p.legs.map((x, k) => (k === li ? l : x)) })}
              onRemove={() => setPath(i, { ...p, legs: p.legs.filter((_, k) => k !== li) })}
            />
          ))}
          <div className={styles["path-row"]}>
            <button
              type="button"
              className={styles["add-movement-btn"]}
              onClick={() => setPath(i, { ...p, legs: [...p.legs, newLeg(false)] })}
              disabled={p.legs.length >= MAX_PATH_LEGS}
            >
              + Add a leg{p.legs.length >= MAX_PATH_LEGS ? ' (max reached)' : ''}
            </button>
          </div>
          <div className={styles["path-row"]}>
            <span className={styles["path-range-label"]}>Its left and right turns <InfoTooltip text="How the path's turns go together. A rose keeps turning the same way round; a crooked bishop turns left and right in turn." /></span>
            <select className={styles["form-select"]} value={p.turning} onChange={(e) => setPath(i, { ...p, turning: e.target.value })}>
              {TURNING_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      ))}
      <button type="button" className={styles["add-movement-btn"]} onClick={addPath} disabled={paths.length >= MAX_PATHS}>
        + Add a {noun} path{paths.length >= MAX_PATHS ? ' (max reached)' : ''}
      </button>
    </div>
  );
}
