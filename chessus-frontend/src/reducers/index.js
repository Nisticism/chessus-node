import { combineReducers } from "redux";
import authReducer from "./authReducer";
import message from "./message";
import chessReducer from "./chessReducer";
import users from "./users";
import forums from "./forums";
import news from "./news";
export default combineReducers({
  authReducer,
  message,
  chessReducer,
  users,
  forums,
  news,
});