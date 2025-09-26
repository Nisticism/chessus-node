import React from "react";
import styles from "./standardtextblock.module.scss";
function StandardTextBlock ({text}) {
  return (
    <div className={styles["text-block-container"]}>
      <div className={styles["standard-text-block"]}>{text}</div>
    </div>
  );
};

export default StandardTextBlock;