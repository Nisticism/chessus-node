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
 * Randomize piece positions based on mode
 * @param {Array} pieces - Array of piece objects with x, y, player_id
 * @param {Array} players - Array of player objects with position assignments
 * @param {string} mode - 'mirrored', 'backrow', 'independent', 'shared', or 'full'
 * @param {Object} gameType - Game type object with board dimensions
 * @returns {Array} - Array of pieces with randomized positions
 */
function randomizePiecePositions(pieces, players, mode, gameType) {
  console.log(`Randomizing pieces with mode: ${mode}`);
  console.log('Original pieces before randomization:', pieces.map(p => ({ piece_name: p.piece_name, player_id: p.player_id, x: p.x, y: p.y })));
  
  if (mode === 'full') {
    // Full board randomization - place all pieces randomly on the board
    return randomizeFullBoard(pieces, gameType);
  } else if (mode === 'mirrored') {
    // Mirrored randomization - both players get same pattern (all pieces)
    return randomizeMirrored(pieces, players, gameType);
  } else if (mode === 'backrow') {
    // Chess960-style - only back row randomized in mirrored fashion
    return randomizeBackRow(pieces, players, gameType);
  } else if (mode === 'independent') {
    // Independent randomization - each player randomized separately
    return randomizeIndependent(pieces);
  } else if (mode === 'shared') {
    // Shared randomization - all pieces redistributed among all starting squares
    return randomizeShared(pieces);
  }
  
  return pieces; // No randomization
}

/**
 * Full board randomization - pieces placed anywhere
 */
function randomizeFullBoard(pieces, gameType) {
  const boardWidth = gameType.board_width || 8;
  const boardHeight = gameType.board_height || 8;
  const occupiedSquares = new Set();
  
  return pieces.map(piece => {
    let x, y;
    let attempts = 0;
    const maxAttempts = boardWidth * boardHeight * 2;
    
    // Find an unoccupied square
    do {
      x = Math.floor(Math.random() * boardWidth);
      y = Math.floor(Math.random() * boardHeight);
      attempts++;
    } while (occupiedSquares.has(`${x},${y}`) && attempts < maxAttempts);
    
    occupiedSquares.add(`${x},${y}`);
    console.log(`Full randomization: ${piece.piece_name} (player ${piece.player_id}) -> (${x},${y})`);
    
    return { ...piece, x, y };
  });
}

/**
 * Mirrored randomization - maintain symmetry between players
 */
function randomizeMirrored(pieces, players, gameType) {
  const boardHeight = gameType.board_height || 8;
  
  // Group pieces by player
  const piecesByPlayer = {};
  pieces.forEach(piece => {
    if (!piecesByPlayer[piece.player_id]) {
      piecesByPlayer[piece.player_id] = [];
    }
    piecesByPlayer[piece.player_id].push(piece);
  });
  
  const playerIds = Object.keys(piecesByPlayer);
  if (playerIds.length !== 2) {
    console.warn('Mirrored randomization requires exactly 2 players, falling back to independent');
    return randomizeIndependent(pieces);
  }
  
  const player1Pieces = piecesByPlayer[playerIds[0]];
  const player2Pieces = piecesByPlayer[playerIds[1]];
  
  // Validate that boards are symmetric
  if (player1Pieces.length !== player2Pieces.length) {
    console.warn('Players have different number of pieces, falling back to independent');
    return randomizeIndependent(pieces);
  }
  
  // Check if pieces are at mirrored positions (basic validation)
  const p1Positions = player1Pieces.map(p => `${p.x},${boardHeight - 1 - p.y}`).sort();
  const p2Positions = player2Pieces.map(p => `${p.x},${p.y}`).sort();
  const isSymmetric = p1Positions.every((pos, idx) => pos === p2Positions[idx]);
  
  if (!isSymmetric) {
    console.warn('Board is not symmetric, falling back to independent');
    return randomizeIndependent(pieces);
  }
  
  // Get starting squares for player 1
  const player1Squares = player1Pieces.map(p => ({ x: p.x, y: p.y }));
  
  // Shuffle player 1's squares
  for (let i = player1Squares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [player1Squares[i], player1Squares[j]] = [player1Squares[j], player1Squares[i]];
  }
  
  // Apply to player 1 and mirror to player 2
  const newPieces = [];
  
  player1Pieces.forEach((piece, index) => {
    const newSquare = player1Squares[index];
    newPieces.push({ ...piece, x: newSquare.x, y: newSquare.y });
    console.log(`Player 1 - ${piece.piece_name}: (${piece.x},${piece.y}) -> (${newSquare.x},${newSquare.y})`);
  });
  
  player2Pieces.forEach((piece, index) => {
    // Mirror the position: if player 1 is at row 0, player 2 mirrors at row (boardHeight - 1)
    const player1Square = player1Squares[index];
    const mirroredY = boardHeight - 1 - player1Square.y;
    const mirroredX = player1Square.x;
    newPieces.push({ ...piece, x: mirroredX, y: mirroredY });
    console.log(`Player 2 - ${piece.piece_name}: (${piece.x},${piece.y}) -> (${mirroredX},${mirroredY}) [mirrored from (${player1Square.x},${player1Square.y})]`);
  });
  
  return newPieces;
}

/**
 * Chess960-style back row randomization - only the back row is randomized in mirrored fashion
 */
function randomizeBackRow(pieces, players, gameType) {
  const boardHeight = gameType.board_height || 8;
  
  // Group pieces by player
  const piecesByPlayer = {};
  pieces.forEach(piece => {
    if (!piecesByPlayer[piece.player_id]) {
      piecesByPlayer[piece.player_id] = [];
    }
    piecesByPlayer[piece.player_id].push(piece);
  });
  
  const playerIds = Object.keys(piecesByPlayer);
  if (playerIds.length !== 2) {
    console.warn('Back row randomization requires exactly 2 players, falling back to independent');
    return randomizeIndependent(pieces);
  }
  
  const player1Pieces = piecesByPlayer[playerIds[0]];
  const player2Pieces = piecesByPlayer[playerIds[1]];
  
  // Find the back row for each player (row with most pieces or furthest from center)
  const player1Rows = {};
  player1Pieces.forEach(p => {
    player1Rows[p.y] = (player1Rows[p.y] || 0) + 1;
  });
  const player1BackRow = Object.keys(player1Rows).reduce((a, b) => 
    player1Rows[a] > player1Rows[b] ? a : b
  );
  
  const player2Rows = {};
  player2Pieces.forEach(p => {
    player2Rows[p.y] = (player2Rows[p.y] || 0) + 1;
  });
  const player2BackRow = Object.keys(player2Rows).reduce((a, b) => 
    player2Rows[a] > player2Rows[b] ? a : b
  );
  
  console.log(`Player 1 back row: ${player1BackRow}, Player 2 back row: ${player2BackRow}`);
  
  // Get back row pieces for player 1
  const player1BackRowPieces = player1Pieces.filter(p => p.y === parseInt(player1BackRow));
  const player2BackRowPieces = player2Pieces.filter(p => p.y === parseInt(player2BackRow));
  
  // Get their x coordinates (column positions)
  const backRowXPositions = player1BackRowPieces.map(p => p.x);
  
  // Shuffle the x positions using Fisher-Yates
  for (let i = backRowXPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [backRowXPositions[i], backRowXPositions[j]] = [backRowXPositions[j], backRowXPositions[i]];
  }
  
  // Apply shuffled positions to player 1 back row
  player1BackRowPieces.forEach((piece, index) => {
    const oldX = piece.x;
    piece.x = backRowXPositions[index];
    console.log(`Player 1 back row - ${piece.piece_name}: (${oldX},${piece.y}) -> (${piece.x},${piece.y})`);
  });
  
  // Apply same shuffle pattern to player 2 (mirrored)
  player2BackRowPieces.forEach((piece, index) => {
    const oldX = piece.x;
    piece.x = backRowXPositions[index];
    console.log(`Player 2 back row - ${piece.piece_name}: (${oldX},${piece.y}) -> (${piece.x},${piece.y})`);
  });
  
  return pieces;
}

/**
 * Independent randomization - each player's pieces shuffled within their squares
 */
function randomizeIndependent(pieces) {
  // Group pieces by player_id
  const piecesByPlayer = {};
  pieces.forEach(piece => {
    if (!piecesByPlayer[piece.player_id]) {
      piecesByPlayer[piece.player_id] = [];
    }
    piecesByPlayer[piece.player_id].push(piece);
  });

  // For each player, get their starting squares and randomize pieces within them
  Object.keys(piecesByPlayer).forEach(playerId => {
    const playerPieces = piecesByPlayer[playerId];
    
    // Get all starting square coordinates for this player
    const startingSquares = playerPieces.map(p => ({ x: p.x, y: p.y }));
    
    // Shuffle the coordinates using Fisher-Yates algorithm
    for (let i = startingSquares.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [startingSquares[i], startingSquares[j]] = [startingSquares[j], startingSquares[i]];
    }
    
    // Assign shuffled positions back to pieces
    playerPieces.forEach((piece, index) => {
      const oldPos = { x: piece.x, y: piece.y };
      piece.x = startingSquares[index].x;
      piece.y = startingSquares[index].y;
      console.log(`Player ${playerId} - ${piece.piece_name}: (${oldPos.x},${oldPos.y}) -> (${piece.x},${piece.y})`);
    });
  });

  return pieces;
}

/**
 * Shared randomization - all pieces redistributed among all starting squares
 */
function randomizeShared(pieces) {
  // Collect all starting square coordinates from all pieces
  const allStartingSquares = pieces.map(p => ({ x: p.x, y: p.y }));
  
  // Shuffle all the coordinates using Fisher-Yates algorithm
  for (let i = allStartingSquares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allStartingSquares[i], allStartingSquares[j]] = [allStartingSquares[j], allStartingSquares[i]];
  }
  
  // Assign shuffled positions to all pieces (regardless of player)
  pieces.forEach((piece, index) => {
    const oldPos = { x: piece.x, y: piece.y };
    piece.x = allStartingSquares[index].x;
    piece.y = allStartingSquares[index].y;
    console.log(`Shared - ${piece.piece_name} (player ${piece.player_id}): (${oldPos.x},${oldPos.y}) -> (${piece.x},${piece.y})`);
  });
  
  return pieces;
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
          console.warn(`Socket.io CORS rejected origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true, // Allow Engine.IO v3 clients
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Global error handler for socket.io engine
  io.engine.on("connection_error", (err) => {
    console.error("Socket.io engine connection error:", {
      code: err.code,
      message: err.message,
      context: err.context
    });
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Handle socket errors
    socket.on("error", (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });

    // Authenticate user
    socket.on("authenticate", async (data) => {
      try {
        const { userId, username } = data;
        if (userId) {
          playerSockets.set(socket.id, { id: userId, username });
          userSockets.set(userId.toString(), socket.id);
          socket.userId = userId;
          socket.username = username;
          console.log(`User ${username} (ID: ${userId}) authenticated on socket ${socket.id}`);
        }
      } catch (error) {
        console.error("Error in authenticate handler:", error);
        socket.emit("error", { message: "Authentication failed" });
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
        const { gameTypeId, timeControl, increment, hostId, hostUsername, allowSpectators = true, showPieceHelpers = false, rated = true, allowPremoves = true } = data;
        
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
        
        // Fix player_id assignment based on Y position (for standard chess setup)
        // This ensures pieces have the correct ownership regardless of what's in the database
        const boardHeight = gameType.board_height || 8;
        piecesArray = piecesArray.map(piece => {
          // Determine player based on Y position
          // Bottom half of board (lower Y values) = Player 2
          // Top half of board (higher Y values) = Player 1
          const inferredPlayerId = piece.y < (boardHeight / 2) ? 2 : 1;
          
          return {
            ...piece,
            player_id: inferredPlayerId
          };
        });
        
        const piecesData = JSON.stringify(piecesArray);
        
        const [result] = await db_pool.query(
          `INSERT INTO games (created_at, turn_length, increment, player_count, player_turn, pieces, other_data, game_type_id, status, host_id, allow_spectators, show_piece_helpers)
           VALUES (?, ?, ?, 2, 1, ?, ?, ?, 'waiting', ?, ?, ?)`,
          [currentTime, timeControl, increment || 0, piecesData, JSON.stringify({ moves: [], rated, allowPremoves }), gameTypeId, hostId, allowSpectators ? 1 : 0, showPieceHelpers ? 1 : 0]
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
          showPieceHelpers,
          rated,
          allowPremoves,
          premove: null
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

        console.log(`Game ${gameId} created by ${hostUsername}`, {
          rated,
          allowPremoves,
          gameState: {
            rated: gameState.rated,
            allowPremoves: gameState.allowPremoves
          }
        });
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
            showPieceHelpers: game.show_piece_helpers === 1,
            allowPremoves: game.allow_premoves !== 0,
            rated: game.is_rated !== 0,
            premove: null
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

        // Check if randomized starting positions is enabled
        if (gameState.gameType.randomized_starting_positions) {
          try {
            const randomConfig = JSON.parse(gameState.gameType.randomized_starting_positions);
            const mode = randomConfig.mode || (randomConfig.enabled === true ? 'independent' : 'none');
            
            if (mode && mode !== 'none') {
              console.log(`Randomizing starting positions for game ${gameId} with mode: ${mode}`);
              gameState.pieces = randomizePiecePositions(gameState.pieces, gameState.players, mode, gameState.gameType);
              
              // Update the database with randomized pieces
              await db_pool.query(
                "UPDATE games SET pieces = ? WHERE id = ?",
                [JSON.stringify(gameState.pieces), gameId]
              );
            }
          } catch (err) {
            console.error("Error parsing randomized_starting_positions:", err);
          }
        }

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
          
          // Initialize castling partners for all pieces that can castle
          initializeCastlingPartners(gameState);
          
          // Notify everyone that a new game has started (for ongoing games list)
          io.emit("gameStarted", { gameId });
          
          // Start the game timer
          startGameTimer(io, gameId);
        }

        // Validate move (basic validation - full validation handled by game rules)
        const moveResult = validateAndApplyMove(gameState, move);
        
        if (!moveResult.valid) {
          console.log(`Move validation failed in game ${gameId}:`, {
            reason: moveResult.reason,
            move: move,
            currentTurn: gameState.currentTurn,
            userId: userId
          });
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

        // Initialize premove property if it doesn't exist (for backwards compatibility)
        if (gameState.premove === undefined) {
          gameState.premove = null;
        }

        // Check if opponent has a premove queued
        const nextPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
        let premoveExecuted = false;
        if (gameState.allowPremoves && gameState.premove && gameState.premove.playerId === nextPlayer?.id) {
          // Try to execute the premove
          const premove = gameState.premove;
          gameState.premove = null; // Clear premove
          
          // Validate that the premove is still valid after opponent's move
          const premoveResult = validateAndApplyMove(gameState, premove.move);
          
          if (premoveResult.valid) {
            // Premove is valid, execute it
            const premoveRecord = {
              from: premove.move.from,
              to: premove.move.to,
              pieceId: premove.move.pieceId,
              captured: premoveResult.captured,
              player: nextPlayer.id,
              position: gameState.currentTurn,
              timestamp: Date.now(),
              isPremove: true
            };
            gameState.moveHistory.push(premoveRecord);
            
            // Apply increment to player's time
            if (gameState.increment && gameState.playerTimes[nextPlayer.id]) {
              gameState.playerTimes[nextPlayer.id] += gameState.increment;
            }
            
            // Switch turns back
            gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;
            premoveExecuted = true;
            
            // Broadcast the premove execution
            io.to(`game-${gameId}`).emit("premoveExecuted", {
              gameId,
              move: premoveRecord,
              gameState: {
                pieces: gameState.pieces,
                currentTurn: gameState.currentTurn,
                playerTimes: gameState.playerTimes,
                moveHistory: gameState.moveHistory
              }
            });
            
            // Check for win conditions after premove (use premove's captured piece)
            const premoveWinResult = checkWinCondition(gameState, premoveResult.captured);
            if (premoveWinResult.gameOver) {
              // Stop the timer
              stopGameTimer(gameId);
              
              gameState.status = 'completed';
              gameState.winner = premoveWinResult.winner;
              gameState.winReason = premoveWinResult.reason;

              // Find loser
              const loser = gameState.players.find(p => p.id !== premoveWinResult.winner);

              // Update ELO ratings only if game is rated
              let eloChanges = null;
              if (gameState.rated !== false && premoveWinResult.winner && loser) {
                eloChanges = await updateEloRatings(premoveWinResult.winner, loser.id);
              }

              const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
              await db_pool.query(
                `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
                 pieces = ?, other_data = ? WHERE id = ?`,
                [endTime, premoveWinResult.winner, JSON.stringify(gameState.pieces), 
                 JSON.stringify({ 
                   moves: gameState.moveHistory, 
                   winner: premoveWinResult.winner, 
                   reason: premoveWinResult.reason, 
                   eloChanges,
                   rated: gameState.rated,
                   allowPremoves: gameState.allowPremoves
                 }),
                 gameId]
              );

              io.to(`game-${gameId}`).emit("gameOver", {
                gameId,
                winner: premoveWinResult.winner,
                reason: premoveWinResult.reason,
                finalState: gameState,
                eloChanges
              });
              
              return; // Exit early since game is over
            }
            
            // Check if the current player (after premove) is in check
            const premoveCheckResult = checkForCheck(gameState, gameState.currentTurn);
            
            // Store check status in game state
            gameState.inCheck = premoveCheckResult.inCheck;
            gameState.checkedPieces = premoveCheckResult.checkedPieces;

            // If in check, also check for checkmate (only if mate_condition is enabled)
            if (premoveCheckResult.inCheck && gameState.gameType?.mate_condition) {
              const isPremoveCheckmate = isCheckmate(gameState, gameState.currentTurn);
              
              if (isPremoveCheckmate) {
                // Checkmate detected - end the game
                stopGameTimer(gameId);
                
                gameState.status = 'completed';
                const checkmatedPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
                const winner = gameState.players.find(p => p.position !== gameState.currentTurn);
                gameState.winner = winner?.id;
                gameState.winReason = 'checkmate';

                // Update ELO ratings only if game is rated
                let eloChanges = null;
                if (gameState.rated !== false && winner?.id && checkmatedPlayer?.id) {
                  eloChanges = await updateEloRatings(winner.id, checkmatedPlayer.id);
                }

                const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
                await db_pool.query(
                  `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
                   pieces = ?, other_data = ? WHERE id = ?`,
                  [endTime, winner?.id, JSON.stringify(gameState.pieces), 
                   JSON.stringify({ 
                     moves: gameState.moveHistory, 
                     winner: winner?.id, 
                     reason: 'checkmate', 
                     eloChanges,
                     rated: gameState.rated,
                     allowPremoves: gameState.allowPremoves
                   }),
                   gameId]
                );

                io.to(`game-${gameId}`).emit("gameOver", {
                  gameId,
                  winner: winner?.id,
                  reason: 'checkmate',
                  finalState: gameState,
                  eloChanges
                });
                
                console.log(`CHECKMATE! Player ${checkmatedPlayer?.username} is checkmated in game ${gameId} after premove`);
                return; // Exit early since game is over
              }
            }
            
            // Broadcast check status after premove
            if (premoveCheckResult.inCheck) {
              io.to(`game-${gameId}`).emit("check", {
                gameId,
                playerInCheck: gameState.currentTurn,
                checkedPieces: premoveCheckResult.checkedPieces,
                gameState: {
                  inCheck: true,
                  checkedPieces: premoveCheckResult.checkedPieces
                }
              });
            }
            
            // After successful premove execution and checks, return to skip the regular flow
            return;
          } else {
            // Premove is no longer valid, notify player
            const nextPlayerSocketId = userSockets.get(nextPlayer.id.toString());
            if (nextPlayerSocketId) {
              io.to(nextPlayerSocketId).emit("premoveCancelled", {
                gameId,
                reason: premoveResult.reason || "Premove is no longer valid"
              });
            }
          }
        }

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

          // Update ELO ratings only if game is rated
          let eloChanges = null;
          if (gameState.rated !== false && winResult.winner && loser) {
            eloChanges = await updateEloRatings(winResult.winner, loser.id);
          }

          const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
          await db_pool.query(
            `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
             pieces = ?, other_data = ? WHERE id = ?`,
            [endTime, winResult.winner, JSON.stringify(gameState.pieces), 
             JSON.stringify({ 
               moves: gameState.moveHistory, 
               winner: winResult.winner, 
               reason: winResult.reason, 
               eloChanges,
               rated: gameState.rated,
               allowPremoves: gameState.allowPremoves
             }),
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
          
          console.log('After move - checking for check:', {
            currentTurn: gameState.currentTurn,
            inCheck: checkResult.inCheck,
            mateConditionEnabled: gameState.gameType?.mate_condition
          });
          
          // Store check status in game state
          gameState.inCheck = checkResult.inCheck;
          gameState.checkedPieces = checkResult.checkedPieces;

          // If in check, also check for checkmate (only if mate_condition is enabled)
          let isInCheckmate = false;
          if (checkResult.inCheck && gameState.gameType?.mate_condition) {
            console.log('Player is in check, checking for checkmate...');
            isInCheckmate = isCheckmate(gameState, gameState.currentTurn);
            console.log('Checkmate result:', isInCheckmate);
            
            if (isInCheckmate) {
              // Checkmate detected - end the game
              console.log('CHECKMATE DETECTED! Ending game...');
              stopGameTimer(gameId);
              
              gameState.status = 'completed';
              const checkmatedPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
              const winner = gameState.players.find(p => p.position !== gameState.currentTurn);
              gameState.winner = winner?.id;
              gameState.winReason = 'checkmate';

              // Update ELO ratings only if game is rated
              let eloChanges = null;
              if (gameState.rated !== false && winner?.id && checkmatedPlayer?.id) {
                eloChanges = await updateEloRatings(winner.id, checkmatedPlayer.id);
                console.log('ELO updated:', eloChanges);
              }

              const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
              try {
                await db_pool.query(
                  `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
                   pieces = ?, other_data = ? WHERE id = ?`,
                  [endTime, winner?.id, JSON.stringify(gameState.pieces), 
                   JSON.stringify({ 
                     moves: gameState.moveHistory, 
                     winner: winner?.id, 
                     reason: 'checkmate', 
                     eloChanges,
                     rated: gameState.rated,
                     allowPremoves: gameState.allowPremoves
                   }),
                   gameId]
                );
                console.log('Database updated successfully');
              } catch (dbError) {
                console.error('Failed to update database:', dbError);
              }

              io.to(`game-${gameId}`).emit("gameOver", {
                gameId,
                winner: winner?.id,
                reason: 'checkmate',
                finalState: gameState,
                eloChanges
              });
              console.log('gameOver event emitted to room game-' + gameId);
              
              console.log(`CHECKMATE! Player ${checkmatedPlayer?.username} is checkmated in game ${gameId}`);
              return; // Exit early since game is over
            }
          }

          // Update game state in database
          await db_pool.query(
            "UPDATE games SET player_turn = ?, pieces = ?, other_data = ? WHERE id = ?",
            [gameState.currentTurn, JSON.stringify(gameState.pieces), 
             JSON.stringify({ 
               moves: gameState.moveHistory, 
               inCheck: checkResult.inCheck,
               rated: gameState.rated,
               allowPremoves: gameState.allowPremoves
             }), gameId]
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
              checkedPieces: checkResult.checkedPieces,
              allowPremoves: gameState.allowPremoves,
              rated: gameState.rated
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

        // Update ELO ratings only if game is rated
        let eloChanges = null;
        if (gameState.rated !== false && winner?.id && userId) {
          eloChanges = await updateEloRatings(winner.id, userId);
        }

        const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db_pool.query(
          `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?, other_data = ?, pieces = ? WHERE id = ?`,
          [endTime, winner?.id, JSON.stringify({ 
            moves: gameState.moveHistory, 
            winner: winner?.id, 
            reason: 'resignation', 
            eloChanges,
            rated: gameState.rated,
            allowPremoves: gameState.allowPremoves
          }), JSON.stringify(gameState.pieces), gameId]
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

    // Set a premove
    socket.on("setPremove", async (data) => {
      try {
        const { gameId, userId, move } = data;
        const gameIdStr = gameId.toString();
        const gameState = activeGames.get(gameIdStr);

        if (!gameState) {
          return socket.emit("error", { message: "Game not found" });
        }

        // Initialize premove property if it doesn't exist (for backwards compatibility)
        if (gameState.premove === undefined) {
          gameState.premove = null;
        }

        // Check if premoves are allowed
        console.log('setPremove called:', { gameId, userId, allowPremoves: gameState.allowPremoves });
        if (gameState.allowPremoves === false) {
          return socket.emit("error", { message: "Premoves are not allowed in this game" });
        }

        // Verify it's NOT this player's turn (can only premove on opponent's turn)
        const currentPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
        if (currentPlayer && currentPlayer.id === userId) {
          return socket.emit("error", { message: "Cannot premove on your own turn" });
        }

        // Store the premove
        gameState.premove = {
          playerId: userId,
          move: move
        };

        // Confirm premove to player
        socket.emit("premoveSet", {
          gameId,
          move
        });

        console.log(`Premove set by player ${userId} in game ${gameId}`);
      } catch (error) {
        console.error("Error setting premove:", error);
        socket.emit("error", { message: "Failed to set premove" });
      }
    });

    // Clear a premove
    socket.on("clearPremove", async (data) => {
      try {
        const { gameId, userId } = data;
        const gameIdStr = gameId.toString();
        const gameState = activeGames.get(gameIdStr);

        if (!gameState) {
          return socket.emit("error", { message: "Game not found" });
        }

        // Clear the premove if it belongs to this player
        if (gameState.premove && gameState.premove.playerId === userId) {
          gameState.premove = null;
          socket.emit("premoveCleared", { gameId });
        }
      } catch (error) {
        console.error("Error clearing premove:", error);
        socket.emit("error", { message: "Failed to clear premove" });
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

          // Fix player_id assignment based on Y position (for standard chess setup)
          // This ensures pieces have the correct ownership regardless of database state
          const boardHeight = gameType?.board_height || 8;
          pieces = pieces.map(piece => {
            // Determine player based on ORIGINAL Y position from piece ID
            // Piece IDs are formatted as: pieceId_originalRow_originalCol
            const idParts = piece.id?.split('_');
            if (idParts && idParts.length >= 2) {
              const originalRow = parseInt(idParts[1]);
              // Bottom half of board (lower Y values) = Player 2
              // Top half of board (higher Y values) = Player 1  
              const inferredPlayerId = originalRow < (boardHeight / 2) ? 2 : 1;
              return {
                ...piece,
                player_id: inferredPlayerId
              };
            }
            return piece;
          });

          // Parse move history and settings
          let moveHistory = [];
          let rated = true;
          let allowPremoves = true;
          try {
            const otherData = JSON.parse(game.other_data || '{}');
            moveHistory = otherData.moves || [];
            rated = otherData.rated !== false; // Default to true
            allowPremoves = otherData.allowPremoves !== false; // Default to true
            console.log('Loaded game settings from DB:', { rated, allowPremoves, otherData });
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
            showPieceHelpers: game.show_piece_helpers === 1,
            rated: rated,
            allowPremoves: allowPremoves,
            premove: null
          };

          // Check if current player is in check (if game is active)
          if (gameState.status === 'active' && gameState.gameType?.mate_condition) {
            const checkResult = checkForCheck(gameState, gameState.currentTurn);
            gameState.inCheck = checkResult.inCheck;
            gameState.checkedPieces = checkResult.checkedPieces;
          } else {
            gameState.inCheck = false;
            gameState.checkedPieces = [];
          }

          // Store in memory for future use
          activeGames.set(gameId.toString(), gameState);
          
          // If game is active and has time control, restart the timer
          if (gameState.status === 'active' && gameState.timeControl) {
            console.log(`Restarting timer for active game ${gameId} after server restart`);
            startGameTimer(io, gameId);
          }
          
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

        // Update ELO ratings only if game is rated
        let eloChanges = null;
        if (currentGameState.rated !== false && winner?.id && currentPlayer.id) {
          eloChanges = await updateEloRatings(winner.id, currentPlayer.id);
        }
        
        const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db_pool.query(
          `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
           pieces = ?, other_data = ? WHERE id = ?`,
          [endTime, winner?.id, JSON.stringify(currentGameState.pieces), 
           JSON.stringify({ 
             moves: currentGameState.moveHistory, 
             winner: winner?.id, 
             reason: 'timeout', 
             eloChanges,
             rated: currentGameState.rated,
             allowPremoves: currentGameState.allowPremoves
           }),
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
  
  const originalPos = { x: simulatedPieces[pieceIndex].x, y: simulatedPieces[pieceIndex].y };
  
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
  
  if (checkResult.inCheck) {
    console.log('Move would leave player in check:', {
      pieceId,
      from: originalPos,
      to: to,
      playerPosition,
      stillInCheck: true
    });
  }
  
  return checkResult.inCheck;
}

/**
 * Initialize castling partners for all pieces at the start of the game
 * @param {Object} gameState - The current game state
 */
function initializeCastlingPartners(gameState) {
  const { pieces, gameType } = gameState;
  const boardWidth = gameType?.board_width || 8;
  
  pieces.forEach(piece => {
    if (piece.can_castle && !piece.castling_partner_id) {
      const pieceOwner = piece.team || piece.player_id;
      
      // Find furthest allied piece to the left
      let leftPartner = null;
      for (let x = piece.x - 1; x >= 0; x--) {
        const foundPiece = pieces.find(p => p.x === x && p.y === piece.y);
        if (foundPiece) {
          const foundOwner = foundPiece.team || foundPiece.player_id;
          if (foundOwner === pieceOwner) {
            leftPartner = foundPiece;
          }
          break; // Stop at first piece found
        }
      }
      
      // Find furthest allied piece to the right
      let rightPartner = null;
      for (let x = piece.x + 1; x < boardWidth; x++) {
        const foundPiece = pieces.find(p => p.x === x && p.y === piece.y);
        if (foundPiece) {
          const foundOwner = foundPiece.team || foundPiece.player_id;
          if (foundOwner === pieceOwner) {
            rightPartner = foundPiece;
          }
          break; // Stop at first piece found
        }
      }
      
      // Store the castling partners
      if (leftPartner) {
        piece.castling_partner_left_id = leftPartner.id;
      }
      if (rightPartner) {
        piece.castling_partner_right_id = rightPartner.id;
      }
    }
  });
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

  // Verify the piece is at the 'from' position
  if (piece.x !== from.x || piece.y !== from.y) {
    console.log('Piece position mismatch:', {
      piecePosition: { x: piece.x, y: piece.y },
      fromPosition: from
    });
    return { valid: false, reason: "Piece is not at the specified position" };
  }

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
    
    // Important: Validate that the piece can actually capture to this square
    // This is critical for premoves that become captures
    const canCapture = canPieceAttackSquare(piece, to.x, to.y, pieces);
    if (!canCapture) {
      return { valid: false, reason: "Piece cannot capture to that square" };
    }
  } else {
    // No piece at destination - validate this is a legal non-capture move
    // Use canPieceMoveToSquare which checks movement rules only (not capture rules)
    const canMove = canPieceMoveToSquare(piece, to.x, to.y, pieces);
    if (!canMove) {
      return { valid: false, reason: "Piece cannot move to that square" };
    }
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
    // Increment moveCount for availableForMoves tracking
    if (movingPiece.moveCount === undefined) {
      movingPiece.moveCount = 1;
    } else {
      movingPiece.moveCount++;
    }

    // Handle castling - move the target piece to opposite side
    if (move.isCastling && move.castlingWith && move.castlingDirection) {
      const castlingTargetPiece = pieces.find(p => p.id === move.castlingWith);
      if (castlingTargetPiece) {
        // Calculate the destination for the castling target piece
        // It should be placed on the opposite side of the castling piece
        if (move.castlingDirection === 'left') {
          // Castling piece moved 2 squares left, target goes to right of it
          castlingTargetPiece.x = to.x + 1;
          castlingTargetPiece.y = to.y;
        } else {
          // Castling piece moved 2 squares right, target goes to left of it
          castlingTargetPiece.x = to.x - 1;
          castlingTargetPiece.y = to.y;
        }
        castlingTargetPiece.hasMoved = true;
        // Increment moveCount for the castling target as well
        if (castlingTargetPiece.moveCount === undefined) {
          castlingTargetPiece.moveCount = 1;
        } else {
          castlingTargetPiece.moveCount++;
        }
      }
    }
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
  
  // Check if piece needs direction flipping
  const pieceOwner = piece.team || piece.player_id;
  const isPlayer2 = pieceOwner === 2;
  
  // For ALL player 2 pieces, flip perspective to match client-side
  // Client uses: rowDiff = player2 ? (fromY - toY) : (toY - fromY)
  // So we flip: dy becomes -dy, dx becomes -dx
  const effectiveDx = isPlayer2 ? -dx : dx;
  const effectiveDy = isPlayer2 ? -dy : dy;
  
  // Parse additional captures from special_scenario_captures
  let additionalCaptures = {};
  if (piece.special_scenario_captures) {
    try {
      const parsed = typeof piece.special_scenario_captures === 'string' 
        ? JSON.parse(piece.special_scenario_captures)
        : piece.special_scenario_captures;
      additionalCaptures = parsed.additionalCaptures || {};
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  // Check additional captures first
  const directionMap = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
    up_left: [-1, -1],
    up_right: [1, -1],
    down_left: [-1, 1],
    down_right: [1, 1]
  };
  
  for (const [direction, captureOptions] of Object.entries(additionalCaptures)) {
    const [dirDx, dirDy] = directionMap[direction] || [0, 0];
    if (dirDx === 0 && dirDy === 0) continue;
    
    // Check if this direction matches the target
    const expectedDx = dirDx * absDx;
    const expectedDy = dirDy * absDy;
    
    for (const captureOption of captureOptions) {
      // Check if this capture has availableForMoves restriction
      if (captureOption.availableForMoves && piece.moveCount >= captureOption.availableForMoves) continue;
      // Legacy support for firstMoveOnly
      if (captureOption.firstMoveOnly && piece.moveCount > 0) continue;
      
      // Calculate the capture value
      let maxDist = captureOption.value || 0;
      if (captureOption.infinite) maxDist = 99;
      
      // Check if direction and distance match
      if (dirDx !== 0 && dirDy !== 0) {
        // Diagonal
        if (absDx === absDy) {
          const dist = absDx;
          if (captureOption.exact) {
            if (dist === maxDist) return true;
          } else {
            if (maxDist === 99 || dist <= maxDist) return true;
          }
        }
      } else if (dirDx !== 0) {
        // Horizontal
        if (dy === 0) {
          if (captureOption.exact) {
            if (absDx === maxDist) return true;
          } else {
            if (maxDist === 99 || absDx <= maxDist) return true;
          }
        }
      } else if (dirDy !== 0) {
        // Vertical
        if (dx === 0) {
          if (captureOption.exact) {
            if (absDy === maxDist) return true;
          } else {
            if (maxDist === 99 || absDy <= maxDist) return true;
          }
        }
      }
    }
  }
  
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
    // Vertical movement - use effectiveDy for direction checking
    const captureVal = effectiveDy < 0 ? piece.up_capture : piece.down_capture;
    const moveVal = effectiveDy < 0 ? piece.up_movement : piece.down_movement;
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
    // Use effectiveDx and effectiveDy for direction checking
    if (effectiveDx < 0 && effectiveDy < 0) {
      captureVal = piece.up_left_capture;
      moveVal = piece.up_left_movement;
    } else if (effectiveDx > 0 && effectiveDy < 0) {
      captureVal = piece.up_right_capture;
      moveVal = piece.up_right_movement;
    } else if (effectiveDx < 0 && effectiveDy > 0) {
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
  
  // L-shape movement (knight-like) - check path unless hopping enabled
  const ratio1 = piece.ratio_capture_1 || (useMovementForCapture ? piece.ratio_movement_1 : 0) || 0;
  const ratio2 = piece.ratio_capture_2 || (useMovementForCapture ? piece.ratio_movement_2 : 0) || 0;
  if (ratio1 > 0 && ratio2 > 0) {
    if ((absDx === ratio1 && absDy === ratio2) || (absDx === ratio2 && absDy === ratio1)) {
      const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
      const canHopEnemies = piece.can_hop_over_enemies === 1 || piece.can_hop_over_enemies === true;
      const pieceOwner = piece.team || piece.player_id;
      
      // Debug hopping values
      console.log('Ratio movement capture check:', {
        pieceName: piece.name,
        can_hop_over_allies_raw: piece.can_hop_over_allies,
        can_hop_over_enemies_raw: piece.can_hop_over_enemies,
        canHopAllies,
        canHopEnemies
      });
      
      // If can hop over everything, attack is valid
      if (canHopAllies && canHopEnemies) {
        console.log('Allowing hop - can hop over both');
        return true;
      }
      
      // If no hopping ability at all, path must be completely clear
      if (!canHopAllies && !canHopEnemies) {
        console.log('No hopping ability - checking if path is clear');
        // Check all squares in both possible L-shape paths
        const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
        
        // Path 1: Move along X axis first, then Y axis
        let path1Clear = true;
        // Move along X
        for (let i = 1; i <= absDx; i++) {
          const checkX = piece.x + (stepX * i);
          const checkY = piece.y;
          if (checkX !== targetX || checkY !== targetY) {
            if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
              path1Clear = false;
              break;
            }
          }
        }
        // Then move along Y from the end of X movement
        if (path1Clear) {
          for (let i = 1; i <= absDy; i++) {
            const checkX = piece.x + (stepX * absDx);
            const checkY = piece.y + (stepY * i);
            if (checkX !== targetX || checkY !== targetY) {
              if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
                path1Clear = false;
                break;
              }
            }
          }
        }
        
        // Path 2: Move along Y axis first, then X axis
        let path2Clear = true;
        // Move along Y
        for (let i = 1; i <= absDy; i++) {
          const checkX = piece.x;
          const checkY = piece.y + (stepY * i);
          if (checkX !== targetX || checkY !== targetY) {
            if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
              path2Clear = false;
              break;
            }
          }
        }
        // Then move along X from the end of Y movement
        if (path2Clear) {
          for (let i = 1; i <= absDx; i++) {
            const checkX = piece.x + (stepX * i);
            const checkY = piece.y + (stepY * absDy);
            if (checkX !== targetX || checkY !== targetY) {
              if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
                path2Clear = false;
                break;
              }
            }
          }
        }
        
        return path1Clear || path2Clear;
      }
      
      // Helper to check if piece can hop over an obstruction
      const canHopOver = (obstruction) => {
        const obstructionOwner = obstruction.team || obstruction.player_id;
        const isAlly = obstructionOwner === pieceOwner;
        return (isAlly && canHopAllies) || (!isAlly && canHopEnemies);
      };
      
      // Check if either path is clear (with selective hopping)
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      
      // Path 1: Move along X axis first, then Y axis
      let path1Clear = true;
      // Move along X
      for (let i = 1; i <= absDx; i++) {
        const checkX = piece.x + (stepX * i);
        const checkY = piece.y;
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path1Clear = false;
            break;
          }
        }
      }
      // Then move along Y from the end of X movement
      if (path1Clear) {
        for (let i = 1; i <= absDy; i++) {
          const checkX = piece.x + (stepX * absDx);
          const checkY = piece.y + (stepY * i);
          if (checkX !== targetX || checkY !== targetY) {
            const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
            if (obstruction && !canHopOver(obstruction)) {
              path1Clear = false;
              break;
            }
          }
        }
      }
      
      // Path 2: Move along Y axis first, then X axis
      let path2Clear = true;
      // Move along Y
      for (let i = 1; i <= absDy; i++) {
        const checkX = piece.x;
        const checkY = piece.y + (stepY * i);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path2Clear = false;
            break;
          }
        }
      }
      // Then move along X from the end of Y movement
      if (path2Clear) {
        for (let i = 1; i <= absDx; i++) {
          const checkX = piece.x + (stepX * i);
          const checkY = piece.y + (stepY * absDy);
          if (checkX !== targetX || checkY !== targetY) {
            const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
            if (obstruction && !canHopOver(obstruction)) {
              path2Clear = false;
              break;
            }
          }
        }
      }
      
      return path1Clear || path2Clear;
    }
  }
  
  return false;
}

/**
 * Check if a piece can move to a specific square (non-capture)
 * This validates ONLY the movement rules, not capture rules
 */
function canPieceMoveToSquare(piece, targetX, targetY, allPieces) {
  const dx = targetX - piece.x;
  const dy = targetY - piece.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  
  if (dx === 0 && dy === 0) return false;
  
  // Check if piece needs direction flipping
  const pieceOwner = piece.team || piece.player_id;
  const isPlayer2 = pieceOwner === 2;
  
  // For ALL player 2 pieces, flip perspective
  const effectiveDx = isPlayer2 ? -dx : dx;
  const effectiveDy = isPlayer2 ? -dy : dy;
  
  // Helper function to check if path is clear
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

  // Check directional movement (straight lines)
  if (dx === 0 && dy !== 0) {
    // Vertical movement
    const moveVal = effectiveDy < 0 ? piece.up_movement : piece.down_movement;
    if (moveVal) {
      const maxDist = Math.abs(moveVal);
      if (moveVal === 99 || absDy <= maxDist) {
        if (isPathClear(piece.x, piece.y, targetX, targetY)) {
          return true;
        }
      }
    }
  }
  
  if (dy === 0 && dx !== 0) {
    // Horizontal movement
    const moveVal = dx < 0 ? piece.left_movement : piece.right_movement;
    if (moveVal) {
      const maxDist = Math.abs(moveVal);
      if (moveVal === 99 || absDx <= maxDist) {
        if (isPathClear(piece.x, piece.y, targetX, targetY)) {
          return true;
        }
      }
    }
  }

  // Diagonal movement
  if (absDx === absDy && absDx > 0) {
    let moveVal;
    if (effectiveDy < 0 && effectiveDx < 0) {
      moveVal = piece.up_left_movement;
    } else if (effectiveDy < 0 && effectiveDx > 0) {
      moveVal = piece.up_right_movement;
    } else if (effectiveDy > 0 && effectiveDx < 0) {
      moveVal = piece.down_left_movement;
    } else {
      moveVal = piece.down_right_movement;
    }
    
    if (moveVal) {
      const maxDist = Math.abs(moveVal);
      if (moveVal === 99 || absDx <= maxDist) {
        if (isPathClear(piece.x, piece.y, targetX, targetY)) {
          return true;
        }
      }
    }
  }

  // L-shape movement (knight-like)
  const ratio1 = piece.ratio_movement_1 || 0;
  const ratio2 = piece.ratio_movement_2 || 0;
  if (ratio1 > 0 && ratio2 > 0) {
    if ((absDx === ratio1 && absDy === ratio2) || (absDx === ratio2 && absDy === ratio1)) {
      const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
      const canHopEnemies = piece.can_hop_over_enemies === 1 || piece.can_hop_over_enemies === true;
      const pieceOwner = piece.team || piece.player_id;
      
      // If can hop over everything, no need to check path
      if (canHopAllies && canHopEnemies) {
        return true;
      }
      
      // Helper to determine if can hop over a piece
      const canHopOver = (obstructionPiece) => {
        const obstructionOwner = obstructionPiece.team || obstructionPiece.player_id;
        if (obstructionOwner === pieceOwner) {
          return canHopAllies;
        } else {
          return canHopEnemies;
        }
      };
      
      // Check both L-paths
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      
      // Path 1: Move X first, then Y
      let path1Clear = true;
      for (let i = 1; i <= absDx; i++) {
        const checkX = piece.x + (stepX * i);
        const checkY = piece.y;
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path1Clear = false;
            break;
          }
        }
      }
      if (path1Clear) {
        for (let i = 1; i <= absDy; i++) {
          const checkX = piece.x + (stepX * absDx);
          const checkY = piece.y + (stepY * i);
          if (checkX !== targetX || checkY !== targetY) {
            const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
            if (obstruction && !canHopOver(obstruction)) {
              path1Clear = false;
              break;
            }
          }
        }
      }
      
      // Path 2: Move Y first, then X
      let path2Clear = true;
      for (let i = 1; i <= absDy; i++) {
        const checkX = piece.x;
        const checkY = piece.y + (stepY * i);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path2Clear = false;
            break;
          }
        }
      }
      if (path2Clear) {
        for (let i = 1; i <= absDx; i++) {
          const checkX = piece.x + (stepX * i);
          const checkY = piece.y + (stepY * absDy);
          if (checkX !== targetX || checkY !== targetY) {
            const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
            if (obstruction && !canHopOver(obstruction)) {
              path2Clear = false;
              break;
            }
          }
        }
      }
      
      return path1Clear || path2Clear;
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
 * Get all possible moves for a piece
 * @param {Object} piece - The piece to get moves for
 * @param {Array} allPieces - All pieces on the board
 * @param {Object} gameType - The game type with board dimensions
 * @returns {Array} - Array of {x, y} positions the piece can move to
 */
function getPossibleMovesForPiece(piece, allPieces, gameType) {
  const moves = [];
  const boardWidth = gameType.board_width || 8;
  const boardHeight = gameType.board_height || 8;
  
  // Initialize moveCount if not present
  if (piece.moveCount === undefined) {
    piece.moveCount = piece.hasMoved ? 1 : 0;
  }
  
  // Check if piece has global first_move_only restriction and has already moved
  const hasGlobalFirstMoveOnlyRestriction = piece.first_move_only && piece.moveCount > 0;
  const hasGlobalFirstMoveOnlyCaptureRestriction = piece.first_move_only_capture && piece.moveCount > 0;
  
  // Parse additional movements from special_scenario_moves
  let additionalMovements = {};
  if (piece.special_scenario_moves) {
    try {
      const parsed = typeof piece.special_scenario_moves === 'string' 
        ? JSON.parse(piece.special_scenario_moves)
        : piece.special_scenario_moves;
      additionalMovements = parsed.additionalMovements || {};
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  // Helper to check if a square is valid on the board
  const isValidSquare = (x, y) => x >= 0 && x < boardWidth && y >= 0 && y < boardHeight;
  
  // Determine if piece belongs to Player 2 (pieces that start at bottom need flipped directions)
  const pieceOwner = piece.team || piece.player_id;
  const isPlayer2 = pieceOwner === 2;
  
  // Helper to check if path is clear
  const isPathClear = (fromX, fromY, toX, toY) => {
    const stepX = toX > fromX ? 1 : toX < fromX ? -1 : 0;
    const stepY = toY > fromY ? 1 : toY < fromY ? -1 : 0;
    let x = fromX + stepX;
    let y = fromY + stepY;
    
    while (x !== toX || y !== toY) {
      if (allPieces.some(p => p.x === x && p.y === y)) {
        return false;
      }
      x += stepX;
      y += stepY;
    }
    return true;
  };
  
  // Helper to check directional moves
  const checkDirectionalMoves = (dx, dy, maxDist, directionName = null, isFirstMoveOnly = false) => {
    if (!maxDist || maxDist === 0) return;
    
    // Check global first_move_only restriction
    if (hasGlobalFirstMoveOnlyRestriction) return;
    
    // Check direction-specific availableForMoves
    if (directionName && piece[`${directionName}_available_for`]) {
      const availableForMoves = piece[`${directionName}_available_for`];
      if (piece.moveCount >= availableForMoves) return;
    }
    
    const limit = maxDist === 99 ? Math.max(boardWidth, boardHeight) : Math.abs(maxDist);
    for (let dist = 1; dist <= limit; dist++) {
      const targetX = piece.x + (dx * dist);
      const targetY = piece.y + (dy * dist);
      
      if (!isValidSquare(targetX, targetY)) break;
      
      // Check if path is clear up to this point
      if (!isPathClear(piece.x, piece.y, targetX, targetY)) break;
      
      const targetPiece = allPieces.find(p => p.x === targetX && p.y === targetY);
      if (targetPiece) {
        const pieceOwner = piece.team || piece.player_id;
        const targetOwner = targetPiece.team || targetPiece.player_id;
        
        // Can capture enemy pieces if can_capture_enemy_on_move is true and not restricted by first_move_only_capture
        if (targetOwner !== pieceOwner && piece.can_capture_enemy_on_move && !hasGlobalFirstMoveOnlyCaptureRestriction) {
          moves.push({ x: targetX, y: targetY, isFirstMoveOnly });
        }
        break; // Can't move past a piece
      } else {
        moves.push({ x: targetX, y: targetY, isFirstMoveOnly });
      }
    }
  };
  
  // Directional movements - flip up/down for Player 2
  if (isPlayer2) {
    // For Player 2 (bottom of board), flip up/down directions
    if (piece.up_movement) checkDirectionalMoves(0, 1, piece.up_movement, 'up_movement'); // up becomes increasing Y
    if (piece.down_movement) checkDirectionalMoves(0, -1, piece.down_movement, 'down_movement'); // down becomes decreasing Y
  } else {
    // For Player 1 (top of board), use normal directions
    if (piece.up_movement) checkDirectionalMoves(0, -1, piece.up_movement, 'up_movement'); // up is decreasing Y
    if (piece.down_movement) checkDirectionalMoves(0, 1, piece.down_movement, 'down_movement'); // down is increasing Y
  }
  if (piece.left_movement) checkDirectionalMoves(-1, 0, piece.left_movement, 'left_movement');
  if (piece.right_movement) checkDirectionalMoves(1, 0, piece.right_movement, 'right_movement');
  
  // Diagonal movements - flip vertical component for Player 2
  if (isPlayer2) {
    if (piece.up_left_movement) checkDirectionalMoves(-1, 1, piece.up_left_movement, 'up_left_movement');
    if (piece.up_right_movement) checkDirectionalMoves(1, 1, piece.up_right_movement, 'up_right_movement');
    if (piece.down_left_movement) checkDirectionalMoves(-1, -1, piece.down_left_movement, 'down_left_movement');
    if (piece.down_right_movement) checkDirectionalMoves(1, -1, piece.down_right_movement, 'down_right_movement');
  } else {
    if (piece.up_left_movement) checkDirectionalMoves(-1, -1, piece.up_left_movement, 'up_left_movement');
    if (piece.up_right_movement) checkDirectionalMoves(1, -1, piece.up_right_movement, 'up_right_movement');
    if (piece.down_left_movement) checkDirectionalMoves(-1, 1, piece.down_left_movement, 'down_left_movement');
    if (piece.down_right_movement) checkDirectionalMoves(1, 1, piece.down_right_movement, 'down_right_movement');
  }
  
  // Process additional movements from special_scenario_moves
  const directionMap = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
    up_left: [-1, -1],
    up_right: [1, -1],
    down_left: [-1, 1],
    down_right: [1, 1]
  };
  
  for (const [direction, movementOptions] of Object.entries(additionalMovements)) {
    const [dx, dy] = directionMap[direction] || [0, 0];
    if (dx === 0 && dy === 0) continue;
    
    for (const movementOption of movementOptions) {
      // Check if this movement has availableForMoves restriction
      if (movementOption.availableForMoves && piece.moveCount >= movementOption.availableForMoves) continue;
      // Legacy support for firstMoveOnly
      if (movementOption.firstMoveOnly && piece.moveCount > 0) continue;
      
      // Calculate the movement value
      let maxDist = movementOption.value || 0;
      if (movementOption.infinite) maxDist = 99;
      if (movementOption.exact) maxDist = -Math.abs(maxDist);
      
      // Use checkDirectionalMoves to process this additional movement
      if (maxDist !== 0) {
        checkDirectionalMoves(dx, dy, maxDist, null, movementOption.availableForMoves || movementOption.firstMoveOnly || false);
      }
    }
  }
  
  // Ratio movements (knight-like)
  const ratio1 = piece.ratio_movement_1 || 0;
  const ratio2 = piece.ratio_movement_2 || 0;
  if (ratio1 > 0 && ratio2 > 0) {
    const ratioMoves = [
      [ratio1, ratio2], [ratio1, -ratio2], [-ratio1, ratio2], [-ratio1, -ratio2],
      [ratio2, ratio1], [ratio2, -ratio1], [-ratio2, ratio1], [-ratio2, -ratio1]
    ];
    
    const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
    const canHopEnemies = piece.can_hop_over_enemies === 1 || piece.can_hop_over_enemies === true;
    const pieceOwner = piece.team || piece.player_id;
    
    console.log('Ratio movement check:', {
      pieceName: piece.name,
      can_hop_over_allies_raw: piece.can_hop_over_allies,
      can_hop_over_enemies_raw: piece.can_hop_over_enemies,
      canHopAllies,
      canHopEnemies
    });
    
    for (const [dx, dy] of ratioMoves) {
      const targetX = piece.x + dx;
      const targetY = piece.y + dy;
      
      if (!isValidSquare(targetX, targetY)) continue;
      
      // Check if piece has NO hopping ability at all
      const noHoppingAbility = !canHopAllies && !canHopEnemies;
      
      if (noHoppingAbility) {
        // If no hopping ability, path must be completely clear
        const absRatio1 = Math.abs(dx) > Math.abs(dy) ? Math.abs(dx) : Math.abs(dy);
        const absRatio2 = Math.abs(dx) < Math.abs(dy) ? Math.abs(dx) : Math.abs(dy);
        const primaryIsX = Math.abs(dx) > Math.abs(dy);
        const primaryDir = primaryIsX ? (dx > 0 ? 1 : -1) : 0;
        const secondaryDir = primaryIsX ? 0 : (dy > 0 ? 1 : -1);
        const tertiaryDir = primaryIsX ? (dy > 0 ? 1 : -1) : (dx > 0 ? 1 : -1);
        
        // Check path 1: move in primary direction first
        let path1Clear = true;
        for (let i = 1; i <= absRatio1; i++) {
          const checkX = piece.x + (primaryIsX ? primaryDir * i : 0);
          const checkY = piece.y + (primaryIsX ? 0 : secondaryDir * i);
          if (checkX !== targetX || checkY !== targetY) {
            if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
              path1Clear = false;
              break;
            }
          }
        }
        if (path1Clear) {
          for (let i = 1; i <= absRatio2; i++) {
            const checkX = piece.x + (primaryIsX ? primaryDir * absRatio1 : tertiaryDir * i);
            const checkY = piece.y + (primaryIsX ? tertiaryDir * i : secondaryDir * absRatio1);
            if (checkX !== targetX || checkY !== targetY) {
              if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
                path1Clear = false;
                break;
              }
            }
          }
        }
        
        // Check path 2: move in secondary direction first
        let path2Clear = true;
        for (let i = 1; i <= absRatio2; i++) {
          const checkX = piece.x + (primaryIsX ? 0 : tertiaryDir * i);
          const checkY = piece.y + (primaryIsX ? tertiaryDir * i : 0);
          if (checkX !== targetX || checkY !== targetY) {
            if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
              path2Clear = false;
              break;
            }
          }
        }
        if (path2Clear) {
          for (let i = 1; i <= absRatio1; i++) {
            const checkX = piece.x + (primaryIsX ? primaryDir * i : tertiaryDir * absRatio2);
            const checkY = piece.y + (primaryIsX ? tertiaryDir * absRatio2 : secondaryDir * i);
            if (checkX !== targetX || checkY !== targetY) {
              if (allPieces.some(p => p.x === checkX && p.y === checkY)) {
                path2Clear = false;
                break;
              }
            }
          }
        }
        
        // If neither path is clear, skip this move
        if (!path1Clear && !path2Clear) {
          continue;
        }
      } else {
        // Check path with selective hopping (original logic)
        // For L-shaped moves, check both possible paths
        // Check path with selective hopping (original logic)
        // For L-shaped moves, check both possible paths
        const absRatio1 = Math.abs(dx) > Math.abs(dy) ? Math.abs(dx) : Math.abs(dy);
        const absRatio2 = Math.abs(dx) < Math.abs(dy) ? Math.abs(dx) : Math.abs(dy);
        
        // Determine primary and secondary directions
        const primaryIsX = Math.abs(dx) > Math.abs(dy);
        const primaryDir = primaryIsX ? (dx > 0 ? 1 : -1) : 0;
        const secondaryDir = primaryIsX ? 0 : (dy > 0 ? 1 : -1);
        const tertiaryDir = primaryIsX ? (dy > 0 ? 1 : -1) : (dx > 0 ? 1 : -1);
        
        // Helper to check if piece can hop over an obstruction
        const canHopOver = (obstruction) => {
          const obstructionOwner = obstruction.team || obstruction.player_id;
          const isAlly = obstructionOwner === pieceOwner;
          return (isAlly && canHopAllies) || (!isAlly && canHopEnemies);
        };
        
        // Check path 1: move in primary direction first
        let path1Clear = true;
        for (let i = 1; i <= absRatio1; i++) {
          const checkX = piece.x + (primaryIsX ? primaryDir * i : 0);
          const checkY = piece.y + (primaryIsX ? 0 : secondaryDir * i);
          if (checkX !== targetX || checkY !== targetY) {
            const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
            if (obstruction && !canHopOver(obstruction)) {
              path1Clear = false;
              break;
            }
          }
        }
        if (path1Clear) {
          for (let i = 1; i <= absRatio2; i++) {
            const checkX = piece.x + (primaryIsX ? primaryDir * absRatio1 : tertiaryDir * i);
            const checkY = piece.y + (primaryIsX ? tertiaryDir * i : secondaryDir * absRatio1);
            if (checkX !== targetX || checkY !== targetY) {
              const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
              if (obstruction && !canHopOver(obstruction)) {
                path1Clear = false;
                break;
              }
            }
          }
        }
        
        // Check path 2: move in secondary direction first
        let path2Clear = true;
        for (let i = 1; i <= absRatio2; i++) {
          const checkX = piece.x + (primaryIsX ? 0 : tertiaryDir * i);
          const checkY = piece.y + (primaryIsX ? tertiaryDir * i : 0);
          if (checkX !== targetX || checkY !== targetY) {
            const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
            if (obstruction && !canHopOver(obstruction)) {
              path2Clear = false;
              break;
            }
          }
        }
        if (path2Clear) {
          for (let i = 1; i <= absRatio1; i++) {
            const checkX = piece.x + (primaryIsX ? primaryDir * i : tertiaryDir * absRatio2);
            const checkY = piece.y + (primaryIsX ? tertiaryDir * absRatio2 : secondaryDir * i);
            if (checkX !== targetX || checkY !== targetY) {
              const obstruction = allPieces.find(p => p.x === checkX && p.y === checkY);
              if (obstruction && !canHopOver(obstruction)) {
                path2Clear = false;
                break;
              }
            }
          }
        }
        
        // If neither path is clear, skip this move
        if (!path1Clear && !path2Clear) {
          continue;
        }
      }
      
      const targetPiece = allPieces.find(p => p.x === targetX && p.y === targetY);
      if (targetPiece) {
        const pieceOwner = piece.team || piece.player_id;
        const targetOwner = targetPiece.team || targetPiece.player_id;
        
        if (targetOwner !== pieceOwner && piece.can_capture_enemy_on_move) {
          moves.push({ x: targetX, y: targetY });
        }
      } else {
        moves.push({ x: targetX, y: targetY });
      }
    }
  }
  
  // Castling
  if (piece.can_castle && !piece.hasMoved) {
    const pieceOwner = piece.team || piece.player_id;
    const hasCheckRule = piece.has_checkmate_rule || piece.has_check_rule;
    
    // Try castling to the left (2 squares left)
    const leftTarget = { x: piece.x - 2, y: piece.y };
    if (isValidSquare(leftTarget.x, leftTarget.y) && piece.castling_partner_left_id) {
      // Find the castling partner
      const rookPiece = allPieces.find(p => p.id === piece.castling_partner_left_id);
      
      if (rookPiece && !rookPiece.hasMoved) {
        // Check if all squares between are unoccupied
        let pathClear = true;
        for (let x = piece.x - 1; x >= rookPiece.x + 1; x--) {
          if (allPieces.some(p => p.x === x && p.y === piece.y)) {
            pathClear = false;
            break;
          }
        }
        
        // If piece has check rule, also check if any square in between is controlled by enemy
        if (pathClear && hasCheckRule) {
          for (let x = piece.x; x >= piece.x - 2; x--) {
            // Check if this square is under attack
            const underAttack = allPieces.some(enemyPiece => {
              const enemyOwner = enemyPiece.team || enemyPiece.player_id;
              if (enemyOwner !== pieceOwner) {
                const enemyMoves = getPossibleMovesForPiece(enemyPiece, allPieces, gameType);
                return enemyMoves.some(move => move.x === x && move.y === piece.y);
              }
              return false;
            });
            
            if (underAttack) {
              pathClear = false;
              break;
            }
          }
        }
        
        if (pathClear) {
          moves.push({ x: leftTarget.x, y: leftTarget.y, isCastling: true, castlingWith: rookPiece.id, castlingDirection: 'left' });
        }
      }
    }
    
    // Try castling to the right (2 squares right)
    const rightTarget = { x: piece.x + 2, y: piece.y };
    if (isValidSquare(rightTarget.x, rightTarget.y) && piece.castling_partner_right_id) {
      // Find the castling partner
      const rookPiece = allPieces.find(p => p.id === piece.castling_partner_right_id);
      
      if (rookPiece && !rookPiece.hasMoved) {
        // Check if all squares between are unoccupied
        let pathClear = true;
        for (let x = piece.x + 1; x <= rookPiece.x - 1; x++) {
          if (allPieces.some(p => p.x === x && p.y === piece.y)) {
            pathClear = false;
            break;
          }
        }
        
        // If piece has check rule, also check if any square in between is controlled by enemy
        if (pathClear && hasCheckRule) {
          for (let x = piece.x; x <= piece.x + 2; x++) {
            // Check if this square is under attack
            const underAttack = allPieces.some(enemyPiece => {
              const enemyOwner = enemyPiece.team || enemyPiece.player_id;
              if (enemyOwner !== pieceOwner) {
                const enemyMoves = getPossibleMovesForPiece(enemyPiece, allPieces, gameType);
                return enemyMoves.some(move => move.x === x && move.y === piece.y);
              }
              return false;
            });
            
            if (underAttack) {
              pathClear = false;
              break;
            }
          }
        }
        
        if (pathClear) {
          moves.push({ x: rightTarget.x, y: rightTarget.y, isCastling: true, castlingWith: rookPiece.id, castlingDirection: 'right' });
        }
      }
    }
  }
  
  return moves;
}

/**
 * Get all legal moves for a player (moves that don't leave them in check)
 * @param {Object} gameState - The current game state
 * @param {number} playerPosition - The player position (1 or 2)
 * @returns {Array} - Array of legal moves { pieceId, from: {x, y}, to: {x, y} }
 */
function getAllLegalMovesForPlayer(gameState, playerPosition) {
  const { pieces, gameType } = gameState;
  const legalMoves = [];
  
  // Get all pieces belonging to this player
  const playerPieces = pieces.filter(p => {
    const pieceOwner = p.team || p.player_id;
    return pieceOwner === playerPosition;
  });
  
  console.log('Getting legal moves for player', playerPosition, '- found', playerPieces.length, 'pieces');
  console.log('Sample pieces:', playerPieces.slice(0, 3).map(p => ({ 
    id: p.id, 
    team: p.team, 
    player_id: p.player_id,
    x: p.x,
    y: p.y
  })));
  
  // For each piece, get all possible moves
  for (const piece of playerPieces) {
    const possibleMoves = getPossibleMovesForPiece(piece, pieces, gameType);
    
    // Check if each move is legal (doesn't leave player in check)
    for (const toSquare of possibleMoves) {
      const move = {
        pieceId: piece.id,
        from: { x: piece.x, y: piece.y },
        to: toSquare
      };
      
      // If mate_condition is enabled, verify this move doesn't leave player in check
      if (gameType && gameType.mate_condition) {
        if (!wouldMoveLeaveInCheck(gameState, move, playerPosition)) {
          legalMoves.push(move);
          console.log('Legal move found:', {
            pieceId: piece.id,
            pieceTeam: piece.team,
            piecePlayerId: piece.player_id,
            from: move.from,
            to: move.to
          });
        }
      } else {
        // If no mate condition, all possible moves are legal
        legalMoves.push(move);
      }
    }
  }
  
  return legalMoves;
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
  
  // Player is in check - now verify they have no legal moves to escape
  const legalMoves = getAllLegalMovesForPlayer(gameState, playerPosition);
  
  console.log('Checkmate check:', {
    playerPosition,
    inCheck: checkResult.inCheck,
    checkedPieces: checkResult.checkedPieces.map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y })),
    legalMovesCount: legalMoves.length,
    legalMoves: legalMoves.slice(0, 5).map(m => ({ 
      pieceId: m.pieceId, 
      from: m.from, 
      to: m.to 
    }))
  });
  
  // If no legal moves exist, it's checkmate
  return legalMoves.length === 0;
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
