import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import ListFilterBar from "../common/ListFilterBar";
import styles from "./ongoing-games.module.scss";
import API_URL from "../../global/global";

const OngoingGames = ({ userId }) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const currentUserId = currentUser?.id;
  const [games, setGames] = useState([]);
  const [query, setQuery] = useState('');
  const [turnFilter, setTurnFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (userId) {
      fetchOngoingGames();
    }
  }, [userId]);
  /* eslint-enable react-hooks/exhaustive-deps */

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

  /*
   * The list belongs to the profile being viewed, so the turn filter is about
   * THEM, not about whoever is reading the page. The buttons stay viewer-
   * relative (they say "Watch" when you are not in the game); this does not,
   * or "waiting on them" would mean nothing on someone else's profile.
   */
  const listOwnerId = userId || currentUserId;
  const isOwnProfile = String(listOwnerId) === String(currentUserId);

  /*
   * Whose move it is, by the same reading the buttons below use: in a
   * simultaneous game you are "to move" until you have submitted, otherwise it
   * is whichever seat matches playerTurn.
   */
  const isMyTurn = (game) => {
    const myIdNum = parseInt(listOwnerId);
    if (!game.players?.some(p => p.id === myIdNum)) return false;
    if (game.simultaneousTurns) {
      return !(Array.isArray(game.simulSubmittedPlayerIds)
        && game.simulSubmittedPlayerIds.some(id => Number(id) === myIdNum));
    }
    const myPos = game.players.findIndex(p => p.id === myIdNum) + 1;
    return !!game.playerTurn && myPos > 0 && game.playerTurn === myPos;
  };

  const matchesFilters = (game) => {
    const q = query.trim().toLowerCase();
    if (q) {
      const opponent = getOpponent(game);
      const haystack = [game.gameTypeName, opponent?.username]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (turnFilter === 'mine') return game.status === 'active' && isMyTurn(game);
    if (turnFilter === 'theirs') return game.status === 'active' && !isMyTurn(game);
    if (turnFilter === 'waiting') return game.status !== 'active';
    return true;
  };

  const visibleGames = games.filter(matchesFilters);
  const liveGames = visibleGames.filter(g => !g.isCorrespondence);
  const correspondenceGames = visibleGames.filter(g => g.isCorrespondence);

  if (games.length === 0) {
    return (
      <div className={styles["ongoing-games"]}>
        <div className={styles["empty-state"]}>No ongoing games.</div>
      </div>
    );
  }

  return (
    <div className={styles["ongoing-games"]}>
      <ListFilterBar
        total={games.length}
        shown={visibleGames.length}
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by game or opponent"
        filters={[
          { value: 'all', label: 'All games' },
          { value: 'mine', label: isOwnProfile ? 'Your turn' : 'Their turn' },
          { value: 'theirs', label: "Opponent's turn" },
          { value: 'waiting', label: 'Not started' },
        ]}
        filter={turnFilter}
        onFilterChange={setTurnFilter}
        label="games"
      />

      {visibleGames.length === 0 && (
        <div className={styles["empty-state"]}>No games match that search.</div>
      )}

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
                    {isParticipant
                      ? game.status === "waiting"
                        ? "Return"
                        : (() => {
                            if (game.simultaneousTurns) {
                              const myIdNum = parseInt(currentUserId);
                              const submitted = Array.isArray(game.simulSubmittedPlayerIds) &&
                                game.simulSubmittedPlayerIds.some(id => Number(id) === myIdNum);
                              return submitted ? 'Move Submitted' : 'Make Move';
                            }
                            const myPos = game.players.findIndex(p => p.id === parseInt(currentUserId)) + 1;
                            return game.playerTurn && myPos > 0 && game.playerTurn === myPos
                              ? 'Make Move'
                              : "Opponent's Turn";
                          })()
                      : "Watch"}
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
                    {isParticipant
                      ? game.status === "waiting"
                        ? "Return"
                        : (() => {
                            if (game.simultaneousTurns) {
                              const myIdNum = parseInt(currentUserId);
                              const submitted = Array.isArray(game.simulSubmittedPlayerIds) &&
                                game.simulSubmittedPlayerIds.some(id => Number(id) === myIdNum);
                              return submitted ? 'Move Submitted' : 'Make Move';
                            }
                            const myPos = game.players.findIndex(p => p.id === parseInt(currentUserId)) + 1;
                            return game.playerTurn && myPos > 0 && game.playerTurn === myPos
                              ? 'Make Move'
                              : "Opponent's Turn";
                          })()
                      : "View"}
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
