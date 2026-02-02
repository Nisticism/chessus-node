import React from "react";
import styles from "./standard-button.module.scss";
function StandardButton ({buttonText, onClick, buttonType}) {
  return (
    <button className={styles["standard-button"]} onClick={onClick} type={buttonType ? buttonType : "button"}>{buttonText}</button>
  );
};

export default StandardButton;