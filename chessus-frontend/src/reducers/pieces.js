import {
  LIST_PIECES,
  LIST_PIECES_FAIL,
  REMOVE_PIECES,
} from "../actions/types";

const initialState = {};
  
export default function (state = initialState, action) {
  const { type, payload } = action;
  switch (type) {
    case LIST_PIECES:
      return {
        ...state,
        piecesList: payload,
      };
    case LIST_PIECES_FAIL:
      return {
        ...state,
        piecesList: null,
        message: "Pieces list failed",
      };
    case REMOVE_PIECES:
      const newState = {...state};
      delete newState["piecesList"];
      return newState;
    default:
      return state;
  }
}
