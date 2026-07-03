import React, { useState, useEffect } from "react";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import NumberInput from "../common/NumberInput";
import ToggleSwitch from "../common/ToggleSwitch";
import InfoTooltip from "../piecewizard/InfoTooltip";

const SpecialSquareSelector = ({ 
  onSelect, 
  onRemove, 
  onCancel, 
  currentType,
  currentConfig,
  squarePosition,
  boardWidth = 8,  // For fill row functionality
  boardHeight = 8, // For algebraic rank calculation
  playerCount = 2,  // Number of players (for dynamic player buttons)
  squaresConditionEnabled = false,
  pointsWinConditionEnabled = false,
  placePiecesActionEnabled = false,  // Whether the per-turn place-pieces action is on in Step 2
  onRemoveRow,  // (row: number) => void — clears all special squares in this row
}) => {
  // Algebraic notation helpers
  const toFile = (col) => String.fromCharCode(97 + (col ?? 0));
  const toRank = (row) => (boardHeight ?? 8) - (row ?? 0);
  const [fillRow, setFillRow] = useState(false);
  const [selectedType, setSelectedType] = useState(currentType || null);
  
  // Control square configuration state
  const [controlConfig, setControlConfig] = useState({
    turnsRequired: 1,
    consecutiveTurns: false,
    requireSpecificPiece: false,
    appliesToPlayer: 'both' // 'p1', 'p2', or 'both'
  });

  // Promotion square player-restriction config (applies to both plain
  // promotion squares and custom squares acting as promotion squares).
  // Values: 'all' (all players), 'neutral' (neutral pieces only), 'p1', 'p2', etc.
  const [promotionConfig, setPromotionConfig] = useState({ appliesToPlayer: 'all' });

  // Custom square combination state — a custom square may simultaneously
  // act as any combination of range / promotion / control squares.
  const [customCombo, setCustomCombo] = useState({
    asRange: false,
    rangeBonus: 1,
    asPromotion: false,
    promotionAppliesToPlayer: 'all',
    asControl: false,
    asRestrictionZone: false,
    allowRangedOutsideZone: false,
    restrictFirstMoveToCustom: false,
    disableFirstMoveHere: false,
    impassable: false,
    controlPoints: 0,
    restrictPiecePlacement: false,
    restrictPiecePlacementTo: 'all',
    confinePlacementToHere: false,
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

  // Initialize promotion config when editing an existing promotion square
  useEffect(() => {
    if (currentType === 'promotion' && currentConfig) {
      // Normalize legacy 'both' value to 'all'
      const raw = currentConfig.appliesToPlayer || 'all';
      setPromotionConfig({ appliesToPlayer: raw === 'both' ? 'all' : raw });
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
        promotionAppliesToPlayer: (() => { const raw = currentConfig.promotionAppliesToPlayer || 'all'; return raw === 'both' ? 'all' : raw; })(),
        asControl: !!currentConfig.asControl,
        asRestrictionZone: !!currentConfig.asRestrictionZone,
        allowRangedOutsideZone: !!currentConfig.allowRangedOutsideZone,
        restrictFirstMoveToCustom: !!currentConfig.restrictFirstMoveToCustom,
        disableFirstMoveHere: !!currentConfig.disableFirstMoveHere,
        impassable: !!currentConfig.impassable,
        controlPoints: Math.max(0, Math.min(999, currentConfig.controlPoints || 0)),
        restrictPiecePlacement: !!currentConfig.restrictPiecePlacement,
        restrictPiecePlacementTo: currentConfig.restrictPiecePlacementTo || 'all',
        confinePlacementToHere: !!currentConfig.confinePlacementToHere,
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

    // Include promotion config for plain promotion squares
    if (selectedType === 'promotion') {
      options.promotionConfig = { appliesToPlayer: promotionConfig.appliesToPlayer || 'all' };
    }

    // Include combination config if selecting custom square
    if (selectedType === 'custom') {
      options.customConfig = {
        asRange: !!customCombo.asRange,
        rangeBonus: customCombo.asRange ? Math.min(8, Math.max(1, customCombo.rangeBonus || 1)) : 1,
        asPromotion: !!customCombo.asPromotion,
        promotionAppliesToPlayer: customCombo.asPromotion ? (customCombo.promotionAppliesToPlayer || 'all') : 'all',
        asControl: !!customCombo.asControl,
        controlConfig: customCombo.asControl ? controlConfig : null,
        asRestrictionZone: !!customCombo.asRestrictionZone,
        allowRangedOutsideZone: !!customCombo.allowRangedOutsideZone,
        restrictFirstMoveToCustom: !!customCombo.restrictFirstMoveToCustom,
        disableFirstMoveHere: !!customCombo.disableFirstMoveHere,
        impassable: !!customCombo.impassable,
        controlPoints: Math.max(0, Math.min(999, customCombo.controlPoints || 0)),
        restrictPiecePlacement: !!customCombo.restrictPiecePlacement,
        restrictPiecePlacementTo: customCombo.restrictPiecePlacement ? (customCombo.restrictPiecePlacementTo || 'all') : 'all',
        confinePlacementToHere: !!(customCombo.restrictPiecePlacement && customCombo.confinePlacementToHere),
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

  const handlePromotionConfigChange = (field, value) => {
    setPromotionConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleCustomComboChange = (field, value) => {
    setCustomCombo(prev => {
      const next = { ...prev, [field]: value };
      // Mutual exclusion: "restrict first-move to these squares" and
      // "disable first-move on this square" cannot both be on at once.
      if (value === true) {
        if (field === 'restrictFirstMoveToCustom') next.disableFirstMoveHere = false;
        if (field === 'disableFirstMoveHere') next.restrictFirstMoveToCustom = false;
      }
      return next;
    });
  };

  return (
    <div className={styles["modal-overlay"]} onClick={onCancel}>
      <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && selectedType) handleConfirm(); }}>
        <div className={styles["modal-header"]}>
          <h2>Special Square at {toFile(squarePosition?.col)}{toRank(squarePosition?.row)}</h2>
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
                Apply to all squares in rank {toRank(squarePosition?.row)}
              </span>
            </div>
          </div>

          {/* Remove Row button */}
          {onRemoveRow && (
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                margin: '8px 0',
                background: 'rgba(190, 140, 0, 0.15)',
                border: '2px solid rgba(190, 140, 0, 0.5)',
                borderRadius: '6px',
                color: '#ffc94d',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                width: '100%',
                textAlign: 'left',
                transition: 'background 0.2s, border-color 0.2s',
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(190,140,0,0.28)'; e.currentTarget.style.borderColor = 'rgba(190,140,0,0.8)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(190,140,0,0.15)'; e.currentTarget.style.borderColor = 'rgba(190,140,0,0.5)'; }}
              onClick={() => { if (window.confirm(`Remove all special squares from rank ${toRank(squarePosition?.row)}?`)) onRemoveRow(squarePosition?.row); }}
            >
              <span style={{ fontSize: '16px' }}>✕</span>
              Remove Entire Row
            </button>
          )}

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

          {/* Promotion Square Configuration Panel */}
          {selectedType === 'promotion' && (
            <div className={styles["control-config-panel"]}>
              <h4 style={{ marginBottom: '8px', color: 'var(--sq-promotion, #9b59b6)' }}>
                Promotion Square Settings
              </h4>
              <div className={styles["player-selection"]}>
                <label>Which players can promote on this square:</label>
                <div className={styles["player-radio-group"]}>
                  <label className={styles["player-radio-label"]}>
                    <input
                      type="radio"
                      name="promoAppliesTo"
                      value="all"
                      checked={promotionConfig.appliesToPlayer === 'all' || !promotionConfig.appliesToPlayer}
                      onChange={() => handlePromotionConfigChange('appliesToPlayer', 'all')}
                    />
                    <span>All Players</span>
                  </label>
                  {Array.from({ length: playerCount }, (_, i) => i + 1).map(pid => (
                    <label key={pid} className={styles["player-radio-label"]}>
                      <input
                        type="radio"
                        name="promoAppliesTo"
                        value={`p${pid}`}
                        checked={promotionConfig.appliesToPlayer === `p${pid}`}
                        onChange={() => handlePromotionConfigChange('appliesToPlayer', `p${pid}`)}
                      />
                      <span>Player {pid} Only</span>
                    </label>
                  ))}
                  <label className={styles["player-radio-label"]}>
                    <input
                      type="radio"
                      name="promoAppliesTo"
                      value="neutral"
                      checked={promotionConfig.appliesToPlayer === 'neutral'}
                      onChange={() => handlePromotionConfigChange('appliesToPlayer', 'neutral')}
                    />
                    <span>Neutral Only</span>
                  </label>
                </div>
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
                <ToggleSwitch
                  checked={!!controlConfig.consecutiveTurns}
                  onChange={(v) => handleControlConfigChange('consecutiveTurns', v)}
                  label="Require Consecutive Turns"
                  tooltip={<InfoTooltip text={controlConfig.consecutiveTurns
                    ? "Turns must be uninterrupted \u2014 the counter resets if the piece leaves this square."
                    : "Total turns held \u2014 the counter persists even if the piece leaves this square temporarily."} />}
                />
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
                <ToggleSwitch
                  checked={!!controlConfig.requireSpecificPiece}
                  onChange={(v) => handleControlConfigChange('requireSpecificPiece', v)}
                  label="Require Specific Piece Type"
                  tooltip={<InfoTooltip text={controlConfig.requireSpecificPiece
                    ? "Only pieces marked 'Can Control Squares' in Step 4 can control this square."
                    : "Any piece can control this square."} />}
                />
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
                <ToggleSwitch
                  checked={!!customCombo.asRange}
                  onChange={(v) => handleCustomComboChange('asRange', v)}
                  label={<span style={{ color: 'var(--sq-range, #ff8c00)' }}>Acts as Range Square</span>}
                  tooltip={<InfoTooltip text="Boosts the movement / capture / attack range of pieces standing on this square." />}
                />
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
                <ToggleSwitch
                  checked={!!customCombo.asPromotion}
                  onChange={(v) => handleCustomComboChange('asPromotion', v)}
                  label={<span style={{ color: 'var(--sq-promotion, #9b59b6)' }}>Acts as Promotion Square</span>}
                  tooltip={<InfoTooltip text="Promotable pieces reaching this square can be promoted." />}
                />
                {customCombo.asPromotion && (
                  <div className={styles["player-selection"]} style={{ marginTop: '8px', marginBottom: 0 }}>
                    <label>Which players can promote on this square:</label>
                    <div className={styles["player-radio-group"]}>
                      <label className={styles["player-radio-label"]}>
                        <input
                          type="radio"
                          name="customPromoAppliesTo"
                          value="all"
                          checked={customCombo.promotionAppliesToPlayer === 'all' || !customCombo.promotionAppliesToPlayer}
                          onChange={() => handleCustomComboChange('promotionAppliesToPlayer', 'all')}
                        />
                        <span>All Players</span>
                      </label>
                      {Array.from({ length: playerCount }, (_, i) => i + 1).map(pid => (
                        <label key={pid} className={styles["player-radio-label"]}>
                          <input
                            type="radio"
                            name="customPromoAppliesTo"
                            value={`p${pid}`}
                            checked={customCombo.promotionAppliesToPlayer === `p${pid}`}
                            onChange={() => handleCustomComboChange('promotionAppliesToPlayer', `p${pid}`)}
                          />
                          <span>Player {pid} Only</span>
                        </label>
                      ))}
                      <label className={styles["player-radio-label"]}>
                        <input
                          type="radio"
                          name="customPromoAppliesTo"
                          value="neutral"
                          checked={customCombo.promotionAppliesToPlayer === 'neutral'}
                          onChange={() => handleCustomComboChange('promotionAppliesToPlayer', 'neutral')}
                        />
                        <span>Neutral Only</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* As Control */}
              <div className={styles["control-config-row"]}>
                <ToggleSwitch
                  checked={!!customCombo.asControl}
                  onChange={(v) => handleCustomComboChange('asControl', v)}
                  label={<span style={{ color: 'var(--sq-control, #32CD32)' }}>Acts as Control Square</span>}
                  tooltip={<InfoTooltip text="Counts toward the Control Squares win condition (must be enabled in Step 2)." />}
                />
              </div>

              {/* As Restriction Zone */}
              <div className={styles["control-config-row"]}>
                <ToggleSwitch
                  checked={!!customCombo.asRestrictionZone}
                  onChange={(v) => handleCustomComboChange('asRestrictionZone', v)}
                  label={<span style={{ color: 'var(--sq-custom, #ffd700)' }}>Acts as Restriction Zone</span>}
                  tooltip={<InfoTooltip text="Marks this square as part of the Restriction Zone. Pieces with 'Cannot Move Outside Zone' enabled in Step 4 may only move to squares that are part of a Restriction Zone. Useful for limiting a piece to a specific region of the board." />}
                />
              </div>

              {/* Allow Ranged Attacks Outside Zone — only meaningful on zone squares */}
              {!!customCombo.asRestrictionZone && (
                <div className={styles["control-config-row"]} style={{ marginLeft: '16px' }}>
                  <ToggleSwitch
                    checked={!!customCombo.allowRangedOutsideZone}
                    onChange={(v) => handleCustomComboChange('allowRangedOutsideZone', v)}
                    label="Allow Ranged Attacks Outside Zone"
                    tooltip={<InfoTooltip text="When enabled, zone-restricted pieces standing on this square may fire ranged attacks to squares outside the Restriction Zone, even though they cannot physically move there. Without this, ranged attacks are also confined to the zone." />}
                  />
                </div>
              )}

              {/* First-Move Ability Restrictions — mutually exclusive */}
              <div className={styles["control-config-row"]}>
                <ToggleSwitch
                  checked={!!customCombo.restrictFirstMoveToCustom}
                  onChange={(v) => handleCustomComboChange('restrictFirstMoveToCustom', v)}
                  disabled={!!customCombo.disableFirstMoveHere}
                  label="Restrict First-Move Abilities to These Squares"
                  tooltip={<InfoTooltip text="When ANY custom square in this game has this flag set, 'first move only' / 'available for first N moves' abilities are disabled everywhere EXCEPT when a piece is standing on a custom square with this flag. Useful for chess-style pawn double-step from a specific rank. Mutually exclusive with the next setting." />}
                />
              </div>

              <div className={styles["control-config-row"]}>
                <ToggleSwitch
                  checked={!!customCombo.disableFirstMoveHere}
                  onChange={(v) => handleCustomComboChange('disableFirstMoveHere', v)}
                  disabled={!!customCombo.restrictFirstMoveToCustom}
                  label="Disable First-Move Abilities On This Square"
                  tooltip={<InfoTooltip text="While a piece is standing on this square, all 'first move only' / 'available for first N moves' abilities are unavailable for that piece. Mutually exclusive with the previous setting." />}
                />
              </div>

              {/* Impassable */}
              <div className={styles["control-config-row"]}>
                <ToggleSwitch
                  checked={!!customCombo.impassable}
                  onChange={(v) => handleCustomComboChange('impassable', v)}
                  label="Impassable"
                  tooltip={<InfoTooltip text="Pieces cannot land on or move through this square. Pieces with Ghostwalk can still pass through. Pieces with hopping ability can hop over it but cannot land on it. Ranged attacks cannot fire through impassable squares." />}
                />
              </div>

              {/* Restrict Piece Placement — only relevant when place_pieces_action is on */}
              {placePiecesActionEnabled && (
                <div className={styles["control-config-row"]}>
                  <ToggleSwitch
                    checked={!!customCombo.restrictPiecePlacement}
                    onChange={(v) => handleCustomComboChange('restrictPiecePlacement', v)}
                    label={<span style={{ color: 'var(--sq-custom, #ffd700)' }}>Restrict Piece Placement</span>}
                    tooltip={<InfoTooltip text="Restricts which player can place a piece on this square via the per-turn 'Place Pieces' action. When enabled, choose which player (or all players) may use this square for placement." />}
                  />
                  {customCombo.restrictPiecePlacement && (
                    <div className={styles["player-selection"]} style={{ marginTop: '8px', marginBottom: 0 }}>
                      <label>Who is <strong>allowed</strong> to place pieces on this square:</label>
                      <div className={styles["player-radio-group"]}>
                        <label className={styles["player-radio-label"]}>
                          <input
                            type="radio"
                            name="restrictPlacementTo"
                            value="all"
                            checked={customCombo.restrictPiecePlacementTo === 'all' || !customCombo.restrictPiecePlacementTo}
                            onChange={() => handleCustomComboChange('restrictPiecePlacementTo', 'all')}
                          />
                          <span>All Players</span>
                        </label>
                        {Array.from({ length: playerCount }, (_, i) => i + 1).map(pid => (
                          <label key={pid} className={styles["player-radio-label"]}>
                            <input
                              type="radio"
                              name="restrictPlacementTo"
                              value={`p${pid}`}
                              checked={customCombo.restrictPiecePlacementTo === `p${pid}`}
                              onChange={() => handleCustomComboChange('restrictPiecePlacementTo', `p${pid}`)}
                            />
                            <span>Player {pid} Only</span>
                          </label>
                        ))}
                        <label className={styles["player-radio-label"]}>
                          <input
                            type="radio"
                            name="restrictPlacementTo"
                            value="neutral"
                            checked={customCombo.restrictPiecePlacementTo === 'neutral'}
                            onChange={() => handleCustomComboChange('restrictPiecePlacementTo', 'neutral')}
                          />
                          <span>Neutral Only</span>
                        </label>
                      </div>
                      <div style={{ marginTop: '10px' }}>
                        <ToggleSwitch
                          checked={!!customCombo.confinePlacementToHere}
                          onChange={(v) => handleCustomComboChange('confinePlacementToHere', v)}
                          label={<span style={{ color: 'var(--sq-custom, #ffd700)' }}>Confine allowed player to these squares only</span>}
                          tooltip={<InfoTooltip text="When enabled, the allowed player (selected above) may ONLY place pieces on squares that have this setting turned on — they cannot deploy anywhere else on the board. Turn this on for every square in the allowed zone (use Fill Entire Row to apply to a whole rank). For example, to force each player to deploy only onto their own first rank, mark that rank 'Player X only' with this confine setting enabled." />}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Points win condition: control points */}
              <div className={styles["control-config-row"]} style={{ alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label className={styles["control-config-label"]} style={{ minWidth: 0 }}>
                  Control Points (per move while occupied)
                  <InfoTooltip text="While a player's piece occupies this square, that player gains this many points each half-move. Requires the Points Win Condition to be enabled in Step 2. Points stack across multiple occupied point-squares. If the piece leaves or is captured off the square, the points are no longer applied (they were never permanent for this square)." />
                  {!pointsWinConditionEnabled && <span style={{ marginLeft: '6px', fontSize: '0.78em', color: 'var(--text-muted, #888)' }}>(enable Points Win Condition in Step 2)</span>}
                </label>
                <span style={{ display: 'inline-block', opacity: pointsWinConditionEnabled ? 1 : 0.45, pointerEvents: pointsWinConditionEnabled ? 'auto' : 'none' }}>
                  <NumberInput
                    value={customCombo.controlPoints || 0}
                    onChange={(val) => handleCustomComboChange('controlPoints', Math.max(0, Math.min(999, val || 0)))}
                    options={{ min: 0, max: 999, placeholder: "0", className: styles["control-number-input"] }}
                  />
                </span>
              </div>


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
                    <ToggleSwitch
                      checked={!!controlConfig.consecutiveTurns}
                      onChange={(v) => handleControlConfigChange('consecutiveTurns', v)}
                      label="Require Consecutive Turns"
                      tooltip={<InfoTooltip text="Turns must be uninterrupted \u2014 the counter resets if the piece leaves this square." />}
                    />
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
                    <ToggleSwitch
                      checked={!!controlConfig.requireSpecificPiece}
                      onChange={(v) => handleControlConfigChange('requireSpecificPiece', v)}
                      label="Require Specific Piece Type"
                      tooltip={<InfoTooltip text="Only pieces marked 'Can Control Squares' in Step 4 can control this square." />}
                    />
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
