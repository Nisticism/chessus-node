import React from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import styles from "./footer.module.scss";
import { NAV_MENUS } from "../../config/navMenu";

const Footer = () => {
  const currentYear = new Date().getFullYear();
  const { changelogEnabled: showChangelog } = useSelector((state) => state.siteSettings);

  return (
    <footer className={styles.footer}>
      <div className={styles.footerContent}>
        {NAV_MENUS.map((menu) => (
          <div className={styles.footerSection} key={menu.id}>
            <h3 className={styles.footerHeading}><Link to={menu.path}>{menu.label}</Link></h3>
            <ul className={styles.footerLinks}>
              {menu.items.map((item) => (
                <li key={item.path}><Link to={item.path}>{item.label}</Link></li>
              ))}
            </ul>
          </div>
        ))}

</div>

      <div className={styles.footerLegal}>
        <Link to="/careers">Careers</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms &amp; Conditions</Link>
        {showChangelog && <Link to="/changelog">Changelog</Link>}
      </div>

      <div className={styles.footerBottom}>
        <p>&copy; {currentYear} GridGrove. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
