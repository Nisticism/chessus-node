import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useSelector } from 'react-redux';

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
  const [openGames, setOpenGames] = useState([]);
  const [ongoingGames, setOngoingGames] = useState([]);
  const [privateGames, setPrivateGames] = useState([]);
  const [currentGame, setCurrentGame] = useState(null);
  const { user } = useSelector((state) => state.authReducer);
  const reconnectAttempts = useRef(0);
  const lastAuthRef = useRef(null); // Track last auth to prevent duplicate emits
  const maxReconnectAttempts = 5;

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(getSocketUrl(), {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'], // Prefer websocket, fall back to polling
      withCredentials: true,
    });

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setConnected(true);
      reconnectAttempts.current = 0;
      // Authentication is handled by the separate useEffect that watches [user, socket, connected]
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setConnected(false);
      lastAuthRef.current = null; // Reset so re-auth works on reconnect
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      reconnectAttempts.current += 1;
    });

    // Game events
    newSocket.on('openGamesList', (games) => {
      setOpenGames(games);
    });

    newSocket.on('ongoingGamesList', (games) => {
      setOngoingGames(games);
    });

    newSocket.on('privateGamesList', (games) => {
      setPrivateGames(games);
    });

    newSocket.on('newOpenGame', (game) => {
      setOpenGames(prev => [game, ...prev]);
    });

    newSocket.on('gameRemoved', ({ gameId }) => {
      setOpenGames(prev => prev.filter(g => g.id !== gameId && g.gameId !== gameId));
    });

    newSocket.on('gameStarted', ({ gameId }) => {
      // Move from open to ongoing
      setOpenGames(prev => prev.filter(g => g.id !== gameId && g.gameId !== gameId));
      setPrivateGames(prev => prev.filter(g => g.id !== gameId && g.gameId !== gameId));
      // Refresh ongoing games list when a game starts
      newSocket.emit('getOngoingGames');
    });

    newSocket.on('error', ({ message }) => {
      console.error('Socket error:', message);
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

      const handleError = ({ message }) => {
        cleanup();
        reject(new Error(message));
      };

      socket.on('gameCreated', handleGameCreated);
      socket.on('error', handleError);

      const emitData = {
        ...gameData,
        hostId: user?.id,
        hostUsername: user?.username
      };
      console.log('Creating game with data:', emitData);
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

      const handleError = ({ message }) => {
        cleanup();
        reject(new Error(message));
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

      const handleError = ({ message }) => {
        cleanup();
        reject(new Error(message));
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

      const handleError = ({ message }) => {
        cleanup();
        reject(new Error(message));
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
  const spectateGame = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('spectateGame', { gameId });
  }, [socket, connected]);

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
    openGames,
    ongoingGames,
    privateGames,
    currentGame,
    setCurrentGame,
    fetchOpenGames,
    fetchOngoingGames,
    fetchPrivateGames,
    createGame,
    createAnonymousGame,
    joinGame,
    joinByInviteCode,
    getGameState,
    makeMove,
    resign,
    offerDraw,
    acceptDraw,
    declineDraw,
    cancelGame,
    spectateGame,
    setPremove,
    clearPremove,
    promotePiece,
    onGameEvent
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
