import React from "react";
import { Link } from "react-router-dom";
import styles from "./about.module.scss";

const About = () => {
  return (
    <div className={styles["about-container"]}>
      <div className={styles["about-header"]}>
        <h1>About GridGrove</h1>
      </div>

      <div className={styles["about-section"]}>
        <h2>Our Mission</h2>
        <p>
          GridGrove is a community-driven platform dedicated to empowering players to create, share, 
          and play custom strategy board games. We believe that the timeless appeal of chess and 
          strategy games deserves a modern, creative twist — one where the players themselves shape 
          the experience.
        </p>
        <p>
          Founded in 2025, GridGrove was born from the idea that chess variants shouldn't be limited 
          to what's already been invented. Our platform gives anyone the tools to design unique pieces 
          with custom movement patterns, build game boards of any size, and share their creations with 
          a global community of strategists.
        </p>
      </div>

      <div className={styles["about-section"]}>
        <h2>Our Team</h2>
        <div className={styles["team-grid"]}>
          <div className={styles["team-member"]}>
            <div className={styles["member-info"]}>
              <h3><Link to="/profile/Nisticism" className={styles["profile-link"]}>Nisticism</Link></h3>
              <div className={styles["member-role"]}>Founder & Lead Developer</div>
              <p>
                Creator of GridGrove. Nisticism handles the development and design of the platform, 
                from the piece creation tools to the multiplayer engine.
              </p>
            </div>
          </div>
          <div className={styles["team-member"]}>
            <div className={styles["member-info"]}>
              <h3><Link to="/profile/Zoe" className={styles["profile-link"]}>Zoe</Link></h3>
              <div className={styles["member-role"]}>Game Tester</div>
              <p>
                Zoe has helped test games and provide feedback throughout GridGrove's development, 
                ensuring the platform is fun and functional for all players.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className={styles["about-section"]}>
        <h2>Future Goals</h2>
        <ul className={styles["about-list"]}>
          <li><strong>Global Tournaments</strong> — Expand our tournament system to support large-scale competitive events with prizes and rankings across multiple game variants.</li>
          <li><strong>AI Opponents</strong> — Develop AI that can learn and play any custom game variant, giving players practice partners and solo play options.</li>
          <li><strong>Mobile App</strong> — Bring GridGrove to iOS and Android so players can create, share, and play on the go.</li>
          <li><strong>Educational Tools</strong> — Build resources for educators to use GridGrove as a teaching tool for logic, strategy, and game design.</li>
          <li><strong>More Games</strong> — Add support for Shogi, Go, Duck Chess, Bughouse, Othello, and other grid-based board games.</li>
        </ul>
      </div>
    </div>
  );
};

export default About;
