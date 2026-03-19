import axios from "axios";
import * as types from "./types";
import API_URL from "../global/global";
import authHeader from "../services/auth-header";

export const getNotifications = (userId, page = 1) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}users/${userId}/notifications`, {
      params: { page },
      headers: authHeader(),
    });
    dispatch({
      type: types.GET_NOTIFICATIONS_SUCCESS,
      payload: response.data,
    });
    return response.data;
  } catch (error) {
    dispatch({
      type: types.GET_NOTIFICATIONS_FAIL,
      payload: error.response?.data?.error || error.message,
    });
    throw error;
  }
};

export const getUnreadCount = (userId) => async (dispatch) => {
  try {
    const response = await axios.get(`${API_URL}users/${userId}/notifications/unread-count`, {
      headers: authHeader(),
    });
    dispatch({
      type: types.GET_UNREAD_COUNT_SUCCESS,
      payload: response.data.unreadCount,
    });
    return response.data.unreadCount;
  } catch (error) {
    console.error("Error fetching unread count:", error);
  }
};

export const markNotificationRead = (userId, notificationId) => async (dispatch) => {
  try {
    await axios.put(`${API_URL}users/${userId}/notifications/${notificationId}/read`, {}, {
      headers: authHeader(),
    });
    dispatch({
      type: types.MARK_NOTIFICATION_READ,
      payload: notificationId,
    });
  } catch (error) {
    console.error("Error marking notification read:", error);
  }
};

export const markAllNotificationsRead = (userId) => async (dispatch) => {
  try {
    await axios.put(`${API_URL}users/${userId}/notifications/read-all`, {}, {
      headers: authHeader(),
    });
    dispatch({
      type: types.MARK_ALL_NOTIFICATIONS_READ,
    });
  } catch (error) {
    console.error("Error marking all notifications read:", error);
  }
};

export const markNotificationActioned = (userId, notificationId) => async (dispatch) => {
  try {
    await axios.put(`${API_URL}users/${userId}/notifications/${notificationId}/action`, {}, {
      headers: authHeader(),
    });
    dispatch({
      type: types.MARK_NOTIFICATION_ACTIONED,
      payload: notificationId,
    });
  } catch (error) {
    console.error("Error actioning notification:", error);
  }
};

export const deleteNotification = (userId, notificationId) => async (dispatch) => {
  try {
    await axios.delete(`${API_URL}users/${userId}/notifications/${notificationId}`, {
      headers: authHeader(),
    });
    dispatch({
      type: types.DELETE_NOTIFICATION,
      payload: notificationId,
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
  }
};

export const receiveNewNotification = (notification) => (dispatch) => {
  dispatch({
    type: types.NEW_NOTIFICATION,
    payload: notification,
  });
};
