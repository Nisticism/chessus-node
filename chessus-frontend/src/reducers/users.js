import {
  LIST_USERS,
  LIST_USERS_FAIL,
  REMOVE_USERS,
} from "../actions/types";

const initialState = {};
  
export default function (state = initialState, action) {
  const { type, payload } = action;
  switch (type) {
    case LIST_USERS:
      return {
        ...state,
        usersList: payload.users || payload,
        pagination: payload.pagination || null,
      };
    case LIST_USERS_FAIL:
      return {
        ...state,
        usersList: null,
        pagination: null,
        message: "User list failed",
      };
    case REMOVE_USERS:
      const newState = {...state};
      delete newState["usersList"];
      delete newState["pagination"];
      return newState;
    default:
      return state;
  }
}