import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getGameById } from "../../actions/games";
import { getAllPieces, getPieceById } from "../../actions/pieces";
import styles from "./gametypeview.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${ASSET_URL}${imagePath}`;
};

const GameTypeView = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [piecePlacements, setPiecePlacements] = useState({});
  const [pieceDataMap, setPieceDataMap] = useState({});
  const [hoveredPiecePosition, setHoveredPiecePosition] = useState(null);
  const [specialSquares, setSpecialSquares] = useState({
    range: {},
    promotion: {},
    special: {}
  });

  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  useEffect(() => {
    const loadGame = async () => {
      try {
        setLoading(true);
        const gameData = await dispatch(getGameById(gameId));
        setGame(gameData);

        // Parse piece placements
        if (gameData.pieces_string) {
          try {
            const parsed = JSON.parse(gameData.pieces_string);
            console.log("Parsed piece placements:", parsed);
            
            // Get unique piece IDs from placements
            const pieceIds = new Set();
            Object.values(parsed).forEach(placement => {
              if (placement.piece_id) {
                pieceIds.add(placement.piece_id);
              }
            });
            
            // Fetch piece data for all unique piece IDs with full movement data
            if (pieceIds.size > 0) {
              const pieceMap = {};
              
              // Load full details for each piece ID directly
              await Promise.all(Array.from(pieceIds).map(async (pieceId) => {
                try {
                  const fullPieceData = await getPieceById(pieceId);
                  console.log(`getPieceById(${pieceId}) returned:`, fullPieceData);
                  // Store by the requested ID, not the returned ID
                  pieceMap[pieceId] = fullPieceData;
                } catch (err) {
                  console.error(`Error loading piece ${pieceId}:`, err);
                }
              }));
              
              console.log('Loaded piece data map with movement data:', pieceMap);
              setPieceDataMap(pieceMap);
            }
            setPiecePlacements(parsed);
          } catch (e) {
            console.error("Error parsing pieces_string:", e);
          }
        }

        // Parse special squares
        if (gameData.range_squares_string) {
          try {
            const parsed = JSON.parse(gameData.range_squares_string);
            setSpecialSquares(prev => ({ ...prev, range: parsed }));
          } catch (e) {
            console.error("Error parsing range_squares_string:", e);
          }
        }

        if (gameData.promotion_squares_string) {
          try {
            const parsed = JSON.parse(gameData.promotion_squares_string);
            setSpecialSquares(prev => ({ ...prev, promotion: parsed }));
          } catch (e) {
            console.error("Error parsing promotion_squares_string:", e);
          }
        }

        if (gameData.special_squares_string) {
          try {
            const parsed = JSON.parse(gameData.special_squares_string);
            setSpecialSquares(prev => ({ ...prev, special: parsed }));
          } catch (e) {
            console.error("Error parsing special_squares_string:", e);
          }
        }

        setLoading(false);
      } catch (err) {
        console.error("Error loading game:", err);
        setError("Failed to load game");
        setLoading(false);
      }
    };

    if (gameId) {
      loadGame();
    }
  }, [gameId, dispatch]);

  const getPlayerColor = (playerId) => {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f', '#bb8fce', '#52be80', '#ec7063', '#5dade2'];
    return colors[(playerId - 1) % colors.length] || '#999';
  };

  const getSquareType = (key) => {
    if (specialSquares.range[key]) return 'range';
    if (specialSquares.promotion[key]) return 'promotion';
    if (specialSquares.special[key]) return 'special';
    return null;
  };

  const getSquareColor = (type) => {
    switch (type) {
      case 'range': return '#ff8c00';
      case 'promotion': return '#4b0082';
      case 'special': return '#ffd700';
      default: return null;
    }
  };

  const getPlacementImageUrl = (placement) => {
    // First try to get current image from piece data
    if (placement.piece_id && pieceDataMap[placement.piece_id]) {
      const piece = pieceDataMap[placement.piece_id];
      if (piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          if (Array.isArray(images) && images.length > 0) {
            const imagePath = images[0];
            return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
          }
        } catch (e) {
          console.error("Error parsing image_location for piece", placement.piece_id, e);
        }
      }
    }
    // Fall back to saved image_url
    return placement.image_url ? getImageUrl(placement.image_url) : null;
  };

  // Helper function to check if a value allows movement at a distance
  const checkMovement = (value, distance) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null) return false;
    if (value > 0) return distance <= value; // Up to X squares
    if (value < 0) return distance === Math.abs(value); // Exact X squares
    return false;
  };

  // Check if piece can move to a square
  const canPieceMoveTo = (fromRow, fromCol, toRow, toCol, pieceData) => {
    if (!pieceData) return false;
    if (fromRow === toRow && fromCol === toCol) return false;

    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    // Check directional movement (handle both string and numeric values)
    const directionalStyle = pieceData.directional_movement_style;
    if (directionalStyle === 'directional' || directionalStyle === 'both' || directionalStyle === 1 || directionalStyle === 3) {
      let directionalAllowed = false;

      // Check 8 directions
      if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_movement, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_movement, Math.abs(colDiff));
      } else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_movement, Math.abs(colDiff));
      } else if (rowDiff < 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.up_left_movement, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      } else if (rowDiff < 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.up_right_movement, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      } else if (rowDiff > 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.down_left_movement, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      } else if (rowDiff > 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.down_right_movement, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      }

      if (directionalAllowed) return true;
    }

    // Check ratio movement (L-shape like knight) - handle both string and numeric
    if (directionalStyle === 'ratio' || directionalStyle === 'both' || directionalStyle === 2 || directionalStyle === 3) {
      const ratio1 = pieceData.ratio_movement_1 || 0;
      const ratio2 = pieceData.ratio_movement_2 || 0;
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step-by-step movement
    if (pieceData.step_movement_style === 'manhattan' || pieceData.step_movement_style === 1) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      return checkMovement(pieceData.step_movement_value, manhattanDistance);
    } else if (pieceData.step_movement_style === 'chebyshev' || pieceData.step_movement_style === 2) {
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return checkMovement(pieceData.step_movement_value, chebyshevDistance);
    }

    return false;
  };

  // Check if piece can capture on a square
  const canCaptureOnMoveTo = (fromRow, fromCol, toRow, toCol, pieceData) => {
    if (!pieceData) return false;
    if (fromRow === toRow && fromCol === toCol) return false;

    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    // Check if separate capture fields are defined
    const hasSeparateCaptureFields = pieceData.up_capture || pieceData.down_capture || 
                                     pieceData.left_capture || pieceData.right_capture || 
                                     pieceData.up_left_capture || pieceData.up_right_capture ||
                                     pieceData.down_left_capture || pieceData.down_right_capture ||
                                     pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                                     pieceData.step_capture_style;

    // If piece can capture on move AND no separate capture fields, use movement logic
    if (pieceData.can_capture_enemy_on_move && !hasSeparateCaptureFields) {
      return canPieceMoveTo(fromRow, fromCol, toRow, toCol, pieceData);
    }

    // Check directional capture (handle both string and numeric values, or if individual capture fields are set)
    const directionalCaptureStyle = pieceData.directional_capture_style;
    const hasDirectionalCapture = directionalCaptureStyle === 'directional' || directionalCaptureStyle === 'both' || 
                                   directionalCaptureStyle === 1 || directionalCaptureStyle === 3 ||
                                   // Also check if any directional capture fields are set
                                   pieceData.up_capture || pieceData.down_capture || pieceData.left_capture || 
                                   pieceData.right_capture || pieceData.up_left_capture || pieceData.up_right_capture ||
                                   pieceData.down_left_capture || pieceData.down_right_capture;
    
    if (hasDirectionalCapture) {
      let directionalAllowed = false;

      if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_capture, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_capture, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_capture, Math.abs(colDiff));
      } else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_capture, Math.abs(colDiff));
      } else if (rowDiff < 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.up_left_capture, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      } else if (rowDiff < 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.up_right_capture, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      } else if (rowDiff > 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.down_left_capture, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      } else if (rowDiff > 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.down_right_capture, Math.max(Math.abs(rowDiff), Math.abs(colDiff)));
      }

      if (directionalAllowed) return true;
    }

    // Check ratio capture (L-shape) - handle both string and numeric
    if (directionalCaptureStyle === 'ratio' || directionalCaptureStyle === 'both' || directionalCaptureStyle === 2 || directionalCaptureStyle === 3) {
      const ratio1 = pieceData.ratio_capture_1 || 0;
      const ratio2 = pieceData.ratio_capture_2 || 0;
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step-by-step capture
    if (pieceData.step_capture_style === 'manhattan' || pieceData.step_capture_style === 1) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      return checkMovement(pieceData.step_capture_value, manhattanDistance);
    } else if (pieceData.step_capture_style === 'chebyshev' || pieceData.step_capture_style === 2) {
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return checkMovement(pieceData.step_capture_value, chebyshevDistance);
    }

    return false;
  };

  const renderBoard = () => {
    if (!game) return null;

    const board = [];
    const squareSize = Math.min(60, 720 / Math.max(game.board_width, game.board_height));

    for (let row = 0; row < game.board_height; row++) {
      for (let col = 0; col < game.board_width; col++) {
        const isLight = (row + col) % 2 === 0;
        const key = `${row},${col}`;
        const placement = piecePlacements[key];
        const squareType = getSquareType(key);
        const borderColor = getSquareColor(squareType);

        // Check if this square is valid for the hovered piece
        let canMove = false;
        let canCapture = false;
        
        if (hoveredPiecePosition) {
          const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
          if (row === 0 && col === 0) {
            console.log('Hovered piece position:', hoveredPiecePosition);
            console.log('Piece data:', pieceData);
            console.log('Movement fields:', {
              directional_movement_style: pieceData?.directional_movement_style,
              up_movement: pieceData?.up_movement,
              down_movement: pieceData?.down_movement,
              left_movement: pieceData?.left_movement,
              right_movement: pieceData?.right_movement,
              can_capture_enemy_on_move: pieceData?.can_capture_enemy_on_move
            });
            console.log('Capture fields:', {
              directional_capture_style: pieceData?.directional_capture_style,
              up_capture: pieceData?.up_capture,
              down_capture: pieceData?.down_capture,
              up_left_capture: pieceData?.up_left_capture,
              up_right_capture: pieceData?.up_right_capture,
              can_capture_enemy_on_move: pieceData?.can_capture_enemy_on_move,
              'typeof can_capture_enemy_on_move': typeof pieceData?.can_capture_enemy_on_move,
              'truthy check': !!pieceData?.can_capture_enemy_on_move
            });
          }
          if (pieceData) {
            canMove = canPieceMoveTo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData);
            canCapture = canCaptureOnMoveTo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData);
            if ((canMove || canCapture) && row === 0 && col === 0) {
              console.log('Square 0,0: canMove=', canMove, 'canCapture=', canCapture);
            }
          }
        }

        let squareStyle = {
          background: isLight ? lightSquareColor : darkSquareColor,
          width: `${squareSize}px`,
          height: `${squareSize}px`,
          position: 'relative',
          border: squareType ? `4px solid ${borderColor}` : 'none',
          boxSizing: 'border-box'
        };

        // Add hover highlighting (override special square borders if applicable)
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
          >
            {squareType && !placement && (
              <div 
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
                  pointerEvents: 'none'
                }}
              >
                {squareType === 'range' && 'R'}
                {squareType === 'promotion' && 'P'}
                {squareType === 'special' && 'S'}
              </div>
            )}
            {placement && (
              <div
                onMouseEnter={() => {
                  console.log('Hovering over piece at', row, col, 'pieceId:', placement.piece_id);
                  setHoveredPiecePosition({ row, col, pieceId: placement.piece_id });
                }}
                onMouseLeave={() => {
                  console.log('Left piece');
                  setHoveredPiecePosition(null);
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'default'
                }}
              >
                {(() => {
                  const imageUrl = getPlacementImageUrl(placement);
                  return imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={placement.piece_name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        pointerEvents: 'none'
                      }}
                      onError={(e) => {
                        console.error("Failed to load image:", imageUrl);
                        e.target.style.display = 'none';
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: `${squareSize * 0.3}px`, color: '#fff', pointerEvents: 'none' }}>
                      {placement.piece_name?.charAt(0) || '?'}
                    </span>
                  );
                })()}
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
  };

  const canEdit = () => {
    return currentUser && game && (game.creator_id === currentUser.id || currentUser.role === "Admin");
  };

  if (loading) {
    return (
      <div className={styles["container"]}>
        <div className={styles["loading"]}>Loading game...</div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className={styles["container"]}>
        <div className={styles["error"]}>{error || "Game not found"}</div>
        <button onClick={() => navigate('/create/games')} className={styles["back-button"]}>
          Back to Games
        </button>
      </div>
    );
  }

  return (
    <div className={styles["container"]}>
      <div className={styles["header"]}>
        <button onClick={() => navigate('/create/games')} className={styles["back-button"]}>
          ← Back to Games
        </button>
        {canEdit() && (
          <button 
            onClick={() => navigate(`/create/game/edit/${gameId}`)} 
            className={styles["edit-button"]}
          >
            ✏️ Edit Game
          </button>
        )}
      </div>

      <div className={styles["game-info"]}>
        <h1>{game.game_name}</h1>
        {game.creator_username && (
          <p className={styles["creator"]}>
            Created by <Link to={`/profile/${game.creator_username}`}>{game.creator_username}</Link>
          </p>
        )}

        {game.descript && (
          <div className={styles["section"]}>
            <h2>Description</h2>
            <p>{game.descript}</p>
          </div>
        )}

        <div className={styles["stats-grid"]}>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Board Size</span>
            <span className={styles["stat-value"]}>{game.board_width} × {game.board_height}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Players</span>
            <span className={styles["stat-value"]}>{game.player_count}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Actions per Turn</span>
            <span className={styles["stat-value"]}>{game.actions_per_turn || 1}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Pieces</span>
            <span className={styles["stat-value"]}>{Object.keys(piecePlacements).length}</span>
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Board Setup</h2>
          <div className={styles["board-container"]}>
            <div
              className={styles["board"]}
              style={{
                display: 'grid',
                gridTemplateRows: `repeat(${game.board_height}, 1fr)`,
                gridTemplateColumns: `repeat(${game.board_width}, 1fr)`,
                border: '2px solid #ccc',
                width: 'fit-content',
                margin: '0 auto'
              }}
            >
              {renderBoard()}
            </div>
          </div>
        </div>

        {game.rules && (
          <div className={styles["section"]}>
            <h2>Rules</h2>
            <p className={styles["rules"]}>{game.rules}</p>
          </div>
        )}

        <div className={styles["section"]}>
          <h2>Win Conditions</h2>
          <div className={styles["win-conditions"]}>
            {Boolean(game.mate_condition) && (
              <div className={styles["condition"]}>
                <span className={styles["condition-icon"]}>👑</span>
                <span>Checkmate condition enabled</span>
              </div>
            )}
            {Boolean(game.capture_condition) && (
              <div className={styles["condition"]}>
                <span className={styles["condition-icon"]}>⚔️</span>
                <span>Capture condition enabled</span>
              </div>
            )}
            {Boolean(game.value_condition) && (
              <div className={styles["condition"]}>
                <span className={styles["condition-icon"]}>💎</span>
                <span>Value condition: {game.value_title || 'Reach target value'}</span>
              </div>
            )}
            {Boolean(game.squares_condition) && (
              <div className={styles["condition"]}>
                <span className={styles["condition-icon"]}>📍</span>
                <span>Control {game.squares_count} squares</span>
              </div>
            )}
            {Boolean(game.hill_condition) && (
              <div className={styles["condition"]}>
                <span className={styles["condition-icon"]}>⛰️</span>
                <span>King of the Hill at ({game.hill_x}, {game.hill_y}) for {game.hill_turns} turns</span>
              </div>
            )}
            {!Boolean(game.mate_condition) && !Boolean(game.capture_condition) && !Boolean(game.value_condition) && 
             !Boolean(game.squares_condition) && !Boolean(game.hill_condition) && (
              <p className={styles["no-conditions"]}>No win conditions configured</p>
            )}
          </div>
        </div>

        {(Object.keys(specialSquares.range).length > 0 || 
          Object.keys(specialSquares.promotion).length > 0 || 
          Object.keys(specialSquares.special).length > 0) && (
          <div className={styles["section"]}>
            <h2>Special Squares</h2>
            <div className={styles["special-squares-info"]}>
              {Object.keys(specialSquares.range).length > 0 && (
                <div className={styles["special-type"]}>
                  <span style={{ color: '#ff8c00', fontWeight: 'bold' }}>Range Squares:</span> {Object.keys(specialSquares.range).length}
                </div>
              )}
              {Object.keys(specialSquares.promotion).length > 0 && (
                <div className={styles["special-type"]}>
                  <span style={{ color: '#4b0082', fontWeight: 'bold' }}>Promotion Squares:</span> {Object.keys(specialSquares.promotion).length}
                </div>
              )}
              {Object.keys(specialSquares.special).length > 0 && (
                <div className={styles["special-type"]}>
                  <span style={{ color: '#ffd700', fontWeight: 'bold' }}>Special Squares:</span> {Object.keys(specialSquares.special).length}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GameTypeView;
