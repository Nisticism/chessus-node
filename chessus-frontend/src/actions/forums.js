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
  LIKE_SUCCESS,
  LIKE_FAILURE,
  DELETE_LIKE,

  FIRST_FORUMS_RENDER,
} from "./types";
import ForumsService from "../services/forums.service";
import { getErrorMessage } from "../helpers/error-handler";

export const firstForumsRender = (first_render) => (dispatch) => {
  dispatch({
    type: FIRST_FORUMS_RENDER,
    payload: true,
  });
}

// update arguments
export const newForum = (author_id, title, content, created_at, game_type_id = null) => async (dispatch) => {
  try {
    const response = await ForumsService.newForum(author_id, title, content, created_at, game_type_id);
    console.log("dispatching post success");
    console.log(response.result);
    dispatch({
      type: POST_SUCCESS,
      payload: response.result,
    });
    return Promise.resolve(response);
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: POST_FAILURE,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject(error);
  }
};

export const editForum = (title, content, last_updated_at, id) => async (dispatch) => {
  try {
    const response = await ForumsService.editForum(title, content, last_updated_at, id);
    console.log("dispatching edit forum success");
    console.log(response.result);
    dispatch({
      type: EDIT_POST_SUCCESS,
      payload: response.result,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: EDIT_POST_FAILURE,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
};

export const forums = (page = 1, limit = 20, gameTypeId = null) => async (dispatch) => {
  try {
    const response = await ForumsService.getForums(page, limit, gameTypeId);
    console.log("in forums action");
    console.log(response);
    dispatch({
      type: ALL_FORUMS,
      payload: response.data,
    });
    return Promise.resolve();
  } catch (error) {
    getErrorMessage(error);
    dispatch({
      type: ALL_FORUMS_FAILURE,
    });
    return Promise.reject();
  }
};

export const getForum = (id) => async (dispatch) => {
  try {
    const response = await ForumsService.getForum(id);
    console.log("in forum action");
    console.log(response.result);
    dispatch({
      type: GET_FORUM_SUCCESS,
      payload: response.result,
    });
    return Promise.resolve();
  } catch (error) {
    getErrorMessage(error);
    dispatch({
      type: GET_FORUM_FAILURE,
    });
    return Promise.reject();
  }
}


export const deleteForum = (id) => async (dispatch) => {
  try {
    const response = await ForumsService.deleteForum(id);
    console.log(response);
    dispatch({
      type: DELETE_FORUM,
      payload: id
    });
  } catch (error) {
    console.error("Error deleting forum:", error);
  }
};

export const newComment = (author_id, article_id, content, created_at, author_name, parent_id = null) => async (dispatch) => {
  try {
    const response = await ForumsService.newComment(author_id, article_id, content, created_at, author_name, parent_id);
    console.log("dispatching comment success");
    console.log(response.result);
    dispatch({
      type: COMMENT_SUCCESS,
      payload: response.result,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: COMMENT_FAILURE,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
}

export const editComment = (id, content, last_updated_at) => async (dispatch) => {
  try {
    const response = await ForumsService.editComment(id, content, last_updated_at);
    console.log("dispatching edit comment success");
    console.log(response.result);
    dispatch({
      type: COMMENT_EDIT_SUCCESS,
      payload: response.result,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: COMMENT_EDIT_FAILURE,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
}

export const deleteComment = (id) => async (dispatch) => {
  try {
    await ForumsService.deleteComment(id);
    dispatch({
      type: DELETE_COMMENT,
      payload: id
    });
  } catch (error) {
    console.error("Error deleting comment:", error);
  }
};

export const newLike = (user_id, article_id) => async (dispatch) => {
  try {
    const response = await ForumsService.newLike(user_id, article_id);
    console.log("dispatching like success");
    console.log(response.result);
    dispatch({
      type: LIKE_SUCCESS,
      payload: response.result,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch({
      type: LIKE_FAILURE,
    });
    dispatch({
      type: SET_MESSAGE,
      payload: message,
    });
    return Promise.reject();
  }
}

export const deleteLike = (id) => async (dispatch) => {
  try {
    await ForumsService.deleteLike(id);
    dispatch({
      type: DELETE_LIKE,
      payload: id
    });
  } catch (error) {
    console.error("Error deleting like:", error);
  }
};