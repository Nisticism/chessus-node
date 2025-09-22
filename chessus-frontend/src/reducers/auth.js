import {
  REGISTER_SUCCESS,
  REGISTER_FAIL,
  EDIT_SUCCESS,
  EDIT_SUCCESS_ADMIN,
  EDIT_FAIL,
  LOGIN_SUCCESS,
  LOGIN_FAIL,
  LOGOUT,
  DELETE_USER,
  DELETE_USER_ADMIN,
  GET_USER_SUCCESS,
  GET_USER_FAILURE,
} from "../actions/types";

const user = JSON.parse(localStorage.getItem("user"));
const initialState = user
  ? { isLoggedIn: true, user }
  : { isLoggedIn: false, user: null};
  
const authReducer = (state = initialState, action) => {
  const { type, payload } = action;
  switch (type) {
    case GET_USER_SUCCESS:
      console.log("in get user success");
      return {
        ...state,
        playerPage: payload.response,
        message: payload.message,
      }
    case GET_USER_FAILURE:
      console.log("in get user failure");
      return {
        ...state,
        playerPage: payload.response,
        message: payload.message
      }
    case REGISTER_SUCCESS:
      return {
        ...state,
        isLoggedIn: false,
      };
    case REGISTER_FAIL:
      return {
        ...state,
        isLoggedIn: false,
      };
    case EDIT_SUCCESS:
      console.log("in edit reducer - edit success");
      return {
        ...state,
        user: payload.user,
        message: payload.message,
      }
    case EDIT_SUCCESS_ADMIN:
      console.log("in edit success admin");
      if (payload.user && payload.user.id && payload.user.id !== payload.admin_id) {
        console.log("editting someone else");
        return {
          ...state,
          playerPage: payload.user,
          adminId: payload.admin_id,
          message: payload.message,
        }
      } else {
        console.log("editting yourself");
        return {
          ...state,
          user: payload.user,
          playerPage: payload.user,
          adminId: payload.admin_id,
          message: payload.message,
        }
      }
    case EDIT_FAIL:
      console.log("in edit reducer - edit fail");
      return {
        ...state,
      }
    case LOGIN_SUCCESS:
      return {
        ...state,
        isLoggedIn: true,
        user: payload.user,
      };
    case LOGIN_FAIL:
      return {
        ...state,
        isLoggedIn: false,
        user: null,
      };
    case LOGOUT:
      return {
        ...state,
        isLoggedIn: false,
        user: null,
      };
    case DELETE_USER:
      return {
        ...state,
        isLoggedIn: false,
        user: null,
      }
    case DELETE_USER_ADMIN:
      return {
        ...state,
      }
    default:
      return state;
  }
}

export default authReducer;