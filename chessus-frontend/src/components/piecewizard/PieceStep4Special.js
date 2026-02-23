import React, { useEffect } from "react";
import styles from "./piecewizard.module.scss";
import NumberInput from "../common/NumberInput";

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

  // Check if piece has no backward movement
  // This includes directional movement, ratio movements, and step-by-step movements
  const hasNoBackwardDirectionalMovement = 
    (pieceData.down_movement || 0) === 0 &&
    (pieceData.down_left_movement || 0) === 0 &&
    (pieceData.down_right_movement || 0) === 0;

  // Ratio movements (L-shapes like knights) can move backwards
  const hasRatioMovement = 
    pieceData.ratio_movement_style && 
    ((pieceData.ratio_one_movement || 0) > 0 || (pieceData.ratio_two_movement || 0) > 0);

  // Step-by-step movements can move in any direction (including backwards)
  const hasStepByStepMovement = 
    pieceData.step_by_step_movement_style && 
    (pieceData.step_by_step_movement_value || 0) > 0;

  // Piece can only en passant if it has no way to move backwards
  const hasNoBackwardMovement = hasNoBackwardDirectionalMovement && !hasRatioMovement && !hasStepByStepMovement;

  // En passant option should only show if piece has no backward movement
  // (pawn-like pieces that can only move forward)
  const canShowEnPassant = hasNoBackwardMovement;

  // Auto-clear can_en_passant if conditions are no longer met
  useEffect(() => {
    if (!canShowEnPassant && pieceData.can_en_passant) {
      updatePieceData({ can_en_passant: false });
    }
  }, [canShowEnPassant, pieceData.can_en_passant, updatePieceData]);

  return (
    <div className={styles["step-container"]}>
      <h2>Special Rules & Review</h2>
      <p className={styles["step-description"]}>
        Configure special movement restrictions and review all settings.
      </p>

      {/* Movement Restrictions */}
      <div className={styles["condition-section"]}>
        <h3>Movement Restrictions</h3>
        <div className={styles["sub-field"]}>
          <label>Minimum Turns Before Move</label>
          <NumberInput 
            value={pieceData.min_turns_until_movement || 0}
            onChange={(value) => handleNumberChange("min_turns_until_movement", value)}
            options={{ min: 0, max: 99, placeholder: "0" }}
          />
          <p className={styles["field-hint"]}>
            Number of turns that must pass before this piece can move (useful for special pieces that activate later)
          </p>
        </div>
      </div>

      {/* Special Scenarios */}
      <div className={styles["condition-section"]}>
        <h3>Special Abilities</h3>
        
        <div className={styles["sub-field"]}>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={pieceData.can_castle || false}
              onChange={(e) => handleChange("can_castle", e.target.checked)}
            />
            <span>Can Castle</span>
          </label>
          <p className={styles["field-hint"]}>
            Allows this piece to castle with its partner piece. At the start of the game, the furthest allied piece to the left and right on the same row become this piece's castling partners. To castle, move 2 squares left or right, and the corresponding partner will move to the opposite side. Both pieces must not have moved since the game started, and all squares between must be unoccupied. If this piece has check or checkmate rules, it cannot castle through enemy-controlled squares.
          </p>
        </div>

        <div className={styles["sub-field"]}>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={pieceData.can_promote || false}
              onChange={(e) => handleChange("can_promote", e.target.checked)}
            />
            <span>Can Promote</span>
          </label>
          <p className={styles["field-hint"]}>
            Allows this piece to promote to another piece when it reaches specific squares. Promotion squares are defined in the game type settings.
          </p>
        </div>

        {canShowEnPassant && (
          <div className={styles["sub-field"]}>
            <label className={styles["checkbox-label"]}>
              <input
                type="checkbox"
                checked={pieceData.can_en_passant || false}
                onChange={(e) => handleChange("can_en_passant", e.target.checked)}
              />
              <span>Can En Passant</span>
            </label>
            <p className={styles["field-hint"]}>
              Allows this piece to capture an enemy piece of the same type that has just used a first-move-only movement to land horizontally adjacent. For example, a Pawn can only en passant capture another Pawn. En passant captures must be made immediately after the enemy's qualifying move.
            </p>
          </div>
        )}
      </div>

      {/* Advanced Special Scenarios - Hidden for now */}
      {false && (
      <div className={styles["condition-section"]}>
        <h3>Advanced: Special Scenarios (JSON)</h3>
        <p className={styles["field-hint"]}>
          These fields accept JSON strings for complex, scenario-based rules. Leave empty if not needed.
        </p>

        <div className={styles["sub-field"]}>
          <label>Special Scenario Movement</label>
          <textarea
            className={styles["form-textarea"]}
            value={pieceData.special_scenario_moves || ""}
            onChange={(e) => handleChange("special_scenario_moves", e.target.value)}
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
      )}

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
