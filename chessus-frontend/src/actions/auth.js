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

export const register = (username, password, email) => (dispatch) => {
  return AuthService.register(username, password, email).then(
    (response) => {
      dispatch({
        type: REGISTER_SUCCESS,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: response.data.message,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: REGISTER_FAIL,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
};

export const getUser = (username) => (dispatch) => {
  return UserService.getUser(username).then(
    (response) => {
      console.log("in getUser action");
      dispatch({
        type: GET_USER_SUCCESS,
        payload: {response: response.result, message: response.message}
      });
      dispatch({
        type: SET_MESSAGE,
        payload: response.message,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
        console.log(message);
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
  );
};

export const edit = (current_user, username, password, email, first_name, last_name, bio, id, admin_id) => (dispatch) => {
  console.log(id);
  return AuthService.edit(current_user, username, password, email, first_name, last_name, bio, id, admin_id).then(
    (response) => {
      console.log("in edit action");
      console.log(response.message);
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
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: EDIT_FAIL,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
};

export const login = (username, password) => (dispatch) => {
  return AuthService.login(username, password).then(
    (data) => {
      dispatch({
        type: LOGIN_SUCCESS,
        payload: { user: data.result },
      });
      return Promise.resolve();
    },
    (error) => {
      console.log("logging error in auth actions");
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: LOGIN_FAIL,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
};

export const logout = () => (dispatch) => {
  AuthService.logout();
  dispatch({
    type: LOGOUT,
  });
};

export const deleteUser = (username, admin_id) => (dispatch) => {
  AuthService.deleteUser(username, admin_id).then(
    (response) => {
      if (admin_id) {
        console.log("admin attempting delete user from state")
          dispatch({
            type: DELETE_USER_ADMIN,
          });
          dispatch({
            type: SET_MESSAGE,
            payload: "User successfully deleted",
          })
          return Promise.resolve();
        } else {
          console.log("regular person attempting delete user from state")
          dispatch({
            type: DELETE_USER,
          });
          return Promise.resolve();
        }
    },
    (err) => {
      return Promise.reject();
    }
  ).then(console.log("Issue with user deletion"));
};

export const removeUsers = () => (dispatch) => {
  dispatch({
    type: REMOVE_USERS,
  });
};