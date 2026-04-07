import React, { useState, useRef, useMemo, useCallback } from "react";
import styles from "./piecewizard.module.scss";

const BOARD_SIZE = 15; // 15x15 grid
const CENTER = Math.floor(BOARD_SIZE / 2); // piece sits at center (7,7)

const CustomSquareSelector = ({ squares, onChange, color = "#4a90d9" }) => {
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [paintMode, setPaintMode] = useState(null); // 'add' or 'remove'
  const gridRef = useRef(null);

  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  // Parse squares from JSON string or array
  const selectedSquares = useMemo(() => {
    if (!squares) return [];
    try {
      const parsed = typeof squares === 'string' ? JSON.parse(squares) : squares;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [squares]);

  const isSelected = useCallback((row, col) => {
    return selectedSquares.some(sq => sq.row === row && sq.col === col);
  }, [selectedSquares]);

  const toggleSquare = useCallback((row, col, forceMode = null) => {
    // Don't allow selecting the center (piece position)
    if (row === 0 && col === 0) return;

    const exists = selectedSquares.some(sq => sq.row === row && sq.col === col);
    const mode = forceMode || (exists ? 'remove' : 'add');

    let newSquares;
    if (mode === 'remove') {
      newSquares = selectedSquares.filter(sq => !(sq.row === row && sq.col === col));
    } else {
      if (exists) return; // Already selected
      newSquares = [...selectedSquares, { row, col }];
    }

    onChange(newSquares.length > 0 ? JSON.stringify(newSquares) : null);
  }, [selectedSquares, onChange]);

  const handleCellAction = (row, col, mode = null) => {
    const offset = { row: row - CENTER, col: col - CENTER };
    if (offset.row === 0 && offset.col === 0) return;

    if (mode === null) {
      // Starting a new paint stroke — determine mode
      const exists = isSelected(offset.row, offset.col);
      const newMode = exists ? 'remove' : 'add';
      setPaintMode(newMode);
      setIsMouseDown(true);
      toggleSquare(offset.row, offset.col, newMode);
    } else {
      // Continuing a paint stroke
      toggleSquare(offset.row, offset.col, mode);
    }
  };

  const handleMouseDown = (e, row, col) => {
    e.preventDefault();
    handleCellAction(row, col, null);
  };

  const handleMouseEnter = (row, col) => {
    if (!isMouseDown || !paintMode) return;
    handleCellAction(row, col, paintMode);
  };

  const handleMouseUp = () => {
    setIsMouseDown(false);
    setPaintMode(null);
  };

  // Touch support: resolve grid cell from touch coordinates
  const getCellFromTouch = (touch) => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    // Cell size matches CSS (28px default, 22px on mobile)
    const cellSize = rect.width / BOARD_SIZE;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
    return { row, col };
  };

  const lastTouchCell = useRef(null);

  const handleTouchStart = (e) => {
    e.preventDefault();
    const cell = getCellFromTouch(e.touches[0]);
    if (!cell) return;
    lastTouchCell.current = `${cell.row},${cell.col}`;
    handleCellAction(cell.row, cell.col, null);
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    if (!paintMode) return;
    const cell = getCellFromTouch(e.touches[0]);
    if (!cell) return;
    const key = `${cell.row},${cell.col}`;
    if (key === lastTouchCell.current) return; // same cell, skip
    lastTouchCell.current = key;
    handleCellAction(cell.row, cell.col, paintMode);
  };

  const handleTouchEnd = () => {
    setIsMouseDown(false);
    setPaintMode(null);
    lastTouchCell.current = null;
  };

  const clearAll = () => {
    onChange(null);
  };

  return (
    <div className={styles["custom-square-selector"]}>
      <p className={styles["custom-square-hint"]}>
        Click or drag on squares to select where this piece can reach. The highlighted center square is the piece's position.
      </p>
      <div
        ref={gridRef}
        className={styles["custom-square-grid"]}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {Array.from({ length: BOARD_SIZE }, (_, row) => (
          <div key={row} className={styles["custom-square-row"]}>
            {Array.from({ length: BOARD_SIZE }, (_, col) => {
              const offsetRow = row - CENTER;
              const offsetCol = col - CENTER;
              const isPiece = offsetRow === 0 && offsetCol === 0;
              const selected = isSelected(offsetRow, offsetCol);
              const isDark = (row + col) % 2 === 1;

              return (
                <div
                  key={col}
                  className={`${styles["custom-square-cell"]} ${isPiece ? styles["piece-cell"] : ""} ${selected ? styles["selected-cell"] : ""}`}
                  style={{
                    backgroundColor: isPiece
                      ? "#e8a735"
                      : selected
                        ? color
                        : isDark
                          ? darkSquareColor
                          : lightSquareColor,
                  }}
                  onMouseDown={(e) => handleMouseDown(e, row, col)}
                  onMouseEnter={() => handleMouseEnter(row, col)}
                  onClick={(e) => { e.stopPropagation(); }}
                />
              );
            })}
          </div>
        ))}
      </div>
      {selectedSquares.length > 0 && (
        <button type="button" className={styles["clear-custom-btn"]} onClick={clearAll}>
          Clear All ({selectedSquares.length})
        </button>
      )}
    </div>
  );
};

export default CustomSquareSelector;
