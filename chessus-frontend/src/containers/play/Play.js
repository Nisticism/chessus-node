import React from "react";
import styles from "./play.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { useNavigate } from "react-router-dom";
const Play = () => {

  const navigate = useNavigate();

  const goToChess = () => {
    navigate("/chess");
  }

  return (
    <div className="container">
      <div className={styles["home-container"]}>
        <h2>Our Play Page Is Under Construction</h2>
        {/* <h3>{content}</h3> */}
        <div className={styles["media-description-main"]}>
          <div>
            In the mean time, feel free to check out our chess demo page.
            <br/>
            <br/>

            <StandardButton buttonText={"Chess"} onClick={goToChess}/>
            

          </div>
        </div>
          {/* <img src={chest_wizard_game} alt="Chest Wizard Game" className={styles["home-game-image"]}/>
          <p>
            Example of a game you can make with squarestrat
          </p> */}
      </div>
    </div>
  );
};
export default Play;