import axios from "axios";
import authHeader from "./auth-header";

const API_URL = "http://localhost:3001/";

const getArticles = () => {
  return axios.get(API_URL + "articles", { headers: authHeader() })
  .then((response) => {
    return (response.data);
  });
};

const getArticle = (id) => {
  return axios.get(API_URL + "article", {params: { article_id: id}, headers: authHeader()})
  .then((response) => {
    return (response.data);
  });
};

const newArticle = (game_type_id, author_id, title, descript, content, created_at, genre, public_setting) => {
  if (game_type_id === "") {
    game_type_id = null;
  }
  if (content === "") {
    content = null;
  }
  if (genre === "") {
    genre = null;
  }
  return axios.post(API_URL + "article/new", {
    game_type_id,
    author_id,
    title,
    descript,
    content,
    created_at,
    genre,
    public_setting,
    headers: authHeader(),
  }).then((response) => {
    return (response.data);
  });
};

export default {
  getArticles,
  getArticle,
  newArticle,
  // editArticle,
};