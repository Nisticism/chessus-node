import React from "react";
import { Navigate } from 'react-router-dom';
import { useSelector } from "react-redux";
import GameWizard from "../../components/gamewizard/GameWizard";
import styles from "./gamecreate.module.scss";

const GameCreate = () => {

  const { user: currentUser } = useSelector((state) => state.authReducer);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  return (
    <div className={styles["outer-container"]}>
      <GameWizard />
    </div>
  );
};

export default GameCreate;
