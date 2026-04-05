import PiecesService from "../services/pieces.service";
import { getErrorMessage } from "../helpers/error-handler";
import {
  LIST_PIECES,
  LIST_PIECES_FAIL,
} from "./types";

export const getPieces = (page = 1, limit = 20, sort = 'newest', search = '') => async (dispatch) => {
  try {
    const response = await PiecesService.getPieces(page, limit, sort, search);
    console.log("pieces action");
    dispatch({
      type: LIST_PIECES,
      payload: response.data,
    });
    return Promise.resolve();
  } catch (error) {
    getErrorMessage(error);
    dispatch({
      type: LIST_PIECES_FAIL,
    });
    return Promise.reject();
  }
};

export const getAllPieces = async () => {
  try {
    const response = await PiecesService.getPieces();
    console.log("pieces action");
    // Handle paginated response { pieces: [...], pagination: {...} }
    if (response.data && response.data.pieces) {
      return response.data.pieces;
    }
    // Fallback for direct array response
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("Error getting all pieces:", message);
    return []; // Return empty array instead of rejecting to avoid breaking callers
  }
};

export const getPieceById = async (pieceId) => {
  try {
    const response = await PiecesService.getPieceById(pieceId);
    return response.data;
  } catch (error) {
    const message = getErrorMessage(error);
    return Promise.reject(message);
  }
};
export const getGamesByPieceId = async (pieceId) => {
  try {
    const response = await PiecesService.getGamesByPieceId(pieceId);
    return response.data;
  } catch (error) {
    const message = getErrorMessage(error);
    return Promise.reject(message);
  }
};
export const createPiece = async (formData) => {
  try {
    const response = await PiecesService.createPiece(formData);
    return response.data;
  } catch (error) {
    const message = getErrorMessage(error);
    return Promise.reject(message);
  }
};

export const updatePiece = async (pieceId, formData) => {
  try {
    const response = await PiecesService.updatePiece(pieceId, formData);
    return response.data;
  } catch (error) {
    const message = getErrorMessage(error);
    return Promise.reject(message);
  }
};

export const deletePiece = async (pieceId) => {
  try {
    const response = await PiecesService.deletePiece(pieceId);
    return response.data;
  } catch (error) {
    const message = getErrorMessage(error);
    return Promise.reject(message);
  }
};