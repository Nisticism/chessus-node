import React from "react";
import { useParams } from 'react-router-dom';
import GameWizard from "../../components/gamewizard/GameWizard";
import styles from "./gamecreate.module.scss";

const GameCreate = () => {
  const { gameId } = useParams();

  return (
    <div className={styles["outer-container"]}>
      <GameWizard editGameId={gameId} />
    </div>
  );
};

export default GameCreate;
