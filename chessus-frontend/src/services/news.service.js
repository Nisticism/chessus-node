import axios from "axios";
import authHeader from "./auth-header";

import API_URL from "../global/global.js";

const getNews = async () => {
  const response = await axios.get(API_URL + "news", { 
    headers: authHeader() 
  });
  return response;
};

const newNews = async (author_id, title, content, created_at, external_blog_url, external_blog_label) => {
  const response = await axios.post(
    API_URL + "news/new",
    { author_id, title, content, created_at, external_blog_url: external_blog_url || null, external_blog_label: external_blog_label || null },
    { headers: authHeader() }
  );
  return response;
};

const editNews = async (title, content, last_updated_at, id, external_blog_url, external_blog_label) => {
  const response = await axios.put(
    API_URL + `admin/news/${id}`,
    { title, content, last_updated_at, external_blog_url: external_blog_url || null, external_blog_label: external_blog_label || null },
    { headers: authHeader() }
  );
  return response;
};

const deleteNews = async (id) => {
  const response = await axios.delete(
    API_URL + `news/${id}`,
    { headers: authHeader() }
  );
  return response;
};

const NewsService = {
  getNews,
  newNews,
  editNews,
  deleteNews,
}

export default NewsService;