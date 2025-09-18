import axios from "axios";
import authHeader from "./auth-header";

const API_URL = "http://localhost:3001/";

const getForums = () => {
  console.log("in forums service");
  return axios.get(API_URL + "forums", { 
    headers: authHeader() });
};

const getForum = (id) => {
  return axios.get(API_URL + "forum", {params: { forum_id: id}})
  .then((response) => {
    return (response.data);
  });
};

const newForum = (author_id, title, content, created_at) => {
  if (content === "") {
    content = null;
  }
  console.log("making new forum post request");
  return axios.post(API_URL + "forums/new", {
    author_id,
    title,
    content,
    created_at,
    headers: authHeader(),
  }).then((response) => {
    return (response.data);
  });
};

const editForum = (title, content, last_updated_at, id) => {
  if (content === "") {
    content = null;
  }
  console.log("making update forum put request");
  return axios.put(API_URL + "forums/edit", {
    title,
    content, 
    last_updated_at,
    id,
    headers: authHeader(),
  }).then((response) => {
    console.log(response.data);
    return (response.data);
  });
};

const deleteForum = (id) => {
  console.log("delete forum request " + "id: " + id);
  return axios.post(API_URL + "forums/delete", {
    id,
    headers: authHeader(),
  }).then((response) => {
    console.log(response.data);
    return (response.data);
  });
};

const newComment = (author_id, forum_id, content, created_at, author_name) => {
  if (content === "") {
    content = null;
  }
  console.log("making new comment post request");
  return axios.post(API_URL + "comments/new", {
    author_id,
    forum_id,
    content,
    created_at,
    author_name,
    headers: authHeader(),
  }).then((response) => {
    return (response.data);
  });
};

const editComment = (id, content, last_updated_at) => {
  if (content === "") {
    content = null;
  }
  console.log("making edit forum put request");
  return axios.put(API_URL + "comments/edit", {
    id,
    content,
    last_updated_at,
    headers: authHeader(),
  }).then((response) => {
    return (response.data);
  });
};

const deleteComment = (id) => {
  console.log("delete comment post request");
  return axios.post(API_URL + "delete-comment", {
    id,
    headers: authHeader(),
  }).then((response) => {
    return (response.data);
  });
};

const newLike = (user_id, article_id) => {
  console.log("making new like post request");
  return axios.post(API_URL + "likes/new", {
    user_id,
    article_id,
    headers: authHeader(),
  }).then((response) => {
    return (response.data);
  });
};

const deleteLike = (id) => {
  console.log("delete like post request");
  return axios.post(API_URL + "likes/delete", {
    id,
    headers: authHeader(),
  }).then((response) => {
    return (response.data);
  });
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