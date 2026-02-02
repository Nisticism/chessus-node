import React, { useEffect } from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";
import NumberInput from "../common/NumberInput";
import { PIECE_WIZARD_TEXT } from "../../global/global";

const PieceStep3Attack = ({ pieceData, updatePieceData, hasManuallySetAttackStyle }) => {
  
  // When component mounts, if attacks_like_movement is checked, import current movement values
  useEffect(() => {
    if (pieceData.attacks_like_movement) {
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
        // Copy ratio movement
        ratio_one_capture: pieceData.ratio_one_movement,
        ratio_two_capture: pieceData.ratio_two_movement,
        // Copy step-by-step
        step_by_step_capture: pieceData.step_by_step_movement_value
      });
    }
  }, []); // Run only once on mount
  
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

  // Parse additional captures from special_scenario_captures JSON
  const getAdditionalCaptures = () => {
    if (!pieceData.special_scenario_captures) return {};
    try {
      const parsed = typeof pieceData.special_scenario_captures === 'string' 
        ? JSON.parse(pieceData.special_scenario_captures)
        : pieceData.special_scenario_captures;
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
    
    const scenarioData = pieceData.special_scenario_captures 
      ? (typeof pieceData.special_scenario_captures === 'string' 
          ? JSON.parse(pieceData.special_scenario_captures)
          : pieceData.special_scenario_captures)
      : {};
    
    scenarioData.additionalCaptures = additionalCaptures;
    updatePieceData({ special_scenario_captures: JSON.stringify(scenarioData) });
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
      
      const scenarioData = pieceData.special_scenario_captures 
        ? (typeof pieceData.special_scenario_captures === 'string' 
            ? JSON.parse(pieceData.special_scenario_captures)
            : pieceData.special_scenario_captures)
        : {};
      
      scenarioData.additionalCaptures = additionalCaptures;
      updatePieceData({ special_scenario_captures: JSON.stringify(scenarioData) });
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
      
      const scenarioData = pieceData.special_scenario_captures 
        ? (typeof pieceData.special_scenario_captures === 'string' 
            ? JSON.parse(pieceData.special_scenario_captures)
            : pieceData.special_scenario_captures)
        : {};
      
      scenarioData.additionalCaptures = additionalCaptures;
      updatePieceData({ special_scenario_captures: JSON.stringify(scenarioData) });
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
        // Copy ratio movement
        ratio_one_capture: pieceData.ratio_one_movement,
        ratio_two_capture: pieceData.ratio_two_movement,
        // Copy step-by-step
        step_by_step_capture: pieceData.step_by_step_movement_value,
        // Disable ranged by default when capturing on move
        can_capture_enemy_via_range: false
      });
    } else {
      updatePieceData({
        attacks_like_movement: false
      });
    }
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Attack & Capture Configuration</h2>
      <p className={styles["step-description"]}>
        Define how your piece captures and attacks. Pieces can capture by moving (like most chess pieces) or attack from range without moving (like a cannon). Values: 0 = cannot, positive = up to that many squares. Check "Exact" to require exactly that distance, or "Infinite" for unlimited range.
      </p>

      {/* Attack Like Movement Checkbox */}
      <div className={styles["form-group"]}>
        <label className={styles["checkbox-label"]}>
          <input
            type="checkbox"
            checked={pieceData.attacks_like_movement || false}
            onChange={(e) => handleAttackLikeMovement(e.target.checked)}
          />
          <span>Can attack how it moves (import movement settings)</span>
        </label>
        <p className={styles["field-hint"]}>
          Check this to automatically use the same pattern as movement for capturing on move
        </p>
      </div>

      {/* Capture on Move */}
      <div className={styles["condition-section"]}>
        <h3>Capture on Move</h3>
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

            {/* First Move Only Option for Captures */}
            <div className={styles["sub-field"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={pieceData.first_move_only_capture}
                  onChange={(e) => handleChange("first_move_only_capture", e.target.checked)}
                />
                <span>First move only (piece loses capture ability after moving once)</span>
              </label>
            </div>

            {/* Ratio Capture (Knight-like) */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Ratio Capture Movement (L-shape)</h4>
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
                <p className={styles["field-hint"]}>
                  Leave empty to disable L-shaped capture (e.g., 2 and 1 for knight-like)
                </p>
              </div>
            )}

            {/* Step-by-Step Capture */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Step-by-Step Capture</h4>
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
                <p className={styles["field-hint"]}>
                  Total squares piece can capture in any combination of directions (checked = orthogonal only)
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Ranged Attack */}
      <div className={styles["condition-section"]}>
        <h3>Ranged Attack</h3>
        <p className={styles["field-hint"]} style={{ marginBottom: '1.5rem' }}>
          Ranged attacks allow the piece to attack without moving (piece stays in place but can capture distant enemies)
        </p>
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
        <p className={styles["preview-legend"]}>
          <span className={styles["legend-movement"]}>Blue = Movement</span>
          <span className={styles["legend-capture"]}>Orange = Capture on Move</span>
          <span className={styles["legend-ranged"]}>Red = Ranged Attack 💥</span>
        </p>
        <PieceBoardPreview pieceData={pieceData} />
      </div>
    </div>
  );
};

export default PieceStep3Attack;
