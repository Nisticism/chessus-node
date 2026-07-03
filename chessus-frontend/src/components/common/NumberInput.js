import React, { useState } from "react";
import styles from "./NumberInput.module.scss";

const NumberInput = ({ value, onChange, options = {} }) => {
  const { 
    min = 0, 
    max = 99, 
    disabled = false, 
    placeholder = "0", 
    className = "",
    step = 1,
    allowDecimals = false,
  } = options;

  // Local text buffer used only in decimal mode so users can type partial values
  // like "6." on the way to "6.5" without the controlled input snapping back.
  const [text, setText] = useState(null);

  const parseNum = (v) => (allowDecimals ? (parseFloat(v) || 0) : (parseInt(v) || 0));
  const stepDecimals = Math.max(0, (String(step).split('.')[1] || '').length);
  const roundToStep = (v) => (allowDecimals ? Number(v.toFixed(Math.max(1, stepDecimals))) : Math.round(v));
  const clamp = (v) => Math.min(max, Math.max(min, v));

  const handleFocus = (e) => {
    e.target.select();
  };
  
  const isInfinite = value === "∞";
  
  const increment = () => {
    if (isInfinite) return;
    const current = parseNum(value);
    if (current < max) {
      setText(null);
      onChange(clamp(roundToStep(current + step)));
    }
  };
  
  const decrement = () => {
    if (isInfinite) return;
    const current = parseNum(value);
    if (current > min) {
      setText(null);
      onChange(clamp(roundToStep(current - step)));
    }
  };
  
  const displayValue = isInfinite
    ? "∞"
    : allowDecimals
      ? (text != null ? text : (value ?? 0))
      : (value === 99 ? "" : Math.abs(value || 0));
  
  return (
    <div className={styles["number-input-group"]}>
      <button 
        type="button"
        className={`${styles["number-btn"]} ${styles["minus"]}`}
        onClick={decrement}
        disabled={disabled || isInfinite || parseNum(value) <= min}
        aria-label="Decrement"
      >
        −
      </button>
      <input
        type="text"
        value={displayValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "∞") return;
          if (allowDecimals) {
            // Allow digits and a single decimal point while typing.
            if (!/^-?\d*\.?\d*$/.test(raw)) return;
            setText(raw);
            if (raw === "" || raw === "." || raw === "-") { onChange(min); return; }
            const parsed = parseFloat(raw);
            if (!isNaN(parsed)) onChange(clamp(roundToStep(parsed)));
          } else {
            const parsed = parseInt(raw) || 0;
            onChange(clamp(parsed));
          }
        }}
        onFocus={handleFocus}
        onBlur={() => setText(null)}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        style={{ textAlign: 'center', fontSize: isInfinite ? '1.8rem' : 'inherit' }}
      />
      <button 
        type="button"
        className={`${styles["number-btn"]} ${styles["plus"]}`}
        onClick={increment}
        disabled={disabled || isInfinite || parseNum(value) >= max}
        aria-label="Increment"
      >
        +
      </button>
    </div>
  );
};

export default NumberInput;
