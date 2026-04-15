import {
  SET_LOBBY_OPEN_GAMES,
  SET_LOBBY_ONGOING_GAMES,
  SET_LOBBY_PRIVATE_GAMES,
  ADD_LOBBY_OPEN_GAME,
  REMOVE_LOBBY_OPEN_GAME,
  LOBBY_GAME_STARTED,
} from "../actions/types";

const initialState = {
  openGames: [],
  ongoingGames: [],
  privateGames: [],
};

const lobbyGames = (state = initialState, action) => {
  switch (action.type) {
    case SET_LOBBY_OPEN_GAMES:
      return { ...state, openGames: action.payload };
    case SET_LOBBY_ONGOING_GAMES:
      return { ...state, ongoingGames: action.payload };
    case SET_LOBBY_PRIVATE_GAMES:
      return { ...state, privateGames: action.payload };
    case ADD_LOBBY_OPEN_GAME:
      return { ...state, openGames: [action.payload, ...state.openGames] };
    case REMOVE_LOBBY_OPEN_GAME:
      return {
        ...state,
        openGames: state.openGames.filter(
          (g) => g.id !== action.payload && g.gameId !== action.payload
        ),
      };
    case LOBBY_GAME_STARTED:
      return {
        ...state,
        openGames: state.openGames.filter(
          (g) => g.id !== action.payload && g.gameId !== action.payload
        ),
        privateGames: state.privateGames.filter(
          (g) => g.id !== action.payload && g.gameId !== action.payload
        ),
      };
    default:
      return state;
  }
};

export default lobbyGames;
