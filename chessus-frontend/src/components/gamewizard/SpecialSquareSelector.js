import React, { useState, useEffect } from "react";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import NumberInput from "../common/NumberInput";

const SpecialSquareSelector = ({ 
  onSelect, 
  onRemove, 
  onCancel, 
  currentType,
  currentConfig,
  squarePosition,
  boardWidth = 8,  // For fill row functionality
  squaresConditionEnabled = false
}) => {
  const [fillRow, setFillRow] = useState(false);
  const [selectedType, setSelectedType] = useState(currentType || null);
  
  // Control square configuration state
  const [controlConfig, setControlConfig] = useState({
    turnsRequired: 1,
    consecutiveTurns: false,
    requireSpecificPiece: false,
    appliesToPlayer: 'both' // 'p1', 'p2', or 'both'
  });

  // Custom square combination state — a custom square may simultaneously
  // act as any combination of range / promotion / control squares.
  const [customCombo, setCustomCombo] = useState({
    asRange: false,
    rangeBonus: 1,
    asPromotion: false,
    asControl: false,
  });

  // Plain range square: how much the bonus increases piece range by.
  // Max 8 (validated on backend too). Default 1. Cannot drop below 1
  // (users can always remove the square instead).
  const [rangeBonus, setRangeBonus] = useState(1);

  // Initialize plain range square bonus when editing
  useEffect(() => {
    if (currentType === 'range' && currentConfig) {
      setRangeBonus(Math.min(8, Math.max(1, currentConfig.rangeBonus || 1)));
    }
  }, [currentType, currentConfig]);

  // Initialize controlConfig from currentConfig if editing existing control square
  useEffect(() => {
    if (currentType === 'control' && currentConfig) {
      setControlConfig({
        turnsRequired: currentConfig.turnsRequired || 1,
        consecutiveTurns: currentConfig.consecutiveTurns || false,
        requireSpecificPiece: currentConfig.requireSpecificPiece || false,
        appliesToPlayer: currentConfig.appliesToPlayer || 'both'
      });
    }
  }, [currentType, currentConfig]);

  // Initialize custom combo state when editing an existing custom square
  useEffect(() => {
    if (currentType === 'custom' && currentConfig) {
      setCustomCombo({
        asRange: !!currentConfig.asRange,
        rangeBonus: Math.min(8, Math.max(1, currentConfig.rangeBonus || 1)),
        asPromotion: !!currentConfig.asPromotion,
        asControl: !!currentConfig.asControl,
      });
      if (currentConfig.asControl && currentConfig.controlConfig) {
        setControlConfig({
          turnsRequired: currentConfig.controlConfig.turnsRequired || 1,
          consecutiveTurns: !!currentConfig.controlConfig.consecutiveTurns,
          requireSpecificPiece: !!currentConfig.controlConfig.requireSpecificPiece,
          appliesToPlayer: currentConfig.controlConfig.appliesToPlayer || 'both',
        });
      }
    }
  }, [currentType, currentConfig]);
  
  const squareTypes = [
    { id: 'range', name: 'Range Square', color: 'var(--sq-range)', description: 'Increases attack/movement range of pieces' },
    { id: 'promotion', name: 'Promotion Square', color: 'var(--sq-promotion)', description: 'Allows piece promotion' },
    { id: 'control', name: 'Control Square', color: 'var(--sq-control)', description: 'Players must control to win (if enabled)' },
    { id: 'custom', name: 'Custom Square', color: 'var(--sq-custom)', description: 'Custom effects (define later)' }
  ];

  const handleTypeClick = (typeId) => {
    setSelectedType(typeId);
  };

  const handleConfirm = () => {
    if (!selectedType) return;
    
    const options = { 
      fillRow, 
      row: squarePosition?.row, 
      boardWidth 
    };
    
    // Include control config if selecting control square
    if (selectedType === 'control') {
      options.controlConfig = controlConfig;
    }

    // Include range bonus for plain range squares (1..8, default 1)
    if (selectedType === 'range') {
      options.rangeBonus = Math.min(8, Math.max(1, rangeBonus || 1));
    }

    // Include combination config if selecting custom square
    if (selectedType === 'custom') {
      options.customConfig = {
        asRange: !!customCombo.asRange,
        rangeBonus: customCombo.asRange ? Math.min(8, Math.max(1, customCombo.rangeBonus || 1)) : 1,
        asPromotion: !!customCombo.asPromotion,
        asControl: !!customCombo.asControl,
        controlConfig: customCombo.asControl ? controlConfig : null,
      };
    }
    
    onSelect(selectedType, options);
  };

  const handleControlConfigChange = (field, value) => {
    setControlConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCustomComboChange = (field, value) => {
    setCustomCombo(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className={styles["modal-overlay"]} onClick={onCancel}>
      <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && selectedType) handleConfirm(); }}>
        <div className={styles["modal-header"]}>
          <h2>Special Square at ({squarePosition?.row}, {squarePosition?.col})</h2>
          <button className={styles["close-button"]} onClick={onCancel}>✕</button>
        </div>

        <div className={styles["modal-body"]}>
          <p style={{ marginBottom: '20px', color: 'var(--text-light-gray)' }}>
            Select a square type to designate this square's special property:
          </p>

          {/* Fill Row Toggle */}
          <div 
            className={`${styles["fill-row-toggle"]} ${fillRow ? styles.active : ''}`}
            onClick={() => setFillRow(!fillRow)}
          >
            <div className={`${styles["fill-row-switch"]} ${fillRow ? styles.on : ''}`} />
            <div className={styles["fill-row-content"]}>
              <span className={styles["fill-row-label"]}>
                <span className={styles["fill-row-icon"]}>↔</span>
                Fill Entire Row
              </span>
              <span className={styles["fill-row-hint"]}>
                Apply to all squares in row {squarePosition?.row}
              </span>
            </div>
          </div>

          <div className={styles["square-type-grid"]}>
            {squareTypes.map(type => (
              <div
                key={type.id}
                className={`${styles["square-type-item"]} ${selectedType === type.id ? styles["selected"] : ""}`}
                onClick={() => handleTypeClick(type.id)}
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

          {/* Range Square Configuration Panel */}
          {selectedType === 'range' && (
            <div className={styles["control-config-panel"]}>
              <h4 style={{ marginBottom: '8px', color: 'var(--sq-range, #ff8c00)' }}>
                Range Square Settings
              </h4>
              <p style={{ marginBottom: '16px', color: 'var(--text-light-gray)', fontSize: '0.85rem' }}>
                Boosts the movement / capture / attack range of pieces standing on this square.
              </p>
              <div className={styles["control-config-row"]}>
                <label className={styles["control-config-label"]}>Range Bonus</label>
                <NumberInput
                  value={rangeBonus}
                  onChange={(val) => setRangeBonus(Math.min(8, Math.max(1, val)))}
                  options={{ min: 1, max: 8, className: styles["control-number-input"] }}
                />
                <span className={styles["control-config-hint"]}>
                  How many additional squares of range pieces gain on this square (min 1, max 8).
                </span>
              </div>
            </div>
          )}

          {/* Control Square Configuration Panel */}
          {selectedType === 'control' && (
            <div className={styles["control-config-panel"]}>
              <h4 style={{ marginBottom: '16px', color: 'var(--accent-green)' }}>
                Control Square Settings
              </h4>
              
              {!squaresConditionEnabled && (
                <div className={styles["control-warning"]}>
                  ⚠️ Control Squares win condition is not enabled in Step 2. 
                  Enable it for these settings to take effect.
                </div>
              )}

              {/* Turns Required */}
              <div className={styles["control-config-row"]}>
                <label className={styles["control-config-label"]}>
                  Turns Required to Win
                </label>
                <NumberInput
                  value={controlConfig.turnsRequired}
                  onChange={(val) => handleControlConfigChange('turnsRequired', Math.max(1, val))}
                  options={{ min: 1, max: 100, className: styles["control-number-input"] }}
                />
                <span className={styles["control-config-hint"]}>
                  How many turns a piece must occupy this square
                </span>
              </div>

              {/* Consecutive Turns */}
              <div className={styles["control-config-row"]}>
                <label className={styles["control-checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={controlConfig.consecutiveTurns}
                    onChange={(e) => handleControlConfigChange('consecutiveTurns', e.target.checked)}
                  />
                  <span>Require Consecutive Turns</span>
                </label>
                <span className={styles["control-config-hint"]}>
                  {controlConfig.consecutiveTurns 
                    ? "Turns must be uninterrupted - counter resets if piece leaves" 
                    : "Total turns - counter persists even if piece leaves temporarily"}
                </span>
              </div>

              {/* Player Applicability */}
              <div className={styles["control-config-row"]}>
                <label className={styles["control-config-label"]}>
                  Applies To
                </label>
                <div className={styles["control-player-buttons"]}>
                  <button
                    type="button"
                    className={`${styles["player-btn"]} ${controlConfig.appliesToPlayer === "p1" ? styles["player-btn-active"] : ""}`}
                    onClick={() => handleControlConfigChange('appliesToPlayer', 'p1')}
                  >
                    Player 1 Only
                  </button>
                  <button
                    type="button"
                    className={`${styles["player-btn"]} ${controlConfig.appliesToPlayer === "both" ? styles["player-btn-active"] : ""}`}
                    onClick={() => handleControlConfigChange('appliesToPlayer', 'both')}
                  >
                    Both Players
                  </button>
                  <button
                    type="button"
                    className={`${styles["player-btn"]} ${controlConfig.appliesToPlayer === "p2" ? styles["player-btn-active"] : ""}`}
                    onClick={() => handleControlConfigChange('appliesToPlayer', 'p2')}
                  >
                    Player 2 Only
                  </button>
                </div>
                <span className={styles["control-config-hint"]}>
                  Which player(s) can use this square as a win condition
                </span>
              </div>

              {/* Require Specific Piece */}
              <div className={styles["control-config-row"]}>
                <label className={styles["control-checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={controlConfig.requireSpecificPiece}
                    onChange={(e) => handleControlConfigChange('requireSpecificPiece', e.target.checked)}
                  />
                  <span>Require Specific Piece Type</span>
                </label>
                <span className={styles["control-config-hint"]}>
                  {controlConfig.requireSpecificPiece 
                    ? "Only pieces marked as 'Can Control Squares' in Step 4 can control this square" 
                    : "Any piece can control this square"}
                </span>
              </div>
            </div>
          )}

          {/* Custom Square Combination Panel */}
          {selectedType === 'custom' && (
            <div className={styles["control-config-panel"]}>
              <h4 style={{ marginBottom: '8px', color: 'var(--sq-custom, #ffd700)' }}>
                Custom Square Combinations
              </h4>
              <p style={{ marginBottom: '16px', color: 'var(--text-light-gray)', fontSize: '0.85rem' }}>
                A custom square can act as any combination of the other special square
                types simultaneously. Toggle the behaviors you want this square to have.
              </p>

              {/* As Range */}
              <div className={styles["control-config-row"]}>
                <label className={styles["control-checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={customCombo.asRange}
                    onChange={(e) => handleCustomComboChange('asRange', e.target.checked)}
                  />
                  <span style={{ color: 'var(--sq-range, #ff8c00)' }}>Acts as Range Square</span>
                </label>
                <span className={styles["control-config-hint"]}>
                  Boosts the movement / capture / attack range of pieces standing on it.
                </span>
                {customCombo.asRange && (
                  <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem' }}>Range Bonus:</span>
                    <NumberInput
                      value={customCombo.rangeBonus}
                      onChange={(val) => handleCustomComboChange('rangeBonus', Math.min(8, Math.max(1, val)))}
                      options={{ min: 1, max: 8, className: styles["control-number-input"] }}
                    />
                  </div>
                )}
              </div>

              {/* As Promotion */}
              <div className={styles["control-config-row"]}>
                <label className={styles["control-checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={customCombo.asPromotion}
                    onChange={(e) => handleCustomComboChange('asPromotion', e.target.checked)}
                  />
                  <span style={{ color: 'var(--sq-promotion, #9b59b6)' }}>Acts as Promotion Square</span>
                </label>
                <span className={styles["control-config-hint"]}>
                  Promotable pieces reaching this square can be promoted.
                </span>
              </div>

              {/* As Control */}
              <div className={styles["control-config-row"]}>
                <label className={styles["control-checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={customCombo.asControl}
                    onChange={(e) => handleCustomComboChange('asControl', e.target.checked)}
                  />
                  <span style={{ color: 'var(--sq-control, #32CD32)' }}>Acts as Control Square</span>
                </label>
                <span className={styles["control-config-hint"]}>
                  Counts toward the Control Squares win condition (if enabled in Step 2).
                </span>
              </div>

              {/* Control config sub-panel for the custom square */}
              {customCombo.asControl && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  {!squaresConditionEnabled && (
                    <div className={styles["control-warning"]}>
                      ⚠️ Control Squares win condition is not enabled in Step 2.
                      Enable it for these settings to take effect.
                    </div>
                  )}

                  <div className={styles["control-config-row"]}>
                    <label className={styles["control-config-label"]}>Turns Required to Win</label>
                    <NumberInput
                      value={controlConfig.turnsRequired}
                      onChange={(val) => handleControlConfigChange('turnsRequired', Math.max(1, val))}
                      options={{ min: 1, max: 100, className: styles["control-number-input"] }}
                    />
                  </div>

                  <div className={styles["control-config-row"]}>
                    <label className={styles["control-checkbox-label"]}>
                      <input
                        type="checkbox"
                        checked={controlConfig.consecutiveTurns}
                        onChange={(e) => handleControlConfigChange('consecutiveTurns', e.target.checked)}
                      />
                      <span>Require Consecutive Turns</span>
                    </label>
                  </div>

                  <div className={styles["control-config-row"]}>
                    <label className={styles["control-config-label"]}>Applies To</label>
                    <div className={styles["control-player-buttons"]}>
                      <button
                        type="button"
                        className={`${styles["player-btn"]} ${controlConfig.appliesToPlayer === "p1" ? styles["player-btn-active"] : ""}`}
                        onClick={() => handleControlConfigChange('appliesToPlayer', 'p1')}
                      >Player 1 Only</button>
                      <button
                        type="button"
                        className={`${styles["player-btn"]} ${controlConfig.appliesToPlayer === "both" ? styles["player-btn-active"] : ""}`}
                        onClick={() => handleControlConfigChange('appliesToPlayer', 'both')}
                      >Both Players</button>
                      <button
                        type="button"
                        className={`${styles["player-btn"]} ${controlConfig.appliesToPlayer === "p2" ? styles["player-btn-active"] : ""}`}
                        onClick={() => handleControlConfigChange('appliesToPlayer', 'p2')}
                      >Player 2 Only</button>
                    </div>
                  </div>

                  <div className={styles["control-config-row"]}>
                    <label className={styles["control-checkbox-label"]}>
                      <input
                        type="checkbox"
                        checked={controlConfig.requireSpecificPiece}
                        onChange={(e) => handleControlConfigChange('requireSpecificPiece', e.target.checked)}
                      />
                      <span>Require Specific Piece Type</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
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
          <StandardButton 
            buttonText="Apply" 
            onClick={handleConfirm}
            disabled={!selectedType}
          />
        </div>
      </div>
    </div>
  );
};

export default SpecialSquareSelector;
