import React from "react";
import styles from "./media.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { useNavigate } from "react-router-dom";
const Media = () => {

  const navigate = useNavigate();

  const forumList = () => {
    navigate("/forums");
  }

  return (
    <div className="container">
      <div className={styles["home-container"]}>
        <h2>Our Media Page Is Under Construction</h2>
        {/* <h3>{content}</h3> */}
        <div className={styles["media-description-main"]}>
          <div>
            In the mean time, feel free to check out our forums!
            <br/>
            <br/>

            <StandardButton buttonText={"Forums"} onClick={forumList}/>
            

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
export default Media;