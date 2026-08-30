import React from "react";
import { Link } from "react-router-dom";
import styles from "./hub.module.scss";

// Shared hub layout used by the Play, Create, Community, and Info hubs so every
// hub page renders identical cards and grid behavior.
const HubGrid = ({ title, subtitle, options }) => (
  <div className={styles.hub}>
    <div className={styles.hubHeader}>
      <h1>{title}</h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>

    <div className={styles.grid}>
      {options.map((option, index) => (
        <Link to={option.link} key={index} className={styles.card}>
          <div className={styles.icon}>{option.icon}</div>
          <h2 className={styles.title}>{option.title}</h2>
          <p className={styles.description}>{option.description}</p>
          <span className={styles.link}>Get Started →</span>
        </Link>
      ))}
    </div>
  </div>
);

export default HubGrid;
