import {
  NEWS_SUCCESS,
  NEWS_FAILURE,
  ALL_NEWS,
  ALL_NEWS_FAILURE,
  GET_NEWS_SUCCESS,
  GET_NEWS_FAILURE,
  EDIT_NEWS_SUCCESS,
  EDIT_NEWS_FAILURE,
  DELETE_NEWS,
  DELETE_NEWS_FAILURE,
} from "../actions/types";

const initialState = {news: [{id: 1, title: "Loading", date_published: "Loading", content: "Loading"}]};
const newsReducer = (state = initialState, action) => {
  const { type, payload } = action;
  switch (type) {
    case NEWS_SUCCESS:
      return {
        ...state,
        news: payload,
      };
    case NEWS_FAILURE:
      return initialState;
    case ALL_NEWS:
      console.log("in all news success");
      return {
        ...state,
        all_news: payload,
      }
    case ALL_NEWS_FAILURE:
      return {
        ...state,
        message: "Get news failed"
      }
    case GET_NEWS_SUCCESS:
      console.log("in get news post succeeded reducer")
      return {
        ...state,
        news: payload,
      }
    case GET_NEWS_FAILURE:
      return {
        ...state,
        message: "Get News failed"
      }
    case EDIT_NEWS_SUCCESS:
      return {
        ...state,
        news: {
          ...state.news,

        }
      }
    case EDIT_NEWS_FAILURE:
      return {
        ...state,
        message: "Post edit failed"
      }
    case DELETE_NEWS:
      let deleteIndex;
      if (state.all_news) {
        let allNews = state.all_news;
        allNews.forEach(function(news, index) {
          if (news.id === payload) {
            deleteIndex = index;
          }
        });
        console.log("all news: " + allNews);
        allNews.splice(deleteIndex, 1);
        return {
          ...state,
          all_news: allNews,
          news: null
        }
      } else {
        return {
          ...state,
          news: null
        }
      }
    case DELETE_NEWS_FAILURE:
    default:
      return state;
  }
};

export default newsReducer;
