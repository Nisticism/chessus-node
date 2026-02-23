import React, { useState, useEffect, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useSocket } from "../../contexts/SocketContext";
import { getGames } from "../../actions/games";
import { getOnlineFriends, setOnlineUsers } from "../../actions/friends";
import authHeader from "../../services/auth-header";
import axios from "../../services/axios-interceptor";
import styles from "./play.module.scss";
import FriendsList from "../../components/friendslist/FriendsList";

const Play = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { gamesList } = useSelector((state) => state.games);
  const { onlineFriends } = useSelector((state) => state.friends);
  
  const { 
    connected, 
    socket,
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
  const [showPieceHelpers, setShowPieceHelpers] = useState(true);
  const [rated, setRated] = useState(true);
  const [allowPremoves, setAllowPremoves] = useState(true);
  const [startingMode, setStartingMode] = useState("none");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState(null);
  const [deletingGameId, setDeletingGameId] = useState(null);
  
  // Challenge system state
  const [challengedUserId, setChallengedUserId] = useState(null);
  const [challengedUsername, setChallengedUsername] = useState("");
  const [modalGameSearch, setModalGameSearch] = useState("");
  const [pendingChallenges, setPendingChallenges] = useState([]);
  const [gameDeletedMessage, setGameDeletedMessage] = useState(null);

  // Pagination state
  const PAGE_SIZE = 16;
  const [friendsPage, setFriendsPage] = useState(1);
  const [openGamesPage, setOpenGamesPage] = useState(1);
  const [ongoingGamesPage, setOngoingGamesPage] = useState(1);

  // Check for game deleted message on mount
  useEffect(() => {
    const message = sessionStorage.getItem('gameDeletedMessage');
    if (message) {
      setGameDeletedMessage(message);
      sessionStorage.removeItem('gameDeletedMessage');
      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => setGameDeletedMessage(null), 8000);
      return () => clearTimeout(timer);
    }
  }, []);

  const redirectToLogin = (message) => {
    navigate('/login', { state: { message } });
  };

  // Fetch game types on mount
  useEffect(() => {
    dispatch(getGames());
  }, [dispatch]);

  // Handle incoming challenge navigation from profile pages
  useEffect(() => {
    if (location.state?.openChallengeFor && selectedGameType) {
      const { id, username } = location.state.openChallengeFor;
      setChallengedUserId(id);
      setChallengedUsername(username);
      setShowCreateModal(true);
      // Clear the navigation state to prevent re-opening modal
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, selectedGameType, navigate, location.pathname]);

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

  // Parse allowed starting modes from the selected game type
  const allowedStartingModes = useMemo(() => {
    if (!selectedGameType?.randomized_starting_positions) {
      // Default: all modes allowed for legacy game types
      return ['none', 'backrow', 'mirrored', 'independent', 'shared', 'full'];
    }
    try {
      const parsed = JSON.parse(selectedGameType.randomized_starting_positions);
      if (parsed?.allowedModes && Array.isArray(parsed.allowedModes)) {
        return parsed.allowedModes;
      }
      // Legacy: single mode
      if (parsed?.mode) {
        return [parsed.mode];
      }
    } catch (e) {
      console.error("Error parsing randomized_starting_positions:", e);
    }
    return ['none'];
  }, [selectedGameType]);

  // Reset starting mode when game type changes
  useEffect(() => {
    if (allowedStartingModes.length > 0) {
      // Use first allowed mode as default
      setStartingMode(allowedStartingModes[0]);
    }
  }, [allowedStartingModes]);

  // Fetch open games when connected
  useEffect(() => {
    if (connected) {
      fetchOpenGames();
      fetchOngoingGames();
    }
  }, [connected, fetchOpenGames, fetchOngoingGames]);

  // Fetch online friends when user is logged in
  useEffect(() => {
    if (currentUser && connected) {
      dispatch(getOnlineFriends(currentUser.id));
    }
  }, [currentUser, connected, dispatch]);

  // Listen for online users updates from socket
  useEffect(() => {
    if (socket) {
      socket.on("onlineUsers", (users) => {
        dispatch(setOnlineUsers(users));
        // Refresh online friends when online users change
        if (currentUser) {
          dispatch(getOnlineFriends(currentUser.id));
        }
      });

      return () => {
        socket.off("onlineUsers");
      };
    }
  }, [socket, dispatch, currentUser]);

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

  // Listen for incoming friend challenges
  useEffect(() => {
    if (!socket) return;

    const handleFriendChallenge = ({ gameId, gameState, hostUsername }) => {
      setPendingChallenges(prev => [...prev, {
        gameId,
        gameState,
        hostUsername,
        timestamp: Date.now()
      }]);
    };

    socket.on('friendChallenge', handleFriendChallenge);

    return () => {
      socket.off('friendChallenge', handleFriendChallenge);
    };
  }, [socket]);

  // Remove stale challenges (older than 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      setPendingChallenges(prev => prev.filter(c => c.timestamp > fiveMinutesAgo));
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Open create modal in challenge mode
  const openChallengeModal = (friendId, friendUsername) => {
    if (!currentUser) {
      redirectToLogin("Please log in to challenge friends to a game.");
      return;
    }
    setChallengedUserId(friendId);
    setChallengedUsername(friendUsername);
    setModalGameSearch("");
    setShowCreateModal(true);
  };

  // Close modal and reset challenge state
  const closeCreateModal = () => {
    setShowCreateModal(false);
    setChallengedUserId(null);
    setChallengedUsername("");
    setModalGameSearch("");
  };

  // Accept an incoming challenge
  const acceptChallenge = async (challenge) => {
    if (!currentUser) {
      redirectToLogin("Please log in to accept and join challenge games.");
      return;
    }
    try {
      await joinGame(challenge.gameId);
      setPendingChallenges(prev => prev.filter(c => c.gameId !== challenge.gameId));
      navigate(`/play/${challenge.gameId}`);
    } catch (err) {
      setError(err.message || "Failed to join challenge");
    }
  };

  // Decline a challenge
  const declineChallenge = (gameId) => {
    setPendingChallenges(prev => prev.filter(c => c.gameId !== gameId));
  };

  // Filter game types by search
  const filteredGameTypes = gamesList.filter(game => 
    game.game_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter game types for modal search
  const modalFilteredGameTypes = modalGameSearch.trim() 
    ? gamesList.filter(game => 
        game.game_name?.toLowerCase().includes(modalGameSearch.toLowerCase())
      )
    : [];

  // Get win condition description for a game type
  const getWinCondition = (gameType) => {
    if (!gameType) return "Unknown";
    const conditions = [];
    if (gameType.mate_condition) conditions.push("Checkmate");
    if (gameType.capture_condition) conditions.push("Capture");
    if (gameType.value_condition) conditions.push(gameType.value_title || "Points");
    if (gameType.squares_condition) conditions.push("Territory");
    if (gameType.hill_condition) conditions.push("King of the Hill");
    return conditions.length > 0 ? conditions.join(" / ") : "Standard";
  };

  // Get piece count per player from pieces_string
  const getPieceCounts = (gameType) => {
    if (gameType?.pieces_string) {
      try {
        const pieces = JSON.parse(gameType.pieces_string);
        // Count pieces for each player
        const player1Count = pieces.filter(p => p.player_number === 1).length;
        const player2Count = pieces.filter(p => p.player_number === 2).length;
        if (player1Count > 0 || player2Count > 0) {
          return { player1: player1Count, player2: player2Count, equal: player1Count === player2Count };
        }
      } catch {
        // Fall through to starting_piece_count
      }
    }
    // Fallback to starting_piece_count (total pieces / 2 assumes equal distribution)
    if (gameType?.starting_piece_count) {
      const perPlayer = Math.floor(gameType.starting_piece_count / 2);
      return { player1: perPlayer, player2: perPlayer, equal: true };
    }
    return null;
  };

  // Format piece count display
  const formatPieceCount = (gameType) => {
    const counts = getPieceCounts(gameType);
    if (!counts) return null;
    if (counts.equal) {
      return `${counts.player1} pieces each`;
    }
    return `White: ${counts.player1} / Black: ${counts.player2}`;
  };

  // Paginated data
  const paginatedFriends = useMemo(() => {
    if (!onlineFriends) return [];
    const start = (friendsPage - 1) * PAGE_SIZE;
    return onlineFriends.slice(start, start + PAGE_SIZE);
  }, [onlineFriends, friendsPage]);

  const paginatedOpenGames = useMemo(() => {
    const start = (openGamesPage - 1) * PAGE_SIZE;
    return openGames.slice(start, start + PAGE_SIZE);
  }, [openGames, openGamesPage]);

  const paginatedOngoingGames = useMemo(() => {
    const start = (ongoingGamesPage - 1) * PAGE_SIZE;
    return ongoingGames.slice(start, start + PAGE_SIZE);
  }, [ongoingGames, ongoingGamesPage]);

  // Total pages for each section
  const totalFriendsPages = Math.ceil((onlineFriends?.length || 0) / PAGE_SIZE);
  const totalOpenGamesPages = Math.ceil(openGames.length / PAGE_SIZE);
  const totalOngoingGamesPages = Math.ceil(ongoingGames.length / PAGE_SIZE);
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
    if (!currentUser) {
      redirectToLogin("Please log in to host a game.");
      return;
    }
    if (!selectedGameType) return;
    
    setIsCreating(true);
    setError(null);
    
    try {
      const timeControlMinutes = timeControl === "0" ? null : parseInt(timeControl);
      const incrementSeconds = parseInt(increment) || 0;
      
      const gameData = {
        gameTypeId: selectedGameType.id,
        timeControl: timeControlMinutes,
        increment: incrementSeconds,
        allowSpectators,
        showPieceHelpers,
        rated,
        allowPremoves,
        startingMode
      };

      // Add challenge data if challenging a friend
      if (challengedUserId) {
        gameData.challengedUserId = challengedUserId;
      }
      
      const result = await createGame(gameData);

      closeCreateModal();
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
    if (!currentUser) {
      redirectToLogin("Please log in to join a game.");
      return;
    }
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
      await axios.delete(`${API_URL}/api/admin/games/${gameId}`, {
        headers: authHeader()
      });

      // Refresh game lists
      fetchOpenGames();
      fetchOngoingGames();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to delete game");
    } finally {
      setDeletingGameId(null);
    }
  };

  // Check if user is admin or owner
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || currentUser?.role?.toLowerCase() === 'owner';

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

      {!currentUser && (
        <div className={styles["error-message"]}>
          Guest mode: you can browse open and ongoing matches, but you must log in to host, join, or challenge.
        </div>
      )}

      {gameDeletedMessage && (
        <div className={styles["info-message"]}>
          {gameDeletedMessage}
          <button 
            className={styles["dismiss-btn"]} 
            onClick={() => setGameDeletedMessage(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
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
          {/* Incoming Challenges Section */}
          {pendingChallenges.length > 0 && (
            <div className={styles["incoming-challenges-section"]}>
              <h2>
                Incoming Challenges
                <span className={styles["match-count"]}>{pendingChallenges.length}</span>
              </h2>
              <div className={styles["challenges-list"]}>
                {pendingChallenges.map((challenge) => (
                  <div key={challenge.gameId} className={styles["challenge-card"]}>
                    <div className={styles["challenge-info"]}>
                      <span className={styles["challenger-name"]}>{challenge.hostUsername}</span>
                      <span className={styles["challenge-text"]}>challenged you!</span>
                      <span className={styles["challenge-game"]}>
                        {challenge.gameState.gameType?.name || 'Game'}
                      </span>
                    </div>
                    <div className={styles["challenge-actions"]}>
                      <button
                        className={`${styles.btn} ${styles["btn-success"]} ${styles["btn-small"]}`}
                        onClick={() => acceptChallenge(challenge)}
                      >
                        Accept
                      </button>
                      <button
                        className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}
                        onClick={() => declineChallenge(challenge.gameId)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected Game Type Section - Compact View */}
          <div className={styles["selected-game-section-compact"]}>
            {!selectedGameType ? (
              <div className={styles["no-selection"]}>
                Select a game type to host a match
              </div>
            ) : (
              <div className={styles["selected-game-compact"]}>
                <div className={styles["game-info-compact"]}>
                  <h3>{selectedGameType.game_name}</h3>
                  <div className={styles["game-stats"]}>
                    <span className={styles["stat-item"]}>
                      <span className={styles["stat-icon"]}>⊞</span>
                      {selectedGameType.board_width}×{selectedGameType.board_height}
                    </span>
                    <span className={styles["stat-divider"]}>•</span>
                    <span className={styles["stat-item"]}>
                      <span className={styles["stat-icon"]}>⚔</span>
                      {selectedGameType.player_count || 2} players
                    </span>
                    {formatPieceCount(selectedGameType) && (
                      <>
                        <span className={styles["stat-divider"]}>•</span>
                        <span className={styles["stat-item"]}>
                          <span className={styles["stat-icon"]}>♟</span>
                          {formatPieceCount(selectedGameType)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className={styles["game-stats-line2"]}>
                    <span className={styles["win-condition"]}>
                      <span className={styles["win-label"]}>Win Condition:</span> {getWinCondition(selectedGameType)}
                    </span>
                    {selectedGameType.creator_username && (
                      <span className={styles["creator"]}>
                        <span className={styles["stat-divider"]}>•</span>
                        by {selectedGameType.creator_username}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className={`${styles.btn} ${styles["btn-primary"]}`}
                  onClick={() => {
                    if (!currentUser) {
                      redirectToLogin("Please log in to host a game.");
                      return;
                    }
                    setShowCreateModal(true);
                  }}
                  disabled={!connected}
                >
                  Host Game
                </button>
              </div>
            )}
          </div>

          {/* Online Friends Section */}
          {currentUser && onlineFriends && onlineFriends.length > 0 && (
            <div className={styles["online-friends-section"]}>
              <h2>
                Online Friends
                <span className={styles["match-count"]}>{onlineFriends.length}</span>
              </h2>
              <div className={styles["friends-compact-list"]}>
                <FriendsList 
                  userId={currentUser.id} 
                  showOnlineOnly={true}
                  socket={socket}
                  friendsOverride={paginatedFriends}
                  onChallenge={openChallengeModal}
                />
              </div>
              {totalFriendsPages > 1 && (
                <div className={styles["pagination"]}>
                  <button
                    disabled={friendsPage === 1}
                    onClick={() => setFriendsPage(p => p - 1)}
                    className={styles["pagination-btn"]}
                  >
                    ← Prev
                  </button>
                  <span className={styles["pagination-info"]}>
                    {friendsPage} / {totalFriendsPages}
                  </span>
                  <button
                    disabled={friendsPage >= totalFriendsPages}
                    onClick={() => setFriendsPage(p => p + 1)}
                    className={styles["pagination-btn"]}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}

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
              <>
                <div className={styles["open-matches-list"]}>
                  {paginatedOpenGames.map((game) => {
                    const isOwnGame = currentUser ? game.host_id === currentUser.id : false;
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
                              {isJoining ? "Joining..." : currentUser ? "Join Game" : "Sign in to Join"}
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
                {totalOpenGamesPages > 1 && (
                  <div className={styles["pagination"]}>
                    <button
                      disabled={openGamesPage === 1}
                      onClick={() => setOpenGamesPage(p => p - 1)}
                      className={styles["pagination-btn"]}
                    >
                      ← Prev
                    </button>
                    <span className={styles["pagination-info"]}>
                      {openGamesPage} / {totalOpenGamesPages}
                    </span>
                    <button
                      disabled={openGamesPage >= totalOpenGamesPages}
                      onClick={() => setOpenGamesPage(p => p + 1)}
                      className={styles["pagination-btn"]}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
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
              <>
                <div className={styles["ongoing-games-list"]}>
                  {paginatedOngoingGames.map((game) => (
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
                {totalOngoingGamesPages > 1 && (
                  <div className={styles["pagination"]}>
                    <button
                      disabled={ongoingGamesPage === 1}
                      onClick={() => setOngoingGamesPage(p => p - 1)}
                      className={styles["pagination-btn"]}
                    >
                      ← Prev
                    </button>
                    <span className={styles["pagination-info"]}>
                      {ongoingGamesPage} / {totalOngoingGamesPages}
                    </span>
                    <button
                      disabled={ongoingGamesPage >= totalOngoingGamesPages}
                      onClick={() => setOngoingGamesPage(p => p + 1)}
                      className={styles["pagination-btn"]}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create Game Modal */}
      {showCreateModal && currentUser && (
        <div className={styles["modal-overlay"]} onClick={closeCreateModal}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <h2>
              {challengedUserId 
                ? `Challenge ${challengedUsername}` 
                : `Create Match: ${selectedGameType?.game_name}`}
            </h2>
            
            {/* Challenge indicator */}
            {challengedUserId && (
              <div className={styles["challenge-indicator"]}>
                <span>⚔️ Private challenge - only {challengedUsername} can join</span>
              </div>
            )}

            {/* Game Type Search */}
            <div className={styles["form-group"]}>
              <label>Game Type</label>
              <div className={styles["game-type-selector"]}>
                <div className={styles["selected-game-display"]}>
                  {selectedGameType ? (
                    <>
                      <span className={styles["game-name"]}>{selectedGameType.game_name}</span>
                      <span className={styles["game-size"]}>
                        {selectedGameType.board_width}×{selectedGameType.board_height}
                      </span>
                    </>
                  ) : (
                    <span className={styles["no-game"]}>Select a game type</span>
                  )}
                </div>
                <div className={styles["game-search-wrapper"]}>
                  <input
                    type="text"
                    placeholder="Search for different game..."
                    value={modalGameSearch}
                    onChange={(e) => setModalGameSearch(e.target.value)}
                    className={styles["game-search-input"]}
                  />
                  {modalGameSearch && modalFilteredGameTypes.length > 0 && (
                    <div className={styles["game-search-results"]}>
                      {modalFilteredGameTypes.slice(0, 5).map((game) => (
                        <div
                          key={game.id}
                          className={`${styles["game-search-item"]} ${selectedGameType?.id === game.id ? styles.selected : ''}`}
                          onClick={() => {
                            setSelectedGameType(game);
                            setModalGameSearch("");
                          }}
                        >
                          <span className={styles["game-name"]}>{game.game_name}</span>
                          <span className={styles["game-size"]}>
                            {game.board_width}×{game.board_height}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
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

            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
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

            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
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

            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
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

            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
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

            {/* Starting Position Mode Selection */}
            {allowedStartingModes.length === 1 ? (
              <div className={styles["form-group"]}>
                <label>Starting Position Mode</label>
                <div className={styles["starting-mode-badge"]}>
                  {{
                    'none': 'Fixed Positions',
                    'backrow': 'Back Row Randomized (Chess960)',
                    'mirrored': 'Full Mirrored Random',
                    'independent': 'Independent Random',
                    'shared': 'Shared Squares Random',
                    'full': 'Full Board Random'
                  }[allowedStartingModes[0]] || allowedStartingModes[0]}
                </div>
              </div>
            ) : allowedStartingModes.length > 1 && (
              <div className={styles["form-group"]}>
                <label>Starting Position Mode</label>
                <select
                  value={startingMode}
                  onChange={(e) => setStartingMode(e.target.value)}
                >
                  {allowedStartingModes.includes('none') && (
                    <option value="none">Fixed Positions</option>
                  )}
                  {allowedStartingModes.includes('backrow') && (
                    <option value="backrow">Back Row Randomized (Chess960)</option>
                  )}
                  {allowedStartingModes.includes('mirrored') && (
                    <option value="mirrored">Full Mirrored Random</option>
                  )}
                  {allowedStartingModes.includes('independent') && (
                    <option value="independent">Independent Random</option>
                  )}
                  {allowedStartingModes.includes('shared') && (
                    <option value="shared">Shared Squares Random</option>
                  )}
                  {allowedStartingModes.includes('full') && (
                    <option value="full">Full Board Random</option>
                  )}
                </select>
              </div>
            )}

            <div className={styles["modal-actions"]}>
              <button
                className={`${styles.btn} ${styles["btn-secondary"]}`}
                onClick={closeCreateModal}
              >
                Cancel
              </button>
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handleCreateGame}
                disabled={isCreating || !selectedGameType}
              >
                {isCreating 
                  ? "Creating..." 
                  : challengedUserId 
                    ? "Send Challenge" 
                    : "Create Match"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Play;