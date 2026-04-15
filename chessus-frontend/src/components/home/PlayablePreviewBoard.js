import React, { useState, useCallback, useEffect, useMemo } from "react";
import styles from "./home.module.scss";
import {
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
} from "../../helpers/pieceMovementUtils";

import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  if (!imagePath.startsWith('/')) {
    return `${ASSET_URL}/${imagePath}`;
  }
  return `${ASSET_URL}${imagePath}`;
};

const PlayablePreviewBoard = ({ gameData, lightSquareColor, darkSquareColor }) => {
  const [pieces, setPieces] = useState([]);
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [pieceDataMap, setPieceDataMap] = useState({});
  const [draggingPiece, setDraggingPiece] = useState(null);
  const [dragValidMoves, setDragValidMoves] = useState([]);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [lastMove, setLastMove] = useState(null);
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredHighlights, setHoveredHighlights] = useState({});
  const [moveCounts, setMoveCounts] = useState({});
  const containerRef = React.useRef(null);
  const [containerSize, setContainerSize] = useState(0);

  // Measure container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      setContainerSize(el.offsetWidth);
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize);
      ro.observe(el);
      return () => ro.disconnect();
    } else {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }
  }, []);

  // Initialize pieces from gameData
  useEffect(() => {
    if (gameData?.pieces && Array.isArray(gameData.pieces)) {
      const initialPieces = gameData.pieces.map((piece, index) => ({
        ...piece,
        id: piece.junction_id || piece.id || `piece-${index}`,
        x: parseInt(piece.x),
        y: parseInt(piece.y),
        player_number: parseInt(piece.player_number) || 1
      }));
      setPieces(initialPieces);

      // Build piece data map — use the full piece data from the join
      const dataMap = {};
      gameData.pieces.forEach(piece => {
        if (piece.piece_id && !dataMap[piece.piece_id]) {
          dataMap[piece.piece_id] = piece;
        }
      });
      setPieceDataMap(dataMap);

      // Reset game state
      setCurrentTurn(1);
      setLastMove(null);
      setSelectedPiece(null);
      setValidMoves([]);
      setMoveCounts({});
      setHoveredPiece(null);
      setHoveredHighlights({});
    }
  }, [gameData]);

  const boardWidth = gameData?.board_width || 8;
  const boardHeight = gameData?.board_height || 8;
  const maxBoardDimension = Math.max(boardWidth, boardHeight);
  const squareSize = containerSize > 0 ? Math.floor(containerSize / maxBoardDimension) : 50;

  // Get piece at position (multi-tile aware)
  const getPieceAt = useCallback((row, col) => {
    return pieces.find(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      return col >= p.x && col < p.x + pw && row >= p.y && row < p.y + ph;
    });
  }, [pieces]);

  // Check if the path is clear between two positions (for sliding pieces)
  const isPathClear = useCallback((fromY, fromX, toY, toX) => {
    const rowDiff = toY - fromY;
    const colDiff = toX - fromX;

    if (rowDiff !== 0 && colDiff !== 0 && Math.abs(rowDiff) !== Math.abs(colDiff)) {
      return true;
    }

    const stepY = rowDiff === 0 ? 0 : (rowDiff > 0 ? 1 : -1);
    const stepX = colDiff === 0 ? 0 : (colDiff > 0 ? 1 : -1);

    let y = fromY + stepY;
    let x = fromX + stepX;

    while (y !== toY || x !== toX) {
      if (pieces.some(p => p.y === y && p.x === x)) {
        return false;
      }
      y += stepY;
      x += stepX;
    }

    return true;
  }, [pieces]);

  // Calculate valid moves for a piece, respecting first N moves
  const calculateValidMoves = useCallback((piece) => {
    const moves = [];
    const pieceData = pieceDataMap[piece.piece_id] || piece;
    const pieceId = piece.id;
    const pieceMoveCount = moveCounts[pieceId] || 0;

    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        if (row === piece.y && col === piece.x) continue;

        const targetPiece = getPieceAt(row, col);
        const playerPosition = piece.player_number || piece.player_id || 1;

        // Skip if there's an ally piece at this position
        if (targetPiece && targetPiece.player_number === piece.player_number) {
          continue;
        }

        // Check if can move there
        const moveResult = canPieceMoveToUtil(
          piece.y, piece.x, row, col,
          pieceData, playerPosition, boardHeight, false
        );
        const canMove = moveResult?.allowed || moveResult === true;
        const isMoveFirstOnly = canMove && !!moveResult?.isFirstMoveOnly;
        const isMoveCustomOnly = canMove && !!moveResult?.isCustomOnly;

        // Check if can capture there
        const captureResult = canCaptureOnMoveToUtil(
          piece.y, piece.x, row, col,
          pieceData, playerPosition, boardHeight, false
        );
        const canCapture = captureResult?.allowed || captureResult === true;
        const isCaptureFirstOnly = canCapture && !!captureResult?.isFirstMoveOnly;
        const isCaptureCustomOnly = canCapture && !!captureResult?.isCustomOnly;

        // Filter out first-move-only moves if piece has already moved
        const moveAllowed = canMove && (!isMoveFirstOnly || pieceMoveCount === 0);
        const captureAllowed = canCapture && (!isCaptureFirstOnly || pieceMoveCount === 0);

        if ((moveAllowed && !targetPiece) || (captureAllowed && targetPiece)) {
          const isCustomOnly = (moveAllowed && !targetPiece) ? isMoveCustomOnly : isCaptureCustomOnly;
          const isFirstMoveOnly = (moveAllowed && !targetPiece) ? isMoveFirstOnly : isCaptureFirstOnly;
          if (isCustomOnly || isPathClear(piece.y, piece.x, row, col)) {
            moves.push({
              row, col,
              isCapture: !!targetPiece,
              isCustomMove: isMoveCustomOnly,
              isCustomAttack: isCaptureCustomOnly,
              isFirstMoveOnly
            });
          }
        }
      }
    }

    return moves;
  }, [pieceDataMap, boardWidth, boardHeight, getPieceAt, isPathClear, moveCounts]);

  // Calculate hover highlights for a piece (move vs attack differentiation)
  const calculateHoverHighlights = useCallback((piece) => {
    const highlights = {};
    const pieceData = pieceDataMap[piece.piece_id] || piece;
    const pieceId = piece.id;
    const pieceMoveCount = moveCounts[pieceId] || 0;

    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        if (row === piece.y && col === piece.x) continue;

        const targetPiece = getPieceAt(row, col);
        const playerPosition = piece.player_number || piece.player_id || 1;

        if (targetPiece && targetPiece.player_number === piece.player_number) {
          continue;
        }

        const moveResult = canPieceMoveToUtil(
          piece.y, piece.x, row, col,
          pieceData, playerPosition, boardHeight, false
        );
        const canMove = (moveResult?.allowed || moveResult === true) &&
          (!moveResult?.isFirstMoveOnly || pieceMoveCount === 0);
        const isMoveCustomOnly = canMove && !!moveResult?.isCustomOnly;
        const isMoveFirstOnly = canMove && !!moveResult?.isFirstMoveOnly;

        const captureResult = canCaptureOnMoveToUtil(
          piece.y, piece.x, row, col,
          pieceData, playerPosition, boardHeight, false
        );
        const canCapture = (captureResult?.allowed || captureResult === true) &&
          (!captureResult?.isFirstMoveOnly || pieceMoveCount === 0);
        const isCaptureCustomOnly = canCapture && !!captureResult?.isCustomOnly;
        const isCaptureFirstOnly = canCapture && !!captureResult?.isFirstMoveOnly;

        const showMove = canMove && !targetPiece;
        const showCapture = canCapture && targetPiece;

        if (showMove || showCapture) {
          const isCustomOnly = showMove ? isMoveCustomOnly : isCaptureCustomOnly;
          if (isCustomOnly || isPathClear(piece.y, piece.x, row, col)) {
            highlights[`${col},${row}`] = {
              canMove: showMove,
              canCapture: showCapture,
              isCustomMove: isMoveCustomOnly,
              isCustomAttack: isCaptureCustomOnly,
              isFirstMoveOnly: showMove ? isMoveFirstOnly : isCaptureFirstOnly
            };
          }
        }
      }
    }

    return highlights;
  }, [pieceDataMap, boardWidth, boardHeight, getPieceAt, isPathClear, moveCounts]);

  // Execute a move: update pieces, turn, last move, move counts
  const executeMove = useCallback((movingPiece, targetRow, targetCol) => {
    const pw = movingPiece.piece_width || 1;
    const ph = movingPiece.piece_height || 1;

    setLastMove({
      from: { x: movingPiece.x, y: movingPiece.y },
      to: { x: targetCol, y: targetRow },
      piece_width: pw,
      piece_height: ph
    });

    setPieces(prev => {
      const newPieces = prev.filter(p => !(p.y === targetRow && p.x === targetCol));
      return newPieces.map(p =>
        p.id === movingPiece.id
          ? { ...p, x: targetCol, y: targetRow }
          : p
      );
    });

    setMoveCounts(prev => ({
      ...prev,
      [movingPiece.id]: (prev[movingPiece.id] || 0) + 1
    }));

    setCurrentTurn(prev => prev === 1 ? 2 : 1);
    setSelectedPiece(null);
    setValidMoves([]);
    setHoveredPiece(null);
    setHoveredHighlights({});
  }, []);

  // Handle piece click
  const handlePieceClick = useCallback((e, piece) => {
    e.stopPropagation();

    // Only allow selecting pieces of the current turn's player
    const isCurrentTurnPiece = piece.player_number === currentTurn;

    if (selectedPiece && selectedPiece.id === piece.id) {
      // Deselect if clicking the same piece
      setSelectedPiece(null);
      setValidMoves([]);
    } else if (selectedPiece && selectedPiece.player_number !== piece.player_number) {
      // Clicking on enemy piece - check if it's a valid capture
      const isValidCapture = validMoves.some(m => m.row === piece.y && m.col === piece.x && m.isCapture);
      if (isValidCapture) {
        executeMove(selectedPiece, piece.y, piece.x);
      } else if (isCurrentTurnPiece) {
        // Not a valid capture but it's our turn piece, select it
        setSelectedPiece(piece);
        const moves = calculateValidMoves(piece);
        setValidMoves(moves);
      } else {
        // Clicked enemy piece that's not capturable, deselect
        setSelectedPiece(null);
        setValidMoves([]);
      }
    } else if (isCurrentTurnPiece) {
      // Select new piece (same team)
      setSelectedPiece(piece);
      const moves = calculateValidMoves(piece);
      setValidMoves(moves);
    }
  }, [selectedPiece, calculateValidMoves, validMoves, currentTurn, executeMove]);

  // Handle square click (for moving)
  const handleSquareClick = useCallback((row, col) => {
    if (!selectedPiece) return;

    const isValidMove = validMoves.some(m => m.row === row && m.col === col);

    if (isValidMove) {
      executeMove(selectedPiece, row, col);
    } else {
      // Clicked on invalid square, deselect
      setSelectedPiece(null);
      setValidMoves([]);
    }
  }, [selectedPiece, validMoves, executeMove]);

  // Hover handlers
  const handlePieceHover = useCallback((piece) => {
    if (selectedPiece) return;
    if (piece.player_number !== currentTurn) return;
    setHoveredPiece(piece);
    setHoveredHighlights(calculateHoverHighlights(piece));
  }, [selectedPiece, currentTurn, calculateHoverHighlights]);

  const handlePieceHoverEnd = useCallback(() => {
    setHoveredPiece(null);
    setHoveredHighlights({});
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((e, piece) => {
    e.stopPropagation();
    if (piece.player_number !== currentTurn) {
      e.preventDefault();
      return;
    }
    setDraggingPiece(piece);
    const moves = calculateValidMoves(piece);
    setDragValidMoves(moves);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', piece.id);
    }
  }, [calculateValidMoves, currentTurn]);

  const handleDragEnd = useCallback(() => {
    setDraggingPiece(null);
    setDragValidMoves([]);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, row, col) => {
    e.preventDefault();
    if (!draggingPiece) return;

    const isValidMove = dragValidMoves.some(m => m.row === row && m.col === col);

    if (isValidMove) {
      executeMove(draggingPiece, row, col);
    }

    setDraggingPiece(null);
    setDragValidMoves([]);
    setSelectedPiece(null);
    setValidMoves([]);
  }, [draggingPiece, dragValidMoves, executeMove]);

  // Get image URL for piece
  const getPieceImageUrl = useCallback((piece) => {
    const playerIndex = (piece.player_number || 1) - 1;

    if (piece.image_location) {
      try {
        const images = JSON.parse(piece.image_location);
        if (Array.isArray(images) && images.length > 0) {
          const imageIndex = Math.min(playerIndex, images.length - 1);
          return getImageUrl(images[imageIndex]);
        }
      } catch (e) {
        return getImageUrl(piece.image_location);
      }
    }

    if (piece.image_url) {
      return getImageUrl(piece.image_url);
    }

    return null;
  }, []);

  // Last move memoization
  const lastMoveSquares = useMemo(() => {
    if (!lastMove) return { from: null, to: null };
    return {
      from: lastMove.from,
      to: lastMove.to,
      pw: lastMove.piece_width || 1,
      ph: lastMove.piece_height || 1
    };
  }, [lastMove]);

  // Check if a square is a valid move destination
  const isValidMoveSquare = useCallback((row, col) => {
    return validMoves.some(m => m.row === row && m.col === col) ||
      dragValidMoves.some(m => m.row === row && m.col === col);
  }, [validMoves, dragValidMoves]);

  const isCaptureMoveSquare = useCallback((row, col) => {
    return validMoves.some(m => m.row === row && m.col === col && m.isCapture) ||
      dragValidMoves.some(m => m.row === row && m.col === col && m.isCapture);
  }, [validMoves, dragValidMoves]);

  // Render the board
  const renderBoard = () => {
    const squares = [];

    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        const isLight = (row + col) % 2 === 0;
        const piece = getPieceAt(row, col);
        const isAnchor = piece && piece.x === col && piece.y === row;
        const isSelected = selectedPiece && piece && selectedPiece.id === piece.id;
        const isValidMove = isValidMoveSquare(row, col);
        const isCaptureMove = isCaptureMoveSquare(row, col);

        // Last-move highlight checks
        const isLastMoveFrom = lastMoveSquares.from && (() => {
          const pw = lastMoveSquares.pw || 1;
          const ph = lastMoveSquares.ph || 1;
          return col >= lastMoveSquares.from.x && col < lastMoveSquares.from.x + pw &&
            row >= lastMoveSquares.from.y && row < lastMoveSquares.from.y + ph;
        })();
        const isLastMoveTo = lastMoveSquares.to && (() => {
          const pw = lastMoveSquares.pw || 1;
          const ph = lastMoveSquares.ph || 1;
          return col >= lastMoveSquares.to.x && col < lastMoveSquares.to.x + pw &&
            row >= lastMoveSquares.to.y && row < lastMoveSquares.to.y + ph;
        })();

        // Hover highlight
        const hovHighlight = (!selectedPiece && hoveredPiece) ? hoveredHighlights[`${col},${row}`] : null;

        let squareStyle = {
          backgroundColor: isLight ? lightSquareColor : darkSquareColor,
          width: `${squareSize}px`,
          height: `${squareSize}px`,
        };

        // Build CSS class list
        let squareClasses = `${styles["preview-square"]} ${isLight ? styles.light : styles.dark}`;

        // Last-move dashed highlight classes
        if (isLastMoveFrom) {
          squareClasses += isLight ? ` ${styles["last-move-from-light"]}` : ` ${styles["last-move-from-dark"]}`;
        }
        if (isLastMoveTo) {
          squareClasses += ` ${styles["last-move-to"]}`;
        }

        // Hover highlight classes (when no piece is selected)
        if (hovHighlight) {
          if (hovHighlight.canMove) {
            squareClasses += hovHighlight.isFirstMoveOnly
              ? ` ${styles["hover-move-first-only"]}`
              : ` ${styles["hover-move"]}`;
          }
          if (hovHighlight.canCapture) {
            squareClasses += hovHighlight.isFirstMoveOnly
              ? ` ${styles["hover-capture-first-only"]}`
              : ` ${styles["hover-capture"]}`;
          }
        }

        // Add highlight for valid moves (when piece is selected via click) — use CSS classes, not inline styles
        if (isValidMove && selectedPiece) {
          const moveObj = validMoves.find(m => m.row === row && m.col === col) || dragValidMoves.find(m => m.row === row && m.col === col);
          if (isCaptureMove) {
            squareClasses += moveObj?.isFirstMoveOnly
              ? ` ${styles["hover-capture-first-only"]}`
              : ` ${styles["hover-capture"]}`;
          } else {
            squareClasses += moveObj?.isFirstMoveOnly
              ? ` ${styles["hover-move-first-only"]}`
              : ` ${styles["hover-move"]}`;
          }
        }

        // Highlight selected piece
        if (isSelected) {
          squareClasses += ` ${styles["selected"]}`;
        }

        squares.push(
          <div
            key={`${row}-${col}`}
            className={squareClasses}
            style={{ ...squareStyle, ...(isAnchor && piece && ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) ? { zIndex: 10 } : {}) }}
            onClick={() => handleSquareClick(row, col)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, row, col)}
          >
            {isAnchor && (() => {
              const pw = piece.piece_width || 1;
              const ph = piece.piece_height || 1;
              const isMultiTile = pw > 1 || ph > 1;
              const isNonSquareMultiTile = isMultiTile && pw !== ph;
              const multiTileStyle = isMultiTile ? {
                width: `${pw * 100}%`,
                height: `${ph * 100}%`,
                zIndex: 5,
                position: 'absolute',
                top: 0,
                left: 0,
              } : {};
              return isNonSquareMultiTile ? (
                <div
                  ref={(el) => applySvgStretchBackground(el, getPieceImageUrl(piece))}
                  className={`${styles["preview-piece-image"]} ${isMultiTile ? styles["multi-tile"] : ''} ${draggingPiece?.id === piece.id ? styles.dragging : ''}`}
                  style={{
                    ...multiTileStyle,
                  }}
                  onClick={(e) => handlePieceClick(e, piece)}
                  onMouseEnter={() => handlePieceHover(piece)}
                  onMouseLeave={handlePieceHoverEnd}
                  draggable={piece.player_number === currentTurn}
                  onDragStart={(e) => handleDragStart(e, piece)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) => e.preventDefault()}
                />
              ) : (
                <img
                  src={getPieceImageUrl(piece)}
                  alt={piece.piece_name || 'piece'}
                  className={`${styles["preview-piece-image"]} ${isMultiTile ? styles["multi-tile"] : ''} ${draggingPiece?.id === piece.id ? styles.dragging : ''}`}
                  style={multiTileStyle}
                  onClick={(e) => handlePieceClick(e, piece)}
                  onMouseEnter={() => handlePieceHover(piece)}
                  onMouseLeave={handlePieceHoverEnd}
                  draggable={piece.player_number === currentTurn}
                  onDragStart={(e) => handleDragStart(e, piece)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) => e.preventDefault()}
                />
              );
            })()}
          </div>
        );
      }
    }

    return squares;
  };

  if (!gameData) return null;

  return (
    <div className={styles["preview-board-wrapper"]} ref={containerRef}>
      <div
        className={styles["preview-board-grid"]}
        style={{
          gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`,
          gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`,
          width: `${boardWidth * squareSize}px`,
          height: `${boardHeight * squareSize}px`
        }}
      >
        {renderBoard()}
      </div>
      <div className={styles["turn-indicator"]}>
        <span className={`${styles["turn-dot"]} ${currentTurn === 1 ? styles["turn-p1"] : styles["turn-p2"]}`} />
        {currentTurn === 1 ? "Your Turn" : "Opponent's Turn"}
      </div>
    </div>
  );
};

export default PlayablePreviewBoard;
