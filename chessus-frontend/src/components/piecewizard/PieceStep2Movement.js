import React from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";
import NumberInput from "../common/NumberInput";
import { PIECE_WIZARD_TEXT } from "../../global/global";

const PieceStep2Movement = ({ pieceData, updatePieceData }) => {
  const handleChange = (field, value) => {
    const updates = { [field]: value };
    
    // Handle mutual exclusivity between exact and infinite for directional movements
    if (field.endsWith('_movement') && value === 99) {
      // Setting infinite, so uncheck exact
      const exactField = field + '_exact';
      updates[exactField] = false;
    } else if (field.endsWith('_movement_exact') && value === true) {
      // Setting exact, so uncheck infinite
      const movementField = field.replace('_exact', '');
      if (pieceData[movementField] === 99) {
        updates[movementField] = 0;
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

  // Parse additional movements from special_scenario_movement JSON
  const getAdditionalMovements = () => {
    if (!pieceData.special_scenario_movement) return {};
    try {
      const parsed = typeof pieceData.special_scenario_movement === 'string' 
        ? JSON.parse(pieceData.special_scenario_movement)
        : pieceData.special_scenario_movement;
      return parsed.additionalMovements || {};
    } catch {
      return {};
    }
  };

  // Add an additional movement for a direction
  const addAdditionalMovement = (direction) => {
    const additionalMovements = getAdditionalMovements();
    if (!additionalMovements[direction]) {
      additionalMovements[direction] = [];
    }
    additionalMovements[direction].push({
      value: 1,
      exact: false,
      infinite: false,
      firstMoveOnly: false
    });
    
    const scenarioData = pieceData.special_scenario_movement 
      ? (typeof pieceData.special_scenario_movement === 'string' 
          ? JSON.parse(pieceData.special_scenario_movement)
          : pieceData.special_scenario_movement)
      : {};
    
    scenarioData.additionalMovements = additionalMovements;
    updatePieceData({ special_scenario_movement: JSON.stringify(scenarioData) });
  };

  // Update an additional movement
  const updateAdditionalMovement = (direction, index, field, value) => {
    const additionalMovements = getAdditionalMovements();
    if (additionalMovements[direction] && additionalMovements[direction][index]) {
      // If setting infinite to true, uncheck exact
      if (field === 'infinite' && value === true) {
        additionalMovements[direction][index]['exact'] = false;
      }
      // If setting exact to true, uncheck infinite
      if (field === 'exact' && value === true) {
        additionalMovements[direction][index]['infinite'] = false;
      }
      
      additionalMovements[direction][index][field] = value;
      
      const scenarioData = pieceData.special_scenario_movement 
        ? (typeof pieceData.special_scenario_movement === 'string' 
            ? JSON.parse(pieceData.special_scenario_movement)
            : pieceData.special_scenario_movement)
        : {};
      
      scenarioData.additionalMovements = additionalMovements;
      updatePieceData({ special_scenario_movement: JSON.stringify(scenarioData) });
    }
  };

  // Remove an additional movement
  const removeAdditionalMovement = (direction, index) => {
    const additionalMovements = getAdditionalMovements();
    if (additionalMovements[direction]) {
      additionalMovements[direction].splice(index, 1);
      if (additionalMovements[direction].length === 0) {
        delete additionalMovements[direction];
      }
      
      const scenarioData = pieceData.special_scenario_movement 
        ? (typeof pieceData.special_scenario_movement === 'string' 
            ? JSON.parse(pieceData.special_scenario_movement)
            : pieceData.special_scenario_movement)
        : {};
      
      scenarioData.additionalMovements = additionalMovements;
      updatePieceData({ special_scenario_movement: JSON.stringify(scenarioData) });
    }
  };

  // Render additional movement options for a direction
  const renderAdditionalMovements = (direction, directionName, arrow) => {
    const additionalMovements = getAdditionalMovements();
    const movements = additionalMovements[direction] || [];
    
    return (
      <div className={styles["additional-movements"]}>
        {movements.map((movement, index) => (
          <div key={index} className={styles["additional-movement-item"]}>
            <button 
              type="button"
              className={styles["remove-btn"]}
              onClick={() => removeAdditionalMovement(direction, index)}
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
                  value={movement.infinite ? "∞" : movement.value}
                  onChange={(val) => updateAdditionalMovement(direction, index, 'value', val)}
                  options={{ disabled: movement.infinite, min: 0, max: 99 }}
                />
              </div>
              <div className={styles["additional-movement-line"]}>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={movement.exact}
                    onChange={(e) => updateAdditionalMovement(direction, index, 'exact', e.target.checked)}
                    disabled={movement.infinite}
                  />
                  <span>Exact</span>
                </label>
              </div>
              <div className={styles["additional-movement-line"]}>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={movement.infinite}
                    onChange={(e) => updateAdditionalMovement(direction, index, 'infinite', e.target.checked)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
              <div className={styles["additional-movement-line"]}>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={!!movement.availableForMoves}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateAdditionalMovement(direction, index, 'availableForMoves', 1);
                      } else {
                        updateAdditionalMovement(direction, index, 'availableForMoves', null);
                      }
                    }}
                  />
                  <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                </label>
                {movement.availableForMoves && (
                  <>
                    <NumberInput
                      value={movement.availableForMoves || 1}
                      onChange={(val) => updateAdditionalMovement(direction, index, 'availableForMoves', val)}
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
          onClick={() => addAdditionalMovement(direction)}
        >
          + Add Alternative Movement
        </button>
      </div>
    );
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Movement Configuration</h2>
      <p className={styles["step-description"]}>
        Define how your piece moves on the board. Values: 0 = cannot move, positive = up to that many squares. Check "Exact" to require exactly that distance, or "Infinite" for unlimited range.
      </p>

      {/* Directional Movement */}
      <div className={styles["condition-section"]}>
        <h3>Directional Movement</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="directional_movement_style"
              value="true"
              checked={pieceData.directional_movement_style === true}
              onChange={(e) => handleBooleanChange("directional_movement_style", e.target.value)}
            />
            <span>Enable directional movement</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="directional_movement_style"
              value="false"
              checked={pieceData.directional_movement_style === false}
              onChange={(e) => handleBooleanChange("directional_movement_style", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>

        {pieceData.directional_movement_style && (
          <div className={styles["directional-grid"]}>
            <div className={styles["direction-row"]}>
              <div className={styles["direction-input"]}>
                <label>↖ Up-Left</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.up_left_movement === 99 ? "∞" : (pieceData.up_left_movement || 0)}
                    onChange={(val) => handleChange("up_left_movement", val)}
                    options={{ disabled: pieceData.up_left_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.up_left_movement_exact}
                      onChange={(e) => handleChange("up_left_movement_exact", e.target.checked)}
                      disabled={pieceData.up_left_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.up_left_movement === 99}
                      onChange={(e) => handleChange("up_left_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.up_left_movement_available_for}
                      onChange={(e) => handleChange("up_left_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.up_left_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.up_left_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.up_left_movement_available_for || 1}
                        onChange={(val) => handleChange("up_left_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("up_left", "Up-Left", "↖")}
              </div>
              <div className={styles["direction-input"]}>
                <label>↑ Up</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.up_movement === 99 ? "∞" : (pieceData.up_movement || 0)}
                    onChange={(val) => handleChange("up_movement", val)}
                    options={{ disabled: pieceData.up_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.up_movement_exact}
                      onChange={(e) => handleChange("up_movement_exact", e.target.checked)}
                      disabled={pieceData.up_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.up_movement === 99}
                      onChange={(e) => handleChange("up_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.up_movement_available_for}
                      onChange={(e) => handleChange("up_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.up_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.up_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.up_movement_available_for || 1}
                        onChange={(val) => handleChange("up_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("up", "Up", "↑")}
              </div>
              <div className={styles["direction-input"]}>
                <label>↗ Up-Right</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.up_right_movement === 99 ? "∞" : (pieceData.up_right_movement || 0)}
                    onChange={(val) => handleChange("up_right_movement", val)}
                    options={{ disabled: pieceData.up_right_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.up_right_movement_exact}
                      onChange={(e) => handleChange("up_right_movement_exact", e.target.checked)}
                      disabled={pieceData.up_right_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.up_right_movement === 99}
                      onChange={(e) => handleChange("up_right_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.up_right_movement_available_for}
                      onChange={(e) => handleChange("up_right_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.up_right_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.up_right_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.up_right_movement_available_for || 1}
                        onChange={(val) => handleChange("up_right_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("up_right", "Up-Right", "↗")}
              </div>
            </div>
            <div className={styles["direction-row"]}>
              <div className={styles["direction-input"]}>
                <label>← Left</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.left_movement === 99 ? "∞" : (pieceData.left_movement || 0)}
                    onChange={(val) => handleChange("left_movement", val)}
                    options={{ disabled: pieceData.left_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.left_movement_exact}
                      onChange={(e) => handleChange("left_movement_exact", e.target.checked)}
                      disabled={pieceData.left_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.left_movement === 99}
                      onChange={(e) => handleChange("left_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.left_movement_available_for}
                      onChange={(e) => handleChange("left_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.left_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.left_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.left_movement_available_for || 1}
                        onChange={(val) => handleChange("left_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("left", "Left", "←")}
              </div>
              <div className={styles["direction-center"]}>
                <div className={styles["center-piece"]}>
                  {pieceData.piece_image_previews?.[0] ? (
                    <img src={pieceData.piece_image_previews[0]} alt="Piece" />
                  ) : (
                    "?"
                  )}
                </div>
              </div>
              <div className={styles["direction-input"]}>
                <label>→ Right</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.right_movement === 99 ? "∞" : (pieceData.right_movement || 0)}
                    onChange={(val) => handleChange("right_movement", val)}
                    options={{ disabled: pieceData.right_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.right_movement_exact}
                      onChange={(e) => handleChange("right_movement_exact", e.target.checked)}
                      disabled={pieceData.right_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.right_movement === 99}
                      onChange={(e) => handleChange("right_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.right_movement_available_for}
                      onChange={(e) => handleChange("right_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.right_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.right_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.right_movement_available_for || 1}
                        onChange={(val) => handleChange("right_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("right", "Right", "→")}
              </div>
            </div>
            <div className={styles["direction-row"]}>
              <div className={styles["direction-input"]}>
                <label>↙ Down-Left</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.down_left_movement === 99 ? "∞" : (pieceData.down_left_movement || 0)}
                    onChange={(val) => handleChange("down_left_movement", val)}
                    options={{ disabled: pieceData.down_left_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.down_left_movement_exact}
                      onChange={(e) => handleChange("down_left_movement_exact", e.target.checked)}
                      disabled={pieceData.down_left_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.down_left_movement === 99}
                      onChange={(e) => handleChange("down_left_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.down_left_movement_available_for}
                      onChange={(e) => handleChange("down_left_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.down_left_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.down_left_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.down_left_movement_available_for || 1}
                        onChange={(val) => handleChange("down_left_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("down_left", "Down-Left", "↙")}
              </div>
              <div className={styles["direction-input"]}>
                <label>↓ Down</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.down_movement === 99 ? "∞" : (pieceData.down_movement || 0)}
                    onChange={(val) => handleChange("down_movement", val)}
                    options={{ disabled: pieceData.down_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.down_movement_exact}
                      onChange={(e) => handleChange("down_movement_exact", e.target.checked)}
                      disabled={pieceData.down_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.down_movement === 99}
                      onChange={(e) => handleChange("down_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.down_movement_available_for}
                      onChange={(e) => handleChange("down_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.down_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.down_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.down_movement_available_for || 1}
                        onChange={(val) => handleChange("down_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("down", "Down", "↓")}
              </div>
              <div className={styles["direction-input"]}>
                <label>↘ Down-Right</label>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <NumberInput
                    value={pieceData.down_right_movement === 99 ? "∞" : (pieceData.down_right_movement || 0)}
                    onChange={(val) => handleChange("down_right_movement", val)}
                    options={{ disabled: pieceData.down_right_movement === 99 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.down_right_movement_exact}
                      onChange={(e) => handleChange("down_right_movement_exact", e.target.checked)}
                      disabled={pieceData.down_right_movement === 99}
                    />
                    <span>Exact</span>
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={pieceData.down_right_movement === 99}
                      onChange={(e) => handleChange("down_right_movement", e.target.checked ? 99 : 0)}
                    />
                    <span>Infinite</span>
                  </label>
                </div>
                <div className={styles["available-for-moves-group"]}>
                  <label className={styles["checkbox-label-inline"]}>
                    <input
                      type="checkbox"
                      checked={!!pieceData.down_right_movement_available_for}
                      onChange={(e) => handleChange("down_right_movement_available_for", e.target.checked ? 1 : null)}
                      disabled={pieceData.down_right_movement === 99}
                    />
                    <span>{PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}</span>
                  </label>
                  {pieceData.down_right_movement_available_for && (
                    <>
                      <NumberInput
                        value={pieceData.down_right_movement_available_for || 1}
                        onChange={(val) => handleChange("down_right_movement_available_for", val)}
                        options={{ min: 1, max: 99, className: styles["tiny-input"] }}
                      />
                      <span>{PIECE_WIZARD_TEXT.MOVES_LABEL}</span>
                    </>
                  )}
                </div>
                {renderAdditionalMovements("down_right", "Down-Right", "↘")}
              </div>
            </div>
            
            <div className={styles["sub-field"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={pieceData.repeating_movement}
                  onChange={(e) => handleChange("repeating_movement", e.target.checked)}
                />
                <span>Repeating movement for exact movements (piece can repeat exact movement pattern infinitely, landing on every Nth square)</span>
              </label>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={pieceData.first_move_only}
                  onChange={(e) => handleChange("first_move_only", e.target.checked)}
                />
                <span>Global first move only override (applies to ALL directional movements - piece loses all movements after moving once)</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Ratio Movement (Knight-like) */}
      <div className={styles["condition-section"]}>
        <h3>Ratio Movement (L-shape)</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="ratio_movement_style"
              value="true"
              checked={pieceData.ratio_movement_style === true}
              onChange={(e) => handleBooleanChange("ratio_movement_style", e.target.value)}
            />
            <span>Enable ratio movement</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="ratio_movement_style"
              value="false"
              checked={pieceData.ratio_movement_style === false}
              onChange={(e) => handleBooleanChange("ratio_movement_style", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>

        {pieceData.ratio_movement_style && (
          <div className={styles["sub-fields"]}>
            <div className={styles["form-row"]}>
              <div className={styles["sub-field"]}>
                <label>Ratio One Movement</label>
                <NumberInput
                  value={pieceData.ratio_one_movement || ""}
                  onChange={(val) => handleNumberChange("ratio_one_movement", val || "")}
                  options={{ placeholder: "e.g., 2", className: styles["form-input-small"] }}
                />
              </div>
              <div className={styles["sub-field"]}>
                <label>Ratio Two Movement</label>
                <NumberInput
                  value={pieceData.ratio_two_movement || ""}
                  onChange={(val) => handleNumberChange("ratio_two_movement", val || "")}
                  options={{ placeholder: "e.g., 1", className: styles["form-input-small"] }}
                />
              </div>
            </div>
            <p className={styles["field-hint"]}>
              Example: Knight moves 2-1 (2 squares in one direction, 1 in perpendicular)
            </p>
            <label className={styles["checkbox-label"]}>
              <input
                type="checkbox"
                checked={pieceData.repeating_ratio}
                onChange={(e) => handleChange("repeating_ratio", e.target.checked)}
              />
              <span>Can repeat ratio movement</span>
            </label>
          </div>
        )}
      </div>

      {/* Step by Step Movement */}
      <div className={styles["condition-section"]}>
        <h3>Step-by-Step Movement</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="step_by_step_movement_style"
              value="true"
              checked={pieceData.step_by_step_movement_style === true}
              onChange={(e) => handleBooleanChange("step_by_step_movement_style", e.target.value)}
            />
            <span>Enable step-by-step movement</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="step_by_step_movement_style"
              value="false"
              checked={pieceData.step_by_step_movement_style === false}
              onChange={(e) => handleBooleanChange("step_by_step_movement_style", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>

        {pieceData.step_by_step_movement_style && (
          <div className={styles["sub-field"]}>
            <label>Maximum Steps</label>
            <NumberInput
              value={Math.abs(pieceData.step_by_step_movement_value || 0) || ""}
              onChange={(val) => {
                const noDiagonal = document.getElementById("step_by_step_no_diagonal")?.checked;
                handleNumberChange("step_by_step_movement_value", noDiagonal ? -Math.abs(val || 0) : Math.abs(val || 0));
              }}
              options={{ min: 1, placeholder: "Total squares piece can move", className: styles["form-input-small"] }}
            />
            <div className={styles["checkbox-row"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  id="step_by_step_no_diagonal"
                  checked={pieceData.step_by_step_movement_value < 0}
                  onChange={(e) => {
                    const absValue = Math.abs(pieceData.step_by_step_movement_value || 0);
                    handleNumberChange("step_by_step_movement_value", e.target.checked ? -absValue : absValue);
                  }}
                />
                <span>Exclude diagonal movement</span>
              </label>
            </div>
            <p className={styles["field-hint"]}>
              Piece can move up to this many steps, where each step can be in any direction (like a king). 
              {pieceData.step_by_step_movement_value < 0 
                ? " Diagonal movement excluded - only cardinal directions allowed." 
                : " Can combine diagonal and straight moves."}
            </p>
          </div>
        )}
      </div>

      {/* Hopping */}
      <div className={styles["condition-section"]}>
        <h3>Hopping Ability</h3>
        {(() => {
          const hasRatioMovement = pieceData.ratio_movement_style;
          const hasExactDirectional = pieceData.directional_movement_style && [
            pieceData.up_left_movement,
            pieceData.up_movement,
            pieceData.up_right_movement,
            pieceData.left_movement,
            pieceData.right_movement,
            pieceData.down_left_movement,
            pieceData.down_movement,
            pieceData.down_right_movement
          ].some(val => val < 0);
          
          const canHop = hasRatioMovement || hasExactDirectional;
          
          return !canHop ? (
            <p className={styles["field-hint"]} style={{ marginBottom: '1rem', color: 'var(--accent-orange)' }}>
              ⚠️ Hopping requires either ratio movement or at least one direction with "Exact" movement enabled.
            </p>
          ) : null;
        })()}
        <label className={styles["checkbox-label"]}>
          <input
            type="checkbox"
            checked={pieceData.can_hop_over_allies}
            onChange={(e) => handleChange("can_hop_over_allies", e.target.checked)}
            disabled={!pieceData.ratio_movement_style && !(pieceData.directional_movement_style && [
              pieceData.up_left_movement,
              pieceData.up_movement,
              pieceData.up_right_movement,
              pieceData.left_movement,
              pieceData.right_movement,
              pieceData.down_left_movement,
              pieceData.down_movement,
              pieceData.down_right_movement
            ].some(val => val < 0))}
          />
          <span>Can hop over allied pieces</span>
        </label>
        <label className={styles["checkbox-label"]}>
          <input
            type="checkbox"
            checked={pieceData.can_hop_over_enemies}
            onChange={(e) => handleChange("can_hop_over_enemies", e.target.checked)}
            disabled={!pieceData.ratio_movement_style && !(pieceData.directional_movement_style && [
              pieceData.up_left_movement,
              pieceData.up_movement,
              pieceData.up_right_movement,
              pieceData.left_movement,
              pieceData.right_movement,
              pieceData.down_left_movement,
              pieceData.down_movement,
              pieceData.down_right_movement
            ].some(val => val < 0))}
          />
          <span>Can hop over enemy pieces</span>
        </label>
      </div>

      {/* Live Preview */}
      <div className={styles["board-preview-section"]}>
        <h3>Movement Preview</h3>
        <PieceBoardPreview pieceData={pieceData} showAttack={false} />
      </div>
    </div>
  );
};

export default PieceStep2Movement;
