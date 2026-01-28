import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./livegame.module.scss";

const LiveGame = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  
  const { 
    connected, 
    currentGame,
    setCurrentGame,
    getGameState,
    joinGame,
    makeMove,
    resign,
    cancelGame,
    onGameEvent
  } = useSocket();

  const [gameState, setGameState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [showGameOver, setShowGameOver] = useState(false);
  const [gameOverData, setGameOverData] = useState(null);

  // Load game state on mount
  useEffect(() => {
    const loadGame = async () => {
      if (!connected) return;
      
      setLoading(true);
      try {
        const state = await getGameState(parseInt(gameId));
        setGameState(state);
      } catch (err) {
        setError(err.message || "Failed to load game");
      } finally {
        setLoading(false);
      }
    };

    loadGame();
  }, [gameId, connected, getGameState]);

  // Subscribe to game events
  useEffect(() => {
    const unsubscribeMove = onGameEvent("moveMade", ({ gameId: moveGameId, move, gameState: newState }) => {
      if (parseInt(moveGameId) === parseInt(gameId)) {
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          currentTurn: newState.currentTurn,
          playerTimes: newState.playerTimes,
          moveHistory: newState.moveHistory
        }));
        setSelectedPiece(null);
        setValidMoves([]);
      }
    });

    const unsubscribeGameOver = onGameEvent("gameOver", ({ gameId: overGameId, winner, winnerUsername, reason }) => {
      if (parseInt(overGameId) === parseInt(gameId)) {
        setGameOverData({ winner, winnerUsername, reason });
        setShowGameOver(true);
        setGameState(prev => ({ ...prev, status: 'completed', winner }));
      }
    });

    const unsubscribePlayerJoined = onGameEvent("playerJoined", ({ gameId: joinedGameId, gameState: newState }) => {
      if (parseInt(joinedGameId) === parseInt(gameId)) {
        setGameState(newState);
      }
    });

    const unsubscribeGameState = onGameEvent("gameState", (state) => {
      if (parseInt(state.id) === parseInt(gameId)) {
        setGameState(state);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeMove();
      unsubscribeGameOver();
      unsubscribePlayerJoined();
      unsubscribeGameState();
    };
  }, [gameId, onGameEvent]);

  // Get current player info
  const currentPlayer = useMemo(() => {
    if (!gameState?.players || !currentUser) return null;
    return gameState.players.find(p => p.id === currentUser.id);
  }, [gameState?.players, currentUser]);

  // Check if it's the current user's turn
  const isMyTurn = useMemo(() => {
    if (!currentPlayer || !gameState) return false;
    return currentPlayer.position === gameState.currentTurn;
  }, [currentPlayer, gameState]);

  // Format time display
  const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return "∞";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate valid moves for a piece
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight) => {
    const moves = [];
    
    // Simple movement calculation - this would need to be expanded based on piece type
    // For now, we'll do basic movement in all directions based on piece properties
    
    const directions = [
      { dx: -1, dy: -1 }, // up-left
      { dx: 0, dy: -1 },  // up
      { dx: 1, dy: -1 },  // up-right
      { dx: 1, dy: 0 },   // right
      { dx: 1, dy: 1 },   // down-right
      { dx: 0, dy: 1 },   // down
      { dx: -1, dy: 1 },  // down-left
      { dx: -1, dy: 0 },  // left
    ];

    // Default: allow one square in any direction (like a King)
    for (const dir of directions) {
      const newX = piece.x + dir.dx;
      const newY = piece.y + dir.dy;

      // Check bounds
      if (newX < 0 || newX >= boardWidth || newY < 0 || newY >= boardHeight) continue;

      // Check for friendly piece
      const occupyingPiece = pieces.find(p => p.x === newX && p.y === newY);
      if (occupyingPiece && (occupyingPiece.team === piece.team || occupyingPiece.player === piece.player)) continue;

      moves.push({
        x: newX,
        y: newY,
        isCapture: !!occupyingPiece
      });
    }

    return moves;
  }, []);

  // Handle square click
  const handleSquareClick = useCallback((x, y) => {
    if (!isMyTurn || !gameState || gameState.status === 'completed') return;

    const pieces = gameState.pieces || [];
    const clickedPiece = pieces.find(p => p.x === x && p.y === y);

    // If clicking on own piece, select it
    if (clickedPiece && (clickedPiece.team === currentPlayer?.position || clickedPiece.player === currentUser?.id)) {
      setSelectedPiece(clickedPiece);
      const moves = calculateValidMoves(
        clickedPiece, 
        pieces, 
        gameState.gameType?.board_width || 8, 
        gameState.gameType?.board_height || 8
      );
      setValidMoves(moves);
      return;
    }

    // If piece is selected and clicking on valid move, make the move
    if (selectedPiece) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      if (move) {
        makeMove(parseInt(gameId), {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        });
        setSelectedPiece(null);
        setValidMoves([]);
      } else {
        // Clicking elsewhere, deselect
        setSelectedPiece(null);
        setValidMoves([]);
      }
    }
  }, [isMyTurn, gameState, currentPlayer, currentUser, selectedPiece, validMoves, calculateValidMoves, makeMove, gameId]);

  // Handle resign
  const handleResign = () => {
    if (window.confirm("Are you sure you want to resign?")) {
      resign(parseInt(gameId));
    }
  };

  // Handle rematch / new game
  const handlePlayAgain = () => {
    navigate("/play");
  };

  // Check if user can join this game
  const canJoin = useMemo(() => {
    if (!gameState || !currentUser) return false;
    if (gameState.status !== 'waiting') return false;
    const isAlreadyPlayer = gameState.players?.some(p => p.id === currentUser.id);
    return !isAlreadyPlayer;
  }, [gameState, currentUser]);

  // Handle joining the game
  const handleJoinGame = async () => {
    try {
      await joinGame(parseInt(gameId));
    } catch (err) {
      setError(err.message);
    }
  };

  // Render board
  const renderBoard = () => {
    if (!gameState) return null;

    const boardWidth = gameState.gameType?.board_width || 8;
    const boardHeight = gameState.gameType?.board_height || 8;
    const pieces = gameState.pieces || [];
    const lastMove = gameState.moveHistory?.slice(-1)[0];

    const squares = [];

    for (let y = 0; y < boardHeight; y++) {
      for (let x = 0; x < boardWidth; x++) {
        const isLight = (x + y) % 2 === 0;
        const piece = pieces.find(p => p.x === x && p.y === y);
        const isSelected = selectedPiece && selectedPiece.x === x && selectedPiece.y === y;
        const validMove = validMoves.find(m => m.x === x && m.y === y);
        const isLastMove = lastMove && (
          (lastMove.from?.x === x && lastMove.from?.y === y) ||
          (lastMove.to?.x === x && lastMove.to?.y === y)
        );

        squares.push(
          <div
            key={`${x}-${y}`}
            className={`
              ${styles["board-square"]}
              ${isLight ? styles.light : styles.dark}
              ${isSelected ? styles.selected : ''}
              ${validMove && !validMove.isCapture ? styles["valid-move"] : ''}
              ${validMove && validMove.isCapture ? styles["valid-capture"] : ''}
              ${isLastMove ? styles["last-move"] : ''}
            `}
            onClick={() => handleSquareClick(x, y)}
            style={{
              backgroundColor: isLight 
                ? (currentUser?.light_square_color || '#cad5e8')
                : (currentUser?.dark_square_color || '#08234d')
            }}
          >
            {piece && (
              <div className={styles.piece}>
                {piece.image ? (
                  <img src={piece.image} alt={piece.name || 'piece'} />
                ) : (
                  // Fallback to unicode chess pieces
                  <span>{getPieceSymbol(piece)}</span>
                )}
              </div>
            )}
          </div>
        );
      }
    }

    return (
      <div 
        className={styles["game-board"]}
        style={{
          gridTemplateColumns: `repeat(${boardWidth}, 50px)`,
          gridTemplateRows: `repeat(${boardHeight}, 50px)`
        }}
      >
        {squares}
      </div>
    );
  };

  // Get piece symbol (fallback for pieces without images)
  const getPieceSymbol = (piece) => {
    // This would map piece types to symbols
    // For now, return a generic piece symbol
    const team = piece.team || 1;
    return team === 1 ? '♙' : '♟';
  };

  // Loading state
  if (loading) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["loading-container"]}>
          <div className={styles["loading-spinner"]}></div>
          <p>Loading game...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/play" className={`${styles.btn} ${styles["btn-primary"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>
    );
  }

  // No game found
  if (!gameState) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          <h2>Game Not Found</h2>
          <p>This game doesn't exist or has been cancelled.</p>
          <Link to="/play" className={`${styles.btn} ${styles["btn-primary"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>
    );
  }

  // Waiting for opponent
  if (gameState.status === 'waiting') {
    const isHost = gameState.hostId === currentUser?.id;
    const gameUrl = `${window.location.origin}/play/${gameId}`;

    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["game-header"]}>
          <div className={styles["game-title"]}>
            <h1>{gameState.gameType?.game_name || 'Game'}</h1>
            <div className={`${styles["game-status"]} ${styles.waiting}`}>
              Waiting for opponent...
            </div>
          </div>
        </div>

        <div className={styles["waiting-overlay"]}>
          <div className={styles["waiting-modal"]}>
            <h2>{isHost ? 'Waiting for Opponent' : 'Join Game?'}</h2>
            
            {isHost ? (
              <>
                <div className={styles["waiting-spinner"]}></div>
                <p>Share this link with a friend:</p>
                <div className={styles["share-link"]}>{gameUrl}</div>
                <button 
                  className={`${styles.btn} ${styles["btn-secondary"]}`}
                  onClick={() => {
                    cancelGame(parseInt(gameId));
                    navigate('/play');
                  }}
                >
                  Cancel Game
                </button>
              </>
            ) : canJoin ? (
              <>
                <p>
                  <strong>{gameState.hostUsername || 'A player'}</strong> is waiting for an opponent.
                </p>
                <p>
                  Time Control: {gameState.timeControl ? `${gameState.timeControl} min` : 'No limit'}
                  {gameState.increment > 0 && ` + ${gameState.increment}s`}
                </p>
                <button 
                  className={`${styles.btn} ${styles["btn-primary"]}`}
                  onClick={handleJoinGame}
                >
                  Join Game
                </button>
              </>
            ) : (
              <>
                <p>You are already in this game or cannot join.</p>
                <Link to="/play" className={`${styles.btn} ${styles["btn-secondary"]}`}>
                  Back to Lobby
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active or completed game
  const player1 = gameState.players?.find(p => p.position === 1);
  const player2 = gameState.players?.find(p => p.position === 2);

  return (
    <div className={styles["live-game-container"]}>
      <div className={styles["game-header"]}>
        <div className={styles["game-title"]}>
          <h1>{gameState.gameType?.game_name || 'Game'}</h1>
          <div className={`${styles["game-status"]} ${styles[gameState.status]}`}>
            {gameState.status === 'active' ? 'In Progress' : 
             gameState.status === 'completed' ? 'Game Over' : 
             gameState.status === 'ready' ? 'Starting...' : gameState.status}
          </div>
        </div>
        <div className={styles["header-actions"]}>
          <Link to="/play" className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>

      <div className={styles["game-layout"]}>
        {/* Players Panel */}
        <div className={styles["players-panel"]}>
          {/* Player 1 */}
          <div className={`
            ${styles["player-card"]} 
            ${gameState.currentTurn === 1 && gameState.status === 'active' ? styles["current-turn"] : ''}
            ${gameState.winner === player1?.id ? styles.winner : ''}
          `}>
            <div className={styles["player-header"]}>
              <span className={styles["player-position"]}>Player 1</span>
              <span className={`${styles["player-indicator"]} ${gameState.currentTurn === 1 && gameState.status === 'active' ? styles.active : ''}`}></span>
            </div>
            <div className={`${styles["player-name"]} ${player1?.id === currentUser?.id ? styles.you : ''}`}>
              {player1?.username || 'Waiting...'}
              {player1?.id === currentUser?.id && ' (You)'}
            </div>
            {gameState.timeControl && (
              <div className={styles["player-time"]}>
                <div className={`${styles["time-value"]} ${gameState.playerTimes?.[player1?.id] < 60 ? styles["low-time"] : ''}`}>
                  {formatTime(gameState.playerTimes?.[player1?.id])}
                </div>
                <div className={styles["time-label"]}>Time</div>
              </div>
            )}
          </div>

          {/* Player 2 */}
          <div className={`
            ${styles["player-card"]} 
            ${gameState.currentTurn === 2 && gameState.status === 'active' ? styles["current-turn"] : ''}
            ${gameState.winner === player2?.id ? styles.winner : ''}
          `}>
            <div className={styles["player-header"]}>
              <span className={styles["player-position"]}>Player 2</span>
              <span className={`${styles["player-indicator"]} ${gameState.currentTurn === 2 && gameState.status === 'active' ? styles.active : ''}`}></span>
            </div>
            <div className={`${styles["player-name"]} ${player2?.id === currentUser?.id ? styles.you : ''}`}>
              {player2?.username || 'Waiting...'}
              {player2?.id === currentUser?.id && ' (You)'}
            </div>
            {gameState.timeControl && (
              <div className={styles["player-time"]}>
                <div className={`${styles["time-value"]} ${gameState.playerTimes?.[player2?.id] < 60 ? styles["low-time"] : ''}`}>
                  {formatTime(gameState.playerTimes?.[player2?.id])}
                </div>
                <div className={styles["time-label"]}>Time</div>
              </div>
            )}
          </div>
        </div>

        {/* Board Panel */}
        <div className={styles["board-panel"]}>
          <div className={styles["game-board-wrapper"]}>
            {renderBoard()}
          </div>
          
          {currentPlayer && gameState.status === 'active' && (
            <div className={styles["turn-indicator"]}>
              {isMyTurn ? (
                <span className={styles["your-turn"]}>Your turn!</span>
              ) : (
                <span className={styles["waiting-turn"]}>Waiting for opponent...</span>
              )}
            </div>
          )}
        </div>

        {/* Info Panel */}
        <div className={styles["info-panel"]}>
          {/* Move History */}
          <div className={styles["move-history"]}>
            <h3>Move History</h3>
            <div className={styles["moves-list"]}>
              {(gameState.moveHistory || []).map((move, index) => (
                <div key={index} className={styles["move-row"]}>
                  <span className={styles["move-number"]}>{Math.floor(index / 2) + 1}.</span>
                  <span className={index % 2 === 0 ? styles["move-white"] : styles["move-black"]}>
                    {`${String.fromCharCode(97 + move.from?.x)}${move.from?.y + 1} → ${String.fromCharCode(97 + move.to?.x)}${move.to?.y + 1}`}
                    {move.captured && ' ×'}
                  </span>
                </div>
              ))}
              {(!gameState.moveHistory || gameState.moveHistory.length === 0) && (
                <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                  No moves yet
                </div>
              )}
            </div>
          </div>

          {/* Game Controls */}
          {currentPlayer && gameState.status === 'active' && (
            <div className={styles["game-controls"]}>
              <h3>Actions</h3>
              <div className={styles["control-buttons"]}>
                <button 
                  className={`${styles.btn} ${styles["btn-danger"]}`}
                  onClick={handleResign}
                >
                  Resign
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Game Over Modal */}
      {showGameOver && gameOverData && (
        <div className={styles["game-over-overlay"]}>
          <div className={styles["game-over-modal"]}>
            <h2>Game Over</h2>
            <div className={`
              ${styles.result}
              ${gameOverData.winner === currentUser?.id ? styles.win : 
                gameOverData.winner ? styles.loss : styles.draw}
            `}>
              {gameOverData.winner === currentUser?.id ? 'You Won!' : 
               gameOverData.winner ? `${gameOverData.winnerUsername || 'Opponent'} Wins!` : 'Draw!'}
            </div>
            <div className={styles.reason}>
              {gameOverData.reason === 'checkmate' ? 'By Checkmate' :
               gameOverData.reason === 'resignation' ? 'By Resignation' :
               gameOverData.reason === 'timeout' ? 'By Timeout' :
               gameOverData.reason}
            </div>
            <div className={styles["game-over-actions"]}>
              <button 
                className={`${styles.btn} ${styles["btn-secondary"]}`}
                onClick={() => setShowGameOver(false)}
              >
                View Board
              </button>
              <button 
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handlePlayAgain}
              >
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveGame;
