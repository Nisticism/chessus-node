import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useSocket } from "../../contexts/SocketContext";
import { getGames } from "../../actions/games";
import authHeader from "../../services/auth-header";
import styles from "./play.module.scss";

const Play = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { gamesList } = useSelector((state) => state.games);
  
  const { 
    connected, 
    openGames,
    ongoingGames,
    fetchOpenGames,
    fetchOngoingGames,
    createGame, 
    joinGame,
    onGameEvent 
  } = useSocket();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGameType, setSelectedGameType] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [timeControl, setTimeControl] = useState("10"); // minutes
  const [increment, setIncrement] = useState("0"); // seconds
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [showPieceHelpers, setShowPieceHelpers] = useState(false);
  const [rated, setRated] = useState(true);
  const [allowPremoves, setAllowPremoves] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState(null);
  const [deletingGameId, setDeletingGameId] = useState(null);

  // Fetch game types on mount
  useEffect(() => {
    dispatch(getGames());
  }, [dispatch]);

  // Select game type from URL parameter or last played game
  useEffect(() => {
    if (gamesList?.length > 0) {
      // Check for URL parameter first
      const gameTypeIdParam = searchParams.get('gameTypeId');
      if (gameTypeIdParam) {
        const gameFromParam = gamesList.find(g => g.id === parseInt(gameTypeIdParam));
        if (gameFromParam) {
          setSelectedGameType(gameFromParam);
          return;
        }
      }
      
      // Fall back to last played game
      const lastPlayedGameTypeId = localStorage.getItem('lastPlayedGameType');
      if (lastPlayedGameTypeId) {
        const lastGame = gamesList.find(g => g.id === parseInt(lastPlayedGameTypeId));
        if (lastGame) {
          setSelectedGameType(lastGame);
        }
      }
    }
  }, [gamesList, searchParams]);

  // Fetch open games when connected
  useEffect(() => {
    if (connected) {
      fetchOpenGames();
      fetchOngoingGames();
    }
  }, [connected, fetchOpenGames, fetchOngoingGames]);

  // Listen for game events
  useEffect(() => {
    const unsubscribePlayerJoined = onGameEvent("playerJoined", ({ gameId, gameState }) => {
      // Refresh both lists when someone joins a game
      fetchOpenGames();
      fetchOngoingGames();
    });

    const unsubscribeGameCancelled = onGameEvent("gameCancelled", ({ gameId }) => {
      // Refresh open games list when a game is cancelled
      fetchOpenGames();
    });

    const unsubscribeGameOver = onGameEvent("gameOver", ({ gameId }) => {
      // Refresh ongoing games when a game ends
      fetchOngoingGames();
    });

    return () => {
      unsubscribePlayerJoined();
      unsubscribeGameCancelled();
      unsubscribeGameOver();
    };
  }, [onGameEvent, fetchOpenGames, fetchOngoingGames]);

  // Filter game types by search
  const filteredGameTypes = gamesList.filter(game => 
    game.game_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Format time control for display
  const formatTimeControl = (minutes, inc) => {
    if (!minutes || minutes === 0) return "No limit";
    if (inc && inc > 0) {
      return `${minutes} min + ${inc}s`;
    }
    return `${minutes} min`;
  };

  // Handle creating a new game
  const handleCreateGame = async () => {
    if (!selectedGameType) return;
    
    setIsCreating(true);
    setError(null);
    
    try {
      const timeControlMinutes = timeControl === "0" ? null : parseInt(timeControl);
      const incrementSeconds = parseInt(increment) || 0;
      
      const result = await createGame({
        gameTypeId: selectedGameType.id,
        timeControl: timeControlMinutes,
        increment: incrementSeconds,
        allowSpectators,
        showPieceHelpers,
        rated,
        allowPremoves
      });

      setShowCreateModal(false);
      // Navigate to the game page where host can wait and still browse
      navigate(`/play/${result.gameId}`);
    } catch (err) {
      setError(err.message || "Failed to create game");
    } finally {
      setIsCreating(false);
    }
  };

  // Handle joining a game
  const handleJoinGame = async (gameId) => {
    setIsJoining(true);
    setError(null);

    try {
      await joinGame(gameId);
      navigate(`/play/${gameId}`);
    } catch (err) {
      setError(err.message || "Failed to join game");
    } finally {
      setIsJoining(false);
    }
  };

  // Handle admin deleting a bugged game
  const handleDeleteGame = async (gameId) => {
    if (!window.confirm("Are you sure you want to delete this game? This action cannot be undone. Player ELO will not be affected.")) {
      return;
    }

    setDeletingGameId(gameId);
    setError(null);

    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_URL}/api/admin/games/${gameId}`, {
        method: 'DELETE',
        headers: {
          ...authHeader(),
          'Content-Type': 'application/json'
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to delete game');
      }

      // Refresh game lists
      fetchOpenGames();
      fetchOngoingGames();
    } catch (err) {
      setError(err.message || "Failed to delete game");
    } finally {
      setDeletingGameId(null);
    }
  };

  // Check if user is admin or owner
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || currentUser?.role?.toLowerCase() === 'owner';

  // If not logged in, show login prompt
  if (!currentUser) {
    return (
      <div className={styles["play-container"]}>
        <div className={styles["play-header"]}>
          <h1>Play</h1>
        </div>
        <div className={styles["must-login"]}>
          <h2>Login Required</h2>
          <p>You need to be logged in to play games.</p>
          <div className={styles["login-buttons"]}>
            <Link to="/login" className={`${styles.btn} ${styles["btn-primary"]}`}>
              Login
            </Link>
            <Link to="/register" className={`${styles.btn} ${styles["btn-secondary"]}`}>
              Register
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["play-container"]}>
      <div className={styles["play-header"]}>
        <h1>Play</h1>
        <div className={styles["connection-status"]}>
          <span className={`${styles["status-dot"]} ${connected ? styles.connected : ''}`}></span>
          {connected ? "Connected" : "Connecting..."}
        </div>
      </div>

      {error && (
        <div className={styles["error-message"]}>{error}</div>
      )}

      <div className={styles["play-content"]}>
        {/* Sidebar - Game Types */}
        <div className={styles["game-types-sidebar"]}>
          <h2>Game Types</h2>
          <div className={styles["search-box"]}>
            <input
              type="text"
              placeholder="Search games..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className={styles["game-types-list"]}>
            {filteredGameTypes.length === 0 ? (
              <div className={styles["no-games-message"]}>
                {searchTerm ? "No games match your search" : "No game types available"}
              </div>
            ) : (
              filteredGameTypes.map((game) => (
                <div
                  key={game.id}
                  className={`${styles["game-type-item"]} ${selectedGameType?.id === game.id ? styles.selected : ''}`}
                  onClick={() => setSelectedGameType(game)}
                >
                  <div className={styles["game-type-name"]}>{game.game_name}</div>
                  <div className={styles["game-type-info"]}>
                    {game.board_width}x{game.board_height} • {game.player_count || 2} players
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className={styles["main-content"]}>
          {/* Open Matches Section */}
          <div className={styles["open-matches-section"]}>
            <h2>
              Open Matches
              {openGames.length > 0 && (
                <span className={styles["match-count"]}>{openGames.length}</span>
              )}
            </h2>
            
            {openGames.length === 0 ? (
              <div className={styles["no-matches"]}>
                No open matches. Create one or wait for someone to host!
              </div>
            ) : (
              <div className={styles["open-matches-list"]}>
                {openGames.map((game) => {
                  const isOwnGame = game.host_id === currentUser.id;
                  return (
                    <div 
                      key={game.id || game.gameId} 
                      className={`${styles["open-match-card"]} ${isOwnGame ? styles["own-game"] : ''}`}
                    >
                      <div className={styles["match-header"]}>
                        <span className={styles["match-game-name"]}>
                          {game.game_name || game.gameTypeName}
                        </span>
                        <span className={styles["match-time-control"]}>
                          {formatTimeControl(game.turn_length || game.timeControl, game.increment)}
                        </span>
                      </div>
                      <div className={styles["match-host"]}>
                        {isOwnGame ? (
                          <span className={styles["your-game"]}>Your Game</span>
                        ) : (
                          <>Hosted by <span>{game.host_username || game.hostUsername}</span></>
                        )}
                      </div>
                      <div className={styles["match-actions"]}>
                        {isOwnGame ? (
                          <button
                            className={`${styles.btn} ${styles["btn-primary"]} ${styles["btn-small"]}`}
                            onClick={() => navigate(`/play/${game.id || game.gameId}`)}
                          >
                            Return to Game
                          </button>
                        ) : (
                          <button
                            className={`${styles.btn} ${styles["btn-success"]} ${styles["btn-small"]}`}
                            onClick={() => handleJoinGame(game.id || game.gameId)}
                            disabled={isJoining}
                          >
                            {isJoining ? "Joining..." : "Join Game"}
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            className={`${styles.btn} ${styles["btn-danger"]} ${styles["btn-small"]}`}
                            onClick={() => handleDeleteGame(game.id || game.gameId)}
                            disabled={deletingGameId === (game.id || game.gameId)}
                            title="Delete bugged game (admin only)"
                          >
                            {deletingGameId === (game.id || game.gameId) ? "Deleting..." : "🗑️"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ongoing Games Section */}
          <div className={styles["ongoing-games-section"]}>
            <h2>
              Ongoing Games
              {ongoingGames.length > 0 && (
                <span className={styles["match-count"]}>{ongoingGames.length}</span>
              )}
            </h2>
            
            {ongoingGames.length === 0 ? (
              <div className={styles["no-matches"]}>
                No ongoing games to watch right now.
              </div>
            ) : (
              <div className={styles["ongoing-games-list"]}>
                {ongoingGames.map((game) => (
                  <div 
                    key={game.id} 
                    className={styles["ongoing-game-card"]}
                  >
                    <div className={styles["match-header"]}>
                      <span className={styles["match-game-name"]}>
                        {game.game_name}
                      </span>
                      <span className={styles["match-time-control"]}>
                        {formatTimeControl(game.turn_length, game.increment)}
                      </span>
                    </div>
                    <div className={styles["match-players"]}>
                      {game.player_names}
                    </div>
                    <div className={styles["match-actions"]}>
                      <button
                        className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}
                        onClick={() => navigate(`/play/${game.id}`)}
                      >
                        {game.player_ids?.includes(currentUser?.id) ? 'Re-join' : 'Watch'}
                      </button>
                      {isAdmin && (
                        <button
                          className={`${styles.btn} ${styles["btn-danger"]} ${styles["btn-small"]}`}
                          onClick={() => handleDeleteGame(game.id)}
                          disabled={deletingGameId === game.id}
                          title="Delete bugged game (admin only)"
                        >
                          {deletingGameId === game.id ? "Deleting..." : "🗑️"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selected Game Type Section */}
          <div className={styles["selected-game-section"]}>
            {!selectedGameType ? (
              <div className={styles["no-selection"]}>
                Select a game type from the sidebar to host a match
              </div>
            ) : (
              <>
                <div className={styles["selected-game-header"]}>
                  <div className={styles["selected-game-title"]}>
                    <h2>{selectedGameType.game_name}</h2>
                    {selectedGameType.creator_username && (
                      <div className={styles["game-creator"]}>
                        by {selectedGameType.creator_username}
                      </div>
                    )}
                  </div>
                  <button
                    className={`${styles.btn} ${styles["btn-primary"]}`}
                    onClick={() => setShowCreateModal(true)}
                    disabled={!connected}
                  >
                    Host Game
                  </button>
                </div>

                <div className={styles["game-details"]}>
                  <div className={styles["detail-item"]}>
                    <div className={styles["detail-label"]}>Board Size</div>
                    <div className={styles["detail-value"]}>
                      {selectedGameType.board_width} × {selectedGameType.board_height}
                    </div>
                  </div>
                  <div className={styles["detail-item"]}>
                    <div className={styles["detail-label"]}>Players</div>
                    <div className={styles["detail-value"]}>
                      {selectedGameType.player_count || 2}
                    </div>
                  </div>
                  <div className={styles["detail-item"]}>
                    <div className={styles["detail-label"]}>Actions per Turn</div>
                    <div className={styles["detail-value"]}>
                      {selectedGameType.actions_per_turn || 1}
                    </div>
                  </div>
                </div>

                {selectedGameType.descript && (
                  <div className={styles["game-description"]}>
                    {selectedGameType.descript}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create Game Modal */}
      {showCreateModal && (
        <div className={styles["modal-overlay"]} onClick={() => setShowCreateModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <h2>Create Match: {selectedGameType?.game_name}</h2>
            
            <div className={styles["form-group"]}>
              <label>Time Control (minutes per player)</label>
              <select 
                value={timeControl} 
                onChange={(e) => setTimeControl(e.target.value)}
              >
                <option value="0">No time limit</option>
                <option value="1">1 minute (Bullet)</option>
                <option value="3">3 minutes (Blitz)</option>
                <option value="5">5 minutes (Blitz)</option>
                <option value="10">10 minutes (Rapid)</option>
                <option value="15">15 minutes (Rapid)</option>
                <option value="30">30 minutes (Classical)</option>
                <option value="60">60 minutes (Classical)</option>
              </select>
            </div>

            {timeControl !== "0" && (
              <div className={styles["form-group"]}>
                <label>Increment (seconds per move)</label>
                <select 
                  value={increment} 
                  onChange={(e) => setIncrement(e.target.value)}
                >
                  <option value="0">No increment</option>
                  <option value="1">+1 second</option>
                  <option value="2">+2 seconds</option>
                  <option value="3">+3 seconds</option>
                  <option value="5">+5 seconds</option>
                  <option value="10">+10 seconds</option>
                </select>
                <div className={styles["input-hint"]}>
                  Time added to your clock after each move
                </div>
              </div>
            )}

            <div className={styles["form-group"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={rated}
                  onChange={(e) => setRated(e.target.checked)}
                />
                <span>Rated Game</span>
              </label>
              <div className={styles["input-hint"]}>
                Game results will affect player ELO ratings
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={allowPremoves}
                  onChange={(e) => setAllowPremoves(e.target.checked)}
                />
                <span>Allow Premoves</span>
              </label>
              <div className={styles["input-hint"]}>
                Players can queue moves during opponent's turn
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={showPieceHelpers}
                  onChange={(e) => setShowPieceHelpers(e.target.checked)}
                />
                <span>Show Movement Helpers</span>
              </label>
              <div className={styles["input-hint"]}>
                Display movement and attack highlighting when selecting pieces
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={allowSpectators}
                  onChange={(e) => setAllowSpectators(e.target.checked)}
                />
                <span>Allow Spectators</span>
              </label>
              <div className={styles["input-hint"]}>
                Let other players watch this game
              </div>
            </div>

            <div className={styles["modal-actions"]}>
              <button
                className={`${styles.btn} ${styles["btn-secondary"]}`}
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handleCreateGame}
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create Match"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Play;