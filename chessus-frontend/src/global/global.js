// const API_URL = "https://squarestrat.com/";
const API_URL = (process.env.REACT_APP_API_URL || "") + "/api/";

// Piece Wizard UI Text Constants
export const PIECE_WIZARD_TEXT = {
  AVAILABLE_FOR_FIRST_MOVES: "First N moves only",
  MOVES_LABEL: "moves",
  EXACT_LABEL: "Exact",
  INFINITE_LABEL: "Infinite",
  VALUE_LABEL: "Value",
  REMOVE_LABEL: "Remove",
  ALT_LABEL: "Alt"
};

export default API_URL;