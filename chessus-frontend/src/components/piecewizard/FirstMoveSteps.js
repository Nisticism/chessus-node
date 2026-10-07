import React, { useMemo, useState } from "react";
import styles from "./piecewizard.module.scss";
import InfoTooltip from "./InfoTooltip";
import NumberInput from "../common/NumberInput";
import {
  FIRST_MOVE_FIELDS, MAX_FIRST_MOVES, parseFirstMoveProfile, compactFirstMoveProfile,
  convertLegacyFirstMove, clearLegacyFirstMove,
} from "../../helpers/firstMove";

/*
 * The Movement and Attack steps, for EVERY move or for the FIRST move(s).
 *
 * A piece's first-move movement (helpers/firstMove.js) is edited with the very
 * same step: in "First move" mode the step is shown the first-move profile
 * instead of the piece's own movement, and what it changes goes into the
 * profile. So a first move can be anything a move can be - a knight jump, a
 * leap, a slide - with nothing written twice.
 *
 * Also the place the OLDER first-move settings are shown: per-direction "first
 * N moves" and first-move alternate distances can no longer be set, but pieces
 * that have them keep them, and can convert or remove them here.
 */
const formName = (field) => (field === 'special_scenario_captures' ? 'special_scenario_capture' : field);
const storedName = (field) => (field === 'special_scenario_capture' ? 'special_scenario_captures' : field);
const PROFILE_FORM_FIELDS = new Set(FIRST_MOVE_FIELDS.map(formName));

function LegacyFirstMovePanel({ pieceData, updatePieceData, hasProfile }) {
  const result = useMemo(() => convertLegacyFirstMove(pieceData), [pieceData]);
  if (result.status === 'none') return null;
  return (
    <div className={styles["legacy-first-move"]}>
      <strong>This piece uses the older first-move settings</strong>: some of its
      moves or alternate distances are limited to its first moves. They still
      apply in games, but can no longer be changed here.
      {result.status === 'ok' && !hasProfile && (
        <> Convert them to a first-move movement ({result.moves === 1 ? 'its first move' : `its first ${result.moves} moves`}),
          which you can then edit like any other.</>
      )}
      {result.status === 'ok' && hasProfile && <> It also has a first-move movement, so they cannot be converted into one; remove them, or keep them.</>}
      {result.status === 'unsupported' && <> They cannot be converted into one first-move movement: {result.reason}.</>}
      <div className={styles["legacy-first-move-actions"]}>
        {result.status === 'ok' && !hasProfile && (
          <button type="button" className={styles["betza-button"]} onClick={() => updatePieceData(result.updates)}>
            Convert to a first-move movement
          </button>
        )}
        <button type="button" className={styles["betza-link"]} onClick={() => updatePieceData(clearLegacyFirstMove(pieceData))}>
          Remove them
        </button>
      </div>
    </div>
  );
}

export default function FirstMoveSteps({ Step, pieceData, updatePieceData, noun = 'movement' }) {
  const [mode, setMode] = useState('every');
  const profile = useMemo(() => parseFirstMoveProfile(pieceData.first_move_profile) || {}, [pieceData.first_move_profile]);
  const hasProfile = Object.keys(profile).length > 0;
  const moves = Math.min(MAX_FIRST_MOVES, Math.max(1, Number(pieceData.first_move_profile_moves) || 1));

  // The step's view of the first-move movement: the piece, with every movement
  // field cleared (as the engines clear them - firstMoveVariant) and the
  // profile's fields put back.
  const view = useMemo(() => {
    const v = { ...pieceData };
    for (const f of FIRST_MOVE_FIELDS) {
      const name = formName(f);
      const current = pieceData[name];
      v[name] = typeof current === 'boolean' ? false : typeof current === 'number' ? 0 : (name.startsWith('special_scenario') ? '' : null);
    }
    for (const [k, value] of Object.entries(profile)) v[formName(k)] = value;
    return v;
  }, [pieceData, profile]);

  const saveProfile = (next) => {
    const compact = compactFirstMoveProfile(next);
    updatePieceData({
      first_move_profile: compact ? JSON.stringify(compact) : null,
      first_move_profile_moves: compact ? moves : null,
    });
  };
  // What the step changes: movement fields go into the profile, anything else to the piece.
  const updateFirstMove = (updates) => {
    const own = {};
    const rest = {};
    for (const [k, value] of Object.entries(updates)) (PROFILE_FORM_FIELDS.has(k) ? own : rest)[k] = value;
    if (Object.keys(own).length) {
      const next = { ...profile };
      for (const [k, value] of Object.entries(own)) next[storedName(k)] = value;
      saveProfile(next);
    }
    if (Object.keys(rest).length) updatePieceData(rest);
  };
  const startFromUsual = () => {
    const next = {};
    for (const f of FIRST_MOVE_FIELDS) next[f] = pieceData[formName(f)];
    saveProfile(next);
  };

  const tab = (value, label) => (
    <button
      type="button"
      className={`${styles["first-move-tab"]} ${mode === value ? styles["first-move-tab-active"] : ''}`}
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className={styles["first-move-bar"]}>
        <span>Set the {noun} for</span>
        {tab('every', 'Every move')}
        {tab('first', hasProfile ? 'Its first move ✓' : 'Its first move')}
        <InfoTooltip text="A piece can have a different movement and attack on its first move (or first few moves) - a pawn's double step, a first-move knight jump, anything a move can be. On those moves it may move either way: by its usual movement, or by its first-move one. Set the first-move one here with the same controls as the usual one." />
      </div>
      {mode === 'first' && (
        <div className={styles["first-move-note"]}>
          <div className={styles["first-move-count"]}>
            <span>For its first</span>
            <NumberInput
              value={moves}
              onChange={(v) => updatePieceData({ first_move_profile_moves: Math.min(MAX_FIRST_MOVES, Math.max(1, Number(v) || 1)) })}
              options={{ min: 1, max: MAX_FIRST_MOVES, placeholder: "1" }}
            />
            <span>{moves === 1 ? 'move' : 'moves'}, it may also move and attack as set below - as well as by its usual movement.</span>
          </div>
          <div className={styles["legacy-first-move-actions"]}>
            {!hasProfile && (
              <button type="button" className={styles["betza-link"]} onClick={startFromUsual}>Start from its usual movement and attack</button>
            )}
            {hasProfile && (
              <button type="button" className={styles["betza-link"]} onClick={() => saveProfile(null)}>Remove its first-move movement</button>
            )}
          </div>
        </div>
      )}
      <LegacyFirstMovePanel pieceData={pieceData} updatePieceData={updatePieceData} hasProfile={hasProfile} />
      <Step
        pieceData={mode === 'first' ? view : pieceData}
        updatePieceData={mode === 'first' ? updateFirstMove : updatePieceData}
      />
    </>
  );
}
