import axios from "axios";
import authHeader from "./auth-header";

import API_URL from "../global/global.js";


const getUser = async(username) => {
  // Signed in, the server can tell your own profile and staff apart from a
  // visitor (staff see ban details; you see your own settings).
  const response = await axios.get(API_URL + "user", {
    params: { username: username},
    headers: authHeader(),
  });
  return response.data;
};

    // axios.get(process.env.REACT_APP_API_URL + '/user', 
    //  {params: { username: username}})
    // .then (res => {
    //     // setUserInfo(currentUser);
    //   setUserInfo(res.data.result);
    //   setRealUser(true);
    //   console.log("setting real user as true");
    // })
    // .catch(
    //   err => {
    //     setRealUser(false);
    //     console.log("setting real user as false");
    //     console.log(err);
    // })

// const getPublicContent = () => {
//   return axios.get(API_URL + "all");
// };

// const getUserBoard = () => {
//   return axios.get(API_URL + "user", { headers: authHeader() });
// };

// const getModeratorBoard = () => {
//   return axios.get(API_URL + "mod", { headers: authHeader() });
// };

// const getAdminBoard = () => {
//   return axios.get(API_URL + "admin", { headers: authHeader() });
// };

const UserService = {
  getUser,
}

export default UserService;