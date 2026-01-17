import axios from "axios";
// import { response } from "express";

// const API_URL = "http://localhost:3001/";

const API_URL = require("../global/global.js");
// const API_URL = global.api_url;

const register = async (username, password, email) => {
  if (email === "") {
    email = null;
  }
  const response = await axios.post(API_URL + "register", {
    username,
    password,
    email,
  });
  return response;
};

const updateUser = (updatedData) => {
  const user = JSON.parse(localStorage.getItem('user'));
  Object.keys(updatedData).forEach((key) => {
      user[key] = updatedData[key];
  });
  localStorage.setItem('user', JSON.stringify(user));
}

const edit = async (current_user, username, password, email, first_name, last_name, bio, id, admin_id) => {
  if (email === "") {
    email = null;
  }
  if (first_name === "") {
    first_name = null;
  }
  if (last_name === "") {
    last_name = null;
  }
  if (bio === "") {
    bio = null;
  }
  
  const response = await axios.post(API_URL + "profile/edit", {
    current_user,
    username,
    password,
    email,
    first_name, 
    last_name,
    bio,
    id,
  });
  
  if (response.data.result.username && (!admin_id || (response.data.result.id && response.data.result.id === admin_id))) {
    updateUser(response.data.result);
  }
  return response.data;
}

const login = async (username, password) => {
  try {
    const response = await axios.post(API_URL + "login", {
      username,
      password,
    });
    
    if (response && response.data) {
      if (response.data.result.username) {
        localStorage.setItem("user", JSON.stringify(response.data.result));
      }
      return response.data;
    }
  } catch (error) {
    throw error;
  }
};

const logout = async () => {
  try {
    const response = await axios.post(API_URL + "logout");
    localStorage.removeItem("user");
    return response.data;
  } catch (error) {
    // Even if the API call fails, remove the user from localStorage
    localStorage.removeItem("user");
    console.log("Logout API call failed, but user removed from localStorage");
  }
};

const deleteUser = async (username, admin_id) => {
  if (!admin_id) {
    localStorage.removeItem("user");
  }
  const response = await axios.post(API_URL + "delete", {
    username,
    admin_id,
  });
  return response.data;
}

const getCurrentUser = () => {
  return JSON.parse(localStorage.getItem("user"));
};

const AuthService = {
  register,
  edit,
  login,
  logout,
  getCurrentUser,
  deleteUser,
}

export default AuthService;