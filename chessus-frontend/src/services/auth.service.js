import axios from "axios";
// import { response } from "express";

import API_URL from "../global/global.js";

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

const edit = async (current_user, username, password, email, first_name, last_name, bio, id, admin_id, oldPassword, show_display_name) => {
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
    oldPassword,
    email,
    first_name, 
    last_name,
    bio,
    id,
    show_display_name,
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
    
    if (response && response.data && response.data.result) {
      const result = response.data.result;
      if (result && result.username) {
        // Store both access and refresh tokens
        const userData = {
          ...result,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        };
        localStorage.setItem("user", JSON.stringify(userData));
      }
      return response.data;
    }
  } catch (error) {
    throw error;
  }
};

const refreshAccessToken = async () => {
  try {
    const user = getCurrentUser();
    if (!user || !user.refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await axios.post(API_URL + "token", {
      refreshToken: user.refreshToken
    });

    if (response.data.accessToken) {
      user.accessToken = response.data.accessToken;
      localStorage.setItem("user", JSON.stringify(user));
      return response.data.accessToken;
    }
  } catch (error) {
    // If refresh fails, log out the user
    localStorage.removeItem("user");
    window.location.href = "/login";
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

const googleLogin = async (credential) => {
  try {
    const response = await axios.post(API_URL + "auth/google", {
      credential,
    });

    if (response && response.data && response.data.result) {
      const result = response.data.result;
      if (result && result.username) {
        const userData = {
          ...result,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        };
        localStorage.setItem("user", JSON.stringify(userData));
      }
      return response.data;
    }
  } catch (error) {
    throw error;
  }
};

// Request password reset email
const forgotPassword = async (email) => {
  const response = await axios.post(API_URL + "forgot-password", { email });
  return response.data;
};

// Verify reset token is valid
const verifyResetToken = async (token) => {
  const response = await axios.get(API_URL + `reset-password/${token}`);
  return response.data;
};

// Reset password with token
const resetPassword = async (token, password) => {
  const response = await axios.post(API_URL + "reset-password", { token, password });
  return response.data;
};

const AuthService = {
  register,
  edit,
  login,
  googleLogin,
  logout,
  getCurrentUser,
  deleteUser,
  refreshAccessToken,
  forgotPassword,
  verifyResetToken,
  resetPassword,
}

export default AuthService;