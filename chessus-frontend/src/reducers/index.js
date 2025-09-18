import { combineReducers } from "redux";
import auth from "./auth";
import message from "./message";
import chessReducer from "./chessReducer";
import users from "./users";
import forums from "./forums";
import news from "./news";
export default combineReducers({
  auth,
  message,
  chessReducer,
  users,
  forums,
  news,
});