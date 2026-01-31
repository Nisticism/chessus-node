import {
  CREATE_GAME_SUCCESS,
  CREATE_GAME_FAIL,
  GET_GAMES_SUCCESS,
  GET_GAMES_FAIL,
  UPDATE_GAME_SUCCESS,
  UPDATE_GAME_FAIL,
  DELETE_GAME_SUCCESS,
  DELETE_GAME_FAIL,
  SET_MESSAGE,
} from "./types";
import { getErrorMessage } from "../helpers/error-handler";
import axios from "../services/axios-interceptor";
import API_URL from "../global/global";
import authHeader from "../services/auth-header";

export const getGames = () => async (dispatch) => {
  try {
    const response = await axios.get(API_URL + "games");
    
    dispatch({
      type: GET_GAMES_SUCCESS,
      payload: response.data,
    });
    
    return Promise.resolve(response.data);
  } catch (error) {
    const message = getErrorMessage(error);
    
    dispatch({
      type: GET_GAMES_FAIL,
    });
    
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    
    return Promise.reject(error);
  }
};

export const getGameById = (gameId) => async () => {
  try {
    const response = await axios.get(API_URL + "games/" + gameId);
    return Promise.resolve(response.data);
  } catch (error) {
    return Promise.reject(error);
  }
};

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

export const updateGame = (gameId, gameData) => async (dispatch) => {
  try {
    const response = await axios.put(
      API_URL + "games/" + gameId,
      gameData,
      { headers: authHeader() }
    );
    
    dispatch({
      type: UPDATE_GAME_SUCCESS,
      payload: { game: response.data.game },
    });
    
    dispatch({
      type: SET_MESSAGE,
      payload: response.data.message || "Game updated successfully!",
    });
    
    return Promise.resolve(response.data);
  } catch (error) {
    const message = getErrorMessage(error);
    
    dispatch({
      type: UPDATE_GAME_FAIL,
    });
    
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    
    return Promise.reject(error);
  }
};

export const deleteGame = (gameId) => async (dispatch) => {
  try {
    const response = await axios.delete(
      API_URL + "games/" + gameId,
      { headers: authHeader() }
    );
    
    dispatch({
      type: DELETE_GAME_SUCCESS,
      payload: { gameId },
    });
    
    dispatch({
      type: SET_MESSAGE,
      payload: response.data.message || "Game deleted successfully!",
    });
    
    return Promise.resolve(response.data);
  } catch (error) {
    const message = getErrorMessage(error);
    
    dispatch({
      type: DELETE_GAME_FAIL,
    });
    
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    
    return Promise.reject(error);
  }
};
