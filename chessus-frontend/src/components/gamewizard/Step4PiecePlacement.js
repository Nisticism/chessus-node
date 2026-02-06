import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import styles from "./gamewizard.module.scss";
import PieceSelector from "./PieceSelector";
import PiecesService from "../../services/pieces.service";
import { isMobileDevice, isTouchDevice } from "../../helpers/mobileUtils";
import { 
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
  canRangedAttackTo as canRangedAttackToUtil,
  getSquareHighlightStyle
} from "../../helpers/pieceMovementUtils";

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
  const [allowedStartingModes, setAllowedStartingModes] = useState(['none', 'backrow', 'mirrored', 'independent', 'shared', 'full']); // All enabled by default
  const [pieceDataMap, setPieceDataMap] = useState({});
  const [, setHoveredSquare] = useState(null);
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
        // Use /api/pieces/full to get ALL pieces with movement data in one call
        const response = await PiecesService.getPiecesWithMovement();
        const allPieces = response.data || [];
        
        const pieceMap = {};
        allPieces.forEach(piece => {
          // piece_id is returned from the full query, use it as the key
          const id = piece.piece_id || piece.id;
          pieceMap[id] = piece;
        });
        
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

    // Parse randomized_starting_positions to get allowed modes
    try {
      if (gameData.randomized_starting_positions) {
        const parsed = JSON.parse(gameData.randomized_starting_positions);
        if (parsed && parsed.allowedModes && Array.isArray(parsed.allowedModes)) {
          setAllowedStartingModes(parsed.allowedModes);
        } else if (parsed && parsed.mode) {
          // Legacy support: single mode means only that mode is allowed
          setAllowedStartingModes([parsed.mode]);
        } else if (parsed && parsed.enabled === true) {
          // Legacy support: enabled: true means 'independent'
          setAllowedStartingModes(['independent']);
        }
      }
    } catch (error) {
      // If it's not JSON, keep all modes enabled (default)
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

  // Check if piece can perform ranged attack to target square
  const canRangedAttackTo = useCallback((fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return false;
    return canRangedAttackToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  }, []);

  // Get full movement info including first-move-only status
  const getMoveInfo = useCallback((fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
    return canPieceMoveToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  }, []);

  // Get full capture info including first-move-only status
  const getCaptureInfo = useCallback((fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
    return canCaptureOnMoveToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  }, []);

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

  const handleStartingModeToggle = (mode) => {
    setAllowedStartingModes(prev => {
      let newModes;
      if (prev.includes(mode)) {
        // Don't allow removing the last mode
        if (prev.length === 1) return prev;
        newModes = prev.filter(m => m !== mode);
      } else {
        newModes = [...prev, mode];
      }
      
      // Store the allowed starting modes
      const randomizedData = {
        allowedModes: newModes
      };
      updateGameData({ randomized_starting_positions: JSON.stringify(randomizedData) });
      
      return newModes;
    });
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
        let moveInfo = { allowed: false, isFirstMoveOnly: false };
        let captureInfo = { allowed: false, isFirstMoveOnly: false };
        let canRanged = false;
        
        // Check for dragged piece
        if (draggedPiece && draggedPiecePosition) {
          const pieceData = pieceDataMap[draggedPiece.data.piece_id];
          if (pieceData) {
            moveInfo = getMoveInfo(draggedPiecePosition.row, draggedPiecePosition.col, row, col, pieceData, draggedPiece.data.player_id);
            captureInfo = getCaptureInfo(draggedPiecePosition.row, draggedPiecePosition.col, row, col, pieceData, draggedPiece.data.player_id);
            canRanged = canRangedAttackTo(draggedPiecePosition.row, draggedPiecePosition.col, row, col, pieceData, draggedPiece.data.player_id);
          }
        }
        // Check for hovered piece (not dragging)
        else if (hoveredPiecePosition && !draggedPiece) {
          const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
          if (pieceData) {
            moveInfo = getMoveInfo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData, hoveredPiecePosition.playerId);
            captureInfo = getCaptureInfo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData, hoveredPiecePosition.playerId);
            canRanged = canRangedAttackTo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData, hoveredPiecePosition.playerId);
          }
        }
        
        let squareStyle = {
          background: isLight ? lightSquareColor : darkSquareColor,
          position: 'relative',
          cursor: placement ? 'grab' : 'context-menu',
          boxSizing: 'border-box'
        };
        
        // Get highlight style using the utility function
        const { style: highlightStyle, icon: highlightIcon } = getSquareHighlightStyle(
          moveInfo.allowed,
          moveInfo.isFirstMoveOnly,
          captureInfo.allowed,
          captureInfo.isFirstMoveOnly,
          canRanged,
          isLight
        );
        
        // Merge highlight style
        squareStyle = { ...squareStyle, ...highlightStyle };
        
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
            {/* Ranged attack icon */}
            {highlightIcon && (
              <span className={styles["ranged-icon"]} style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: `${squareSize * 0.4}px`,
                pointerEvents: 'none',
                zIndex: 5,
                backgroundColor: isLight ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.6)',
                borderRadius: '4px',
                padding: '2px 4px'
              }}>
                {highlightIcon}
              </span>
            )}
            {placement && (
              <div 
                className={styles["piece-on-square"]}
                draggable
                onDragStart={(e) => handleDragStart(e, key)}
                onDragEnd={handleDragEnd}
                onMouseEnter={() => {
                  setHoveredPiecePosition({ row, col, pieceId: placement.piece_id, playerId: placement.player_id });
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
                    pointerEvents: 'none',
                    color: Number(placement.player_id) === 1 ? 'white' : 'black'
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
  }, [piecePlacements, gameData.board_width, gameData.board_height, lightSquareColor, darkSquareColor, handleSquareRightClick, handleDragOver, handleDrop, handleDragStart, handleDragEnd, getPlayerColor, getPlacementImageUrl, draggedPiece, draggedPiecePosition, hoveredPiecePosition, pieceDataMap, getMoveInfo, getCaptureInfo, canRangedAttackTo, boardDimensions, handleTouchStart, handleTouchEnd]);

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
          fontSize: '0.85rem',
          marginBottom: '0.5rem',
          margin: '0 auto 0.5rem'
        }}>
          <div className={styles["legend-row"]} style={{ flexWrap: 'wrap', gap: '6px 12px' }}>
            <div className={styles["legend-item"]}>
              <div className={styles["legend-square"]} style={{ border: '2px solid #2196F3', width: '14px', height: '14px' }}></div>
              <span>Move</span>
            </div>
            <div className={styles["legend-item"]}>
              <div className={styles["legend-square"]} style={{ border: '2px solid #9C27B0', width: '14px', height: '14px' }}></div>
              <span>1st Move</span>
            </div>
            <div className={styles["legend-item"]}>
              <div className={styles["legend-square"]} style={{ border: '2px solid #FF9800', width: '14px', height: '14px' }}></div>
              <span>Attack</span>
            </div>
            <div className={styles["legend-item"]}>
              <div className={styles["legend-square"]} style={{ border: '2px solid #E91E63', width: '14px', height: '14px' }}></div>
              <span>1st Atk</span>
            </div>
            <div className={styles["legend-item"]}>
              <div className={styles["legend-square"]} style={{ border: '2px solid #f44336', width: '14px', height: '14px' }}></div>
              <span>Range</span>
            </div>
            <div className={styles["legend-item"]} style={{ gap: '3px' }}>
              <span style={{ fontSize: '0.9rem' }}>♔</span>
              <span>Mate</span>
            </div>
            <div className={styles["legend-item"]} style={{ gap: '3px' }}>
              <span style={{ fontSize: '0.9rem' }}>⚔️</span>
              <span>Cap</span>
            </div>
            {Array.from({ length: gameData.player_count || 2 }, (_, i) => i + 1).map(playerId => (
              <div key={playerId} className={styles["legend-item"]}>
                <div 
                  className={styles["legend-player-dot"]} 
                  style={{ 
                    background: getPlayerColor(playerId),
                    border: playerId === 1 ? '1px solid #666' : '1px solid #fff',
                    width: '12px',
                    height: '12px'
                  }}
                ></div>
                <span>P{playerId}</span>
              </div>
            ))}
          </div>
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

      {/* Allowed Starting Position Modes */}
      <div className={styles["form-group"]} style={{ marginTop: '30px' }}>
        <label className={styles["form-label"]}>
          Allowed Starting Position Modes
          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#888' }}>
            (Board symmetric: {isBoardSymmetric ? 'Yes ✓' : 'No ✗'} | At least one mode must be enabled)
          </span>
        </label>
        <p className={styles["field-hint"]} style={{ marginBottom: '15px' }}>
          Select which starting position modes players can choose from when creating a match with this game type.
        </p>
        <div className={styles["checkbox-group-vertical"]}>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('none')}
              onChange={() => handleStartingModeToggle('none')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('none')}
            />
            <span>Fixed Starting Positions</span>
            <p className={styles["checkbox-hint"]}>Pieces always start in the positions configured above</p>
          </label>
          <label className={styles["checkbox-label"]} style={{ opacity: isBoardSymmetric ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('backrow')}
              onChange={() => handleStartingModeToggle('backrow')}
              disabled={!isBoardSymmetric || (allowedStartingModes.length === 1 && allowedStartingModes.includes('backrow'))}
            />
            <span>Back Row Only Mirrored Randomization</span>
            <p className={styles["checkbox-hint"]}>
              {isBoardSymmetric 
                ? "Only the back row is randomized in a mirrored fashion. Other pieces (like pawns) stay in place. Like Chess960!"
                : "⚠️ Not available: Board must have 2 players with identical mirrored piece setups"}
            </p>
          </label>
          <label className={styles["checkbox-label"]} style={{ opacity: isBoardSymmetric ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('mirrored')}
              onChange={() => handleStartingModeToggle('mirrored')}
              disabled={!isBoardSymmetric || (allowedStartingModes.length === 1 && allowedStartingModes.includes('mirrored'))}
            />
            <span>Full Mirrored Randomization</span>
            <p className={styles["checkbox-hint"]}>
              {isBoardSymmetric 
                ? "Both players get the same random configuration for all pieces, maintaining mirror symmetry."
                : "⚠️ Not available: Board must have 2 players with identical mirrored piece setups"}
            </p>
          </label>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('independent')}
              onChange={() => handleStartingModeToggle('independent')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('independent')}
            />
            <span>Independent Randomization</span>
            <p className={styles["checkbox-hint"]}>Each player's pieces randomized independently within their starting squares</p>
          </label>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('shared')}
              onChange={() => handleStartingModeToggle('shared')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('shared')}
            />
            <span>Shared Starting Squares</span>
            <p className={styles["checkbox-hint"]}>All pieces from both players redistributed randomly across all starting squares</p>
          </label>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('full')}
              onChange={() => handleStartingModeToggle('full')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('full')}
            />
            <span>Full Board Randomization</span>
            <p className={styles["checkbox-hint"]}>Pieces placed randomly anywhere on the board. Maximum chaos!</p>
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
