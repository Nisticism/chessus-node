import React from "react";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";

const SpecialSquareSelector = ({ 
  onSelect, 
  onRemove, 
  onCancel, 
  currentType,
  squarePosition 
}) => {
  const squareTypes = [
    { id: 'range', name: 'Range Square', color: '#ff8c00', description: 'Increases attack/movement range of pieces' },
    { id: 'promotion', name: 'Promotion Square', color: '#4b0082', description: 'Allows piece promotion' },
    { id: 'control', name: 'Control Square', color: '#32CD32', description: 'Players must control to win (if enabled)' },
    { id: 'custom', name: 'Custom Square', color: '#ffd700', description: 'Custom effects (define later)' }
  ];

  return (
    <div className={styles["modal-overlay"]} onClick={onCancel}>
      <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
        <div className={styles["modal-header"]}>
          <h2>Special Square at ({squarePosition?.row}, {squarePosition?.col})</h2>
          <button className={styles["close-button"]} onClick={onCancel}>✕</button>
        </div>

        <div className={styles["modal-body"]}>
          <p style={{ marginBottom: '20px', color: 'var(--text-light-gray)' }}>
            Select a square type to designate this square's special property:
          </p>

          <div className={styles["square-type-grid"]}>
            {squareTypes.map(type => (
              <div
                key={type.id}
                className={`${styles["square-type-item"]} ${currentType === type.id ? styles["selected"] : ""}`}
                onClick={() => onSelect(type.id)}
                style={{ borderColor: type.color }}
              >
                <div 
                  className={styles["square-type-indicator"]}
                  style={{ background: type.color }}
                >
                  {type.name.charAt(0)}
                </div>
                <div className={styles["square-type-info"]}>
                  <div className={styles["square-type-name"]} style={{ color: type.color }}>
                    {type.name}
                  </div>
                  <div className={styles["square-type-description"]}>
                    {type.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles["modal-footer"]}>
          {currentType && (
            <StandardButton 
              buttonText="Remove Special Square" 
              onClick={onRemove}
            />
          )}
          <div style={{ flex: 1 }} />
          <StandardButton 
            buttonText="Cancel" 
            onClick={onCancel}
          />
        </div>
      </div>
    </div>
  );
};

export default SpecialSquareSelector;
