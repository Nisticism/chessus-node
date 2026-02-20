import React from "react";
import { Navigate, useParams } from 'react-router-dom';
import { useSelector } from "react-redux";
import GameWizard from "../../components/gamewizard/GameWizard";
import styles from "./gamecreate.module.scss";

const GameCreate = () => {
  const { gameId } = useParams();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to create or edit game types." }} />;
  }

  return (
    <div className={styles["outer-container"]}>
      <GameWizard editGameId={gameId} />
    </div>
  );
};

export default GameCreate;
