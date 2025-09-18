import React from "react";
import styles from "./community.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { useNavigate } from "react-router-dom";
const Community = () => {

  const navigate = useNavigate();

  const playerList = () => {
    navigate("/community/players");
  }

  return (
    <div className="container">
      <div className={styles["home-container"]}>
        <h2>Our Community Page Is Under Construction</h2>
        {/* <h3>{content}</h3> */}
        <div className={styles["community-description-main"]}>
          <div>
            In the mean time, feel free to check out our list of players.

            <br/>
            <br/>

            <StandardButton buttonText={"Player List"} onClick={playerList}/>
            

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
export default Community;