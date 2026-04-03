import React from "react";
import styles from "./divider.module.scss";
function Divider ({text, muted}) {
  return (
    <div className={styles["divider-container"]}>
      <div className={`${styles["divider"]} ${muted ? styles["divider-muted"] : ''}`}></div>
    </div>
  );
};

export default Divider;