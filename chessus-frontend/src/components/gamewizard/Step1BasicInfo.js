import React from "react";
import styles from "./gamewizard.module.scss";

const Step1BasicInfo = ({ gameData, updateGameData }) => {
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
          Description <span className={styles["required"]}>*</span>
        </label>
        <textarea
          className={styles["form-textarea"]}
          value={gameData.descript}
          onChange={(e) => handleChange("descript", e.target.value)}
          placeholder="Describe your game (50-8000 characters)"
          rows={6}
          maxLength={8000}
        />
        <div className={styles["char-count"]}>
          {gameData.descript.length} / 8000 characters
        </div>
        {gameData.descript && gameData.descript.length < 50 && (
          <p className={styles["validation-error"]}>
            Description must be at least 50 characters
          </p>
        )}
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Rules <span className={styles["required"]}>*</span>
        </label>
        <textarea
          className={styles["form-textarea"]}
          value={gameData.rules}
          onChange={(e) => handleChange("rules", e.target.value)}
          placeholder="Enter the game rules (can be auto-generated later based on pieces and objectives)"
          rows={8}
          maxLength={8000}
        />
        <div className={styles["char-count"]}>
          {gameData.rules.length} / 8000 characters
        </div>
        <p className={styles["field-hint"]}>
          You can provide basic rules now or let the system auto-generate them based on your pieces and win conditions.
        </p>
      </div>
    </div>
  );
};

export default Step1BasicInfo;
