import { SET_MESSAGE, CLEAR_MESSAGE, RESET_EDIT } from "./types";
export const setMessage = (message) => ({
  type: SET_MESSAGE,
  payload: message,
});
export const clearMessage = () => ({
  type: CLEAR_MESSAGE,
});
export const resetEdit = () => ({
  type: RESET_EDIT,
})