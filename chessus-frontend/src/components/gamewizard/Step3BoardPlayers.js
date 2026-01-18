import React from "react";
import styles from "./gamewizard.module.scss";
import GameBoard from "../gameboard/GameBoard";

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
          <input
            type="number"
            className={styles["form-input-small"]}
            value={gameData.board_width}
            onChange={(e) => {
              const value = parseInt(e.target.value) || 1;
              handleChange("board_width", Math.max(1, Math.min(96, value)));
            }}
            min="1"
            max="96"
          />
          <p className={styles["field-hint"]}>1-96 squares</p>
        </div>

        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Board Height <span className={styles["required"]}>*</span>
          </label>
          <input
            type="number"
            className={styles["form-input-small"]}
            value={gameData.board_height}
            onChange={(e) => {
              const value = parseInt(e.target.value) || 1;
              handleChange("board_height", Math.max(1, Math.min(96, value)));
            }}
            min="1"
            max="96"
          />
          <p className={styles["field-hint"]}>1-96 squares</p>
        </div>
      </div>

      {/* Player Count Slider */}
      <div className={styles["form-group"]}>
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
          <span>3</span>
          <span>4</span>
          <span>5</span>
          <span>6</span>
          <span>7</span>
          <span>8</span>
        </div>
      </div>

      {/* Actions Per Turn */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Actions Per Turn <span className={styles["required"]}>*</span>
        </label>
        <input
          type="number"
          className={styles["form-input-small"]}
          value={gameData.actions_per_turn}
          onChange={(e) => {
            const value = parseInt(e.target.value) || 1;
            handleChange("actions_per_turn", Math.max(1, value));
          }}
          min="1"
          placeholder="1"
        />
        <p className={styles["field-hint"]}>
          How many moves/actions each player can make per turn (typically 1)
        </p>
      </div>

      {/* Starting Piece Count */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Starting Piece Count
        </label>
        <input
          type="number"
          className={styles["form-input-small"]}
          value={gameData.starting_piece_count}
          onChange={(e) => {
            const value = parseInt(e.target.value) || 0;
            handleChange("starting_piece_count", Math.max(0, value));
          }}
          min="0"
          placeholder="0"
        />
        <p className={styles["field-hint"]}>
          Total number of pieces at the start of the game (will be configured in piece setup)
        </p>
      </div>
    </div>
  );
};

export default Step3BoardPlayers;
