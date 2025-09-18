import React from "react";
import { useState, useEffect } from "react";
import { Navigate } from 'react-router-dom';
import { useSelector } from "react-redux";
import styles from "./gameboard.module.scss";

const GameBoard = (props) => {

  function getWindowDimensions() {
    const { innerWidth: windowWidth, innerHeight: windowHeight } = window;
    return {
      windowWidth,
      windowHeight
    };
  }
  
  function useWindowDimensions() {
    const [windowDimensions, setWindowDimensions] = useState(getWindowDimensions());
  
    useEffect(() => {
      function handleResize() {
        setWindowDimensions(getWindowDimensions());
      }
  
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, []);
  
    return windowDimensions;
  }

  // function isScrollBarPresent() {
  //   useEffect(() => {
  //     if (document.body.clientHeight > windowHeight) {

  //     }
  //   })
  // }

  const { windowHeight, windowWidth } = useWindowDimensions();

  const { user: currentUser } = useSelector((state) => state.auth);
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
            <div key={"r" + i + "c" + j} className={styles["light-square"]} onClick={handleBoardClick}/>
          )
        } else {
          board.push(
            <div key={"r" + i + "c" + j} className={styles["dark-square"]} />
          )
        }
      }
    }
  }

  const getWidth = (squares, windowWidth) => {
    if (squares * windowWidth > 600) {
      return 600;
    } else {
      return squares * windowWidth;
    }
  }

  const getBoardSize = () => {
    let length = windowWidth * 0.6;
    if (windowWidth <= 912) {
      length = windowWidth * 0.85;
    }
    if (length + 250 > windowHeight) {
      length = windowHeight - 250;
    }
    if (length < 350) {
      return 350;
    } else {
      return length;
    }
  }
  
  const getSquareLength = (horizontal, vertical, length) => {
    if (horizontal > vertical) {
      return (length/horizontal)
    } else {
      return (length/vertical)
    }
  }

  // Max squares is 60 for both dimensions:

  const getHorizontal = (horizontal) => {
    if (horizontal > 96) {
      return 96;
    } else if (horizontal < 1) {
      return 1;
    } else {
      return horizontal;
    }
  }

  const getVertical = (vertical) => {
    if (vertical > 96) {
      return 96;
    } else if (vertical < 1) {
      return 1;
    } else {
      return vertical;
    }
  }

  const boardStyle = {
    display: "grid",
    gridTemplateRows: `repeat(${getHorizontal(props.vertical)}, ${getSquareLength(props.horizontal, props.vertical, getBoardSize())}px)`,
    gridTemplateColumns: `repeat(${getVertical(props.horizontal)}, ${getSquareLength(props.horizontal, props.vertical, getBoardSize())}px)`,
    width: "max-content",
    height: "max-content",
    boxShadow: "0px 0px 8px 8px rgb(109, 138, 190)",
  }

  createGrid();

  return (
    <div className={styles["game-board-wrapper"]}>
      <div className={styles["game-board"]}>
        <div style= { boardStyle } >
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