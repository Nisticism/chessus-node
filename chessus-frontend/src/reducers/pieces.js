import {
  LIST_PIECES,
  LIST_PIECES_FAIL,
  REMOVE_PIECES,
  SET_PIECE_VALUE_CACHE,
  INVALIDATE_PIECE_VALUE_CACHE,
} from "../actions/types";

const initialState = {};
  
const piecesReducer = function (state = initialState, action) {
  const { type, payload } = action;
  switch (type) {
    case LIST_PIECES:
      return {
        ...state,
        piecesList: payload.pieces || payload,
        pagination: payload.pagination || null,
      };
    case LIST_PIECES_FAIL:
      return {
        ...state,
        piecesList: null,
        pagination: null,
        message: "Pieces list failed",
      };
    case REMOVE_PIECES: {
      const newState = {...state};
      delete newState["piecesList"];
      delete newState["pagination"];
      return newState;
    }
    case SET_PIECE_VALUE_CACHE:
      return {
        ...state,
        pieceValueCache: {
          ...(state.pieceValueCache || {}),
          [payload.pieceId]: payload.value,
        },
      };
    case INVALIDATE_PIECE_VALUE_CACHE: {
      const updated = { ...(state.pieceValueCache || {}) };
      delete updated[payload.pieceId];
      return { ...state, pieceValueCache: updated };
    }
    default:
      return state;
  }
}

export default piecesReducer;
