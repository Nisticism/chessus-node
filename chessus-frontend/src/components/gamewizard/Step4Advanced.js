import React from "react";
import styles from "./gamewizard.module.scss";

const Step4Advanced = ({ gameData, updateGameData }) => {
  const handleChange = (field, value) => {
    updateGameData({ [field]: value });
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Advanced Settings</h2>
      <p className={styles["step-description"]}>
        Configure advanced game features and special square types.
      </p>

      {/* Pieces String - will be populated from piece creator */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Pieces Configuration
        </label>
        <textarea
          className={styles["form-textarea-code"]}
          value={gameData.pieces_string}
          onChange={(e) => handleChange("pieces_string", e.target.value)}
          placeholder='JSON array of pieces: [{"id": 1, "name": "King", ...}]'
          rows={4}
        />
        <p className={styles["field-hint"]}>
          This will be automatically populated when you create pieces using the piece creator tool.
          You can also manually enter a JSON array of piece configurations.
        </p>
      </div>

      {/* Range Squares */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Range Squares
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={gameData.range_squares_string || ""}
          onChange={(e) => handleChange("range_squares_string", e.target.value)}
          placeholder="e.g., (3,3),(5,5) - coordinates of squares that increase piece range"
          maxLength={1000}
        />
        <p className={styles["field-hint"]}>
          Squares that increase the movement/attack range of pieces standing on them.
        </p>
      </div>

      {/* Promotion Squares */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Promotion Squares
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={gameData.promotion_squares_string || ""}
          onChange={(e) => handleChange("promotion_squares_string", e.target.value)}
          placeholder="e.g., (0,7),(7,7) - coordinates where pieces can be promoted"
          maxLength={1000}
        />
        <p className={styles["field-hint"]}>
          Squares where pieces can be promoted to different piece types.
        </p>
      </div>

      {/* Special Squares */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Special Squares
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={gameData.special_squares_string || ""}
          onChange={(e) => handleChange("special_squares_string", e.target.value)}
          placeholder="e.g., (4,4):teleport - coordinates with special properties"
          maxLength={1000}
        />
        <p className={styles["field-hint"]}>
          Squares with special effects or properties.
        </p>
      </div>

      {/* Randomized Starting Positions */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Randomized Starting Positions
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={gameData.randomized_starting_positions || ""}
          onChange={(e) => handleChange("randomized_starting_positions", e.target.value)}
          placeholder="e.g., Chess960 style randomization rules"
          maxLength={1000}
        />
        <p className={styles["field-hint"]}>
          Configuration for randomizing piece starting positions (like Chess960).
        </p>
      </div>

      {/* Other Game Data */}
      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Additional Game Data (JSON)
        </label>
        <textarea
          className={styles["form-textarea-code"]}
          value={gameData.other_game_data || ""}
          onChange={(e) => handleChange("other_game_data", e.target.value)}
          placeholder='{"custom_rules": [], "special_mechanics": {}}'
          rows={6}
        />
        <p className={styles["field-hint"]}>
          Any additional game configuration in JSON format for future extensions.
        </p>
      </div>

      <div className={styles["summary-section"]}>
        <h3>Summary</h3>
        <div className={styles["summary-item"]}>
          <strong>Game Name:</strong> {gameData.game_name || "Not set"}
        </div>
        <div className={styles["summary-item"]}>
          <strong>Board Size:</strong> {gameData.board_width} × {gameData.board_height}
        </div>
        <div className={styles["summary-item"]}>
          <strong>Players:</strong> 2
        </div>
        <div className={styles["summary-item"]}>
          <strong>Win Conditions:</strong>{" "}
          {[
            gameData.mate_condition && "Checkmate",
            gameData.capture_condition && "Capture",
            gameData.value_condition && "Points",
            gameData.squares_condition && "Control Squares",
            gameData.hill_condition && "King of the Hill"
          ].filter(Boolean).join(", ") || "None set"}
        </div>
      </div>
    </div>
  );
};

export default Step4Advanced;
