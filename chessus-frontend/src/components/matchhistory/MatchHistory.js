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
    <div className={styles["match-history"]}>
      <h2 className={styles["section-title"]} onClick={() => setCollapsed(!collapsed)}>
        Match History
        <span className={`${styles["collapse-arrow"]} ${collapsed ? styles["collapsed"] : ''}`}>▼</span>
      </h2>
      
      {!collapsed && (
        <>
      <div className={styles["games-list"]}>
        {games.map((game) => {
          const opponent = getOpponent(game);
          // Find the profile owner's player record to get their position (1=white, 2=black).
          const me = game.players.find(p => p.id === parseInt(userId)) ||
            { id: parseInt(userId), username: username || 'You', elo: null, position: 1 };
          const myPosition = me.position ?? 1;
          const opponentPosition = myPosition === 1 ? 2 : 1;
          const isWin  = game.result === 'win';
          const isLoss = game.result === 'loss';

          return (
            <div
              key={game.id}
              className={`${styles["game-card"]} ${getResultClass(game.result)}`}
              onClick={() => handleViewGame(game.id)}
            >
              {/* ── Two player cards ── */}
              <div className={styles["players-vs"]}>
                {/* My card – always shown first */}
                <div className={`${styles["player-card"]} ${isWin ? styles["is-winner"] : ''}`}>
                  {isWin && <span className={styles["victory-icon"]}>🏆</span>}
                  <span className={styles["player-name-card"]}>{me.username || username}</span>
                  {me.elo != null && (
                    <span className={styles["player-elo-card"]}>({me.elo})</span>
                  )}
                  <span className={`${styles["player-color-icon"]} ${myPosition === 1 ? styles["white-piece"] : styles["black-piece"]}`}>
                    {myPosition === 1 ? '♔' : '♚'}
                  </span>
                </div>

                <span className={styles["vs-divider"]}>vs</span>

                {/* Opponent card */}
                <div className={`${styles["player-card"]} ${isLoss ? styles["is-winner"] : ''}`}>
                  {isLoss && <span className={styles["victory-icon"]}>🏆</span>}
                  {!opponent.isBot && !game.isBotGame && opponent.id !== 'bot' && typeof opponent.id === 'number' ? (
                    <Link
                      to={`/profile/${opponent.username}`}
                      className={styles["player-name-card-link"]}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {opponent.username}
                    </Link>
                  ) : (
                    <span className={styles["player-name-card"]}>{opponent.username}</span>
                  )}
                  {!opponent.isBot && opponent.elo != null && (
                    <span className={styles["player-elo-card"]}>({opponent.elo})</span>
                  )}
                  {game.isBotGame && (
                    <span className={styles["bot-badge"]}>BOT</span>
                  )}
                  <span className={`${styles["player-color-icon"]} ${opponentPosition === 1 ? styles["white-piece"] : styles["black-piece"]}`}>
                    {opponentPosition === 1 ? '♔' : '♚'}
                  </span>
                </div>
              </div>

              {/* ── Game details column ── */}
              <div className={styles["match-details"]}>
                <div className={styles["result-line"]}>
                  <span className={styles["result-text"]}>{getResultText(game.result)}</span>
                  <span className={styles["result-reason"]}>{getReasonText(game.reason)}</span>
                </div>
                <div className={styles["game-details"]}>
                  <span className={styles["game-type"]}>{game.gameTypeName || "Custom Game"}</span>
                  <span className={styles["time-control"]}>{formatTimeControl(game.timeControl, game.increment)}</span>
                </div>
              </div>

              {/* ── Date / ELO ── */}
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
