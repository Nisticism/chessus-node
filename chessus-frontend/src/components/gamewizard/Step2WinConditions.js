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


      <div className={styles["section-divider"]}></div>
      <h2>Game Mechanics</h2>
      <p className={styles["step-description"]}>
        Configure special gameplay rules and actions.
      </p>

      <div className={styles["condition-section"]}>
        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Actions Per Turn{' '}
            <InfoTooltip text="How many moves or actions each player can make during a single turn. In standard chess this is 1. Increase for games where players can move multiple pieces per turn. Maximum of 8 actions per turn." />
          </label>
          <NumberInput
            value={gameData.actions_per_turn || 1}
            onChange={(val) => handleChange("actions_per_turn", Math.min(8, Math.max(1, val)))}
            options={{ min: 1, max: 8, placeholder: "1", className: styles["form-input-small"] }}
          />
        </div>
      </div>

      <ToggleRow
        title="Simultaneous Turns"
        tooltip="Both players submit their moves secretly each round, then both moves resolve at the same time. Check is ignored, but checkmate still ends the game. If you and your opponent target the same square, both moves cancel. You may capture your own pieces — if you sacrifice one of your pieces on a square and your opponent moves there simultaneously, their piece is captured too (a trap mechanic). Requires exactly 1 action per turn."
        checked={!!gameData.simultaneous_turns}
        onChange={(val) => handleChange("simultaneous_turns", val)}
      >
        {gameData.actions_per_turn > 1 && (
          <p className={styles["validation-error"]} style={{ marginBottom: '0.75rem' }}>
            Simultaneous turns requires exactly 1 action per turn.
          </p>
        )}
        <div className={styles["sub-field"]}>
          <div className={styles["form-group"]} style={{ marginBottom: '0.75rem' }}>
            <label className={styles["form-label"]} style={{ fontSize: '0.85rem' }}>
              Submit mode{' '}
              <InfoTooltip text="Immediate (default): clicking a destination square locks in your move instantly. Stage & submit: pick a move, then press a Submit button to confirm — you can change your mind any time before pressing Submit." />
            </label>
            <select
              className={styles["form-input-small"]}
              style={{ background: 'rgba(0,0,0,0.55)', color: 'var(--text-heading)' }}
              value={gameData.simul_turns_submit_mode || 'immediate'}
              onChange={(e) => handleChange("simul_turns_submit_mode", e.target.value)}
            >
              <option value="immediate" style={{ background: '#1a1a1a', color: '#fff' }}>Immediate (click to lock)</option>
              <option value="stage" style={{ background: '#1a1a1a', color: '#fff' }}>Stage &amp; submit</option>
            </select>
          </div>

          <div className={styles["form-group"]} style={{ marginBottom: '0.75rem' }}>
            <label className={styles["form-label"]} style={{ fontSize: '0.85rem' }}>
              Draw after cancellations{' '}
              <InfoTooltip text="When both players target the same square, both moves cancel. After this many cancellations in a single game, the game ends in a draw. Set to 0 to never draw from cancellations." />
            </label>
            <NumberInput
              value={gameData.simul_turns_draw_after_cancellations ?? 3}
              onChange={(val) => handleChange("simul_turns_draw_after_cancellations", Math.min(99, Math.max(0, val | 0)))}
              options={{ min: 0, max: 99, placeholder: "3", className: styles["form-input-small"] }}
            />
          </div>

          <div className={styles["form-group"]} style={{ marginBottom: '0.75rem' }}>
            <label className={styles["form-label"]} style={{ fontSize: '0.85rem' }}>
              Place vs move conflict{' '}
              <InfoTooltip text="If you place a piece on a square the opponent moves onto in the same round: Cancel both (default) — both actions are discarded; Allow placement — the placement happens and the move is cancelled instead." />
            </label>
            <select
              className={styles["form-input-small"]}
              style={{ background: 'rgba(0,0,0,0.55)', color: 'var(--text-heading)' }}
              value={gameData.simul_turns_place_conflict || 'cancel'}
              onChange={(e) => handleChange("simul_turns_place_conflict", e.target.value)}
            >
              <option value="cancel" style={{ background: '#1a1a1a', color: '#fff' }}>Cancel both</option>
              <option value="allow" style={{ background: '#1a1a1a', color: '#fff' }}>Allow placement (cancel move)</option>
            </select>
          </div>

          <div className={styles["form-group"]} style={{ marginBottom: '0.75rem' }}>
            <label className={styles["form-label"]} style={{ fontSize: '0.85rem' }}>
              Free move after capture / promotion{' '}
              <InfoTooltip text="Disable (default): bonus free moves from captures or promotions are turned off in simul-turns games. Re-stage round: when a free move is awarded, both players get a fresh secret-submit cycle for the bonus action. Allow normally: keep free moves on (may give one player extra unanswered actions)." />
            </label>
            <select
              className={styles["form-input-small"]}
              style={{ background: 'rgba(0,0,0,0.55)', color: 'var(--text-heading)' }}
              value={gameData.simul_turns_free_move_after_capture || 'disable'}
              onChange={(e) => handleChange("simul_turns_free_move_after_capture", e.target.value)}
            >
              <option value="disable" style={{ background: '#1a1a1a', color: '#fff' }}>Disable in simul-turns</option>
              <option value="restage" style={{ background: '#1a1a1a', color: '#fff' }}>Re-stage round for both</option>
              <option value="allow" style={{ background: '#1a1a1a', color: '#fff' }}>Allow normally</option>
            </select>
          </div>

          <div className={styles["form-group"]} style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'center' }}>
            <ToggleSwitch
              checked={!!gameData.simul_turns_clock_pause}
              onChange={(val) => handleChange("simul_turns_clock_pause", val)}
              label={
                <span style={{ fontSize: '0.9rem' }}>
                  Hide clock ticking until both submit{' '}
                  <InfoTooltip text="Off (default): both clocks visibly tick down from the start of the game. Each player's clock stops when they submit their move. On: both clocks appear paused and only update their displayed time after both players have submitted, creating a clean reveal at the end of each round. (The actual time used per move is identical either way — this is a visibility setting.)" />
                </span>
              }
            />
          </div>

          {(gameData.capture_condition || gameData.mate_condition) && (
            <div className={styles["form-group"]} style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'center' }}>
              <ToggleSwitch
                checked={gameData.simul_turns_simultaneous_capture_draw !== false}
                onChange={(val) => handleChange("simul_turns_simultaneous_capture_draw", val)}
                label={
                  <span style={{ fontSize: '0.9rem' }}>
                    Draw on simultaneous capture of game-ending pieces{' '}
                    <InfoTooltip text="If both players capture each other's required-to-win piece in the same simul-turns round, the game ends in a draw instead of being won by whichever side resolved first. Default ON for simul-turns games with a capture or checkmate rule." />
                  </span>
                }
              />
            </div>
          )}

          {gameData.mate_condition && (
            <div className={styles["form-group"]} style={{ marginBottom: 0, display: 'flex', justifyContent: 'center' }}>
              <ToggleSwitch
                checked={gameData.simul_turns_simultaneous_checkmate_draw !== false}
                onChange={(val) => handleChange("simul_turns_simultaneous_checkmate_draw", val)}
                label={
                  <span style={{ fontSize: '0.9rem' }}>
                    Draw on simultaneous checkmate{' '}
                    <InfoTooltip text="If both players' moves leave the OTHER side in checkmate at the same time, the game ends in a draw. Default ON for simul-turns games with a checkmate rule." />
                  </span>
                }
              />
            </div>
          )}
        </div>
      </ToggleRow>

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
        title="Pre-game Repositions"
        tooltip="When enabled, before the game starts each player takes turns repositioning one of their own pieces to any empty, non-impassable square. Players alternate one reposition at a time. The game clock does not start until all repositions are complete."
        checked={!!gameData.start_repositions && gameData.start_repositions > 0}
        onChange={(val) => {
          handleChange("start_repositions", val ? 1 : 0);
          if (!val) handleChange("reposition_key_pieces_only", false);
        }}
      >
        <div className={styles["sub-option-row"]} style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className={styles["sub-option-label"]}>Repositions per player:</span>
          <NumberInput
            value={gameData.start_repositions || 1}
            onChange={(val) => handleChange("start_repositions", Math.min(8, Math.max(1, Math.floor(Number(val)) || 1)))}
            options={{ min: 1, max: 8 }}
          />
        </div>
        {(gameData.capture_condition || gameData.mate_condition) && (
          <div style={{ marginTop: '8px' }}>
            <ToggleSwitch
              checked={gameData.reposition_key_pieces_only === true}
              onChange={(val) => handleChange("reposition_key_pieces_only", val)}
              label={
                <span>
                  Restrict to key pieces only{' '}
                  <InfoTooltip text="When enabled, only pieces flagged as capture targets (ends game on capture) or checkmate pieces (ends game on checkmate) may be repositioned. Useful for repositioning king-like pieces before the game starts." />
                </span>
              }
            />
          </div>
        )}
      </ToggleRow>

      <ToggleRow
        title="Fog of War"
        tooltip="When enabled, each player can only see squares that are reachable by movement or attack from their own pieces. Squares outside this visible area are hidden by a smoky fog overlay — enemy pieces and special squares within the fog are concealed. Visibility updates whenever pieces move."
        checked={gameData.fog_of_war === true || gameData.fog_of_war === 1}
        onChange={(val) => {
          handleChange("fog_of_war", val);
          if (!val) handleChange("permanent_fog_reveal", false);
        }}
      >
        <ToggleRow
          title="Permanent Reveal"
          tooltip="Once a square is revealed by one of your pieces, it stays visible for the rest of the game — even after your pieces move away. Enemy pieces that later enter a revealed square are still hidden until a friendly piece can currently see that square."
          checked={gameData.permanent_fog_reveal === true || gameData.permanent_fog_reveal === 1}
          onChange={(val) => handleChange("permanent_fog_reveal", val)}
        />
      </ToggleRow>

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
