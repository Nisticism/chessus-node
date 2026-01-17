import {
  LIST_USERS,
  LIST_USERS_FAIL,
  SET_MESSAGE,
} from "./types";
import UsersService from "../services/users.service";
import { getErrorMessage } from "../helpers/error-handler";

export const users = () => async (dispatch) => {
  try {
    const response = await UsersService.getUsers();
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