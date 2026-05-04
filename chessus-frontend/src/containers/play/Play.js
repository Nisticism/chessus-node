import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useSearchParams, useLocation, Link } from "react-router-dom";
import { useSocket } from "../../contexts/SocketContext";
import { getGames, getGameById } from "../../actions/games";
import { getOnlineFriends, setOnlineUsers, getFriends } from "../../actions/friends";
import authHeader from "../../services/auth-header";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import styles from "./play.module.scss";
import FriendsList from "../../components/friendslist/FriendsList";
import InfoTooltip from "../../components/piecewizard/InfoTooltip";
import ToggleSwitch from "../../components/common/ToggleSwitch";

const Play = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { gamesList, pagination: gamesPagination } = useSelector((state) => state.games);
  const { onlineFriends } = useSelector((state) => state.friends);
  const { openGames: _openGames, ongoingGames: _ongoingGames, privateGames: _privateGames, myBotGames: _myBotGames } = useSelector((state) => state.lobbyGames);
  // Track game IDs deleted by admin so in-flight polling fetches can't
  // restore them before the next clean fetch completes.
  const [deletedGameIds, setDeletedGameIds] = useState(new Set());
  const openGames = useMemo(() => _openGames.filter(g => !deletedGameIds.has(g.id) && !deletedGameIds.has(g.gameId)), [_openGames, deletedGameIds]);
  const ongoingGames = useMemo(() => _ongoingGames.filter(g => !deletedGameIds.has(g.id) && !deletedGameIds.has(g.gameId)), [_ongoingGames, deletedGameIds]);
  const privateGames = useMemo(() => _privateGames.filter(g => !deletedGameIds.has(g.id) && !deletedGameIds.has(g.gameId)), [_privateGames, deletedGameIds]);
  const myBotGames = useMemo(() => _myBotGames.filter(g => !deletedGameIds.has(g.id) && !deletedGameIds.has(g.gameId)), [_myBotGames, deletedGameIds]);
  
  const { 
    connected, 
    socket,
    fetchOpenGames,
    fetchOngoingGames,
    fetchMyBotGames,
    fetchPrivateGames,
    createGame,
    createAnonymousGame,
    joinGame,
    joinByInviteCode,
    joinOpenGameAsGuest,
    onGameEvent,
    getStoredAnonCorresId
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
  const [premoveTimeCost, setPremoveTimeCost] = useState(false);
  const [showAdditionalOptions, setShowAdditionalOptions] = useState(false);
  const additionalOptionsRef = useRef(null);
  const ongoingGamesRef = useRef(null); // for scroll-to in limit modal
  const [startingMode, setStartingMode] = useState("none");
  const [playerSide, setPlayerSide] = useState("random"); // "p1", "p2", or "random"
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState(null);
  const [limitError, setLimitError] = useState(null); // { limitType, limitCount, limitMax, message }
  const [deletingGameId, setDeletingGameId] = useState(null);
  
  // Correspondence / game mode state
  const [gameMode, setGameMode] = useState("live"); // "live" or "correspondence"
  const [correspondenceDays, setCorrespondenceDays] = useState("1"); // days per move
  
  // Challenge system state
  const [challengedUserId, setChallengedUserId] = useState(null);
  const [challengedUsername, setChallengedUsername] = useState("");
  const [modalGameSearch, setModalGameSearch] = useState("");
  const [modalSearchResults, setModalSearchResults] = useState([]);
  const [pendingChallenges, setPendingChallenges] = useState([]);
  const [gameDeletedMessage, setGameDeletedMessage] = useState(null);

  // Friend search in modal
  const [friendSearch, setFriendSearch] = useState("");
  const [allFriends, setAllFriends] = useState([]);

  // Pagination state
  const PAGE_SIZE = 16;
  const [gameTypesPage, setGameTypesPage] = useState(1);
  const [friendsPage, setFriendsPage] = useState(1);
  const [openGamesPage, setOpenGamesPage] = useState(1);
  const [ongoingLiveGamesPage, setOngoingLiveGamesPage] = useState(1);
  const [ongoingCorrespondenceGamesPage, setOngoingCorrespondenceGamesPage] = useState(1);
  const [privateGamesPage, setPrivateGamesPage] = useState(1);
  const [computerGamesPage, setComputerGamesPage] = useState(1);
  const [publicBotGamesPage, setPublicBotGamesPage] = useState(1);

  // Collapsible-section state, persisted per section in localStorage. Default open.
  const readCollapsed = (key) => {
    try { return localStorage.getItem(`playSection.${key}`) === '1'; } catch { return false; }
  };
  const writeCollapsed = (key, val) => {
    try { localStorage.setItem(`playSection.${key}`, val ? '1' : '0'); } catch {}
  };
  const [gameTypesCollapsed, setGameTypesCollapsed] = useState(() => readCollapsed('gameTypes'));
  const [friendsCollapsed, setFriendsCollapsed] = useState(() => readCollapsed('friends'));
  const [openGamesCollapsed, setOpenGamesCollapsed] = useState(() => readCollapsed('openGames'));
  const [liveGamesCollapsed, setLiveGamesCollapsed] = useState(() => readCollapsed('liveGames'));
  const [correspondenceGamesCollapsed, setCorrespondenceGamesCollapsed] = useState(() => readCollapsed('correspondenceGames'));
  const [privateGamesCollapsed, setPrivateGamesCollapsed] = useState(() => readCollapsed('privateGames'));
  const [computerGamesCollapsed, setComputerGamesCollapsed] = useState(() => readCollapsed('computerGames'));
  const [publicBotGamesCollapsed, setPublicBotGamesCollapsed] = useState(() => readCollapsed('publicBotGames'));
  const [incomingChallengesCollapsed, setIncomingChallengesCollapsed] = useState(() => readCollapsed('incomingChallenges'));
  const toggleGameTypes = () => setGameTypesCollapsed(prev => { writeCollapsed('gameTypes', !prev); return !prev; });
  const toggleFriends = () => setFriendsCollapsed(prev => { writeCollapsed('friends', !prev); return !prev; });
  const toggleOpenGames = () => setOpenGamesCollapsed(prev => { writeCollapsed('openGames', !prev); return !prev; });
  const toggleLiveGames = () => setLiveGamesCollapsed(prev => { writeCollapsed('liveGames', !prev); return !prev; });
  const toggleCorrespondenceGames = () => setCorrespondenceGamesCollapsed(prev => { writeCollapsed('correspondenceGames', !prev); return !prev; });
  const togglePrivateGames = () => setPrivateGamesCollapsed(prev => { writeCollapsed('privateGames', !prev); return !prev; });
  const toggleComputerGames = () => setComputerGamesCollapsed(prev => { writeCollapsed('computerGames', !prev); return !prev; });
  const togglePublicBotGames = () => setPublicBotGamesCollapsed(prev => { writeCollapsed('publicBotGames', !prev); return !prev; });

  // Anonymous play state
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [guestName, setGuestName] = useState("");
  const [isCreatingAnonymous, setIsCreatingAnonymous] = useState(false);
  const [isJoiningByCode, setIsJoiningByCode] = useState(false);

  // Bot / Play vs Computer state
  const [vsComputer, setVsComputer] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState("medium");
  // Per-game-type training availability for the "Adaptive" tier.
  // Shape: { available: bool, gamesPlayed: number } | null while loading
  const [adaptiveAvailability, setAdaptiveAvailability] = useState(null);
  const [materialClockPenalty, setMaterialClockPenalty] = useState(false);
  const [materialClockHandicap, setMaterialClockHandicap] = useState(false);
  const [showAnonCreateModal, setShowAnonCreateModal] = useState(false);
  const [anonTimeControl, setAnonTimeControl] = useState("10");
  const [anonIncrement, setAnonIncrement] = useState("0");
  const [anonWarning, setAnonWarning] = useState(null);
  const [anonIsCorrespondence, setAnonIsCorrespondence] = useState(false);
  const [anonCorrDays, setAnonCorrDays] = useState("3");

  // Join anonymous open match state
  const [showJoinAnonModal, setShowJoinAnonModal] = useState(false);
  const [joiningAnonGame, setJoiningAnonGame] = useState(null);
  const [joinAnonGuestName, setJoinAnonGuestName] = useState("");
  const [isJoiningAnon, setIsJoiningAnon] = useState(false);

  const normalizedSearchTerm = searchTerm.trim();
  const requestedGameTypeId = useMemo(() => {
    const rawGameTypeId = searchParams.get('gameTypeId');
    if (!rawGameTypeId) return null;
    const parsedGameTypeId = parseInt(rawGameTypeId, 10);
    return Number.isNaN(parsedGameTypeId) ? null : parsedGameTypeId;
  }, [searchParams]);

  const selectedGameTypeOnCurrentPage = useMemo(() => {
    if (!selectedGameType) {
      return false;
    }
    return gamesList.some((game) => game.id === selectedGameType.id);
  }, [gamesList, selectedGameType]);

  const pinnedSelectedGameType = useMemo(() => {
    if (!selectedGameType || selectedGameTypeOnCurrentPage) {
      return null;
    }

    if (!normalizedSearchTerm) {
      return selectedGameType;
    }

    return selectedGameType.game_name?.toLowerCase().includes(normalizedSearchTerm.toLowerCase())
      ? selectedGameType
      : null;
  }, [normalizedSearchTerm, selectedGameType, selectedGameTypeOnCurrentPage]);

  const filteredGameTypes = useMemo(() => {
    return pinnedSelectedGameType ? [pinnedSelectedGameType, ...gamesList] : gamesList;
  }, [gamesList, pinnedSelectedGameType]);

  const totalGameTypePages = Math.max(gamesPagination?.totalPages || 0, 1);

  const setGameTypeQueryParam = (gameTypeId) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (gameTypeId) {
      nextSearchParams.set('gameTypeId', String(gameTypeId));
    } else {
      nextSearchParams.delete('gameTypeId');
    }
    setSearchParams(nextSearchParams, { replace: true });
  };

  const selectGameType = (gameType, syncQueryParam = true) => {
    if (!gameType) {
      return;
    }

    setSelectedGameType(gameType);
    localStorage.setItem('lastPlayedGameType', String(gameType.id));

    if (syncQueryParam) {
      setGameTypeQueryParam(gameType.id);
    }
  };

  // Online player count (includes anonymous)
  const [playerCount, setPlayerCount] = useState(null);

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

  // Fetch the current game-type page whenever the library filters change
  useEffect(() => {
    dispatch(getGames(gameTypesPage, PAGE_SIZE, 'newest', '', normalizedSearchTerm));
  }, [dispatch, gameTypesPage, normalizedSearchTerm]);

  useEffect(() => {
    if (gameTypesPage > totalGameTypePages) {
      setGameTypesPage(totalGameTypePages);
    }
  }, [gameTypesPage, totalGameTypePages]);

  // Look up adaptive-bot availability whenever the player picks a game type
  // (and only when they're actually configuring a vs-Computer game).
  useEffect(() => {
    if (!vsComputer || !selectedGameType?.id) {
      setAdaptiveAvailability(null);
      return;
    }
    let cancelled = false;
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
    axios.get(`${API_URL}/api/ai-models/${selectedGameType.id}/availability`)
      .then(res => {
        if (cancelled) return;
        setAdaptiveAvailability(res.data || { available: false, gamesPlayed: 0 });
      })
      .catch(() => {
        if (cancelled) return;
        setAdaptiveAvailability({ available: false, gamesPlayed: 0 });
      });
    return () => { cancelled = true; };
  }, [vsComputer, selectedGameType]);

  // If the user had picked Adaptive but switches to a game type with no
  // training data, fall back to medium so the form stays valid.
  useEffect(() => {
    if (botDifficulty === 'adaptive' && adaptiveAvailability && !adaptiveAvailability.available) {
      setBotDifficulty('medium');
    }
  }, [botDifficulty, adaptiveAvailability]);

  // Handle incoming challenge navigation from profile pages
  useEffect(() => {
    if (location.state?.openChallengeFor) {
      const { id, username } = location.state.openChallengeFor;
      setChallengedUserId(id);
      setChallengedUsername(username);
      setShowCreateModal(true);
      // Clear the navigation state to prevent re-opening modal
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  // Select a directly linked game type, even if it is older than the current page of results.
  useEffect(() => {
    let ignore = false;

    const loadRequestedGameType = async () => {
      if (!requestedGameTypeId || selectedGameType?.id === requestedGameTypeId) {
        return;
      }

      const pagedGameMatch = gamesList.find((game) => game.id === requestedGameTypeId);
      if (pagedGameMatch) {
        if (!ignore) {
          setSelectedGameType(pagedGameMatch);
          localStorage.setItem('lastPlayedGameType', String(pagedGameMatch.id));
        }
        return;
      }

      try {
        const requestedGameType = await dispatch(getGameById(requestedGameTypeId));
        if (!ignore) {
          setSelectedGameType(requestedGameType);
          localStorage.setItem('lastPlayedGameType', String(requestedGameType.id));
        }
      } catch (loadError) {
        if (!ignore) {
          setSelectedGameType(null);
        }
      }
    };

    loadRequestedGameType();

    return () => {
      ignore = true;
    };
  }, [dispatch, gamesList, requestedGameTypeId, selectedGameType?.id]);

  // Fall back to the most recently played game only when the URL does not request one.
  useEffect(() => {
    let ignore = false;

    const loadLastPlayedGameType = async () => {
      if (requestedGameTypeId || selectedGameType) {
        return;
      }

      const rawLastPlayedGameTypeId = localStorage.getItem('lastPlayedGameType');
      if (!rawLastPlayedGameTypeId) {
        return;
      }

      const lastPlayedGameTypeId = parseInt(rawLastPlayedGameTypeId, 10);
      if (Number.isNaN(lastPlayedGameTypeId)) {
        return;
      }

      const pagedGameMatch = gamesList.find((game) => game.id === lastPlayedGameTypeId);
      if (pagedGameMatch) {
        if (!ignore) {
          setSelectedGameType(pagedGameMatch);
        }
        return;
      }

      try {
        const lastPlayedGameType = await dispatch(getGameById(lastPlayedGameTypeId));
        if (!ignore) {
          setSelectedGameType(lastPlayedGameType);
        }
      } catch {
        // Ignore stale last-played IDs.
      }
    };

    loadLastPlayedGameType();

    return () => {
      ignore = true;
    };
  }, [dispatch, gamesList, requestedGameTypeId, selectedGameType]);

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

  // Derive the game type's default starting mode (stable memo so the effect below
  // doesn't need selectedGameType directly in its dependency array).
  const gameTypeDefaultMode = useMemo(
    () => selectedGameType?.default_starting_mode || null,
    [selectedGameType]
  );

  // Reset starting mode when game type changes
  useEffect(() => {
    if (allowedStartingModes.length > 0) {
      // Prefer the game type's saved default mode if it's still in the allowed list
      if (gameTypeDefaultMode && allowedStartingModes.includes(gameTypeDefaultMode)) {
        setStartingMode(gameTypeDefaultMode);
      } else {
        setStartingMode(allowedStartingModes[0]);
      }
    }
  }, [allowedStartingModes, gameTypeDefaultMode]);

  // Fetch open games when connected
  useEffect(() => {
    if (connected) {
      fetchOpenGames();
      fetchOngoingGames();
      if (currentUser) {
        fetchPrivateGames();
        fetchMyBotGames();
      }
    }
  }, [connected, fetchOpenGames, fetchOngoingGames, fetchPrivateGames, fetchMyBotGames, currentUser]);

  // Lightweight polling so the move-count badge on ongoing game cards stays
  // fresh without us needing to open a per-game socket channel. Only active
  // while the tab is visible to avoid pointless work in background tabs.
  useEffect(() => {
    if (!connected) return undefined;
    const INTERVAL_MS = 5000;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchOngoingGames();
      fetchOpenGames();
    };
    const id = setInterval(tick, INTERVAL_MS);
    return () => clearInterval(id);
  }, [connected, fetchOngoingGames, fetchOpenGames]);

  // Close the host-modal "additional options" popover when clicking outside
  // of it. (The popover itself floats above the toggle button; clicking
  // anywhere else in the modal or on the backdrop should collapse it.)
  useEffect(() => {
    if (!showAdditionalOptions) return undefined;
    const handler = (e) => {
      const root = additionalOptionsRef.current;
      if (root && !root.contains(e.target)) {
        setShowAdditionalOptions(false);
      }
    };
    // Use mousedown so the close fires before any click handlers inside the
    // modal content get a chance to execute.
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAdditionalOptions]);

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

      // Request current snapshot in case we missed the broadcast that fires
      // on socket auth/connect (race: listener registered after event arrived).
      if (connected) {
        socket.emit("getOnlineUsers");
      }

      return () => {
        socket.off("onlineUsers");
      };
    }
  }, [socket, connected, dispatch, currentUser]);

  // Listen for player count updates (includes anonymous)
  useEffect(() => {
    if (socket) {
      socket.on("playerCount", (count) => {
        setPlayerCount(count);
      });

      // Request current count in case we missed the broadcast that fires
      // on connection (race: listener registered after event arrived).
      if (connected) {
        socket.emit("getPlayerCount");
      }

      return () => {
        socket.off("playerCount");
      };
    }
  }, [socket, connected]);

  // Listen for game events
  useEffect(() => {
    const unsubscribePlayerJoined = onGameEvent("playerJoined", ({ gameId, gameState }) => {
      // Refresh all lists when someone joins a game
      fetchOpenGames();
      fetchOngoingGames();
      if (currentUser) fetchPrivateGames();
    });

    const unsubscribeGameCancelled = onGameEvent("gameCancelled", ({ gameId }) => {
      // Refresh open games list when a game is cancelled
      fetchOpenGames();
      if (currentUser) fetchPrivateGames();
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
  }, [onGameEvent, fetchOpenGames, fetchOngoingGames, fetchPrivateGames, currentUser]);

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

  // Fetch all friends when modal opens (for friend search)
  useEffect(() => {
    const fetchFriends = async () => {
      if (showCreateModal && currentUser) {
        try {
          const result = await dispatch(getFriends(currentUser.id));
          setAllFriends(result || []);
        } catch (err) {
          console.error("Error fetching friends for modal:", err);
        }
      }
    };
    fetchFriends();
  }, [showCreateModal, currentUser, dispatch]);

  // Filtered friends for modal search
  const modalFilteredFriends = useMemo(() => {
    if (!friendSearch.trim()) return [];
    return allFriends.filter(f =>
      f.username?.toLowerCase().includes(friendSearch.toLowerCase())
    );
  }, [allFriends, friendSearch]);

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
    setFriendSearch("");
    setGameMode("live");
    setCorrespondenceDays("1");
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
      if (err.code === 'LIMIT_EXCEEDED') {
        setLimitError({ limitType: err.limitType, limitCount: err.limitCount, limitMax: err.limitMax, message: err.message });
      } else {
        setError(err.message || "Failed to join challenge");
      }
    }
  };

  // Decline a challenge
  const declineChallenge = (gameId) => {
    setPendingChallenges(prev => prev.filter(c => c.gameId !== gameId));
  };

  // Fetch game types from the server when the modal search term changes.
  // This ensures games not on the current sidebar page are still findable.
  useEffect(() => {
    const term = modalGameSearch.trim();
    if (!term) {
      setModalSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(API_URL + 'games', { params: { search: term, limit: 20, page: 1 } });
        if (!cancelled) {
          setModalSearchResults(Array.isArray(res.data?.games) ? res.data.games : []);
        }
      } catch {
        // fail silently
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [modalGameSearch]);

  const modalFilteredGameTypes = modalSearchResults;

  // Get win condition description for a game type
  const getWinCondition = (gameType) => {
    if (!gameType) return "Unknown";
    const conditions = [];
    if (gameType.mate_condition) conditions.push("Checkmate");
    if (gameType.capture_condition) conditions.push("Capture");
    if (gameType.value_condition) conditions.push(gameType.value_title || "Points");
    if (gameType.squares_condition) conditions.push("Territory");
    if (gameType.hill_condition) conditions.push("King of the Hill");
    if (gameType.no_moves_condition) conditions.push("No Legal Moves");
    if (gameType.piece_count_condition) conditions.push("Piece Count");
    if (gameType.promotion_condition) conditions.push("Win on Promotion");
    if (gameType.lose_all_pieces_condition) conditions.push("Lose All Pieces");
    if (gameType.stalemate_win_condition) conditions.push("Stalemate Win");
    if (gameType.points_to_win != null) conditions.push("Points");
    return conditions.length > 0 ? conditions.join(" / ") : "Capture (default)";
  };

  // Get piece count per player from pieces_string
  const getPieceCounts = (gameType) => {
    if (gameType?.pieces_string) {
      try {
        const pieces = JSON.parse(gameType.pieces_string);
        // Handle both array and object formats, filter out multi-tile extension squares
        const pieceArray = Array.isArray(pieces)
          ? pieces.filter(p => !p._occupied)
          : Object.values(pieces).filter(p => !p._occupied);
        const player1Count = pieceArray.filter(p => (p.player_number || p.player_id || p.player) === 1).length;
        const player2Count = pieceArray.filter(p => (p.player_number || p.player_id || p.player) === 2).length;
        const neutralCount = pieceArray.filter(p => p.is_neutral || (p.player_number || p.player_id || p.player) === 0).length;
        if (player1Count > 0 || player2Count > 0 || neutralCount > 0) {
          return { player1: player1Count, player2: player2Count, neutral: neutralCount, equal: player1Count === player2Count };
        }
      } catch {
        // Fall through to starting_piece_count
      }
    }
    // Fallback to starting_piece_count (total pieces / 2 assumes equal distribution)
    if (gameType?.starting_piece_count) {
      const perPlayer = Math.floor(gameType.starting_piece_count / 2);
      return { player1: perPlayer, player2: perPlayer, neutral: 0, equal: true };
    }
    return null;
  };

  // Format piece count display
  const formatPieceCount = (gameType) => {
    const counts = getPieceCounts(gameType);
    if (!counts) return null;
    const base = counts.equal
      ? `${counts.player1} pieces each`
      : `White: ${counts.player1} / Black: ${counts.player2}`;
    return counts.neutral > 0 ? `${base}, ${counts.neutral} neutral` : base;
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

  // Split ongoing games into live and correspondence (excluding public bot games)
  const publicBotGames = useMemo(() => {
    return ongoingGames.filter(g => g.host_show_bot_public === 1 || g.host_show_bot_public === true);
  }, [ongoingGames]);

  const ongoingLiveGames = useMemo(() => {
    return ongoingGames.filter(g => !g.is_correspondence && !g.host_show_bot_public);
  }, [ongoingGames]);

  const ongoingCorrespondenceGames = useMemo(() => {
    return ongoingGames.filter(g => g.is_correspondence && !g.host_show_bot_public);
  }, [ongoingGames]);

  const paginatedOngoingLiveGames = useMemo(() => {
    const start = (ongoingLiveGamesPage - 1) * PAGE_SIZE;
    return ongoingLiveGames.slice(start, start + PAGE_SIZE);
  }, [ongoingLiveGames, ongoingLiveGamesPage]);

  const paginatedOngoingCorrespondenceGames = useMemo(() => {
    const start = (ongoingCorrespondenceGamesPage - 1) * PAGE_SIZE;
    return ongoingCorrespondenceGames.slice(start, start + PAGE_SIZE);
  }, [ongoingCorrespondenceGames, ongoingCorrespondenceGamesPage]);

  const paginatedPrivateGames = useMemo(() => {
    const start = (privateGamesPage - 1) * PAGE_SIZE;
    return privateGames.slice(start, start + PAGE_SIZE);
  }, [privateGames, privateGamesPage]);

  const paginatedComputerGames = useMemo(() => {
    const list = myBotGames || [];
    const start = (computerGamesPage - 1) * PAGE_SIZE;
    return list.slice(start, start + PAGE_SIZE);
  }, [myBotGames, computerGamesPage]);

  const paginatedPublicBotGames = useMemo(() => {
    const start = (publicBotGamesPage - 1) * PAGE_SIZE;
    return publicBotGames.slice(start, start + PAGE_SIZE);
  }, [publicBotGames, publicBotGamesPage]);

  // Render two players stacked vertically with a stylized "vs" between them.
  // Each player links to their profile unless the entry is a Computer player.
  const renderPlayerStack = (game) => {
    const raw = game?.player_names || '';
    const parts = raw.split(' vs ').map(s => s.trim()).filter(Boolean);
    // Fallback for malformed / empty lists.
    if (parts.length === 0) {
      return <div className={styles["player-stack"]} />;
    }
    const isAnonGame = game.is_anonymous === 1 || game.is_anonymous === true;
    const isComputer = (name) => /^Computer\s*\(/i.test(name);
    const renderName = (name, key) => (
      isComputer(name) || isAnonGame
        ? <span key={key} className={styles["player-name-plain"]}>{name}</span>
        : <Link key={key} to={`/profile/${encodeURIComponent(name)}`} className={styles["player-name"]}>{name}</Link>
    );
    if (parts.length === 1) {
      return (
        <div className={styles["player-stack"]}>
          {renderName(parts[0], 'p0')}
        </div>
      );
    }
    // 2+ players — render first vs second vs third, etc.
    const out = [];
    parts.forEach((name, i) => {
      if (i > 0) {
        out.push(<span key={`sep-${i}`} className={styles["vs-separator"]}>vs</span>);
      }
      out.push(renderName(name, `p-${i}`));
    });
    return <div className={styles["player-stack"]}>{out}</div>;
  };

  // Total pages for each section
  const totalFriendsPages = Math.ceil((onlineFriends?.length || 0) / PAGE_SIZE);
  const totalOpenGamesPages = Math.ceil(openGames.length / PAGE_SIZE);
  const totalOngoingLiveGamesPages = Math.ceil(ongoingLiveGames.length / PAGE_SIZE);
  const totalOngoingCorrespondenceGamesPages = Math.ceil(ongoingCorrespondenceGames.length / PAGE_SIZE);
  const totalPrivateGamesPages = Math.ceil(privateGames.length / PAGE_SIZE);
  const totalComputerGamesPages = Math.ceil(((myBotGames || []).length) / PAGE_SIZE);
  const totalPublicBotGamesPages = Math.ceil(publicBotGames.length / PAGE_SIZE);
  // Format time control for display
  const formatTimeControl = (game) => {
    if (game.is_correspondence) {
      const days = game.correspondence_days || 1;
      return `📬 ${days} day${days !== 1 ? 's' : ''}/move`;
    }
    const minutes = game.turn_length || game.timeControl;
    const inc = game.increment;
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
      const isCorrespondence = gameMode === "correspondence";
      const timeControlMinutes = isCorrespondence ? null : (timeControl === "0" ? null : parseInt(timeControl));
      const incrementSeconds = isCorrespondence ? 0 : (parseInt(increment) || 0);
      
      const gameData = {
        gameTypeId: selectedGameType.id,
        timeControl: timeControlMinutes,
        increment: incrementSeconds,
        allowSpectators,
        showPieceHelpers,
        rated: vsComputer ? false : rated,
        allowPremoves: allowPremoves,
        premoveTimeCost: allowPremoves && premoveTimeCost ? 0.1 : 0,
        startingMode,
        playerSide,
        isCorrespondence,
        correspondenceDays: isCorrespondence ? parseInt(correspondenceDays) : null,
        vsComputer,
        botDifficulty: vsComputer ? botDifficulty : undefined,
        materialClockPenalty: (timeControlMinutes && materialClockPenalty) ? true : undefined,
        materialClockHandicap: (timeControlMinutes && materialClockHandicap) ? true : undefined
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
      if (err.code === 'LIMIT_EXCEEDED') {
        closeCreateModal();
        setLimitError({ limitType: err.limitType, limitCount: err.limitCount, limitMax: err.limitMax, message: err.message });
      } else {
        setError(err.message || "Failed to create game");
      }
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
      if (err.code === 'LIMIT_EXCEEDED') {
        setLimitError({ limitType: err.limitType, limitCount: err.limitCount, limitMax: err.limitMax, message: err.message });
      } else {
        setError(err.message || "Failed to join game");
      }
    } finally {
      setIsJoining(false);
    }
  };

  // Handle creating an anonymous game
  const handleCreateAnonymousGame = async () => {
    if (!selectedGameType) {
      setError("Please select a game type first");
      return;
    }
    setIsCreatingAnonymous(true);
    setError(null);

    try {
      const result = await createAnonymousGame({
        gameTypeId: selectedGameType.id,
        timeControl: anonIsCorrespondence ? null : (anonTimeControl === "0" ? null : parseInt(anonTimeControl)),
        increment: anonIsCorrespondence ? 0 : (parseInt(anonIncrement) || 0),
        guestName: guestName || 'Guest',
        allowPremoves: true,
        startingMode: 'none',
        isCorrespondence: anonIsCorrespondence,
        correspondenceDays: anonIsCorrespondence ? parseInt(anonCorrDays) : null,
      });

      setShowAnonCreateModal(false);
      navigate(`/play/${result.gameId}`);
    } catch (err) {
      if (err.code === 'LIMIT_EXCEEDED') {
        setShowAnonCreateModal(false);
        setLimitError({ limitType: err.limitType, limitCount: err.limitCount, limitMax: err.limitMax, message: err.message });
      } else {
        setError(err.message || "Failed to create anonymous game");
      }
    } finally {
      setIsCreatingAnonymous(false);
    }
  };

  // Handle joining by invite code
  const handleJoinByInviteCode = async () => {
    if (!inviteCodeInput.trim()) {
      setError("Please enter an invite code");
      return;
    }
    setIsJoiningByCode(true);
    setError(null);

    try {
      const result = await joinByInviteCode(inviteCodeInput.trim(), guestName || 'Guest');
      navigate(`/play/${result.gameId}`);
    } catch (err) {
      if (err.code === 'LIMIT_EXCEEDED') {
        setLimitError({ limitType: err.limitType, limitCount: err.limitCount, limitMax: err.limitMax, message: err.message });
      } else {
        setError(err.message || "Failed to join game");
      }
    } finally {
      setIsJoiningByCode(false);
    }
  };

  // Handle joining an open (non-anonymous) game as a guest
  const handleJoinOpenGameAsGuest = (game) => {
    setJoiningAnonGame(game);
    setJoinAnonGuestName("");
    setShowJoinAnonModal(true);
  };

  const handleConfirmJoinGuestOpenGame = async () => {
    const game = joiningAnonGame;
    if (!game) return;
    setIsJoiningAnon(true);
    setError(null);
    try {
      await joinOpenGameAsGuest(game.id || game.gameId, joinAnonGuestName || 'Guest');
      setShowJoinAnonModal(false);
      navigate(`/play/${game.id || game.gameId}`);
    } catch (err) {
      if (err.code === 'LIMIT_EXCEEDED') {
        setShowJoinAnonModal(false);
        setLimitError({ limitType: err.limitType, limitCount: err.limitCount, limitMax: err.limitMax, message: err.message });
      } else {
        setError(err.message || "Failed to join game");
      }
    } finally {
      setIsJoiningAnon(false);
    }
  };

  // Handle joining an anonymous open match from the lobby
  const handleJoinAnonOpenGame = (game) => {
    if (!currentUser) {
      // Non-logged-in: show guest name prompt
      setJoiningAnonGame(game);
      setJoinAnonGuestName("");
      setShowJoinAnonModal(true);
    } else {
      // Logged-in user: join directly via invite code (no guest name needed)
      handleConfirmJoinAnonGame(game, null);
    }
  };

  const handleConfirmJoinAnonGame = async (gameArg, guestNameArg) => {
    const game = gameArg || joiningAnonGame;
    if (!game) return;
    setIsJoiningAnon(true);
    setError(null);
    try {
      const result = await joinByInviteCode(game.invite_code, guestNameArg !== undefined ? guestNameArg : (joinAnonGuestName || 'Guest'));
      setShowJoinAnonModal(false);
      navigate(`/play/${result.gameId}`);
    } catch (err) {
      if (err.code === 'LIMIT_EXCEEDED') {
        setShowJoinAnonModal(false);
        setLimitError({ limitType: err.limitType, limitCount: err.limitCount, limitMax: err.limitMax, message: err.message });
      } else {
        setError(err.message || "Failed to join game");
      }
    } finally {
      setIsJoiningAnon(false);
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

      // Immediately filter the game from all rendered lists. Using a local
      // Set guards against in-flight polling fetches (started before the
      // delete) resolving after the dispatch and restoring the card.
      setDeletedGameIds(prev => { const s = new Set(prev); s.add(gameId); return s; });
      dispatch({ type: 'REMOVE_LOBBY_GAME', payload: gameId });

      // Refresh game lists (including computer games — without this the
      // deleted card would flash but stay on screen until the next manual
      // refresh because myBotGames was never re-fetched)
      fetchOpenGames();
      fetchOngoingGames();
      fetchPrivateGames();
      fetchMyBotGames();
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
          {connected && playerCount != null && (
            <span className={styles["player-count"]}>
              {playerCount} {playerCount === 1 ? 'player' : 'players'} online
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className={styles["error-message"]}>{error}</div>
      )}

      {!currentUser && (
        <div className={styles["anonymous-play-section"]}>
          <div className={styles["anonymous-play-info"]}>
            <h3>Play Without an Account</h3>
            <p>You can play anonymously! To host a game against a specific person, first select a game type from the Game Library in the sidebar, then click "Create Anonymous Game" to get an invite code you can share. To join a friend's game by invite code, enter it below. You can also browse <strong>Open Matches</strong> further down this page — any unrated game listed there can be joined without an account, just click "Join Game" and enter a display name. Anonymous games are unrated and won't be saved to any profile.</p>
            <p className={styles["account-benefits"]}>Create a free account to unlock more features: customizable time controls, rated games, spectator settings, piece move helpers, premoves, correspondence play, and more.</p>
          </div>
          {anonWarning && (
            <div className={styles["anon-warning"]}>{anonWarning}</div>
          )}
          <div className={styles["anonymous-play-actions"]}>
            <div className={styles["anonymous-name-input"]}>
              <label>Display Name (optional):</label>
              <input
                type="text"
                placeholder="Guest"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                maxLength={20}
              />
            </div>
            <div className={styles["anonymous-join-section"]}>
              <input
                type="text"
                placeholder="Enter invite code"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                maxLength={6}
                className={styles["invite-code-input"]}
              />
              <button
                className={styles["join-code-button"]}
                onClick={handleJoinByInviteCode}
                disabled={isJoiningByCode || !inviteCodeInput.trim()}
              >
                {isJoiningByCode ? "Joining..." : "Join Game"}
              </button>
            </div>
            <div className={styles["anonymous-create-section"]}>
              <button
                className={styles["create-anon-button"]}
                onClick={() => {
                  if (!selectedGameType) {
                    setAnonWarning("Please select a game type from the sidebar before creating a game.");
                    return;
                  }
                  setAnonWarning(null);
                  setShowAnonCreateModal(true);
                }}
              >
                Create Anonymous Game
              </button>
            </div>
          </div>
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
          <h2
            onClick={toggleGameTypes}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ display: 'inline-block', width: '1em' }}>{gameTypesCollapsed ? '▶' : '▼'}</span>
            Game Types
          </h2>
          {!gameTypesCollapsed && (<>
          <div className={styles["search-box"]}>
            <input
              type="text"
              placeholder="Search games..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setGameTypesPage(1);
              }}
            />
          </div>
          <div className={styles["game-types-list"]}>
            {filteredGameTypes.length === 0 ? (
              <div className={styles["no-games-message"]}>
                {searchTerm ? "No games match your search" : "No game types available"}
              </div>
            ) : (
              filteredGameTypes.map((game) => (
                <div key={game.id}>
                  {pinnedSelectedGameType?.id === game.id && (
                    <div className={styles["selected-game-indicator"]}>Selected from link</div>
                  )}
                  <div
                    className={`${styles["game-type-item"]} ${selectedGameType?.id === game.id ? styles.selected : ''}`}
                    onClick={() => selectGameType(game)}
                  >
                    <div className={styles["game-type-name"]}>{game.game_name}</div>
                    <div className={styles["game-type-info"]}>
                      {game.board_width}x{game.board_height} • {game.player_count || 2} players
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {totalGameTypePages > 1 && (
            <div className={styles["game-types-pagination"]}>
              <button
                disabled={gameTypesPage === 1}
                onClick={() => setGameTypesPage((page) => page - 1)}
                className={styles["pagination-btn"]}
              >
                ← Prev
              </button>
              <span className={styles["pagination-info"]}>
                {gameTypesPage} / {totalGameTypePages}
              </span>
              <button
                disabled={gameTypesPage >= totalGameTypePages}
                onClick={() => setGameTypesPage((page) => page + 1)}
                className={styles["pagination-btn"]}
              >
                Next →
              </button>
            </div>
          )}
          </>)}
        </div>

        {/* Main Content */}
        <div className={styles["main-content"]}>
          {/* Incoming Challenges Section */}
          {pendingChallenges.length > 0 && (
            <div className={styles["incoming-challenges-section"]}>
              <h2
                onClick={() => setIncomingChallengesCollapsed(prev => !prev)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ display: 'inline-block', width: '1em' }}>{incomingChallengesCollapsed ? '▶' : '▼'}</span>
                Incoming Challenges
                <span className={styles["match-count"]}>{pendingChallenges.length}</span>
              </h2>
              {!incomingChallengesCollapsed && (
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
              )}
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
                  <h3><Link to={`/games/${selectedGameType.id}`}>{selectedGameType.game_name}</Link></h3>
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
                        <span className={styles["stat-divider"]}>{' '}•{' '}</span>by{' '}
                        {selectedGameType.creator_username === 'Anonymous' ? (
                          <span>Anonymous</span>
                        ) : (
                          <Link to={`/profile/${selectedGameType.creator_username}`} style={{ textDecoration: 'none', color: 'inherit' }}>{selectedGameType.creator_username}</Link>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className={`${styles.btn} ${styles["btn-primary"]}`}
                  onClick={() => {
                    if (!currentUser) {
                      setShowAnonCreateModal(true);
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

          {/* Private Games Section */}
          {currentUser && privateGames.length > 0 && (
            <div className={styles["private-games-section"]}>
              <h2
                onClick={togglePrivateGames}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ display: 'inline-block', width: '1em' }}>{privateGamesCollapsed ? '▶' : '▼'}</span>
                Private Games
                <span className={styles["match-count"]}>{privateGames.length}</span>
              </h2>
              {!privateGamesCollapsed && (<>
              <div className={styles["private-games-list"]}>
                {paginatedPrivateGames.map((game) => {
                  const isHost = game.host_id === currentUser.id;
                  const isRated = game.rated !== 0 && game.rated !== false && game.rated !== null;
                  return (
                    <div
                      key={game.id}
                      className={`${styles["open-match-card"]} ${styles["private-game"]}`}
                    >
                      <div className={styles["match-header"]}>
                        <span className={styles["match-game-name"]}>
                          <Link to={`/games/${game.game_type_id}`} className={styles["game-name-link"]}>{game.game_name}</Link>
                        </span>
                        <div className={styles["meta-column"]}>
                          <span className={styles["match-time-control"]}>
                            {formatTimeControl(game)}
                          </span>
                          <span className={styles[isRated ? 'rated-badge' : 'unrated-badge']}>
                            {isRated ? 'Rated' : 'Casual'}
                          </span>
                        </div>
                      </div>
                      <div className={styles["player-stack"]}>
                        <Link to={`/profile/${game.host_username}`} className={styles["player-name"]}>{game.host_username}</Link>
                        <span className={styles["vs-separator"]}>vs</span>
                        <Link to={`/profile/${game.challenged_username}`} className={styles["player-name"]}>{game.challenged_username}</Link>
                      </div>
                      <div className={styles["match-actions"]}>
                        {isHost ? (
                          <button
                            className={`${styles.btn} ${styles["btn-primary"]} ${styles["btn-small"]}`}
                            onClick={() => navigate(`/play/${game.id}`)}
                          >
                            Return to Game
                          </button>
                        ) : (
                          <button
                            className={`${styles.btn} ${styles["btn-success"]} ${styles["btn-small"]}`}
                            onClick={() => handleJoinGame(game.id)}
                            disabled={isJoining}
                          >
                            {isJoining ? "Joining..." : "Accept Challenge"}
                          </button>
                        )}
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
                  );
                })}
              </div>
              {totalPrivateGamesPages > 1 && (
                <div className={styles["pagination"]}>
                  <button
                    disabled={privateGamesPage === 1}
                    onClick={() => setPrivateGamesPage(p => p - 1)}
                    className={styles["pagination-btn"]}
                  >
                    ← Prev
                  </button>
                  <span className={styles["pagination-info"]}>
                    {privateGamesPage} / {totalPrivateGamesPages}
                  </span>
                  <button
                    disabled={privateGamesPage >= totalPrivateGamesPages}
                    onClick={() => setPrivateGamesPage(p => p + 1)}
                    className={styles["pagination-btn"]}
                  >
                    Next →
                  </button>
                </div>
              )}
              </>)}
            </div>
          )}

          {/* Online Friends Section */}
          {currentUser && onlineFriends && onlineFriends.length > 0 && (
            <div className={styles["online-friends-section"]}>
              <h2
                onClick={toggleFriends}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ display: 'inline-block', width: '1em' }}>{friendsCollapsed ? '▶' : '▼'}</span>
                Online Friends
                <span className={styles["match-count"]}>{onlineFriends.length}</span>
              </h2>
              {!friendsCollapsed && (<>
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
              </>)}
            </div>
          )}

          {/* Open Matches Section */}
          <div className={styles["open-matches-section"]}>
            <h2
              onClick={toggleOpenGames}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ display: 'inline-block', width: '1em' }}>{openGamesCollapsed ? '▶' : '▼'}</span>
              Open Matches
              {openGames.length > 0 && (
                <span className={styles["match-count"]}>{openGames.length}</span>
              )}
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '-8px', marginBottom: '12px' }}>
              Open matches stay listed until someone joins or the host leaves. Anonymous (guest) matches are automatically closed after 24 hours and fully removed after 30 days.
            </p>

            {!openGamesCollapsed && (
              openGames.length === 0 ? (
              <div className={styles["no-matches"]}>
                No open matches. Create one or wait for someone to host!
              </div>
            ) : (
              <>
                <div className={styles["open-matches-list"]}>
                  {paginatedOpenGames.map((game) => {
                    const gameId = game.id || game.gameId;
                    const isOwnGame = currentUser
                      ? game.host_id === currentUser.id
                      : !!getStoredAnonCorresId(String(gameId));
                    const isRated = game.rated !== 0 && game.rated !== false && game.rated !== null;
                    const isAnonGame = game.is_anonymous === 1 || game.is_anonymous === true;
                    const hostDisplay = game.host_username || game.hostUsername;
                    return (
                      <div 
                        key={game.id || game.gameId} 
                        className={`${styles["open-match-card"]} ${isOwnGame ? styles["own-game"] : ''}`}
                      >
                        <div className={styles["match-header"]}>
                          <span className={styles["match-game-name"]}>
                            <Link to={`/games/${game.game_type_id}`} className={styles["game-name-link"]}>{game.game_name || game.gameTypeName}</Link>
                          </span>
                          <div className={styles["meta-column"]}>
                            <span className={styles["match-time-control"]}>
                              {formatTimeControl(game)}
                            </span>
                            <span className={styles[isRated ? 'rated-badge' : 'unrated-badge']}>
                              {isRated ? 'Rated' : 'Casual'}
                            </span>
                          </div>
                        </div>
                        <div className={styles["match-host"]}>
                          {isOwnGame ? (
                            <span className={styles["your-game"]}>Your Game</span>
                          ) : isAnonGame ? (
                            <>Hosted by <span className={styles["username-link"]}>Guest: {hostDisplay}</span></>
                          ) : (
                            <>Hosted by <Link to={`/profile/${hostDisplay}`} className={styles["username-link"]}>{hostDisplay}</Link></>
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
                              onClick={() => {
                                if (currentUser) {
                                  handleJoinGame(game.id || game.gameId);
                                } else if (isAnonGame) {
                                  handleJoinAnonOpenGame(game);
                                } else if (!isRated) {
                                  handleJoinOpenGameAsGuest(game);
                                } else {
                                  redirectToLogin("Rated games require an account to track your rating.");
                                }
                              }}
                              disabled={isJoining || isJoiningAnon}
                            >
                              {(isJoining || isJoiningAnon) ? "Joining..." : (!currentUser && isRated) ? "Sign in to Join" : "Join Game"}
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
            )
            )}
          </div>

          {/* Ongoing Live Games Section */}
          <div className={styles["ongoing-games-section"]} ref={ongoingGamesRef}>
            <h2
              onClick={toggleLiveGames}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ display: 'inline-block', width: '1em' }}>{liveGamesCollapsed ? '▶' : '▼'}</span>
              Live Games
              {ongoingLiveGames.length > 0 && (
                <span className={styles["match-count"]}>{ongoingLiveGames.length}</span>
              )}
            </h2>
            <p className={styles["section-note"]}>
              While we grow our player base, consider hosting a <strong>Correspondence game</strong> instead of Live — unless you know both you and your opponent can start and finish the game in one sitting. Live games where both players have joined but haven't made a move will be automatically cancelled after 24 hours.
            </p>

            {!liveGamesCollapsed && (
              ongoingLiveGames.length === 0 ? (
              <div className={styles["no-matches"]}>
                No live games to watch right now.
              </div>
            ) : (
              <>
                <div className={styles["ongoing-games-list"]}>
                  {paginatedOngoingLiveGames.map((game) => (
                    <div 
                      key={game.id} 
                      className={styles["ongoing-game-card"]}
                    >
                      <div className={styles["match-header"]}>
                        <span className={styles["match-game-name"]}>
                          <Link to={`/games/${game.game_type_id}`} className={styles["game-name-link"]}>{game.game_name}</Link>
                        </span>
                        <div className={styles["meta-column"]}>
                          <span className={styles["match-time-control"]}>
                            {formatTimeControl(game)}
                          </span>
                          {game.rated !== null && (
                            <span className={styles[game.rated ? 'rated-badge' : 'unrated-badge']}>
                              {game.rated ? 'Rated' : 'Casual'}
                            </span>
                          )}
                          {typeof game.move_count === 'number' && (
                            <span className={styles["move-count-badge"]} title="Moves played so far">
                              {game.move_count} {game.move_count === 1 ? 'move' : 'moves'}
                            </span>
                          )}
                        </div>
                      </div>
                      {renderPlayerStack(game)}
                      <div className={styles["match-actions"]}>
                        <button
                          className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}
                          onClick={() => navigate(`/play/${game.id}`)}
                        >
                          {!currentUser && game.is_anonymous && getStoredAnonCorresId(String(game.id))
                            ? 'Return to Game'
                            : !game.player_ids?.includes(currentUser?.id)
                              ? 'Watch'
                              : game.player_turn == null
                                ? 'Re-join'
                                : game.simultaneous_turns && game.simulSubmittedPlayerIds?.includes(currentUser.id)
                                  ? 'Move Submitted'
                                  : game.simultaneous_turns
                                    ? 'Make Move'
                                    : game.player_ids.indexOf(currentUser.id) + 1 === game.player_turn
                                      ? 'Make Move'
                                      : "Opponent's Turn"}
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
                {totalOngoingLiveGamesPages > 1 && (
                  <div className={styles["pagination"]}>
                    <button
                      disabled={ongoingLiveGamesPage === 1}
                      onClick={() => setOngoingLiveGamesPage(p => p - 1)}
                      className={styles["pagination-btn"]}
                    >
                      ← Prev
                    </button>
                    <span className={styles["pagination-info"]}>
                      {ongoingLiveGamesPage} / {totalOngoingLiveGamesPages}
                    </span>
                    <button
                      disabled={ongoingLiveGamesPage >= totalOngoingLiveGamesPages}
                      onClick={() => setOngoingLiveGamesPage(p => p + 1)}
                      className={styles["pagination-btn"]}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )
            )}
          </div>

          {/* Ongoing Correspondence Games Section */}
          <div className={styles["ongoing-games-section"]} data-section="correspondence-games">
            <h2
              onClick={toggleCorrespondenceGames}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ display: 'inline-block', width: '1em' }}>{correspondenceGamesCollapsed ? '▶' : '▼'}</span>
              Correspondence Games
              {ongoingCorrespondenceGames.length > 0 && (
                <span className={styles["match-count"]}>{ongoingCorrespondenceGames.length}</span>
              )}
            </h2>

            {!correspondenceGamesCollapsed && (
              ongoingCorrespondenceGames.length === 0 ? (
              <div className={styles["no-matches"]}>
                No correspondence games in progress right now.
              </div>
            ) : (
              <>
                <div className={styles["ongoing-games-list"]}>
                  {paginatedOngoingCorrespondenceGames.map((game) => (
                    <div 
                      key={game.id} 
                      className={styles["ongoing-game-card"]}
                    >
                      <div className={styles["match-header"]}>
                        <span className={styles["match-game-name"]}>
                          <Link to={`/games/${game.game_type_id}`} className={styles["game-name-link"]}>{game.game_name}</Link>
                        </span>
                        <div className={styles["meta-column"]}>
                          <span className={styles["match-time-control"]}>
                            {formatTimeControl(game)}
                          </span>
                          {game.rated !== null && (
                            <span className={styles[game.rated ? 'rated-badge' : 'unrated-badge']}>
                              {game.rated ? 'Rated' : 'Casual'}
                            </span>
                          )}
                          {typeof game.move_count === 'number' && (
                            <span className={styles["move-count-badge"]} title="Moves played so far">
                              {game.move_count} {game.move_count === 1 ? 'move' : 'moves'}
                            </span>
                          )}
                        </div>
                      </div>
                      {renderPlayerStack(game)}
                      <div className={styles["match-actions"]}>
                        <button
                          className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}
                          onClick={() => navigate(`/play/${game.id}`)}
                        >
                          {!currentUser && game.is_anonymous && getStoredAnonCorresId(String(game.id))
                            ? 'Return to Game'
                            : !game.player_ids?.includes(currentUser?.id)
                              ? 'Watch'
                              : game.player_turn == null
                                ? 'Re-join'
                                : game.simultaneous_turns && game.simulSubmittedPlayerIds?.includes(currentUser.id)
                                  ? 'Move Submitted'
                                  : game.simultaneous_turns
                                    ? 'Make Move'
                                    : game.player_ids.indexOf(currentUser.id) + 1 === game.player_turn
                                      ? 'Make Move'
                                      : "Opponent's Turn"}
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
                {totalOngoingCorrespondenceGamesPages > 1 && (
                  <div className={styles["pagination"]}>
                    <button
                      disabled={ongoingCorrespondenceGamesPage === 1}
                      onClick={() => setOngoingCorrespondenceGamesPage(p => p - 1)}
                      className={styles["pagination-btn"]}
                    >
                      ← Prev
                    </button>
                    <span className={styles["pagination-info"]}>
                      {ongoingCorrespondenceGamesPage} / {totalOngoingCorrespondenceGamesPages}
                    </span>
                    <button
                      disabled={ongoingCorrespondenceGamesPage >= totalOngoingCorrespondenceGamesPages}
                      onClick={() => setOngoingCorrespondenceGamesPage(p => p + 1)}
                      className={styles["pagination-btn"]}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )
            )}
          </div>

          {/* Public Computer Games Section — all users' public bot games */}
          <div className={styles["ongoing-games-section"]}>
            <h2
              onClick={togglePublicBotGames}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ display: 'inline-block', width: '1em' }}>{publicBotGamesCollapsed ? '▶' : '▼'}</span>
              Computer Games
              {publicBotGames.length > 0 && (
                <span className={styles["match-count"]}>{publicBotGames.length}</span>
              )}
            </h2>

            {!publicBotGamesCollapsed && (
              publicBotGames.length === 0 ? (
                <div className={styles["no-matches"]}>No public computer games are currently active.</div>
              ) : (
                <>
                  <div className={styles["ongoing-games-list"]}>
                    {paginatedPublicBotGames.map((game) => (
                      <div key={game.id} className={styles["ongoing-game-card"]}>
                        <div className={styles["match-header"]}>
                          <span className={styles["match-game-name"]}>
                            <Link to={`/games/${game.game_type_id}`} className={styles["game-name-link"]}>{game.game_name}</Link>
                          </span>
                          <span className={styles["match-time-control"]}>{formatTimeControl(game)}</span>
                        </div>
                        <div className={styles["match-players"]}>{renderPlayerStack(game)}</div>
                        <div className={styles["match-actions"]}>
                          {(() => {
                            const isMyBotGame = currentUser && game.player_ids?.includes(currentUser.id);
                            if (isMyBotGame) {
                              const botPos = game.botPosition || 2;
                              const isMyTurn = game.player_turn !== botPos;
                              return (
                                <button
                                  className={`${styles.btn} ${isMyTurn ? styles["btn-primary"] : styles["btn-secondary"]} ${styles["btn-small"]}`}
                                  onClick={() => navigate(`/play/${game.id}`)}
                                >
                                  {isMyTurn ? 'Make Move' : "Computer's Turn"}
                                </button>
                              );
                            }
                            if (game.allow_spectators) {
                              return (
                                <button
                                  className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}
                                  onClick={() => navigate(`/play/${game.id}`)}
                                >
                                  Spectate
                                </button>
                              );
                            }
                            return null;
                          })()}
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
                  {totalPublicBotGamesPages > 1 && (
                    <div className={styles["pagination"]}>
                      <button disabled={publicBotGamesPage === 1} onClick={() => setPublicBotGamesPage(p => p - 1)} className={styles["pagination-btn"]}>← Prev</button>
                      <span className={styles["pagination-info"]}>{publicBotGamesPage} / {totalPublicBotGamesPages}</span>
                      <button disabled={publicBotGamesPage >= totalPublicBotGamesPages} onClick={() => setPublicBotGamesPage(p => p + 1)} className={styles["pagination-btn"]}>Next →</button>
                    </div>
                  )}
                </>
              )
            )}
          </div>

          {/* Computer Games Section (current user's bot games - only show when not publicly visible) */}
          {currentUser && !currentUser.show_computer_games_publicly && (
            <div className={styles["ongoing-games-section"]}>
              <h2
                onClick={toggleComputerGames}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ display: 'inline-block', width: '1em' }}>{computerGamesCollapsed ? '▶' : '▼'}</span>
                My Computer Games
                {(myBotGames || []).length > 0 && (
                  <span className={styles["match-count"]}>{(myBotGames || []).length}</span>
                )}
              </h2>

              {!computerGamesCollapsed && (
                (myBotGames || []).length === 0 ? (
                  <div className={styles["no-matches"]}>
                    You have no ongoing games against the computer.
                  </div>
                ) : (
                  <>
                    <div className={styles["ongoing-games-list"]}>
                      {paginatedComputerGames.map((game) => (
                        <div key={game.id} className={styles["ongoing-game-card"]}>
                          <div className={styles["match-header"]}>
                            <span className={styles["match-game-name"]}>
                              <Link to={`/games/${game.game_type_id}`} className={styles["game-name-link"]}>{game.game_name}</Link>
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <span className={styles["match-time-control"]}>{formatTimeControl(game)}</span>
                              <span className={styles["unrated-badge"]}>Unrated</span>
                            </div>
                          </div>
                          <div className={styles["match-players"]}>{game.player_names}</div>
                          <div className={styles["match-actions"]}>
                            {(() => {
                              const botPos = game.bot_position || 2;
                              const isMyTurn = game.player_turn !== botPos;
                              return (
                                <button
                                  className={`${styles.btn} ${isMyTurn ? styles["btn-primary"] : styles["btn-secondary"]} ${styles["btn-small"]}`}
                                  onClick={() => navigate(`/play/${game.id}`)}
                                >
                                  {isMyTurn ? 'Make Move' : "Computer's Turn"}
                                </button>
                              );
                            })()}
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
                    {totalComputerGamesPages > 1 && (
                      <div className={styles["pagination"]}>
                        <button
                          disabled={computerGamesPage === 1}
                          onClick={() => setComputerGamesPage(p => p - 1)}
                          className={styles["pagination-btn"]}
                        >
                          ← Prev
                        </button>
                        <span className={styles["pagination-info"]}>
                          {computerGamesPage} / {totalComputerGamesPages}
                        </span>
                        <button
                          disabled={computerGamesPage >= totalComputerGamesPages}
                          onClick={() => setComputerGamesPage(p => p + 1)}
                          className={styles["pagination-btn"]}
                        >
                          Next →
                        </button>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Game Modal */}
      {showCreateModal && currentUser && (
        <div className={styles["modal-overlay"]} onClick={closeCreateModal}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <h2>
              {challengedUserId 
                ? `Challenge ${challengedUsername}` 
                : selectedGameType
                  ? `Create Match: ${selectedGameType.game_name}`
                  : 'Create Match'}
            </h2>
            
            {/* Challenge indicator */}
            {challengedUserId && (
              <div className={styles["challenge-indicator"]}>
                <span>⚔️ Private challenge - only {challengedUsername} can join</span>
                <button
                  className={styles["clear-challenge"]}
                  onClick={() => {
                    setChallengedUserId(null);
                    setChallengedUsername("");
                    setFriendSearch("");
                  }}
                  title="Remove challenge target"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Friend challenge search - show when no challenged user is selected */}
            {!challengedUserId && (
              <div className={styles["form-group"]}>
                <label>Challenge a Friend (optional)</label>
                <div className={styles["friend-search-wrapper"]}>
                  <input
                    type="text"
                    placeholder="Search friends by username..."
                    value={friendSearch}
                    onChange={(e) => setFriendSearch(e.target.value)}
                    className={styles["friend-search-input"]}
                  />
                  {friendSearch && modalFilteredFriends.length > 0 && (
                    <div className={styles["friend-search-results"]}>
                      {modalFilteredFriends.slice(0, 5).map((friend) => (
                        <div
                          key={friend.id}
                          className={styles["friend-search-item"]}
                          onClick={() => {
                            setChallengedUserId(friend.id);
                            setChallengedUsername(friend.username);
                            setFriendSearch("");
                          }}
                        >
                          <span className={styles["friend-name"]}>{friend.username}</span>
                          <span className={styles["friend-elo"]}>ELO: {friend.elo || 1000}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {friendSearch && modalFilteredFriends.length === 0 && (
                    <div className={styles["friend-search-results"]}>
                      <div className={styles["friend-search-empty"]}>
                        No friends match "{friendSearch}"
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Play vs Computer Option */}
            {!challengedUserId && (
              <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
                <ToggleSwitch
                  checked={vsComputer}
                  onChange={(v) => setVsComputer(v)}
                  label="Play vs Computer"
                />
                {vsComputer && (
                  <div className={styles["difficulty-selector"]}>
                    <label>AI Difficulty</label>
                    <div className={styles["difficulty-buttons"]}>
                      {[
                        { value: 'easy', label: 'Easy', desc: 'Casual play' },
                        { value: 'medium', label: 'Medium', desc: 'Moderate challenge' },
                        { value: 'hard', label: 'Hard', desc: 'Strong opponent' },
                        // Adaptive only appears when training data exists
                        // for this game type — see useEffect that fetches
                        // adaptiveAvailability from /api/ai-models/:id/availability.
                        ...(adaptiveAvailability?.available
                          ? [{
                              value: 'adaptive',
                              label: 'Adaptive',
                              desc: `Trained on ${adaptiveAvailability.gamesPlayed} games`,
                            }]
                          : []),
                      ].map(d => (
                        <button
                          key={d.value}
                          className={`${styles["difficulty-btn"]} ${botDifficulty === d.value ? styles["difficulty-active"] : ""}`}
                          onClick={() => setBotDifficulty(d.value)}
                          type="button"
                        >
                          <span className={styles["difficulty-label"]}>{d.label}</span>
                          <span className={styles["difficulty-desc"]}>{d.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Game Mode Tabs */}
            <div className={styles["game-mode-tabs"]}>
              <button
                type="button"
                className={`${styles["game-mode-tab"]} ${gameMode === "live" ? styles["game-mode-tab-active"] : ""}`}
                onClick={() => setGameMode("live")}
              >
                ⚡ Live
              </button>
              <button
                type="button"
                className={`${styles["game-mode-tab"]} ${gameMode === "correspondence" ? styles["game-mode-tab-active"] : ""}`}
                onClick={() => setGameMode("correspondence")}
              >
                📬 Correspondence
              </button>
            </div>

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
                            selectGameType(game);
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

            {/* Player Side Selection */}
            <div className={styles["form-group"]}>
              <label>Play As</label>
              <div className={styles["player-side-buttons"]}>
                <button
                  type="button"
                  className={`${styles["side-btn"]} ${playerSide === "p1" ? styles["side-btn-active"] : ""}`}
                  onClick={() => setPlayerSide("p1")}
                >
                  Player 1
                </button>
                <button
                  type="button"
                  className={`${styles["side-btn"]} ${playerSide === "random" ? styles["side-btn-active"] : ""}`}
                  onClick={() => setPlayerSide("random")}
                >
                  Random
                </button>
                <button
                  type="button"
                  className={`${styles["side-btn"]} ${playerSide === "p2" ? styles["side-btn-active"] : ""}`}
                  onClick={() => setPlayerSide("p2")}
                >
                  Player 2
                </button>
              </div>
            </div>
            
            {gameMode === "live" ? (
              <>
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
                  </div>
                )}
              </>
            ) : (
              <div className={styles["form-group"]}>
                <label>Time per Move</label>
                <select
                  value={correspondenceDays}
                  onChange={(e) => setCorrespondenceDays(e.target.value)}
                >
                  <option value="1">1 day per move</option>
                  <option value="2">2 days per move</option>
                  <option value="3">3 days per move</option>
                  <option value="5">5 days per move</option>
                  <option value="7">7 days per move (1 week)</option>
                  <option value="14">14 days per move (2 weeks)</option>
                </select>
              </div>
            )}

            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
              <ToggleSwitch
                checked={rated && !vsComputer}
                onChange={(v) => setRated(v)}
                label="Rated Game"
                disabled={vsComputer}
              />
            </div>

            <div className={styles["additional-options-section"]} ref={additionalOptionsRef}>
              <button 
                type="button"
                className={styles["additional-options-toggle"]}
                onClick={() => setShowAdditionalOptions(!showAdditionalOptions)}
              >
                <span>Additional Options</span>
                <span className={`${styles["toggle-arrow"]} ${showAdditionalOptions ? styles["open"] : ''}`}>▼</span>
              </button>
              {showAdditionalOptions && (
                <div className={styles["additional-options-content"]}>
            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
              <ToggleSwitch
                checked={allowPremoves}
                onChange={(v) => { setAllowPremoves(v); if (!v) setPremoveTimeCost(false); }}
                label="Allow Premoves"
                tooltip={<InfoTooltip text="Queue your next move while waiting for your opponent to play" />}
              />
            </div>

            {allowPremoves && timeControl !== "0" && gameMode !== "correspondence" && (
            <div className={`${styles["form-group"]} ${styles["checkbox-group"]} ${styles["sub-option"]}`}>
              <ToggleSwitch
                checked={premoveTimeCost}
                onChange={(v) => setPremoveTimeCost(v)}
                label="Premove Clock Cost"
                tooltip={<InfoTooltip text="Deducts 0.1 seconds from the clock per premove instead of being free" />}
              />
            </div>
            )}

            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
              <ToggleSwitch
                checked={showPieceHelpers}
                onChange={(v) => setShowPieceHelpers(v)}
                label="Show Movement Helpers"
                tooltip={<InfoTooltip text="Display movement and capture indicators when hovering over pieces" />}
              />
            </div>

            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
              <ToggleSwitch
                checked={allowSpectators}
                onChange={(v) => setAllowSpectators(v)}
                label="Allow Spectators"
                tooltip={<InfoTooltip text="Let other players watch the game in progress" />}
              />
            </div>

            {timeControl !== "0" && gameMode !== "correspondence" && (
            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
              <ToggleSwitch
                checked={materialClockPenalty}
                onChange={(v) => { setMaterialClockPenalty(v); if (v) setMaterialClockHandicap(false); }}
                label="Material Clock Penalty"
                tooltip={<InfoTooltip text="Lose time for each piece captured — the more material you lose, the less time you have" />}
              />
            </div>
            )}
            {timeControl !== "0" && gameMode !== "correspondence" && (
            <div className={`${styles["form-group"]} ${styles["checkbox-group"]}`}>
              <ToggleSwitch
                checked={materialClockHandicap}
                onChange={(v) => { setMaterialClockHandicap(v); if (v) setMaterialClockPenalty(false); }}
                label="Material Clock Handicap"
                tooltip={<InfoTooltip text="The player with more material gets less time, balancing the advantage" />}
              />
            </div>
            )}
                </div>
              )}
            </div>

            {/* Starting Position Mode Selection */}

            {allowedStartingModes.length === 1 ? (
              <div className={`${styles["form-group"]} ${styles["starting-position-group"]}`}>
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
              <div className={`${styles["form-group"]} ${styles["starting-position-group"]}`}>
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
                  : vsComputer
                    ? "Play vs Computer"
                    : challengedUserId 
                      ? "Send Challenge" 
                      : "Create Match"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anonymous Create Game Modal */}
      {showAnonCreateModal && !currentUser && (
        <div className={styles["modal-overlay"]} onClick={() => setShowAnonCreateModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <h2>Create Anonymous Game: {selectedGameType?.game_name}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px' }}>
              This game is unrated and will appear in the Open Matches section. You'll also get an invite code to share directly.
            </p>
            <div className={styles["form-group"]}>
              <label>Your display name:</label>
              <input
                type="text"
                maxLength={20}
                placeholder="Guest"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
            </div>
            <div className={styles["form-group"]}>
              <ToggleSwitch
                checked={anonIsCorrespondence}
                onChange={setAnonIsCorrespondence}
                label="Correspondence game (take turns over days — no clock)"
                labelPlacement="left"
              />
            </div>
            {anonIsCorrespondence ? (
              <div className={styles["form-group"]}>
                <label>Days per turn:</label>
                <select value={anonCorrDays} onChange={(e) => setAnonCorrDays(e.target.value)}>
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                </select>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
                  Your progress is saved in this browser. Bookmark the game link as a fallback.
                </p>
              </div>
            ) : (
              <>
                <div className={styles["form-group"]}>
                  <label>Time Control (minutes per side):</label>
                  <select value={anonTimeControl} onChange={(e) => setAnonTimeControl(e.target.value)}>
                    <option value="0">No limit</option>
                    <option value="1">1 min</option>
                    <option value="3">3 min</option>
                    <option value="5">5 min</option>
                    <option value="10">10 min</option>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                  </select>
                </div>
                <div className={styles["form-group"]}>
                  <label>Increment (seconds per move):</label>
                  <select value={anonIncrement} onChange={(e) => setAnonIncrement(e.target.value)}>
                    <option value="0">None</option>
                    <option value="1">1s</option>
                    <option value="2">2s</option>
                    <option value="3">3s</option>
                    <option value="5">5s</option>
                    <option value="10">10s</option>
                  </select>
                </div>
              </>
            )}
            <div className={styles["modal-actions"]}>
              <button
                className={`${styles.btn} ${styles["btn-secondary"]}`}
                onClick={() => setShowAnonCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handleCreateAnonymousGame}
                disabled={isCreatingAnonymous}
              >
                {isCreatingAnonymous ? "Creating..." : "Create Open Match"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join as Guest Modal — used for both anonymous games (via invite code) and unrated open games */}
      {showJoinAnonModal && joiningAnonGame && (
        <div className={styles["modal-overlay"]} onClick={() => setShowJoinAnonModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <h2>Join Game: {joiningAnonGame.game_name || joiningAnonGame.gameTypeName}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px' }}>
              Playing as a guest. This game is unrated.
            </p>
            <div className={styles["form-group"]}>
              <label>Your display name:</label>
              <input
                type="text"
                maxLength={20}
                placeholder="Guest"
                value={joinAnonGuestName}
                onChange={(e) => setJoinAnonGuestName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const isAnonGame = joiningAnonGame.is_anonymous === 1 || joiningAnonGame.is_anonymous === true;
                    if (isAnonGame) handleConfirmJoinAnonGame(); else handleConfirmJoinGuestOpenGame();
                  }
                }}
              />
            </div>
            <div className={styles["modal-actions"]}>
              <button
                className={`${styles.btn} ${styles["btn-secondary"]}`}
                onClick={() => setShowJoinAnonModal(false)}
              >
                Cancel
              </button>
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={() => {
                  const isAnonGame = joiningAnonGame.is_anonymous === 1 || joiningAnonGame.is_anonymous === true;
                  if (isAnonGame) handleConfirmJoinAnonGame(); else handleConfirmJoinGuestOpenGame();
                }}
                disabled={isJoiningAnon}
              >
                {isJoiningAnon ? "Joining..." : "Join as Guest"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Limit Reached Modal */}
      {limitError && (
        <div className={styles["modal-overlay"]} onClick={() => setLimitError(null)}>
          <div className={styles["limit-modal"]} onClick={(e) => e.stopPropagation()}>
            <div className={styles["limit-modal-header"]}>
              <span className={styles["limit-modal-icon"]}>
                {limitError.limitType === 'correspondence' ? '📬' :
                 limitError.limitType === 'open' ? '🕐' : '⚡'}
              </span>
              <h2>
                {limitError.limitType === 'correspondence' && 'Correspondence Game Limit Reached'}
                {limitError.limitType === 'live' && 'Live Game Limit Reached'}
                {limitError.limitType === 'open' && 'Open Match Limit Reached'}
                {limitError.limitType === 'live_anon' && 'Anonymous Game Limit Reached'}
              </h2>
            </div>
            <div className={styles["limit-modal-count"]}>
              {limitError.limitCount !== undefined && limitError.limitMax !== undefined && (
                <span>{limitError.limitCount} / {limitError.limitMax}</span>
              )}
            </div>
            <p className={styles["limit-modal-message"]}>{limitError.message}</p>
            <div className={styles["limit-modal-actions"]}>
              {(limitError.limitType === 'live' || limitError.limitType === 'open') && currentUser && (
                <button
                  className={`${styles.btn} ${styles["btn-secondary"]}`}
                  onClick={() => {
                    setLimitError(null);
                    ongoingGamesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  View My Live Games
                </button>
              )}
              {limitError.limitType === 'correspondence' && currentUser && (
                <button
                  className={`${styles.btn} ${styles["btn-secondary"]}`}
                  onClick={() => {
                    setLimitError(null);
                    // Scroll to correspondence section (after live games section)
                    document.querySelector('[data-section="correspondence-games"]')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  View My Correspondence Games
                </button>
              )}
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={() => setLimitError(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Play;