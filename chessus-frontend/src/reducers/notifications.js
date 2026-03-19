import * as types from "../actions/types";

const initialState = {
  notifications: [],
  unreadCount: 0,
  page: 1,
  loading: false,
  error: null,
};

export default function notificationsReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case types.GET_NOTIFICATIONS_SUCCESS:
      return {
        ...state,
        notifications: payload.page === 1 ? payload.notifications : [...state.notifications, ...payload.notifications],
        unreadCount: payload.unreadCount,
        page: payload.page,
        loading: false,
        error: null,
      };

    case types.GET_NOTIFICATIONS_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case types.GET_UNREAD_COUNT_SUCCESS:
      return {
        ...state,
        unreadCount: payload,
      };

    case types.MARK_NOTIFICATION_READ:
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === payload ? { ...n, is_read: 1 } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };

    case types.MARK_ALL_NOTIFICATIONS_READ:
      return {
        ...state,
        notifications: state.notifications.map((n) => ({ ...n, is_read: 1 })),
        unreadCount: 0,
      };

    case types.MARK_NOTIFICATION_ACTIONED:
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === payload ? { ...n, is_actioned: 1, is_read: 1 } : n
        ),
        unreadCount: state.notifications.find((n) => n.id === payload && !n.is_read)
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
      };

    case types.DELETE_NOTIFICATION: {
      const deleted = state.notifications.find((n) => n.id === payload);
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== payload),
        unreadCount: deleted && !deleted.is_read
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
      };
    }

    case types.NEW_NOTIFICATION:
      return {
        ...state,
        notifications: [payload, ...state.notifications],
        unreadCount: state.unreadCount + 1,
      };

    default:
      return state;
  }
}
