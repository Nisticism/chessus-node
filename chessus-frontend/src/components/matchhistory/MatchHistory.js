import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import styles from "./matchhistory.module.scss";
import API_URL from "../../global/global";
import { parseServerDate } from "../../helpers/date-formatter";

const MatchHistory = ({ userId, username }) => {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [collapsed, setCollapsed] = useState(true);
  const navigate = useNavigate();

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (userId) {
      fetchMatchHistory();
    }
  }, [userId, page]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const fetchMatchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}users/${userId}/match-history`, {
        params: { page, limit: 10 }
      });
      setGames(response.data.games);
      setPagination(response.data.pagination);
    } catch (err) {
      console.error("Error fetching match history:", err);
      setError("Failed to load match history");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = parseServerDate(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTimeControl = (seconds, increment) => {
    if (!seconds) return "Unlimited";
    const minutes = Math.floor(seconds / 60);
    if (increment) {
      return `${minutes}+${increment}`;
    }
    return `${minutes} min`;
  };

  const getResultClass = (result) => {
    switch (result) {
      case 'win': return styles.win;
      case 'loss': return styles.loss;
      case 'draw': return styles.draw;
      default: return '';
    }
  };

  const getResultText = (result) => {
    switch (result) {
      case 'win': return 'Victory';
      case 'loss': return 'Defeat';
      case 'draw': return 'Draw';
      default: return 'Unknown';
    }
  };

  const getReasonText = (reason) => {
    switch (reason) {
      case 'capture': return 'by capture';
      case 'checkmate': return 'by checkmate';
      case 'resignation': return 'by resignation';
      case 'timeout': return 'by timeout';
      case 'disconnect': return 'by disconnect';
      case 'stalemate': return 'by stalemate';
      case 'promotion': return 'by promotion';
      case 'piece_count': return 'by piece count';
      case 'draw_move_limit': return 'by move limit';
      case 'repetition': return 'by repetition';
      case 'agreement': return 'by agreement';
      case 'equal_piece_count': return 'by equal piece count';
      case 'no_legal_moves': return 'by no legal moves';
      case 'no_moves': return 'by no legal moves';
      case 'control': return 'by square control';
      case 'elimination': return 'by elimination';
      case 'insufficient_material': return 'by insufficient material';
      case 'lose_all_pieces': return 'by anti-chess';
      case 'stalemate_win': return 'by stalemate win';
      case 'initial_position': return 'by initial position (no rating change)';
      case 'cancellation_draw': return 'draw by cancellations';
      case 'simultaneous_capture_draw': return 'draw by simultaneous capture';
      case 'simultaneous_checkmate_draw': return 'draw by simultaneous checkmate';
      default: return '';
    }
  };

  const getOpponent = (game) => {
    if (game.isBotGame) {
      const diffLabel = game.botDifficulty
        ? game.botDifficulty.charAt(0).toUpperCase() + game.botDifficulty.slice(1)
        : "Medium";
      return { username: `Computer (${diffLabel})`, elo: null, isBot: true };
    }
    const opponent = game.players.find(p => p.id !== parseInt(userId));
    if (!opponent) return { username: "Unknown", elo: "?" };
    // Defense-in-depth: if the opponent record itself is the bot sentinel
    // (id === 'bot' or non-numeric id), mark it as a bot so we never render
    // a profile link for a computer player.
    if (opponent.id === 'bot' || typeof opponent.id !== 'number') {
      return { ...opponent, isBot: true };
    }
    return opponent;
  };

  const handleViewGame = (gameId) => {
    // Pass the profile owner's user id so the match view can orient the board
    // with that player on the bottom (even when the current viewer wasn't a participant).
    if (userId) {
      navigate(`/match/${gameId}?viewerUserId=${userId}`);
    } else {
      navigate(`/match/${gameId}`);
    }
  };

  if (loading && games.length === 0) {
    return (
      <div className={styles["match-history"]}>
        <h2 className={styles["section-title"]} onClick={() => setCollapsed(!collapsed)}>
          Match History
          <span className={`${styles["collapse-arrow"]} ${collapsed ? styles["collapsed"] : ''}`}>▼</span>
        </h2>
        {!collapsed && <div className={styles["loading"]}>Loading match history...</div>}
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles["match-history"]}>
        <h2 className={styles["section-title"]} onClick={() => setCollapsed(!collapsed)}>
          Match History
          <span className={`${styles["collapse-arrow"]} ${collapsed ? styles["collapsed"] : ''}`}>▼</span>
        </h2>
        {!collapsed && <div className={styles["error"]}>{error}</div>}
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className={styles["match-history"]}>
        <h2 className={styles["section-title"]} onClick={() => setCollapsed(!collapsed)}>
          Match History
          <span className={`${styles["collapse-arrow"]} ${collapsed ? styles["collapsed"] : ''}`}>▼</span>
        </h2>
        {!collapsed && (
          <div className={styles["empty-state"]}>
            <p>No completed games yet.</p>
            <p className={styles["empty-hint"]}>Play some games to build your match history!</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles["match-history"]} id="match-history">
      <h2 className={styles["section-title"]} onClick={() => setCollapsed(!collapsed)}>
        Match History
        <span className={`${styles["collapse-arrow"]} ${collapsed ? styles["collapsed"] : ''}`}>▼</span>
      </h2>
      
      {!collapsed && (
        <>
      <div className={styles["games-list"]}>
        {games.map((game) => {
          // Identify player 1 (position 1) and player 2 (position 2).
          // player1 is shown in the "vs" line first; player 2 second.
          const p1 = game.players.find(p => p.position === 1);
          const p2 = game.players.find(p => p.position === 2);

          // For bot games, fill whichever slot is missing.
          const opponent = getOpponent(game);
          const player1 = p1 || (opponent.position === 1 ? { ...opponent, position: 1 } : null);
          const player2 = p2 || (opponent.position === 2 ? { ...opponent, position: 2 } : opponent);

          // Determine which player corresponds to the profile owner so we can
          // show result labels relative to them.
          const meIsP1 = player1 && player1.id === parseInt(userId);

          return (
            <div
              key={game.id}
              className={`${styles["game-card"]} ${getResultClass(game.result)}`}
              onClick={() => handleViewGame(game.id)}
            >
              <div className={styles["game-result"]}>
                <span className={styles["result-text"]}>{getResultText(game.result)}</span>
                <span className={styles["result-reason"]}>{getReasonText(game.reason)}</span>
              </div>

              <div className={styles["game-info"]}>
                <div className={styles["opponent-info"]}>
                  {/* Player 1 */}
                  {player1 && (
                    <>
                      {player1.id !== 'bot' && !game.isBotGame && typeof player1.id === 'number' ? (
                        <Link to={`/profile/${player1.username}`} className={styles["opponent-name-link"]} onClick={(e) => e.stopPropagation()}>
                          {player1.username}
                        </Link>
                      ) : (
                        <span className={styles["opponent-name"]}>{player1.username}</span>
                      )}
                      {!player1.isBot && (
                        <span className={styles["opponent-elo"]}>({player1.elo || "?"})</span>
                      )}
                      <span className={`${styles["color-icon"]} ${styles["white-piece"]}`} title="Player 1 (White)">♔</span>
                    </>
                  )}

                  <span className={styles["vs-text"]}>vs</span>

                  {/* Player 2 */}
                  {player2 && (
                    <>
                      {player2.id !== 'bot' && !game.isBotGame && typeof player2.id === 'number' ? (
                        <Link to={`/profile/${player2.username}`} className={styles["opponent-name-link"]} onClick={(e) => e.stopPropagation()}>
                          {player2.username}
                        </Link>
                      ) : (
                        <span className={styles["opponent-name"]}>{player2.username}</span>
                      )}
                      {!player2.isBot && (
                        <span className={styles["opponent-elo"]}>({player2.elo || "?"})</span>
                      )}
                      {game.isBotGame && (
                        <span className={styles["bot-badge"]}>BOT</span>
                      )}
                      <span className={`${styles["color-icon"]} ${styles["black-piece"]}`} title="Player 2 (Black)">♚</span>
                    </>
                  )}
                </div>
                <div className={styles["game-details"]}>
                  <span className={styles["game-type"]}>{game.gameTypeName || "Custom Game"}</span>
                  <span className={styles["time-control"]}>{formatTimeControl(game.timeControl, game.increment)}</span>
                </div>
              </div>

              <div className={styles["game-meta"]}>
                <span className={styles["game-date"]}>{formatDate(game.endTime)}</span>
                {game.eloChanges && (
                  <span className={`${styles["elo-change"]} ${game.result === 'win' ? styles["positive"] : styles["negative"]}`}>
                    {game.eloChanges.winner?.id === parseInt(userId)
                      ? `+${game.eloChanges.winner?.change}`
                      : game.eloChanges.loser?.change}
                  </span>
                )}
              </div>

              <div className={styles["view-arrow"]}>→</div>
            </div>
          );
        })}
      </div>

      {pagination.totalPages > 1 && (
        <div className={styles["pagination"]}>
          <button 
            className={styles["page-btn"]}
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            ← Previous
          </button>
          <span className={styles["page-info"]}>
            Page {page} of {pagination.totalPages}
          </span>
          <button 
            className={styles["page-btn"]}
            disabled={page === pagination.totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default MatchHistory;
