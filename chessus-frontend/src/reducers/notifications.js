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
        // A later page can repeat rows: live notifications arriving in between
        // shift the offset the next page is read from.
        notifications: payload.page === 1
          ? payload.notifications
          : [...state.notifications, ...payload.notifications.filter((n) => !state.notifications.some((m) => m.id === n.id))],
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

    case types.NEW_NOTIFICATION: {
      /*
       * A pushed notification is either new or an unread one brought up to
       * date (another move or chat line in the same game) - same id, so it
       * replaces the old entry at the top rather than adding a second one, and
       * is not counted twice. Without an id it cannot be shown properly (no
       * key, nothing to mark read), so it only counts. The server sends the
       * exact unread count straight after, which settles any guess here.
       */
      if (!payload) return state;
      if (payload.id == null) return { ...state, unreadCount: state.unreadCount + 1 };
      const previous = state.notifications.find((n) => n.id === payload.id);
      const countsNow = !payload.is_read && (!previous || previous.is_read);
      return {
        ...state,
        notifications: [payload, ...state.notifications.filter((n) => n.id !== payload.id)],
        unreadCount: state.unreadCount + (countsNow ? 1 : 0),
      };
    }

    default:
      return state;
  }
}
