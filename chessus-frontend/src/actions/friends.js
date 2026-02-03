import axios from "axios";
import * as types from "./types";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3001/api";

// Get user's friends list
export const getFriends = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}/users/${userId}/friends`);
    dispatch({
      type: types.GET_FRIENDS_SUCCESS,
      payload: response.data,
    });
    return response.data;
  } catch (error) {
    dispatch({
      type: types.GET_FRIENDS_FAIL,
      payload: error.response?.data?.message || error.message,
    });
    throw error;
  }
};

// Add a friend
export const addFriend = (userId, friendId) => async (dispatch, getState) => {
  try {
    const token = getState().authReducer.user?.token;
    const response = await axios.post(
      `${API_URL}/users/${userId}/friends`,
      { friendId },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    dispatch({
      type: types.ADD_FRIEND_SUCCESS,
      payload: response.data.friend,
    });
    return response.data;
  } catch (error) {
    dispatch({
      type: types.ADD_FRIEND_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

// Remove a friend
export const removeFriend = (userId, friendId) => async (dispatch, getState) => {
  try {
    const token = getState().authReducer.user?.token;
    await axios.delete(`${API_URL}/users/${userId}/friends/${friendId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    dispatch({
      type: types.REMOVE_FRIEND_SUCCESS,
      payload: friendId,
    });
  } catch (error) {
    dispatch({
      type: types.REMOVE_FRIEND_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

// Check friendship status
export const checkFriendshipStatus = (userId, friendId) => async (dispatch) => {
  try {
    const response = await axios.get(
      `${API_URL}/users/${userId}/friends/${friendId}/status`
    );
    return response.data.areFriends;
  } catch (error) {
    console.error("Error checking friendship status:", error);
    return false;
  }
};

// Get online friends
export const getOnlineFriends = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}/users/${userId}/friends/online`);
    dispatch({
      type: types.GET_ONLINE_FRIENDS_SUCCESS,
      payload: response.data,
    });
    return response.data;
  } catch (error) {
    dispatch({
      type: types.GET_ONLINE_FRIENDS_FAIL,
      payload: error.response?.data?.message || error.message,
    });
    throw error;
  }
};

// Set online users (from socket)
export const setOnlineUsers = (userIds) => (dispatch) => {
  dispatch({
    type: types.SET_ONLINE_USERS,
    payload: userIds,
  });
};
