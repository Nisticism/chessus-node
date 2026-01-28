/**
 * Socket.io Game Handler
 * Manages real-time multiplayer game functionality
 */

const db_pool = require("../configs/db");

// Store active games in memory for quick access
const activeGames = new Map();
const gameTimers = new Map(); // Maps gameId to timer interval
const playerSockets = new Map(); // Maps socket.id to userId
const userSockets = new Map(); // Maps userId to socket.id

/**
 * ELO Rating System
 * Standard ELO calculation with K-factor of 32 for all players
 */
const ELO_K_FACTOR = 32;

function calculateExpectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function calculateNewElo(currentRating, expectedScore, actualScore) {
  return Math.round(currentRating + ELO_K_FACTOR * (actualScore - expectedScore));
}

/**
 * Update ELO ratings for both players after a game
 * @param {number} winnerId - ID of the winning player
 * @param {number} loserId - ID of the losing player
 * @param {boolean} isDraw - Whether the game was a draw (optional)
 */
async function updateEloRatings(winnerId, loserId, isDraw = false) {
  try {
    // Get current ELO ratings
    const [players] = await db_pool.query(
      "SELECT id, elo FROM users WHERE id IN (?, ?)",
      [winnerId, loserId]
    );

    if (players.length !== 2) {
      console.error("Could not find both players for ELO update");
      return null;
    }

    const winner = players.find(p => p.id === winnerId);
    const loser = players.find(p => p.id === loserId);

    if (!winner || !loser) {
      console.error("Could not identify winner/loser for ELO update");
      return null;
    }

    const winnerOldElo = winner.elo || 1000;
    const loserOldElo = loser.elo || 1000;

    // Calculate expected scores
    const winnerExpected = calculateExpectedScore(winnerOldElo, loserOldElo);
    const loserExpected = calculateExpectedScore(loserOldElo, winnerOldElo);

    // Actual scores (1 for win, 0 for loss, 0.5 for draw)
    const winnerActual = isDraw ? 0.5 : 1;
    const loserActual = isDraw ? 0.5 : 0;

    // Calculate new ELO ratings
    const winnerNewElo = calculateNewElo(winnerOldElo, winnerExpected, winnerActual);
    const loserNewElo = calculateNewElo(loserOldElo, loserExpected, loserActual);

    // Update both players' ELO in database
    await db_pool.query(
      "UPDATE users SET elo = ? WHERE id = ?",
      [winnerNewElo, winnerId]
    );
    await db_pool.query(
      "UPDATE users SET elo = ? WHERE id = ?",
      [loserNewElo, loserId]
    );

    console.log(`ELO Updated: Winner ${winnerId}: ${winnerOldElo} -> ${winnerNewElo}, Loser ${loserId}: ${loserOldElo} -> ${loserNewElo}`);

    return {
      winner: { id: winnerId, oldElo: winnerOldElo, newElo: winnerNewElo, change: winnerNewElo - winnerOldElo },
      loser: { id: loserId, oldElo: loserOldElo, newElo: loserNewElo, change: loserNewElo - loserOldElo }
    };
  } catch (error) {
    console.error("Error updating ELO ratings:", error);
    return null;
  }
}

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

    // Get list of ongoing games (for spectating)
    socket.on("getOngoingGames", async () => {
      try {
        const ongoingGames = await getOngoingGames();
        socket.emit("ongoingGamesList", ongoingGames);
      } catch (error) {
        console.error("Error fetching ongoing games:", error);
        socket.emit("error", { message: "Failed to fetch ongoing games" });
      }
    });

    // Create a new live game
    socket.on("createGame", async (data) => {
      try {
        const { gameTypeId, timeControl, increment, hostId, hostUsername, allowSpectators = true, showPieceHelpers = false } = data;
        
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
        // AND load full piece movement data from pieces table
        let piecesArray = [];
        const pieceIdsToLoad = new Set();
        
        try {
          const piecesObj = JSON.parse(gameType.pieces_string || "{}");
          // If it's already an array, use it directly
          if (Array.isArray(piecesObj)) {
            piecesArray = piecesObj;
            piecesArray.forEach(p => { if (p.piece_id) pieceIdsToLoad.add(p.piece_id); });
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
              if (pieceData.piece_id) pieceIdsToLoad.add(pieceData.piece_id);
            });
          }
        } catch (e) {
          console.error("Error parsing pieces_string:", e);
          piecesArray = [];
        }
        
        // Load full piece data including movement and capture rules from joined tables
        const pieceDataMap = {};
        if (pieceIdsToLoad.size > 0) {
          const [pieceRows] = await db_pool.query(
            `SELECT p.*, 
                    pm.directional_movement_style, pm.up_movement, pm.down_movement, 
                    pm.left_movement, pm.right_movement, pm.up_left_movement, 
                    pm.up_right_movement, pm.down_left_movement, pm.down_right_movement,
                    pm.ratio_movement_style, pm.ratio_one_movement, pm.ratio_two_movement,
                    pm.step_by_step_movement_style, pm.step_by_step_movement_value,
                    pm.can_hop_over_allies, pm.can_hop_over_enemies,
                    pc.can_capture_enemy_on_move, pc.can_capture_ally_on_range,
                    pc.up_capture, pc.down_capture, pc.left_capture, pc.right_capture,
                    pc.up_left_capture, pc.up_right_capture, pc.down_left_capture, pc.down_right_capture,
                    pc.ratio_one_capture, pc.ratio_two_capture,
                    pc.step_by_step_capture
             FROM pieces p
             LEFT JOIN piece_movement pm ON p.id = pm.piece_id
             LEFT JOIN piece_capture pc ON p.id = pc.piece_id
             WHERE p.id IN (?)`,
            [Array.from(pieceIdsToLoad)]
          );
          pieceRows.forEach(p => { pieceDataMap[p.id] = p; });
          
          // Debug: Log first piece data from database
          if (pieceRows.length > 0) {
            console.log('First piece data loaded from DB:', {
              id: pieceRows[0].id,
              name: pieceRows[0].name,
              directional_movement_style: pieceRows[0].directional_movement_style,
              up_movement: pieceRows[0].up_movement,
              down_movement: pieceRows[0].down_movement,
              ratio_movement_style: pieceRows[0].ratio_movement_style,
              ratio_one_movement: pieceRows[0].ratio_one_movement,
              can_capture_enemy_on_move: pieceRows[0].can_capture_enemy_on_move
            });
          }
        }
        
        // Merge piece movement data into pieces array
        piecesArray = piecesArray.map(piece => {
          const fullPieceData = pieceDataMap[piece.piece_id];
          if (fullPieceData) {
            return {
              ...piece,
              // Movement data from piece_movement table
              directional_movement_style: fullPieceData.directional_movement_style,
              up_movement: fullPieceData.up_movement,
              down_movement: fullPieceData.down_movement,
              left_movement: fullPieceData.left_movement,
              right_movement: fullPieceData.right_movement,
              up_left_movement: fullPieceData.up_left_movement,
              up_right_movement: fullPieceData.up_right_movement,
              down_left_movement: fullPieceData.down_left_movement,
              down_right_movement: fullPieceData.down_right_movement,
              ratio_movement_style: fullPieceData.ratio_movement_style,
              ratio_movement_1: fullPieceData.ratio_one_movement,
              ratio_movement_2: fullPieceData.ratio_two_movement,
              step_movement_style: fullPieceData.step_by_step_movement_style,
              step_movement_value: fullPieceData.step_by_step_movement_value,
              can_hop_over_allies: fullPieceData.can_hop_over_allies,
              can_hop_over_enemies: fullPieceData.can_hop_over_enemies,
              // Capture data from piece_capture table
              can_capture_enemy_on_move: fullPieceData.can_capture_enemy_on_move,
              up_capture: fullPieceData.up_capture,
              down_capture: fullPieceData.down_capture,
              left_capture: fullPieceData.left_capture,
              right_capture: fullPieceData.right_capture,
              up_left_capture: fullPieceData.up_left_capture,
              up_right_capture: fullPieceData.up_right_capture,
              down_left_capture: fullPieceData.down_left_capture,
              down_right_capture: fullPieceData.down_right_capture,
              ratio_capture_1: fullPieceData.ratio_one_capture,
              ratio_capture_2: fullPieceData.ratio_two_capture,
              step_capture_value: fullPieceData.step_by_step_capture,
              // Special attributes from pieces table
              piece_value: fullPieceData.piece_value,
              is_royal: fullPieceData.is_royal,
              can_promote: fullPieceData.can_promote,
              promotion_options: fullPieceData.promotion_options
            };
          }
          return piece;
        });
        
        const piecesData = JSON.stringify(piecesArray);
        
        const [result] = await db_pool.query(
          `INSERT INTO games (created_at, turn_length, increment, player_count, player_turn, pieces, other_data, game_type_id, status, host_id, allow_spectators, show_piece_helpers)
           VALUES (?, ?, ?, 2, 1, ?, ?, ?, 'waiting', ?, ?, ?)`,
          [currentTime, timeControl, increment || 0, piecesData, JSON.stringify({ moves: [] }), gameTypeId, hostId, allowSpectators ? 1 : 0, showPieceHelpers ? 1 : 0]
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
          playerTimes: {},
          allowSpectators,
          showPieceHelpers
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

          // Parse and enrich pieces with movement data from piece_movement and piece_capture tables
          let pieces = JSON.parse(game.pieces || "[]");
          const pieceIdsToLoad = new Set();
          pieces.forEach(p => {
            if (p.piece_id && !p.directional_movement_style) {
              pieceIdsToLoad.add(p.piece_id);
            }
          });
          
          if (pieceIdsToLoad.size > 0) {
            const [pieceRows] = await db_pool.query(
              `SELECT p.*, 
                      pm.directional_movement_style, pm.up_movement, pm.down_movement, 
                      pm.left_movement, pm.right_movement, pm.up_left_movement, 
                      pm.up_right_movement, pm.down_left_movement, pm.down_right_movement,
                      pm.ratio_movement_style, pm.ratio_one_movement, pm.ratio_two_movement,
                      pm.step_by_step_movement_style, pm.step_by_step_movement_value,
                      pm.can_hop_over_allies, pm.can_hop_over_enemies,
                      pc.can_capture_enemy_on_move, pc.can_capture_ally_on_range,
                      pc.up_capture, pc.down_capture, pc.left_capture, pc.right_capture,
                      pc.up_left_capture, pc.up_right_capture, pc.down_left_capture, pc.down_right_capture,
                      pc.ratio_one_capture, pc.ratio_two_capture,
                      pc.step_by_step_capture
               FROM pieces p
               LEFT JOIN piece_movement pm ON p.id = pm.piece_id
               LEFT JOIN piece_capture pc ON p.id = pc.piece_id
               WHERE p.id IN (?)`,
              [Array.from(pieceIdsToLoad)]
            );
            const pieceDataMap = {};
            pieceRows.forEach(p => { pieceDataMap[p.id] = p; });
            
            pieces = pieces.map(piece => {
              const fullPieceData = pieceDataMap[piece.piece_id];
              if (fullPieceData) {
                return {
                  ...piece,
                  // Movement data from piece_movement table
                  directional_movement_style: fullPieceData.directional_movement_style,
                  up_movement: fullPieceData.up_movement,
                  down_movement: fullPieceData.down_movement,
                  left_movement: fullPieceData.left_movement,
                  right_movement: fullPieceData.right_movement,
                  up_left_movement: fullPieceData.up_left_movement,
                  up_right_movement: fullPieceData.up_right_movement,
                  down_left_movement: fullPieceData.down_left_movement,
                  down_right_movement: fullPieceData.down_right_movement,
                  ratio_movement_style: fullPieceData.ratio_movement_style,
                  ratio_movement_1: fullPieceData.ratio_one_movement,
                  ratio_movement_2: fullPieceData.ratio_two_movement,
                  step_movement_style: fullPieceData.step_by_step_movement_style,
                  step_movement_value: fullPieceData.step_by_step_movement_value,
                  can_hop_over_allies: fullPieceData.can_hop_over_allies,
                  can_hop_over_enemies: fullPieceData.can_hop_over_enemies,
                  // Capture data from piece_capture table
                  can_capture_enemy_on_move: fullPieceData.can_capture_enemy_on_move,
                  up_capture: fullPieceData.up_capture,
                  down_capture: fullPieceData.down_capture,
                  left_capture: fullPieceData.left_capture,
                  right_capture: fullPieceData.right_capture,
                  up_left_capture: fullPieceData.up_left_capture,
                  up_right_capture: fullPieceData.up_right_capture,
                  down_left_capture: fullPieceData.down_left_capture,
                  down_right_capture: fullPieceData.down_right_capture,
                  ratio_capture_1: fullPieceData.ratio_one_capture,
                  ratio_capture_2: fullPieceData.ratio_two_capture,
                  step_capture_value: fullPieceData.step_by_step_capture,
                  // Special attributes from pieces table
                  piece_value: fullPieceData.piece_value,
                  is_royal: fullPieceData.is_royal,
                  can_promote: fullPieceData.can_promote,
                  promotion_options: fullPieceData.promotion_options
                };
              }
              return piece;
            });
          }

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
            pieces: pieces,
            currentTurn: 1,
            moveHistory: [],
            startTime: null,
            playerTimes: {},
            allowSpectators: game.allow_spectators !== 0,
            showPieceHelpers: game.show_piece_helpers === 1
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
          
          // Notify everyone that a new game has started (for ongoing games list)
          io.emit("gameStarted", { gameId });
          
          // Start the game timer
          startGameTimer(io, gameId);
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

        // Check for win conditions (pass captured piece for ends_game_on_capture check)
        const winResult = checkWinCondition(gameState, moveResult.captured);
        if (winResult.gameOver) {
          // Stop the timer
          stopGameTimer(gameId);
          
          gameState.status = 'completed';
          gameState.winner = winResult.winner;
          gameState.winReason = winResult.reason;

          // Find loser
          const loser = gameState.players.find(p => p.id !== winResult.winner);

          // Update ELO ratings
          let eloChanges = null;
          if (winResult.winner && loser) {
            eloChanges = await updateEloRatings(winResult.winner, loser.id);
          }

          const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
          await db_pool.query(
            `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
             pieces = ?, other_data = ? WHERE id = ?`,
            [endTime, winResult.winner, JSON.stringify(gameState.pieces), 
             JSON.stringify({ moves: gameState.moveHistory, winner: winResult.winner, reason: winResult.reason, eloChanges }),
             gameId]
          );

          io.to(`game-${gameId}`).emit("gameOver", {
            gameId,
            winner: winResult.winner,
            reason: winResult.reason,
            finalState: gameState,
            eloChanges
          });
        } else {
          // Check if the current player (whose turn it now is) is in check
          const checkResult = checkForCheck(gameState, gameState.currentTurn);
          
          // Store check status in game state
          gameState.inCheck = checkResult.inCheck;
          gameState.checkedPieces = checkResult.checkedPieces;

          // Update game state in database
          await db_pool.query(
            "UPDATE games SET player_turn = ?, pieces = ?, other_data = ? WHERE id = ?",
            [gameState.currentTurn, JSON.stringify(gameState.pieces), 
             JSON.stringify({ moves: gameState.moveHistory, inCheck: checkResult.inCheck }), gameId]
          );

          // Broadcast move to all players in game
          io.to(`game-${gameId}`).emit("moveMade", {
            gameId,
            move: moveRecord,
            gameState: {
              pieces: gameState.pieces,
              currentTurn: gameState.currentTurn,
              playerTimes: gameState.playerTimes,
              moveHistory: gameState.moveHistory,
              inCheck: checkResult.inCheck,
              checkedPieces: checkResult.checkedPieces
            }
          });

          // If player is in check, emit a separate check event for visibility
          if (checkResult.inCheck) {
            const checkedPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
            io.to(`game-${gameId}`).emit("check", {
              gameId,
              playerId: checkedPlayer?.id,
              playerPosition: gameState.currentTurn,
              checkedPieces: checkResult.checkedPieces.map(p => ({
                id: p.id,
                piece_name: p.piece_name,
                x: p.x,
                y: p.y
              }))
            });
            console.log(`Player ${checkedPlayer?.username} is in CHECK in game ${gameId}`);
          }
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

        // Stop the timer
        stopGameTimer(gameId);

        gameState.status = 'completed';
        gameState.winner = winner?.id;
        gameState.winReason = 'resignation';

        // Update ELO ratings
        let eloChanges = null;
        if (winner?.id && userId) {
          eloChanges = await updateEloRatings(winner.id, userId);
        }

        const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db_pool.query(
          `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?, other_data = ?, pieces = ? WHERE id = ?`,
          [endTime, winner?.id, JSON.stringify({ moves: gameState.moveHistory, winner: winner?.id, reason: 'resignation', eloChanges }), JSON.stringify(gameState.pieces), gameId]
        );

        io.to(`game-${gameId}`).emit("gameOver", {
          gameId,
          winner: winner?.id,
          winnerUsername: winner?.username,
          reason: 'resignation',
          resignedPlayer: userId,
          eloChanges
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
            
            // Load full piece data including movement rules if not already present
            const pieceIdsToLoad = new Set();
            pieces.forEach(p => {
              // Check if piece is missing movement data
              if (p.piece_id && !p.directional_movement_style) {
                pieceIdsToLoad.add(p.piece_id);
              }
            });
            
            if (pieceIdsToLoad.size > 0) {
              const [pieceRows] = await db_pool.query(
                `SELECT p.*, 
                        pm.directional_movement_style, pm.up_movement, pm.down_movement, 
                        pm.left_movement, pm.right_movement, pm.up_left_movement, 
                        pm.up_right_movement, pm.down_left_movement, pm.down_right_movement,
                        pm.ratio_movement_style, pm.ratio_one_movement, pm.ratio_two_movement,
                        pm.step_by_step_movement_style, pm.step_by_step_movement_value,
                        pm.can_hop_over_allies, pm.can_hop_over_enemies,
                        pc.can_capture_enemy_on_move, pc.can_capture_ally_on_range,
                        pc.up_capture, pc.down_capture, pc.left_capture, pc.right_capture,
                        pc.up_left_capture, pc.up_right_capture, pc.down_left_capture, pc.down_right_capture,
                        pc.ratio_one_capture, pc.ratio_two_capture,
                        pc.step_by_step_capture
                 FROM pieces p
                 LEFT JOIN piece_movement pm ON p.id = pm.piece_id
                 LEFT JOIN piece_capture pc ON p.id = pc.piece_id
                 WHERE p.id IN (?)`,
                [Array.from(pieceIdsToLoad)]
              );
              const pieceDataMap = {};
              pieceRows.forEach(p => { pieceDataMap[p.id] = p; });
              
              // Merge piece movement data
              pieces = pieces.map(piece => {
                const fullPieceData = pieceDataMap[piece.piece_id];
                if (fullPieceData) {
                  return {
                    ...piece,
                    // Movement data from piece_movement table
                    directional_movement_style: fullPieceData.directional_movement_style,
                    up_movement: fullPieceData.up_movement,
                    down_movement: fullPieceData.down_movement,
                    left_movement: fullPieceData.left_movement,
                    right_movement: fullPieceData.right_movement,
                    up_left_movement: fullPieceData.up_left_movement,
                    up_right_movement: fullPieceData.up_right_movement,
                    down_left_movement: fullPieceData.down_left_movement,
                    down_right_movement: fullPieceData.down_right_movement,
                    ratio_movement_style: fullPieceData.ratio_movement_style,
                    ratio_movement_1: fullPieceData.ratio_one_movement,
                    ratio_movement_2: fullPieceData.ratio_two_movement,
                    step_movement_style: fullPieceData.step_by_step_movement_style,
                    step_movement_value: fullPieceData.step_by_step_movement_value,
                    can_hop_over_allies: fullPieceData.can_hop_over_allies,
                    can_hop_over_enemies: fullPieceData.can_hop_over_enemies,
                    // Capture data from piece_capture table
                    can_capture_enemy_on_move: fullPieceData.can_capture_enemy_on_move,
                    up_capture: fullPieceData.up_capture,
                    down_capture: fullPieceData.down_capture,
                    left_capture: fullPieceData.left_capture,
                    right_capture: fullPieceData.right_capture,
                    up_left_capture: fullPieceData.up_left_capture,
                    up_right_capture: fullPieceData.up_right_capture,
                    down_left_capture: fullPieceData.down_left_capture,
                    down_right_capture: fullPieceData.down_right_capture,
                    ratio_capture_1: fullPieceData.ratio_one_capture,
                    ratio_capture_2: fullPieceData.ratio_two_capture,
                    step_capture_value: fullPieceData.step_by_step_capture,
                    // Special attributes from pieces table
                    piece_value: fullPieceData.piece_value,
                    is_royal: fullPieceData.is_royal,
                    can_promote: fullPieceData.can_promote,
                    promotion_options: fullPieceData.promotion_options
                  };
                }
                return piece;
              });
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
            playerTimes: playerTimes,
            allowSpectators: game.allow_spectators !== 0,
            showPieceHelpers: game.show_piece_helpers === 1
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
 * Get list of ongoing games (active games that allow spectators)
 */
async function getOngoingGames() {
  try {
    const [games] = await db_pool.query(
      `SELECT g.id, g.game_type_id, g.turn_length, g.increment, g.status, g.created_at, g.start_time,
              g.allow_spectators, g.show_piece_helpers,
              gt.game_name, gt.board_width, gt.board_height,
              GROUP_CONCAT(u.username ORDER BY p.player_position SEPARATOR ' vs ') as player_names,
              GROUP_CONCAT(p.user_id ORDER BY p.player_position) as player_ids
       FROM games g
       JOIN game_types gt ON g.game_type_id = gt.id
       JOIN players p ON g.id = p.game_id
       JOIN users u ON p.user_id = u.id
       WHERE g.status IN ('active', 'ready') AND (g.allow_spectators = 1 OR g.allow_spectators IS NULL)
       GROUP BY g.id
       ORDER BY g.start_time DESC, g.created_at DESC`
    );
    // Convert player_ids from comma-separated string to array of numbers
    return games.map(g => ({
      ...g,
      player_ids: g.player_ids ? g.player_ids.split(',').map(id => parseInt(id)) : []
    }));
  } catch (error) {
    console.error("Error getting ongoing games:", error);
    return [];
  }
}

/**
 * Start the game timer for the current player
 */
function startGameTimer(io, gameId) {
  const gameIdStr = gameId.toString();
  const gameState = activeGames.get(gameIdStr);
  
  if (!gameState || !gameState.timeControl) return;
  
  // Clear any existing timer
  stopGameTimer(gameId);
  
  // Start a new timer that ticks every second
  const timer = setInterval(async () => {
    const currentGameState = activeGames.get(gameIdStr);
    if (!currentGameState || currentGameState.status !== 'active') {
      stopGameTimer(gameId);
      return;
    }
    
    // Find the current player
    const currentPlayer = currentGameState.players.find(p => p.position === currentGameState.currentTurn);
    if (!currentPlayer) {
      stopGameTimer(gameId);
      return;
    }
    
    // Decrement current player's time
    if (currentGameState.playerTimes[currentPlayer.id] !== null) {
      currentGameState.playerTimes[currentPlayer.id] -= 1;
      
      // Check for timeout
      if (currentGameState.playerTimes[currentPlayer.id] <= 0) {
        currentGameState.playerTimes[currentPlayer.id] = 0;
        stopGameTimer(gameId);
        
        // Player ran out of time - game over
        const winner = currentGameState.players.find(p => p.id !== currentPlayer.id);
        currentGameState.status = 'completed';
        currentGameState.winner = winner?.id;
        currentGameState.winReason = 'timeout';

        // Update ELO ratings
        let eloChanges = null;
        if (winner?.id && currentPlayer.id) {
          eloChanges = await updateEloRatings(winner.id, currentPlayer.id);
        }
        
        const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db_pool.query(
          `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
           pieces = ?, other_data = ? WHERE id = ?`,
          [endTime, winner?.id, JSON.stringify(currentGameState.pieces), 
           JSON.stringify({ moves: currentGameState.moveHistory, winner: winner?.id, reason: 'timeout', eloChanges }),
           gameId]
        );
        
        io.to(`game-${gameId}`).emit("gameOver", {
          gameId,
          winner: winner?.id,
          reason: 'timeout',
          finalState: currentGameState,
          eloChanges
        });
        return;
      }
      
      // Broadcast time update every second
      io.to(`game-${gameId}`).emit("timeUpdate", {
        gameId,
        playerTimes: currentGameState.playerTimes,
        currentTurn: currentGameState.currentTurn
      });
    }
  }, 1000);
  
  gameTimers.set(gameIdStr, timer);
}

/**
 * Stop the game timer
 */
function stopGameTimer(gameId) {
  const gameIdStr = gameId.toString();
  const timer = gameTimers.get(gameIdStr);
  if (timer) {
    clearInterval(timer);
    gameTimers.delete(gameIdStr);
  }
}

/**
 * Simulate a move and check if the player would still be in check
 * @param {Object} gameState - The current game state
 * @param {Object} move - The move to simulate { from, to, pieceId }
 * @param {number} playerPosition - The player position to check (1 or 2)
 * @returns {boolean} - True if the move would leave the player in check
 */
function wouldMoveLeaveInCheck(gameState, move, playerPosition) {
  const { to, pieceId } = move;
  const pieces = gameState.pieces;
  
  // Create a deep copy of pieces array for simulation
  const simulatedPieces = pieces.map(p => ({ ...p }));
  
  // Find the piece being moved in the simulation
  const pieceIndex = simulatedPieces.findIndex(p => p.id === pieceId);
  if (pieceIndex === -1) {
    return true; // Invalid move, treat as leaving in check
  }
  
  // Check if destination has an enemy piece (would be captured)
  const capturedPieceIndex = simulatedPieces.findIndex(p => 
    p.x === to.x && p.y === to.y && p.id !== pieceId
  );
  
  // Remove captured piece from simulation
  if (capturedPieceIndex !== -1) {
    simulatedPieces.splice(capturedPieceIndex, 1);
  }
  
  // Update piece position in simulation
  const movingPieceIndex = simulatedPieces.findIndex(p => p.id === pieceId);
  if (movingPieceIndex !== -1) {
    simulatedPieces[movingPieceIndex].x = to.x;
    simulatedPieces[movingPieceIndex].y = to.y;
  }
  
  // Create a simulated game state
  const simulatedGameState = {
    ...gameState,
    pieces: simulatedPieces
  };
  
  // Check if player would still be in check after this move
  const checkResult = checkForCheck(simulatedGameState, playerPosition);
  return checkResult.inCheck;
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
  // Pieces can have team, player, or player_id to indicate ownership
  const currentPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
  const pieceOwnerPosition = piece.team || piece.player_id;
  const pieceOwnerId = piece.player;
  
  const belongsToCurrentPlayer = 
    pieceOwnerPosition === currentPlayer.position || 
    pieceOwnerId === currentPlayer.id;
    
  if (!belongsToCurrentPlayer) {
    console.log('Piece ownership check failed:', {
      pieceTeam: piece.team,
      piecePlayerId: piece.player_id,
      piecePlayer: piece.player,
      currentPlayerPosition: currentPlayer.position,
      currentPlayerId: currentPlayer.id
    });
    return { valid: false, reason: "Not your piece" };
  }

  // Check if destination has a piece (for capture validation only - don't modify yet)
  let capturedPiece = null;
  const destinationPieceIndex = pieces.findIndex(p => 
    p.x === to.x && p.y === to.y && p.id !== pieceId
  );
  
  if (destinationPieceIndex !== -1) {
    const destPiece = pieces[destinationPieceIndex];
    const destPieceOwnerPosition = destPiece.team || destPiece.player_id;
    // Check if it's an enemy piece (different owner position)
    if (destPieceOwnerPosition === pieceOwnerPosition) {
      return { valid: false, reason: "Cannot capture your own piece" };
    }
    capturedPiece = destPiece;
  }

  // Check if mate_condition is enabled - if so, validate move doesn't leave player in check
  const gameType = gameState.gameType;
  if (gameType && gameType.mate_condition) {
    // Check if this move would leave the player in check
    if (wouldMoveLeaveInCheck(gameState, move, currentPlayer.position)) {
      // Check if player is currently in check for better error message
      const currentCheckStatus = checkForCheck(gameState, currentPlayer.position);
      if (currentCheckStatus.inCheck) {
        return { valid: false, reason: "You must get out of check" };
      } else {
        return { valid: false, reason: "This move would put you in check" };
      }
    }
  }

  // Now apply the move - remove captured piece if any
  if (destinationPieceIndex !== -1) {
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
 * Check if a specific piece can be attacked by any enemy piece
 * @param {Object} gameState - The current game state
 * @param {Object} targetPiece - The piece to check if it's under attack
 * @returns {boolean} - True if the piece is under attack
 */
function isPieceUnderAttack(gameState, targetPiece) {
  const { pieces } = gameState;
  const targetOwnerPosition = targetPiece.team || targetPiece.player_id;
  
  // Get all enemy pieces
  const enemyPieces = pieces.filter(p => {
    const pieceOwnerPosition = p.team || p.player_id;
    return pieceOwnerPosition !== targetOwnerPosition && p.id !== targetPiece.id;
  });
  
  // Check if any enemy piece can attack the target
  for (const enemyPiece of enemyPieces) {
    if (canPieceAttackSquare(enemyPiece, targetPiece.x, targetPiece.y, pieces)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a piece can attack a specific square
 * This is a simplified version - ideally should use full piece movement data
 */
function canPieceAttackSquare(piece, targetX, targetY, allPieces) {
  const dx = targetX - piece.x;
  const dy = targetY - piece.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  
  if (dx === 0 && dy === 0) return false;
  
  // Get piece movement/capture data
  // First check capture-specific fields, then fall back to movement
  const useMovementForCapture = piece.attacks_like_movement || piece.can_capture_enemy_on_move;
  
  // Check directional capture/movement
  const checkDirectional = (captureValue, moveValue) => {
    const value = captureValue !== undefined && captureValue !== null ? captureValue : 
                  (useMovementForCapture ? moveValue : null);
    if (!value) return false;
    if (value === 99) return true; // Infinite
    if (value > 0) return true; // Can move up to value squares
    if (value < 0) return absDx === Math.abs(value) || absDy === Math.abs(value); // Exact distance
    return false;
  };
  
  // Check if path is blocked (for sliding pieces)
  const isPathClear = (fromX, fromY, toX, toY) => {
    const stepX = toX > fromX ? 1 : toX < fromX ? -1 : 0;
    const stepY = toY > fromY ? 1 : toY < fromY ? -1 : 0;
    let x = fromX + stepX;
    let y = fromY + stepY;
    
    while (x !== toX || y !== toY) {
      if (allPieces.some(p => p.x === x && p.y === y)) {
        return false; // Path blocked
      }
      x += stepX;
      y += stepY;
    }
    return true;
  };

  // Straight line movements (rook-like)
  if (dx === 0 && dy !== 0) {
    // Vertical movement
    const captureVal = dy < 0 ? piece.up_capture : piece.down_capture;
    const moveVal = dy < 0 ? piece.up_movement : piece.down_movement;
    if (checkDirectional(captureVal, moveVal)) {
      const maxDist = captureVal || (useMovementForCapture ? moveVal : 0);
      if (maxDist === 99 || absDy <= Math.abs(maxDist)) {
        if (isPathClear(piece.x, piece.y, targetX, targetY)) {
          return true;
        }
      }
    }
  }
  
  if (dy === 0 && dx !== 0) {
    // Horizontal movement
    const captureVal = dx < 0 ? piece.left_capture : piece.right_capture;
    const moveVal = dx < 0 ? piece.left_movement : piece.right_movement;
    if (checkDirectional(captureVal, moveVal)) {
      const maxDist = captureVal || (useMovementForCapture ? moveVal : 0);
      if (maxDist === 99 || absDx <= Math.abs(maxDist)) {
        if (isPathClear(piece.x, piece.y, targetX, targetY)) {
          return true;
        }
      }
    }
  }
  
  // Diagonal movements (bishop-like)
  if (absDx === absDy && absDx > 0) {
    let captureVal, moveVal;
    if (dx < 0 && dy < 0) {
      captureVal = piece.up_left_capture;
      moveVal = piece.up_left_movement;
    } else if (dx > 0 && dy < 0) {
      captureVal = piece.up_right_capture;
      moveVal = piece.up_right_movement;
    } else if (dx < 0 && dy > 0) {
      captureVal = piece.down_left_capture;
      moveVal = piece.down_left_movement;
    } else {
      captureVal = piece.down_right_capture;
      moveVal = piece.down_right_movement;
    }
    
    if (checkDirectional(captureVal, moveVal)) {
      const maxDist = captureVal || (useMovementForCapture ? moveVal : 0);
      if (maxDist === 99 || absDx <= Math.abs(maxDist)) {
        if (isPathClear(piece.x, piece.y, targetX, targetY)) {
          return true;
        }
      }
    }
  }
  
  // L-shape movement (knight-like) - doesn't need path checking
  const ratio1 = piece.ratio_capture_1 || (useMovementForCapture ? piece.ratio_movement_1 : 0) || 0;
  const ratio2 = piece.ratio_capture_2 || (useMovementForCapture ? piece.ratio_movement_2 : 0) || 0;
  if (ratio1 > 0 && ratio2 > 0) {
    if ((absDx === ratio1 && absDy === ratio2) || (absDx === ratio2 && absDy === ratio1)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a player is in check (any piece with ends_game_on_checkmate is under attack)
 * @param {Object} gameState - The current game state
 * @param {number} playerPosition - The player position to check (1 or 2)
 * @returns {Object} - { inCheck: boolean, checkedPieces: Array }
 */
function checkForCheck(gameState, playerPosition) {
  const { pieces } = gameState;
  
  // Find all pieces belonging to this player that have ends_game_on_checkmate
  const checkmatePieces = pieces.filter(p => {
    const pieceOwnerPosition = p.team || p.player_id;
    return pieceOwnerPosition === playerPosition && p.ends_game_on_checkmate;
  });
  
  if (checkmatePieces.length === 0) {
    return { inCheck: false, checkedPieces: [] };
  }
  
  const checkedPieces = [];
  for (const piece of checkmatePieces) {
    if (isPieceUnderAttack(gameState, piece)) {
      checkedPieces.push(piece);
    }
  }
  
  return {
    inCheck: checkedPieces.length > 0,
    checkedPieces
  };
}

/**
 * Check if a player is in checkmate (in check and has no legal moves to escape)
 * @param {Object} gameState - The current game state
 * @param {number} playerPosition - The player position to check (1 or 2)
 * @returns {boolean} - True if the player is in checkmate
 */
function isCheckmate(gameState, playerPosition) {
  const checkResult = checkForCheck(gameState, playerPosition);
  
  if (!checkResult.inCheck) {
    return false;
  }
  
  // For now, just return that they're in check
  // Full checkmate detection requires checking all possible moves
  // which is complex - we'll flag it as check and let players resign
  // A more complete implementation would simulate all possible moves
  
  // TODO: Implement full checkmate detection by trying all legal moves
  // and seeing if any of them result in not being in check
  
  return false; // For now, don't auto-declare checkmate, just check
}

/**
 * Check if a win condition has been met
 */
function checkWinCondition(gameState, capturedPiece = null) {
  const { gameType, pieces, players } = gameState;
  
  if (!gameType) return { gameOver: false };

  // FIRST: Check if captured piece had ends_game_on_capture flag
  if (capturedPiece && capturedPiece.ends_game_on_capture) {
    // The player who owned the captured piece loses
    const loserPosition = capturedPiece.team || capturedPiece.player_id;
    const winner = players.find(p => p.position !== loserPosition);
    return {
      gameOver: true,
      winner: winner?.id,
      reason: 'capture'
    };
  }

  // Check if captured piece had ends_game_on_checkmate flag (instant loss when captured)
  if (capturedPiece && capturedPiece.ends_game_on_checkmate) {
    const loserPosition = capturedPiece.team || capturedPiece.player_id;
    const winner = players.find(p => p.position !== loserPosition);
    return {
      gameOver: true,
      winner: winner?.id,
      reason: 'checkmate'
    };
  }

  // Check mate condition (specific piece type captured - legacy support)
  if (gameType.mate_condition && gameType.mate_piece) {
    for (const player of players) {
      // Check if this player's mate piece still exists
      const matePieceExists = pieces.some(p => 
        (p.team === player.position || p.player_id === player.position || p.player === player.id) && 
        (p.pieceTypeId === gameType.mate_piece || p.piece_id === gameType.mate_piece)
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

  // Check capture condition - if enabled, capturing ALL opponent pieces wins
  // Or if capture_piece is specified, capturing that specific piece wins
  if (gameType.capture_condition) {
    for (const player of players) {
      // Get all pieces belonging to this player
      const playerPieces = pieces.filter(p => 
        p.team === player.position || 
        p.player_id === player.position || 
        p.player === player.id
      );
      
      // If this player has no pieces left, they lose
      if (playerPieces.length === 0) {
        const winner = players.find(p => p.id !== player.id);
        return {
          gameOver: true,
          winner: winner?.id,
          reason: 'capture'
        };
      }
      
      // If a specific capture piece is required, check if it was captured
      if (gameType.capture_piece) {
        const capturePieceExists = playerPieces.some(p => 
          p.pieceTypeId === gameType.capture_piece || p.piece_id === gameType.capture_piece
        );
        
        if (!capturePieceExists) {
          const winner = players.find(p => p.id !== player.id);
          return {
            gameOver: true,
            winner: winner?.id,
            reason: 'capture'
          };
        }
      }
    }
  }

  // Check value condition (reach certain point value)
  if (gameType.value_condition && gameType.value_max) {
    // Track piece values captured - would need to track this in moveHistory
  }

  // Check hill condition (piece on specific square for X turns)
  if (gameType.hill_condition) {
    // Check if a piece has been on the hill square for required turns
  }

  return { gameOver: false };
}

module.exports = { initializeSocket, activeGames };
