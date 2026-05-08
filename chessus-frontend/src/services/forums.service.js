import axios from "axios";
import authHeader from "./auth-header";

import API_URL from "../global/global.js";

const getForums = async (page = 1, limit = 20, gameTypeId = null, scope = null, category = null, search = null, sortBy = null, sortOrder = null) => {
  const params = { page, limit };
  if (gameTypeId) params.gameTypeId = gameTypeId;
  if (scope) params.scope = scope;
  if (category) params.category = category;
  if (search) params.search = search;
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  const response = await axios.get(API_URL + "forums", {
    params,
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

const newForum = async (author_id, title, content, created_at, game_type_id = null, category = null) => {
  if (content === "") {
    content = null;
  }
  const response = await axios.post(API_URL + "forums/new", {
    author_id,
    title,
    content,
    created_at,
    game_type_id,
    category,
    headers: authHeader(),
  });
  return response.data;
};

const editForum = async (title, content, last_updated_at, id) => {
  if (content === "") {
    content = null;
  }
  const response = await axios.put(API_URL + "forums/edit", {
    title,
    content, 
    last_updated_at,
    id,
  }, {
    headers: authHeader(),
  });
  return response.data;
};

const deleteForum = async (id) => {
  const response = await axios.post(
    API_URL + "forums/delete",
    { id },
    { headers: authHeader() }
  );
  return response.data;
};

const newComment = async (author_id, forum_id, content, created_at, author_name, parent_id = null) => {
  if (content === "") {
    content = null;
  }
  const response = await axios.post(API_URL + "comments/new", {
    author_id,
    forum_id,
    content,
    created_at,
    author_name,
    parent_id,
    headers: authHeader(),
  });
  return response.data;
};

const editComment = async (id, content, last_updated_at) => {
  if (content === "") {
    content = null;
  }
  const response = await axios.put(API_URL + "comments/edit", {
    id,
    content,
    last_updated_at,
  }, {
    headers: authHeader(),
  });
  return response.data;
};

const deleteComment = async (id) => {
  const response = await axios.post(API_URL + "delete-comment", {
    id,
  }, {
    headers: authHeader(),
  });
  return response.data;
};

const newLike = async (user_id, article_id) => {
  const response = await axios.post(API_URL + "likes/new", {
    user_id,
    article_id,
    headers: authHeader(),
  });
  return response.data;
};

const deleteLike = async (id) => {
  const response = await axios.post(API_URL + "likes/delete", {
    id,
    headers: authHeader(),
  });
  return response.data;
};

const toggleCommentEmote = async (commentId, emoteType) => {
  const response = await axios.post(
    API_URL + `comments/${commentId}/emotes`,
    { emote_type: emoteType },
    { headers: authHeader() }
  );
  return response.data;
};

const toggleForumLike = async (forumId) => {
  const response = await axios.post(
    API_URL + `forums/${forumId}/toggle-like`,
    {},
    { headers: authHeader() }
  );
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
  toggleCommentEmote,
  toggleForumLike,
}

export default ForumsService;