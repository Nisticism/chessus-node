import React from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";

const PieceStep3Attack = ({ pieceData, updatePieceData }) => {
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

  const handleAttackLikeMovement = (checked) => {
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
        ratio_one_capture: pieceData.ratio_one,
        ratio_two_capture: pieceData.ratio_two,
        // Copy step-by-step
        step_by_step_capture: pieceData.step_by_step_movement,
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
        Define how your piece captures and attacks. Pieces can capture by moving (like most chess pieces) or attack from range without moving (like a cannon). Values: 0 = cannot, positive = up to that many squares, negative = exactly that many squares, 99 = infinite.
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
              <input
                type="number"
                className={styles["form-input-small"]}
                value={pieceData.max_captures_per_move === -1 ? "" : (pieceData.max_captures_per_move || 1)}
                onChange={(e) => handleNumberChange("max_captures_per_move", e.target.value)}
                placeholder="1"
                min="1"
                disabled={pieceData.max_captures_per_move === -1}
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
                  Define capture range in each direction. 0 = no capture, positive = up to, negative = exactly, 99 = infinite
                </p>
                
                <div className={styles["directional-grid"]}>
                  <div className={styles["direction-row"]}>
                    {/* Up-Left */}
                    <div className={styles["direction-input"]}>
                      <label>↖ Up-Left</label>
                      <input
                        type="number"
                        value={pieceData.up_left_capture === 99 ? "" : Math.abs(pieceData.up_left_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.up_left_capture < 0 && pieceData.up_left_capture !== 99;
                          handleChange("up_left_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.up_left_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.up_left_capture < 0 && pieceData.up_left_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.up_left_capture || 0);
                            handleChange("up_left_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.up_left_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.up_left_capture === 99}
                          onChange={(e) => handleChange("up_left_capture", e.target.checked ? 99 : 0)}
                        />
                        <span>Infinite</span>
                      </label>
                    </div>
                    
                    {/* Up */}
                    <div className={styles["direction-input"]}>
                      <label>↑ Up</label>
                      <input
                        type="number"
                        value={pieceData.up_capture === 99 ? "" : Math.abs(pieceData.up_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.up_capture < 0 && pieceData.up_capture !== 99;
                          handleChange("up_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.up_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.up_capture < 0 && pieceData.up_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.up_capture || 0);
                            handleChange("up_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.up_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.up_capture === 99}
                          onChange={(e) => handleChange("up_capture", e.target.checked ? 99 : 0)}
                        />
                        <span>Infinite</span>
                      </label>
                    </div>
                    
                    {/* Up-Right */}
                    <div className={styles["direction-input"]}>
                      <label>↗ Up-Right</label>
                      <input
                        type="number"
                        value={pieceData.up_right_capture === 99 ? "" : Math.abs(pieceData.up_right_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.up_right_capture < 0 && pieceData.up_right_capture !== 99;
                          handleChange("up_right_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.up_right_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.up_right_capture < 0 && pieceData.up_right_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.up_right_capture || 0);
                            handleChange("up_right_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.up_right_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.up_right_capture === 99}
                          onChange={(e) => handleChange("up_right_capture", e.target.checked ? 99 : 0)}
                        />
                        <span>Infinite</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className={styles["direction-row"]}>
                    {/* Left */}
                    <div className={styles["direction-input"]}>
                      <label>← Left</label>
                      <input
                        type="number"
                        value={pieceData.left_capture === 99 ? "" : Math.abs(pieceData.left_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.left_capture < 0 && pieceData.left_capture !== 99;
                          handleChange("left_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.left_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.left_capture < 0 && pieceData.left_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.left_capture || 0);
                            handleChange("left_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.left_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.left_capture === 99}
                          onChange={(e) => handleChange("left_capture", e.target.checked ? 99 : 0)}
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
                          "♟"
                        )}
                      </div>
                    </div>
                    
                    {/* Right */}
                    <div className={styles["direction-input"]}>
                      <label>→ Right</label>
                      <input
                        type="number"
                        value={pieceData.right_capture === 99 ? "" : Math.abs(pieceData.right_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.right_capture < 0 && pieceData.right_capture !== 99;
                          handleChange("right_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.right_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.right_capture < 0 && pieceData.right_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.right_capture || 0);
                            handleChange("right_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.right_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.right_capture === 99}
                          onChange={(e) => handleChange("right_capture", e.target.checked ? 99 : 0)}
                        />
                        <span>Infinite</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className={styles["direction-row"]}>
                    {/* Down-Left */}
                    <div className={styles["direction-input"]}>
                      <label>↙ Down-Left</label>
                      <input
                        type="number"
                        value={pieceData.down_left_capture === 99 ? "" : Math.abs(pieceData.down_left_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.down_left_capture < 0 && pieceData.down_left_capture !== 99;
                          handleChange("down_left_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.down_left_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.down_left_capture < 0 && pieceData.down_left_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.down_left_capture || 0);
                            handleChange("down_left_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.down_left_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.down_left_capture === 99}
                          onChange={(e) => handleChange("down_left_capture", e.target.checked ? 99 : 0)}
                        />
                        <span>Infinite</span>
                      </label>
                    </div>
                    
                    {/* Down */}
                    <div className={styles["direction-input"]}>
                      <label>↓ Down</label>
                      <input
                        type="number"
                        value={pieceData.down_capture === 99 ? "" : Math.abs(pieceData.down_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.down_capture < 0 && pieceData.down_capture !== 99;
                          handleChange("down_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.down_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.down_capture < 0 && pieceData.down_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.down_capture || 0);
                            handleChange("down_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.down_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.down_capture === 99}
                          onChange={(e) => handleChange("down_capture", e.target.checked ? 99 : 0)}
                        />
                        <span>Infinite</span>
                      </label>
                    </div>
                    
                    {/* Down-Right */}
                    <div className={styles["direction-input"]}>
                      <label>↘ Down-Right</label>
                      <input
                        type="number"
                        value={pieceData.down_right_capture === 99 ? "" : Math.abs(pieceData.down_right_capture || 0)}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                          const isExact = pieceData.down_right_capture < 0 && pieceData.down_right_capture !== 99;
                          handleChange("down_right_capture", isExact ? -val : val);
                        }}
                        disabled={pieceData.down_right_capture === 99}
                        placeholder="0"
                      />
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.down_right_capture < 0 && pieceData.down_right_capture !== 99}
                          onChange={(e) => {
                            const val = Math.abs(pieceData.down_right_capture || 0);
                            handleChange("down_right_capture", e.target.checked ? -val : val);
                          }}
                          disabled={pieceData.down_right_capture === 99}
                        />
                        <span>Exact</span>
                      </label>
                      <label className={styles["checkbox-label-inline"]}>
                        <input
                          type="checkbox"
                          checked={pieceData.down_right_capture === 99}
                          onChange={(e) => handleChange("down_right_capture", e.target.checked ? 99 : 0)}
                        />
                        <span>Infinite</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Ratio Capture (Knight-like) */}
            {!pieceData.attacks_like_movement && (
              <div className={styles["sub-field"]}>
                <h4>Ratio Capture Movement (L-shape)</h4>
                <div className={styles["form-row"]}>
                  <div className={styles["form-group"]}>
                    <label>Ratio One</label>
                    <input
                      type="number"
                      className={styles["form-input-small"]}
                      value={pieceData.ratio_one_capture || ""}
                      onChange={(e) => handleNumberChange("ratio_one_capture", e.target.value)}
                      placeholder="e.g., 2"
                    />
                  </div>
                  <div className={styles["form-group"]}>
                    <label>Ratio Two</label>
                    <input
                      type="number"
                      className={styles["form-input-small"]}
                      value={pieceData.ratio_two_capture || ""}
                      onChange={(e) => handleNumberChange("ratio_two_capture", e.target.value)}
                      placeholder="e.g., 1"
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
                <input
                  type="number"
                  className={styles["form-input-small"]}
                  value={pieceData.step_by_step_capture || ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? null : parseInt(e.target.value);
                    // Positive values include diagonal, negative exclude diagonal
                    const currentIsNoDiagonal = pieceData.step_by_step_capture < 0;
                    handleChange("step_by_step_capture", currentIsNoDiagonal && val ? -val : val);
                  }}
                  placeholder="Leave empty to disable"
                  min="0"
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
              <input
                type="number"
                className={styles["form-input-small"]}
                value={pieceData.max_captures_via_ranged_attack === -1 ? "" : (pieceData.max_captures_via_ranged_attack || 1)}
                onChange={(e) => handleNumberChange("max_captures_via_ranged_attack", e.target.value)}
                placeholder="1"
                min="1"
                disabled={pieceData.max_captures_via_ranged_attack === -1}
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
                Set ranged attack range in each direction. 0 = no attack, positive = up to, negative = exactly, 99 = infinite
              </p>
              
              <div className={styles["directional-grid"]}>
                <div className={styles["direction-row"]}>
                  {/* Up-Left */}
                  <div className={styles["direction-input"]}>
                    <label>↖ Up-Left</label>
                    <input
                      type="number"
                      value={pieceData.up_left_attack_range === 99 ? "" : Math.abs(pieceData.up_left_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.up_left_attack_range < 0 && pieceData.up_left_attack_range !== 99;
                        handleChange("up_left_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.up_left_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.up_left_attack_range < 0 && pieceData.up_left_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.up_left_attack_range || 0);
                          handleChange("up_left_attack_range", e.target.checked ? -val : val);
                        }}
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
                    <input
                      type="number"
                      value={pieceData.up_attack_range === 99 ? "" : Math.abs(pieceData.up_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.up_attack_range < 0 && pieceData.up_attack_range !== 99;
                        handleChange("up_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.up_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.up_attack_range < 0 && pieceData.up_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.up_attack_range || 0);
                          handleChange("up_attack_range", e.target.checked ? -val : val);
                        }}
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
                    <input
                      type="number"
                      value={pieceData.up_right_attack_range === 99 ? "" : Math.abs(pieceData.up_right_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.up_right_attack_range < 0 && pieceData.up_right_attack_range !== 99;
                        handleChange("up_right_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.up_right_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.up_right_attack_range < 0 && pieceData.up_right_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.up_right_attack_range || 0);
                          handleChange("up_right_attack_range", e.target.checked ? -val : val);
                        }}
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
                    <input
                      type="number"
                      value={pieceData.left_attack_range === 99 ? "" : Math.abs(pieceData.left_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.left_attack_range < 0 && pieceData.left_attack_range !== 99;
                        handleChange("left_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.left_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.left_attack_range < 0 && pieceData.left_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.left_attack_range || 0);
                          handleChange("left_attack_range", e.target.checked ? -val : val);
                        }}
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
                    <input
                      type="number"
                      value={pieceData.right_attack_range === 99 ? "" : Math.abs(pieceData.right_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.right_attack_range < 0 && pieceData.right_attack_range !== 99;
                        handleChange("right_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.right_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.right_attack_range < 0 && pieceData.right_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.right_attack_range || 0);
                          handleChange("right_attack_range", e.target.checked ? -val : val);
                        }}
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
                    <input
                      type="number"
                      value={pieceData.down_left_attack_range === 99 ? "" : Math.abs(pieceData.down_left_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.down_left_attack_range < 0 && pieceData.down_left_attack_range !== 99;
                        handleChange("down_left_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.down_left_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.down_left_attack_range < 0 && pieceData.down_left_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.down_left_attack_range || 0);
                          handleChange("down_left_attack_range", e.target.checked ? -val : val);
                        }}
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
                    <input
                      type="number"
                      value={pieceData.down_attack_range === 99 ? "" : Math.abs(pieceData.down_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.down_attack_range < 0 && pieceData.down_attack_range !== 99;
                        handleChange("down_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.down_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.down_attack_range < 0 && pieceData.down_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.down_attack_range || 0);
                          handleChange("down_attack_range", e.target.checked ? -val : val);
                        }}
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
                    <input
                      type="number"
                      value={pieceData.down_right_attack_range === 99 ? "" : Math.abs(pieceData.down_right_attack_range || 0)}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                        const isExact = pieceData.down_right_attack_range < 0 && pieceData.down_right_attack_range !== 99;
                        handleChange("down_right_attack_range", isExact ? -val : val);
                      }}
                      disabled={pieceData.down_right_attack_range === 99}
                      placeholder="0"
                    />
                    <label className={styles["checkbox-label-inline"]}>
                      <input
                        type="checkbox"
                        checked={pieceData.down_right_attack_range < 0 && pieceData.down_right_attack_range !== 99}
                        onChange={(e) => {
                          const val = Math.abs(pieceData.down_right_attack_range || 0);
                          handleChange("down_right_attack_range", e.target.checked ? -val : val);
                        }}
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
                  <input
                    type="number"
                    className={styles["form-input-small"]}
                    value={pieceData.ratio_one_attack_range || ""}
                    onChange={(e) => handleNumberChange("ratio_one_attack_range", e.target.value)}
                    placeholder="e.g., 2"
                  />
                </div>
                <div className={styles["form-group"]}>
                  <label>Ratio Two Attack Range</label>
                  <input
                    type="number"
                    className={styles["form-input-small"]}
                    value={pieceData.ratio_two_attack_range || ""}
                    onChange={(e) => handleNumberChange("ratio_two_attack_range", e.target.value)}
                    placeholder="e.g., 1"
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
              <input
                type="number"
                className={styles["form-input-small"]}
                value={pieceData.step_by_step_attack_range === 0 ? "" : Math.abs(pieceData.step_by_step_attack_range || "")}
                onChange={(e) => {
                  const val = e.target.value === "" ? null : parseInt(e.target.value);
                  // Positive values include diagonal, negative exclude diagonal
                  const currentIsNoDiagonal = pieceData.step_by_step_attack_range < 0;
                  handleChange("step_by_step_attack_range", currentIsNoDiagonal && val ? -val : val);
                }}
                placeholder="Leave empty to disable"
                min="0"
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
