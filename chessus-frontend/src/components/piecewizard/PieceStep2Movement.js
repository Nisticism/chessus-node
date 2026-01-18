import React from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";

const PieceStep2Movement = ({ pieceData, updatePieceData }) => {
  const handleChange = (field, value) => {
    updatePieceData({ [field]: value });
  };

  const handleBooleanChange = (field, value) => {
    updatePieceData({ [field]: value === "true" });
  };

  const handleNumberChange = (field, value) => {
    const numValue = value === "" ? null : parseInt(value);
    updatePieceData({ [field]: numValue });
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Movement Configuration</h2>
      <p className={styles["step-description"]}>
        Define how your piece moves on the board. Values: 0 = cannot move, positive = up to that many squares, negative = exactly that many squares (check "Exact"), 99 = infinite (check "Infinite").
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
                <input
                  type="number"
                  value={pieceData.up_left_movement === 99 ? "" : Math.abs(pieceData.up_left_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.up_left_movement < 0 && pieceData.up_left_movement !== 99;
                    handleChange("up_left_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.up_left_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.up_left_movement < 0 && pieceData.up_left_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.up_left_movement || 0);
                      handleChange("up_left_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.up_left_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.up_left_movement === 99}
                    onChange={(e) => handleChange("up_left_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
              <div className={styles["direction-input"]}>
                <label>↑ Up</label>
                <input
                  type="number"
                  value={pieceData.up_movement === 99 ? "" : Math.abs(pieceData.up_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.up_movement < 0 && pieceData.up_movement !== 99;
                    handleChange("up_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.up_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.up_movement < 0 && pieceData.up_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.up_movement || 0);
                      handleChange("up_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.up_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.up_movement === 99}
                    onChange={(e) => handleChange("up_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
              <div className={styles["direction-input"]}>
                <label>↗ Up-Right</label>
                <input
                  type="number"
                  value={pieceData.up_right_movement === 99 ? "" : Math.abs(pieceData.up_right_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.up_right_movement < 0 && pieceData.up_right_movement !== 99;
                    handleChange("up_right_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.up_right_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.up_right_movement < 0 && pieceData.up_right_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.up_right_movement || 0);
                      handleChange("up_right_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.up_right_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.up_right_movement === 99}
                    onChange={(e) => handleChange("up_right_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
            </div>
            <div className={styles["direction-row"]}>
              <div className={styles["direction-input"]}>
                <label>← Left</label>
                <input
                  type="number"
                  value={pieceData.left_movement === 99 ? "" : Math.abs(pieceData.left_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.left_movement < 0 && pieceData.left_movement !== 99;
                    handleChange("left_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.left_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.left_movement < 0 && pieceData.left_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.left_movement || 0);
                      handleChange("left_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.left_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.left_movement === 99}
                    onChange={(e) => handleChange("left_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
              <div className={styles["direction-center"]}>
                <div className={styles["center-piece"]}>
                  {pieceData.piece_image_preview ? (
                    <img src={pieceData.piece_image_preview} alt="Piece" />
                  ) : (
                    "?"
                  )}
                </div>
              </div>
              <div className={styles["direction-input"]}>
                <label>→ Right</label>
                <input
                  type="number"
                  value={pieceData.right_movement === 99 ? "" : Math.abs(pieceData.right_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.right_movement < 0 && pieceData.right_movement !== 99;
                    handleChange("right_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.right_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.right_movement < 0 && pieceData.right_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.right_movement || 0);
                      handleChange("right_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.right_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.right_movement === 99}
                    onChange={(e) => handleChange("right_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
            </div>
            <div className={styles["direction-row"]}>
              <div className={styles["direction-input"]}>
                <label>↙ Down-Left</label>
                <input
                  type="number"
                  value={pieceData.down_left_movement === 99 ? "" : Math.abs(pieceData.down_left_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.down_left_movement < 0 && pieceData.down_left_movement !== 99;
                    handleChange("down_left_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.down_left_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.down_left_movement < 0 && pieceData.down_left_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.down_left_movement || 0);
                      handleChange("down_left_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.down_left_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.down_left_movement === 99}
                    onChange={(e) => handleChange("down_left_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
              <div className={styles["direction-input"]}>
                <label>↓ Down</label>
                <input
                  type="number"
                  value={pieceData.down_movement === 99 ? "" : Math.abs(pieceData.down_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.down_movement < 0 && pieceData.down_movement !== 99;
                    handleChange("down_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.down_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.down_movement < 0 && pieceData.down_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.down_movement || 0);
                      handleChange("down_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.down_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.down_movement === 99}
                    onChange={(e) => handleChange("down_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
              <div className={styles["direction-input"]}>
                <label>↘ Down-Right</label>
                <input
                  type="number"
                  value={pieceData.down_right_movement === 99 ? "" : Math.abs(pieceData.down_right_movement || 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    const isExact = pieceData.down_right_movement < 0 && pieceData.down_right_movement !== 99;
                    handleChange("down_right_movement", isExact ? -val : val);
                  }}
                  disabled={pieceData.down_right_movement === 99}
                />
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.down_right_movement < 0 && pieceData.down_right_movement !== 99}
                    onChange={(e) => {
                      const val = Math.abs(pieceData.down_right_movement || 0);
                      handleChange("down_right_movement", e.target.checked ? -val : val);
                    }}
                    disabled={pieceData.down_right_movement === 99}
                  />
                  <span>Exact</span>
                </label>
                <label className={styles["checkbox-label-inline"]}>
                  <input
                    type="checkbox"
                    checked={pieceData.down_right_movement === 99}
                    onChange={(e) => handleChange("down_right_movement", e.target.checked ? 99 : 0)}
                  />
                  <span>Infinite</span>
                </label>
              </div>
            </div>
            
            <div className={styles["sub-field"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={pieceData.repeating_movement}
                  onChange={(e) => handleChange("repeating_movement", e.target.checked)}
                />
                <span>Repeating movement (can move multiple times)</span>
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
                <input
                  type="number"
                  className={styles["form-input-small"]}
                  value={pieceData.ratio_one_movement || ""}
                  onChange={(e) => handleNumberChange("ratio_one_movement", e.target.value)}
                  placeholder="e.g., 2"
                />
              </div>
              <div className={styles["sub-field"]}>
                <label>Ratio Two Movement</label>
                <input
                  type="number"
                  className={styles["form-input-small"]}
                  value={pieceData.ratio_two_movement || ""}
                  onChange={(e) => handleNumberChange("ratio_two_movement", e.target.value)}
                  placeholder="e.g., 1"
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
            <input
              type="number"
              className={styles["form-input-small"]}
              value={Math.abs(pieceData.step_by_step_movement_value || 0) || ""}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 0;
                // Store as negative if diagonal is excluded
                const noDiagonal = document.getElementById("step_by_step_no_diagonal")?.checked;
                handleNumberChange("step_by_step_movement_value", noDiagonal ? -Math.abs(value) : Math.abs(value));
              }}
              placeholder="Total squares piece can move"
              min="1"
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
        <PieceBoardPreview pieceData={pieceData} />
      </div>
    </div>
  );
};

export default PieceStep2Movement;
