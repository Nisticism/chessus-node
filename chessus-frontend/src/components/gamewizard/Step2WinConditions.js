import React from "react";
import styles from "./gamewizard.module.scss";
import NumberInput from "../common/NumberInput";
import ToggleSwitch from "../common/ToggleSwitch";
import InfoTooltip from "../piecewizard/InfoTooltip";

const Step2WinConditions = ({ gameData, updateGameData }) => {
  const handleChange = (field, value) => {
    updateGameData({ [field]: value });
  };

  const getOtherData = () => {
    try { return JSON.parse(gameData.other_game_data || '{}'); } catch { return {}; }
  };

  const setOtherDataField = (key, value) => {
    const data = getOtherData();
    data[key] = value;
    updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
  };

  const ToggleRow = ({ title, tooltip, checked, onChange, children }) => (
    <div className={styles["condition-section"]}>
      <div className={styles["condition-toggle-row"]}>
        <ToggleSwitch
          checked={!!checked}
          onChange={onChange}
          label={
            <span className={styles["condition-toggle-title"]}>
              {title}
              {tooltip && <InfoTooltip text={tooltip} />}
            </span>
          }
        />
      </div>
      {checked && children}
    </div>
  );

  const otherData = getOtherData();
  const moveLimitEnabled = gameData.draw_move_limit !== null && gameData.draw_move_limit !== undefined;
  const repetitionEnabled = gameData.repetition_draw_count !== null && gameData.repetition_draw_count !== undefined;

  return (
    <div className={styles["step-container"]}>
      <h2>Win Conditions</h2>
      <p className={styles["step-description"]}>
        Define how players can win the game. You can enable multiple win conditions.
      </p>

      <ToggleRow
        title="Checkmate Condition"
        tooltip="When enabled, the game ends when a designated piece (like a King) is put in checkmate — meaning it's attacked and has no legal escape. Specific checkmate-triggering pieces are configured in Step 4 (Piece Placement)."
        checked={gameData.mate_condition === true}
        onChange={(val) => handleChange("mate_condition", val)}
      >
        <div className={styles["sub-field"]}>
          <ToggleSwitch
            checked={gameData.mate_condition_requires_all === true}
            onChange={(val) => handleChange("mate_condition_requires_all", val)}
            size="small"
            label={
              <span className={styles["condition-toggle-title"]}>
                Require <em>all</em> checkmate-flagged pieces to be checkmated
                <InfoTooltip text="By default, putting any single piece marked 'End game on checkmate' (in Step 4) into checkmate ends the game. When this option is checked, ALL such pieces belonging to a player must be simultaneously under lethal attack with no legal escape, AND capturing one such piece does not end the game until none remain. This makes checkmate very hard to achieve — useful when promotion can create additional checkmate-flagged pieces." />
              </span>
            }
          />
        </div>
      </ToggleRow>

      <ToggleRow
        title="Capture Condition"
        tooltip="When enabled, the game ends when a designated piece is captured. If no specific pieces are marked in Step 4, the game ends when all of a player's pieces are captured."
        checked={gameData.capture_condition === true}
        onChange={(val) => handleChange("capture_condition", val)}
      >
        <div className={styles["sub-field"]}>
          <ToggleSwitch
            checked={gameData.capture_condition_requires_all === true}
            onChange={(val) => handleChange("capture_condition_requires_all", val)}
            size="small"
            label={
              <span className={styles["condition-toggle-title"]}>
                Require <em>all</em> capture-flagged pieces to be captured
                <InfoTooltip text="By default, capturing any single piece marked 'End game if this piece is captured' (in Step 4) ends the game. When this option is checked, ALL such pieces belonging to a player must be captured before that player loses." />
              </span>
            }
          />
        </div>
      </ToggleRow>

      <ToggleRow
        title="No Legal Moves Condition"
        tooltip="When enabled, a player who has no legal moves on their turn loses the game. Used in Checkers-style games. This is different from chess stalemate (which is a draw)."
        checked={gameData.no_moves_condition === true}
        onChange={(val) => handleChange("no_moves_condition", val)}
      />

      <ToggleRow
        title="Control Squares Condition"
        tooltip="Win by controlling specific squares on the board. A player wins when their pieces occupy the designated control squares. The specific squares are configured in Step 3 (Board & Players)."
        checked={gameData.squares_condition === true}
        onChange={(val) => handleChange("squares_condition", val)}
      />

      <ToggleRow
        title="Piece Count Condition"
        tooltip="The player with the most pieces on the board wins when no more moves can be made or when the board is full. Used in Othello/Reversi-style games."
        checked={gameData.piece_count_condition === true}
        onChange={(val) => handleChange("piece_count_condition", val)}
      />

      <ToggleRow
        title="Win on Promotion"
        tooltip="When enabled, a player instantly wins the game when they move a promotable piece onto a promotion square. The piece does not actually promote — reaching the square is enough to win. Requires promotion squares to be set in Step 3 and at least one piece with 'can promote' enabled."
        checked={gameData.promotion_condition === true}
        onChange={(val) => handleChange("promotion_condition", val)}
      />

      <ToggleRow
        title="Lose-All-Pieces Win (Anti-Chess)"
        tooltip="Anti-chess style: a player WINS as soon as they have lost all of their pieces. Combine with Forced Capture for a classic anti-chess (suicide chess) experience."
        checked={gameData.lose_all_pieces_condition === true}
        onChange={(val) => handleChange("lose_all_pieces_condition", val)}
      />

      <ToggleRow
        title="Stalemate Win"
        tooltip="When enabled, a stalemated player (no legal moves and not in check) WINS instead of the game being a draw. Useful for anti-chess variants and other games where being unable to move is a goal."
        checked={gameData.stalemate_win_condition === true}
        onChange={(val) => handleChange("stalemate_win_condition", val)}
      />

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Optional Condition ID <InfoTooltip text="Reference to a custom win condition defined externally. Leave empty unless you have a custom condition system set up." />
        </label>
        <NumberInput
          value={gameData.optional_condition || 0}
          onChange={(val) => handleChange("optional_condition", val || null)}
          options={{ min: 0, placeholder: "Leave empty if not applicable", className: styles["form-input-small"] }}
        />
      </div>

      <div className={styles["section-divider"]}></div>
      <h2 style={{ marginTop: '32px' }}>Draw Conditions</h2>
      <p className={styles["step-description"]}>
        Configure conditions that result in a draw (tie) instead of a win.
      </p>

      <ToggleRow
        title="Stalemate Draw Rule"
        tooltip="Standard chess behavior: if a player has no legal moves on their turn but is NOT in check, the game ends in a draw. Disable this only if you also use 'Stalemate Win', 'No Legal Moves Loss', or want stalemated players' turns to simply be skipped (a warning will be shown to both players in that case)."
        checked={gameData.stalemate_draw_condition !== false}
        onChange={(val) => handleChange("stalemate_draw_condition", val)}
      />

      <ToggleRow
        title="Move Limit Draw Rule"
        tooltip="Similar to chess's 50-move rule. The game ends in a draw after a set number of moves without any captures or promotable piece advances. A 'move' counts as one turn by each player (e.g., 50 moves = 50 turns by white + 50 turns by black)."
        checked={moveLimitEnabled}
        onChange={(val) => handleChange("draw_move_limit", val ? 50 : null)}
      >
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
      </ToggleRow>

      <ToggleRow
        title="Position Repetition Draw Rule"
        tooltip="Similar to chess's 3-fold repetition rule. The game ends in a draw when the same board position occurs N times. The position is considered the same when all pieces are on the same squares."
        checked={repetitionEnabled}
        onChange={(val) => handleChange("repetition_draw_count", val ? 3 : null)}
      >
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
      </ToggleRow>

      <ToggleRow
        title="Equal Piece Count Draw"
        tooltip="The game ends in a draw when both players have equal piece counts and neither player has valid moves remaining. Used in Othello/Reversi-style games."
        checked={otherData.equal_piece_count_draw === true}
        onChange={(val) => setOtherDataField("equal_piece_count_draw", val)}
      />

      <div className={styles["section-divider"]}></div>
      <h2 style={{ marginTop: '32px' }}>Gameplay Mechanics</h2>
      <p className={styles["step-description"]}>
        Configure special gameplay rules and actions.
      </p>

      <ToggleRow
        title="Place Pieces Action"
        tooltip="When enabled, players can spend actions to place pieces onto empty squares during their turn. The specific pieces available for placement are configured in Step 4 (Pieces)."
        checked={otherData.place_pieces_action === true}
        onChange={(val) => {
          const data = getOtherData();
          data.place_pieces_action = val;
          if (!val) data.placeable_pieces = [];
          updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
        }}
      />

      <ToggleRow
        title="Forced Capture"
        tooltip="When enabled, if any of your pieces can make a capturing move on your turn, you MUST make a capture (any capture). Used in Checkers-style and anti-chess games. Non-capture moves will be rejected when captures are available."
        checked={gameData.forced_capture_condition === true}
        onChange={(val) => handleChange("forced_capture_condition", val)}
      />

      <ToggleRow
        title="Flanking Captures"
        tooltip="When enabled, placing a piece that flanks opponent pieces in a line (horizontally, vertically, or diagonally) converts those opponent pieces to your color. Used in Othello/Reversi-style games."
        checked={otherData.flanking_captures === true}
        onChange={(val) => {
          const data = getOtherData();
          data.flanking_captures = val;
          if (!val) {
            data.must_flank = false;
            data.skip_turn_no_flank = false;
          }
          updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
        }}
      />

      {otherData.flanking_captures && (
        <ToggleRow
          title="Must Flank"
          tooltip="When enabled, players can only place pieces on squares that result in at least one flank. If no flanking placement is available, the player's turn is skipped."
          checked={otherData.must_flank === true}
          onChange={(val) => setOtherDataField("must_flank", val)}
        />
      )}

      {otherData.flanking_captures && otherData.must_flank && (
        <ToggleRow
          title="Skip Turn If No Flank"
          tooltip="When enabled, if a player has no valid flanking placements, their turn is automatically skipped. If both players have no valid placements, the game ends."
          checked={otherData.skip_turn_no_flank === true}
          onChange={(val) => setOtherDataField("skip_turn_no_flank", val)}
        />
      )}
    </div>
  );
};


export default Step2WinConditions;
