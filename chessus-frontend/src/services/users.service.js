import axios from "axios";
import authHeader from "./auth-header";

// const API_URL = "http://localhost:3001/";
const API_URL = require("../configs/global.js");

const getUsers = () => {
  return axios.get(API_URL + "users", { headers: authHeader() });
};

const UsersService = {
  getUsers,
}

export default UsersService;