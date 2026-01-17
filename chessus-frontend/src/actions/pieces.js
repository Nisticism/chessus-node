import PiecesService from "../services/pieces.service";
import { getErrorMessage } from "../helpers/error-handler";

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