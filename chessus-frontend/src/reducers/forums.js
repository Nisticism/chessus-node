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
      return {
        ...state,
        forums: payload.forums || payload,
        pagination: payload.pagination || null,
      }
    case ALL_FORUMS_FAILURE:
      return {
        ...state,
        message: "Get forums failed"
      }
    case GET_FORUM_SUCCESS:
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
      const comments = state.forum.comments;
      // Collect IDs to delete (the comment + all nested replies)
      const idsToDelete = new Set();
      const collectReplies = (parentId) => {
        idsToDelete.add(parentId);
        comments.forEach(c => {
          if (c.parent_id === parentId) collectReplies(c.id);
        });
      };
      collectReplies(payload);
      const filteredComments = comments.filter(c => !idsToDelete.has(c.id));
      return {
        ...state,
        forum: {
          ...state.forum,
          comments: filteredComments
        }
      }
    }
    case COMMENT_EDIT_SUCCESS: {
      const comments = state.forum.comments;
      comments.forEach(function(comment, index) {
        if (comment.id === payload.id) {
          comment.content = payload.content;
          comment.last_updated_at = payload.last_updated_at;
        }
      });
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
        allForums.splice(deleteIndex, 1);
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
      const updatedForumsWithLike = state.forums.map(forum => 
        forum.id === state.forum?.id 
          ? { ...forum, likes: forum.likes ? forum.likes.concat(payload) : [payload] }
          : forum
      );
      return {
        ...state,
        forum: {
          ...state.forum,
          likes: state.forum.likes ? state.forum.likes.concat(payload) : [payload]
        },
        forums: updatedForumsWithLike
      }
    case LIKE_FAILURE:
      return {
        ...state,
        message: "Like failed"
      }
    case DELETE_LIKE:
      const newLikes = state.forum.likes.filter((like) => like.id !== payload);
      const updatedForumsWithoutLike = state.forums.map(forum =>
        forum.id === state.forum?.id
          ? { ...forum, likes: newLikes }
          : forum
      );
      return {
        ...state,
        forum: {
          ...state.forum,
          likes: newLikes
        },
        forums: updatedForumsWithoutLike
      }
    default:
      return state;
  }
};

export default forumsReducer;
