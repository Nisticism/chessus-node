import React, { useState, useRef, useEffect, useCallback } from "react";
import styles from "./piecewizard.module.scss";

const InfoTooltip = ({ text }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState("top");
  const iconRef = useRef(null);
  const tooltipRef = useRef(null);

  const updatePosition = useCallback(() => {
    if (!iconRef.current || !tooltipRef.current) return;
    const iconRect = iconRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    // If tooltip would go above viewport, show below
    if (iconRect.top - tooltipRect.height - 8 < 0) {
      setPosition("bottom");
    } else {
      setPosition("top");
    }
  }, []);

  useEffect(() => {
    if (visible) updatePosition();
  }, [visible, updatePosition]);

  return (
    <span
      className={styles["info-tooltip-wrapper"]}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span className={styles["info-tooltip-icon"]} ref={iconRef}>ℹ️</span>
      {visible && (
        <span
          className={`${styles["info-tooltip-bubble"]} ${styles[`info-tooltip-${position}`]}`}
          ref={tooltipRef}
        >
          {text}
        </span>
      )}
    </span>
  );
};

export default InfoTooltip;
