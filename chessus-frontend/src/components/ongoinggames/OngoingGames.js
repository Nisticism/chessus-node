import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import styles from "./ongoing-games.module.scss";
import API_URL from "../../global/global";

const OngoingGames = ({ userId, currentUserId }) => {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (userId) {
      fetchOngoingGames();
    }
  }, [userId]);

  const fetchOngoingGames = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}users/${userId}/ongoing-games`);
      setGames(response.data.games);
    } catch (err) {
      console.error("Error fetching ongoing games:", err);
      setError("Failed to load ongoing games");
    } finally {
      setLoading(false);
    }
  };

  const formatTimeControl = (timeControl, increment) => {
    if (!timeControl) return "No limit";
    if (increment && increment > 0) return `${timeControl} min + ${increment}s`;
    return `${timeControl} min`;
  };

  const formatCorrespondenceDays = (days) => {
    if (!days) return "1 day/move";
    if (days === 1) return "1 day/move";
    if (days === 7) return "1 week/move";
    if (days === 14) return "2 weeks/move";
    return `${days} days/move`;
  };

  const getStatusLabel = (status) => {
    if (status === "waiting") return "Waiting for opponent";
    if (status === "ready") return "Ready to start";
    return "In progress";
  };

  const getOpponent = (game) => {
    if (!game.players || game.players.length < 2) return null;
    return game.players.find(p => p.id !== parseInt(userId)) || null;
  };

  const handleJoin = (gameId) => {
    navigate(`/play/${gameId}`);
  };

  if (loading) {
    return (
      <div className={styles["ongoing-games"]}>
        <div className={styles["loading"]}>Loading ongoing games...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles["ongoing-games"]}>
        <div className={styles["error"]}>{error}</div>
      </div>
    );
  }

  const liveGames = games.filter(g => !g.isCorrespondence);
  const correspondenceGames = games.filter(g => g.isCorrespondence);

  if (games.length === 0) {
    return (
      <div className={styles["ongoing-games"]}>
        <div className={styles["empty-state"]}>No ongoing games.</div>
      </div>
    );
  }

  return (
    <div className={styles["ongoing-games"]}>
      {/* Live / Rapid / Classical Games */}
      {liveGames.length > 0 && (
        <div className={styles["games-section"]}>
          <h3 className={styles["section-label"]}>⚡ Live Games</h3>
          <div className={styles["games-list"]}>
            {liveGames.map(game => {
              const opponent = getOpponent(game);
              const isParticipant = game.players.some(p => p.id === parseInt(currentUserId));
              return (
                <div key={game.id} className={styles["game-card"]}>
                  <div className={styles["game-info"]}>
                    <span className={styles["game-type"]}>{game.gameTypeName || "Custom Game"}</span>
                    <span className={styles["time-control"]}>{formatTimeControl(game.timeControl, game.increment)}</span>
                  </div>
                  <div className={styles["players"]}>
                    {opponent ? (
                      <span className={styles["vs-line"]}>
                        vs <span className={styles["opponent"]}>{opponent.username}</span>
                        {opponent.elo && <span className={styles["elo"]}>({opponent.elo})</span>}
                      </span>
                    ) : (
                      <span className={styles["waiting"]}>{getStatusLabel(game.status)}</span>
                    )}
                  </div>
                  <button
                    className={styles["join-btn"]}
                    onClick={() => handleJoin(game.id)}
                  >
                    {isParticipant ? (game.status === "waiting" ? "Return" : "Play") : "Watch"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Correspondence / Daily Games */}
      {correspondenceGames.length > 0 && (
        <div className={styles["games-section"]}>
          <h3 className={styles["section-label"]}>📬 Correspondence Games</h3>
          <div className={styles["games-list"]}>
            {correspondenceGames.map(game => {
              const opponent = getOpponent(game);
              const isParticipant = game.players.some(p => p.id === parseInt(currentUserId));
              return (
                <div key={game.id} className={`${styles["game-card"]} ${styles["correspondence"]}`}>
                  <div className={styles["game-info"]}>
                    <span className={styles["game-type"]}>{game.gameTypeName || "Custom Game"}</span>
                    <span className={styles["time-control"]}>{formatCorrespondenceDays(game.correspondenceDays)}</span>
                  </div>
                  <div className={styles["players"]}>
                    {opponent ? (
                      <span className={styles["vs-line"]}>
                        vs <span className={styles["opponent"]}>{opponent.username}</span>
                        {opponent.elo && <span className={styles["elo"]}>({opponent.elo})</span>}
                      </span>
                    ) : (
                      <span className={styles["waiting"]}>{getStatusLabel(game.status)}</span>
                    )}
                  </div>
                  <button
                    className={`${styles["join-btn"]} ${styles["join-btn-correspondence"]}`}
                    onClick={() => handleJoin(game.id)}
                  >
                    {isParticipant ? (game.status === "waiting" ? "Return" : "Make Move") : "View"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default OngoingGames;
