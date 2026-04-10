import React, { useState } from "react";
import styles from "./gamewizard.module.scss";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "../piecewizard/InfoTooltip";
import { validateContent, checkForLinks, checkOffensiveContent } from "../../utils/contentModeration";

const Step1BasicInfo = ({ gameData, updateGameData, currentUser }) => {
  const [contentWarnings, setContentWarnings] = useState({});

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
          warnings[field] = 'Links and URLs are not allowed in this field. Please remove any links.';
        }
      }
      setContentWarnings(prev => ({ ...prev, [field]: warnings[field] || null }));
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
        <label className={styles["checkbox-label"]}>
          <input
            type="checkbox"
            checked={gameData.simultaneous_turns || false}
            onChange={(e) => handleChange("simultaneous_turns", e.target.checked)}
            disabled={gameData.actions_per_turn > 1}
          />
          <span>Simultaneous turns</span>
          <InfoTooltip text="Both players submit their moves secretly, then both moves are revealed and executed at the same time. Incompatible with multiple actions per turn." />
        </label>
        {gameData.simultaneous_turns && (
          <p className={styles["field-hint"]}>
            ⚠ Experimental: Both players choose their move in secret. Moves are revealed and resolved simultaneously. Some mechanics (multi-action turns, piece placement) are not compatible.
          </p>
        )}
        {gameData.actions_per_turn > 1 && gameData.simultaneous_turns && (
          <p className={styles["validation-error"]}>
            Simultaneous turns requires exactly 1 action per turn.
          </p>
        )}
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["checkbox-label"]}>
          <input
            type="checkbox"
            checked={!currentUser || gameData.is_anonymous_creator}
            onChange={(e) => handleChange("is_anonymous_creator", e.target.checked)}
            disabled={!currentUser}
          />
          <span>Create anonymously</span>
        </label>
        <p className={styles["field-hint"]}>
          {!currentUser
            ? "You are not logged in — your game will be created anonymously."
            : "When checked, your username will not be shown publicly as the creator of this game."}
        </p>
      </div>
    </div>
  );
};

export default Step1BasicInfo;
