import {
  REGISTER_SUCCESS,
  REGISTER_FAIL,
  LOGIN_SUCCESS,
  LOGIN_FAIL,
  LOGOUT,
  SET_MESSAGE,
  DELETE_USER,
  DELETE_USER_ADMIN,
  REMOVE_USERS,
  EDIT_SUCCESS,
  EDIT_SUCCESS_ADMIN,
  EDIT_FAIL,
  GET_USER_SUCCESS,
  GET_USER_FAILURE,
} from "./types";
import AuthService from "../services/auth.service";
import UserService from "../services/user.service";
import { getErrorMessage } from "../helpers/error-handler";

export const register = (username, password, email) => async (dispatch) => {
  try {
    const response = await AuthService.register(username, password, email);
    dispatch({
      type: REGISTER_SUCCESS,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: response.data.message,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: REGISTER_FAIL,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
};

export const getUser = (username) => async (dispatch) => {
  try {
    const response = await UserService.getUser(username);
    dispatch({
      type: GET_USER_SUCCESS,
      payload: {response: response.result, message: response.message}
    });
    dispatch({
      type: SET_MESSAGE,
      payload: response.message,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: GET_USER_FAILURE,
      payload: {response: null, message: message},
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
};

export const edit = (current_user, username, password, email, first_name, last_name, bio, id, admin_id, oldPassword, show_display_name) => async (dispatch) => {
  try {
    const response = await AuthService.edit(current_user, username, password, email, first_name, last_name, bio, id, admin_id, oldPassword, show_display_name);
    if (!admin_id) {
      dispatch({
        type: EDIT_SUCCESS,
        payload: { user: response.result },
      });
    } else {
      dispatch({
        type: EDIT_SUCCESS_ADMIN,
        payload: { admin_id: admin_id, user: response.result, message: response.message },
      });
    }
    dispatch({
      type: SET_MESSAGE,
      payload: response.message,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: EDIT_FAIL,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
};

export const login = (username, password) => async (dispatch) => {
  try {
    const data = await AuthService.login(username, password);
    dispatch({
      type: LOGIN_SUCCESS,
      payload: { user: data.result },
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: LOGIN_FAIL,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
};

export const googleLogin = (credential) => async (dispatch) => {
  try {
    const data = await AuthService.googleLogin(credential);
    dispatch({
      type: LOGIN_SUCCESS,
      payload: { user: data.result },
    });
    return Promise.resolve(data);
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: LOGIN_FAIL,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
};

export const lichessLogin = (code, codeVerifier, redirectUri) => async (dispatch) => {
  try {
    const data = await AuthService.lichessLogin(code, codeVerifier, redirectUri);
    dispatch({
      type: LOGIN_SUCCESS,
      payload: { user: data.result },
    });
    return Promise.resolve(data);
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: LOGIN_FAIL,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
};

export const logout = () => async (dispatch) => {
  await AuthService.logout();
  dispatch({
    type: LOGOUT,
  });
};

export const deleteUser = (username, admin_id) => async (dispatch) => {
  try {
    await AuthService.deleteUser(username, admin_id);
    if (admin_id) {
      dispatch({
        type: DELETE_USER_ADMIN,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: "User successfully deleted",
      });
      return Promise.resolve();
    } else {
      dispatch({
        type: DELETE_USER,
      });
      return Promise.resolve();
    }
  } catch (err) {
    return Promise.reject();
  }
};

export const removeUsers = () => (dispatch) => {
  dispatch({
    type: REMOVE_USERS,
  });
};