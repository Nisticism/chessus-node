import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import styles from "./matchhistory.module.scss";
import API_URL from "../../global/global";

const MatchHistory = ({ userId, username }) => {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    if (userId) {
      fetchMatchHistory();
    }
  }, [userId, page]);

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
    const date = new Date(dateString);
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
    return opponent || { username: "Unknown", elo: "?" };
  };

  const handleViewGame = (gameId) => {
    navigate(`/match/${gameId}`);
  };

  if (loading && games.length === 0) {
    return (
      <div className={styles["match-history"]}>
        <h2 className={styles["section-title"]}>Match History</h2>
        <div className={styles["loading"]}>Loading match history...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles["match-history"]}>
        <h2 className={styles["section-title"]}>Match History</h2>
        <div className={styles["error"]}>{error}</div>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className={styles["match-history"]}>
        <h2 className={styles["section-title"]}>Match History</h2>
        <div className={styles["empty-state"]}>
          <p>No completed games yet.</p>
          <p className={styles["empty-hint"]}>Play some games to build your match history!</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["match-history"]}>
      <h2 className={styles["section-title"]}>Match History</h2>
      
      <div className={styles["games-list"]}>
        {games.map((game) => {
          const opponent = getOpponent(game);
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
                  <span className={styles["vs-text"]}>vs</span>
                  <span className={styles["opponent-name"]}>{opponent.username}</span>
                  {!opponent.isBot && (
                    <span className={styles["opponent-elo"]}>({opponent.elo || "?"})</span>
                  )}
                  {game.isBotGame && (
                    <span className={styles["bot-badge"]}>BOT</span>
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
    </div>
  );
};

export default MatchHistory;
