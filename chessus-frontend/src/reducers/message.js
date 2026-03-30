import { SET_MESSAGE, CLEAR_MESSAGE } from "../actions/types";

const initialState = {};
const messageReducer = function (state = initialState, action) {
  const { type, payload } = action;
  switch (type) {
    case SET_MESSAGE:
      console.log("message set in message reducer")
      return { message: payload };
    case CLEAR_MESSAGE:
      return { message: "" };
    default:
      return state;
  }
}

export default messageReducer;