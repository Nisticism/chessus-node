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
            <li><Link to="/create/games">View Game Library</Link></li>
            <li><Link to="/create/pieces">View Piece Library</Link></li>
          </ul>
        </div>

        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>Play</h3>
          <ul className={styles.footerLinks}>
            <li><Link to="/play">Browse Open Games</Link></li>
            <li><Link to="/sandbox">Sandbox</Link></li>
            <li><Link to="/play/tournaments">Tournaments</Link></li>
            <li><Link to="/create/games">View Game Library</Link></li>
          </ul>
        </div>

        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>Community</h3>
          <ul className={styles.footerLinks}>
            <li><Link to="/forums">Forums</Link></li>
            <li><Link to="/community/players">Players</Link></li>
            <li><Link to="/news">News</Link></li>
            <li><Link to="/community/social">Social Media</Link></li>
            <li><Link to="/community/about">About</Link></li>
          </ul>
        </div>

        <div className={styles.footerSection}>
          <h3 className={styles.footerHeading}>Misc</h3>
          <ul className={styles.footerLinks}>
            <li><Link to="/faq">FAQ</Link></li>
            <li><Link to="/contact">Contact</Link></li>
            <li><Link to="/donate">Support GridGrove</Link></li>
            <li><Link to="/careers">Careers</Link></li>
            <li><Link to="/privacy">Privacy Policy</Link></li>
          </ul>
        </div>


      </div>

      <div className={styles.footerBottom}>
        <p>&copy; {currentYear} GridGrove. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
