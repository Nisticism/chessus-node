import React, { useState } from "react";
import styles from "./gamewizard.module.scss";
import NumberInput from "../common/NumberInput";
import ToggleSwitch from "../common/ToggleSwitch";
import InfoTooltip from "../piecewizard/InfoTooltip";
import { checkForLinks, checkOffensiveContent, checkProfessionalName } from "../../utils/contentModeration";
import LinkInsertButton from "../common/LinkInsertButton";

const Step1BasicInfo = ({ gameData, updateGameData, currentUser }) => {
  const [contentWarnings, setContentWarnings] = useState({});
  const [nameReviewWarning, setNameReviewWarning] = useState(false);

  const handleChange = (field, value) => {
    updateGameData({ [field]: value });

    // Real-time content validation for text fields
    if (['game_name', 'descript', 'rules'].includes(field) && value) {
      const warnings = {};
      const offCheck = checkOffensiveContent(value);
      if (!offCheck.isClean) {
        warnings[field] = 'This text contains inappropriate language. Please revise before submitting.';
      } else {
        const linkCheck = checkForLinks(value);
        if (linkCheck.hasLinks) {
          const hasDisallowedLinks = linkCheck.links.some((link) => {
            if (/^https?:\/\//.test(link)) {
              return !/^https?:\/\/(?:www\.)?gridgrove\.gg(?:\/|$)/i.test(link);
            }
            return !/^(?:www\.)?gridgrove\.gg(?:\/|$)/i.test(link);
          });
          if (hasDisallowedLinks) {
            warnings[field] = 'Only gridgrove.gg links are supported. Please remove external links.';
          }
        }
      }
      setContentWarnings(prev => ({ ...prev, [field]: warnings[field] || null }));

      // Professional name check: warn that the game name will require moderator review
      if (field === 'game_name') {
        const profCheck = checkProfessionalName(value);
        setNameReviewWarning(!profCheck.isProfessional);
      }
    }
    if (field === 'game_name' && !value) {
      setNameReviewWarning(false);
    }
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Basic Game Information</h2>
      <p className={styles["step-description"]}>
        Enter the basic details about your custom game type.
      </p>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Game Name <span className={styles["required"]}>*</span>
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={gameData.game_name}
          onChange={(e) => handleChange("game_name", e.target.value)}
          placeholder="Enter game name (3-50 characters)"
          maxLength={50}
        />
        {gameData.game_name && gameData.game_name.length < 3 && (
          <p className={styles["validation-error"]}>
            Game name must be at least 3 characters
          </p>
        )}
        {contentWarnings.game_name && (
          <p className={styles["validation-error"]}>
            {contentWarnings.game_name}
          </p>
        )}
        {nameReviewWarning && !contentWarnings.game_name && (
          <p className={styles["validation-warning"]} style={{ color: '#e67e22', fontSize: '0.875rem', marginTop: '4px' }}>
            This name contains terms that require moderator review. Your game will be hidden from public listings until it is approved.
          </p>
        )}
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Description
        </label>
        <textarea
          className={styles["form-textarea"]}
          value={gameData.descript}
          onChange={(e) => handleChange("descript", e.target.value)}
          placeholder="Describe your game (optional)"
          rows={6}
          maxLength={8000}
        />
        <div className={styles["char-count"]}>
          {gameData.descript.length} / 8000 characters
        </div>
        <div style={{ marginTop: '6px' }}>
          <LinkInsertButton onInsert={(text) => handleChange("descript", gameData.descript + text)} />
        </div>
        {contentWarnings.descript && (
          <p className={styles["validation-error"]}>
            {contentWarnings.descript}
          </p>
        )}
      </div>

      {/* Player count hidden - currently only 2-player games supported */}
      {/* <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Number of Players <span className={styles["required"]}>*</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', width: '100%', maxWidth: '400px' }}>
            <span style={{ minWidth: '15px', color: 'var(--text-light-gray)' }}>2</span>
            <input
              type="range"
              min="2"
              max="8"
              value={gameData.player_count || 2}
              onChange={(e) => handleChange("player_count", parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: '15px', color: 'var(--text-light-gray)' }}>8</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>
            {gameData.player_count || 2}
          </div>
        </div>
        <p className={styles["field-hint"]}>
          Set the number of players who can participate in this game (2-8).
        </p>
      </div> */}

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Actions Per Turn <InfoTooltip text="How many moves or actions each player can make during a single turn. In standard chess this is 1. Increase for games where players can move multiple pieces per turn. Maximum of 8 actions per turn." />
        </label>
        <NumberInput
          value={gameData.actions_per_turn || 1}
          onChange={(val) => handleChange("actions_per_turn", Math.min(8, Math.max(1, val)))}
          options={{ min: 1, max: 8, placeholder: "1", className: styles["form-input-small"] }}
        />
      </div>

      <div className={styles["form-group"]}>
        <ToggleSwitch
          checked={!!gameData.simultaneous_turns}
          onChange={(val) => handleChange("simultaneous_turns", val)}
          disabled={gameData.actions_per_turn > 1}
          label={
            <span>
              Simultaneous turns{' '}
              <InfoTooltip text="Both players submit their moves secretly each round, then both moves resolve at the same time. Check is ignored, but checkmate still ends the game; if you and your opponent target the same square, both moves cancel. Requires exactly 1 action per turn." />
            </span>
          }
        />
        {gameData.actions_per_turn > 1 && gameData.simultaneous_turns && (
          <p className={styles["validation-error"]}>
            Simultaneous turns requires exactly 1 action per turn.
          </p>
        )}

        {gameData.simultaneous_turns && gameData.actions_per_turn <= 1 && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', borderLeft: '3px solid var(--primary-color)', background: 'var(--background-darker, rgba(0,0,0,0.15))', borderRadius: '4px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--text-light-gray)' }}>
              Simultaneous turns options
            </div>

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

            <div className={styles["form-group"]} style={{ marginBottom: 0, display: 'flex', justifyContent: 'center' }}>
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
              <div className={styles["form-group"]} style={{ marginBottom: 0, display: 'flex', justifyContent: 'center' }}>
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
        )}
      </div>

      <div className={styles["form-group"]}>
        <ToggleSwitch
          checked={!currentUser || !!gameData.is_anonymous_creator}
          onChange={(val) => handleChange("is_anonymous_creator", val)}
          disabled={!currentUser}
          label={
            <span>
              Create anonymously{' '}
              <InfoTooltip text={!currentUser ? "You are not logged in — your game will be created anonymously." : "When enabled, your username will not be shown publicly as the creator of this game."} />
            </span>
          }
        />
      </div>
    </div>
  );
};

export default Step1BasicInfo;
