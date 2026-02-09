import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import styles from "./matchview.module.scss";
import API_URL from "../../global/global";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";

const MatchView = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMatch();
  }, [gameId]);

  const fetchMatch = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}match/${gameId}`);
      setMatch(response.data);
    } catch (err) {
      console.error("Error fetching match:", err);
      setError(err.response?.data?.message || "Failed to load match");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (startTime, endTime) => {
    if (!startTime || !endTime) return "N/A";
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);
    return `${diffMins}m ${diffSecs}s`;
  };

  const formatTimeControl = (seconds, increment) => {
    if (!seconds) return "Unlimited";
    const minutes = Math.floor(seconds / 60);
    if (increment) {
      return `${minutes}+${increment}`;
    }
    return `${minutes} minutes`;
  };

  const getReasonText = (reason) => {
    switch (reason) {
      case 'capture': return 'All pieces captured';
      case 'checkmate': return 'Checkmate';
      case 'resignation': return 'Resignation';
      case 'timeout': return 'Time ran out';
      case 'stalemate': return 'Stalemate';
      default: return 'Game completed';
    }
  };

  const getResultForPlayer = (playerId) => {
    if (!match) return 'unknown';
    if (!match.winnerId) return 'draw';
    return match.winnerId === playerId ? 'win' : 'loss';
  };

  const renderBoard = () => {
    if (!match || !match.pieces) return null;

    const boardWidth = match.boardWidth || 8;
    const boardHeight = match.boardHeight || 8;
    // Calculate square size to keep squares square
    const squareSize = Math.min(60, 480 / Math.max(boardWidth, boardHeight));
    const squares = [];
    const pieces = Array.isArray(match.pieces) ? match.pieces : [];

    for (let y = boardHeight; y >= 1; y--) {
      for (let x = 1; x <= boardWidth; x++) {
        const piece = pieces.find(p => p && p.x === x && p.y === y && !p.captured);
        const isLight = (x + y) % 2 === 1;

        squares.push(
          <div
            key={`${x}-${y}`}
            className={`${styles["board-square"]} ${isLight ? styles["light"] : styles["dark"]}`}
          >
            {piece && (
              <div className={`${styles["piece"]} ${piece.player_id === 1 || piece.team === 1 ? styles["player1"] : styles["player2"]}`}>
                {(piece.image || piece.image_url) ? (
                  <img 
                    src={(piece.image || piece.image_url).startsWith('http') ? (piece.image || piece.image_url) : `${ASSET_URL}${piece.image || piece.image_url}`}
                    alt={piece.piece_name || piece.name || "Piece"}
                    className={styles["piece-image"]}
                    draggable={false}
                  />
                ) : (
                  <span className={styles["piece-symbol"]}>
                    {(piece.player_id === 1 || piece.team === 1) ? '♙' : '♟'}
                  </span>
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
          gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`,
          gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`,
          width: 'fit-content',
          aspectRatio: 'unset'
        }}
      >
        {squares}
      </div>
    );
  };

  if (loading) {
    return (
      <div className={styles["match-view-container"]}>
        <div className={styles["loading"]}>Loading match...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles["match-view-container"]}>
        <div className={styles["error-container"]}>
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/play" className={styles["back-link"]}>Back to Lobby</Link>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className={styles["match-view-container"]}>
        <div className={styles["error-container"]}>
          <h2>Match Not Found</h2>
          <p>This match doesn't exist.</p>
          <Link to="/play" className={styles["back-link"]}>Back to Lobby</Link>
        </div>
      </div>
    );
  }

  const player1 = match.players?.find(p => p.position === 1);
  const player2 = match.players?.find(p => p.position === 2);
  const winner = match.players?.find(p => p.id === match.winnerId);
  const isUserInGame = currentUser && match.players?.some(p => p.id === currentUser.id);
  const userResult = isUserInGame ? getResultForPlayer(currentUser.id) : null;

  return (
    <div className={styles["match-view-container"]}>
      {/* Result Banner */}
      <div className={`${styles["result-banner"]} ${styles[userResult || 'neutral']}`}>
        {userResult === 'win' && (
          <>
            <h1>🎉 Victory!</h1>
            <p>You won by {getReasonText(match.reason).toLowerCase()}</p>
          </>
        )}
        {userResult === 'loss' && (
          <>
            <h1>Defeat</h1>
            <p>{winner?.username || 'Opponent'} won by {getReasonText(match.reason).toLowerCase()}</p>
          </>
        )}
        {userResult === 'draw' && (
          <>
            <h1>Draw</h1>
            <p>The game ended in a draw</p>
          </>
        )}
        {!isUserInGame && (
          <>
            <h1>Game Complete</h1>
            <p>{winner ? `${winner.username} won by ${getReasonText(match.reason).toLowerCase()}` : 'The game ended in a draw'}</p>
          </>
        )}
      </div>

      <div className={styles["match-content"]}>
        {/* Players Panel */}
        <div className={styles["players-panel"]}>
          {/* Player 1 */}
          <div className={`${styles["player-card"]} ${match.winnerId === player1?.id ? styles["winner"] : ""}`}>
            <div className={styles["player-avatar"]}>
              {player1?.profilePicture ? (
                <img src={`${ASSET_URL}${player1.profilePicture}`} alt={player1.username} />
              ) : (
                <span>{player1?.username?.charAt(0).toUpperCase() || "?"}</span>
              )}
            </div>
            <div className={styles["player-info"]}>
              <Link to={`/profile/${player1?.username}`} className={styles["player-name"]}>
                {player1?.username || "Player 1"}
              </Link>
              <span className={styles["player-elo"]}>ELO: {player1?.elo || "?"}</span>
              {match.eloChanges && player1 && (
                <span className={`${styles["elo-change"]} ${match.winnerId === player1.id ? styles["positive"] : styles["negative"]}`}>
                  {match.winnerId === player1.id 
                    ? `+${match.eloChanges.winner?.change || 0}` 
                    : `${match.eloChanges.loser?.change || 0}`}
                </span>
              )}
            </div>
            {match.winnerId === player1?.id && (
              <div className={styles["winner-badge"]}>👑</div>
            )}
          </div>

          <div className={styles["vs-divider"]}>VS</div>

          {/* Player 2 */}
          <div className={`${styles["player-card"]} ${match.winnerId === player2?.id ? styles["winner"] : ""}`}>
            <div className={styles["player-avatar"]}>
              {player2?.profilePicture ? (
                <img src={`${ASSET_URL}${player2.profilePicture}`} alt={player2.username} />
              ) : (
                <span>{player2?.username?.charAt(0).toUpperCase() || "?"}</span>
              )}
            </div>
            <div className={styles["player-info"]}>
              <Link to={`/profile/${player2?.username}`} className={styles["player-name"]}>
                {player2?.username || "Player 2"}
              </Link>
              <span className={styles["player-elo"]}>ELO: {player2?.elo || "?"}</span>
              {match.eloChanges && player2 && (
                <span className={`${styles["elo-change"]} ${match.winnerId === player2.id ? styles["positive"] : styles["negative"]}`}>
                  {match.winnerId === player2.id 
                    ? `+${match.eloChanges.winner?.change || 0}` 
                    : `${match.eloChanges.loser?.change || 0}`}
                </span>
              )}
            </div>
            {match.winnerId === player2?.id && (
              <div className={styles["winner-badge"]}>👑</div>
            )}
          </div>
        </div>

        {/* Board */}
        <div className={styles["board-container"]}>
          <h3 className={styles["board-title"]}>Final Position</h3>
          {renderBoard()}
        </div>

        {/* Game Details */}
        <div className={styles["game-details"]}>
          <h3>Game Details</h3>
          <div className={styles["details-grid"]}>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Game Type</span>
              <span className={styles["detail-value"]}>{match.gameTypeName || "Custom Game"}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Time Control</span>
              <span className={styles["detail-value"]}>{formatTimeControl(match.timeControl, match.increment)}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Result</span>
              <span className={styles["detail-value"]}>{getReasonText(match.reason)}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Moves Played</span>
              <span className={styles["detail-value"]}>{match.moveHistory?.length || 0}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Date</span>
              <span className={styles["detail-value"]}>{formatDate(match.endTime)}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Duration</span>
              <span className={styles["detail-value"]}>{formatDuration(match.startTime, match.endTime)}</span>
            </div>
          </div>
        </div>

        {/* Move History (optional, can be expanded later) */}
        {match.moveHistory && match.moveHistory.length > 0 && (
          <div className={styles["move-history"]}>
            <h3>Move History</h3>
            <div className={styles["moves-list"]}>
              {match.moveHistory.map((move, index) => (
                <span key={index} className={styles["move-item"]}>
                  {index + 1}. {move.from?.x},{move.from?.y} → {move.to?.x},{move.to?.y}
                  {move.captured && " ✕"}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className={styles["actions"]}>
          <button 
            className={styles["action-btn"]}
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>
          <Link to="/play" className={styles["action-btn-primary"]}>
            Play Again
          </Link>
        </div>
      </div>
    </div>
  );
};

export default MatchView;
