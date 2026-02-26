import React, { useState, useCallback, useEffect } from "react";
import styles from "./home.module.scss";
import {
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
  getSquareHighlightStyle
} from "../../helpers/pieceMovementUtils";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  // Make sure to prepend with / if needed
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
  const containerRef = React.useRef(null);
  const [containerSize, setContainerSize] = useState(0);

  // Measure container size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        setContainerSize(width);
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Initialize pieces from gameData
  useEffect(() => {
    if (gameData?.pieces && Array.isArray(gameData.pieces)) {
      // Create pieces with unique IDs and ensure player_number is set
      const initialPieces = gameData.pieces.map((piece, index) => ({
        ...piece,
        id: piece.junction_id || piece.id || `piece-${index}`,
        x: parseInt(piece.x),
        y: parseInt(piece.y),
        player_number: parseInt(piece.player_number) || 1
      }));
      setPieces(initialPieces);

      // Build piece data map for movement validation
      const dataMap = {};
      gameData.pieces.forEach(piece => {
        if (piece.piece_id && !dataMap[piece.piece_id]) {
          dataMap[piece.piece_id] = piece;
        }
      });
      setPieceDataMap(dataMap);
    }
  }, [gameData]);

  const boardWidth = gameData?.board_width || 8;
  const boardHeight = gameData?.board_height || 8;
  // Calculate square size based on container size divided by board dimensions
  const maxBoardDimension = Math.max(boardWidth, boardHeight);
  const squareSize = containerSize > 0 ? Math.floor(containerSize / maxBoardDimension) : 50;

  // Get piece at position
  const getPieceAt = useCallback((row, col) => {
    return pieces.find(p => p.y === row && p.x === col);
  }, [pieces]);

  // Calculate valid moves for a piece
  const calculateValidMoves = useCallback((piece) => {
    const moves = [];
    const pieceData = pieceDataMap[piece.piece_id] || piece;
    
    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        if (row === piece.y && col === piece.x) continue;
        
        const targetPiece = getPieceAt(row, col);
        const playerPosition = piece.player_number || piece.player_id || 1;
        
        // Skip if there's an ally piece at this position
        if (targetPiece && targetPiece.player_number === piece.player_number) {
          continue;
        }
        
        // Check if can move there (returns { allowed: boolean, isFirstMoveOnly: boolean })
        const moveResult = canPieceMoveToUtil(
          piece.y, piece.x, row, col, 
          pieceData, playerPosition, boardHeight, false
        );
        const canMove = moveResult?.allowed || moveResult === true;
        
        // Check if can capture there
        const captureResult = canCaptureOnMoveToUtil(
          piece.y, piece.x, row, col,
          pieceData, playerPosition, boardHeight, false
        );
        const canCapture = captureResult?.allowed || captureResult === true;
        
        // Can move to empty square, or capture enemy piece
        if ((canMove && !targetPiece) || (canCapture && targetPiece)) {
          moves.push({ row, col, isCapture: !!targetPiece });
        }
      }
    }
    
    return moves;
  }, [pieceDataMap, boardWidth, boardHeight, getPieceAt]);

  // Handle piece click
  const handlePieceClick = useCallback((e, piece) => {
    e.stopPropagation();
    
    if (selectedPiece && selectedPiece.id === piece.id) {
      // Deselect if clicking the same piece
      setSelectedPiece(null);
      setValidMoves([]);
    } else if (selectedPiece && selectedPiece.player_number !== piece.player_number) {
      // Clicking on enemy piece - check if it's a valid capture
      const isValidCapture = validMoves.some(m => m.row === piece.y && m.col === piece.x && m.isCapture);
      if (isValidCapture) {
        // Capture the piece
        setPieces(prev => {
          // Remove the captured piece
          const newPieces = prev.filter(p => p.id !== piece.id);
          // Move the selected piece to the captured position
          return newPieces.map(p => 
            p.id === selectedPiece.id 
              ? { ...p, x: piece.x, y: piece.y }
              : p
          );
        });
        setSelectedPiece(null);
        setValidMoves([]);
      } else {
        // Not a valid capture, select the clicked piece instead
        setSelectedPiece(piece);
        const moves = calculateValidMoves(piece);
        setValidMoves(moves);
      }
    } else {
      // Select new piece (same team or no piece selected)
      setSelectedPiece(piece);
      const moves = calculateValidMoves(piece);
      setValidMoves(moves);
    }
  }, [selectedPiece, calculateValidMoves, validMoves]);

  // Handle square click (for moving)
  const handleSquareClick = useCallback((row, col) => {
    if (!selectedPiece) return;
    
    const isValidMove = validMoves.some(m => m.row === row && m.col === col);
    
    if (isValidMove) {
      // Move the piece
      setPieces(prev => {
        // Remove any piece at target location (capture)
        const newPieces = prev.filter(p => !(p.y === row && p.x === col));
        // Update moved piece position
        return newPieces.map(p => 
          p.id === selectedPiece.id 
            ? { ...p, x: col, y: row }
            : p
        );
      });
      setSelectedPiece(null);
      setValidMoves([]);
    } else {
      // Clicked on invalid square, deselect
      setSelectedPiece(null);
      setValidMoves([]);
    }
  }, [selectedPiece, validMoves]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e, piece) => {
    e.stopPropagation();
    setDraggingPiece(piece);
    const moves = calculateValidMoves(piece);
    setDragValidMoves(moves);
    // Set drag image
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', piece.id);
    }
  }, [calculateValidMoves]);

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
      // Move the piece
      setPieces(prev => {
        // Remove any piece at target location (capture)
        const newPieces = prev.filter(p => !(p.y === row && p.x === col));
        // Update moved piece position
        return newPieces.map(p => 
          p.id === draggingPiece.id 
            ? { ...p, x: col, y: row }
            : p
        );
      });
    }
    
    setDraggingPiece(null);
    setDragValidMoves([]);
    setSelectedPiece(null);
    setValidMoves([]);
  }, [draggingPiece, dragValidMoves]);

  // Get image URL for piece
  const getPieceImageUrl = useCallback((piece) => {
    const playerIndex = (piece.player_number || 1) - 1;
    
    // Try parsing image_location first (contains array of images per player)
    if (piece.image_location) {
      try {
        const images = JSON.parse(piece.image_location);
        if (Array.isArray(images) && images.length > 0) {
          const imageIndex = Math.min(playerIndex, images.length - 1);
          return getImageUrl(images[imageIndex]);
        }
      } catch (e) {
        // Not JSON, use as-is
        return getImageUrl(piece.image_location);
      }
    }
    
    // Fallback to image_url 
    if (piece.image_url) {
      return getImageUrl(piece.image_url);
    }
    
    return null;
  }, []);

  // Check if a square is a valid move destination
  const isValidMoveSquare = useCallback((row, col) => {
    const clickMoves = validMoves.some(m => m.row === row && m.col === col);
    const dragMoves = dragValidMoves.some(m => m.row === row && m.col === col);
    return clickMoves || dragMoves;
  }, [validMoves, dragValidMoves]);

  const isCaptureMoveSquare = useCallback((row, col) => {
    const clickCapture = validMoves.some(m => m.row === row && m.col === col && m.isCapture);
    const dragCapture = dragValidMoves.some(m => m.row === row && m.col === col && m.isCapture);
    return clickCapture || dragCapture;
  }, [validMoves, dragValidMoves]);

  // Render the board
  const renderBoard = () => {
    const squares = [];
    
    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        const isLight = (row + col) % 2 === 0;
        const piece = getPieceAt(row, col);
        const isSelected = selectedPiece && piece && selectedPiece.id === piece.id;
        const isValidMove = isValidMoveSquare(row, col);
        const isCaptureMove = isCaptureMoveSquare(row, col);
        
        let squareStyle = {
          backgroundColor: isLight ? lightSquareColor : darkSquareColor,
          width: `${squareSize}px`,
          height: `${squareSize}px`,
        };
        
        // Add highlight for valid moves
        if (isValidMove) {
          const { style } = getSquareHighlightStyle(
            true, false, isCaptureMove, false, false, isLight
          );
          squareStyle = { ...squareStyle, ...style };
        }
        
        // Highlight selected piece
        if (isSelected) {
          squareStyle.boxShadow = 'inset 0 0 0 3px #4a90e2';
        }
        
        squares.push(
          <div
            key={`${row}-${col}`}
            className={`${styles["preview-square"]} ${isLight ? styles.light : styles.dark}`}
            style={squareStyle}
            onClick={() => handleSquareClick(row, col)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, row, col)}
          >
            {piece && (
              <img
                src={getPieceImageUrl(piece)}
                alt={piece.piece_name || 'piece'}
                className={`${styles["preview-piece-image"]} ${draggingPiece?.id === piece.id ? styles.dragging : ''}`}
                onClick={(e) => handlePieceClick(e, piece)}
                draggable={true}
                onDragStart={(e) => handleDragStart(e, piece)}
                onDragEnd={handleDragEnd}
              />
            )}
            {isValidMove && !piece && (
              <div className={styles["valid-move-indicator"]} />
            )}
          </div>
        );
      }
    }
    
    return squares;
  };

  if (!gameData) return null;

  return (
    <div className={styles["preview-board-container"]} ref={containerRef}>
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
    </div>
  );
};

export default PlayablePreviewBoard;
