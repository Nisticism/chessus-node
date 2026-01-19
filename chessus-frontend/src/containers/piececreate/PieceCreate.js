import React from "react";
import { useParams } from "react-router-dom";
import PieceWizard from "../../components/piecewizard/PieceWizard";

const PieceCreate = () => {
  const { pieceId } = useParams();
  return <PieceWizard editPieceId={pieceId} />;
};

export default PieceCreate;