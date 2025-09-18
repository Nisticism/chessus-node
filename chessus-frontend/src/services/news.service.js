import axios from "axios";
import authHeader from "./auth-header";

const API_URL = "http://localhost:3001/";

const getNews = () => {
  console.log("in news service");
  return axios.get(API_URL + "news", { 
    headers: authHeader() });
};

const NewsService = {
  getNews,
}

export default NewsService;