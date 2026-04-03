import axios from "axios";
import * as types from "./types";
import API_URL from "../global/global";
import authHeader from "../services/auth-header";

export const getConversations = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}users/${userId}/conversations`, {
      headers: authHeader(),
    });
    dispatch({
      type: types.GET_CONVERSATIONS_SUCCESS,
      payload: response.data.conversations,
    });
    return response.data.conversations;
  } catch (error) {
    dispatch({
      type: types.GET_CONVERSATIONS_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

export const getMessages = (userId, otherUserId, page = 1) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}users/${userId}/messages/${otherUserId}`, {
      params: { page },
      headers: authHeader(),
    });
    dispatch({
      type: types.GET_MESSAGES_SUCCESS,
      payload: { messages: response.data.messages, otherUserId, page },
    });
    return response.data.messages;
  } catch (error) {
    dispatch({
      type: types.GET_MESSAGES_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

export const sendMessage = (userId, recipientId, content) => async (dispatch) => {
  try {
    const response = await axios.post(
      `${API_URL}users/${userId}/messages`,
      { recipientId, content },
      { headers: authHeader() }
    );
    dispatch({
      type: types.SEND_MESSAGE_SUCCESS,
      payload: response.data.message,
    });
    return response.data.message;
  } catch (error) {
    dispatch({
      type: types.SEND_MESSAGE_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

export const markMessagesRead = (userId, otherUserId) => async (dispatch) => {
  try {
    await axios.put(`${API_URL}users/${userId}/messages/${otherUserId}/read`, {}, {
      headers: authHeader(),
    });
    dispatch({
      type: types.MARK_DM_READ,
      payload: otherUserId,
    });
  } catch (error) {
    console.error("Error marking messages read:", error);
  }
};

export const getUnreadDMCount = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}users/${userId}/messages/unread-count`, {
      headers: authHeader(),
    });
    dispatch({
      type: types.GET_UNREAD_DM_COUNT_SUCCESS,
      payload: response.data.unreadCount,
    });
    return response.data.unreadCount;
  } catch (error) {
    console.error("Error fetching unread DM count:", error);
  }
};

export const receiveDirectMessage = (message) => ({
  type: types.NEW_DIRECT_MESSAGE,
  payload: message,
});
