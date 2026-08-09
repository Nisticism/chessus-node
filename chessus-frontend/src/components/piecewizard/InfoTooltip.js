import React, { useState, useRef, useEffect, useCallback } from "react";
import styles from "./piecewizard.module.scss";

const InfoTooltip = ({ text }) => {
  const [visible, setVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const iconRef = useRef(null);
  const tooltipRef = useRef(null);

  const updatePosition = useCallback(() => {
    if (!iconRef.current || !tooltipRef.current) return;
    const iconRect = iconRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    // Center horizontally over the icon; keep within viewport
    let left = iconRect.left + iconRect.width / 2 - tooltipRect.width / 2;
    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width - 8;
    }

    // Show above icon if there's room, otherwise below
    if (iconRect.top - tooltipRect.height - 8 >= 0) {
      setTooltipStyle({ position: 'fixed', left, top: iconRect.top - tooltipRect.height - 8 });
    } else {
      setTooltipStyle({ position: 'fixed', left, top: iconRect.bottom + 8 });
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
          className={styles["info-tooltip-bubble"]}
          ref={tooltipRef}
          style={tooltipStyle}
        >
          {text}
        </span>
      )}
    </span>
  );
};

export default InfoTooltip;
