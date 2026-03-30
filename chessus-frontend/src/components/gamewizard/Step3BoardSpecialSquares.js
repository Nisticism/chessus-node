import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./gamewizard.module.scss";
import SpecialSquareSelector from "./SpecialSquareSelector";
import NumberInput from "../common/NumberInput";

const Step3BoardSpecialSquares = ({ gameData, updateGameData }) => {
  const [rangeSquares, setRangeSquares] = useState({});
  const [promotionSquares, setPromotionSquares] = useState({});
  const [controlSquares, setControlSquares] = useState({});
  const [customSquares, setCustomSquares] = useState({});
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [showSquareSelector, setShowSquareSelector] = useState(false);
  const [draggedSquare, setDraggedSquare] = useState(null);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);

  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  const handleChange = (field, value) => {
    updateGameData({ [field]: value });
  };

  // Track which data sources have been initialized to prevent re-initialization
  const initializedRangeRef = useRef(false);
  const initializedPromotionRef = useRef(false);
  const initializedControlRef = useRef(false);
  const initializedCustomRef = useRef(false);

  // Parse existing special squares - initialize each type separately when data becomes available
  useEffect(() => {
    if (initializedRangeRef.current) return;
    if (!gameData.range_squares_string || gameData.range_squares_string === '{}') return;
    
    initializedRangeRef.current = true;
    try {
      const parsed = JSON.parse(gameData.range_squares_string);
      if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        setRangeSquares(parsed);
      }
    } catch (error) {
      console.error("Error parsing range_squares_string:", error);
    }
  }, [gameData.range_squares_string]);

  useEffect(() => {
    if (initializedPromotionRef.current) return;
    if (!gameData.promotion_squares_string || gameData.promotion_squares_string === '{}') return;
    
    initializedPromotionRef.current = true;
    try {
      const parsed = JSON.parse(gameData.promotion_squares_string);
      if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        setPromotionSquares(parsed);
      }
    } catch (error) {
      console.error("Error parsing promotion_squares_string:", error);
    }
  }, [gameData.promotion_squares_string]);

  useEffect(() => {
    if (initializedControlRef.current) return;
    if (!gameData.control_squares_string || gameData.control_squares_string === '{}') return;
    
    initializedControlRef.current = true;
    try {
      const parsed = JSON.parse(gameData.control_squares_string);
      if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        setControlSquares(parsed);
      }
    } catch (error) {
      console.error("Error parsing control_squares_string:", error);
    }
  }, [gameData.control_squares_string]);

  useEffect(() => {
    if (initializedCustomRef.current) return;
    if (!gameData.special_squares_string || gameData.special_squares_string === '{}') return;
    
    initializedCustomRef.current = true;
    try {
      const parsed = JSON.parse(gameData.special_squares_string);
      if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        setCustomSquares(parsed);
      }
    } catch (error) {
      console.error("Error parsing special_squares_string:", error);
    }
  }, [gameData.special_squares_string]);

  // Update gameData whenever special squares change
  useEffect(() => {
    const newValue = JSON.stringify(rangeSquares);
    if (newValue !== gameData.range_squares_string) {
      updateGameData({ range_squares_string: newValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSquares]);

  useEffect(() => {
    const newValue = JSON.stringify(promotionSquares);
    if (newValue !== gameData.promotion_squares_string) {
      updateGameData({ promotion_squares_string: newValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotionSquares]);

  useEffect(() => {
    const newValue = JSON.stringify(customSquares);
    if (newValue !== gameData.special_squares_string) {
      updateGameData({ special_squares_string: newValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customSquares]);

  useEffect(() => {
    const newValue = JSON.stringify(controlSquares);
    if (newValue !== gameData.control_squares_string) {
      updateGameData({ control_squares_string: newValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlSquares]);

  // Helper functions for square types and colors
  const getSquareType = useCallback((key) => {
    if (rangeSquares[key]) return 'range';
    if (promotionSquares[key]) return 'promotion';
    if (controlSquares[key]) return 'control';
    if (customSquares[key]) return 'custom';
    return null;
  }, [rangeSquares, promotionSquares, controlSquares, customSquares]);

  const getSquareColor = useCallback((type) => {
    switch (type) {
      case 'range': return '#ff8c00'; // Orange
      case 'promotion': return '#4b0082'; // Purple
      case 'control': return '#32CD32'; // Green
      case 'custom': return '#ffd700'; // Gold
      default: return null;
    }
  }, []);

  // Track window width for responsive board sizing
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSquareRightClick = useCallback((e, row, col) => {
    e.preventDefault();
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowSquareSelector(true);
  }, []);

  const handleSquareClick = useCallback((e, row, col) => {
    // Only open selector if there's already a special square here
    const key = `${row},${col}`;
    const squareType = getSquareType(key);
    if (squareType) {
      setSelectedSquare({ row, col, key });
      setShowSquareSelector(true);
    }
  }, [getSquareType]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e, key, squareType) => {
    const squareData = 
      squareType === 'range' ? rangeSquares[key] :
      squareType === 'promotion' ? promotionSquares[key] :
      squareType === 'control' ? controlSquares[key] :
      customSquares[key];
    
    setDraggedSquare({ key, type: squareType, data: squareData });
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  }, [rangeSquares, promotionSquares, controlSquares, customSquares]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, targetRow, targetCol) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedSquare) return;

    const targetKey = `${targetRow},${targetCol}`;
    const sourceKey = draggedSquare.key;

    if (sourceKey === targetKey) {
      setDraggedSquare(null);
      return;
    }

    const squareType = draggedSquare.type;

    // Remove from source in all square types
    setRangeSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[sourceKey];
      return newSquares;
    });
    setPromotionSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[sourceKey];
      return newSquares;
    });
    setCustomSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[sourceKey];
      return newSquares;
    });
    setControlSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[sourceKey];
      return newSquares;
    });

    // Remove from target in all square types (in case target had a different type)
    setRangeSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[targetKey];
      return newSquares;
    });
    setPromotionSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[targetKey];
      return newSquares;
    });
    setCustomSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[targetKey];
      return newSquares;
    });
    setControlSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[targetKey];
      return newSquares;
    });

    // Add to target with the dragged type
    if (squareType === 'range') {
      setRangeSquares(prev => ({
        ...prev,
        [targetKey]: draggedSquare.data
      }));
    } else if (squareType === 'promotion') {
      setPromotionSquares(prev => ({
        ...prev,
        [targetKey]: draggedSquare.data
      }));
    } else if (squareType === 'control') {
      setControlSquares(prev => ({
        ...prev,
        [targetKey]: draggedSquare.data
      }));
    } else if (squareType === 'custom') {
      setCustomSquares(prev => ({
        ...prev,
        [targetKey]: draggedSquare.data
      }));
    }

    setDraggedSquare(null);
  }, [draggedSquare]);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedSquare(null);
  }, []);

  const handleSquareTypeSelected = (squareType, options = {}) => {
    if (!selectedSquare) return;

    const { fillRow, row, boardWidth: optionsBoardWidth } = options;
    const effectiveBoardWidth = optionsBoardWidth || gameData.board_width;

    // Generate all keys to update (single square or entire row)
    const keysToUpdate = [];
    if (fillRow && row !== undefined) {
      for (let col = 0; col < effectiveBoardWidth; col++) {
        keysToUpdate.push(`${row},${col}`);
      }
    } else {
      keysToUpdate.push(selectedSquare.key);
    }

    // Remove from all types first for all keys
    keysToUpdate.forEach(key => {
      setRangeSquares(prev => {
        const newSquares = { ...prev };
        delete newSquares[key];
        return newSquares;
      });
      setPromotionSquares(prev => {
        const newSquares = { ...prev };
        delete newSquares[key];
        return newSquares;
      });
      setCustomSquares(prev => {
        const newSquares = { ...prev };
        delete newSquares[key];
        return newSquares;
      });
      setControlSquares(prev => {
        const newSquares = { ...prev };
        delete newSquares[key];
        return newSquares;
      });
    });

    // Add to selected type for all keys
    if (squareType === 'range') {
      setRangeSquares(prev => {
        const newSquares = { ...prev };
        keysToUpdate.forEach(key => {
          newSquares[key] = { type: 'range', rangeBonus: 1 };
        });
        return newSquares;
      });
    } else if (squareType === 'promotion') {
      setPromotionSquares(prev => {
        const newSquares = { ...prev };
        keysToUpdate.forEach(key => {
          newSquares[key] = { type: 'promotion' };
        });
        return newSquares;
      });
    } else if (squareType === 'control') {
      const controlData = options.controlConfig || {
        turnsRequired: 1,
        consecutiveTurns: false,
        requireSpecificPiece: false,
        appliesToPlayer: 'both'
      };
      setControlSquares(prev => {
        const newSquares = { ...prev };
        keysToUpdate.forEach(key => {
          newSquares[key] = { 
            type: 'control',
            ...controlData
          };
        });
        return newSquares;
      });
    } else if (squareType === 'custom') {
      setCustomSquares(prev => {
        const newSquares = { ...prev };
        keysToUpdate.forEach(key => {
          newSquares[key] = { type: 'custom', effect: 'custom' };
        });
        return newSquares;
      });
    }

    setShowSquareSelector(false);
    setSelectedSquare(null);
  };

  const handleRemoveSquare = () => {
    if (!selectedSquare) return;

    const key = selectedSquare.key;

    setRangeSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[key];
      return newSquares;
    });
    setPromotionSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[key];
      return newSquares;
    });
    setCustomSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[key];
      return newSquares;
    });
    setControlSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[key];
      return newSquares;
    });

    setShowSquareSelector(false);
    setSelectedSquare(null);
  };

  const handleCancelSelector = () => {
    setShowSquareSelector(false);
    setSelectedSquare(null);
  };

  const renderBoard = React.useMemo(() => {
    const board = [];
    const squareSize = Math.min(80, 600 / Math.max(gameData.board_width, gameData.board_height));

    for (let row = 0; row < gameData.board_height; row++) {
      for (let col = 0; col < gameData.board_width; col++) {
        const isLight = (row + col) % 2 === 0;
        const key = `${row},${col}`;
        const squareType = getSquareType(key);
        const borderColor = getSquareColor(squareType);

        board.push(
          <div
            key={key}
            className={styles["board-square"]}
            style={{
              background: isLight ? lightSquareColor : darkSquareColor,
              position: 'relative',
              cursor: squareType ? 'grab' : 'context-menu',
              border: squareType ? `4px solid ${borderColor}` : 'none',
              boxSizing: 'border-box'
            }}
            onClick={(e) => handleSquareClick(e, row, col)}
            onContextMenu={(e) => handleSquareRightClick(e, row, col)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, row, col)}
          >
            {squareType && (
              <div 
                draggable
                onDragStart={(e) => handleDragStart(e, key, squareType)}
                onDragEnd={handleDragEnd}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: `${squareSize * 0.4}px`,
                  fontWeight: 'bold',
                  color: borderColor,
                  textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                  cursor: 'grab',
                  pointerEvents: 'all'
                }}
              >
                {squareType === 'range' && 'R'}
                {squareType === 'promotion' && 'P'}
                {squareType === 'control' && 'C'}
                {squareType === 'custom' && 'X'}
              </div>
            )}
          </div>
        );
      }
    }

    return board;
  }, [gameData.board_width, gameData.board_height, lightSquareColor, darkSquareColor, rangeSquares, promotionSquares, controlSquares, customSquares, getSquareType, getSquareColor, handleSquareClick, handleSquareRightClick, handleDragOver, handleDrop, handleDragStart, handleDragEnd]);

  const getCounts = () => {
    return {
      range: Object.keys(rangeSquares).length,
      promotion: Object.keys(promotionSquares).length,
      control: Object.keys(controlSquares).length,
      custom: Object.keys(customSquares).length
    };
  };

  const counts = getCounts();

  return (
    <div className={styles["step-container"]}>
      <h2>Board Setup & Special Squares</h2>
      <p className={styles["step-description"]}>
        Configure the game board dimensions, player settings, and designate special squares.
      </p>

      {/* Board Configuration */}
      <div className={styles["section-divider"]}>
        <h3>Board Configuration</h3>
      </div>

      <div className={styles["form-row"]}>
        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Board Width <span className={styles["required"]}>*</span>
          </label>
          <NumberInput
            value={gameData.board_width}
            onChange={(val) => handleChange("board_width", Math.max(1, Math.min(48, val)))}
            options={{ min: 1, max: 48, className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>1-48 squares</p>
        </div>

        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Board Height <span className={styles["required"]}>*</span>
          </label>
          <NumberInput
            value={gameData.board_height}
            onChange={(val) => handleChange("board_height", Math.max(1, Math.min(48, val)))}
            options={{ min: 1, max: 48, className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>1-48 squares</p>
        </div>
      </div>

      {/* Special Squares Section */}
      <div className={styles["section-divider"]}>
        <h3>Special Squares (Optional)</h3>
      </div>

      <p className={styles["step-description"]}>
        Right-click on any square to designate it as a special square. Different types of squares provide unique gameplay effects.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
        <button 
          className={styles["clear-all-button"]}
          onClick={() => {
            if (window.confirm('Are you sure you want to remove all special squares from the board?')) {
              setRangeSquares({});
              setPromotionSquares({});
              setControlSquares({});
              setCustomSquares({});
            }
          }}
        >
          Clear All Special Squares
        </button>
        <div className={styles["special-square-stats"]}>
          <div className={styles["stat-item"]} style={{ background: 'rgba(255, 140, 0, 0.2)' }}>
            <strong>Range:</strong> {counts.range}
          </div>
          <div className={styles["stat-item"]} style={{ background: 'rgba(75, 0, 130, 0.2)' }}>
            <strong>Promotion:</strong> {counts.promotion}
          </div>
          <div className={styles["stat-item"]} style={{ background: 'rgba(50, 205, 50, 0.2)' }}>
            <strong>Control:</strong> {counts.control}
          </div>
          <div className={styles["stat-item"]} style={{ background: 'rgba(255, 215, 0, 0.2)' }}>
            <strong>Custom:</strong> {counts.custom}
          </div>
        </div>
      </div>

      {/* Control Squares General Settings */}
      {gameData.squares_condition && counts.control > 0 && (
        <div className={styles["control-settings-section"]}>
          <h4 style={{ color: '#32CD32', marginBottom: '16px' }}>
            🎯 Control Squares Win Settings
          </h4>
          <div className={styles["form-row"]}>
            <div className={styles["form-group"]}>
              <label className={styles["form-label"]}>
                Squares Required to Win
              </label>
              <NumberInput
                value={gameData.squares_count || 1}
                onChange={(val) => handleChange("squares_count", Math.max(1, Math.min(counts.control, val)))}
                options={{ min: 1, max: counts.control, className: styles["form-input-small"] }}
              />
              <p className={styles["field-hint"]}>
                How many control squares must be controlled simultaneously to win (max: {counts.control})
              </p>
            </div>
          </div>
          <p className={styles["field-hint"]} style={{ marginTop: '8px' }}>
            ℹ️ Click on individual control squares on the board to configure per-square settings (turns required, consecutive vs total, player applicability, specific piece requirements).
          </p>
        </div>
      )}

      {gameData.squares_condition && counts.control === 0 && (
        <div className={styles["control-warning"]} style={{ marginBottom: '20px' }}>
          ⚠️ Control Squares win condition is enabled but no control squares have been placed. 
          Right-click on the board to add control squares.
        </div>
      )}

      <div className={styles["board-placement-preview"]}>
        <div
          className={styles["placement-board"]}
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(${gameData.board_height}, ${Math.min(80, Math.min(600, windowWidth - 60 - 32) / Math.max(gameData.board_width, gameData.board_height))}px)`,
            gridTemplateColumns: `repeat(${gameData.board_width}, ${Math.min(80, Math.min(600, windowWidth - 60 - 32) / Math.max(gameData.board_width, gameData.board_height))}px)`,
            border: '1px solid var(--board-border, #333)',
            borderRadius: '5px',
            padding: '15px',
            gap: 0,
            overflow: 'hidden',
            width: 'fit-content',
            aspectRatio: 'unset'
          }}
        >
          {renderBoard}
        </div>
      </div>

      <div className={styles["placement-instructions"]}>
        <h3>Square Types:</h3>
        <ul>
          <li><strong style={{ color: '#ff8c00' }}>Range Squares (R):</strong> Increase the attack/movement range of pieces on this square</li>
          <li><strong style={{ color: '#4b0082' }}>Promotion Squares (P):</strong> Pieces can be promoted to different types on this square</li>
          <li><strong style={{ color: '#32CD32' }}>Control Squares (C):</strong> Players must control these squares to win (if control squares win condition is enabled)</li>
          <li><strong style={{ color: '#ffd700' }}>Custom Squares (X):</strong> Custom effects to be defined later</li>
        </ul>
        <p style={{ marginTop: '10px', fontStyle: 'italic' }}>
          Right-click any square to add a special square type. Click a special square to edit or remove it. 
          Drag special squares to reposition them.
        </p>
      </div>

      {showSquareSelector && (
        <SpecialSquareSelector
          onSelect={handleSquareTypeSelected}
          onRemove={handleRemoveSquare}
          onCancel={handleCancelSelector}
          currentType={getSquareType(selectedSquare?.key)}
          currentConfig={controlSquares[selectedSquare?.key]}
          squarePosition={selectedSquare}
          boardWidth={gameData.board_width}
          squaresConditionEnabled={gameData.squares_condition === true}
        />
      )}
    </div>
  );
};

export default Step3BoardSpecialSquares;
