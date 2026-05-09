import React from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";
import CustomSquareSelector from "./CustomSquareSelector";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "./InfoTooltip";
import ToggleSwitch from "../common/ToggleSwitch";
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

  // Step-by-step movement is capped at 8 because the custom-square selector
  // grid is 15x15 (radius 7). At step value 7+ the grid is fully covered, so
  // we disable adding custom squares to avoid lag and confusing UX.
  const MAX_STEP_BY_STEP = 8;
  const STEP_DISABLES_CUSTOM = 7;
  const stepMoveAbs = Math.abs(pieceData.step_by_step_movement_value || 0);
  const customMovementDisabled = stepMoveAbs >= STEP_DISABLES_CUSTOM;
  const customMovementDisabledMessage = customMovementDisabled
    ? `Custom square movement cannot be expanded while step-by-step movement is ${stepMoveAbs} or higher (it already covers the grid). Reduce step-by-step movement below ${STEP_DISABLES_CUSTOM} to add more squares.`
    : "";

  // Parse additional movements from special_scenario_moves JSON
  const getAdditionalMovements = () => {
    if (!pieceData.special_scenario_moves) return {};
    try {
      const parsed = typeof pieceData.special_scenario_moves === 'string' 
        ? JSON.parse(pieceData.special_scenario_moves)
        : pieceData.special_scenario_moves;
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
    if (additionalMovements[direction].length >= 2) return; // Max 2 alternates per direction
    additionalMovements[direction].push({
      value: 1,
      exact: false,
      infinite: false,
      firstMoveOnly: false
    });
    
    const scenarioData = pieceData.special_scenario_moves 
      ? (typeof pieceData.special_scenario_moves === 'string' 
          ? JSON.parse(pieceData.special_scenario_moves)
          : pieceData.special_scenario_moves)
      : {};
    
    scenarioData.additionalMovements = additionalMovements;
    updatePieceData({ special_scenario_moves: JSON.stringify(scenarioData) });
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
      
      const scenarioData = pieceData.special_scenario_moves 
        ? (typeof pieceData.special_scenario_moves === 'string' 
            ? JSON.parse(pieceData.special_scenario_moves)
            : pieceData.special_scenario_moves)
        : {};
      
      scenarioData.additionalMovements = additionalMovements;
      updatePieceData({ special_scenario_moves: JSON.stringify(scenarioData) });
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
      
      const scenarioData = pieceData.special_scenario_moves 
        ? (typeof pieceData.special_scenario_moves === 'string' 
            ? JSON.parse(pieceData.special_scenario_moves)
            : pieceData.special_scenario_moves)
        : {};
      
      scenarioData.additionalMovements = additionalMovements;
      updatePieceData({ special_scenario_moves: JSON.stringify(scenarioData) });
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
                <ToggleSwitch inline size="small"
                  checked={movement.exact}
                  onChange={(v) => updateAdditionalMovement(direction, index, 'exact', v)}
                  label="Exact"
                  disabled={movement.infinite}
                />
              </div>
              <div className={styles["additional-movement-line"]}>
                <ToggleSwitch inline size="small"
                  checked={movement.infinite}
                  onChange={(v) => updateAdditionalMovement(direction, index, 'infinite', v)}
                  label="Infinite"
                />
              </div>
              <div className={styles["additional-movement-line"]}>
                <ToggleSwitch inline size="small"
                  checked={!!movement.availableForMoves}
                  onChange={(v) => {
                    if (v) {
                      updateAdditionalMovement(direction, index, 'availableForMoves', 1);
                    } else {
                      updateAdditionalMovement(direction, index, 'availableForMoves', null);
                    }
                  }}
                  label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                />
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
          disabled={movements.length >= 2}
          title={movements.length >= 2 ? "Maximum of 2 alternate movements per direction" : undefined}
        >
          + Add Alternative Movement{movements.length >= 2 ? " (max reached)" : ""}
        </button>
      </div>
    );
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Movement Configuration</h2>
      <p className={styles["step-description"]}>
        Define how your piece moves on the board.
      </p>

      {/* Directional Movement */}
      <div className={styles["condition-section"]}>
        <h3>Directional Movement <InfoTooltip text="Configure per-direction movement. Set the number of squares (0 = disabled). 'Exact' means the piece must move exactly that distance (can't stop short). 'Infinite' means unlimited range in that direction. 'First N moves only' limits that direction to the piece's first N moves, then it becomes unavailable. You can add alternative movements per direction for different distances." /></h3>
        <ToggleSwitch
          checked={pieceData.directional_movement_style === true}
          onChange={(v) => handleBooleanChange("directional_movement_style", v ? "true" : "false")}
          label="Enable directional movement"
        />

        {pieceData.directional_movement_style && (
          <div className={styles["directional-grid"]}>
            <div className={styles["direction-row"]}>
              <div className={styles["direction-input"]}>
                <label>↖ Up-Left</label>
                <NumberInput
                    value={pieceData.up_left_movement === 99 ? "∞" : (pieceData.up_left_movement || 0)}
                    onChange={(val) => handleChange("up_left_movement", val)}
                    options={{ disabled: pieceData.up_left_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.up_left_movement_exact}
                  onChange={(v) => handleChange("up_left_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.up_left_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.up_left_movement === 99}
                  onChange={(v) => handleChange("up_left_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.up_left_movement_available_for}
                    onChange={(v) => handleChange("up_left_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
                <NumberInput
                    value={pieceData.up_movement === 99 ? "∞" : (pieceData.up_movement || 0)}
                    onChange={(val) => handleChange("up_movement", val)}
                    options={{ disabled: pieceData.up_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.up_movement_exact}
                  onChange={(v) => handleChange("up_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.up_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.up_movement === 99}
                  onChange={(v) => handleChange("up_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.up_movement_available_for}
                    onChange={(v) => handleChange("up_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
                <NumberInput
                    value={pieceData.up_right_movement === 99 ? "∞" : (pieceData.up_right_movement || 0)}
                    onChange={(val) => handleChange("up_right_movement", val)}
                    options={{ disabled: pieceData.up_right_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.up_right_movement_exact}
                  onChange={(v) => handleChange("up_right_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.up_right_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.up_right_movement === 99}
                  onChange={(v) => handleChange("up_right_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.up_right_movement_available_for}
                    onChange={(v) => handleChange("up_right_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
                <NumberInput
                    value={pieceData.left_movement === 99 ? "∞" : (pieceData.left_movement || 0)}
                    onChange={(val) => handleChange("left_movement", val)}
                    options={{ disabled: pieceData.left_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.left_movement_exact}
                  onChange={(v) => handleChange("left_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.left_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.left_movement === 99}
                  onChange={(v) => handleChange("left_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.left_movement_available_for}
                    onChange={(v) => handleChange("left_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
                <NumberInput
                    value={pieceData.right_movement === 99 ? "∞" : (pieceData.right_movement || 0)}
                    onChange={(val) => handleChange("right_movement", val)}
                    options={{ disabled: pieceData.right_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.right_movement_exact}
                  onChange={(v) => handleChange("right_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.right_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.right_movement === 99}
                  onChange={(v) => handleChange("right_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.right_movement_available_for}
                    onChange={(v) => handleChange("right_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
                <NumberInput
                    value={pieceData.down_left_movement === 99 ? "∞" : (pieceData.down_left_movement || 0)}
                    onChange={(val) => handleChange("down_left_movement", val)}
                    options={{ disabled: pieceData.down_left_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.down_left_movement_exact}
                  onChange={(v) => handleChange("down_left_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.down_left_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.down_left_movement === 99}
                  onChange={(v) => handleChange("down_left_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.down_left_movement_available_for}
                    onChange={(v) => handleChange("down_left_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
                <NumberInput
                    value={pieceData.down_movement === 99 ? "∞" : (pieceData.down_movement || 0)}
                    onChange={(val) => handleChange("down_movement", val)}
                    options={{ disabled: pieceData.down_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.down_movement_exact}
                  onChange={(v) => handleChange("down_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.down_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.down_movement === 99}
                  onChange={(v) => handleChange("down_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.down_movement_available_for}
                    onChange={(v) => handleChange("down_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
                <NumberInput
                    value={pieceData.down_right_movement === 99 ? "∞" : (pieceData.down_right_movement || 0)}
                    onChange={(val) => handleChange("down_right_movement", val)}
                    options={{ disabled: pieceData.down_right_movement === 99 }}
                  />
                <ToggleSwitch inline size="small"
                  checked={!!pieceData.down_right_movement_exact}
                  onChange={(v) => handleChange("down_right_movement_exact", v)}
                  label="Exact"
                  disabled={pieceData.down_right_movement === 99}
                />
                <ToggleSwitch inline size="small"
                  checked={pieceData.down_right_movement === 99}
                  onChange={(v) => handleChange("down_right_movement", v ? 99 : 0)}
                  label="Infinite"
                />
                <div className={styles["available-for-moves-group"]}>
                  <ToggleSwitch inline size="small"
                    checked={!!pieceData.down_right_movement_available_for}
                    onChange={(v) => handleChange("down_right_movement_available_for", v ? 1 : null)}
                    label={PIECE_WIZARD_TEXT.AVAILABLE_FOR_FIRST_MOVES}
                  />
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
              <ToggleSwitch
                checked={pieceData.repeating_movement}
                onChange={(v) => handleChange("repeating_movement", v)}
                label="Repeating exact movement"
                tooltip={<InfoTooltip text="When enabled with exact movements, the piece can repeat its exact distance pattern infinitely along that direction, landing on every Nth square. For example, a piece with Exact 2 could land on squares 2, 4, 6, 8, etc." />}
              />
            </div>
          </div>
        )}
      </div>

      {/* Ratio Movement (Knight-like) */}
      <div className={styles["condition-section"]}>
        <h3>Ratio Movement (L-shape) <InfoTooltip text="L-shaped movement like a chess knight. Set two ratio values — the piece moves the first value in one direction, then the second value perpendicularly. For example, a knight uses 2-1 (2 squares in one direction, then 1 square perpendicular). This movement can jump to the destination directly." /></h3>
          <ToggleSwitch
            checked={pieceData.ratio_movement_style === true}
            onChange={(v) => handleBooleanChange("ratio_movement_style", v ? "true" : "false")}
            label="Enable ratio movement"
          />

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
            <ToggleSwitch
              checked={pieceData.repeating_ratio}
              onChange={(v) => handleChange("repeating_ratio", v)}
              label="Repeating ratio"
              tooltip={<InfoTooltip text="When enabled, the piece can repeat its L-shaped jump multiple times in the same direction in a single move (e.g., a 2-1 knight could land at 2-1, 4-2, 6-3, etc.)." />}
            />
            {pieceData.repeating_ratio && (
              <div className={styles["sub-option"]} style={{ marginLeft: '24px', marginTop: '8px' }}>
                <ToggleSwitch
                  checked={pieceData.max_ratio_iterations === -1}
                  onChange={(v) => handleChange("max_ratio_iterations", v ? -1 : 1)}
                  label="Infinite"
                  tooltip={<InfoTooltip text="Allow unlimited ratio iterations in a single move." />}
                />
                {pieceData.max_ratio_iterations !== -1 && (
                  <div style={{ marginTop: '8px' }}>
                    <label style={{ display: 'block', marginBottom: '4px' }}>Max Iterations</label>
                    <NumberInput
                      value={pieceData.max_ratio_iterations || 1}
                      onChange={(val) => handleChange("max_ratio_iterations", val)}
                      min={1}
                      max={50}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step by Step Movement */}
      <div className={styles["condition-section"]}>
        <h3>Step-by-Step Movement <InfoTooltip text="The piece gets a budget of steps and can move one square at a time in any direction, changing direction with each step. Like a king that can take multiple steps per turn. Set the max steps (1–8) and optionally exclude diagonal steps. Values of 7 or higher will disable additional custom-square movement because the step area already covers the entire 15×15 custom-square grid." /></h3>
          <ToggleSwitch
            checked={pieceData.step_by_step_movement_style === true}
            onChange={(v) => handleBooleanChange("step_by_step_movement_style", v ? "true" : "false")}
            label="Enable step-by-step movement"
          />

        {pieceData.step_by_step_movement_style && (
          <div className={styles["sub-field"]}>
            <label>Maximum Steps (1–{MAX_STEP_BY_STEP})</label>
            <NumberInput
              value={Math.abs(pieceData.step_by_step_movement_value || 0) || ""}
              onChange={(val) => {
                const noDiagonal = pieceData.step_by_step_movement_value < 0;
                const clamped = Math.min(MAX_STEP_BY_STEP, Math.max(0, Math.abs(val || 0)));
                handleNumberChange("step_by_step_movement_value", noDiagonal ? -clamped : clamped);
              }}
              options={{ min: 1, max: MAX_STEP_BY_STEP, placeholder: `Total squares piece can move (max ${MAX_STEP_BY_STEP})`, className: styles["form-input-small"] }}
            />
            <div className={styles["checkbox-row"]}>
              <ToggleSwitch
                checked={pieceData.step_by_step_movement_value < 0}
                onChange={(v) => {
                  const absValue = Math.abs(pieceData.step_by_step_movement_value || 0);
                  handleNumberChange("step_by_step_movement_value", v ? -absValue : absValue);
                }}
                label="Exclude diagonal movement"
              />
            </div>

          </div>
        )}
      </div>

      {/* Hopping */}
      <div className={styles["condition-section"]}>
        <h3>Hopping Ability <InfoTooltip text="Controls whether this piece can hop over other pieces during movement — it jumps over a piece in its path and lands on the square beyond. This does NOT capture the hopped-over piece by itself. For checkers-style 'capture on hop' (where hopping over an enemy captures it), see Step 3: Checkers-style Capture." /></h3>
        <ToggleSwitch
          checked={pieceData.can_hop_over_allies}
          onChange={(v) => handleChange("can_hop_over_allies", v)}
          label="Can hop over allied pieces"
        />
        <ToggleSwitch
          checked={pieceData.can_hop_over_enemies}
          onChange={(v) => handleChange("can_hop_over_enemies", v)}
          label="Can hop over enemy pieces"
        />
        {(pieceData.can_hop_over_allies || pieceData.can_hop_over_enemies) && (
          <ToggleSwitch
            checked={pieceData.exact_ratio_hop_only}
            onChange={(v) => handleChange("exact_ratio_hop_only", v)}
            label="Require hopping for exact and ratio movement/attacks"
            tooltip={<InfoTooltip text="When enabled, any movement or attack that uses exact distance or ratio (L-shape) patterns will only work when the piece is actually hopping over another piece in its path. Non-exact (up-to) and step-by-step movement still work normally. Essential for checkers-style pieces that should only jump at their full range when hopping." />}
          />
        )}
        {(pieceData.can_hop_over_allies || pieceData.can_hop_over_enemies) && (
          <ToggleSwitch
            checked={pieceData.directional_hop_disabled}
            onChange={(v) => handleChange("directional_hop_disabled", v)}
            label="Disable hopping for non-exact directional movement"
            tooltip={<InfoTooltip text="When enabled, hopping over pieces is disabled for non-exact directional (sliding) movements like rook or bishop movement. Hopping still works for exact directional movements, ratio (L-shape) movements, and step-by-step movements. Useful for hybrid pieces that should only hop with specific movement styles." />}
          />
        )}
        {(pieceData.can_hop_over_allies && pieceData.can_hop_over_enemies) && pieceData.repeating_ratio && (
          <ToggleSwitch
            checked={pieceData.hop_stop_at_occupied !== false}
            onChange={(v) => handleChange("hop_stop_at_occupied", v)}
            label="Stop repeating hops if an intermediate multiple square is occupied"
            tooltip={<InfoTooltip text="When making repeating ratio (knight-pattern) hops, the piece cannot jump to a further multiple if any earlier multiple in that same direction is occupied by any piece. For example, a 2-1 knight with this enabled cannot reach 4-2 if the 2-1 square is occupied. Enabled by default." />}
          />
        )}
      </div>

      {/* Custom Square Movement */}
      <div className={styles["condition-section"]}>
        <h3>Custom Square Movement <InfoTooltip text="Click squares on the grid to define specific squares this piece can move to, relative to its position. Click or drag to paint squares. The gold center square is the piece's position. This works in addition to any other movement configured above. Limited to 50 squares. If step-by-step movement is set to 7 or higher, additional custom squares cannot be added because the step area already covers the entire grid. Note: custom squares always function as teleporting moves — the piece jumps directly to the target regardless of any pieces in between. If you want movement to be blocked by other pieces, use directional or ratio/exact movement styles above instead." /></h3>
        <CustomSquareSelector
          squares={pieceData.custom_movement_squares}
          onChange={(val) => updatePieceData({ custom_movement_squares: val })}
          color="#4a90d9"
          addDisabled={customMovementDisabled}
          addDisabledMessage={customMovementDisabledMessage}
        />
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
