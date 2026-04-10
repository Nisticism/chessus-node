import React from "react";
import styles from "./NumberInput.module.scss";

const NumberInput = ({ value, onChange, options = {} }) => {
  const { 
    min = 0, 
    max = 99, 
    disabled = false, 
    placeholder = "0", 
    className = "" 
  } = options;
  
  const handleFocus = (e) => {
    e.target.select();
  };
  
  const isInfinite = value === "∞";
  
  const increment = () => {
    if (isInfinite) return;
    const current = parseInt(value) || 0;
    if (current < max) {
      onChange(current + 1);
    }
  };
  
  const decrement = () => {
    if (isInfinite) return;
    const current = parseInt(value) || 0;
    if (current > min) {
      onChange(current - 1);
    }
  };
  
  const displayValue = isInfinite ? "∞" : (value === 99 ? "" : Math.abs(value || 0));
  
  return (
    <div className={styles["number-input-group"]}>
      <button 
        type="button"
        className={`${styles["number-btn"]} ${styles["minus"]}`}
        onClick={decrement}
        disabled={disabled || isInfinite || (parseInt(value) || 0) <= min}
        aria-label="Decrement"
      >
        −
      </button>
      <input
        type="text"
        value={displayValue}
        onChange={(e) => {
          if (e.target.value === "∞") return;
          const parsed = parseInt(e.target.value) || 0;
          onChange(Math.min(max, Math.max(min, parsed)));
        }}
        onFocus={handleFocus}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        style={{ textAlign: 'center', fontSize: isInfinite ? '1.8rem' : 'inherit' }}
      />
      <button 
        type="button"
        className={`${styles["number-btn"]} ${styles["plus"]}`}
        onClick={increment}
        disabled={disabled || isInfinite || (parseInt(value) || 0) >= max}
        aria-label="Increment"
      >
        +
      </button>
    </div>
  );
};

export default NumberInput;
