import React from "react";
import styles from "./gamewizard.module.scss";
import NumberInput from "../common/NumberInput";

const Step2WinConditions = ({ gameData, updateGameData }) => {
  const handleChange = (field, value) => {
    updateGameData({ [field]: value });
  };

  const handleBooleanChange = (field, value) => {
    updateGameData({ [field]: value === "true" });
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Win Conditions</h2>
      <p className={styles["step-description"]}>
        Define how players can win the game. You can enable multiple win conditions.
      </p>

      {/* Mate Condition */}
      <div className={styles["condition-section"]}>
        <h3>Checkmate Condition</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="mate_condition"
              value="true"
              checked={gameData.mate_condition === true}
              onChange={(e) => handleBooleanChange("mate_condition", e.target.value)}
            />
            <span>Enable checkmate win condition</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="mate_condition"
              value="false"
              checked={gameData.mate_condition === false}
              onChange={(e) => handleBooleanChange("mate_condition", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>
        {gameData.mate_condition && (
          <div className={styles["sub-field"]}>
            <p className={styles["field-hint"]} style={{ marginTop: '10px' }}>
              ℹ️ Specific pieces that end the game when checkmated will be configured in Step 4 (Piece Placement).
            </p>
          </div>
        )}
      </div>

      {/* Capture Condition */}
      <div className={styles["condition-section"]}>
        <h3>Capture Condition</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="capture_condition"
              value="true"
              checked={gameData.capture_condition === true}
              onChange={(e) => handleBooleanChange("capture_condition", e.target.value)}
            />
            <span>Enable capture win condition</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="capture_condition"
              value="false"
              checked={gameData.capture_condition === false}
              onChange={(e) => handleBooleanChange("capture_condition", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>
        {gameData.capture_condition && (
          <div className={styles["sub-field"]}>
            <p className={styles["field-hint"]} style={{ marginTop: '10px' }}>
              ℹ️ Specific pieces that end the game when captured will be configured in Step 4 (Piece Placement).
            </p>
          </div>
        )}
      </div>

      {/* Value Condition - Hidden until implemented */}
      {/* TODO: Uncomment when point-based win condition is implemented
      <div className={styles["condition-section"]}>
        <h3>Value/Point Condition</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="value_condition"
              value="true"
              checked={gameData.value_condition === true}
              onChange={(e) => handleBooleanChange("value_condition", e.target.value)}
            />
            <span>Enable point-based win condition</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="value_condition"
              value="false"
              checked={gameData.value_condition === false}
              onChange={(e) => handleBooleanChange("value_condition", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>
        {gameData.value_condition && (
          <div className={styles["sub-fields"]}>
            <div className={styles["sub-field"]}>
              <label className={styles["form-label"]}>Maximum Value/Points to Win</label>
              <NumberInput
                value={gameData.value_max || 0}
                onChange={(val) => handleChange("value_max", val || null)}
                options={{ min: 1, placeholder: "e.g., 100", className: styles["form-input-small"] }}
              />
            </div>
            <div className={styles["sub-field"]}>
              <label className={styles["form-label"]}>Value Title (e.g., "Points", "Gold")</label>
              <input
                type="text"
                className={styles["form-input"]}
                value={gameData.value_title || ""}
                onChange={(e) => handleChange("value_title", e.target.value)}
                placeholder="Points"
                maxLength={50}
              />
            </div>
            <div className={styles["sub-field"]}>
              <label className={styles["form-label"]}>Piece ID that Generates Value (optional)</label>
              <NumberInput
                value={gameData.value_piece || 0}
                onChange={(val) => handleChange("value_piece", val || null)}
                options={{ min: 0, placeholder: "Leave empty if not applicable", className: styles["form-input-small"] }}
              />
            </div>
          </div>
        )}
      </div>
      */}

      {/* Squares Condition */}
      <div className={styles["condition-section"]}>
        <h3>Control Squares Condition</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="squares_condition"
              value="true"
              checked={gameData.squares_condition === true}
              onChange={(e) => handleBooleanChange("squares_condition", e.target.value)}
            />
            <span>Win by controlling specific squares</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="squares_condition"
              value="false"
              checked={gameData.squares_condition === false}
              onChange={(e) => handleBooleanChange("squares_condition", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>
        {gameData.squares_condition && (
          <div className={styles["sub-field"]}>
            <p className={styles["field-hint"]} style={{ marginTop: '10px' }}>
              ℹ️ Specific control squares will be configured in Step 3 (Board & Players).
            </p>
          </div>
        )}
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>Optional Condition ID (Advanced)</label>
        <NumberInput
          value={gameData.optional_condition || 0}
          onChange={(val) => handleChange("optional_condition", val || null)}
          options={{ min: 0, placeholder: "Leave empty if not applicable", className: styles["form-input-small"] }}
        />
        <p className={styles["field-hint"]}>
          Reference to a custom condition defined elsewhere (optional).
        </p>
      </div>

      {/* Draw Conditions Section */}
      <div className={styles["section-divider"]}></div>
      <h2 style={{ marginTop: '32px' }}>Draw Conditions</h2>
      <p className={styles["step-description"]}>
        Configure conditions that result in a draw (tie) instead of a win.
      </p>

      {/* Move Limit Draw Rule (50-move rule) */}
      <div className={styles["condition-section"]}>
        <h3>Move Limit Draw Rule</h3>
        <p className={styles["field-hint"]} style={{ marginBottom: '12px' }}>
          Similar to chess's "50-move rule" - the game ends in a draw after X moves without any captures or promotable piece moves.
          A "move" counts as one turn by each player (e.g., 50 moves = 50 turns by white + 50 turns by black).
        </p>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="draw_move_limit_enabled"
              value="enabled"
              checked={gameData.draw_move_limit !== null && gameData.draw_move_limit !== undefined}
              onChange={(e) => handleChange("draw_move_limit", 50)}
            />
            <span>Enable move limit draw rule</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="draw_move_limit_enabled"
              value="disabled"
              checked={gameData.draw_move_limit === null || gameData.draw_move_limit === undefined}
              onChange={(e) => handleChange("draw_move_limit", null)}
            />
            <span>Disable</span>
          </label>
        </div>
        {(gameData.draw_move_limit !== null && gameData.draw_move_limit !== undefined) && (
          <div className={styles["sub-field"]}>
            <label className={styles["form-label"]}>Moves without capture before draw</label>
            <NumberInput
              value={gameData.draw_move_limit || 50}
              onChange={(val) => handleChange("draw_move_limit", Math.max(1, Math.min(500, val)))}
              options={{ min: 1, max: 500, placeholder: "50", className: styles["form-input-small"] }}
            />
            <p className={styles["field-hint"]}>
              Standard chess uses 50 moves. Adjust based on your game's pace.
            </p>
          </div>
        )}
      </div>

      {/* N-Fold Repetition Draw Rule */}
      <div className={styles["condition-section"]}>
        <h3>Position Repetition Draw Rule</h3>
        <p className={styles["field-hint"]} style={{ marginBottom: '12px' }}>
          Similar to chess's "3-fold repetition" - the game ends in a draw when the same board position occurs N times.
          The position is considered the same when all pieces are on the same squares.
        </p>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="repetition_draw_enabled"
              value="enabled"
              checked={gameData.repetition_draw_count !== null && gameData.repetition_draw_count !== undefined}
              onChange={(e) => handleChange("repetition_draw_count", 3)}
            />
            <span>Enable repetition draw rule</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="repetition_draw_enabled"
              value="disabled"
              checked={gameData.repetition_draw_count === null || gameData.repetition_draw_count === undefined}
              onChange={(e) => handleChange("repetition_draw_count", null)}
            />
            <span>Disable</span>
          </label>
        </div>
        {(gameData.repetition_draw_count !== null && gameData.repetition_draw_count !== undefined) && (
          <div className={styles["sub-field"]}>
            <label className={styles["form-label"]}>Number of repetitions for draw</label>
            <NumberInput
              value={gameData.repetition_draw_count || 3}
              onChange={(val) => handleChange("repetition_draw_count", Math.max(2, Math.min(9, val)))}
              options={{ min: 2, max: 9, placeholder: "3", className: styles["form-input-small"] }}
            />
            <p className={styles["field-hint"]}>
              Standard chess uses 3-fold repetition. Set to 2 for faster draws, or higher for longer games.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Step2WinConditions;
