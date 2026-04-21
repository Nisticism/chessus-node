import {
  SET_LOBBY_OPEN_GAMES,
  SET_LOBBY_ONGOING_GAMES,
  SET_LOBBY_PRIVATE_GAMES,
  SET_LOBBY_MY_BOT_GAMES,
  ADD_LOBBY_OPEN_GAME,
  REMOVE_LOBBY_OPEN_GAME,
  REMOVE_LOBBY_GAME,
  LOBBY_GAME_STARTED,
} from "../actions/types";

const initialState = {
  openGames: [],
  ongoingGames: [],
  privateGames: [],
  myBotGames: [],
};

const lobbyGames = (state = initialState, action) => {
  switch (action.type) {
    case SET_LOBBY_OPEN_GAMES:
      return { ...state, openGames: action.payload };
    case SET_LOBBY_ONGOING_GAMES:
      return { ...state, ongoingGames: action.payload };
    case SET_LOBBY_PRIVATE_GAMES:
      return { ...state, privateGames: action.payload };
    case SET_LOBBY_MY_BOT_GAMES:
      return { ...state, myBotGames: action.payload };
    case ADD_LOBBY_OPEN_GAME:
      return { ...state, openGames: [action.payload, ...state.openGames] };
    case REMOVE_LOBBY_OPEN_GAME:
      return {
        ...state,
        openGames: state.openGames.filter(
          (g) => g.id !== action.payload && g.gameId !== action.payload
        ),
      };
    case REMOVE_LOBBY_GAME: {
      // Optimistically strip a game from every lobby list (used after admin
      // delete so the card disappears immediately, without waiting for the
      // socket round-trip refresh).
      const matches = (g) => g.id !== action.payload && g.gameId !== action.payload;
      return {
        ...state,
        openGames: state.openGames.filter(matches),
        ongoingGames: state.ongoingGames.filter(matches),
        privateGames: state.privateGames.filter(matches),
        myBotGames: state.myBotGames.filter(matches),
      };
    }
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
