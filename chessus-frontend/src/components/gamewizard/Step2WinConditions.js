import React from "react";
import styles from "./gamewizard.module.scss";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "../piecewizard/InfoTooltip";

const Step2WinConditions = ({ gameData, updateGameData }) => {
  const handleChange = (field, value) => {
    updateGameData({ [field]: value });
  };

  const handleBooleanChange = (field, value) => {
    updateGameData({ [field]: value === "true" });
  };

  const getOtherData = () => {
    try { return JSON.parse(gameData.other_game_data || '{}'); } catch { return {}; }
  };

  const setOtherDataField = (key, value) => {
    const data = getOtherData();
    data[key] = value;
    updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Win Conditions</h2>
      <p className={styles["step-description"]}>
        Define how players can win the game. You can enable multiple win conditions.
      </p>

      {/* Mate Condition */}
      <div className={styles["condition-section"]}>
        <h3>Checkmate Condition <InfoTooltip text="When enabled, the game ends when a designated piece (like a King) is put in checkmate — meaning it's attacked and has no legal escape. Specific checkmate-triggering pieces are configured in Step 4 (Piece Placement)." /></h3>
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
          </div>
        )}
      </div>

      {/* Capture Condition */}
      <div className={styles["condition-section"]}>
        <h3>Capture Condition <InfoTooltip text="When enabled, the game ends when a designated piece is captured. If no specific pieces are marked in Step 4, the game ends when all of a player's pieces are captured." /></h3>
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
          </div>
        )}
      </div>

      {/* No Legal Moves Condition (Checkers-style) */}
      <div className={styles["condition-section"]}>
        <h3>No Legal Moves Condition <InfoTooltip text="When enabled, a player who has no legal moves on their turn loses the game. Used in Checkers-style games. This is different from chess stalemate (which is a draw)." /></h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="no_moves_condition"
              value="true"
              checked={gameData.no_moves_condition === true}
              onChange={(e) => handleBooleanChange("no_moves_condition", e.target.value)}
            />
            <span>Player with no legal moves loses</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="no_moves_condition"
              value="false"
              checked={gameData.no_moves_condition === false}
              onChange={(e) => handleBooleanChange("no_moves_condition", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>
        {gameData.no_moves_condition && (
          <div className={styles["sub-field"]}>
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
        <h3>Control Squares Condition <InfoTooltip text="Win by controlling specific squares on the board. A player wins when their pieces occupy the designated control squares. The specific squares are configured in Step 3 (Board & Players)." /></h3>
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
          </div>
        )}
      </div>

      {/* Piece Count Condition */}
      <div className={styles["condition-section"]}>
        <h3>Piece Count Condition <InfoTooltip text="The player with the most pieces on the board wins when no more moves can be made or when the board is full. Used in Othello/Reversi-style games." /></h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="piece_count_condition"
              value="true"
              checked={gameData.piece_count_condition === true}
              onChange={(e) => handleBooleanChange("piece_count_condition", e.target.value)}
            />
            <span>Player with the most pieces wins</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="piece_count_condition"
              value="false"
              checked={gameData.piece_count_condition === false}
              onChange={(e) => handleBooleanChange("piece_count_condition", e.target.value)}
            />
            <span>Disable</span>
          </label>
        </div>
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>Optional Condition ID <InfoTooltip text="Reference to a custom win condition defined externally. Leave empty unless you have a custom condition system set up." /></label>
        <NumberInput
          value={gameData.optional_condition || 0}
          onChange={(val) => handleChange("optional_condition", val || null)}
          options={{ min: 0, placeholder: "Leave empty if not applicable", className: styles["form-input-small"] }}
        />
      </div>

      {/* Draw Conditions Section */}
      <div className={styles["section-divider"]}></div>
      <h2 style={{ marginTop: '32px' }}>Draw Conditions</h2>
      <p className={styles["step-description"]}>
        Configure conditions that result in a draw (tie) instead of a win.
      </p>

      {/* Move Limit Draw Rule (50-move rule) */}
      <div className={styles["condition-section"]}>
        <h3>Move Limit Draw Rule <InfoTooltip text="Similar to chess's 50-move rule. The game ends in a draw after a set number of moves without any captures or promotable piece advances. A 'move' counts as one turn by each player (e.g., 50 moves = 50 turns by white + 50 turns by black)." /></h3>
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
              Standard chess uses 50. Adjust based on your game's pace.
            </p>
          </div>
        )}
      </div>

      {/* N-Fold Repetition Draw Rule */}
      <div className={styles["condition-section"]}>
        <h3>Position Repetition Draw Rule <InfoTooltip text="Similar to chess's 3-fold repetition rule. The game ends in a draw when the same board position occurs N times. The position is considered the same when all pieces are on the same squares." /></h3>
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
              Standard chess uses 3. Set to 2 for faster draws, or higher for longer games.
            </p>
          </div>
        )}
      </div>

      {/* Equal Piece Count Draw */}
      <div className={styles["condition-section"]}>
        <h3>Equal Piece Count Draw <InfoTooltip text="The game ends in a draw when both players have equal piece counts and neither player has valid moves remaining. Used in Othello/Reversi-style games." /></h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="equal_piece_count_draw"
              value="enabled"
              checked={getOtherData().equal_piece_count_draw === true}
              onChange={() => setOtherDataField("equal_piece_count_draw", true)}
            />
            <span>Equal piece count with no valid moves is a draw</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="equal_piece_count_draw"
              value="disabled"
              checked={getOtherData().equal_piece_count_draw !== true}
              onChange={() => setOtherDataField("equal_piece_count_draw", false)}
            />
            <span>Disable</span>
          </label>
        </div>
      </div>

      {/* Gameplay Mechanics Section */}
      <div className={styles["section-divider"]}></div>
      <h2 style={{ marginTop: '32px' }}>Gameplay Mechanics</h2>
      <p className={styles["step-description"]}>
        Configure special gameplay rules and actions.
      </p>

      {/* Place Pieces Action */}
      <div className={styles["condition-section"]}>
        <h3>Place Pieces Action <InfoTooltip text="When enabled, players can spend actions to place pieces onto empty squares during their turn. The specific pieces available for placement are configured in Step 4 (Pieces)." /></h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="place_pieces_action"
              value="enabled"
              checked={getOtherData().place_pieces_action === true}
              onChange={() => setOtherDataField("place_pieces_action", true)}
            />
            <span>Spend actions to place pieces</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="place_pieces_action"
              value="disabled"
              checked={getOtherData().place_pieces_action !== true}
              onChange={() => {
                const data = getOtherData();
                data.place_pieces_action = false;
                data.placeable_pieces = [];
                updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
              }}
            />
            <span>Disable</span>
          </label>
        </div>
      </div>

      {/* Flanking Captures */}
      <div className={styles["condition-section"]}>
        <h3>Flanking Captures <InfoTooltip text="When enabled, placing a piece that flanks opponent pieces in a line (horizontally, vertically, or diagonally) converts those opponent pieces to your color. Used in Othello/Reversi-style games." /></h3>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="flanking_captures"
              value="enabled"
              checked={getOtherData().flanking_captures === true}
              onChange={() => setOtherDataField("flanking_captures", true)}
            />
            <span>Enable flanking captures</span>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="flanking_captures"
              value="disabled"
              checked={getOtherData().flanking_captures !== true}
              onChange={() => {
                const data = getOtherData();
                data.flanking_captures = false;
                data.must_flank = false;
                data.skip_turn_no_flank = false;
                updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
              }}
            />
            <span>Disable</span>
          </label>
        </div>
      </div>

      {/* Must Flank */}
      {getOtherData().flanking_captures && (
        <div className={styles["condition-section"]}>
          <h3>Must Flank <InfoTooltip text="When enabled, players can only place pieces on squares that result in at least one flank. If no flanking placement is available, the player's turn is skipped." /></h3>
          <div className={styles["radio-group"]}>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="must_flank"
                value="enabled"
                checked={getOtherData().must_flank === true}
                onChange={() => setOtherDataField("must_flank", true)}
              />
              <span>Must flank if possible</span>
            </label>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="must_flank"
                value="disabled"
                checked={getOtherData().must_flank !== true}
                onChange={() => setOtherDataField("must_flank", false)}
              />
              <span>Disable</span>
            </label>
          </div>
        </div>
      )}

      {/* Skip Turn If No Flank */}
      {getOtherData().flanking_captures && getOtherData().must_flank && (
        <div className={styles["condition-section"]}>
          <h3>Skip Turn If No Flank <InfoTooltip text="When enabled, if a player has no valid flanking placements, their turn is automatically skipped. If both players have no valid placements, the game ends." /></h3>
          <div className={styles["radio-group"]}>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="skip_turn_no_flank"
                value="enabled"
                checked={getOtherData().skip_turn_no_flank === true}
                onChange={() => setOtherDataField("skip_turn_no_flank", true)}
              />
              <span>Skip turn if no flanking move available</span>
            </label>
            <label className={styles["radio-label"]}>
              <input
                type="radio"
                name="skip_turn_no_flank"
                value="disabled"
                checked={getOtherData().skip_turn_no_flank !== true}
                onChange={() => setOtherDataField("skip_turn_no_flank", false)}
              />
              <span>Disable</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default Step2WinConditions;
