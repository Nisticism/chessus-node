import React from "react";
import { Link } from "react-router-dom";
import styles from "./footer.module.scss";

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.footerContent}>
        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>Create</h3>
          <ul className={styles.footerLinks}>
            <li><Link to="/create/game">New Game</Link></li>
            <li><Link to="/create/piece">New Piece</Link></li>
            <li><Link to="/create/games">View Games</Link></li>
            <li><Link to="/create/pieces">View Pieces</Link></li>
            <li><Link to="/sandbox">Sandbox</Link></li>
          </ul>
        </div>

        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>Play</h3>
          <ul className={styles.footerLinks}>
            <li><Link to="/play">Browse Open Games</Link></li>
            <li><Link to="/community/leaderboard">Leaderboard</Link></li>
          </ul>
        </div>

        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>Community</h3>
          <ul className={styles.footerLinks}>
            <li><Link to="/forums">Forums</Link></li>
            <li><Link to="/forums/game">Game Forums</Link></li>
            <li><Link to="/community/players">Players</Link></li>
            <li><Link to="/news">News</Link></li>
          </ul>
        </div>

        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>About</h3>
          <ul className={styles.footerLinks}>
            <li><Link to="/contact">Contact</Link></li>
            <li><Link to="/donate">Support Us</Link></li>
            <li><Link to="/privacy">Privacy Policy</Link></li>
          </ul>
        </div>

        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>Squarestrat</h3>
          <p className={styles.footerDescription}>
            A community-driven platform for creating, sharing, and playing custom strategy board games.
          </p>
        </div>
      </div>

      <div className={styles.footerBottom}>
        <p>&copy; {currentYear} Squarestrat. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
