import * as types from "../actions/types";

const initialState = {
  friends: [],
  onlineFriends: [],
  onlineUsers: [],
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
      return {
        ...state,
        friends: [...state.friends, payload],
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

    default:
      return state;
  }
}
