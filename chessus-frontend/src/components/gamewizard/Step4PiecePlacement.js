import React, { useState, useEffect, useMemo, useCallback } from "react";
import styles from "./gamewizard.module.scss";
import PieceSelector from "./PieceSelector";

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
  const [useRandomizedPositions, setUseRandomizedPositions] = useState(false);
  
  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  // Parse existing piece placements when component mounts
  useEffect(() => {
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

    // Parse randomized_starting_positions to check if it's enabled
    try {
      if (gameData.randomized_starting_positions) {
        const parsed = JSON.parse(gameData.randomized_starting_positions);
        if (parsed && parsed.enabled === true) {
          setUseRandomizedPositions(true);
        }
      }
    } catch (error) {
      // If it's not JSON, treat it as legacy string data
      setUseRandomizedPositions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData.pieces_string, gameData.randomized_starting_positions]);

  // Update gameData whenever piecePlacements changes
  useEffect(() => {
    updateGameData({ pieces_string: JSON.stringify(piecePlacements) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piecePlacements]);

  const handleSquareRightClick = useCallback((e, row, col) => {
    e.preventDefault();
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowPieceSelector(true);
  }, []);

  const handlePieceSelected = useCallback((pieceData) => {
    if (selectedSquare) {
      setPiecePlacements(prev => ({
        ...prev,
        [selectedSquare.key]: {
          piece_id: pieceData.piece_id,
          player_id: pieceData.player_id,
          image_url: pieceData.image_url,
          piece_name: pieceData.piece_name
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

  // Drag and drop handlers
  const handleDragStart = useCallback((e, key) => {
    setDraggedPiece({ key, data: piecePlacements[key] });
    e.dataTransfer.effectAllowed = 'move';
    // Make the dragged element semi-transparent
    e.currentTarget.style.opacity = '0.5';
  }, [piecePlacements]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
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
      return;
    }

    setPiecePlacements(prev => {
      const newPlacements = { ...prev };
      // Remove from source
      delete newPlacements[sourceKey];
      // Add to target (overwrite if exists)
      newPlacements[targetKey] = draggedPiece.data;
      return newPlacements;
    });

    setDraggedPiece(null);
  }, [draggedPiece]);

  const handleDragEnd = useCallback((e) => {
    // Reset opacity
    e.currentTarget.style.opacity = '1';
    setDraggedPiece(null);
  }, []);

  const handleRandomizedChange = (useRandomized) => {
    setUseRandomizedPositions(useRandomized);
    
    if (useRandomized) {
      // Save current board state with randomization enabled
      const randomizedData = {
        enabled: true,
        startingPositions: piecePlacements
      };
      updateGameData({ randomized_starting_positions: JSON.stringify(randomizedData) });
    } else {
      // Disable randomization
      const randomizedData = {
        enabled: false,
        startingPositions: {}
      };
      updateGameData({ randomized_starting_positions: JSON.stringify(randomizedData) });
    }
  };

  // Helper function to get player color (must be defined before renderBoard)
  const getPlayerColor = (playerId) => {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f', '#bb8fce', '#52be80', '#ec7063', '#5dade2'];
    return colors[(playerId - 1) % colors.length] || '#999';
  };

  const renderBoard = useMemo(() => {
    const board = [];
    const squareSize = Math.min(60, 480 / Math.max(gameData.board_width, gameData.board_height));
    
    for (let row = 0; row < gameData.board_height; row++) {
      for (let col = 0; col < gameData.board_width; col++) {
        const isLight = (row + col) % 2 === 0;
        const key = `${row},${col}`;
        const placement = piecePlacements[key];
        
        board.push(
          <div
            key={key}
            className={styles["board-square"]}
            style={{
              background: isLight ? lightSquareColor : darkSquareColor,
              width: `${squareSize}px`,
              height: `${squareSize}px`,
              position: 'relative',
              cursor: placement ? 'grab' : 'context-menu'
            }}
            onContextMenu={(e) => handleSquareRightClick(e, row, col)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, row, col)}
          >
            {placement && (
              <div 
                className={styles["piece-on-square"]}
                draggable
                onDragStart={(e) => handleDragStart(e, key)}
                onDragEnd={handleDragEnd}
                style={{ cursor: 'grab' }}
              >
                {placement.image_url ? (
                  <img 
                    src={getImageUrl(placement.image_url)} 
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
                  border: '1px solid #fff',
                  pointerEvents: 'none'
                }} />
              </div>
            )}
          </div>
        );
      }
    }
    
    return board;
  }, [piecePlacements, gameData.board_width, gameData.board_height, lightSquareColor, darkSquareColor, handleSquareRightClick, handleDragOver, handleDrop, handleDragStart, handleDragEnd, getPlayerColor]);

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

      <div className={styles["piece-stats"]}>
        <div className={styles["stat-item"]}>
          <strong>Total Pieces:</strong> {totalPieces}
        </div>
        {Object.entries(pieceCounts).map(([player, count]) => (
          <div key={player} className={styles["stat-item"]}>
            <strong>{player}:</strong> {count} pieces
          </div>
        ))}
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
          {renderBoard}
        </div>
      </div>

      <div className={styles["placement-instructions"]}>
        <h3>Instructions:</h3>
        <ul>
          <li>Right-click any square to add a piece</li>
          <li>Click and drag pieces to move them to different squares</li>
          <li>Search for pieces by name or ID</li>
          <li>Assign each piece to a player (1-{gameData.player_count})</li>
          <li>Choose an image for the piece from available uploads</li>
          <li>Right-click an occupied square to remove or change the piece</li>
        </ul>
      </div>

      {/* Randomized Starting Positions */}
      <div className={styles["form-group"]} style={{ marginTop: '30px' }}>
        <label className={styles["form-label"]}>
          Starting Position Mode
        </label>
        <div className={styles["radio-group"]}>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="randomized"
              checked={!useRandomizedPositions}
              onChange={() => handleRandomizedChange(false)}
            />
            <span>Fixed Starting Positions</span>
            <p className={styles["radio-hint"]}>Pieces always start in the positions configured above</p>
          </label>
          <label className={styles["radio-label"]}>
            <input
              type="radio"
              name="randomized"
              checked={useRandomizedPositions}
              onChange={() => handleRandomizedChange(true)}
            />
            <span>Randomized Starting Positions</span>
            <p className={styles["radio-hint"]}>Pieces will be randomly placed each game (like Chess960)</p>
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
        />
      )}
    </div>
  );
};

export default Step5PiecePlacement;
