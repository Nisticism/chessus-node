import React, { useState, useEffect } from "react";
import UserService from "../../services/user.service";
import styles from "./home.module.scss";
import chest_wizard_game from '../../assets/boards/chest_wizard_game.png';
const Home = () => {

  // const [content, setContent] = useState("");

  // useEffect(() => {
  //   UserService.getPublicContent().then(
  //     (response) => {
  //       setContent(response.data);
  //     },
  //     (error) => {
  //       const _content =
  //         (error.response && error.response.data) ||
  //         error.message ||
  //         error.toString();
  //       setContent(_content);
  //     }
  //   );
  // }, []);

  return (
    <div className="container">
      <div className={styles["home-container"]}>
        <h2>What is Squarestrat?</h2>
        {/* <h3>{content}</h3> */}
        <div className={styles["home-description-main"]}>
          <div>
            Squarestrat is a place that allows for the creation of custom strategy board games using boards with
            alternating squares of any length, and custom pieces.  Its mission is to
            crowdsource fun and strategically interesting board games.  We believe that chess, though it
            has stood the test of time, is not necessarily the greatest board game of all time, and potentially just
            a stepping stone to something even more fun!

            <br/>
            <br/>

            Users can create games, forums, comments, and like the creations of other users, increasing their popularity,
            and visibility on the site.  Some of these games may resemble chess, any some may be more significantly different.
            
            <br/>
            <br/>

            Eventually users will have ratings for each game they play and also a general rating across the whole site.

          </div>
        </div>
          <img src={chest_wizard_game} alt="Chest Wizard Game" className={styles["home-game-image"]}/>
          <p>
            Example of a game you can make with squarestrat
          </p>
      </div>
    </div>
  );
};
export default Home;