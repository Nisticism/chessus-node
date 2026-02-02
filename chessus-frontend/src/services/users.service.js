import axios from "axios";
import authHeader from "./auth-header";

import API_URL from "../global/global.js";

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