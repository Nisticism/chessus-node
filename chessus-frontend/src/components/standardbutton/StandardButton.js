import React from "react";
import styles from "./standard-button.module.scss";
function StandardButton ({buttonText, onClick, buttonType, disabled, className, children}) {
  return (
    <button 
      className={`${styles["standard-button"]} ${className || ''}`} 
      onClick={onClick} 
      type={buttonType ? buttonType : "button"}
      disabled={disabled}
    >
      {children || buttonText}
    </button>
  );
};

export default StandardButton;