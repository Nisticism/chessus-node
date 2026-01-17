import axios from "axios";
import authHeader from "./auth-header";

// const API_URL = "http://localhost:3001/";
const API_URL = require("../global/global.js");

const getUsers = async () => {
  const response = await axios.get(API_URL + "users"
  // , { headers: authHeader() }
  );
  return response;
};

const UsersService = {
  getUsers,
}

export default UsersService;