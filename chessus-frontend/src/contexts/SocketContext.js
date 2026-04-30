import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useSelector, useDispatch } from 'react-redux';
import {
  SET_LOBBY_OPEN_GAMES,
  SET_LOBBY_ONGOING_GAMES,
  SET_LOBBY_MY_BOT_GAMES,
  SET_LOBBY_PRIVATE_GAMES,
  ADD_LOBBY_OPEN_GAME,
  REMOVE_LOBBY_OPEN_GAME,
  LOBBY_GAME_STARTED,
  NEW_NOTIFICATION,
  GET_UNREAD_COUNT_SUCCESS,
  NEW_DIRECT_MESSAGE,
} from '../actions/types';

const SocketContext = createContext(null);

// Get socket URL from environment or use default
const getSocketUrl = () => {
  // In production, connect to same origin
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  // In development, connect to backend server
  return 'http://localhost:3001';
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [currentGame, setCurrentGame] = useState(null);
  const { user } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  const reconnectAttempts = useRef(0);
  const lastAuthRef = useRef(null); // Track last auth to prevent duplicate emits
  const dispatchRef = useRef(dispatch);

  // Keep dispatch ref current
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(getSocketUrl(), {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      transports: ['websocket', 'polling'], // Prefer websocket, fall back to polling
      withCredentials: true,
    });

    newSocket.on('connect', () => {
      setConnected(true);
      reconnectAttempts.current = 0;
      // Authentication is handled by the separate useEffect that watches [user, socket, connected]
    });

    newSocket.on('disconnect', (reason) => {
      setConnected(false);
      lastAuthRef.current = null; // Reset so re-auth works on reconnect
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      reconnectAttempts.current += 1;
    });

    // Game events
    newSocket.on('openGamesList', (games) => {
      dispatchRef.current({ type: SET_LOBBY_OPEN_GAMES, payload: games });
    });

    newSocket.on('ongoingGamesList', (games) => {
      dispatchRef.current({ type: SET_LOBBY_ONGOING_GAMES, payload: games });
    });

    newSocket.on('myBotGamesList', (games) => {
      dispatchRef.current({ type: SET_LOBBY_MY_BOT_GAMES, payload: games });
    });

    newSocket.on('privateGamesList', (games) => {
      dispatchRef.current({ type: SET_LOBBY_PRIVATE_GAMES, payload: games });
    });

    newSocket.on('newOpenGame', (game) => {
      dispatchRef.current({ type: ADD_LOBBY_OPEN_GAME, payload: game });
    });

    newSocket.on('gameRemoved', ({ gameId }) => {
      dispatchRef.current({ type: REMOVE_LOBBY_OPEN_GAME, payload: gameId });
    });

    newSocket.on('gameStarted', ({ gameId }) => {
      // Move from open to ongoing
      dispatchRef.current({ type: LOBBY_GAME_STARTED, payload: gameId });
      // Refresh ongoing games list when a game starts
      newSocket.emit('getOngoingGames');
    });

    newSocket.on('error', ({ message }) => {
      console.error('Socket error:', message);
    });

    // Real-time notification and DM listeners
    newSocket.on('newNotification', (notification) => {
      dispatchRef.current({ type: NEW_NOTIFICATION, payload: notification });
    });

    newSocket.on('unreadNotificationCount', ({ unreadCount }) => {
      dispatchRef.current({ type: GET_UNREAD_COUNT_SUCCESS, payload: unreadCount });
    });

    newSocket.on('newDirectMessage', (message) => {
      dispatchRef.current({ type: NEW_DIRECT_MESSAGE, payload: message });
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Re-authenticate when user changes
  useEffect(() => {
    if (socket && connected && user) {
      // Prevent duplicate auth for the same user/socket combination
      const authKey = `${user.id}-${socket.id}`;
      if (lastAuthRef.current === authKey) return;
      lastAuthRef.current = authKey;

      socket.emit('authenticate', {
        userId: user.id,
        username: user.username
      });
    }
  }, [user, socket, connected]);

  // Fetch open games
  const fetchOpenGames = useCallback(() => {
    if (socket && connected) {
      socket.emit('getOpenGames');
    }
  }, [socket, connected]);

  // Fetch private/challenge games for current user
  const fetchPrivateGames = useCallback(() => {
    if (socket && connected) {
      socket.emit('getPrivateGames');
    }
  }, [socket, connected]);

  // Fetch ongoing games (for spectating)
  const fetchOngoingGames = useCallback(() => {
    if (socket && connected) {
      socket.emit('getOngoingGames');
    }
  }, [socket, connected]);

  // Fetch the current user's ongoing games against the computer
  const fetchMyBotGames = useCallback(() => {
    if (socket && connected) {
      socket.emit('getMyBotGames');
    }
  }, [socket, connected]);

  // Create a new game
  const createGame = useCallback((gameData) => {
    return new Promise((resolve, reject) => {
      if (!socket || !connected) {
        reject(new Error('Not connected'));
        return;
      }

      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off('gameCreated', handleGameCreated);
        socket.off('error', handleError);
      };

      const handleGameCreated = ({ gameId, gameState }) => {
        cleanup();
        setCurrentGame(gameState);
        resolve({ gameId, gameState });
      };

      const handleError = (errorData) => {
        cleanup();
        const err = new Error(errorData.message);
        if (errorData.code) err.code = errorData.code;
        if (errorData.limitType) err.limitType = errorData.limitType;
        if (errorData.limitCount !== undefined) err.limitCount = errorData.limitCount;
        if (errorData.limitMax !== undefined) err.limitMax = errorData.limitMax;
        reject(err);
      };

      socket.on('gameCreated', handleGameCreated);
      socket.on('error', handleError);

      const emitData = {
        ...gameData,
        hostId: user?.id,
        hostUsername: user?.username
      };
      socket.emit('createGame', emitData);

      // Timeout after 10 seconds
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Game creation timed out'));
      }, 10000);
    });
  }, [socket, connected, user]);

  // Join an existing game
  const joinGame = useCallback((gameId) => {
    return new Promise((resolve, reject) => {
      if (!socket || !connected) {
        reject(new Error('Not connected'));
        return;
      }

      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off('playerJoined', handlePlayerJoined);
        socket.off('error', handleError);
      };

      const handlePlayerJoined = ({ gameId: joinedGameId, gameState, newPlayer }) => {
        if (joinedGameId === gameId) {
          cleanup();
          setCurrentGame(gameState);
          resolve({ gameState, newPlayer });
        }
      };

      const handleError = (errorData) => {
        cleanup();
        const err = new Error(errorData.message);
        if (errorData.code) err.code = errorData.code;
        if (errorData.limitType) err.limitType = errorData.limitType;
        if (errorData.limitCount !== undefined) err.limitCount = errorData.limitCount;
        if (errorData.limitMax !== undefined) err.limitMax = errorData.limitMax;
        reject(err);
      };

      socket.on('playerJoined', handlePlayerJoined);
      socket.on('error', handleError);

      socket.emit('joinGame', {
        gameId,
        userId: user?.id,
        username: user?.username
      });

      // Timeout after 10 seconds
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Join game timed out'));
      }, 10000);
    });
  }, [socket, connected, user]);

  // Create an anonymous game (no account required)
  const createAnonymousGame = useCallback((gameData) => {
    return new Promise((resolve, reject) => {
      if (!socket || !connected) {
        reject(new Error('Not connected'));
        return;
      }

      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off('gameCreated', handleGameCreated);
        socket.off('error', handleError);
      };

      const handleGameCreated = ({ gameId, gameState, inviteCode }) => {
        cleanup();
        setCurrentGame(gameState);
        resolve({ gameId, gameState, inviteCode });
      };

      const handleError = (errorData) => {
        cleanup();
        const err = new Error(errorData.message);
        if (errorData.code) err.code = errorData.code;
        if (errorData.limitType) err.limitType = errorData.limitType;
        if (errorData.limitCount !== undefined) err.limitCount = errorData.limitCount;
        if (errorData.limitMax !== undefined) err.limitMax = errorData.limitMax;
        reject(err);
      };

      socket.on('gameCreated', handleGameCreated);
      socket.on('error', handleError);

      socket.emit('createAnonymousGame', gameData);

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Game creation timed out'));
      }, 10000);
    });
  }, [socket, connected]);

  // Join a game by invite code (no account required)
  const joinByInviteCode = useCallback((inviteCode, guestName) => {
    return new Promise((resolve, reject) => {
      if (!socket || !connected) {
        reject(new Error('Not connected'));
        return;
      }

      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off('playerJoined', handlePlayerJoined);
        socket.off('error', handleError);
      };

      const handlePlayerJoined = ({ gameId, gameState, newPlayer }) => {
        cleanup();
        setCurrentGame(gameState);
        resolve({ gameId, gameState, newPlayer });
      };

      const handleError = (errorData) => {
        cleanup();
        const err = new Error(errorData.message);
        if (errorData.code) err.code = errorData.code;
        if (errorData.limitType) err.limitType = errorData.limitType;
        if (errorData.limitCount !== undefined) err.limitCount = errorData.limitCount;
        if (errorData.limitMax !== undefined) err.limitMax = errorData.limitMax;
        reject(err);
      };

      socket.on('playerJoined', handlePlayerJoined);
      socket.on('error', handleError);

      socket.emit('joinByInviteCode', {
        inviteCode,
        guestName: guestName || 'Guest',
        userId: user?.id || null,
        username: user?.username || null
      });

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Join game timed out'));
      }, 10000);
    });
  }, [socket, connected, user]);

  // Join an open (non-anonymous) game as a guest (unrated games only)
  const joinOpenGameAsGuest = useCallback((gameId, guestName) => {
    return new Promise((resolve, reject) => {
      if (!socket || !connected) {
        reject(new Error('Not connected'));
        return;
      }

      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off('playerJoined', handlePlayerJoined);
        socket.off('error', handleError);
      };

      const handlePlayerJoined = ({ gameId: joinedGameId, gameState, newPlayer }) => {
        if (joinedGameId === gameId) {
          cleanup();
          setCurrentGame(gameState);
          resolve({ gameState, newPlayer });
        }
      };

      const handleError = (errorData) => {
        cleanup();
        const err = new Error(errorData.message);
        if (errorData.code) err.code = errorData.code;
        if (errorData.limitType) err.limitType = errorData.limitType;
        if (errorData.limitCount !== undefined) err.limitCount = errorData.limitCount;
        if (errorData.limitMax !== undefined) err.limitMax = errorData.limitMax;
        reject(err);
      };

      socket.on('playerJoined', handlePlayerJoined);
      socket.on('error', handleError);

      socket.emit('joinOpenGameAsGuest', {
        gameId,
        guestName: guestName || 'Guest'
      });

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Join game timed out'));
      }, 10000);
    });
  }, [socket, connected]);

  // Get game state (for reconnection or spectating)
  const getGameState = useCallback((gameId) => {
    return new Promise((resolve, reject) => {
      if (!socket || !connected) {
        reject(new Error('Not connected'));
        return;
      }

      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off('gameState', handleGameState);
        socket.off('error', handleError);
      };

      const handleGameState = (gameState) => {
        cleanup();
        setCurrentGame(gameState);
        resolve(gameState);
      };

      const handleError = ({ message }) => {
        cleanup();
        reject(new Error(message));
      };

      socket.on('gameState', handleGameState);
      socket.on('error', handleError);

      socket.emit('getGameState', { gameId });

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Get game state timed out'));
      }, 10000);
    });
  }, [socket, connected]);

  // Make a move
  const makeMove = useCallback((gameId, move) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('makeMove', {
      gameId,
      userId: user?.id || `anon_${socket.id}`,
      move
    });
  }, [socket, connected, user]);

  // Simul-turns: signal that this player is ready to start the game.
  // Once both players have signaled, the server transitions to active and
  // the clocks begin.
  const simulReadyToStart = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }
    socket.emit('simulReadyToStart', {
      gameId,
      userId: user?.id || `anon_${socket.id}`,
    });
  }, [socket, connected, user]);

  // Simul-turns: deliver a player's promotion target for a buffered move
  // that landed on a promotion square. The submission stays "awaiting
  // promotion" until this fires, then the round can resolve.
  const simulPromotionChoice = useCallback((gameId, pieceId, promoteToPieceId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }
    socket.emit('simulPromotionChoice', {
      gameId,
      userId: user?.id || `anon_${socket.id}`,
      pieceId,
      promoteToPieceId,
    });
  }, [socket, connected, user]);

  // Resign from game
  const resign = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('resign', {
      gameId,
      userId: user?.id || `anon_${socket.id}`
    });
  }, [socket, connected, user]);

  // Offer a draw
  const offerDraw = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('offerDraw', {
      gameId
    });
  }, [socket, connected]);

  // Accept a draw offer
  const acceptDraw = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('acceptDraw', {
      gameId
    });
  }, [socket, connected]);

  // Decline a draw offer
  const declineDraw = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('declineDraw', {
      gameId
    });
  }, [socket, connected]);

  // Pause the opponent's disconnect-forfeit timer (give them more time)
  const pauseDisconnectTimer = useCallback((gameId) => {
    if (!socket || !connected) return;
    socket.emit('pauseDisconnectTimer', { gameId });
  }, [socket, connected]);

  // Resume (restart) the opponent's disconnect-forfeit timer
  const resumeDisconnectTimer = useCallback((gameId) => {
    if (!socket || !connected) return;
    socket.emit('resumeDisconnectTimer', { gameId });
  }, [socket, connected]);

  // Cancel a waiting game
  const cancelGame = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('cancelGame', {
      gameId,
      userId: user?.id || `anon_${socket.id}`
    });
    setCurrentGame(null);
  }, [socket, connected, user]);

  // Spectate a game
  const spectateGame = useCallback((gameId, options = {}) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    const { anonymous = false } = options;
    socket.emit('spectateGame', {
      gameId,
      userId: anonymous ? `anon_${socket.id}` : (user?.id || `anon_${socket.id}`),
      username: anonymous ? 'Anonymous' : (user?.username || 'Guest'),
      anonymous
    });
  }, [socket, connected, user]);

  // Set a premove
  const setPremove = useCallback((gameId, move) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('setPremove', {
      gameId,
      userId: user?.id || `anon_${socket.id}`,
      move
    });
  }, [socket, connected, user]);

  // Clear a premove
  const clearPremove = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('clearPremove', {
      gameId,
      userId: user?.id || `anon_${socket.id}`
    });
  }, [socket, connected, user]);

  // Promote a piece
  const promotePiece = useCallback((gameId, pieceId, promoteToPieceId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('promotePiece', {
      gameId,
      userId: user?.id || `anon_${socket.id}`,
      pieceId,
      promoteToPieceId
    });
  }, [socket, connected, user]);

  // Subscribe to game events
  const onGameEvent = useCallback((event, callback) => {
    if (!socket) return () => {};

    socket.on(event, callback);
    return () => socket.off(event, callback);
  }, [socket]);

  const value = {
    socket,
    connected,
    currentGame,
    setCurrentGame,
    fetchOpenGames,
    fetchOngoingGames,
    fetchPrivateGames,
    fetchMyBotGames,
    createGame,
    createAnonymousGame,
    joinGame,
    joinByInviteCode,
    joinOpenGameAsGuest,
    getGameState,
    makeMove,
    simulReadyToStart,
    simulPromotionChoice,
    resign,
    offerDraw,
    acceptDraw,
    declineDraw,
    cancelGame,
    spectateGame,
    setPremove,
    clearPremove,
    promotePiece,
    onGameEvent,
    pauseDisconnectTimer,
    resumeDisconnectTimer
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export default SocketContext;
