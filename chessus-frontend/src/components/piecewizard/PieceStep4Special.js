import React, { useEffect } from "react";
import styles from "./piecewizard.module.scss";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "./InfoTooltip";
import ToggleSwitch from "../common/ToggleSwitch";

const PieceStep4Special = ({ pieceData, updatePieceData }) => {
  const handleChange = (field, value) => {
    updatePieceData({ [field]: value });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShowEnPassant, pieceData.can_en_passant]);

  return (
    <div className={styles["step-container"]}>
      <h2>Special Rules & Review</h2>
      <p className={styles["step-description"]}>
        Configure special movement restrictions and review all settings.
      </p>

      {/* Movement Restrictions */}
      <div className={`${styles["condition-section"]} ${styles["narrow-section"]}`}>
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
      <div className={`${styles["condition-section"]} ${styles["narrow-section"]}`}>
        <h3>Special Abilities</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '12px' }}>
          <ToggleSwitch
            checked={pieceData.can_promote || false}
            onChange={(v) => handleChange("can_promote", v)}
            label="Can Promote"
            tooltip={<InfoTooltip text="Allows this piece to promote (transform into a different piece) when it reaches a promotion square. Promotion squares and which target pieces are available are configured per-game in the game wizard (Step 4 → Promotion Options)." />}
          />

          {pieceData.can_promote && (
            <div style={{ paddingLeft: '24px' }}>
              <ToggleSwitch
                checked={pieceData.free_move_after_promotion || false}
                onChange={(v) => handleChange("free_move_after_promotion", v)}
                label="Free Move After Promotion"
                tooltip={<InfoTooltip text="After this piece promotes (transforms into a different piece), the newly promoted piece can immediately take one additional move. Useful for checkers kings, which can continue moving or capturing after being promoted." />}
              />
            </div>
          )}

          <ToggleSwitch
            checked={pieceData.can_castle || false}
            onChange={(v) => handleChange("can_castle", v)}
            label="Can Castle"
            tooltip={<InfoTooltip text="Allows this piece to castle with a partner piece. The furthest allied piece to the left and right on the same row become castling partners. The castling distance (how many squares the piece moves) is configured per-placement in the game wizard. The partner moves to the opposite side. Both pieces must not have moved, and all squares between must be unoccupied. If this piece has check/checkmate rules, it cannot castle through enemy-controlled squares." />}
          />

          {canShowEnPassant && (
            <ToggleSwitch
              checked={pieceData.can_en_passant || false}
              onChange={(v) => handleChange("can_en_passant", v)}
              label="Can En Passant"
              tooltip={<InfoTooltip text="Allows this piece to capture an enemy piece of the same type that has just used a first-move-only movement to land horizontally adjacent. For example, a Pawn can only en passant capture another Pawn. The capture must be made immediately after the enemy's qualifying move. Only available for pieces with no backward movement (pawn-like pieces)." />}
            />
          )}

          <ToggleSwitch
            checked={pieceData.can_capture_allies || false}
            onChange={(v) => handleChange("can_capture_allies", v)}
            label="Can Capture Allied Pieces"
            tooltip={<InfoTooltip text="When enabled, this piece can capture friendly pieces using any of its attack methods (directional, ratio, or ranged). Useful for sacrifice-based mechanics." />}
          />

          <ToggleSwitch
            checked={pieceData.must_move_if_able || false}
            onChange={(v) => {
              if (v) {
                handleChange("must_move_if_able", true);
              } else {
                updatePieceData({ must_move_if_able: false, must_move_uses_action: false });
              }
            }}
            label="Must Move If Able"
            tooltip={<InfoTooltip text="On its owner's turn, this piece is forced to move if it has any legal move available. Useful for pieces like the duck in Duck Chess. By default, this forced move does NOT consume one of the player's actions per turn." />}
          />

          {pieceData.must_move_if_able && (
            <div style={{ paddingLeft: '24px' }}>
              <ToggleSwitch
                checked={pieceData.must_move_uses_action || false}
                onChange={(v) => handleChange("must_move_uses_action", v)}
                label="Forced Move Uses an Action"
                tooltip={<InfoTooltip text="When enabled, the forced move subtracts from the player's actions per turn. For example, if a player has 1 action per turn, this forced move would consume the entire turn." />}
              />
            </div>
          )}
        </div>
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
            <span className={styles["summary-tooltip"]}>Per-direction movement with configurable distance, exact/infinite range, and first-move-only options.</span>
            <strong>Directional Movement:</strong>{" "}
            {pieceData.directional_movement_style ? "Enabled" : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>L-shaped movement like a knight. Moves one distance in one direction, then a different distance perpendicularly.</span>
            <strong>Ratio Movement:</strong>{" "}
            {pieceData.ratio_movement_style
              ? `${pieceData.ratio_one_movement || 0}-${pieceData.ratio_two_movement || 0}`
              : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>A step budget where the piece moves one square at a time in any direction, changing direction each step.</span>
            <strong>Step-by-Step:</strong>{" "}
            {pieceData.step_by_step_movement_style
              ? `${Math.abs(pieceData.step_by_step_movement_value || 0)} steps${
                  pieceData.step_by_step_movement_value < 0 ? " (no diagonal)" : " (with diagonal)"
                }`
              : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>The piece moves to the enemy's square to capture it, like most chess pieces.</span>
            <strong>Capture on Move:</strong>{" "}
            {pieceData.can_capture_enemy_on_move ? "Yes" : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>The piece attacks without moving — stays in place but can capture distant enemies.</span>
            <strong>Ranged Attack:</strong>{" "}
            {pieceData.can_capture_enemy_via_range ? "Enabled" : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Whether the piece can hop over other pieces during movement. Does not capture hopped-over pieces.</span>
            <strong>Movement Hopping:</strong>{" "}
            {pieceData.can_hop_over_allies && pieceData.can_hop_over_enemies
              ? "Allies & Enemies"
              : pieceData.can_hop_over_allies
              ? "Allies only"
              : pieceData.can_hop_over_enemies
              ? "Enemies only"
              : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Whether the piece can hop over other pieces when attacking to reach its capture target.</span>
            <strong>Attack Hopping:</strong>{" "}
            {pieceData.can_hop_attack_over_allies && pieceData.can_hop_attack_over_enemies
              ? "Allies & Enemies"
              : pieceData.can_hop_attack_over_allies
              ? "Allies only"
              : pieceData.can_hop_attack_over_enemies
              ? "Enemies only"
              : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Capture on Hop captures pieces that are hopped over. Chain Capture allows multiple jumps in one turn.</span>
            <strong>Checkers Capture:</strong>{" "}
            {pieceData.capture_on_hop ? "Capture on Hop" : ""}
            {pieceData.capture_on_hop && pieceData.chain_capture_enabled ? " + " : ""}
            {pieceData.chain_capture_enabled ? "Chain Capture" : ""}
            {!pieceData.capture_on_hop && !pieceData.chain_capture_enabled ? "No" : ""}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Castling, promotion, en passant, and other special rules.</span>
            <strong>Special Abilities:</strong>{" "}
            {[
              pieceData.can_castle && "Castle",
              pieceData.can_promote && "Promote",
              pieceData.can_en_passant && "En Passant",
              pieceData.free_move_after_promotion && "Free Move After Promotion"
            ].filter(Boolean).join(", ") || "None"}
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
