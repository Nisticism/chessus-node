import {
  POST_SUCCESS,
  POST_FAILURE,
  ALL_FORUMS,
  ALL_FORUMS_FAILURE,
  GET_FORUM_SUCCESS,
  GET_FORUM_FAILURE,
  COMMENT_SUCCESS,
  COMMENT_FAILURE,
  DELETE_COMMENT,
  COMMENT_EDIT_SUCCESS,
  COMMENT_EDIT_FAILURE,
  EDIT_POST_SUCCESS,
  EDIT_POST_FAILURE,
  DELETE_FORUM,
  DELETE_FORUM_FAILURE,
  LIKE_SUCCESS,
  LIKE_FAILURE,
  DELETE_LIKE,
  FIRST_FORUMS_RENDER,
} from "../actions/types";

const initialState = {first_forums_render: false, forums: [{id: -1, title: "Loading", created_at: "Loading", content: "Loading"}]};
// const initialState = {};
const forumsReducer = (state = initialState, action) => {
  const { type, payload } = action;
  switch (type) {
    case POST_SUCCESS:
      return {
        ...state,
        forum: payload,
        forums: [...state.forums, payload],
      };
    case POST_FAILURE:
      return initialState;
    case ALL_FORUMS:
      console.log("in all forums success");
      // console.log(payload);
      return {
        ...state,
        forums: payload,
      }
    case ALL_FORUMS_FAILURE:
      return {
        ...state,
        message: "Get forums failed"
      }
    case GET_FORUM_SUCCESS:
      console.log("in get forum post succeeded reducer")
      return {
        ...state,
        forum: payload,
      }
    case GET_FORUM_FAILURE:
      return {
        ...state,
        message: "Get Forum Post failed"
      }
    case FIRST_FORUMS_RENDER:
      return {
        ...state,
        first_forums_render: true,
      }
    case COMMENT_SUCCESS:
      return {
        ...state,
        forum: {
          ...state.forum,
          comments: state.forum.comments ? state.forum.comments.concat(payload) : [payload]
        }
      }
    case COMMENT_FAILURE: {
      return {
        ...state,
        message: "Comment failed"
      }
    }
    case DELETE_COMMENT: {
      // const comments = Object.entries({...state.forum.comments});
      const comments = state.forum.comments;
      console.log(comments);
      console.log("in delete comment reducer", payload);
      let deleteIndex;
      comments.forEach(function(comment, index) {
        if (comment.id === payload) {
          deleteIndex = index;
        }
      });
      comments.splice(deleteIndex, 1);
      console.log(comments);
      // const newCommentsObject = Object.assign({}, ...newComments);
      return {
        ...state,
        forum: {
          ...state.forum,
          comments: comments
        }
      }
    }
    case COMMENT_EDIT_SUCCESS: {
      const comments = state.forum.comments;
      console.log("in edit comment reducer", payload);
      comments.forEach(function(comment, index) {
        if (comment.id === payload.id) {
          comment.content = payload.content;
          comment.last_updated_at = payload.last_updated_at;
        }
      });
      console.log(comments);
      return {
        ...state,
        forum: {
          ...state.forum,
          comments: comments
        }
      }
    }
    case COMMENT_EDIT_FAILURE: {
      return {
        ...state,
        message: "Comment edit failed"
      }
    }
    case EDIT_POST_SUCCESS:
      return {
        ...state,
        forum: {
          ...state.forum,

        }
      }
    case EDIT_POST_FAILURE:
      return {
        ...state,
        message: "Post edit failed"
      }
    case DELETE_FORUM:
      let deleteIndex;
      if (state.forums) {
        let allForums = state.forums;
        allForums.forEach(function(forum, index) {
          if (forum.id === payload) {
            deleteIndex = index;
          }
        });
        console.log("all forums: " + allForums);
        allForums.splice(deleteIndex, 1);
        console.log("all forums: " + allForums);
        return {
          ...state,
          forums: allForums,
          forum: null
        }
      } else {
        return {
          ...state,
          forum: null
        }
      }
    case DELETE_FORUM_FAILURE:
    case LIKE_SUCCESS:
      return {
        ...state,
        forum: {
          ...state.forum,
          likes: state.forum.likes ? state.forum.likes.concat(payload) : [payload]
        }
      }
    case LIKE_FAILURE:
      return {
        ...state,
        message: "Like failed"
      }
    case DELETE_LIKE:
      const newLikes = state.forum.likes.filter((like) => like.id != payload);
      return {
        ...state,
        forum: {
          ...state.forum,
          likes: newLikes
        }
      }
    default:
      return state;
  }
};

export default forumsReducer;
