import * as types from "../actions/types";

const initialState = {
  conversations: [],
  activeMessages: [],
  activeConversationUserId: null,
  unreadDMCount: 0,
  loading: false,
  error: null,
};

export default function messagesReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case types.GET_CONVERSATIONS_SUCCESS:
      return {
        ...state,
        conversations: payload,
        loading: false,
        error: null,
      };

    case types.GET_CONVERSATIONS_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case types.GET_MESSAGES_SUCCESS:
      return {
        ...state,
        activeMessages: payload.page === 1 ? payload.messages : [...payload.messages, ...state.activeMessages],
        activeConversationUserId: payload.otherUserId,
        loading: false,
        error: null,
      };

    case types.GET_MESSAGES_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case types.SEND_MESSAGE_SUCCESS:
      return {
        ...state,
        activeMessages: [...state.activeMessages, payload],
        conversations: state.conversations.map((c) =>
          c.user_id === payload.recipient_id
            ? { ...c, last_message: payload.content, last_message_time: payload.created_at, last_sender_id: payload.sender_id }
            : c
        ),
      };

    case types.NEW_DIRECT_MESSAGE: {
      const senderId = payload.sender_id;
      const isActiveConversation = state.activeConversationUserId === senderId;
      return {
        ...state,
        activeMessages: isActiveConversation
          ? [...state.activeMessages, payload]
          : state.activeMessages,
        unreadDMCount: isActiveConversation ? state.unreadDMCount : state.unreadDMCount + 1,
        conversations: state.conversations.some((c) => c.user_id === senderId)
          ? state.conversations.map((c) =>
              c.user_id === senderId
                ? {
                    ...c,
                    last_message: payload.content,
                    last_message_time: payload.created_at,
                    last_sender_id: senderId,
                    unread_count: isActiveConversation ? 0 : (c.unread_count || 0) + 1,
                  }
                : c
            )
          : [
              {
                user_id: senderId,
                username: payload.sender_username,
                profile_picture: payload.sender_profile_picture,
                last_message: payload.content,
                last_message_time: payload.created_at,
                last_sender_id: senderId,
                unread_count: isActiveConversation ? 0 : 1,
              },
              ...state.conversations,
            ],
      };
    }

    case types.MARK_DM_READ: {
      const otherUserId = payload;
      const conv = state.conversations.find((c) => c.user_id === otherUserId);
      const unreadReduction = conv?.unread_count || 0;
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.user_id === otherUserId ? { ...c, unread_count: 0 } : c
        ),
        unreadDMCount: Math.max(0, state.unreadDMCount - unreadReduction),
      };
    }

    case types.GET_UNREAD_DM_COUNT_SUCCESS:
      return {
        ...state,
        unreadDMCount: payload,
      };

    default:
      return state;
  }
}
