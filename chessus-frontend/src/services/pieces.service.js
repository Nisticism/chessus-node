import axios from "axios";
import authHeader from "./auth-header";

import API_URL from "../global/global.js";

const getPieces = async (page = 1, limit = 20, sort = 'newest', search = '', creatorId = '', includeDrafts = '') => {
  const params = { page, limit, sort };
  if (search) params.search = search;
  if (creatorId) params.creatorId = creatorId;
  if (includeDrafts) params.includeDrafts = 'true';
  const response = await axios.get(API_URL + "pieces", { 
    params,
    headers: authHeader() 
  });
  return response;
};

const getPieceById = async (pieceId) => {
  const response = await axios.get(API_URL + `pieces/${pieceId}`, {
    headers: authHeader()
  });
  return response;
};

const getPiecesWithMovement = async () => {
  const response = await axios.get(API_URL + "pieces/full", { 
    headers: authHeader() 
  });
  return response;
};

const createPiece = async (formData) => {
  const response = await axios.post(API_URL + "pieces/create", formData, {
    headers: {
      ...authHeader(),
      "Content-Type": "multipart/form-data",
    },
  });
  return response;
};

const updatePiece = async (pieceId, formData) => {
  const response = await axios.put(API_URL + `pieces/${pieceId}`, formData, {
    headers: {
      ...authHeader(),
      "Content-Type": "multipart/form-data",
    },
  });
  return response;
};

const deletePiece = async (pieceId) => {
  const response = await axios.delete(API_URL + `pieces/${pieceId}`, {
    headers: authHeader()
  });
  return response;
};

const duplicatePiece = async (pieceId) => {
  const response = await axios.post(API_URL + `pieces/${pieceId}/duplicate`, {}, {
    headers: authHeader()
  });
  return response;
};

const getGamesByPieceId = async (pieceId) => {
  const response = await axios.get(API_URL + `pieces/${pieceId}/games`, {
    headers: authHeader()
  });
  return response;
};

const checkPieceDuplicates = async (fields, excludeId = null) => {
  const response = await axios.post(API_URL + "pieces/duplicates", { fields, excludeId }, {
    headers: authHeader()
  });
  return response;
};

const comparePieces = async (pieceAId, pieceBId) => {
  const response = await axios.get(API_URL + `pieces/${pieceAId}/compare/${pieceBId}`, {
    headers: authHeader()
  });
  return response;
};

const getCommunityImages = async ({ page = 1, limit = 40, sort = 'newest', search = '' } = {}) => {
  const params = { page, limit, sort };
  if (search) params.search = search;
  const response = await axios.get(API_URL + "pieces/community-images", { params });
  return response;
};

const PiecesService = {
  getPieces,
  getPieceById,
  getPiecesWithMovement,
  createPiece,
  updatePiece,
  deletePiece,
  duplicatePiece,
  getGamesByPieceId,
  checkPieceDuplicates,
  comparePieces,
  getCommunityImages,
};

export default PiecesService;