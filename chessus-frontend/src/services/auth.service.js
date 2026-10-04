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

const edit = async (current_user, username, password, email, first_name, last_name, bio, id, admin_id, oldPassword, show_display_name, chess_com_username, lichess_username, twitch_channel) => {
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
  
  const payload = {
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
  };
  if (chess_com_username !== undefined) payload.chess_com_username = chess_com_username;
  if (lichess_username !== undefined) payload.lichess_username = lichess_username;
  if (twitch_channel !== undefined) payload.twitch_channel = twitch_channel;

  const response = await axios.post(API_URL + "profile/edit", payload);
  
  if (response.data.result.username && (!admin_id || (response.data.result.id && response.data.result.id === admin_id))) {
    updateUser(response.data.result);
  }
  return response.data;
}

const changePassword = async (oldPassword, newPassword) => {
  const response = await axios.post(API_URL + "profile/change-password", {
    oldPassword,
    newPassword,
  });
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

// True when a JWT has expired or will within the next minute (or can't be read).
const tokenExpiresSoon = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() + 60000;
  } catch {
    return true;
  }
};

/*
 * The current access token, refreshed first if it is about to expire (or
 * always, with { force: true }). Null when nobody is signed in. Used by the
 * game socket, which signs in with the token: a tab left open past the
 * token's 15 minutes must not reconnect as a guest. Concurrent callers share
 * one refresh.
 */
let pendingRefresh = null;
const getFreshAccessToken = async ({ force = false } = {}) => {
  let user = null;
  try { user = getCurrentUser(); } catch { return null; }
  if (!user || !user.accessToken) return null;
  if (!force && !tokenExpiresSoon(user.accessToken)) return user.accessToken;
  if (!user.refreshToken) return user.accessToken;
  if (!pendingRefresh) {
    pendingRefresh = refreshAccessToken().finally(() => { pendingRefresh = null; });
  }
  try {
    return (await pendingRefresh) || null;
  } catch {
    return null;
  }
};

const logout = async () => {
  try {
    // Send this device's refresh token so the server ends exactly this session.
    const refreshToken = getCurrentUser()?.refreshToken;
    const response = await axios.post(API_URL + "logout", refreshToken ? { refreshToken } : {});
    localStorage.removeItem("user");
    return response.data;
  } catch (error) {
    // Even if the API call fails, remove the user from localStorage
    localStorage.removeItem("user");
  }
};

const deleteUser = async (username, admin_id) => {
  const response = await axios.post(API_URL + "delete", {
    username,
    admin_id,
  });
  if (!admin_id) {
    localStorage.removeItem("user");
  }
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

const lichessLogin = async (code, codeVerifier, redirectUri) => {
  try {
    const response = await axios.post(API_URL + "auth/lichess", {
      code,
      codeVerifier,
      redirectUri,
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

const twitchLogin = async (code, redirectUri) => {
  try {
    const response = await axios.post(API_URL + "auth/twitch", {
      code,
      redirectUri,
    });
    if (response && response.data && response.data.result) {
      const result = response.data.result;
      if (result && result.username) {
        const userData = {
          ...result,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
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
  changePassword,
  login,
  googleLogin,
  lichessLogin,
  twitchLogin,
  logout,
  getCurrentUser,
  deleteUser,
  refreshAccessToken,
  getFreshAccessToken,
  forgotPassword,
  verifyResetToken,
  resetPassword,
}

export default AuthService;