/**
 * Socket.io Game Handler
 * Manages real-time multiplayer game functionality
 */

const db_pool = require("../configs/db");

// Store active games in memory for quick access
const activeGames = new Map();
const playerSockets = new Map(); // Maps socket.id to userId
const userSockets = new Map(); // Maps userId to socket.id

/**
 * Initialize Socket.io with the HTTP server
 */
function initializeSocket(server) {
  const { Server } = require("socket.io");
  
  const io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const allowedOrigins = [
          'http://localhost:3000',
          'http://localhost:3001',
          /^https?:\/\/(www\.)?squarestrat\.com$/,
        ];
        const isAllowed = allowedOrigins.some(pattern => {
          if (typeof pattern === 'string') {
            return origin === pattern;
          }
          return pattern.test(origin);
        });
        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Authenticate user
    socket.on("authenticate", async (data) => {
      const { userId, username } = data;
      if (userId) {
        playerSockets.set(socket.id, { id: userId, username });
        userSockets.set(userId.toString(), socket.id);
        socket.userId = userId;
        socket.username = username;
        console.log(`User ${username} (ID: ${userId}) authenticated on socket ${socket.id}`);
      }
    });

    // Get list of open games waiting for players
    socket.on("getOpenGames", async () => {
      try {
        const openGames = await getOpenLiveGames();
        socket.emit("openGamesList", openGames);
      } catch (error) {
        console.error("Error fetching open games:", error);
        socket.emit("error", { message: "Failed to fetch open games" });
      }
    });

    // Create a new live game
    socket.on("createGame", async (data) => {
      try {
        const { gameTypeId, timeControl, increment, hostId, hostUsername } = data;
        
        // Get game type details
        const [[gameType]] = await db_pool.query(
          "SELECT * FROM game_types WHERE id = ?",
          [gameTypeId]
        );
        
        if (!gameType) {
          return socket.emit("error", { message: "Game type not found" });
        }

        // Create the live game in database
        const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        // Convert pieces_string from object format {"row,col": {...}} to array format [{x, y, ...}]
        let piecesArray = [];
        try {
          const piecesObj = JSON.parse(gameType.pieces_string || "{}");
          // If it's already an array, use it directly
          if (Array.isArray(piecesObj)) {
            piecesArray = piecesObj;
          } else {
            // Convert from object format to array format
            Object.entries(piecesObj).forEach(([key, pieceData]) => {
              const [row, col] = key.split(',').map(Number);
              piecesArray.push({
                ...pieceData,
                x: col,  // col is x coordinate
                y: row,  // row is y coordinate
                id: `${pieceData.piece_id}_${row}_${col}` // Unique ID for this piece instance
              });
            });
          }
        } catch (e) {
          console.error("Error parsing pieces_string:", e);
          piecesArray = [];
        }
        
        const piecesData = JSON.stringify(piecesArray);
        
        const [result] = await db_pool.query(
          `INSERT INTO games (created_at, turn_length, increment, player_count, player_turn, pieces, other_data, game_type_id, status, host_id)
           VALUES (?, ?, ?, 2, 1, ?, ?, ?, 'waiting', ?)`,
          [currentTime, timeControl, increment || 0, piecesData, JSON.stringify({ moves: [] }), gameTypeId, hostId]
        );

        const gameId = result.insertId;

        // Create player entry for host
        await db_pool.query(
          `INSERT INTO players (created_at, player_position, time_remaining, game_id, user_id, game_type_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [currentTime, null, timeControl, gameId, hostId, gameTypeId]
        );

        // Store game in memory
        const gameState = {
          id: gameId,
          gameTypeId,
          gameType: gameType,
          timeControl,
          increment: increment || 0,
          status: 'waiting',
          hostId,
          hostUsername,
          players: [{ id: hostId, username: hostUsername, position: null }],
          pieces: piecesArray,
          currentTurn: 1,
          moveHistory: [],
          startTime: null,
          playerTimes: {}
        };

        activeGames.set(gameId.toString(), gameState);

        // Join the game room
        socket.join(`game-${gameId}`);

        // Emit game created event
        socket.emit("gameCreated", { gameId, gameState });

        // Broadcast to all users that a new game is available
        io.emit("newOpenGame", {
          gameId,
          hostUsername,
          gameTypeName: gameType.game_name,
          timeControl,
          increment: increment || 0
        });

        console.log(`Game ${gameId} created by ${hostUsername}`);
      } catch (error) {
        console.error("Error creating game:", error);
        socket.emit("error", { message: "Failed to create game" });
      }
    });

    // Join an existing game
    socket.on("joinGame", async (data) => {
      try {
        const { gameId, userId, username } = data;
        const gameIdStr = gameId.toString();

        // Get game from memory or database
        let gameState = activeGames.get(gameIdStr);
        
        if (!gameState) {
          // Try to load from database
          const [[game]] = await db_pool.query(
            "SELECT * FROM games WHERE id = ? AND status = 'waiting'",
            [gameId]
          );
          
          if (!game) {
            return socket.emit("error", { message: "Game not found or already started" });
          }

          // Get game type
          const [[gameType]] = await db_pool.query(
            "SELECT * FROM game_types WHERE id = ?",
            [game.game_type_id]
          );

          // Get host info
          const [[hostPlayer]] = await db_pool.query(
            `SELECT p.*, u.username FROM players p
             JOIN users u ON p.user_id = u.id
             WHERE p.game_id = ? LIMIT 1`,
            [gameId]
          );

          gameState = {
            id: gameId,
            gameTypeId: game.game_type_id,
            gameType: gameType,
            timeControl: game.turn_length,
            increment: game.increment || 0,
            status: game.status,
            hostId: game.host_id,
            hostUsername: hostPlayer?.username || 'Unknown',
            players: [{ id: hostPlayer.user_id, username: hostPlayer.username, position: null }],
            pieces: JSON.parse(game.pieces || "[]"),
            currentTurn: 1,
            moveHistory: [],
            startTime: null,
            playerTimes: {}
          };

          activeGames.set(gameIdStr, gameState);
        }

        // Check if game is full
        if (gameState.players.length >= 2) {
          return socket.emit("error", { message: "Game is full" });
        }

        // Check if user is already in the game
        if (gameState.players.some(p => p.id === userId)) {
          return socket.emit("error", { message: "You are already in this game" });
        }

        // Add player to game
        const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        await db_pool.query(
          `INSERT INTO players (created_at, player_position, time_remaining, game_id, user_id, game_type_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [currentTime, null, gameState.timeControl, gameId, userId, gameState.gameTypeId]
        );

        gameState.players.push({ id: userId, username, position: null });

        // Randomly assign positions (player 1 = white/first, player 2 = black/second)
        const positions = [1, 2];
        const shuffled = positions.sort(() => Math.random() - 0.5);
        
        gameState.players.forEach((player, index) => {
          player.position = shuffled[index];
        });

        // Update database with positions
        for (const player of gameState.players) {
          await db_pool.query(
            "UPDATE players SET player_position = ? WHERE game_id = ? AND user_id = ?",
            [player.position, gameId, player.id]
          );
        }

        // Initialize player times
        const timeInSeconds = gameState.timeControl ? gameState.timeControl * 60 : null;
        gameState.players.forEach(player => {
          gameState.playerTimes[player.id] = timeInSeconds;
        });

        // Update game status to ready
        gameState.status = 'ready';
        await db_pool.query(
          "UPDATE games SET status = 'ready' WHERE id = ?",
          [gameId]
        );

        // Join the game room
        socket.join(`game-${gameId}`);

        // Notify all players in the game
        io.to(`game-${gameId}`).emit("playerJoined", {
          gameId,
          gameState,
          newPlayer: { id: userId, username }
        });

        // Remove from open games list
        io.emit("gameRemoved", { gameId });

        console.log(`${username} joined game ${gameId}`);
      } catch (error) {
        console.error("Error joining game:", error);
        socket.emit("error", { message: "Failed to join game" });
      }
    });

    // Spectate a game (join room but not as player)
    socket.on("spectateGame", async (data) => {
      const { gameId } = data;
      socket.join(`game-${gameId}`);
      
      const gameState = activeGames.get(gameId.toString());
      if (gameState) {
        socket.emit("gameState", gameState);
      }
    });

    // Make a move
    socket.on("makeMove", async (data) => {
      try {
        const { gameId, userId, move } = data;
        const gameIdStr = gameId.toString();
        const gameState = activeGames.get(gameIdStr);

        if (!gameState) {
          return socket.emit("error", { message: "Game not found" });
        }

        // Verify it's this player's turn
        const currentPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
        if (!currentPlayer || currentPlayer.id !== userId) {
          return socket.emit("error", { message: "Not your turn" });
        }

        // Start the game if this is the first move
        if (gameState.status === 'ready' && gameState.moveHistory.length === 0) {
          gameState.status = 'active';
          gameState.startTime = Date.now();
          await db_pool.query(
            "UPDATE games SET status = 'active', start_time = ? WHERE id = ?",
            [new Date().toISOString().slice(0, 19).replace('T', ' '), gameId]
          );
        }

        // Validate move (basic validation - full validation handled by game rules)
        const moveResult = validateAndApplyMove(gameState, move);
        
        if (!moveResult.valid) {
          return socket.emit("error", { message: moveResult.reason || "Invalid move" });
        }

        // Record the move
        const moveRecord = {
          from: move.from,
          to: move.to,
          pieceId: move.pieceId,
          captured: moveResult.captured,
          player: userId,
          position: gameState.currentTurn,
          timestamp: Date.now()
        };
        gameState.moveHistory.push(moveRecord);

        // Apply increment to current player's time
        if (gameState.increment && gameState.playerTimes[userId]) {
          gameState.playerTimes[userId] += gameState.increment;
        }

        // Switch turns
        gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;

        // Check for win conditions
        const winResult = checkWinCondition(gameState);
        if (winResult.gameOver) {
          gameState.status = 'completed';
          gameState.winner = winResult.winner;
          gameState.winReason = winResult.reason;

          const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
          await db_pool.query(
            `UPDATE games SET status = 'completed', end_time = ?, 
             pieces = ?, other_data = ? WHERE id = ?`,
            [endTime, JSON.stringify(gameState.pieces), 
             JSON.stringify({ moves: gameState.moveHistory, winner: winResult.winner, reason: winResult.reason }),
             gameId]
          );

          io.to(`game-${gameId}`).emit("gameOver", {
            gameId,
            winner: winResult.winner,
            reason: winResult.reason,
            finalState: gameState
          });
        } else {
          // Update game state in database
          await db_pool.query(
            "UPDATE games SET player_turn = ?, pieces = ?, other_data = ? WHERE id = ?",
            [gameState.currentTurn, JSON.stringify(gameState.pieces), 
             JSON.stringify({ moves: gameState.moveHistory }), gameId]
          );

          // Broadcast move to all players in game
          io.to(`game-${gameId}`).emit("moveMade", {
            gameId,
            move: moveRecord,
            gameState: {
              pieces: gameState.pieces,
              currentTurn: gameState.currentTurn,
              playerTimes: gameState.playerTimes,
              moveHistory: gameState.moveHistory
            }
          });
        }

        console.log(`Move made in game ${gameId}: ${JSON.stringify(move)}`);
      } catch (error) {
        console.error("Error making move:", error);
        socket.emit("error", { message: "Failed to make move" });
      }
    });

    // Resign from game
    socket.on("resign", async (data) => {
      try {
        const { gameId, userId } = data;
        const gameIdStr = gameId.toString();
        const gameState = activeGames.get(gameIdStr);

        if (!gameState) {
          return socket.emit("error", { message: "Game not found" });
        }

        const resigningPlayer = gameState.players.find(p => p.id === userId);
        if (!resigningPlayer) {
          return socket.emit("error", { message: "You are not in this game" });
        }

        const winner = gameState.players.find(p => p.id !== userId);

        gameState.status = 'completed';
        gameState.winner = winner?.id;
        gameState.winReason = 'resignation';

        const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db_pool.query(
          `UPDATE games SET status = 'completed', end_time = ?, other_data = ? WHERE id = ?`,
          [endTime, JSON.stringify({ moves: gameState.moveHistory, winner: winner?.id, reason: 'resignation' }), gameId]
        );

        io.to(`game-${gameId}`).emit("gameOver", {
          gameId,
          winner: winner?.id,
          winnerUsername: winner?.username,
          reason: 'resignation',
          resignedPlayer: userId
        });

        console.log(`Player ${userId} resigned from game ${gameId}`);
      } catch (error) {
        console.error("Error processing resignation:", error);
        socket.emit("error", { message: "Failed to resign" });
      }
    });

    // Cancel a waiting game
    socket.on("cancelGame", async (data) => {
      try {
        const { gameId, userId } = data;
        const gameIdStr = gameId.toString();
        const gameState = activeGames.get(gameIdStr);

        if (!gameState) {
          return socket.emit("error", { message: "Game not found" });
        }

        if (gameState.hostId !== userId) {
          return socket.emit("error", { message: "Only the host can cancel the game" });
        }

        if (gameState.status !== 'waiting') {
          return socket.emit("error", { message: "Cannot cancel a game that has already started" });
        }

        // Delete from database
        await db_pool.query("DELETE FROM players WHERE game_id = ?", [gameId]);
        await db_pool.query("DELETE FROM games WHERE id = ?", [gameId]);

        // Remove from memory
        activeGames.delete(gameIdStr);

        // Notify everyone
        io.emit("gameRemoved", { gameId });
        socket.emit("gameCancelled", { gameId });

        console.log(`Game ${gameId} cancelled by host`);
      } catch (error) {
        console.error("Error cancelling game:", error);
        socket.emit("error", { message: "Failed to cancel game" });
      }
    });

    // Get current game state (for reconnection)
    socket.on("getGameState", async (data) => {
      const { gameId, userId } = data;
      let gameState = activeGames.get(gameId.toString());
      
      if (gameState) {
        socket.join(`game-${gameId}`);
        socket.emit("gameState", gameState);
      } else {
        // Try to load from database
        try {
          const [[game]] = await db_pool.query(
            "SELECT * FROM games WHERE id = ?",
            [gameId]
          );
          
          if (!game) {
            return socket.emit("error", { message: "Game not found" });
          }

          // Get game type
          const [[gameType]] = await db_pool.query(
            "SELECT * FROM game_types WHERE id = ?",
            [game.game_type_id]
          );

          // Get players with their usernames
          const [playerRows] = await db_pool.query(
            `SELECT p.*, u.username FROM players p
             JOIN users u ON p.user_id = u.id
             WHERE p.game_id = ?`,
            [gameId]
          );

          const players = playerRows.map(p => ({
            id: p.user_id,
            username: p.username,
            position: p.player_position,
            timeRemaining: p.time_remaining
          }));

          // Parse pieces from game first, then fall back to game type
          let pieces = [];
          try {
            let rawPieces = JSON.parse(game.pieces || "[]");
            
            // If pieces is already an array with x,y properties, use it
            if (Array.isArray(rawPieces) && rawPieces.length > 0) {
              pieces = rawPieces;
            } else if (!Array.isArray(rawPieces) && typeof rawPieces === 'object') {
              // Convert from object format {"row,col": {...}} to array format
              Object.entries(rawPieces).forEach(([key, pieceData]) => {
                const [row, col] = key.split(',').map(Number);
                pieces.push({
                  ...pieceData,
                  x: col,
                  y: row,
                  id: `${pieceData.piece_id}_${row}_${col}`
                });
              });
            }
            
            // Fall back to game type pieces if still empty
            if (pieces.length === 0 && gameType?.pieces_string) {
              const piecesObj = JSON.parse(gameType.pieces_string);
              if (Array.isArray(piecesObj)) {
                pieces = piecesObj;
              } else {
                Object.entries(piecesObj).forEach(([key, pieceData]) => {
                  const [row, col] = key.split(',').map(Number);
                  pieces.push({
                    ...pieceData,
                    x: col,
                    y: row,
                    id: `${pieceData.piece_id}_${row}_${col}`
                  });
                });
              }
            }
          } catch (e) {
            console.error("Error parsing pieces:", e);
            pieces = [];
          }

          // Parse move history
          let moveHistory = [];
          try {
            const otherData = JSON.parse(game.other_data || '{}');
            moveHistory = otherData.moves || [];
          } catch {
            moveHistory = [];
          }

          // Build player times
          const playerTimes = {};
          players.forEach(p => {
            playerTimes[p.id] = p.timeRemaining ? p.timeRemaining * 60 : (game.turn_length ? game.turn_length * 60 : null);
          });

          gameState = {
            id: game.id,
            gameTypeId: game.game_type_id,
            gameType: gameType,
            timeControl: game.turn_length,
            increment: game.increment || 0,
            status: game.status,
            hostId: game.host_id,
            hostUsername: players.find(p => p.id === game.host_id)?.username || 'Unknown',
            players: players,
            pieces: pieces,
            currentTurn: game.player_turn || 1,
            moveHistory: moveHistory,
            startTime: game.start_time,
            playerTimes: playerTimes
          };

          // Store in memory for future use
          activeGames.set(gameId.toString(), gameState);
          
          socket.join(`game-${gameId}`);
          socket.emit("gameState", gameState);
        } catch (error) {
          console.error("Error loading game state:", error);
          socket.emit("error", { message: "Failed to load game" });
        }
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      
      const userData = playerSockets.get(socket.id);
      if (userData) {
        userSockets.delete(userData.id.toString());
        playerSockets.delete(socket.id);
      }

      // Note: We don't automatically forfeit games on disconnect
      // The player can reconnect within a reasonable time
    });
  });

  return io;
}

/**
 * Get list of games waiting for players
 */
async function getOpenLiveGames() {
  try {
    const [games] = await db_pool.query(
      `SELECT g.*, gt.game_name, gt.board_width, gt.board_height, u.username as host_username
       FROM games g
       JOIN game_types gt ON g.game_type_id = gt.id
       JOIN users u ON g.host_id = u.id
       WHERE g.status = 'waiting'
       ORDER BY g.created_at DESC`
    );
    return games;
  } catch (error) {
    console.error("Error getting open games:", error);
    return [];
  }
}

/**
 * Basic move validation - checks if move is legal based on piece rules
 */
function validateAndApplyMove(gameState, move) {
  const { from, to, pieceId } = move;
  const pieces = gameState.pieces;
  
  // Find the piece being moved
  const pieceIndex = pieces.findIndex(p => p.id === pieceId);
  if (pieceIndex === -1) {
    return { valid: false, reason: "Piece not found" };
  }

  const piece = pieces[pieceIndex];

  // Verify piece belongs to current player
  const currentPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
  if (piece.team !== currentPlayer.position && piece.player !== currentPlayer.id) {
    return { valid: false, reason: "Not your piece" };
  }

  // Check if destination has a piece
  let capturedPiece = null;
  const destinationPieceIndex = pieces.findIndex(p => 
    p.x === to.x && p.y === to.y && p.id !== pieceId
  );
  
  if (destinationPieceIndex !== -1) {
    const destPiece = pieces[destinationPieceIndex];
    // Check if it's an enemy piece
    if (destPiece.team === piece.team || destPiece.player === currentPlayer.id) {
      return { valid: false, reason: "Cannot capture your own piece" };
    }
    capturedPiece = destPiece;
    // Remove captured piece
    pieces.splice(destinationPieceIndex, 1);
  }

  // Update piece position
  const movingPiece = pieces.find(p => p.id === pieceId);
  if (movingPiece) {
    movingPiece.x = to.x;
    movingPiece.y = to.y;
    movingPiece.hasMoved = true;
  }

  return { valid: true, captured: capturedPiece };
}

/**
 * Check if a win condition has been met
 */
function checkWinCondition(gameState) {
  const { gameType, pieces, players } = gameState;
  
  if (!gameType) return { gameOver: false };

  // Check mate condition (king captured)
  if (gameType.mate_condition && gameType.mate_piece) {
    for (const player of players) {
      // Check if this player's mate piece still exists
      const matePieceExists = pieces.some(p => 
        (p.team === player.position || p.player === player.id) && 
        p.pieceTypeId === gameType.mate_piece
      );
      
      if (!matePieceExists) {
        const winner = players.find(p => p.id !== player.id);
        return {
          gameOver: true,
          winner: winner?.id,
          reason: 'checkmate'
        };
      }
    }
  }

  // Check capture condition (capture specific piece X times)
  if (gameType.capture_condition) {
    // Implementation depends on how captures are tracked
    // This would check if required captures have been made
  }

  // Check value condition (reach certain point value)
  if (gameType.value_condition && gameType.value_max) {
    // Track piece values captured
  }

  // Check hill condition (piece on specific square for X turns)
  if (gameType.hill_condition) {
    // Check if a piece has been on the hill square for required turns
  }

  return { gameOver: false };
}

module.exports = { initializeSocket, activeGames };
