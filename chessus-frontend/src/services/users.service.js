import axios from "axios";
import authHeader from "./auth-header";

import API_URL from "../global/global.js";

const getUsers = async (page = 1, limit = 20) => {
  const response = await axios.get(API_URL + "users", {
    params: { page, limit }
    // , headers: authHeader()
  });
  return response;
};

const UsersService = {
  getUsers,
}

export default UsersService;