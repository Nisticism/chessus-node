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
  const [currentGame, setCurrentGame] = useState(null);
  const { user } = useSelector((state) => state.authReducer);
  const reconnectAttempts = useRef(0);
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

      // Authenticate if user is logged in
      if (user) {
        newSocket.emit('authenticate', {
          userId: user.id,
          username: user.username
        });
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setConnected(false);
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

    newSocket.on('newOpenGame', (game) => {
      setOpenGames(prev => [game, ...prev]);
    });

    newSocket.on('gameRemoved', ({ gameId }) => {
      setOpenGames(prev => prev.filter(g => g.id !== gameId && g.gameId !== gameId));
    });

    newSocket.on('gameStarted', ({ gameId }) => {
      // Move from open to ongoing
      setOpenGames(prev => prev.filter(g => g.id !== gameId && g.gameId !== gameId));
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

      const handleGameCreated = ({ gameId, gameState }) => {
        socket.off('gameCreated', handleGameCreated);
        socket.off('error', handleError);
        setCurrentGame(gameState);
        resolve({ gameId, gameState });
      };

      const handleError = ({ message }) => {
        socket.off('gameCreated', handleGameCreated);
        socket.off('error', handleError);
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
      setTimeout(() => {
        socket.off('gameCreated', handleGameCreated);
        socket.off('error', handleError);
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

      const handlePlayerJoined = ({ gameId: joinedGameId, gameState, newPlayer }) => {
        if (joinedGameId === gameId) {
          socket.off('playerJoined', handlePlayerJoined);
          socket.off('error', handleError);
          setCurrentGame(gameState);
          resolve({ gameState, newPlayer });
        }
      };

      const handleError = ({ message }) => {
        socket.off('playerJoined', handlePlayerJoined);
        socket.off('error', handleError);
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
      setTimeout(() => {
        socket.off('playerJoined', handlePlayerJoined);
        socket.off('error', handleError);
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

      const handleGameState = (gameState) => {
        socket.off('gameState', handleGameState);
        socket.off('error', handleError);
        setCurrentGame(gameState);
        resolve(gameState);
      };

      const handleError = ({ message }) => {
        socket.off('gameState', handleGameState);
        socket.off('error', handleError);
        reject(new Error(message));
      };

      socket.on('gameState', handleGameState);
      socket.on('error', handleError);

      socket.emit('getGameState', { gameId });

      setTimeout(() => {
        socket.off('gameState', handleGameState);
        socket.off('error', handleError);
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
      userId: user?.id,
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
      userId: user?.id
    });
  }, [socket, connected, user]);

  // Cancel a waiting game
  const cancelGame = useCallback((gameId) => {
    if (!socket || !connected) {
      console.error('Not connected');
      return;
    }

    socket.emit('cancelGame', {
      gameId,
      userId: user?.id
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
      userId: user?.id,
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
      userId: user?.id
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
    currentGame,
    setCurrentGame,
    fetchOpenGames,
    fetchOngoingGames,
    createGame,
    joinGame,
    getGameState,
    makeMove,
    resign,
    cancelGame,
    spectateGame,
    setPremove,
    clearPremove,
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
