import React from "react";
import styles from "./piecewizard.module.scss";

const PieceStep4Special = ({ pieceData, updatePieceData }) => {
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
      <h2>Special Rules & Review</h2>
      <p className={styles["step-description"]}>
        Configure special rules, checkmate behavior, and review all settings.
      </p>

      {/* Checkmate Rules */}
      <div className={styles["condition-section"]}>
        <h3>Checkmate & Check Rules</h3>
        
        <div className={styles["sub-field"]}>
          <label>Checkmate on Attack Rules</label>
          <div className={styles["radio-group"]}>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="checkmate_on_attack"
                value="true"
                checked={pieceData.checkmate_on_attack === true}
                onChange={(e) => handleBooleanChange("checkmate_on_attack", e.target.value)}
              />
              <span>Attacking this piece causes checkmate</span>
            </label>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="checkmate_on_attack"
                value="false"
                checked={pieceData.checkmate_on_attack === false}
                onChange={(e) => handleBooleanChange("checkmate_on_attack", e.target.value)}
              />
              <span>Normal piece</span>
            </label>
          </div>
        </div>

        <div className={styles["sub-field"]}>
          <label>Check on Attack Rules</label>
          <div className={styles["radio-group"]}>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="check_on_attack"
                value="true"
                checked={pieceData.check_on_attack === true}
                onChange={(e) => handleBooleanChange("check_on_attack", e.target.value)}
              />
              <span>Attacking this piece puts player in check</span>
            </label>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="check_on_attack"
                value="false"
                checked={pieceData.check_on_attack === false}
                onChange={(e) => handleBooleanChange("check_on_attack", e.target.value)}
              />
              <span>Normal piece</span>
            </label>
          </div>
        </div>
      </div>

      {/* Loss Conditions */}
      <div className={styles["condition-section"]}>
        <h3>Loss Conditions</h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="lose_game_on_capture"
              value="true"
              checked={pieceData.lose_game_on_capture === true}
              onChange={(e) => handleBooleanChange("lose_game_on_capture", e.target.value)}
            />
            <span>Player loses game if this piece is captured</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="lose_game_on_capture"
              value="false"
              checked={pieceData.lose_game_on_capture === false}
              onChange={(e) => handleBooleanChange("lose_game_on_capture", e.target.value)}
            />
            <span>Normal piece (game continues if captured)</span>
          </label>
        </div>
      </div>

      {/* Movement Restrictions */}
      <div className={styles["condition-section"]}>
        <h3>Movement Restrictions</h3>
        <div className={styles["sub-field"]}>
          <label>Minimum Turns Before Move</label>
          <input
            type="number"
            className={styles["form-input-small"]}
            value={pieceData.min_turns_until_movement || ""}
            onChange={(e) => handleNumberChange("min_turns_until_movement", e.target.value)}
            placeholder="0 for immediate movement"
            min="0"
          />
          <p className={styles["field-hint"]}>
            Number of turns that must pass before this piece can move (useful for special pieces that activate later)
          </p>
        </div>
      </div>

      {/* Special Scenarios */}
      <div className={styles["condition-section"]}>
        <h3>Advanced: Special Scenarios (JSON)</h3>
        <p className={styles["field-hint"]}>
          These fields accept JSON strings for complex, scenario-based rules. Leave empty if not needed.
        </p>

        <div className={styles["sub-field"]}>
          <label>Special Scenario Movement</label>
          <textarea
            className={styles["form-textarea"]}
            value={pieceData.special_scenario_movement || ""}
            onChange={(e) => handleChange("special_scenario_movement", e.target.value)}
            placeholder='{"condition": "example", "movement": "special"}'
            rows="3"
          />
        </div>

        <div className={styles["sub-field"]}>
          <label>Special Scenario Capture</label>
          <textarea
            className={styles["form-textarea"]}
            value={pieceData.special_scenario_capture || ""}
            onChange={(e) => handleChange("special_scenario_capture", e.target.value)}
            placeholder='{"condition": "example", "capture": "special"}'
            rows="3"
          />
        </div>
      </div>

      {/* Summary Section */}
      <div className={styles["summary-section"]}>
        <h3>Summary</h3>
        <div className={styles["summary-grid"]}>
          <div className={styles["summary-item"]}>
            <strong>Piece Name:</strong> {pieceData.piece_name || "Not set"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Type:</strong> {pieceData.piece_type || "Not set"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Dimensions:</strong> {pieceData.piece_width || "?"}x{pieceData.piece_height || "?"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Directional Movement:</strong>{" "}
            {pieceData.directional_movement_style ? "Enabled" : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Ratio Movement:</strong>{" "}
            {pieceData.ratio_movement_style
              ? `${pieceData.ratio_one_movement || 0}-${pieceData.ratio_two_movement || 0}`
              : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Step-by-Step:</strong>{" "}
            {pieceData.step_by_step_movement_style
              ? `${Math.abs(pieceData.step_by_step_movement_value || 0)} steps${
                  pieceData.step_by_step_movement_value < 0 ? " (no diagonal)" : " (with diagonal)"
                }`
              : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Capture on Move:</strong>{" "}
            {pieceData.can_capture_enemy_on_move ? "Yes" : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Ranged Attack:</strong>{" "}
            {pieceData.can_capture_enemy_via_range ? "Enabled" : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Checkmate Piece:</strong>{" "}
            {pieceData.checkmate_on_attack ? "Yes" : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Lose on Capture:</strong>{" "}
            {pieceData.lose_game_on_capture ? "Yes" : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Can Hop Allies:</strong>{" "}
            {pieceData.can_hop_over_allies ? "Yes" : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Can Hop Enemies:</strong>{" "}
            {pieceData.can_hop_over_enemies ? "Yes" : "No"}
          </div>
        </div>

        {pieceData.piece_image_preview && (
          <div className={styles["summary-image"]}>
            <strong>Piece Image:</strong>
            <img src={pieceData.piece_image_preview} alt="Piece preview" />
          </div>
        )}
      </div>
    </div>
  );
};

export default PieceStep4Special;
