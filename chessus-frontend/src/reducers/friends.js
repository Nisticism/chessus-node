import * as types from "../actions/types";

const initialState = {
  friends: [],
  onlineFriends: [],
  onlineUsers: [],
  incomingRequests: [],
  outgoingRequests: [],
  loading: false,
  error: null,
};

export default function friendsReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case types.GET_FRIENDS_SUCCESS:
      return {
        ...state,
        friends: payload,
        loading: false,
        error: null,
      };

    case types.GET_FRIENDS_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case types.ADD_FRIEND_SUCCESS:
      // Friend request sent - add to outgoing requests
      return {
        ...state,
        outgoingRequests: [...state.outgoingRequests, payload],
        error: null,
      };

    case types.ADD_FRIEND_FAIL:
      return {
        ...state,
        error: payload,
      };

    case types.REMOVE_FRIEND_SUCCESS:
      return {
        ...state,
        friends: state.friends.filter((friend) => friend.id !== payload),
        error: null,
      };

    case types.REMOVE_FRIEND_FAIL:
      return {
        ...state,
        error: payload,
      };

    case types.GET_ONLINE_FRIENDS_SUCCESS:
      return {
        ...state,
        onlineFriends: payload,
        loading: false,
        error: null,
      };

    case types.GET_ONLINE_FRIENDS_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case types.SET_ONLINE_USERS:
      return {
        ...state,
        onlineUsers: payload,
      };

    // Friend Requests
    case types.GET_INCOMING_REQUESTS_SUCCESS:
      return {
        ...state,
        incomingRequests: payload,
        loading: false,
        error: null,
      };

    case types.GET_INCOMING_REQUESTS_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case types.GET_OUTGOING_REQUESTS_SUCCESS:
      return {
        ...state,
        outgoingRequests: payload,
        loading: false,
        error: null,
      };

    case types.GET_OUTGOING_REQUESTS_FAIL:
      return {
        ...state,
        loading: false,
        error: payload,
      };

    case types.ACCEPT_FRIEND_REQUEST_SUCCESS:
      return {
        ...state,
        incomingRequests: state.incomingRequests.filter(
          (req) => req.request_id !== payload.requestId
        ),
        friends: [...state.friends, payload.friend],
        error: null,
      };

    case types.ACCEPT_FRIEND_REQUEST_FAIL:
      return {
        ...state,
        error: payload,
      };

    case types.DECLINE_FRIEND_REQUEST_SUCCESS:
      return {
        ...state,
        incomingRequests: state.incomingRequests.filter(
          (req) => req.request_id !== payload
        ),
        error: null,
      };

    case types.DECLINE_FRIEND_REQUEST_FAIL:
      return {
        ...state,
        error: payload,
      };

    case types.CANCEL_FRIEND_REQUEST_SUCCESS:
      return {
        ...state,
        outgoingRequests: state.outgoingRequests.filter(
          (req) => req.request_id !== payload
        ),
        error: null,
      };

    case types.CANCEL_FRIEND_REQUEST_FAIL:
      return {
        ...state,
        error: payload,
      };

    default:
      return state;
  }
}
