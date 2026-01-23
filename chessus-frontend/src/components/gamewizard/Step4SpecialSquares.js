import React, { useState, useEffect, useCallback } from "react";
import styles from "./gamewizard.module.scss";
import SpecialSquareSelector from "./SpecialSquareSelector";

const Step4SpecialSquares = ({ gameData, updateGameData }) => {
  const [rangeSquares, setRangeSquares] = useState({});
  const [promotionSquares, setPromotionSquares] = useState({});
  const [specialSquares, setSpecialSquares] = useState({});
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [showSquareSelector, setShowSquareSelector] = useState(false);
  const [draggedSquare, setDraggedSquare] = useState(null);

  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  // Parse existing special squares when component mounts
  useEffect(() => {
    try {
      if (gameData.range_squares_string) {
        const parsed = JSON.parse(gameData.range_squares_string);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          setRangeSquares(parsed);
        }
      }
    } catch (error) {
      console.error("Error parsing range_squares_string:", error);
    }

    try {
      if (gameData.promotion_squares_string) {
        const parsed = JSON.parse(gameData.promotion_squares_string);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          setPromotionSquares(parsed);
        }
      }
    } catch (error) {
      console.error("Error parsing promotion_squares_string:", error);
    }

    try {
      if (gameData.special_squares_string) {
        const parsed = JSON.parse(gameData.special_squares_string);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          setSpecialSquares(parsed);
        }
      }
    } catch (error) {
      console.error("Error parsing special_squares_string:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData.range_squares_string, gameData.promotion_squares_string, gameData.special_squares_string]);

  // Update gameData whenever special squares change
  useEffect(() => {
    updateGameData({ range_squares_string: JSON.stringify(rangeSquares) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSquares]);

  useEffect(() => {
    updateGameData({ promotion_squares_string: JSON.stringify(promotionSquares) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotionSquares]);

  useEffect(() => {
    updateGameData({ special_squares_string: JSON.stringify(specialSquares) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialSquares]);

  const handleSquareRightClick = (e, row, col) => {
    e.preventDefault();
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowSquareSelector(true);
  };

  const handleSquareClick = (e, row, col) => {
    // Only open selector if there's already a special square here
    const key = `${row},${col}`;
    const squareType = getSquareType(key);
    if (squareType) {
      setSelectedSquare({ row, col, key });
      setShowSquareSelector(true);
    }
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e, key, squareType) => {
    const squareData = 
      squareType === 'range' ? rangeSquares[key] :
      squareType === 'promotion' ? promotionSquares[key] :
      specialSquares[key];
    
    setDraggedSquare({ key, type: squareType, data: squareData });
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  }, [rangeSquares, promotionSquares, specialSquares]);

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
    setSpecialSquares(prev => {
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
    setSpecialSquares(prev => {
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
    } else if (squareType === 'special') {
      setSpecialSquares(prev => ({
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

  const handleSquareTypeSelected = (squareType) => {
    if (!selectedSquare) return;

    const key = selectedSquare.key;

    // Remove from all types first
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
    setSpecialSquares(prev => {
      const newSquares = { ...prev };
      delete newSquares[key];
      return newSquares;
    });

    // Add to selected type
    if (squareType === 'range') {
      setRangeSquares(prev => ({
        ...prev,
        [key]: { type: 'range', rangeBonus: 1 }
      }));
    } else if (squareType === 'promotion') {
      setPromotionSquares(prev => ({
        ...prev,
        [key]: { type: 'promotion' }
      }));
    } else if (squareType === 'special') {
      setSpecialSquares(prev => ({
        ...prev,
        [key]: { type: 'special', effect: 'custom' }
      }));
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
    setSpecialSquares(prev => {
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

  const getSquareType = (key) => {
    if (rangeSquares[key]) return 'range';
    if (promotionSquares[key]) return 'promotion';
    if (specialSquares[key]) return 'special';
    return null;
  };

  const getSquareColor = (type) => {
    switch (type) {
      case 'range': return '#ff8c00'; // Orange
      case 'promotion': return '#4b0082'; // Purple
      case 'special': return '#ffd700'; // Gold
      default: return null;
    }
  };

  const renderBoard = () => {
    const board = [];
    const squareSize = Math.min(60, 480 / Math.max(gameData.board_width, gameData.board_height));

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
              width: `${squareSize}px`,
              height: `${squareSize}px`,
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
                {squareType === 'special' && 'S'}
              </div>
            )}
          </div>
        );
      }
    }

    return board;
  };

  const getCounts = () => {
    return {
      range: Object.keys(rangeSquares).length,
      promotion: Object.keys(promotionSquares).length,
      special: Object.keys(specialSquares).length
    };
  };

  const counts = getCounts();

  return (
    <div className={styles["step-container"]}>
      <h2>Special Squares</h2>
      <p className={styles["step-description"]}>
        Right-click on any square to designate it as a special square. Different types of squares provide unique gameplay effects.
      </p>

      <div className={styles["special-square-stats"]}>
        <div className={styles["stat-item"]} style={{ background: 'rgba(255, 140, 0, 0.2)' }}>
          <strong>Range Squares:</strong> {counts.range}
        </div>
        <div className={styles["stat-item"]} style={{ background: 'rgba(75, 0, 130, 0.2)' }}>
          <strong>Promotion Squares:</strong> {counts.promotion}
        </div>
        <div className={styles["stat-item"]} style={{ background: 'rgba(255, 215, 0, 0.2)' }}>
          <strong>Special Squares:</strong> {counts.special}
        </div>
      </div>

      <div className={styles["board-placement-preview"]}>
        <div
          className={styles["placement-board"]}
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(${gameData.board_height}, 1fr)`,
            gridTemplateColumns: `repeat(${gameData.board_width}, 1fr)`,
            border: '2px solid #ccc',
            width: 'fit-content',
            margin: '20px auto'
          }}
        >
          {renderBoard()}
        </div>
      </div>

      <div className={styles["placement-instructions"]}>
        <h3>Square Types:</h3>
        <ul>
          <li><strong style={{ color: '#ff8c00' }}>Range Squares (R):</strong> Increase the attack/movement range of pieces on this square</li>
          <li><strong style={{ color: '#4b0082' }}>Promotion Squares (P):</strong> Pieces can be promoted to different types on this square</li>
          <li><strong style={{ color: '#ffd700' }}>Special Squares (S):</strong> Custom effects to be defined later</li>
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
          squarePosition={selectedSquare}
        />
      )}
    </div>
  );
};

export default Step4SpecialSquares;
