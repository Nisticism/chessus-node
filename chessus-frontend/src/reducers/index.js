import { combineReducers } from "redux";
import authReducer from "./authReducer";
import message from "./message";
import chessReducer from "./chessReducer";
import users from "./users";
import forums from "./forums";
import news from "./news";
import pieces from "./pieces";
import games from "./games";
import friends from "./friends";
import notifications from "./notifications";
import messages from "./messages";
export default combineReducers({
  authReducer,
  message,
  chessReducer,
  users,
  forums,
  news,
  pieces,
  games,
  friends,
  notifications,
  messages,
});