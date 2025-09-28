import axios from "axios";
// import { response } from "express";

// const API_URL = "http://localhost:3001/";

const API_URL = require("../global/global.js");
// const API_URL = global.api_url;

const register = (username, password, email) => {
  if (email === "") {
    email = null;
  }
  return axios.post(API_URL + "register", {
    username,
    password,
    email,
  });
};

const updateUser = (updatedData) => {
  const user = JSON.parse(localStorage.getItem('user'));
  Object.keys(updatedData).forEach((key) => {
      user[key] = updatedData[key];
  });
  localStorage.setItem('user', JSON.stringify(user));
}

const edit = (current_user, username, password, email, first_name, last_name, bio, id, admin_id) => {
  console.log("in auth service");
  console.log("password attempting to change to: " + password);
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
  return axios.post(API_URL + "profile/edit", {
    current_user,
    username,
    password,
    email,
    first_name, 
    last_name,
    bio,
    id,
  })
  .then((response) => {
    if (response.data.result.username && (!admin_id || (response.data.result.id && response.data.result.id === admin_id))) {
      updateUser(response.data.result);
    }
    return response.data;
  });
}

const login = (username, password) => {
  return axios
    .post(API_URL + "login", {
      username,
      password,
    }).then((response) => {
        try {
          if (response && response.data) {
            console.log("seems like it was successful in getting response data, returning")
            if (response.data.result.username) {
              localStorage.setItem("user", JSON.stringify(response.data.result));
            }
            return response.data;
          }

      } catch (error) {
          console.log(error && error.response && error.response && error.response.data ? error.response.data : "could not display full error");
      } finally {
        console.log("finally");
      }
    }
  )
    
    // .catch((error) => {
    //   // need to see why response isn't returning
    //   console.error(error && error.response && error.response && error.response.data ? error.response.data : "could not display full error");
    //   console.log(error);
    //   return error;
    // })
    // .then((response) => {
    //   console.log(response);
    //   console.log(response && response.data && response.data.result ? response.data.result : "can't display anything here");
    // })
    // .then((response) => {
    //   if (response && response.data.result.username) {
    //     localStorage.setItem("user", JSON.stringify(response.data.result));
    //   }
    //   return response.data;
    // });
};

const logout = () => {
  localStorage.removeItem("user");
  return axios.post(API_URL + "logout").then((response) => {
    return response.data;
  });
};

const deleteUser = (username, admin_id) => {
  if (!admin_id) {
    localStorage.removeItem("user");
  }
  return axios
    .post(API_URL + "delete", {
      username,
      admin_id,
    })
    .then((response) => {
      return response.data;
  });
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