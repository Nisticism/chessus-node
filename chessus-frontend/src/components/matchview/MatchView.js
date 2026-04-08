import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import styles from "./matchview.module.scss";
import API_URL from "../../global/global";
import { colToFile, rowToRank, formatMoveNotation, replayToMove } from "../../helpers/pieceMovementUtils";

import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import { parseServerDate } from "../../helpers/date-formatter";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";

const MatchView = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [reviewMoveIndex, setReviewMoveIndex] = useState(null);

  useEffect(() => {
    fetchMatch();
    fetchChatHistory();
  }, [gameId]);

  // Keyboard navigation for review mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (reviewMoveIndex === null || !match?.moveHistory) return;
      const totalMoves = match.moveHistory.length;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setReviewMoveIndex(prev => prev > 0 ? prev - 1 : prev);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setReviewMoveIndex(prev => prev < totalMoves - 1 ? prev + 1 : null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setReviewMoveIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reviewMoveIndex, match?.moveHistory]);

  const fetchChatHistory = async () => {
    try {
      const response = await axios.get(`${API_URL}games/${gameId}/chat`);
      setChatHistory(response.data.messages || []);
    } catch (err) {
      // Chat history is optional, don't show error
    }
  };

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
    const date = parseServerDate(dateString);
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
    
    // Flip the board so the current user's side is at the bottom
    const userPlayer = currentUser && match.players?.find(p => p.id === currentUser.id);
    const shouldFlip = userPlayer?.position === 2;
    
    // Use replayed pieces when reviewing, otherwise show final position
    const isReviewing = reviewMoveIndex !== null && match.initialPieces;
    const pieces = isReviewing
      ? replayToMove(match.initialPieces, match.moveHistory, reviewMoveIndex)
      : (Array.isArray(match.pieces) ? match.pieces : []);
    const lastMove = isReviewing ? match.moveHistory[reviewMoveIndex] : null;

    for (let displayY = 0; displayY < boardHeight; displayY++) {
      for (let displayX = 0; displayX < boardWidth; displayX++) {
        // Convert display coordinates to game coordinates (matches LiveGame toGameCoords)
        const x = shouldFlip ? (boardWidth - 1 - displayX) : displayX;
        const y = shouldFlip ? (boardHeight - 1 - displayY) : displayY;
        // Multi-tile aware: find piece whose footprint covers this square
        const piece = pieces.find(p => {
          if (!p || p.captured) return false;
          const pw = p.piece_width || 1;
          const ph = p.piece_height || 1;
          return x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph;
        });
        const isAnchor = piece && piece.x === x && piece.y === y;
        const isLight = (x + y) % 2 === 0;
        const isLastMoveFrom = lastMove && lastMove.from && lastMove.from.x === x && lastMove.from.y === y;
        const isLastMoveTo = lastMove && lastMove.to && lastMove.to.x === x && lastMove.to.y === y;

        squares.push(
          <div
            key={`${x}-${y}`}
            className={`${styles["board-square"]} ${isLight ? styles["light"] : styles["dark"]}${isLastMoveFrom || isLastMoveTo ? ` ${styles["last-move"]}` : ''}`}
            style={isAnchor && ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) ? { zIndex: 10 } : undefined}
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
                left: 0
              } : {};
              const pieceImageUrl = (piece.image || piece.image_url) ? 
                ((piece.image || piece.image_url).startsWith('http') ? (piece.image || piece.image_url) : `${ASSET_URL}${piece.image || piece.image_url}`) : null;
              return (
              <div className={`${styles["piece"]} ${piece.player_id === 1 || piece.team === 1 ? styles["player1"] : styles["player2"]}`} style={multiTileStyle}>
                {pieceImageUrl ? (
                  isNonSquareMultiTile ? (
                    <div
                      ref={(el) => applySvgStretchBackground(el, pieceImageUrl)}
                      style={{
                        width: '100%',
                        height: '100%',
                      }}
                    />
                  ) : (
                    <img 
                      src={pieceImageUrl}
                      alt={piece.piece_name || piece.name || "Piece"}
                      className={styles["piece-image"]}
                      draggable={false}
                    />
                  )
                ) : (
                  <span className={styles["piece-symbol"]}>
                    {(piece.player_id === 1 || piece.team === 1) ? '♙' : '♟'}
                  </span>
                )}
              </div>
              );
            })()}
          </div>
        );
      }
    }

    // Generate file labels (a, b, c, ... for columns)
    const fileLabels = [];
    for (let i = 0; i < boardWidth; i++) {
      const fileIndex = shouldFlip ? (boardWidth - 1 - i) : i;
      fileLabels.push(
        <div key={`file-${i}`} className={styles["file-label"]}>
          {colToFile(fileIndex)}
        </div>
      );
    }

    // Generate rank labels (1, 2, 3, ... for rows)
    const rankLabels = [];
    for (let i = 0; i < boardHeight; i++) {
      const rankIndex = shouldFlip ? i : (boardHeight - 1 - i);
      rankLabels.push(
        <div key={`rank-${i}`} className={styles["rank-label"]}>
          {rowToRank(rankIndex)}
        </div>
      );
    }

    return (
      <div className={styles["board-with-coords"]}>
        {/* Rank labels (numbers on the left) */}
        <div 
          className={styles["rank-labels"]}
          style={{
            gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`
          }}
        >
          {rankLabels}
        </div>
        
        {/* Board and file labels */}
        <div className={styles["board-and-files"]}>
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
          
          {/* File labels (letters at the bottom) */}
          <div 
            className={styles["file-labels"]}
            style={{
              gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`
            }}
          >
            {fileLabels}
          </div>
        </div>
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
          <h3 className={styles["board-title"]}>
            {reviewMoveIndex !== null ? `Move ${reviewMoveIndex + 1} of ${match.moveHistory?.length || 0}` : 'Final Position'}
          </h3>
          {reviewMoveIndex !== null && (
            <div className={styles["review-controls"]}>
              <button onClick={() => setReviewMoveIndex(0)} disabled={reviewMoveIndex === 0}>⏮</button>
              <button onClick={() => setReviewMoveIndex(prev => Math.max(0, prev - 1))} disabled={reviewMoveIndex === 0}>◀</button>
              <button onClick={() => setReviewMoveIndex(prev => prev < (match.moveHistory?.length || 1) - 1 ? prev + 1 : prev)} disabled={reviewMoveIndex === (match.moveHistory?.length || 1) - 1}>▶</button>
              <button onClick={() => setReviewMoveIndex(null)}>⏭ Final</button>
            </div>
          )}
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
              {(() => {
                const moves = match.moveHistory;
                const bh = match.boardHeight || 8;
                const canReview = !!match.initialPieces;
                const rows = [];
                for (let i = 0; i < moves.length; i += 2) {
                  const p1Move = moves[i];
                  const p2Move = moves[i + 1] || null;
                  rows.push(
                    <div key={i} className={styles["move-row"]}>
                      <span className={styles["move-number"]}>{Math.floor(i / 2) + 1}.</span>
                      <span 
                        className={`${styles["move-item"]} ${styles["move-white"]}${reviewMoveIndex === i ? ` ${styles["active-move"]}` : ''}`}
                        onClick={() => canReview && setReviewMoveIndex(reviewMoveIndex === i ? null : i)}
                        style={{ cursor: canReview ? 'pointer' : 'default' }}
                      >
                        {formatMoveNotation(p1Move, true, bh)}
                      </span>
                      <span 
                        className={`${styles["move-item"]} ${styles["move-black"]}${reviewMoveIndex === i + 1 ? ` ${styles["active-move"]}` : ''}`}
                        onClick={() => p2Move && canReview && setReviewMoveIndex(reviewMoveIndex === i + 1 ? null : i + 1)}
                        style={{ cursor: p2Move && canReview ? 'pointer' : 'default' }}
                      >
                        {p2Move ? formatMoveNotation(p2Move, true, bh) : ''}
                      </span>
                    </div>
                  );
                }
                return rows;
              })()}
            </div>
          </div>
        )}

        {/* Chat History */}
        {chatHistory.length > 0 && (
          <div className={styles["chat-history"]}>
            <h3>💬 Game Chat</h3>
            <div className={styles["chat-history-list"]}>
              {chatHistory.map((msg, idx) => (
                <div key={msg.id || idx} className={styles["chat-history-msg"]}>
                  <span className={styles["chat-history-sender"]}>{msg.sender_username}:</span>
                  <span className={styles["chat-history-text"]}>{msg.content}</span>
                  <span className={styles["chat-history-time"]}>
                    {parseServerDate(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
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
