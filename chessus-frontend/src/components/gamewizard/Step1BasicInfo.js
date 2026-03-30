import React from "react";
import styles from "./gamewizard.module.scss";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "../piecewizard/InfoTooltip";

const Step1BasicInfo = ({ gameData, updateGameData, currentUser }) => {
  const handleChange = (field, value) => {
    updateGameData({ [field]: value });
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
          Actions Per Turn <InfoTooltip text="How many moves or actions each player can make during a single turn. In standard chess this is 1. Increase for games where players can move multiple pieces per turn." />
        </label>
        <NumberInput
          value={gameData.actions_per_turn || 1}
          onChange={(val) => handleChange("actions_per_turn", Math.max(1, val))}
          options={{ min: 1, placeholder: "1", className: styles["form-input-small"] }}
        />
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
