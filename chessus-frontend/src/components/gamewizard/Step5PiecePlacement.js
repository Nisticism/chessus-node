import React, { useState, useEffect } from "react";
import styles from "./gamewizard.module.scss";
import PieceSelector from "./PieceSelector";

const Step5PiecePlacement = ({ gameData, updateGameData }) => {
  const [piecePlacements, setPiecePlacements] = useState({});
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [showPieceSelector, setShowPieceSelector] = useState(false);
  
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
  }, []);

  // Update gameData whenever piecePlacements changes
  useEffect(() => {
    updateGameData({ pieces_string: JSON.stringify(piecePlacements) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piecePlacements]);

  const handleSquareRightClick = (e, row, col) => {
    e.preventDefault();
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowPieceSelector(true);
  };

  const handlePieceSelected = (pieceData) => {
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
  };

  const handleRemovePiece = () => {
    if (selectedSquare) {
      setPiecePlacements(prev => {
        const newPlacements = { ...prev };
        delete newPlacements[selectedSquare.key];
        return newPlacements;
      });
    }
    setShowPieceSelector(false);
    setSelectedSquare(null);
  };

  const handleCancelSelector = () => {
    setShowPieceSelector(false);
    setSelectedSquare(null);
  };

  const renderBoard = () => {
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
              cursor: 'context-menu'
            }}
            onContextMenu={(e) => handleSquareRightClick(e, row, col)}
          >
            {placement && (
              <div className={styles["piece-on-square"]}>
                {placement.image_url ? (
                  <img 
                    src={placement.image_url} 
                    alt={placement.piece_name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                  />
                ) : (
                  <span style={{ fontSize: `${squareSize * 0.3}px`, color: '#fff' }}>
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
                  border: '1px solid #fff'
                }} />
              </div>
            )}
          </div>
        );
      }
    }
    
    return board;
  };

  const getPlayerColor = (playerId) => {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f', '#bb8fce', '#52be80', '#ec7063', '#5dade2'];
    return colors[(playerId - 1) % colors.length] || '#999';
  };

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
        Right-click on any square to add or remove pieces. Assign pieces to players and choose their images.
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
          {renderBoard()}
        </div>
      </div>

      <div className={styles["placement-instructions"]}>
        <h3>Instructions:</h3>
        <ul>
          <li>Right-click any square to add a piece</li>
          <li>Search for pieces by name or ID</li>
          <li>Assign each piece to a player (1-{gameData.player_count})</li>
          <li>Choose an image for the piece from available uploads</li>
          <li>Right-click an occupied square to remove or change the piece</li>
        </ul>
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
