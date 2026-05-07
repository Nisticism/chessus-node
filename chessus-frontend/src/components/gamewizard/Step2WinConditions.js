import React, { useMemo } from "react";
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

  // Count max checkmate-flagged pieces per player (for mate_condition_requires_all warning)
  const maxCheckmatePerPlayer = useMemo(() => {
    try {
      const piecesObj = JSON.parse(gameData.pieces_string || '{}');
      const piecesArr = Array.isArray(piecesObj) ? piecesObj : Object.values(piecesObj);
      const perPlayer = {};
      piecesArr.forEach(p => {
        if (p && p.ends_game_on_checkmate && !p._occupied && !p._anchorKey) {
          const pid = String(p.player_id ?? p.player_number ?? 1);
          perPlayer[pid] = (perPlayer[pid] || 0) + 1;
        }
      });
      return Math.max(0, ...Object.values(perPlayer), 0);
    } catch { return 0; }
  }, [gameData.pieces_string]);

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
            disabled={maxCheckmatePerPlayer > 4}
            size="small"
            label={
              <span className={styles["condition-toggle-title"]}>
                Require <em>all</em> checkmate-flagged pieces to be checkmated
                <InfoTooltip text="By default, putting any single piece marked 'End game on checkmate' (in Step 4) into checkmate ends the game. When this option is checked, ALL such pieces belonging to a player must be simultaneously under lethal attack with no legal escape, AND capturing one such piece does not end the game until none remain. This makes checkmate very hard to achieve — useful when promotion can create additional checkmate-flagged pieces." />
              </span>
            }
          />
          {maxCheckmatePerPlayer > 4 && (
            <p className={styles["error-text"]} style={{ marginTop: 4, textAlign: 'left', padding: '4px 0' }}>
              Disabled — a player has {maxCheckmatePerPlayer} checkmate pieces (max 4 allowed for this option). Reduce checkmate-flagged pieces in Step 4.
            </p>
          )}
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

      <ToggleRow
        title="Points Win Condition"
        tooltip="A player wins by accumulating a set number of points. Points are earned by capturing pieces with a 'Capture Points Gain' value (set per piece in Step 4), or by occupying custom squares that have a 'Control Points' value (set in the Custom Squares editor in Step 3). The win threshold is checked at the end of each player's half-move — if both players cross the threshold on the same move, the game ends in a draw. Optional: give each player starting points to create asymmetric or handicap games."
        checked={gameData.points_to_win != null}
        onChange={(val) => handleChange("points_to_win", val ? 10 : null)}
      >
        <div className={styles["sub-field"]}>
          <label className={styles["form-label"]}>Points needed to win</label>
          <NumberInput
            value={gameData.points_to_win || 10}
            onChange={(val) => handleChange("points_to_win", Math.max(1, Math.min(9999, val)))}
            options={{ min: 1, max: 9999, placeholder: "10", className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>
            Win check happens at end of each player's half-move, after captures and control-square points are computed.
          </p>
        </div>
        <div className={styles["sub-field"]}>
          <label className={styles["form-label"]}>Player 1 starting points</label>
          <NumberInput
            value={gameData.starting_points_p1 || 0}
            onChange={(val) => handleChange("starting_points_p1", Math.max(0, Math.min(9999, val)))}
            options={{ min: 0, max: 9999, placeholder: "0", className: styles["form-input-small"] }}
          />
        </div>
        <div className={styles["sub-field"]}>
          <label className={styles["form-label"]}>Player 2 starting points</label>
          <NumberInput
            value={gameData.starting_points_p2 || 0}
            onChange={(val) => handleChange("starting_points_p2", Math.max(0, Math.min(9999, val)))}
            options={{ min: 0, max: 9999, placeholder: "0", className: styles["form-input-small"] }}
          />
        </div>
      </ToggleRow>

      <div className={styles["sub-field"]}>
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

      <ToggleRow
        title="Equal Points at Turn N — Draw"
        tooltip="If both players have equal scores when the game reaches a specific turn number, the game ends in a draw. Requires the Points Win Condition to be enabled. The turn count uses full turns (one turn = one move per player), so turn 20 = 40 half-moves."
        checked={gameData.draw_equal_points_at_turn != null}
        onChange={(val) => handleChange("draw_equal_points_at_turn", val ? 20 : null)}
      >
        <div className={styles["sub-field"]}>
          <label className={styles["form-label"]}>Draw at turn number (full turns)</label>
          <NumberInput
            value={gameData.draw_equal_points_at_turn || 20}
            onChange={(val) => handleChange("draw_equal_points_at_turn", Math.max(1, Math.min(9999, val)))}
            options={{ min: 1, max: 9999, placeholder: "20", className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>
            E.g. 20 means the draw check fires at move 20 for each player (40 half-moves total).
          </p>
        </div>
      </ToggleRow>

      <ToggleRow
        title="Consecutive Equal-Score Turns — Draw"
        tooltip="If both players have equal scores for N consecutive half-moves (individual player moves), the game ends in a draw. Requires the Points Win Condition to be enabled. Useful for preventing indefinite stalling when scores are locked."
        checked={gameData.draw_equal_points_consecutive != null}
        onChange={(val) => handleChange("draw_equal_points_consecutive", val ? 10 : null)}
      >
        <div className={styles["sub-field"]}>
          <label className={styles["form-label"]}>Consecutive equal-score half-moves before draw</label>
          <NumberInput
            value={gameData.draw_equal_points_consecutive || 10}
            onChange={(val) => handleChange("draw_equal_points_consecutive", Math.max(1, Math.min(999, val)))}
            options={{ min: 1, max: 999, placeholder: "10", className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>
            Each individual player move counts as one half-move.
          </p>
        </div>
      </ToggleRow>


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
