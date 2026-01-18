import {
  CREATE_GAME_SUCCESS,
  CREATE_GAME_FAIL,
  SET_MESSAGE,
} from "./types";
import { getErrorMessage } from "../helpers/error-handler";
import axios from "axios";
import API_URL from "../global/global";
import authHeader from "../services/auth-header";

export const createGame = (gameData) => async (dispatch) => {
  try {
    const response = await axios.post(
      API_URL + "games/create",
      gameData,
      { headers: authHeader() }
    );
    
    dispatch({
      type: CREATE_GAME_SUCCESS,
      payload: { game: response.data.result },
    });
    
    dispatch({
      type: SET_MESSAGE,
      payload: response.data.message || "Game created successfully!",
    });
    
    return Promise.resolve(response.data);
  } catch (error) {
    const message = getErrorMessage(error);
    
    dispatch({
      type: CREATE_GAME_FAIL,
    });
    
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    
    return Promise.reject(error);
  }
};
