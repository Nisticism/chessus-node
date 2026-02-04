import {
  LIST_USERS,
  LIST_USERS_FAIL,
  SET_MESSAGE,
  CLEAR_PLAYER_PAGE,
} from "./types";
import UsersService from "../services/users.service";
import { getErrorMessage } from "../helpers/error-handler";

export const clearPlayerPage = () => ({
  type: CLEAR_PLAYER_PAGE,
});

export const users = (page = 1, limit = 20) => async (dispatch) => {
  try {
    const response = await UsersService.getUsers(page, limit);
    console.log("users action");
    dispatch({
      type: LIST_USERS,
      payload: response.data,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: LIST_USERS_FAIL,
    });
    return Promise.reject();
  }
};