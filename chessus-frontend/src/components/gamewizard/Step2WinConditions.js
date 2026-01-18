import React from "react";
import styles from "./gamewizard.module.scss";

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
            <label className={styles["form-label"]}>Specific Piece ID to Checkmate (optional)</label>
            <input
              type="number"
              className={styles["form-input-small"]}
              value={gameData.mate_piece || ""}
              onChange={(e) => handleChange("mate_piece", e.target.value ? parseInt(e.target.value) : null)}
              placeholder="Leave empty for any piece"
            />
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
            <label className={styles["form-label"]}>Specific Piece ID to Capture (optional)</label>
            <input
              type="number"
              className={styles["form-input-small"]}
              value={gameData.capture_piece || ""}
              onChange={(e) => handleChange("capture_piece", e.target.value ? parseInt(e.target.value) : null)}
              placeholder="Leave empty for any piece"
            />
          </div>
        )}
      </div>

      {/* Value Condition */}
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
              <input
                type="number"
                className={styles["form-input-small"]}
                value={gameData.value_max || ""}
                onChange={(e) => handleChange("value_max", e.target.value ? parseInt(e.target.value) : null)}
                placeholder="e.g., 100"
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
              <input
                type="number"
                className={styles["form-input-small"]}
                value={gameData.value_piece || ""}
                onChange={(e) => handleChange("value_piece", e.target.value ? parseInt(e.target.value) : null)}
                placeholder="Leave empty if not applicable"
              />
            </div>
          </div>
        )}
      </div>

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
            <label className={styles["form-label"]}>Number of Squares to Control</label>
            <input
              type="number"
              className={styles["form-input-small"]}
              value={gameData.squares_count || ""}
              onChange={(e) => handleChange("squares_count", e.target.value ? parseInt(e.target.value) : null)}
              placeholder="e.g., 5"
              min="1"
            />
          </div>
        )}
      </div>

      {/* King of the Hill Condition */}
      <div className={styles["condition-section"]}>
        <h3>King of the Hill Condition</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="hill_condition"
              value="true"
              checked={gameData.hill_condition === true}
              onChange={(e) => handleBooleanChange("hill_condition", e.target.value)}
            />
            <span>Win by holding a specific square</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="hill_condition"
              value="false"
              checked={gameData.hill_condition === false}
              onChange={(e) => handleBooleanChange("hill_condition", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>
        {gameData.hill_condition && (
          <div className={styles["sub-fields"]}>
            <div className={styles["sub-field"]}>
              <label className={styles["form-label"]}>Hill X Coordinate</label>
              <input
                type="number"
                className={styles["form-input-small"]}
                value={gameData.hill_x || ""}
                onChange={(e) => handleChange("hill_x", e.target.value ? parseInt(e.target.value) : null)}
                placeholder="X position"
                min="0"
              />
            </div>
            <div className={styles["sub-field"]}>
              <label className={styles["form-label"]}>Hill Y Coordinate</label>
              <input
                type="number"
                className={styles["form-input-small"]}
                value={gameData.hill_y || ""}
                onChange={(e) => handleChange("hill_y", e.target.value ? parseInt(e.target.value) : null)}
                placeholder="Y position"
                min="0"
              />
            </div>
            <div className={styles["sub-field"]}>
              <label className={styles["form-label"]}>Turns to Hold Hill</label>
              <input
                type="number"
                className={styles["form-input-small"]}
                value={gameData.hill_turns || ""}
                onChange={(e) => handleChange("hill_turns", e.target.value ? parseInt(e.target.value) : null)}
                placeholder="e.g., 3"
                min="1"
              />
            </div>
          </div>
        )}
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>Optional Condition ID (Advanced)</label>
        <input
          type="number"
          className={styles["form-input-small"]}
          value={gameData.optional_condition || ""}
          onChange={(e) => handleChange("optional_condition", e.target.value ? parseInt(e.target.value) : null)}
          placeholder="Leave empty if not applicable"
        />
        <p className={styles["field-hint"]}>
          Reference to a custom condition defined elsewhere (optional).
        </p>
      </div>
    </div>
  );
};

export default Step2WinConditions;
