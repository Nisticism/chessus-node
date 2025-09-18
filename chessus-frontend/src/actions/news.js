import {
  NEWS_SUCCESS,
  NEWS_FAILURE,
  SET_MESSAGE,
  ALL_NEWS,
  ALL_NEWS_FAILURE,
  GET_NEWS_SUCCESS,
  GET_NEWS_FAILURE,
  EDIT_NEWS_SUCCESS,
  EDIT_NEWS_FAILURE,
  DELETE_NEWS,
  DELETE_NEWS_FAILURE,
} from "./types";
import NewsService from "../services/news.service";

// update arguments
export const newNews = (author_id, title, content, created_at) => (dispatch) => {
  return NewsService.newNews(author_id, title, content, created_at).then(
    (response) => {
      console.log("dispatching post success");
      console.log(response.result);
      dispatch({
        type: NEWS_SUCCESS,
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
        type: NEWS_FAILURE,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
};

export const editNews = (title, content, last_updated_at, id) => (dispatch) => {
  return NewsService.editNews(title, content, last_updated_at, id).then(
    (response) => {
      console.log("dispatching edit news success");
      console.log(response.result);
      dispatch({
        type: EDIT_NEWS_SUCCESS,
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
        type: EDIT_NEWS_FAILURE,
      });
      dispatch({
        type: SET_MESSAGE,
        payload: message,
      });
      return Promise.reject();
    }
  );
};

export const news = () => (dispatch) => {
  return NewsService.getNews().then(
    (response) => {
      console.log("in get all news action");
      console.log(response);
      dispatch({
        type: ALL_NEWS,
        payload: response.data.news,
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
        type: ALL_NEWS_FAILURE,
      });
      return Promise.reject();
    }
  );
};

export const getNews = (id) => (dispatch) => {
  return NewsService.getNews(id).then(
    (response) => {
      console.log("in news action");
      console.log(response.result)
      dispatch({
        type: GET_NEWS_SUCCESS,
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
        type: GET_NEWS_FAILURE,
      });
      return Promise.reject();
    }
  )
}


export const deleteNews = (id) => (dispatch) => {
  NewsService.deleteNews(id).then(
    (response) => {
      console.log(response)
      dispatch({
        type: DELETE_NEWS,
        payload: id
      });
    }
  );
};