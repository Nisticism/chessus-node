import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import { useSocket } from "../../contexts/SocketContext";
import { getGames } from "../../actions/games";
import styles from "./play.module.scss";

const Play = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { gamesList } = useSelector((state) => state.games);
  
  const { 
    connected, 
    openGames, 
    fetchOpenGames, 
    createGame, 
    joinGame,
    onGameEvent 
  } = useSocket();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGameType, setSelectedGameType] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [timeControl, setTimeControl] = useState("10"); // minutes
  const [increment, setIncrement] = useState("0"); // seconds
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState(null);

  // Fetch game types on mount
  useEffect(() => {
    dispatch(getGames());
  }, [dispatch]);

  // Fetch open games when connected
  useEffect(() => {
    if (connected) {
      fetchOpenGames();
    }
  }, [connected, fetchOpenGames]);

  // Listen for game events
  useEffect(() => {
    const unsubscribePlayerJoined = onGameEvent("playerJoined", ({ gameId, gameState }) => {
      // Refresh open games list when someone joins a game
      fetchOpenGames();
    });

    const unsubscribeGameCancelled = onGameEvent("gameCancelled", ({ gameId }) => {
      // Refresh open games list when a game is cancelled
      fetchOpenGames();
    });

    return () => {
      unsubscribePlayerJoined();
      unsubscribeGameCancelled();
    };
  }, [onGameEvent, fetchOpenGames]);

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
        increment: incrementSeconds
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
                      </div>
                    </div>
                  );
                })}
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

                <div className={styles["host-game-section"]}>
                  <h3>Host a Match</h3>
                  <p style={{ color: '#888', marginBottom: '16px' }}>
                    Create a match and wait for an opponent to join. You can customize the time controls.
                  </p>
                  <button
                    className={`${styles.btn} ${styles["btn-primary"]}`}
                    onClick={() => setShowCreateModal(true)}
                    disabled={!connected}
                  >
                    Create Match
                  </button>
                </div>
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