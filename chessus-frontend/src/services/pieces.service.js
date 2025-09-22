import axios from "axios";
import authHeader from "./auth-header";

// const API_URL = "http://localhost:3001/";
const API_URL = require("../configs/global.js");

const getPieces = () => {
  return axios.get(API_URL + "pieces", { headers: authHeader() });
};

const PiecesService = {
  getPieces,
}

export default PiecesService;