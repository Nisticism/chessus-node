import React from "react";
import styles from "./divider.module.scss";
function Divider ({text}) {
  return (
    <div className={styles["divider-container"]}>
      <div className={styles["divider"]}></div>
    </div>
  );
};

export default Divider;