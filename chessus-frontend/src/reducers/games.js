import {
  GET_GAMES_SUCCESS,
  GET_GAMES_FAIL,
  CREATE_GAME_SUCCESS,
  CREATE_GAME_FAIL,
} from "../actions/types";

const initialState = {
  gamesList: [],
  loading: false,
  error: null,
};

export default function gamesReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case GET_GAMES_SUCCESS:
      return {
        ...state,
        gamesList: payload,
        loading: false,
        error: null,
      };

    case GET_GAMES_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case CREATE_GAME_SUCCESS:
      return {
        ...state,
        gamesList: [payload.game, ...state.gamesList],
      };

    case CREATE_GAME_FAIL:
      return {
        ...state,
        error: payload,
      };

    default:
      return state;
  }
}
