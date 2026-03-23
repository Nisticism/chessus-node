import React, { useEffect } from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "./InfoTooltip";
import { PIECE_WIZARD_TEXT } from "../../global/global";

const PieceStep3Attack = ({ pieceData, updatePieceData, hasManuallySetAttackStyle }) => {
  
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
  
  // When component mounts, if attacks_like_movement is checked, import current movement values
  useEffect(() => {
    if (pieceData.attacks_like_movement) {
      // Convert additional movements to additional captures
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
        // Copy ratio movement
        ratio_one_capture: pieceData.ratio_one_movement,
        ratio_two_capture: pieceData.ratio_two_movement,
        // Copy step-by-step
        step_by_step_capture: pieceData.step_by_step_movement_value,
        // Copy repeating movement setting
        repeating_capture: pieceData.repeating_movement,
        // Copy additional movements to additional captures
        ...(convertedCaptures && { special_scenario_capture: convertedCaptures })
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount - intentionally using initial values only
  
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
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={capture.exact}
                    onChange={(e) => updateAdditionalCapture(direction, index, 'exact', e.target.checked)}
                    disabled={capture.infinite}
                  />
                  <span>Exact</span>
                </label>
              </div>
              <div className={styles["additional-movement-line"]}>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={capture.infinite}
                    onChange={(e) => updateAdditionalCapture(direction, index, 'infinite', e.target.checked)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
              <div className={styles["additional-movement-line"]}>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={!!capture.availableForMoves}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateAdditionalCapture(direction, index, 'availableForMoves', 1);
                      } else {
                        updateAdditionalCapture(direction, index, 'availableForMoves', null);
                      }
                    }}
                  />
                  <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                </label>
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
        >
          + Add Alternative Capture
        </button>
      </div>
    );
  };

  const handleAttackLikeMovement = (checked) => {
    // Mark that user has manually set this
    if (hasManuallySetAttackStyle) {
      hasManuallySetAttackStyle.current = true;
    }
    
    if (checked) {
      // Convert additional movements to additional captures
      const convertedCaptures = convertMovementsToCaptures(pieceData.special_scenario_moves);
      
      // Import all movement settings to capture settings
      updatePieceData({
        attacks_like_movement: true,
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
        // Copy ratio movement
        ratio_one_capture: pieceData.ratio_one_movement,
        ratio_two_capture: pieceData.ratio_two_movement,
        // Copy step-by-step
        step_by_step_capture: pieceData.step_by_step_movement_value,
        // Copy repeating movement setting
        repeating_capture: pieceData.repeating_movement,
        // Copy additional movements to additional captures
        ...(convertedCaptures && { special_scenario_capture: convertedCaptures }),
        // Disable ranged by default when capturing on move
        can_capture_enemy_via_range: false
      });
    } else {
      // Clear all carried-over capture styles so user starts with a blank slate
      updatePieceData({
        attacks_like_movement: false,
        up_left_capture: 0,
        up_capture: 0,
        up_right_capture: 0,
        left_capture: 0,
        right_capture: 0,
        down_left_capture: 0,
        down_capture: 0,
        down_right_capture: 0,
        up_left_capture_exact: false,
        up_capture_exact: false,
        up_right_capture_exact: false,
        left_capture_exact: false,
        right_capture_exact: false,
        down_left_capture_exact: false,
        down_capture_exact: false,
        down_right_capture_exact: false,
        up_left_capture_available_for: null,
        up_capture_available_for: null,
        up_right_capture_available_for: null,
        left_capture_available_for: null,
        right_capture_available_for: null,
        down_left_capture_available_for: null,
        down_capture_available_for: null,
        down_right_capture_available_for: null,
        ratio_one_capture: null,
        ratio_two_capture: null,
        step_by_step_capture: null,
        repeating_capture: false,
        special_scenario_capture: null,
      });
    }
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Attack & Capture Configuration</h2>
      <p className={styles["step-description"]}>
        Define how your piece captures and attacks.
      </p>

      {/* Attack Like Movement Checkbox */}
      <div className={styles["form-group"]}>
        <label className={styles["checkbox-label"]}>
          <input
            type="checkbox"
            checked={pieceData.attacks_like_movement || false}
            onChange={(e) => handleAttackLikeMovement(e.target.checked)}
          />
          <span>Can attack how it moves <InfoTooltip text="Automatically copies all your movement settings (Step 2) to the capture settings below. The piece will be able to capture enemies on any square it can move to. Toggle this off to configure capture patterns separately from movement." /></span>
        </label>
      </div>

      {/* Capture on Move */}
      <div className={styles["condition-section"]}>
        <h3>Capture on Move <InfoTooltip text="'Capture on Move' means the piece moves to the enemy's square to capture it (like most chess pieces). This is different from 'Can attack how it moves' above — that checkbox auto-imports your movement settings. This section lets you manually configure capture-specific directions, distances, and patterns independently of how the piece moves." /></h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="can_capture_enemy_on_move"
              value="true"
              checked={pieceData.can_capture_enemy_on_move === true || pieceData.can_capture_enemy_on_move === 1}
              onChange={(e) => handleBooleanChange("can_capture_enemy_on_move", e.target.value)}
            />
            <span>Can capture by moving to enemy square</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="can_capture_enemy_on_move"
              value="false"
              checked={pieceData.can_capture_enemy_on_move === false || pieceData.can_capture_enemy_on_move === 0}
              onChange={(e) => handleBooleanChange("can_capture_enemy_on_move", e.target.value)}
            />
            <span>Cannot capture on move</span>
          </label>
        </div>

        {pieceData.can_capture_enemy_on_move && (
          <>
            <div className={styles["sub-field"]}>
              <label>Max Captures Per Move</label>
              <NumberInput
                value={pieceData.max_captures_per_move === -1 ? "" : (pieceData.max_captures_per_move || 1)}
                onChange={(val) => handleChange("max_captures_per_move", val)}
                options={{ min: 1, disabled: pieceData.max_captures_per_move === -1, placeholder: "1", className: styles["form-input-small"] }}
              />
              <label className={styles["checkbox-label-inline"]}>
                <input
                  type="checkbox"
                  checked={pieceData.max_captures_per_move === -1}
                  onChange={(e) => handleChange("max_captures_per_move", e.target.checked ? -1 : 1)}
                />
                <span>Unlimited</span>
              </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.up_left_capture === 99 ? "∞" : (pieceData.up_left_capture || 0)}
                          onChange={(val) => handleChange("up_left_capture", val)}
                          options={{ disabled: pieceData.up_left_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.up_left_capture_exact}
                            onChange={(e) => handleChange("up_left_capture_exact", e.target.checked)}
                            disabled={pieceData.up_left_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.up_left_capture === 99}
                            onChange={(e) => handleChange("up_left_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.up_left_capture_available_for}
                            onChange={(e) => handleChange("up_left_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.up_left_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.up_capture === 99 ? "∞" : (pieceData.up_capture || 0)}
                          onChange={(val) => handleChange("up_capture", val)}
                          options={{ disabled: pieceData.up_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.up_capture_exact}
                            onChange={(e) => handleChange("up_capture_exact", e.target.checked)}
                            disabled={pieceData.up_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.up_capture === 99}
                            onChange={(e) => handleChange("up_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.up_capture_available_for}
                            onChange={(e) => handleChange("up_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.up_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.up_right_capture === 99 ? "∞" : (pieceData.up_right_capture || 0)}
                          onChange={(val) => handleChange("up_right_capture", val)}
                          options={{ disabled: pieceData.up_right_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.up_right_capture_exact}
                            onChange={(e) => handleChange("up_right_capture_exact", e.target.checked)}
                            disabled={pieceData.up_right_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.up_right_capture === 99}
                            onChange={(e) => handleChange("up_right_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.up_right_capture_available_for}
                            onChange={(e) => handleChange("up_right_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.up_right_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.left_capture === 99 ? "∞" : (pieceData.left_capture || 0)}
                          onChange={(val) => handleChange("left_capture", val)}
                          options={{ disabled: pieceData.left_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.left_capture_exact}
                            onChange={(e) => handleChange("left_capture_exact", e.target.checked)}
                            disabled={pieceData.left_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.left_capture === 99}
                            onChange={(e) => handleChange("left_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.left_capture_available_for}
                            onChange={(e) => handleChange("left_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.left_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.right_capture === 99 ? "∞" : (pieceData.right_capture || 0)}
                          onChange={(val) => handleChange("right_capture", val)}
                          options={{ disabled: pieceData.right_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.right_capture_exact}
                            onChange={(e) => handleChange("right_capture_exact", e.target.checked)}
                            disabled={pieceData.right_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.right_capture === 99}
                            onChange={(e) => handleChange("right_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.right_capture_available_for}
                            onChange={(e) => handleChange("right_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.right_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.down_left_capture === 99 ? "∞" : (pieceData.down_left_capture || 0)}
                          onChange={(val) => handleChange("down_left_capture", val)}
                          options={{ disabled: pieceData.down_left_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.down_left_capture_exact}
                            onChange={(e) => handleChange("down_left_capture_exact", e.target.checked)}
                            disabled={pieceData.down_left_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.down_left_capture === 99}
                            onChange={(e) => handleChange("down_left_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.down_left_capture_available_for}
                            onChange={(e) => handleChange("down_left_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.down_left_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.down_capture === 99 ? "∞" : (pieceData.down_capture || 0)}
                          onChange={(val) => handleChange("down_capture", val)}
                          options={{ disabled: pieceData.down_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.down_capture_exact}
                            onChange={(e) => handleChange("down_capture_exact", e.target.checked)}
                            disabled={pieceData.down_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.down_capture === 99}
                            onChange={(e) => handleChange("down_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.down_capture_available_for}
                            onChange={(e) => handleChange("down_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.down_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <NumberInput
                          value={pieceData.down_right_capture === 99 ? "∞" : (pieceData.down_right_capture || 0)}
                          onChange={(val) => handleChange("down_right_capture", val)}
                          options={{ disabled: pieceData.down_right_capture === 99 }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.down_right_capture_exact}
                            onChange={(e) => handleChange("down_right_capture_exact", e.target.checked)}
                            disabled={pieceData.down_right_capture === 99}
                          />
                          <span>Exact</span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={pieceData.down_right_capture === 99}
                            onChange={(e) => handleChange("down_right_capture", e.target.checked ? 99 : 0)}
                          />
                          <span>Infinite</span>
                        </label>
                      </div>
                      <div className={styles["available-for-moves-group"]}>
                        <label className={styles["checkbox-label-inline"]}>
                          <input
                            type="checkbox"
                            checked={!!pieceData.down_right_capture_available_for}
                            onChange={(e) => handleChange("down_right_capture_available_for", e.target.checked ? 1 : null)}
                            disabled={pieceData.down_right_capture === 99}
                          />
                          <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                        </label>
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
                <label className={styles["checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.repeating_capture || false}
                    onChange={(e) => handleChange("repeating_capture", e.target.checked)}
                  />
                  <span>Repeating exact capture <InfoTooltip text="When enabled with exact captures, the piece can repeat its exact capture distance pattern infinitely along that direction, landing on every Nth square. For example, a piece with Exact 2 capture could capture on squares 2, 4, 6, 8, etc." /></span>
                </label>
              </div>
            )}

            {/* Ratio Capture (Knight-like) */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Ratio Capture Movement (L-shape) <InfoTooltip text="L-shaped capture like a knight. The piece jumps one distance in one direction, then a different distance perpendicularly to land on and capture an enemy. Leave both empty to disable. Example: 2 and 1 for standard knight capture." /></h4>
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
              </div>
            )}

            {/* Step-by-Step Capture */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Step-by-Step Capture <InfoTooltip text="A step budget for capturing. The piece moves one square at a time in any direction, changing direction each step, to reach and capture an enemy. The checkbox restricts steps to orthogonal directions only (no diagonal). Leave empty to disable." /></h4>
                <label>Total Capture Steps</label>
                <NumberInput
                  value={pieceData.step_by_step_capture ? Math.abs(pieceData.step_by_step_capture) : ""}
                  onChange={(val) => {
                    const currentIsNoDiagonal = pieceData.step_by_step_capture < 0;
                    handleChange("step_by_step_capture", currentIsNoDiagonal && val ? -val : val || null);
                  }}
                  options={{ placeholder: "Leave empty to disable", className: styles["form-input-small"] }}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.step_by_step_capture < 0}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.step_by_step_capture || 0);
                      handleChange("step_by_step_capture", e.target.checked ? -val : val);
                    }}
                    disabled={!pieceData.step_by_step_capture}
                  />
                  <span>Exclude diagonal movement</span>
                </label>
              </div>
            )}
          </>
        )}
      </div>

      {/* Checkers-style Capture Options */}
      <div className={styles["condition-section"]}>
        <h3>Checkers-style Capture <InfoTooltip text="These options control what happens when a piece hops over another piece. 'Capture on Hop' makes hopping over an enemy capture it (like checkers). 'Chain Capture' allows multiple jumps in one turn. Requires 'Can hop over enemy pieces' to be enabled in Movement Hopping (Step 2)." /></h3>

        {/* Capture on Hop - disabled when can_hop_over_enemies not enabled in Step 2 */}
        <div style={{ marginBottom: '15px' }}>
          <label className={styles["checkbox-label"]} style={pieceData.can_hop_over_enemies ? {} : { opacity: 0.5 }}>
            <input
              type="checkbox"
              checked={pieceData.capture_on_hop || false}
              onChange={(e) => handleChange("capture_on_hop", e.target.checked)}
              disabled={!pieceData.can_hop_over_enemies}
            />
            <span>Capture on Hop <InfoTooltip text="When this piece hops over enemy pieces (jumps over them to land on an empty square beyond), it captures all enemy pieces it hops over. Essential for checkers-style gameplay. Requires 'Can hop over enemy pieces' in Movement Hopping (Step 2)." /></span>
          </label>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={pieceData.chain_capture_enabled || false}
              onChange={(e) => handleChange("chain_capture_enabled", e.target.checked)}
            />
            <span>Chain Capture (Multi-Jump) <InfoTooltip text="If this piece captures an enemy, it can make additional captures in the same turn (only this piece can move). Enables multi-jump sequences like in checkers." /></span>
          </label>
          
          {/* Chain Hop Over Allies - only show when chain capture is enabled */}
          {pieceData.chain_capture_enabled && (
            <div style={{ marginLeft: '20px', marginTop: '10px' }}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={pieceData.chain_hop_allies || false}
                  onChange={(e) => handleChange("chain_hop_allies", e.target.checked)}
                />
                <span>Chain Hop Over Allies <InfoTooltip text="During chain capture sequences, this piece can also hop over allied pieces (not capturing them). Useful for variants where jumping over your own pieces is allowed during multi-jump moves." /></span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Ranged Attack */}
      <div className={styles["condition-section"]}>
        <h3>Ranged Attack <InfoTooltip text="Ranged attacks let the piece attack without moving — it stays in place but can capture distant enemies. Unlike 'Capture on Move,' the piece does not move to the target square. Configure the attack range, line of sight rules (whether it can fire over other pieces), and directional/ratio attack patterns." /></h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="can_capture_enemy_via_range"
              value="true"
              checked={pieceData.can_capture_enemy_via_range === true}
              onChange={(e) => handleBooleanChange("can_capture_enemy_via_range", e.target.value)}
            />
            <span>Enable ranged attack</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="can_capture_enemy_via_range"
              value="false"
              checked={pieceData.can_capture_enemy_via_range === false}
              onChange={(e) => handleBooleanChange("can_capture_enemy_via_range", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>

        {pieceData.can_capture_enemy_via_range && (
          <>
            <div className={styles["sub-field"]}>
              <label>Max Ranged Captures Per Turn</label>
              <NumberInput
                value={pieceData.max_captures_via_ranged_attack === -1 ? "" : (pieceData.max_captures_via_ranged_attack || 1)}
                onChange={(val) => handleChange("max_captures_via_ranged_attack", val)}
                options={{ min: 1, disabled: pieceData.max_captures_via_ranged_attack === -1, placeholder: "1", className: styles["form-input-small"] }}
              />
              <label className={styles["checkbox-label-inline"]}>
                <input
                  type="checkbox"
                  checked={pieceData.max_captures_via_ranged_attack === -1}
                  onChange={(e) => handleChange("max_captures_via_ranged_attack", e.target.checked ? -1 : 1)}
                />
                <span>Unlimited</span>
              </label>
            </div>

            {/* Firing Over Pieces */}
            <div className={styles["sub-field"]}>
              <h4>Line of Sight</h4>
              <p className={styles["field-hint"]}>
                By default, ranged attacks are blocked by other pieces. Enable these to allow firing over allies or enemies.
              </p>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={pieceData.can_fire_over_allies}
                  onChange={(e) => handleChange("can_fire_over_allies", e.target.checked)}
                />
                <span>Can fire over allied pieces</span>
              </label>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={pieceData.can_fire_over_enemies}
                  onChange={(e) => handleChange("can_fire_over_enemies", e.target.checked)}
                />
                <span>Can fire over enemy pieces</span>
              </label>
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
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.up_left_attack_range_exact}
                        onChange={(e) => handleChange("up_left_attack_range_exact", e.target.checked)}
                        disabled={pieceData.up_left_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.up_left_attack_range === 99}
                        onChange={(e) => handleChange("up_left_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
                  </div>
                  
                  {/* Up */}
                  <div className={styles["direction-input"]}>
                    <label>↑ Up</label>
                    <NumberInput
                      value={pieceData.up_attack_range === 99 ? "∞" : (pieceData.up_attack_range || 0)}
                      onChange={(val) => handleChange("up_attack_range", val)}
                      options={{ disabled: pieceData.up_attack_range === 99 }}
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.up_attack_range_exact}
                        onChange={(e) => handleChange("up_attack_range_exact", e.target.checked)}
                        disabled={pieceData.up_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.up_attack_range === 99}
                        onChange={(e) => handleChange("up_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
                  </div>
                  
                  {/* Up-Right */}
                  <div className={styles["direction-input"]}>
                    <label>↗ Up-Right</label>
                    <NumberInput
                      value={pieceData.up_right_attack_range === 99 ? "∞" : (pieceData.up_right_attack_range || 0)}
                      onChange={(val) => handleChange("up_right_attack_range", val)}
                      options={{ disabled: pieceData.up_right_attack_range === 99 }}
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.up_right_attack_range_exact}
                        onChange={(e) => handleChange("up_right_attack_range_exact", e.target.checked)}
                        disabled={pieceData.up_right_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.up_right_attack_range === 99}
                        onChange={(e) => handleChange("up_right_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
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
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.left_attack_range_exact}
                        onChange={(e) => handleChange("left_attack_range_exact", e.target.checked)}
                        disabled={pieceData.left_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.left_attack_range === 99}
                        onChange={(e) => handleChange("left_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
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
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.right_attack_range_exact}
                        onChange={(e) => handleChange("right_attack_range_exact", e.target.checked)}
                        disabled={pieceData.right_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.right_attack_range === 99}
                        onChange={(e) => handleChange("right_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
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
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.down_left_attack_range_exact}
                        onChange={(e) => handleChange("down_left_attack_range_exact", e.target.checked)}
                        disabled={pieceData.down_left_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.down_left_attack_range === 99}
                        onChange={(e) => handleChange("down_left_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
                  </div>
                  
                  {/* Down */}
                  <div className={styles["direction-input"]}>
                    <label>↓ Down</label>
                    <NumberInput
                      value={pieceData.down_attack_range === 99 ? "∞" : (pieceData.down_attack_range || 0)}
                      onChange={(val) => handleChange("down_attack_range", val)}
                      options={{ disabled: pieceData.down_attack_range === 99 }}
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.down_attack_range_exact}
                        onChange={(e) => handleChange("down_attack_range_exact", e.target.checked)}
                        disabled={pieceData.down_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.down_attack_range === 99}
                        onChange={(e) => handleChange("down_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
                  </div>
                  
                  {/* Down-Right */}
                  <div className={styles["direction-input"]}>
                    <label>↘ Down-Right</label>
                    <NumberInput
                      value={pieceData.down_right_attack_range === 99 ? "∞" : (pieceData.down_right_attack_range || 0)}
                      onChange={(val) => handleChange("down_right_attack_range", val)}
                      options={{ disabled: pieceData.down_right_attack_range === 99 }}
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={!!pieceData.down_right_attack_range_exact}
                        onChange={(e) => handleChange("down_right_attack_range_exact", e.target.checked)}
                        disabled={pieceData.down_right_attack_range === 99}
                      />
                      <span>Exact</span>
                    </label>
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.down_right_attack_range === 99}
                        onChange={(e) => handleChange("down_right_attack_range", e.target.checked ? 99 : 0)}
                      />
                      <span>Infinite</span>
                    </label>
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
              <h4>Step-by-Step Ranged Attack</h4>
              <label>Total Attack Steps</label>
              <NumberInput
                value={pieceData.step_by_step_attack_range ? Math.abs(pieceData.step_by_step_attack_range) : ""}
                onChange={(val) => {
                  const currentIsNoDiagonal = pieceData.step_by_step_attack_range < 0;
                  handleChange("step_by_step_attack_range", currentIsNoDiagonal && val ? -val : val || null);
                }}
                options={{ placeholder: "Leave empty to disable", className: styles["form-input-small"] }}
              />
              <label className={styles["checkbox-label-inline"]}>
                <input
                  type="checkbox"
                  checked={pieceData.step_by_step_attack_range < 0}
                  onChange={(e) => {
                    const val = Math.abs(pieceData.step_by_step_attack_range || 0);
                    handleChange("step_by_step_attack_range", e.target.checked ? -val : val);
                  }}
                  disabled={!pieceData.step_by_step_attack_range}
                />
                <span>Exclude diagonal movement</span>
              </label>
              <p className={styles["field-hint"]}>
                Total squares piece can attack from range in any combination of directions (checked = orthogonal only)
              </p>
            </div>
          </>
        )}
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
