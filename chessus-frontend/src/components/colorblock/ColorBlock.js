import React from "react";
import styles from "./colorblock.module.scss";
function ColorBlock ({mainColor, textColor, text, setHandle}) {

    
      const colorBlockStyles = {
        backgroundColor: mainColor,
        color: textColor,
        width: '50px',
        height: '50px',
        display: 'inline-block',
      }
    

  return (
    <div style={ colorBlockStyles } className={styles["color-block-style"]} onClick={setHandle}>{ text }</div>
  );
};

export default ColorBlock;