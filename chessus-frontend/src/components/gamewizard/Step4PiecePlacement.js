import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import styles from "./gamewizard.module.scss";
import PieceSelector from "./PieceSelector";
import { getAllPieces, getPieceById } from "../../actions/pieces";
import { isMobileDevice, isTouchDevice } from "../../helpers/mobileUtils";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${ASSET_URL}${imagePath}`;
};

const Step5PiecePlacement = ({ gameData, updateGameData }) => {
  const [piecePlacements, setPiecePlacements] = useState({});
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [showPieceSelector, setShowPieceSelector] = useState(false);
  const [draggedPiece, setDraggedPiece] = useState(null);
  const [randomizationMode, setRandomizationMode] = useState('none'); // 'none', 'mirrored', 'backrow', 'independent', 'shared', 'full'
  const [pieceDataMap, setPieceDataMap] = useState({});
  const [hoveredSquare, setHoveredSquare] = useState(null);
  const [hoveredPiecePosition, setHoveredPiecePosition] = useState(null);
  const [draggedPiecePosition, setDraggedPiecePosition] = useState(null);
  const initializedRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const longPressTimeoutRef = useRef(null);
  
  // Check if the board setup is symmetric (for mirrored randomization)
  const isBoardSymmetric = useMemo(() => {
    const boardHeight = gameData.board_height || 8;
    const playerCount = gameData.player_count || 2;
    
    if (playerCount !== 2) {
      console.log('isBoardSymmetric: false - not 2 players');
      return false; // Mirrored only works for 2 players
    }
    
    // Group pieces by player, including their positions from the key
    const piecesByPlayer = {};
    Object.entries(piecePlacements).forEach(([key, piece]) => {
      const [row, col] = key.split(',').map(Number);
      const pieceWithPos = { ...piece, y: row, x: col };
      
      if (!piecesByPlayer[piece.player_id]) {
        piecesByPlayer[piece.player_id] = [];
      }
      piecesByPlayer[piece.player_id].push(pieceWithPos);
    });
    
    const playerIds = Object.keys(piecesByPlayer).sort();
    
    // Empty board is considered symmetric - allow mirrored mode
    if (playerIds.length === 0) {
      console.log('isBoardSymmetric: true - empty board');
      return true;
    }
    
    // If only one player has pieces, not symmetric
    if (playerIds.length === 1) {
      console.log('isBoardSymmetric: false - only one player has pieces');
      return false;
    }
    
    if (playerIds.length !== 2) {
      console.log('isBoardSymmetric: false - not exactly 2 players with pieces:', playerIds.length);
      return false;
    }
    
    const player1Pieces = piecesByPlayer[playerIds[0]];
    const player2Pieces = piecesByPlayer[playerIds[1]];
    
    // Must have same number of pieces
    if (player1Pieces.length !== player2Pieces.length) {
      console.log('isBoardSymmetric: false - different piece counts:', player1Pieces.length, 'vs', player2Pieces.length);
      return false;
    }
    
    console.log('Checking symmetry for', player1Pieces.length, 'pieces per player');
    
    // Check if pieces are at mirrored positions with same piece types
    // We need to verify both directions to ensure perfect symmetry
    for (let i = 0; i < player1Pieces.length; i++) {
      const p1 = player1Pieces[i];
      const mirroredY = boardHeight - 1 - p1.y;
      
      // Find if there's a player 2 piece at the mirrored position with same piece type
      const p2 = player2Pieces.find(p => p.x === p1.x && p.y === mirroredY);
      
      if (!p2) {
        console.log(`isBoardSymmetric: false - no piece at mirrored position for (${p1.x},${p1.y}), expected at (${p1.x},${mirroredY})`);
        return false;
      }
      
      if (p2.piece_id !== p1.piece_id) {
        console.log(`isBoardSymmetric: false - different piece types at (${p1.x},${p1.y}) and (${p2.x},${p2.y}): ${p1.piece_id} vs ${p2.piece_id}`);
        return false;
      }
    }
    
    console.log('isBoardSymmetric: true!');
    return true;
  }, [piecePlacements, gameData.board_height, gameData.player_count]);
  
  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  // Detect mobile
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // Load all pieces for image fallback and movement data
  useEffect(() => {
    const loadPieces = async () => {
      try {
        const allPieces = await getAllPieces();
        const pieceMap = {};
        
        // Load full details for each piece (includes movement/capture data from JOINs)
        await Promise.all(allPieces.map(async (piece) => {
          try {
            const fullPieceData = await getPieceById(piece.id);
            pieceMap[piece.id] = fullPieceData;
          } catch (err) {
            console.error(`Error loading piece ${piece.id}:`, err);
            // Fallback to basic piece data
            pieceMap[piece.id] = piece;
          }
        }));
        
        setPieceDataMap(pieceMap);
      } catch (error) {
        console.error("Error loading pieces:", error);
      }
    };
    loadPieces();
  }, []);

  // Parse existing piece placements ONLY on initial mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    try {
      if (gameData.pieces_string) {
        const parsed = JSON.parse(gameData.pieces_string);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          setPiecePlacements(parsed);
        }
      }
    } catch (error) {
      console.error("Error parsing pieces_string:", error);
    }

    // Parse randomized_starting_positions to get mode
    try {
      if (gameData.randomized_starting_positions) {
        const parsed = JSON.parse(gameData.randomized_starting_positions);
        if (parsed && parsed.mode) {
          setRandomizationMode(parsed.mode);
        } else if (parsed && parsed.enabled === true) {
          // Legacy support: enabled: true means 'independent'
          setRandomizationMode('independent');
        }
      }
    } catch (error) {
      // If it's not JSON, treat it as legacy
      setRandomizationMode('none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update gameData whenever piecePlacements changes
  useEffect(() => {
    const newValue = JSON.stringify(piecePlacements);
    if (newValue !== gameData.pieces_string) {
      updateGameData({ pieces_string: newValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piecePlacements]);

  const handleSquareRightClick = useCallback((e, row, col) => {
    e.preventDefault();
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowPieceSelector(true);
  }, []);

  // Long press handlers for mobile
  const handleLongPress = useCallback((row, col) => {
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowPieceSelector(true);
  }, []);

  const handleTouchStart = useCallback((e, row, col) => {
    if (!isTouchDevice()) return;
    
    longPressTimeoutRef.current = setTimeout(() => {
      handleLongPress(row, col);
    }, 500);
  }, [handleLongPress]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  const handlePieceSelected = useCallback((pieceData) => {
    if (selectedSquare) {
      setPiecePlacements(prev => ({
        ...prev,
        [selectedSquare.key]: {
          piece_id: pieceData.piece_id,
          player_id: pieceData.player_id,
          image_url: pieceData.image_url,
          piece_name: pieceData.piece_name,
          ends_game_on_checkmate: pieceData.ends_game_on_checkmate || false,
          ends_game_on_capture: pieceData.ends_game_on_capture || false
        }
      }));
    }
    setShowPieceSelector(false);
    setSelectedSquare(null);
  }, [selectedSquare]);

  const handleRemovePiece = useCallback(() => {
    if (selectedSquare) {
      setPiecePlacements(prev => {
        const newPlacements = { ...prev };
        delete newPlacements[selectedSquare.key];
        return newPlacements;
      });
    }
    setShowPieceSelector(false);
    setSelectedSquare(null);
  }, [selectedSquare]);

  const handleCancelSelector = useCallback(() => {
    setShowPieceSelector(false);
    setSelectedSquare(null);
  }, []);

  // Helper to check if a value allows movement at distance
  const checkMovement = useCallback((value, distance) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null) return false;
    if (value > 0) return distance <= value; // Up to that distance
    if (value < 0) return distance === Math.abs(value); // Exact distance
    return false;
  }, []);

  // Check if piece can move to target square
  const canPieceMoveTo = useCallback((fromRow, fromCol, toRow, toCol, pieceData) => {
    if (!pieceData) return true; // If no piece data, allow free movement (fallback)
    if (fromRow === toRow && fromCol === toCol) return false;
    
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;
    
    let directionalAllowed = false;
    
    // Directional movement
    if (pieceData.directional_movement_style) {
      if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_left_movement, Math.abs(rowDiff));
      } else if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_movement, Math.abs(rowDiff));
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_right_movement, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_movement, Math.abs(colDiff));
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_right_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_left_movement, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_movement, Math.abs(colDiff));
      }
      
      if (directionalAllowed) return true;
    }

    // Ratio movement (L-shape like knight)
    if (pieceData.ratio_movement_style && pieceData.ratio_one_movement && pieceData.ratio_two_movement) {
      const ratio1 = Math.abs(pieceData.ratio_one_movement);
      const ratio2 = Math.abs(pieceData.ratio_two_movement);
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Step-by-step movement
    if (pieceData.step_by_step_movement_style && pieceData.step_by_step_movement_value) {
      const maxSteps = Math.abs(pieceData.step_by_step_movement_value);
      const noDiagonal = pieceData.step_by_step_movement_value < 0;
      
      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        if (manhattanDistance <= maxSteps) return true;
      } else {
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance <= maxSteps) return true;
      }
    }

    return false;
  }, [checkMovement]);

  // Check if piece can capture on move to target square
  const canCaptureOnMoveTo = useCallback((fromRow, fromCol, toRow, toCol, pieceData) => {
    if (!pieceData) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    if (!pieceData.can_capture_enemy_on_move) return false;
    
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;
    
    let directionalCaptureAllowed = false;
    
    // Check directional capture
    if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.up_left_capture, Math.abs(rowDiff));
    } else if (rowDiff < 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(pieceData.up_capture, Math.abs(rowDiff));
    } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.up_right_capture, Math.abs(rowDiff));
    } else if (rowDiff === 0 && colDiff > 0) {
      directionalCaptureAllowed = checkMovement(pieceData.right_capture, Math.abs(colDiff));
    } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.down_right_capture, Math.abs(rowDiff));
    } else if (rowDiff > 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(pieceData.down_capture, Math.abs(rowDiff));
    } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.down_left_capture, Math.abs(rowDiff));
    } else if (rowDiff === 0 && colDiff < 0) {
      directionalCaptureAllowed = checkMovement(pieceData.left_capture, Math.abs(colDiff));
    }
    
    if (directionalCaptureAllowed) return true;
    
    // Ratio capture
    if (pieceData.ratio_one_capture && pieceData.ratio_two_capture) {
      const ratio1 = Math.abs(pieceData.ratio_one_capture);
      const ratio2 = Math.abs(pieceData.ratio_two_capture);
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }
    
    // Step-by-step capture
    if (pieceData.step_by_step_capture) {
      const maxSteps = Math.abs(pieceData.step_by_step_capture);
      const noDiagonal = pieceData.step_by_step_capture < 0;
      
      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        if (manhattanDistance <= maxSteps) return true;
      } else {
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance <= maxSteps) return true;
      }
    }

    return false;
  }, [checkMovement]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e, key) => {
    const [row, col] = key.split(',').map(Number);
    setDraggedPiece({ key, data: piecePlacements[key] });
    setDraggedPiecePosition({ row, col });
    setHoveredPiecePosition(null); // Clear hover when dragging starts
    e.dataTransfer.effectAllowed = 'move';
    // Make the dragged element semi-transparent
    e.currentTarget.style.opacity = '0.5';
  }, [piecePlacements]);

  const handleDragOver = useCallback((e, row, col) => {
    e.preventDefault();
    e.stopPropagation();
    setHoveredSquare({ row, col });
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, targetRow, targetCol) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedPiece) return;

    const targetKey = `${targetRow},${targetCol}`;
    const sourceKey = draggedPiece.key;

    if (sourceKey === targetKey) {
      setDraggedPiece(null);
      setDraggedPiecePosition(null);
      setHoveredSquare(null);
      return;
    }

    // Allow placement anywhere - validation is just for visual feedback
    setPiecePlacements(prev => {
      const newPlacements = { ...prev };
      // Remove from source
      delete newPlacements[sourceKey];
      // Add to target (overwrite if exists)
      newPlacements[targetKey] = draggedPiece.data;
      return newPlacements;
    });

    setDraggedPiece(null);
    setDraggedPiecePosition(null);
    setHoveredSquare(null);
  }, [draggedPiece]);

  const handleDragEnd = useCallback((e) => {
    // Reset opacity
    e.currentTarget.style.opacity = '1';
    setDraggedPiece(null);
    setDraggedPiecePosition(null);
    setHoveredSquare(null);
    setHoveredPiecePosition(null);
  }, []);

  const handleRandomizedChange = (mode) => {
    setRandomizationMode(mode);
    
    // Store the randomization mode
    const randomizedData = {
      mode: mode  // 'none', 'mirrored', 'independent', 'full'
    };
    updateGameData({ randomized_starting_positions: JSON.stringify(randomizedData) });
  };

  // Helper function to get placement image URL with fallback
  const getPlacementImageUrl = useCallback((placement) => {
    // Use the selected image_url from placement (set by PieceSelector)
    if (placement.image_url) {
      return placement.image_url; // Already includes full URL from PieceSelector
    }
    
    // Fallback: try to get first image from piece data if no image_url is set
    if (placement.piece_id && pieceDataMap[placement.piece_id]) {
      const piece = pieceDataMap[placement.piece_id];
      if (piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          if (Array.isArray(images) && images.length > 0) {
            return getImageUrl(images[0]);
          }
        } catch (e) {
          console.error("Error parsing piece image_location:", e);
        }
      }
    }
    
    return null;
  }, [pieceDataMap]);

  // Helper function to get player color (must be defined before renderBoard)
  const getPlayerColor = useCallback((playerId) => {
    const colors = ['#FFFFFF', '#000000', '#FF6B6B', '#4ECDC4', '#F7DC6F', '#BB8FCE', '#52BE80', '#5DADE2'];
    return colors[(playerId - 1) % colors.length] || '#999';
  }, []);

  // Calculate board dimensions for legend width
  const boardDimensions = useMemo(() => {
    const squareSize = Math.min(80, 600 / Math.max(gameData.board_width, gameData.board_height));
    const boardWidth = squareSize * gameData.board_width;
    return { squareSize, boardWidth };
  }, [gameData.board_width, gameData.board_height]);

  const renderBoard = useMemo(() => {
    const board = [];
    const squareSize = boardDimensions.squareSize;
    
    for (let row = 0; row < gameData.board_height; row++) {
      for (let col = 0; col < gameData.board_width; col++) {
        const isLight = (row + col) % 2 === 0;
        const key = `${row},${col}`;
        const placement = piecePlacements[key];
        
        // Check if this square is valid for the hovered or dragged piece
        let canMove = false;
        let canCapture = false;
        
        // Check for dragged piece
        if (draggedPiece && draggedPiecePosition) {
          const pieceData = pieceDataMap[draggedPiece.data.piece_id];
          if (pieceData) {
            canMove = canPieceMoveTo(draggedPiecePosition.row, draggedPiecePosition.col, row, col, pieceData);
            canCapture = canCaptureOnMoveTo(draggedPiecePosition.row, draggedPiecePosition.col, row, col, pieceData);
          }
        }
        // Check for hovered piece (not dragging)
        else if (hoveredPiecePosition && !draggedPiece) {
          const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
          if (pieceData) {
            canMove = canPieceMoveTo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData);
            canCapture = canCaptureOnMoveTo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData);
          }
        }
        
        let squareStyle = {
          background: isLight ? lightSquareColor : darkSquareColor,
          position: 'relative',
          cursor: placement ? 'grab' : 'context-menu',
          boxSizing: 'border-box'
        };
        
        // Highlight valid moves and attacks - use border and box-shadow for offset borders
        if (canMove && canCapture) {
          // Outer border for movement (blue), inner border for attack (orange)
          squareStyle.border = '4px solid #2196F3';
          squareStyle.boxShadow = 'inset 0 0 0 3px #FF9800, inset 0 0 10px rgba(255, 152, 0, 0.3)';
          squareStyle.zIndex = 10;
        } else if (canMove) {
          squareStyle.border = '5px solid #2196F3';
          squareStyle.boxShadow = 'inset 0 0 10px rgba(33, 150, 243, 0.3)';
          squareStyle.zIndex = 10;
        } else if (canCapture) {
          squareStyle.border = '3px solid #FF9800';
          squareStyle.boxShadow = 'inset 0 0 10px rgba(255, 152, 0, 0.3)';
          squareStyle.zIndex = 10;
        }
        
        board.push(
          <div
            key={key}
            className={styles["board-square"]}
            style={squareStyle}
            onContextMenu={(e) => handleSquareRightClick(e, row, col)}
            onTouchStart={(e) => handleTouchStart(e, row, col)}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
            onDragOver={(e) => handleDragOver(e, row, col)}
            onDrop={(e) => handleDrop(e, row, col)}
            onMouseEnter={() => {
              if (!placement) {
                setHoveredSquare({ row, col });
              }
            }}
          >
            {placement && (
              <div 
                className={styles["piece-on-square"]}
                draggable
                onDragStart={(e) => handleDragStart(e, key)}
                onDragEnd={handleDragEnd}
                onMouseEnter={() => {
                  setHoveredPiecePosition({ row, col, pieceId: placement.piece_id });
                }}
                onMouseLeave={() => {
                  if (!draggedPiece) setHoveredPiecePosition(null);
                }}
                style={{ 
                  cursor: 'grab',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {getPlacementImageUrl(placement) ? (
                  <img 
                    src={getPlacementImageUrl(placement)} 
                    alt={placement.piece_name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      pointerEvents: 'none'
                    }}
                    draggable={false}
                  />
                ) : (
                  <span style={{ fontSize: `${squareSize * 0.3}px`, color: '#fff', pointerEvents: 'none' }}>
                    {placement.piece_name?.charAt(0) || '?'}
                  </span>
                )}
                <div className={styles["player-indicator"]} style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '2px',
                  background: getPlayerColor(placement.player_id),
                  width: `${squareSize * 0.2}px`,
                  height: `${squareSize * 0.2}px`,
                  borderRadius: '50%',
                  border: placement.player_id === 1 ? '1px solid #666' : '1px solid #fff',
                  pointerEvents: 'none'
                }} />
                {placement.ends_game_on_checkmate && (
                  <div className={styles["checkmate-indicator"]} style={{
                    position: 'absolute',
                    top: '2px',
                    left: '2px',
                    fontSize: `${squareSize * 0.25}px`,
                    pointerEvents: 'none'
                  }} title="Game ends if checkmated">
                    ♔
                  </div>
                )}
                {placement.ends_game_on_capture && (
                  <div className={styles["capture-indicator"]} style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    fontSize: `${squareSize * 0.25}px`,
                    pointerEvents: 'none'
                  }} title="Game ends if captured">
                    ⚔️
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }
    }
    
    return board;
  }, [piecePlacements, gameData.board_width, gameData.board_height, lightSquareColor, darkSquareColor, handleSquareRightClick, handleDragOver, handleDrop, handleDragStart, handleDragEnd, getPlayerColor, getPlacementImageUrl, draggedPiece, draggedPiecePosition, hoveredPiecePosition, pieceDataMap, canPieceMoveTo, canCaptureOnMoveTo, boardDimensions]);

  const getPieceCounts = () => {
    const counts = {};
    Object.values(piecePlacements).forEach(placement => {
      const key = `Player ${placement.player_id}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  };

  const pieceCounts = getPieceCounts();
  const totalPieces = Object.keys(piecePlacements).length;

  return (
    <div className={styles["step-container"]}>
      <h2>Piece Placement</h2>
      <p className={styles["step-description"]}>
        Right-click on any square to add or remove pieces. Drag pieces to move them. Assign pieces to players and choose their images.
      </p>
      <p className={styles["step-description"]} style={{ marginTop: '10px', fontSize: '14px', fontStyle: 'italic', color: '#aaa' }}>
        {isMobile ? '💡 Long press on any square to add/remove pieces on mobile' : '💡 Right-click or drag and drop to manage pieces'}
      </p>

      <div className={styles["piece-stats"]}>
        <div className={styles["stat-item"]}>
          <strong>Total Pieces:</strong> {totalPieces}
        </div>
        {Object.entries(pieceCounts).map(([player, count]) => (
          <div key={player} className={styles["stat-item"]}>
            <strong>{player}:</strong> {count}
          </div>
        ))}
        <button 
          className={styles["clear-all-button"]}
          onClick={() => {
            if (window.confirm('Are you sure you want to remove all pieces from the board?')) {
              setPiecePlacements({});
            }
          }}
        >
          Clear All Pieces
        </button>
      </div>

      <div className={styles["board-placement-preview"]}>
        <div className={styles["preview-legend"]} style={{
          width: `${boardDimensions.boardWidth}px`,
          fontSize: '1.15rem',
          marginBottom: '1rem',
          margin: '0 auto 1rem'
        }}>
          <div className={styles["legend-row"]}>
            <div className={styles["legend-item"]}>
              <div className={styles["legend-square"]} style={{ border: '3px solid #2196F3' }}></div>
              <span>Movement</span>
            </div>
            <div className={styles["legend-item"]}>
              <div className={styles["legend-square"]} style={{ border: '3px solid #FF9800' }}></div>
              <span>Attack</span>
            </div>
            <div className={styles["legend-item"]} style={{ gap: '4px' }}>
              <span className={styles["ranged-icon"]}>💥</span>
              <span>Ranged</span>
            </div>
            <div className={styles["legend-item"]} style={{ gap: '4px' }}>
              <span className={styles["condition-icon"]}>♔</span>
              <span>Checkmate</span>
            </div>
            <div className={styles["legend-item"]} style={{ gap: '4px' }}>
              <span className={styles["condition-icon"]}>⚔️</span>
              <span>Capture</span>
            </div>
          </div>
          <div className={styles["legend-row"]} style={{ justifyContent: 'space-around' }}>
            {Array.from({ length: Math.min(4, gameData.player_count || 2) }, (_, i) => i + 1).map(playerId => (
              <div key={playerId} className={styles["legend-item"]}>
                <div 
                  className={styles["legend-player-dot"]} 
                  style={{ 
                    background: getPlayerColor(playerId),
                    border: playerId === 1 ? '1px solid #666' : '1px solid #fff'
                  }}
                ></div>
                <span>Player {playerId}</span>
              </div>
            ))}
          </div>
          {(gameData.player_count || 2) > 4 && (
            <div className={styles["legend-row"]} style={{ justifyContent: 'space-around' }}>
              {Array.from({ length: (gameData.player_count || 2) - 4 }, (_, i) => i + 5).map(playerId => (
                <div key={playerId} className={styles["legend-item"]}>
                  <div 
                    className={styles["legend-player-dot"]} 
                    style={{ 
                      background: getPlayerColor(playerId),
                      border: '1px solid #fff'
                    }}
                  ></div>
                  <span>Player {playerId}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div 
          className={styles["placement-board"]}
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(${gameData.board_height}, 1fr)`,
            gridTemplateColumns: `repeat(${gameData.board_width}, 1fr)`,
            border: '1px solid var(--board-border, #333)',
            borderRadius: '5px',
            padding: '15px',
            gap: 0,
            overflow: 'hidden'
          }}
        >
          {renderBoard}
        </div>
      </div>

      <div className={styles["placement-instructions"]}>
        <h3>Instructions:</h3>
        <ul>
          <li>{isMobile ? 'Long press' : 'Right-click'} any square to add a piece</li>
          <li>Hover over a piece to see where it can move and attack</li>
          <li>Click and drag pieces to move them anywhere on the board</li>
          <li>Blue highlights show valid movement squares, orange shows capture squares</li>
          <li>Search for pieces by name or ID</li>
          <li>Assign each piece to a player (1-{gameData.player_count})</li>
          <li>Choose an image for the piece from available uploads</li>
          <li>{isMobile ? 'Long press' : 'Right-click'} an occupied square to remove or change the piece</li>
        </ul>
      </div>

      {/* Randomized Starting Positions */}
      <div className={styles["form-group"]} style={{ marginTop: '30px' }}>
        <label className={styles["form-label"]}>
          Starting Position Mode
          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#888' }}>
            (Board symmetric: {isBoardSymmetric ? 'Yes ✓' : 'No ✗'} | Pieces: {Object.keys(piecePlacements).length})
          </span>
        </label>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="randomized"
              checked={randomizationMode === 'none'}
              onChange={() => handleRandomizedChange('none')}
            />
            <span>Fixed Starting Positions</span>
            <p className={styles["radio-hint"]}>Pieces always start in the positions configured above</p>
          </label>
          <label className={styles["radio-label"]} style={{ opacity: isBoardSymmetric ? 1 : 0.5 }}>
            <input
              type="radio"
              name="randomized"
              checked={randomizationMode === 'mirrored'}
              onChange={() => handleRandomizedChange('mirrored')}
              disabled={!isBoardSymmetric}
            />
            <span>Mirrored Randomization</span>
            <p className={styles["radio-hint"]}>
              {isBoardSymmetric 
                ? "Both players get the same random configuration for all pieces, maintaining mirror symmetry."
                : "⚠️ Not available: Board must have 2 players with identical mirrored piece setups"}
            </p>
          </label>
          <label className={styles["radio-label"]} style={{ opacity: isBoardSymmetric ? 1 : 0.5 }}>
            <input
              type="radio"
              name="randomized"
              checked={randomizationMode === 'backrow'}
              onChange={() => handleRandomizedChange('backrow')}
              disabled={!isBoardSymmetric}
            />
            <span>Chess960-style (Back Row Only)</span>
            <p className={styles["radio-hint"]}>
              {isBoardSymmetric 
                ? "Only the back row is randomized in a mirrored fashion. Other pieces (like pawns) stay in place. True Chess960!"
                : "⚠️ Not available: Board must have 2 players with identical mirrored piece setups"}
            </p>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="randomized"
              checked={randomizationMode === 'independent'}
              onChange={() => handleRandomizedChange('independent')}
            />
            <span>Independent Randomization</span>
            <p className={styles["radio-hint"]}>Each player's pieces randomized independently within their starting squares</p>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="randomized"
              checked={randomizationMode === 'shared'}
              onChange={() => handleRandomizedChange('shared')}
            />
            <span>Shared Starting Squares</span>
            <p className={styles["radio-hint"]}>All pieces from both players redistributed randomly across all starting squares</p>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="randomized"
              checked={randomizationMode === 'full'}
              onChange={() => handleRandomizedChange('full')}
            />
            <span>Full Board Randomization</span>
            <p className={styles["radio-hint"]}>Pieces placed randomly anywhere on the board. Maximum chaos!</p>
          </label>
        </div>
      </div>

      {/* Additional Game Data */}
      {/* Additional Game Data */}
      <div className={styles["form-group"]} style={{ marginTop: '30px' }}>
        <label className={styles["form-label"]}>
          Additional Game Data (JSON)
        </label>
        <textarea
          className={styles["form-textarea-code"]}
          value={gameData.other_game_data || ""}
          onChange={(e) => updateGameData({ other_game_data: e.target.value })}
          placeholder='{"custom_rules": [], "special_mechanics": {}}'
          rows={6}
        />
        <p className={styles["field-hint"]}>
          Any additional game configuration in JSON format for future extensions.
        </p>
      </div>

      {showPieceSelector && (
        <PieceSelector
          onSelect={handlePieceSelected}
          onRemove={handleRemovePiece}
          onCancel={handleCancelSelector}
          playerCount={gameData.player_count}
          currentPlacement={piecePlacements[selectedSquare?.key]}
          squarePosition={selectedSquare}
          mateCondition={gameData.mate_condition}
          captureCondition={gameData.capture_condition}
        />
      )}
    </div>
  );
};

export default Step5PiecePlacement;
