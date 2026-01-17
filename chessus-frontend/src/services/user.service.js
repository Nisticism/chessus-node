import axios from "axios";
// import authHeader from "./auth-header";

// const API_URL = "http://localhost:3001/";
const API_URL = require("../global/global.js");


const getUser = async(username) => {
  console.log("in get User service");
  const response = await axios.get(API_URL + "user", {
    params: { username: username}
  });
  return response.data;
};

    // axios.get('http://localhost:3001/user', 
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