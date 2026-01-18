import React from "react";
import { Navigate } from 'react-router-dom';
import { useSelector } from "react-redux";
import styles from "./gameboard.module.scss";

const GameBoard = (props) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  if (!currentUser) {
    alert("Must be logged in");
    return <Navigate to="/login" />;
  }

  let board = [];

  const handleBoardClick = (e) => {
    e.preventDefault();
    console.log("light square clicked");
  }

  function createGrid() {
    for (let i = 0; i < props.vertical; i ++) {
      for (let j = 0; j < props.horizontal; j ++) {
        if ((i + j)%2 === 0) {
          board.push(
            <div key={"r" + i + "c" + j} className={styles["light-square"]} style={{background: props.lightSquareColor}} onClick={handleBoardClick}/>
          )
        } else {
          board.push(
            <div key={"r" + i + "c" + j} className={styles["dark-square"]} style={{background: props.darkSquareColor}} />
          )
        }
      }
    }
  }

  // Clamp values to valid range
  const getHorizontal = (horizontal) => {
    return Math.max(1, Math.min(96, horizontal || 8));
  }

  const getVertical = (vertical) => {
    return Math.max(1, Math.min(96, vertical || 8));
  }

  createGrid();

  return (
    <div className={styles["game-board-wrapper"]}>
      <div className={styles["game-board"]}>
        <div 
          className={styles["board-grid"]}
          style={{
            gridTemplateRows: `repeat(${getVertical(props.vertical)}, 1fr)`,
            gridTemplateColumns: `repeat(${getHorizontal(props.horizontal)}, 1fr)`
          }}
        >
          { board }
        </div>
      </div>
      <div>
        Left click the board to add pieces or range squares.  Right click to cancel.
      </div>
    </div>
  );
};

export default GameBoard;