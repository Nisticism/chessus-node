import axios from "axios";
import authHeader from "./auth-header";

// const API_URL = "http://localhost:3001/";
const API_URL = require("../global/global.js");

const getForums = async () => {
  console.log("in forums service");
  const response = await axios.get(API_URL + "forums", { 
    headers: authHeader() 
  });
  return response;
};

const getForum = async (id) => {
  const response = await axios.get(API_URL + "forum", {
    params: { forum_id: id }
  });
  return response.data;
};

const newForum = async (author_id, title, content, created_at) => {
  if (content === "") {
    content = null;
  }
  console.log("making new forum post request");
  const response = await axios.post(API_URL + "forums/new", {
    author_id,
    title,
    content,
    created_at,
    headers: authHeader(),
  });
  return response.data;
};

const editForum = async (title, content, last_updated_at, id) => {
  if (content === "") {
    content = null;
  }
  console.log("making update forum put request");
  const response = await axios.put(API_URL + "forums/edit", {
    title,
    content, 
    last_updated_at,
    id,
    headers: authHeader(),
  });
  console.log(response.data);
  return response.data;
};

const deleteForum = async (id) => {
  console.log("delete forum request " + "id: " + id);
  const response = await axios.post(API_URL + "forums/delete", {
    id,
    headers: authHeader(),
  });
  console.log(response.data);
  return response.data;
};

const newComment = async (author_id, forum_id, content, created_at, author_name) => {
  if (content === "") {
    content = null;
  }
  console.log("making new comment post request");
  const response = await axios.post(API_URL + "comments/new", {
    author_id,
    forum_id,
    content,
    created_at,
    author_name,
    headers: authHeader(),
  });
  return response.data;
};

const editComment = async (id, content, last_updated_at) => {
  if (content === "") {
    content = null;
  }
  console.log("making edit forum put request");
  const response = await axios.put(API_URL + "comments/edit", {
    id,
    content,
    last_updated_at,
    headers: authHeader(),
  });
  return response.data;
};

const deleteComment = async (id) => {
  console.log("delete comment post request");
  const response = await axios.post(API_URL + "delete-comment", {
    id,
    headers: authHeader(),
  });
  return response.data;
};

const newLike = async (user_id, article_id) => {
  console.log("making new like post request");
  const response = await axios.post(API_URL + "likes/new", {
    user_id,
    article_id,
    headers: authHeader(),
  });
  return response.data;
};

const deleteLike = async (id) => {
  console.log("delete like post request");
  const response = await axios.post(API_URL + "likes/delete", {
    id,
    headers: authHeader(),
  });
  return response.data;
};


const ForumsService = {
  getForums,
  getForum,
  newForum,
  editForum,
  deleteForum,
  newComment,
  editComment,
  deleteComment,
  newLike,
  deleteLike,
}

export default ForumsService;