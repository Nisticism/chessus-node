import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getGameById } from "../../actions/games";
import { getAllPieces } from "../../actions/pieces";
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
            
            // Fetch all pieces and create a map
            if (pieceIds.size > 0) {
              const allPieces = await getAllPieces();
              const pieceMap = {};
              allPieces.forEach(piece => {
                if (pieceIds.has(piece.id)) {
                  pieceMap[piece.id] = piece;
                }
              });
              console.log("Loaded piece data map:", pieceMap);
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

        if (placement) {
          console.log(`Placement at ${key}:`, placement);
        }

        board.push(
          <div
            key={key}
            className={styles["board-square"]}
            style={{
              background: isLight ? lightSquareColor : darkSquareColor,
              width: `${squareSize}px`,
              height: `${squareSize}px`,
              position: 'relative',
              border: squareType ? `4px solid ${borderColor}` : 'none',
              boxSizing: 'border-box'
            }}
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
