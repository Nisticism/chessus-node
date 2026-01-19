import axios from "axios";
import authHeader from "./auth-header";

// const API_URL = process.env.REACT_APP_API_URL;
const API_URL = require("../global/global.js");

const getNews = async () => {
  console.log("in news service");
  const response = await axios.get(API_URL + "news", { 
    headers: authHeader() 
  });
  return response;
};

const NewsService = {
  getNews,
}

export default NewsService;