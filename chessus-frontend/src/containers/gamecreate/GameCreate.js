import React, { useState, useRef } from "react";
import { Navigate } from 'react-router-dom';
import { useSelector } from "react-redux";
import GameBoard from "../../components/gameboard/GameBoard"
import axios from 'axios';
import styles from "./gamecreate.module.scss";

const GameCreate = () => {

  const { user: currentUser } = useSelector((state) => state.auth);

  const form = useRef();
  const [horizontal, setHorizontal] = useState(7);
  const [vertical, setVertical] = useState(7);
  const [topLeftLight, setTopLeftLight] = useState(true);
  const [squareLength, setSquareLength] = useState(80);
  const [gameDescription, setGameDescription] = 
  useState("This is a strategy game that resembles chess, but with a different board size, different pieces, and different rules!"+'\n\n'
  + "Don't worry about adding all the rules here.  The rules will be auto-generated based off the pieces, objectives, and other game settings.");
  const [gameDescriptionValidation, setGameDescriptionValidation] = useState("");
  const [gameName, setGameName] = useState("Chessus");
  const [gameNameValidation, setGameNameValidation] = useState("");
  const [gameWidthValidation, setGameWidthValidation] = useState("");
  const [gameHeightValidation, setGameHeightValidation] = useState("");
  const [newGame, setNewGame] = useState(null);
  const [pieceCount, setPieceCount] = useState(0);
  const [captureOrCheckmate, setCaptureOrCheckmate] = useState(true);
  const [winCondition, setWinCondition] = useState("Capture");

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  const handleWinConditionChange = (e) => {
    e.target.value === "Capture" ? setCaptureOrCheckmate(true) : setCaptureOrCheckmate(false);
    setWinCondition(e.target.value);
  }

  const handleSubmitGame = (e) => {
    e.preventDefault();
    setNewGame({})
    console.log("This will create a game once all the game info can be gathered");
  //   axios.post('http://localhost:3001/create/game', 
  //   {data: { game: newGame}})
  //  .then (res => {
  //   //    setUserInfo(currentUser);
  //   //    setUserInfo(res.data.result);
  //   //  setRealUser(true);
  //  })
  //  .catch(
  //    err => {
  //     //  setRealUser(false);
  //      console.log(err);
  //  })
  }


  const handleWidthClick = () => {
    let widthSelect;
    document.getElementById("game-width-id") ? widthSelect = document.getElementById("game-width-id") : console.log("we tried");
    if (widthSelect) {
      widthSelect.select();
    }
  }

    const handleHeightClick = () => {
    let heightSelect;
    document.getElementById("game-height-id") ? heightSelect = document.getElementById("game-height-id") : console.log("we tried");
    if (heightSelect) {
      heightSelect.select();
    }
  }
  

  return (
    <div className={styles["outer-container"]}>
    <div className={styles["container"]}>
      <div className={styles["wrapper"]}>
        <GameBoard horizontal={ horizontal } vertical = { vertical } topLeftLight = { topLeftLight } squareLength = { squareLength } />
      </div>
      <form className={styles["game-form"]} onSubmit={handleSubmitGame} ref={form}>
        <label>Game name: </label>
          <p className={styles["game-validation"]} defaultValue="">{gameNameValidation}</p>

        <input 
        className={styles["game-create-input"]}
        onChange={e => 
          {
            if(e.target.value.length < 3 || e.target.value.length > 50) {
              setGameName(e.target.value);
              setGameNameValidation("Game must have a name between 3 and 50 characters in length!");
            } else {
              setGameName(e.target.value);
              setGameNameValidation("");
            }
          }
        }
        value={gameName}/>

        <label>Description: </label>
        <p className={styles["game-validation"]} defaultValue="">{gameDescriptionValidation}</p>
        <textarea 
        className={styles["game-create-textarea"]}
        onChange={e => 
          {
            if(e.target.value.length < 50 || e.target.value.length >= 1000) {
              setGameDescription(e.target.value);
              setGameDescriptionValidation("Game description must be between 50 and 1000 characters!");
            } else {
              setGameDescription(e.target.value);
              setGameDescriptionValidation("");
            }
          }
        }
        value={gameDescription}/>

        <label>Game width (1 - 96): </label>

        <input
        id="game-width-id"
        className={styles["game-create-input"]}
        onChange={e => 
          {
            const nums = /^[0-9\b]+$/;
            if(nums.test(e.target.value) && e.target.value > 0 && e.target.value <= 96) {
              setHorizontal(parseInt(e.target.value));
            } else {
              if (e.target.value <= 0) {
                setHorizontal(1);
              }
              if (e.target.value > 96 ) {
                setHorizontal(96);
              }
            }
          }
        }
        onClick={handleWidthClick}
        value={horizontal}/>

        <p className={styles["game-validation"]} defaultValue="">{gameWidthValidation}</p>

        <label>Game height (1 - 96): </label>
        <input 
        id="game-height-id"
        className={styles["game-create-input"]}
        onChange={e => 
          {
            const nums = /^[0-9\b]+$/;
            if(nums.test(e.target.value) && e.target.value > 0 && e.target.value <= 96) {
              setVertical(parseInt(e.target.value));
            } else {
              if (e.target.value <= 0) {
                setVertical(1);
              }
              if (e.target.value > 96) {
                setVertical(96);
              }
            }
          }
        } 
        onClick={handleHeightClick}
        value={vertical}/>
        <p className={styles["game-validation"]} defaultValue="">{gameHeightValidation}</p>
        {/* <label>Player count (2 - 8): </label>
        <input 
        className={styles["game-create-input"]}
        onChange={e => 
          {
            const nums = /^[0-9\b]+$/;
            if(nums.test(e.target.value) && e.target.value > 0 && e.target.value <= 8) {
              setVertical(parseInt(e.target.value));
            } else {
              setVertical(2);
            }
          }
        }/> */}
        {/* <label>Actions (moves) each player takes per turn: </label>
        <input 
        className={styles["game-create-input"]}
        onChange={e => 
          {
            const nums = /^[0-9\b]+$/;
            if(nums.test(e.target.value) && e.target.value > 0 && e.target.value <= 8) {
              setVertical(parseInt(e.target.value));
            } else {
              setVertical(2);
            }
          }
        }/> */}
        {/* 
        <div className={styles["checkbox-container"]}>
          <label className={styles["checkbox-label"]}>Randomized starting positions (like in Chess960):&nbsp;</label>
          <input type="checkbox" className={styles["checkbox-style"]} />
        </div> 
        */}
        <div className={styles["conditions-container"]}>
          <div className={styles["conditions-label"]}>
            <label className={styles["conditions-label"]}>Win Conditions (select one):&nbsp;</label>
          </div>
          <div className={styles["checkbox-container"]}>
          <label className={styles["checkbox-label"]}>Capture or checkmate pieces or a particular piece:&nbsp;</label>
          <input type="radio" className={styles["checkbox-style"]} checked={winCondition === "Capture"}
           onChange={handleWinConditionChange} value="Capture"/>
          </div>
          <div className={styles["checkbox-container"]}>
          <label className={styles["checkbox-label"]}>Capture all pieces:&nbsp;</label>
          <input type="radio" className={styles["checkbox-style"]} checked={winCondition === "CaptureAll"}
          onChange={handleWinConditionChange} value="CaptureAll"/>
          </div>
          <div className={styles["checkbox-container"]}>
          <label className={styles["checkbox-label"]}>Checkmate all remaining pieces:&nbsp;</label>
          <input type="radio" className={styles["checkbox-style"]} checked={winCondition === "CheckmateAll"}
          onChange={handleWinConditionChange} value="CheckmateAll"/>
          </div>

          <div className={captureOrCheckmate ? styles["display-block"] : styles["hidden"]}>
          <div className={styles["conditions-label"]}>
            <label className={styles["conditions-label"]}>Win Conditions (select all that apply):&nbsp;</label>
          </div>
            <div className={styles["checkbox-container"]}>
            <label className={styles["checkbox-label"]}>Capture a particular piece:&nbsp;</label>
            <input type="checkbox" className={styles["checkbox-style"]}/>
            </div>
            <div className={styles["checkbox-container"]}>
            <label className={styles["checkbox-label"]}>Checkmate a particular piece:&nbsp;</label>
            <input type="checkbox" className={styles["checkbox-style"]}/>
            </div>
          </div>
        </div> 
        <div>
          Total Piece Count: {pieceCount}
        </div>
        <div className="form-group">
          <button className={styles["submit-button"]}>Create Game</button>
        </div>
      </form>
    </div>
    {/* <div className={styles["game-create-tips"]}>
      <p>* Click the board to add starting pieces for each player.</p>
      <p>* Right click to add range squares (squares that increase the movement or attack range of any piece on it).</p>
    </div> */}
    </div>
  );
};

export default GameCreate;