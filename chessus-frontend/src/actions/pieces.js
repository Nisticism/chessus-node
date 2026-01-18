import PiecesService from "../services/pieces.service";
import { getErrorMessage } from "../helpers/error-handler";
import {
  LIST_PIECES,
  LIST_PIECES_FAIL,
  SET_MESSAGE,
} from "./types";

export const getPieces = () => async (dispatch) => {
  try {
    const response = await PiecesService.getPieces();
    console.log("pieces action");
    dispatch({
      type: LIST_PIECES,
      payload: response.data,
    });
    return Promise.resolve();
  } catch (error) {
    const message = getErrorMessage(error);
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
    return response.data;
  } catch (error) {
    const message = getErrorMessage(error);
    return Promise.reject();
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