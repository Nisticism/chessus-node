import {
  POST_SUCCESS,
  POST_FAILURE,
  SET_MESSAGE,
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
} from "./types";
import ForumsService from "../services/forums.service";

export const firstForumsRender = (first_render) => (dispatch) => {
  dispatch({
    type: FIRST_FORUMS_RENDER,
    payload: true,
  });
}

// update arguments
export const newForum = (author_id, title, content, created_at) => (dispatch) => {
  return ForumsService.newForum(author_id, title, content, created_at).then(
    (response) => {
      console.log("dispatching post success");
      console.log(response.result);
      dispatch({
        type: POST_SUCCESS,
        payload: response.result,
      });
      // dispatch({
      //   type: FIRST_FORUMS_RENDER,
      //   payload: false,
      // });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: POST_FAILURE,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
};

export const editForum = (title, content, last_updated_at, id) => (dispatch) => {
  return ForumsService.editForum(title, content, last_updated_at, id).then(
    (response) => {
      console.log("dispatching edit forum success");
      console.log(response.result);
      dispatch({
        type: EDIT_POST_SUCCESS,
        payload: response.result,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: EDIT_POST_FAILURE,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
};

export const forums = () => (dispatch) => {
  return ForumsService.getForums().then(
    (response) => {
      console.log("in forums action");
      console.log(response);
      dispatch({
        type: ALL_FORUMS,
        payload: response.data,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: ALL_FORUMS_FAILURE,
      });
      return Promise.reject();
    }
  );
};

export const getForum = (id) => (dispatch) => {
  return ForumsService.getForum(id).then(
    (response) => {
      console.log("in forum action");
      console.log(response.result)
      dispatch({
        type: GET_FORUM_SUCCESS,
        payload: response.result,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: GET_FORUM_FAILURE,
      });
      return Promise.reject();
    }
  )
}


export const deleteForum = (id) => (dispatch) => {
  ForumsService.deleteForum(id).then(
    (response) => {
      console.log(response)
      dispatch({
        type: DELETE_FORUM,
        payload: id
      });
    }
  );
};

export const newComment = (author_id, article_id, content, created_at, author_name) => (dispatch) => {
  return ForumsService.newComment(author_id, article_id, content, created_at, author_name).then(
    (response) => {
      console.log("dispatching comment success");
      console.log(response.result);
      dispatch({
        type: COMMENT_SUCCESS,
        payload: response.result,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: COMMENT_FAILURE,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
}

export const editComment = (id, content, last_updated_at) => (dispatch) => {
  return ForumsService.editComment(id, content, last_updated_at).then(
    (response) => {
      console.log("dispatching edit comment success");
      console.log(response.result);
      dispatch({
        type: COMMENT_EDIT_SUCCESS,
        payload: response.result,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: COMMENT_EDIT_FAILURE,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
}

export const deleteComment = (id) => (dispatch) => {
  ForumsService.deleteComment(id);
  dispatch({
    type: DELETE_COMMENT,
    payload: id
  });
};

export const newLike = (user_id, article_id) => (dispatch) => {
  return ForumsService.newLike(user_id, article_id).then(
    (response) => {
      console.log("dispatching like success");
      console.log(response.result);
      dispatch({
        type: LIKE_SUCCESS,
        payload: response.result,
      });
      return Promise.resolve();
    },
    (error) => {
      const message =
        (error.response &&
          error.response.data &&
          error.response.data.message) ||
        error.message ||
        error.toString();
      dispatch({
        type: LIKE_FAILURE,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
}

export const deleteLike = (id) => (dispatch) => {
  ForumsService.deleteLike(id);
  dispatch({
    type: DELETE_LIKE,
    payload: id
  });
};