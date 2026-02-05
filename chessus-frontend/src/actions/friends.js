import axios from "axios";
import * as types from "./types";
import API_URL from "../global/global";
import authHeader from "../services/auth-header";

// Get user's friends list
export const getFriends = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}users/${userId}/friends`);
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

// Send a friend request
export const addFriend = (userId, friendId) => async (dispatch) => {
  try {
    const response = await axios.post(
      `${API_URL}users/${userId}/friends`,
      { friendId },
      {
        headers: authHeader(),
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
export const removeFriend = (userId, friendId) => async (dispatch) => {
  try {
    await axios.delete(`${API_URL}users/${userId}/friends/${friendId}`, {
      headers: authHeader(),
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

// Check friendship status (returns object with status info)
export const checkFriendshipStatus = (userId, friendId) => async (dispatch) => {
  try {
    const response = await axios.get(
      `${API_URL}users/${userId}/friends/${friendId}/status`
    );
    return response.data;
  } catch (error) {
    console.error("Error checking friendship status:", error);
    return { status: 'none', areFriends: false };
  }
};

// Get online friends
export const getOnlineFriends = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}users/${userId}/friends/online`);
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

// Get incoming friend requests
export const getIncomingRequests = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(
      `${API_URL}users/${userId}/friend-requests/incoming`,
      { headers: authHeader() }
    );
    dispatch({
      type: types.GET_INCOMING_REQUESTS_SUCCESS,
      payload: response.data,
    });
    return response.data;
  } catch (error) {
    dispatch({
      type: types.GET_INCOMING_REQUESTS_FAIL,
      payload: error.response?.data?.message || error.message,
    });
    throw error;
  }
};

// Get outgoing friend requests
export const getOutgoingRequests = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(
      `${API_URL}users/${userId}/friend-requests/outgoing`,
      { headers: authHeader() }
    );
    dispatch({
      type: types.GET_OUTGOING_REQUESTS_SUCCESS,
      payload: response.data,
    });
    return response.data;
  } catch (error) {
    dispatch({
      type: types.GET_OUTGOING_REQUESTS_FAIL,
      payload: error.response?.data?.message || error.message,
    });
    throw error;
  }
};

// Accept a friend request
export const acceptFriendRequest = (userId, requestId) => async (dispatch) => {
  try {
    const response = await axios.post(
      `${API_URL}users/${userId}/friend-requests/${requestId}/accept`,
      {},
      { headers: authHeader() }
    );
    dispatch({
      type: types.ACCEPT_FRIEND_REQUEST_SUCCESS,
      payload: { requestId, friend: response.data.friend },
    });
    return response.data;
  } catch (error) {
    dispatch({
      type: types.ACCEPT_FRIEND_REQUEST_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

// Decline a friend request
export const declineFriendRequest = (userId, requestId) => async (dispatch) => {
  try {
    await axios.post(
      `${API_URL}users/${userId}/friend-requests/${requestId}/decline`,
      {},
      { headers: authHeader() }
    );
    dispatch({
      type: types.DECLINE_FRIEND_REQUEST_SUCCESS,
      payload: requestId,
    });
  } catch (error) {
    dispatch({
      type: types.DECLINE_FRIEND_REQUEST_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

// Cancel a sent friend request
export const cancelFriendRequest = (userId, requestId) => async (dispatch) => {
  try {
    await axios.delete(
      `${API_URL}users/${userId}/friend-requests/${requestId}`,
      { headers: authHeader() }
    );
    dispatch({
      type: types.CANCEL_FRIEND_REQUEST_SUCCESS,
      payload: requestId,
    });
  } catch (error) {
    dispatch({
      type: types.CANCEL_FRIEND_REQUEST_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};
