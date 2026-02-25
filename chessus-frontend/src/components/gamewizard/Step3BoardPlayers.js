import React from "react";
import styles from "./gamewizard.module.scss";
import GameBoard from "../gameboard/GameBoard";
import NumberInput from "../common/NumberInput";

const Step3BoardPlayers = ({ gameData, updateGameData }) => {
  const handleChange = (field, value) => {
    updateGameData({ [field]: value });
  };

  const handleSliderChange = (field, value) => {
    updateGameData({ [field]: parseInt(value) });
  };

  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  return (
    <div className={styles["step-container"]}>
      <h2>Board Setup & Players</h2>
      <p className={styles["step-description"]}>
        Configure the game board dimensions and player settings.
      </p>

      {/* Board Preview */}
      <div className={styles["board-preview"]}>
        <h3>Board Preview</h3>
        <GameBoard 
          horizontal={gameData.board_width} 
          vertical={gameData.board_height}
          topLeftLight={true}
          squareLength={Math.min(60, 480 / Math.max(gameData.board_width, gameData.board_height))}
          lightSquareColor={lightSquareColor}
          darkSquareColor={darkSquareColor}
        />
      </div>

      <div className={styles["form-row"]}>
        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Board Width <span className={styles["required"]}>*</span>
          </label>
          <NumberInput
            value={gameData.board_width}
            onChange={(val) => handleChange("board_width", Math.max(1, Math.min(48, val)))}
            options={{ min: 1, max: 48, className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>1-48 squares</p>
        </div>

        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Board Height <span className={styles["required"]}>*</span>
          </label>
          <NumberInput
            value={gameData.board_height}
            onChange={(val) => handleChange("board_height", Math.max(1, Math.min(48, val)))}
            options={{ min: 1, max: 48, className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>1-48 squares</p>
        </div>
      </div>

      {/* Player Count hidden - currently only 2-player games supported */}
      {/* <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Number of Players <span className={styles["required"]}>*</span>
        </label>
        <div className={styles["slider-container"]}>
          <input
            type="range"
            className={styles["slider"]}
            min="2"
            max="8"
            value={gameData.player_count}
            onChange={(e) => handleSliderChange("player_count", e.target.value)}
          />
          <div className={styles["slider-value"]}>{gameData.player_count} Players</div>
        </div>
        <div className={styles["slider-labels"]}>
          <span>2</span>
          <span>8</span>
        </div>
      </div> */}

      {/* Actions Per Turn */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Actions Per Turn <span className={styles["required"]}>*</span>
        </label>
        <NumberInput
          value={gameData.actions_per_turn}
          onChange={(val) => handleChange("actions_per_turn", Math.max(1, val))}
          options={{ min: 1, placeholder: "1", className: styles["form-input-small"] }}
        />
        <p className={styles["field-hint"]}>
          How many moves/actions each player can make per turn (typically 1)
        </p>
      </div>
    </div>
  );
};

export default Step3BoardPlayers;
