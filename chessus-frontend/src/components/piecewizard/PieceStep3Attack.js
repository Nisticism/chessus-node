import React from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";
import CustomSquareSelector from "./CustomSquareSelector";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "./InfoTooltip";
import FairyStockfishInfoNote from "../common/FairyStockfishInfoNote";
import ToggleSwitch from "../common/ToggleSwitch";
import { PIECE_WIZARD_TEXT } from "../../global/global";

const PieceStep3Attack = ({ pieceData, updatePieceData }) => {
  
  // Helper to convert additionalMovements to additionalCaptures format
  const convertMovementsToCaptures = (specialScenarioMoves) => {
    if (!specialScenarioMoves) return null;
    try {
      const parsed = typeof specialScenarioMoves === 'string' 
        ? JSON.parse(specialScenarioMoves)
        : specialScenarioMoves;
      
      if (!parsed.additionalMovements) return null;
      
      // Convert additionalMovements to additionalCaptures
      // The structure is the same, just different naming
      return JSON.stringify({
        additionalCaptures: parsed.additionalMovements
      });
    } catch {
      return null;
    }
  };
  
  const handleChange = (field, value) => {
    const updates = { [field]: value };
    
    // Handle mutual exclusivity between exact and infinite for directional captures and attacks
    if ((field.endsWith('_capture') || field.endsWith('_attack')) && value === 99) {
      // Setting infinite, so uncheck exact
      const exactField = field + '_exact';
      updates[exactField] = false;
    } else if ((field.endsWith('_capture_exact') || field.endsWith('_attack_exact')) && value === true) {
      // Setting exact, so uncheck infinite
      const captureOrAttackField = field.replace('_exact', '');
      if (pieceData[captureOrAttackField] === 99) {
        updates[captureOrAttackField] = 0;
      }
    }
    
    updatePieceData(updates);
  };

  const handleBooleanChange = (field, value) => {
    updatePieceData({ [field]: value === "true" });
  };

  const handleNumberChange = (field, value) => {
    const numValue = value === "" ? null : parseInt(value);
    updatePieceData({ [field]: numValue });
  };

  // Step-by-step capture/attack is capped at 8 because the custom-square selector
  // grid is 15x15 (radius 7). At step value 7+ the grid is fully covered, so we
  // disable adding custom squares.
  const MAX_STEP_BY_STEP = 8;
  const STEP_DISABLES_CUSTOM = 7;
  const stepCaptureAbs = Math.abs(pieceData.step_by_step_capture || 0);
  const stepAttackAbs = Math.abs(pieceData.step_by_step_attack_range || 0);
  const customAttackDisabled = stepCaptureAbs >= STEP_DISABLES_CUSTOM || stepAttackAbs >= STEP_DISABLES_CUSTOM;
  const customAttackDisabledMessage = customAttackDisabled
    ? `Custom square attack cannot be expanded while step-by-step capture or ranged attack is ${STEP_DISABLES_CUSTOM} or higher (it already covers the grid). Reduce step-by-step capture/attack below ${STEP_DISABLES_CUSTOM} to add more squares.`
    : "";

  // Parse additional captures from special_scenario_capture JSON
  const getAdditionalCaptures = () => {
    if (!pieceData.special_scenario_capture) return {};
    try {
      const parsed = typeof pieceData.special_scenario_capture === 'string' 
        ? JSON.parse(pieceData.special_scenario_capture)
        : pieceData.special_scenario_capture;
      return parsed.additionalCaptures || {};
    } catch {
      return {};
    }
  };

  // Add an additional capture for a direction
  const addAdditionalCapture = (direction) => {
    const additionalCaptures = getAdditionalCaptures();
    if (!additionalCaptures[direction]) {
      additionalCaptures[direction] = [];
    }
    if (additionalCaptures[direction].length >= 2) return; // Max 2 alternates per direction
    additionalCaptures[direction].push({
      value: 1,
      exact: false,
      infinite: false,
      firstMoveOnly: false
    });
    
    const scenarioData = pieceData.special_scenario_capture 
      ? (typeof pieceData.special_scenario_capture === 'string' 
          ? JSON.parse(pieceData.special_scenario_capture)
          : pieceData.special_scenario_capture)
      : {};
    
    scenarioData.additionalCaptures = additionalCaptures;
    updatePieceData({ special_scenario_capture: JSON.stringify(scenarioData) });
  };

  // Update an additional capture
  const updateAdditionalCapture = (direction, index, field, value) => {
    const additionalCaptures = getAdditionalCaptures();
    if (additionalCaptures[direction] && additionalCaptures[direction][index]) {
      // If setting infinite to true, uncheck exact
      if (field === 'infinite' && value === true) {
        additionalCaptures[direction][index]['exact'] = false;
      }
      // If setting exact to true, uncheck infinite
      if (field === 'exact' && value === true) {
        additionalCaptures[direction][index]['infinite'] = false;
      }
      
      additionalCaptures[direction][index][field] = value;
      
      const scenarioData = pieceData.special_scenario_capture 
        ? (typeof pieceData.special_scenario_capture === 'string' 
            ? JSON.parse(pieceData.special_scenario_capture)
            : pieceData.special_scenario_capture)
        : {};
      
      scenarioData.additionalCaptures = additionalCaptures;
      updatePieceData({ special_scenario_capture: JSON.stringify(scenarioData) });
    }
  };

  // Remove an additional capture
  const removeAdditionalCapture = (direction, index) => {
    const additionalCaptures = getAdditionalCaptures();
    if (additionalCaptures[direction]) {
      additionalCaptures[direction].splice(index, 1);
      if (additionalCaptures[direction].length === 0) {
        delete additionalCaptures[direction];
      }
      
      const scenarioData = pieceData.special_scenario_capture 
        ? (typeof pieceData.special_scenario_capture === 'string' 
            ? JSON.parse(pieceData.special_scenario_capture)
            : pieceData.special_scenario_capture)
        : {};
      
      scenarioData.additionalCaptures = additionalCaptures;
      updatePieceData({ special_scenario_capture: JSON.stringify(scenarioData) });
    }
  };

  // Render additional capture options for a direction
  const renderAdditionalCaptures = (direction, directionName, arrow) => {
    const additionalCaptures = getAdditionalCaptures();
    const captures = additionalCaptures[direction] || [];
    
    return (
      <div className={styles["additional-movements"]}>
        {captures.map((capture, index) => (
          <div key={index} className={styles["additional-movement-item"]}>
            <button 
              type="button"
              className={styles["remove-btn"]}
              onClick={() => removeAdditionalCapture(direction, index)}
            >
              ×
            </button>
            <div className={styles["additional-movement-content"]}>
              <div className={styles["additional-movement-header"]}>
                <span className={styles["additional-label"]}>Alt {directionName} {arrow}</span>
              </div>
              <div className={styles["additional-movement-line"]}>
                <label>Value:</label>
                <NumberInput
                  value={capture.infinite ? "∞" : capture.value}
                  onChange={(val) => updateAdditionalCapture(direction, index, 'value', val)}
                  options={{ disabled: capture.infinite, min: 0, max: 99 }}
                />
              </div>
              <div className={styles["additional-movement-line"]}>
                <ToggleSwitch inline size="small"
                  checked={capture.exact}
                  onChange={(v) => updateAdditionalCapture(direction, index, 'exact', v)}
                  disabled={capture.infinite}
                  label="Exact"
                />
              </div>
              <div className={styles["additional-movement-line"]}>
                <ToggleSwitch inline size="small"
                  checked={capture.infinite}
                  onChange={(v) => updateAdditionalCapture(direction, index, 'infinite', v)}
                  label="Infinite"
                />
              </div>
              <div className={styles["additional-movement-line"]}>
                <ToggleSwitch inline size="small"
                  checked={!!capture.availableForMoves}
                  onChange={(v) => updateAdditionalCapture(direction, index, 'availableForMoves', v ? 1 : null)}
                  label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                />
                {capture.availableForMoves && (
                  <>
                    <NumberInput
                      value={capture.availableForMoves || 1}
                      onChange={(val) => updateAdditionalCapture(direction, index, 'availableForMoves', val)}
                      options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                    />
                    <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        <button 
          type="button"
          className={styles["add-movement-btn"]}
          onClick={() => addAdditionalCapture(direction)}
          disabled={captures.length >= 2}
          title={captures.length >= 2 ? "Maximum of 2 alternate captures per direction" : undefined}
        >
          + Add Alternative Capture{captures.length >= 2 ? " (max reached)" : ""}
        </button>
      </div>
    );
  };

  const handleClearAttack = () => {
    updatePieceData({
      can_capture_enemy_on_move: false,
      repeating_capture: false,
      up_left_capture: 0, up_capture: 0, up_right_capture: 0, right_capture: 0,
      down_right_capture: 0, down_capture: 0, down_left_capture: 0, left_capture: 0,
      up_left_capture_exact: false, up_capture_exact: false, up_right_capture_exact: false,
      right_capture_exact: false, down_right_capture_exact: false, down_capture_exact: false,
      down_left_capture_exact: false, left_capture_exact: false,
      up_left_capture_available_for: null, up_capture_available_for: null,
      up_right_capture_available_for: null, right_capture_available_for: null,
      down_right_capture_available_for: null, down_capture_available_for: null,
      down_left_capture_available_for: null, left_capture_available_for: null,
      ratio_one_capture: null, ratio_two_capture: null,
      repeating_ratio_capture: false, max_ratio_capture_iterations: null,
      step_by_step_capture: null,
      can_capture_enemy_via_range: false,
      can_capture_ally_via_range: false,
      can_capture_ally_on_range: false,
      can_attack_on_iteration: false,
      up_left_attack_range: 0, up_attack_range: 0, up_right_attack_range: 0, right_attack_range: 0,
      down_right_attack_range: 0, down_attack_range: 0, down_left_attack_range: 0, left_attack_range: 0,
      up_left_attack_range_exact: false, up_attack_range_exact: false, up_right_attack_range_exact: false,
      right_attack_range_exact: false, down_right_attack_range_exact: false, down_attack_range_exact: false,
      down_left_attack_range_exact: false, left_attack_range_exact: false,
      up_left_attack_range_available_for: null, up_attack_range_available_for: null,
      up_right_attack_range_available_for: null, right_attack_range_available_for: null,
      down_right_attack_range_available_for: null, down_attack_range_available_for: null,
      down_left_attack_range_available_for: null, left_attack_range_available_for: null,
      ratio_one_attack_range: null, ratio_two_attack_range: null,
      repeating_directional_ranged_attack: false,
      max_directional_ranged_attack_iterations: null, min_directional_ranged_attack_iterations: null,
      repeating_ratio_ranged_attack: false,
      max_ratio_ranged_attack_iterations: null, min_ratio_ranged_attack_iterations: null,
      step_by_step_attack_style: false, step_by_step_attack_value: null, step_by_step_attack_range: null,
      capture_actions_per_turn: 1, ranged_capture_actions_per_turn: 1,
      can_fire_over_allies: false, can_fire_over_enemies: false,
      can_hop_attack_over_allies: false, can_hop_attack_over_enemies: false,
      exact_ratio_hop_only_attack: false, directional_hop_disabled_attack: false, hop_stop_at_occupied_attack: false,
      directional_hop_only_attack: false,
      special_scenario_capture: "",
      custom_attack_squares: null,
    });
  };

  const handleCopyFromMovement = () => {
    const convertedCaptures = convertMovementsToCaptures(pieceData.special_scenario_moves);
    updatePieceData({
      can_capture_enemy_on_move: true,
      // Copy directional movement to capture
      up_left_capture: pieceData.up_left_movement,
      up_capture: pieceData.up_movement,
      up_right_capture: pieceData.up_right_movement,
      left_capture: pieceData.left_movement,
      right_capture: pieceData.right_movement,
      down_left_capture: pieceData.down_left_movement,
      down_capture: pieceData.down_movement,
      down_right_capture: pieceData.down_right_movement,
      // Copy exact flags for directional captures
      up_left_capture_exact: pieceData.up_left_movement_exact,
      up_capture_exact: pieceData.up_movement_exact,
      up_right_capture_exact: pieceData.up_right_movement_exact,
      left_capture_exact: pieceData.left_movement_exact,
      right_capture_exact: pieceData.right_movement_exact,
      down_left_capture_exact: pieceData.down_left_movement_exact,
      down_capture_exact: pieceData.down_movement_exact,
      down_right_capture_exact: pieceData.down_right_movement_exact,
      // Copy available_for flags for directional captures
      up_left_capture_available_for: pieceData.up_left_movement_available_for,
      up_capture_available_for: pieceData.up_movement_available_for,
      up_right_capture_available_for: pieceData.up_right_movement_available_for,
      left_capture_available_for: pieceData.left_movement_available_for,
      right_capture_available_for: pieceData.right_movement_available_for,
      down_left_capture_available_for: pieceData.down_left_movement_available_for,
      down_capture_available_for: pieceData.down_movement_available_for,
      down_right_capture_available_for: pieceData.down_right_movement_available_for,
      // Copy ratio movement (only if ratio movement is configured)
      ratio_one_capture: (pieceData.ratio_one_movement > 0 && pieceData.ratio_two_movement > 0) ? pieceData.ratio_one_movement : 0,
      ratio_two_capture: (pieceData.ratio_one_movement > 0 && pieceData.ratio_two_movement > 0) ? pieceData.ratio_two_movement : 0,
      // Copy step-by-step
      step_by_step_capture: pieceData.step_by_step_movement_value,
      // Copy repeating movement setting
      repeating_capture: pieceData.repeating_movement,
      // Copy ratio repeating settings
      repeating_ratio_capture: (pieceData.ratio_one_movement > 0 && pieceData.ratio_two_movement > 0) ? pieceData.repeating_ratio : false,
      max_ratio_capture_iterations: (pieceData.ratio_one_movement > 0 && pieceData.ratio_two_movement > 0) ? pieceData.max_ratio_iterations : 0,
      // Copy additional movements to additional captures
      ...(convertedCaptures && { special_scenario_capture: convertedCaptures }),
      // Copy custom movement squares to custom attack squares
      custom_attack_squares: pieceData.custom_movement_squares,
      // Preserve existing ranged attack state
      can_capture_enemy_via_range: pieceData.can_capture_enemy_via_range,
      // Copy movement hopping settings to attack hopping
      can_hop_attack_over_allies: pieceData.can_hop_over_allies,
      can_hop_attack_over_enemies: pieceData.can_hop_over_enemies,
      exact_ratio_hop_only_attack: pieceData.exact_ratio_hop_only,
      directional_hop_disabled_attack: pieceData.directional_hop_disabled,
      hop_stop_at_occupied_attack: pieceData.hop_stop_at_occupied,
      directional_hop_only_attack: pieceData.directional_hop_only,
      max_directional_hop_pieces_attack: pieceData.max_directional_hop_pieces,
      // Copy direction change (movement) settings to capture
      directional_capture_change: pieceData.directional_movement_change,
      up_left_capture_change: pieceData.up_left_movement_change,
      up_capture_change: pieceData.up_movement_change,
      up_right_capture_change: pieceData.up_right_movement_change,
      right_capture_change: pieceData.right_movement_change,
      down_right_capture_change: pieceData.down_right_movement_change,
      down_capture_change: pieceData.down_movement_change,
      down_left_capture_change: pieceData.down_left_movement_change,
      left_capture_change: pieceData.left_movement_change,
      up_left_capture_change_exact: pieceData.up_left_movement_change_exact,
      up_capture_change_exact: pieceData.up_movement_change_exact,
      up_right_capture_change_exact: pieceData.up_right_movement_change_exact,
      right_capture_change_exact: pieceData.right_movement_change_exact,
      down_right_capture_change_exact: pieceData.down_right_movement_change_exact,
      down_capture_change_exact: pieceData.down_movement_change_exact,
      down_left_capture_change_exact: pieceData.down_left_movement_change_exact,
      left_capture_change_exact: pieceData.left_movement_change_exact,
      up_left_capture_change_available_for: pieceData.up_left_movement_change_available_for,
      up_capture_change_available_for: pieceData.up_movement_change_available_for,
      up_right_capture_change_available_for: pieceData.up_right_movement_change_available_for,
      right_capture_change_available_for: pieceData.right_movement_change_available_for,
      down_right_capture_change_available_for: pieceData.down_right_movement_change_available_for,
      down_capture_change_available_for: pieceData.down_movement_change_available_for,
      down_left_capture_change_available_for: pieceData.down_left_movement_change_available_for,
      left_capture_change_available_for: pieceData.left_movement_change_available_for,
      repeating_capture_change: pieceData.repeating_movement_change,
      require_empty_via_capture: pieceData.require_empty_via_movement,
      require_direction_change_capture: pieceData.require_direction_change,
    });
  };

  const renderDCCaptureCell = (dirKey, label) => {
    const distKey = `${dirKey}_capture_change`;
    const exactKey = `${dirKey}_capture_change_exact`;
    const availKey = `${dirKey}_capture_change_available_for`;
    const dist = pieceData[distKey] || 0;
    return (
      <div className={styles["direction-input"]}>
        <label>{label}</label>
        <NumberInput
          value={dist === 99 ? '\u221e' : dist}
          onChange={(val) => {
            const updates = { [distKey]: val };
            if (val === 99) updates[exactKey] = false;
            updatePieceData(updates);
          }}
          options={{ disabled: dist === 99 }}
        />
        <ToggleSwitch inline size="small"
          checked={!!pieceData[exactKey]}
          onChange={(v) => {
            const updates = { [exactKey]: v };
            if (v && dist === 99) updates[distKey] = 0;
            updatePieceData(updates);
          }}
          label="Exact"
          disabled={dist === 99}
        />
        <ToggleSwitch inline size="small"
          checked={dist === 99}
          onChange={(v) => updatePieceData({ [distKey]: v ? 99 : 0, [exactKey]: false })}
          label="Infinite"
        />
        <div className={styles["available-for-moves-group"]}>
          <ToggleSwitch inline size="small"
            checked={!!pieceData[availKey]}
            onChange={(v) => updatePieceData({ [availKey]: v ? 1 : null })}
            label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
          />
          {pieceData[availKey] && (
            <>
              <NumberInput
                value={pieceData[availKey] || 1}
                onChange={(val) => updatePieceData({ [availKey]: val })}
                options={{ min: 1, max: 99, className: styles["tiny-input"] }}
              />
              <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Attack & Capture Configuration</h2>
      <FairyStockfishInfoNote kind="pieceAttack" />
      <p className={styles["step-description"]}>
        Define how your piece captures and attacks.
      </p>

      {/* Action buttons */}
      <div className={styles["wizard-action-row"]}>
        <button
          type="button"
          className={styles["add-movement-btn"]}
          onClick={handleCopyFromMovement}
        >
          Copy movement settings to attack
        </button>
        <button
          type="button"
          className={styles["clear-wizard-btn"]}
          onClick={handleClearAttack}
        >
          Clear all attack data
        </button>
      </div>
      <p className={styles["field-hint"]} style={{ marginBottom: '1rem' }}>
        "Copy" populates capture fields with your movement settings from Step 2.
      </p>

      {/* Capture on Move */}
      <div className={styles["condition-section"]}>
        <h3>Capture on Move <InfoTooltip text="'Capture on Move' means the piece moves to the enemy's square to capture it (like most chess pieces). Configure capture-specific directions, distances, and patterns here." /></h3>
        <ToggleSwitch
          checked={pieceData.can_capture_enemy_on_move === true || pieceData.can_capture_enemy_on_move === 1}
          onChange={(v) => handleBooleanChange("can_capture_enemy_on_move", v ? "true" : "false")}
          label="Can capture by moving to enemy square"
        />

        {pieceData.can_capture_enemy_on_move && (
          <>
            <div className={styles["sub-field"]}>
              <label>Capture Actions Per Turn <InfoTooltip text="Grants this piece additional capture-only move actions per turn. After capturing an enemy normally, the piece can move and capture again — up to this many times total per turn. The player may skip remaining actions at any time. Does not apply to ghostwalk/trample passthrough captures or hop captures (those use Chain Capture)." /></label>
              <NumberInput
                value={pieceData.capture_actions_per_turn === -1 ? "" : (pieceData.capture_actions_per_turn || 1)}
                onChange={(val) => handleChange("capture_actions_per_turn", val)}
                options={{ min: 1, max: 16, disabled: pieceData.capture_actions_per_turn === -1, placeholder: "1", className: styles["form-input-small"] }}
              />
              <ToggleSwitch inline size="small"
                checked={pieceData.capture_actions_per_turn === -1}
                onChange={(v) => handleChange("capture_actions_per_turn", v ? -1 : 1)}
                label="Unlimited"
              />
            </div>

            {/* Directional Capture Movement */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Directional Capture Movement</h4>
                <p className={styles["field-hint"]}>
                  Define capture range in each direction. 0 = no capture, positive = up to. Check "Exact" to require exactly that distance, or "Infinite" for unlimited range.
                </p>
                
                <div className={styles["directional-grid"]}>
                  <div className={styles["direction-row"]}>
                    {/* Up-Left */}
                    <div className={styles["direction-input"]}>
                      <label>↖ Up-Left</label>
                      <NumberInput
                          value={pieceData.up_left_capture === 99 ? "∞" : (pieceData.up_left_capture || 0)}
                          onChange={(val) => handleChange("up_left_capture", val)}
                          options={{ disabled: pieceData.up_left_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.up_left_capture_exact}
                        onChange={(v) => handleChange("up_left_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.up_left_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.up_left_capture === 99}
                        onChange={(v) => handleChange("up_left_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.up_left_capture_available_for}
                          onChange={(v) => handleChange("up_left_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.up_left_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.up_left_capture_available_for || 1}
                              onChange={(val) => handleChange("up_left_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("up_left", "Up-Left", "↖")}
                    </div>
                    
                    {/* Up */}
                    <div className={styles["direction-input"]}>
                      <label>↑ Up</label>
                      <NumberInput
                          value={pieceData.up_capture === 99 ? "∞" : (pieceData.up_capture || 0)}
                          onChange={(val) => handleChange("up_capture", val)}
                          options={{ disabled: pieceData.up_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.up_capture_exact}
                        onChange={(v) => handleChange("up_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.up_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.up_capture === 99}
                        onChange={(v) => handleChange("up_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.up_capture_available_for}
                          onChange={(v) => handleChange("up_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.up_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.up_capture_available_for || 1}
                              onChange={(val) => handleChange("up_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("up", "Up", "↑")}
                    </div>
                    
                    {/* Up-Right */}
                    <div className={styles["direction-input"]}>
                      <label>↗ Up-Right</label>
                      <NumberInput
                          value={pieceData.up_right_capture === 99 ? "∞" : (pieceData.up_right_capture || 0)}
                          onChange={(val) => handleChange("up_right_capture", val)}
                          options={{ disabled: pieceData.up_right_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.up_right_capture_exact}
                        onChange={(v) => handleChange("up_right_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.up_right_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.up_right_capture === 99}
                        onChange={(v) => handleChange("up_right_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.up_right_capture_available_for}
                          onChange={(v) => handleChange("up_right_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.up_right_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.up_right_capture_available_for || 1}
                              onChange={(val) => handleChange("up_right_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("up_right", "Up-Right", "↗")}
                    </div>
                  </div>
                  
                  <div className={styles["direction-row"]}>
                    {/* Left */}
                    <div className={styles["direction-input"]}>
                      <label>← Left</label>
                      <NumberInput
                          value={pieceData.left_capture === 99 ? "∞" : (pieceData.left_capture || 0)}
                          onChange={(val) => handleChange("left_capture", val)}
                          options={{ disabled: pieceData.left_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.left_capture_exact}
                        onChange={(v) => handleChange("left_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.left_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.left_capture === 99}
                        onChange={(v) => handleChange("left_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.left_capture_available_for}
                          onChange={(v) => handleChange("left_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.left_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.left_capture_available_for || 1}
                              onChange={(val) => handleChange("left_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("left", "Left", "←")}
                    </div>
                    
                    {/* Center piece */}
                    <div className={styles["direction-center"]}>
                      <div className={styles["center-piece"]}>
                        {pieceData.piece_image_previews?.[0] ? (
                          <img src={pieceData.piece_image_previews[0]} alt="Piece" />
                        ) : (
                          "♟"
                        )}
                      </div>
                    </div>
                    
                    {/* Right */}
                    <div className={styles["direction-input"]}>
                      <label>→ Right</label>
                      <NumberInput
                          value={pieceData.right_capture === 99 ? "∞" : (pieceData.right_capture || 0)}
                          onChange={(val) => handleChange("right_capture", val)}
                          options={{ disabled: pieceData.right_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.right_capture_exact}
                        onChange={(v) => handleChange("right_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.right_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.right_capture === 99}
                        onChange={(v) => handleChange("right_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.right_capture_available_for}
                          onChange={(v) => handleChange("right_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.right_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.right_capture_available_for || 1}
                              onChange={(val) => handleChange("right_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("right", "Right", "→")}
                    </div>
                  </div>
                  
                  <div className={styles["direction-row"]}>
                    {/* Down-Left */}
                    <div className={styles["direction-input"]}>
                      <label>↙ Down-Left</label>
                      <NumberInput
                          value={pieceData.down_left_capture === 99 ? "∞" : (pieceData.down_left_capture || 0)}
                          onChange={(val) => handleChange("down_left_capture", val)}
                          options={{ disabled: pieceData.down_left_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.down_left_capture_exact}
                        onChange={(v) => handleChange("down_left_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.down_left_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.down_left_capture === 99}
                        onChange={(v) => handleChange("down_left_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.down_left_capture_available_for}
                          onChange={(v) => handleChange("down_left_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.down_left_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.down_left_capture_available_for || 1}
                              onChange={(val) => handleChange("down_left_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("down_left", "Down-Left", "↙")}
                    </div>
                    
                    {/* Down */}
                    <div className={styles["direction-input"]}>
                      <label>↓ Down</label>
                      <NumberInput
                          value={pieceData.down_capture === 99 ? "∞" : (pieceData.down_capture || 0)}
                          onChange={(val) => handleChange("down_capture", val)}
                          options={{ disabled: pieceData.down_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.down_capture_exact}
                        onChange={(v) => handleChange("down_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.down_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.down_capture === 99}
                        onChange={(v) => handleChange("down_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.down_capture_available_for}
                          onChange={(v) => handleChange("down_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.down_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.down_capture_available_for || 1}
                              onChange={(val) => handleChange("down_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("down", "Down", "↓")}
                    </div>
                    
                    {/* Down-Right */}
                    <div className={styles["direction-input"]}>
                      <label>↘ Down-Right</label>
                      <NumberInput
                          value={pieceData.down_right_capture === 99 ? "∞" : (pieceData.down_right_capture || 0)}
                          onChange={(val) => handleChange("down_right_capture", val)}
                          options={{ disabled: pieceData.down_right_capture === 99 }}
                        />
                      <ToggleSwitch inline size="small"
                        checked={!!pieceData.down_right_capture_exact}
                        onChange={(v) => handleChange("down_right_capture_exact", v)}
                        label="Exact"
                        disabled={pieceData.down_right_capture === 99}
                      />
                      <ToggleSwitch inline size="small"
                        checked={pieceData.down_right_capture === 99}
                        onChange={(v) => handleChange("down_right_capture", v ? 99 : 0)}
                        label="Infinite"
                      />
                      <div className={styles["available-for-moves-group"]}>
                        <ToggleSwitch inline size="small"
                          checked={!!pieceData.down_right_capture_available_for}
                          onChange={(v) => handleChange("down_right_capture_available_for", v ? 1 : null)}
                          label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                        />
                        {pieceData.down_right_capture_available_for && (
                          <>
                            <NumberInput
                              value={pieceData.down_right_capture_available_for || 1}
                              onChange={(val) => handleChange("down_right_capture_available_for", val)}
                              options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                            />
                            <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                          </>
                        )}
                      </div>
                      {renderAdditionalCaptures("down_right", "Down-Right", "↘")}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Repeating Exact Capture */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <ToggleSwitch
                  checked={pieceData.repeating_capture || false}
                  onChange={(v) => handleChange("repeating_capture", v)}
                  label="Repeating exact capture"
                  tooltip={<InfoTooltip text="When enabled with exact captures, the piece can repeat its exact capture distance pattern infinitely along that direction, landing on every Nth square. For example, a piece with Exact 2 capture could capture on squares 2, 4, 6, 8, etc." />}
                />
              </div>
            )}

            {/* Direction Change (Capture) */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <ToggleSwitch
                  checked={!!pieceData.directional_capture_change}
                  onChange={(v) => updatePieceData({ directional_capture_change: v })}
                  label="Allow direction change"
                  tooltip={<InfoTooltip text="When enabled, the piece travels a first capture leg in one of the chosen directions, then must turn and capture at the end of a second leg in a different (non-opposite, non-same) direction. The piece cannot stop at the first-leg endpoint." />}
                />
              </div>
            )}

            {!pieceData.attacks_like_movement && pieceData.directional_capture_change && (
              <div className={styles["sub-fields"]}>
                <p className={styles["sub-field-description"]}>
                  Set the second-leg distances for each capture direction. Same or opposite directions are not allowed as second legs.
                </p>
                <div className={styles["directional-grid"]}>
                  <div className={styles["direction-row"]}>
                    {renderDCCaptureCell('up_left', '\u2196 Up-Left')}
                    {renderDCCaptureCell('up', '\u2191 Up')}
                    {renderDCCaptureCell('up_right', '\u2197 Up-Right')}
                  </div>
                  <div className={styles["direction-row"]}>
                    {renderDCCaptureCell('left', '\u2190 Left')}
                    <div className={styles["direction-center"]}>
                      <div className={styles["center-piece"]}>
                        {pieceData.piece_image_previews?.[0] ? (
                          <img src={pieceData.piece_image_previews[0]} alt="Piece" />
                        ) : "?"}
                      </div>
                    </div>
                    {renderDCCaptureCell('right', '\u2192 Right')}
                  </div>
                  <div className={styles["direction-row"]}>
                    {renderDCCaptureCell('down_left', '\u2199 Down-Left')}
                    {renderDCCaptureCell('down', '\u2193 Down')}
                    {renderDCCaptureCell('down_right', '\u2198 Down-Right')}
                  </div>
                </div>
                <div className={styles["sub-field"]}>
                  <ToggleSwitch
                    checked={!!pieceData.repeating_capture_change}
                    onChange={(v) => updatePieceData({ repeating_capture_change: v })}
                    label="Repeating exact direction change"
                    tooltip={<InfoTooltip text="When enabled with exact second-leg capture distances, the second leg can repeat infinitely." />}
                  />
                </div>
                {(pieceData.can_hop_over_allies || pieceData.can_hop_over_enemies || pieceData.can_hop_attack_over_allies || pieceData.can_hop_attack_over_enemies) && (
                  <div className={styles["sub-field"]}>
                    <ToggleSwitch
                      checked={!!pieceData.require_empty_via_capture}
                      onChange={(v) => updatePieceData({ require_empty_via_capture: v })}
                      label="Require turn square to be empty"
                      tooltip={<InfoTooltip text="Normally a hopping piece can turn on an occupied square. Enable this to require the turn square to be empty even when the piece has hopping abilities." />}
                    />
                  </div>
                )}
                <div className={styles["sub-field"]}>
                  <ToggleSwitch
                    checked={!!pieceData.require_direction_change_capture}
                    onChange={(v) => updatePieceData({ require_direction_change_capture: v })}
                    label="Direction change is mandatory"
                    tooltip={<InfoTooltip text="When enabled, this piece MUST make a direction change when capturing — it cannot capture on straight-line squares. If a straight-line capture destination also happens to be a direction-change capture destination, that square is still accessible." />}
                  />
                </div>
              </div>
            )}

            {/* Ratio Capture (Knight-like) */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Ratio Capture Movement (L-shape) <InfoTooltip text="L-shaped capture like a knight. The piece jumps one distance in one direction, then a different distance perpendicularly to land on and capture an enemy. Leave both empty to disable. Example: 2 and 1 for standard knight capture." /></h4>
                <ToggleSwitch
                  checked={!!(pieceData.ratio_one_capture || pieceData.ratio_two_capture)}
                  onChange={(v) => {
                    if (v) {
                      if (!pieceData.ratio_one_capture && !pieceData.ratio_two_capture) {
                        updatePieceData({ ratio_one_capture: 2, ratio_two_capture: 1 });
                      }
                    } else {
                      updatePieceData({ ratio_one_capture: null, ratio_two_capture: null, repeating_ratio_capture: false, max_ratio_capture_iterations: null });
                    }
                  }}
                  label="Enable ratio capture"
                />
                {(pieceData.ratio_one_capture || pieceData.ratio_two_capture) ? (
                  <>
                    <div className={styles["form-row"]}>
                      <div className={styles["form-group"]}>
                        <label>Ratio One</label>
                        <NumberInput
                          value={pieceData.ratio_one_capture || ""}
                          onChange={(val) => handleNumberChange("ratio_one_capture", val || "")}
                          options={{ placeholder: "e.g., 2", className: styles["form-input-small"] }}
                        />
                      </div>
                      <div className={styles["form-group"]}>
                        <label>Ratio Two</label>
                        <NumberInput
                          value={pieceData.ratio_two_capture || ""}
                          onChange={(val) => handleNumberChange("ratio_two_capture", val || "")}
                          options={{ placeholder: "e.g., 1", className: styles["form-input-small"] }}
                        />
                      </div>
                    </div>
                    <ToggleSwitch
                      checked={pieceData.repeating_ratio_capture || false}
                      onChange={(v) => handleChange("repeating_ratio_capture", v)}
                      label="Repeating ratio capture"
                      tooltip={<InfoTooltip text="When enabled, the piece can repeat its L-shaped capture multiple times in the same direction in a single move." />}
                    />
                    {pieceData.repeating_ratio_capture && (
                      <div className={styles["sub-option"]} style={{ marginLeft: '24px', marginTop: '8px' }}>
                        <ToggleSwitch
                          checked={pieceData.max_ratio_capture_iterations === -1}
                          onChange={(v) => handleChange("max_ratio_capture_iterations", v ? -1 : 1)}
                          label="Infinite"
                          tooltip={<InfoTooltip text="Allow unlimited ratio capture iterations in a single move." />}
                        />
                        {pieceData.max_ratio_capture_iterations !== -1 && (
                          <div style={{ marginTop: '8px' }}>
                            <label style={{ display: 'block', marginBottom: '4px' }}>Max Iterations</label>
                            <NumberInput
                              value={pieceData.max_ratio_capture_iterations || 1}
                              onChange={(val) => handleChange("max_ratio_capture_iterations", val)}
                              min={1}
                              max={50}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {/* Step-by-Step Capture */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Step-by-Step Capture <InfoTooltip text="A step budget for capturing. The piece moves one square at a time in any direction, changing direction each step, to reach and capture an enemy. Maximum 8 steps. The checkbox restricts steps to orthogonal directions only (no diagonal). Leave empty to disable. Values of 7 or higher disable additional custom-square attacks." /></h4>
                <label>Total Capture Steps (0–{MAX_STEP_BY_STEP})</label>
                <NumberInput
                  value={pieceData.step_by_step_capture ? Math.abs(pieceData.step_by_step_capture) : ""}
                  onChange={(val) => {
                    const currentIsNoDiagonal = pieceData.step_by_step_capture < 0;
                    const clamped = val ? Math.min(MAX_STEP_BY_STEP, Math.max(0, Math.abs(val))) : null;
                    handleChange("step_by_step_capture", clamped && currentIsNoDiagonal ? -clamped : (clamped || null));
                  }}
                  options={{ min: 0, max: MAX_STEP_BY_STEP, placeholder: `Leave empty to disable (max ${MAX_STEP_BY_STEP})`, className: styles["form-input-small"] }}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.step_by_step_capture < 0}
                  onChange={(v) => {
                    const val = Math.abs(pieceData.step_by_step_capture || 0);
                    handleChange("step_by_step_capture", v ? -val : val);
                  }}
                  disabled={!pieceData.step_by_step_capture}
                  label="Exclude diagonal movement"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Attack Hopping */}
      <div className={styles["condition-section"]}>
        <h3>Attack Hopping <InfoTooltip text="Controls whether this piece can hop over other pieces when attacking — it jumps over a piece in its path and lands beyond it. These settings apply to captures and attacks only, independently of movement hopping (Step 2). Checkers-style 'capture on hop' options are also configured here." /></h3>
        <ToggleSwitch
          checked={pieceData.can_hop_attack_over_allies || false}
          onChange={(v) => handleChange("can_hop_attack_over_allies", v)}
          label="Can attack hop over allied pieces"
          tooltip={<InfoTooltip text="When attacking, this piece can hop over allied pieces in its path and continue to the target square. Only applies to captures and attacks — not movement. Enable this alongside 'Can hop over allied pieces' (Step 2) to also allow capturing enemies after a movement hop over an ally." />}
        />
        <ToggleSwitch
          checked={pieceData.can_hop_attack_over_enemies || false}
          onChange={(v) => handleChange("can_hop_attack_over_enemies", v)}
          label="Can attack hop over enemy pieces"
          tooltip={<InfoTooltip text="When attacking, this piece can hop over enemy pieces in its path and land on the square beyond. Only applies to captures and attacks — not movement. Also required to capture an enemy on the landing square when using movement-only hop ('Can hop over enemy pieces' in Step 2)." />}
        />
        {(pieceData.can_hop_attack_over_allies || pieceData.can_hop_attack_over_enemies) && (
          <ToggleSwitch
            checked={pieceData.directional_hop_disabled_attack || false}
            onChange={(v) => handleChange("directional_hop_disabled_attack", v)}
            label="Disable attack hopping for non-exact directional attacks"
            tooltip={<InfoTooltip text="When enabled, hopping over pieces is disabled for non-exact directional (sliding) attacks. Hopping still works for exact directional attacks, ratio (L-shape) attacks, and step-by-step attacks." />}
          />
        )}
        {(pieceData.can_hop_attack_over_allies || pieceData.can_hop_attack_over_enemies) && (
          <ToggleSwitch
            checked={pieceData.exact_ratio_hop_only_attack || false}
            onChange={(v) => handleChange("exact_ratio_hop_only_attack", v)}
            label="Require attack hopping for exact and ratio attacks"
            tooltip={<InfoTooltip text="When enabled, any attack that uses exact distance or ratio (L-shape) patterns will only work when the piece is actually hopping over another piece in its path. Non-exact (up-to) and step-by-step attacks still work normally." />}
          />
        )}
        {(pieceData.can_hop_attack_over_allies || pieceData.can_hop_attack_over_enemies) && (
          <ToggleSwitch
            checked={pieceData.directional_hop_only_attack || false}
            onChange={(v) => handleChange("directional_hop_only_attack", v)}
            label="Require attack hopping for any directional attack"
            tooltip={<InfoTooltip text="When enabled, this piece can only attack in directional paths if there is at least one piece in the path to hop over. Does not affect step-by-step attacks or custom attack squares. This is the attack equivalent of 'Require hopping for any directional movement'." />}
          />
        )}
        {(pieceData.can_hop_attack_over_allies || pieceData.can_hop_attack_over_enemies) && pieceData.directional_hop_only_attack && (
          <ToggleSwitch
            checked={pieceData.max_directional_hop_pieces_attack != null}
            onChange={(v) => handleChange("max_directional_hop_pieces_attack", v ? 1 : null)}
            label="Limit max pieces in path per directional attack"
            tooltip={<InfoTooltip text="When enabled, this piece can only hop over a limited number of pieces in a single directional attack. Set the maximum between 1 and 4. When disabled, there is no limit." />}
          />
        )}
        {(pieceData.can_hop_attack_over_allies || pieceData.can_hop_attack_over_enemies) && pieceData.directional_hop_only_attack && pieceData.max_directional_hop_pieces_attack != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', paddingLeft: '4px' }}>
            <span style={{ fontSize: '0.9em' }}>Max pieces to hop over per directional attack:</span>
            <NumberInput
              value={pieceData.max_directional_hop_pieces_attack}
              onChange={(val) => handleChange("max_directional_hop_pieces_attack", Math.max(1, val || 1))}
              options={{ min: 1, max: 4, placeholder: "1" }}
            />
          </div>
        )}
        {pieceData.repeating_ratio_capture && (Number(pieceData.max_ratio_capture_iterations) === -1 || (pieceData.max_ratio_capture_iterations || 1) > 1) && (
          <ToggleSwitch
            checked={pieceData.hop_stop_at_occupied_attack !== false && pieceData.hop_stop_at_occupied_attack !== 0}
            onChange={(v) => handleChange("hop_stop_at_occupied_attack", v)}
            label="Stop repeating hops if an intermediate multiple square is occupied"
            tooltip={<InfoTooltip text="When making repeating ratio (knight-pattern) attack hops, the piece stops if an earlier multiple square in that direction is occupied. Applies to attacks only." />}
          />
        )}

        {/* Checkers-style Capture Options */}
        <div style={{ marginTop: '20px' }}>
          <h4 style={{ marginBottom: '10px' }}>Checkers-style Capture <InfoTooltip text="These options control what happens when a piece hops over another piece. 'Capture on Hop' makes hopping over an enemy capture it (like checkers). 'Chain Capture' allows multiple jumps in one turn. Requires 'Can hop over enemy pieces' above." /></h4>

          {/* Capture on Hop */}
          <div style={{ marginBottom: '15px' }}>
            <ToggleSwitch
              checked={pieceData.capture_on_hop || false}
              onChange={(v) => handleChange("capture_on_hop", v)}
              label="Capture on Hop"
              tooltip={<InfoTooltip text="When this piece hops over enemy pieces, it deals damage equal to its Attack Damage. If the target's HP reaches 0, it is captured. If the target survives, it stays on the board with reduced HP but the hop still completes. Requires 'Can hop over enemy pieces' above." />}
              disabled={!pieceData.can_hop_attack_over_enemies}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <ToggleSwitch
              checked={pieceData.chain_capture_enabled || false}
              onChange={(v) => handleChange("chain_capture_enabled", v)}
              label="Chain Capture (Multi-Jump)"
              tooltip={<InfoTooltip text="If this piece captures an enemy, it can make additional captures in the same turn (only this piece can move). Enables multi-jump sequences like in checkers." />}
            />

            {/* Chain Hop Over Allies - only show when chain capture is enabled */}
            {pieceData.chain_capture_enabled && (
              <div style={{ marginLeft: '20px', marginTop: '10px' }}>
                <ToggleSwitch
                  checked={pieceData.chain_hop_allies || false}
                  onChange={(v) => handleChange("chain_hop_allies", v)}
                  label="Chain Hop Over Allies"
                  tooltip={<InfoTooltip text="During chain capture sequences, this piece can also hop over allied pieces (not capturing them). Useful for variants where jumping over your own pieces is allowed during multi-jump moves." />}
                />
                <div style={{ marginTop: '10px' }}>
                  <label className={styles["field-label"]} style={{ display: 'block', marginBottom: '6px' }}>
                    Max Chain Hops <InfoTooltip text="Maximum number of consecutive capture hops allowed in a single chain. Leave empty for unlimited. Useful to prevent infinite hop-back-and-forth exploits." />
                  </label>
                  <NumberInput
                    value={pieceData.max_chain_hops ?? ""}
                    onChange={(val) => handleChange("max_chain_hops", val === "" || val === 0 ? null : val)}
                    options={{ min: 1, max: 99, placeholder: "∞" }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ranged Attack */}
      <div className={styles["condition-section"]}>
        <h3>Ranged Attack <InfoTooltip text="Ranged attacks let the piece attack without moving — it stays in place but can capture distant enemies. Unlike 'Capture on Move,' the piece does not move to the target square. Configure the attack range, line of sight rules (whether it can fire over other pieces), and directional/ratio attack patterns." /></h3>
        <ToggleSwitch
          checked={pieceData.can_capture_enemy_via_range === true}
          onChange={(v) => handleBooleanChange("can_capture_enemy_via_range", v ? "true" : "false")}
          label="Enable ranged attack"
        />

        {pieceData.can_capture_enemy_via_range && (
          <>
            <div className={styles["sub-field"]}>
              <label>Ranged Capture Actions Per Turn <InfoTooltip text="Grants this piece additional ranged attack actions per turn. After firing at an enemy, the piece can fire again from the same position — up to this many times total per turn. The player may skip remaining actions at any time." /></label>
              <NumberInput
                value={pieceData.ranged_capture_actions_per_turn === -1 ? "" : (pieceData.ranged_capture_actions_per_turn || 1)}
                onChange={(val) => handleChange("ranged_capture_actions_per_turn", val)}
                options={{ min: 1, max: 16, disabled: pieceData.ranged_capture_actions_per_turn === -1, placeholder: "1", className: styles["form-input-small"] }}
              />
              <ToggleSwitch inline size="small"
                checked={pieceData.ranged_capture_actions_per_turn === -1}
                onChange={(v) => handleChange("ranged_capture_actions_per_turn", v ? -1 : 1)}
                label="Unlimited"
              />
            </div>

            {/* Firing Over Pieces */}
            <div className={styles["sub-field"]}>
              <h4>Line of Sight <InfoTooltip text="By default, ranged attacks are blocked by other pieces. Enable these to allow firing over allies or enemies." /></h4>
              <ToggleSwitch
                checked={pieceData.can_fire_over_allies || false}
                onChange={(v) => handleChange("can_fire_over_allies", v)}
                label="Can fire over allied pieces"
              />
              <ToggleSwitch
                checked={pieceData.can_fire_over_enemies || false}
                onChange={(v) => handleChange("can_fire_over_enemies", v)}
                label="Can fire over enemy pieces"
              />
            </div>

            {/* Directional Ranged Attack */}
            <div className={styles["sub-field"]}>
              <h4>Directional Ranged Attack</h4>
              <p className={styles["field-hint"]}>
                Set ranged attack range in each direction. 0 = no attack, positive = up to. Check "Exact" to require exactly that distance, or "Infinite" for unlimited range.
              </p>
              
              <div className={styles["directional-grid"]}>
                <div className={styles["direction-row"]}>
                  {/* Up-Left */}
                  <div className={styles["direction-input"]}>
                    <label>↖ Up-Left</label>
                    <NumberInput
                      value={pieceData.up_left_attack_range === 99 ? "∞" : (pieceData.up_left_attack_range || 0)}
                      onChange={(val) => handleChange("up_left_attack_range", val)}
                      options={{ disabled: pieceData.up_left_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.up_left_attack_range_exact}
                      onChange={(v) => handleChange("up_left_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.up_left_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.up_left_attack_range === 99}
                      onChange={(v) => handleChange("up_left_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                  
                  {/* Up */}
                  <div className={styles["direction-input"]}>
                    <label>↑ Up</label>
                    <NumberInput
                      value={pieceData.up_attack_range === 99 ? "∞" : (pieceData.up_attack_range || 0)}
                      onChange={(val) => handleChange("up_attack_range", val)}
                      options={{ disabled: pieceData.up_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.up_attack_range_exact}
                      onChange={(v) => handleChange("up_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.up_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.up_attack_range === 99}
                      onChange={(v) => handleChange("up_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                  
                  {/* Up-Right */}
                  <div className={styles["direction-input"]}>
                    <label>↗ Up-Right</label>
                    <NumberInput
                      value={pieceData.up_right_attack_range === 99 ? "∞" : (pieceData.up_right_attack_range || 0)}
                      onChange={(val) => handleChange("up_right_attack_range", val)}
                      options={{ disabled: pieceData.up_right_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.up_right_attack_range_exact}
                      onChange={(v) => handleChange("up_right_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.up_right_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.up_right_attack_range === 99}
                      onChange={(v) => handleChange("up_right_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                </div>
                
                <div className={styles["direction-row"]}>
                  {/* Left */}
                  <div className={styles["direction-input"]}>
                    <label>← Left</label>
                    <NumberInput
                      value={pieceData.left_attack_range === 99 ? "∞" : (pieceData.left_attack_range || 0)}
                      onChange={(val) => handleChange("left_attack_range", val)}
                      options={{ disabled: pieceData.left_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.left_attack_range_exact}
                      onChange={(v) => handleChange("left_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.left_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.left_attack_range === 99}
                      onChange={(v) => handleChange("left_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                  
                  {/* Center piece */}
                  <div className={styles["direction-center"]}>
                    <div className={styles["center-piece"]}>
                      {pieceData.piece_image_previews?.[0] ? (
                        <img src={pieceData.piece_image_previews[0]} alt="Piece" />
                      ) : (
                        "💥"
                      )}
                    </div>
                  </div>
                  
                  {/* Right */}
                  <div className={styles["direction-input"]}>
                    <label>→ Right</label>
                    <NumberInput
                      value={pieceData.right_attack_range === 99 ? "∞" : (pieceData.right_attack_range || 0)}
                      onChange={(val) => handleChange("right_attack_range", val)}
                      options={{ disabled: pieceData.right_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.right_attack_range_exact}
                      onChange={(v) => handleChange("right_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.right_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.right_attack_range === 99}
                      onChange={(v) => handleChange("right_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                </div>
                
                <div className={styles["direction-row"]}>
                  {/* Down-Left */}
                  <div className={styles["direction-input"]}>
                    <label>↙ Down-Left</label>
                    <NumberInput
                      value={pieceData.down_left_attack_range === 99 ? "∞" : (pieceData.down_left_attack_range || 0)}
                      onChange={(val) => handleChange("down_left_attack_range", val)}
                      options={{ disabled: pieceData.down_left_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.down_left_attack_range_exact}
                      onChange={(v) => handleChange("down_left_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.down_left_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.down_left_attack_range === 99}
                      onChange={(v) => handleChange("down_left_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                  
                  {/* Down */}
                  <div className={styles["direction-input"]}>
                    <label>↓ Down</label>
                    <NumberInput
                      value={pieceData.down_attack_range === 99 ? "∞" : (pieceData.down_attack_range || 0)}
                      onChange={(val) => handleChange("down_attack_range", val)}
                      options={{ disabled: pieceData.down_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.down_attack_range_exact}
                      onChange={(v) => handleChange("down_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.down_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.down_attack_range === 99}
                      onChange={(v) => handleChange("down_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                  
                  {/* Down-Right */}
                  <div className={styles["direction-input"]}>
                    <label>↘ Down-Right</label>
                    <NumberInput
                      value={pieceData.down_right_attack_range === 99 ? "∞" : (pieceData.down_right_attack_range || 0)}
                      onChange={(val) => handleChange("down_right_attack_range", val)}
                      options={{ disabled: pieceData.down_right_attack_range === 99 }}
                    />
                    <ToggleSwitch inline size="small"
                      checked={!!pieceData.down_right_attack_range_exact}
                      onChange={(v) => handleChange("down_right_attack_range_exact", v)}
                      label="Exact"
                      disabled={pieceData.down_right_attack_range === 99}
                    />
                    <ToggleSwitch inline size="small"
                      checked={pieceData.down_right_attack_range === 99}
                      onChange={(v) => handleChange("down_right_attack_range", v ? 99 : 0)}
                      label="Infinite"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Ratio Ranged Attack (Knight-like) */}
            <div className={styles["sub-field"]}>
              <h4>Ratio Ranged Attack (L-shape)</h4>
              <div className={styles["form-row"]}>
                <div className={styles["form-group"]}>
                  <label>Ratio One Attack Range</label>
                  <NumberInput
                    value={pieceData.ratio_one_attack_range || ""}
                    onChange={(val) => handleNumberChange("ratio_one_attack_range", val || "")}
                    options={{ placeholder: "e.g., 2", className: styles["form-input-small"] }}
                  />
                </div>
                <div className={styles["form-group"]}>
                  <label>Ratio Two Attack Range</label>
                  <NumberInput
                    value={pieceData.ratio_two_attack_range || ""}
                    onChange={(val) => handleNumberChange("ratio_two_attack_range", val || "")}
                    options={{ placeholder: "e.g., 1", className: styles["form-input-small"] }}
                  />
                </div>
              </div>
              <p className={styles["field-hint"]}>
                Set to 0 or leave empty to disable L-shaped ranged attack pattern
              </p>
            </div>

            {/* Step-by-Step Ranged Attack */}
            <div className={styles["sub-field"]}>
              <h4>Step-by-Step Ranged Attack <InfoTooltip text="A step budget for ranged attacks. The piece projects an attack one square at a time in any direction, changing direction each step. Maximum 8 steps. The checkbox restricts steps to orthogonal directions only (no diagonal). Leave empty to disable. Values of 7 or higher disable additional custom-square attacks." /></h4>
              <label>Total Attack Steps (0–{MAX_STEP_BY_STEP})</label>
              <NumberInput
                value={pieceData.step_by_step_attack_range ? Math.abs(pieceData.step_by_step_attack_range) : ""}
                onChange={(val) => {
                  const currentIsNoDiagonal = pieceData.step_by_step_attack_range < 0;
                  const clamped = val ? Math.min(MAX_STEP_BY_STEP, Math.max(0, Math.abs(val))) : null;
                  handleChange("step_by_step_attack_range", clamped && currentIsNoDiagonal ? -clamped : (clamped || null));
                }}
                options={{ min: 0, max: MAX_STEP_BY_STEP, placeholder: `Leave empty to disable (max ${MAX_STEP_BY_STEP})`, className: styles["form-input-small"] }}
              />
              <ToggleSwitch inline size="small"
                checked={pieceData.step_by_step_attack_range < 0}
                onChange={(v) => {
                  const val = Math.abs(pieceData.step_by_step_attack_range || 0);
                  handleChange("step_by_step_attack_range", v ? -val : val);
                }}
                disabled={!pieceData.step_by_step_attack_range}
                label="Exclude diagonal movement"
              />
              <p className={styles["field-hint"]}>
                Total squares piece can attack from range in any combination of directions (checked = orthogonal only)
              </p>
            </div>
          </>
        )}
      </div>

      {/* Custom Square Attack */}
      <div className={styles["condition-section"]}>
        <h3>Custom Square Attack <InfoTooltip text="Click squares on the grid to define specific squares this piece can capture on, relative to its position. Click or drag to paint squares. The gold center square is the piece's position. This works in addition to any other capture configured above. Limited to 50 squares. If step-by-step capture or step-by-step ranged attack is set to 7 or higher, additional custom squares cannot be added because the step area already covers the entire grid. Note: custom squares always function as teleporting attacks — the piece jumps directly to the target regardless of any pieces in between. If you want attacks to be blocked by other pieces, use directional or ratio/exact capture styles above instead." /></h3>
        <CustomSquareSelector
          squares={pieceData.custom_attack_squares}
          onChange={(val) => updatePieceData({ custom_attack_squares: val })}
          color="#d94a4a"
          addDisabled={customAttackDisabled}
          addDisabledMessage={customAttackDisabledMessage}
        />
      </div>

      {/* Live Preview */}
      <div className={styles["board-preview-section"]}>
        <h3>Attack Preview</h3>
        <PieceBoardPreview pieceData={pieceData} />
      </div>
    </div>
  );
};

export default PieceStep3Attack;
