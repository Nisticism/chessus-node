import axios from "axios";
import authHeader from "./auth-header";

// const API_URL = "http://localhost:3001/";
const API_URL = require("../global/global.js");

const getPieces = async () => {
  const response = await axios.get(API_URL + "pieces", { 
    headers: authHeader() 
  });
  return response;
};

const PiecesService = {
  getPieces,
}

export default PiecesService;