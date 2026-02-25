/**
 * Socket.io Game Handler
 * Manages real-time multiplayer game functionality
 */

const db_pool = require("../configs/db");

// Store io instance for access from other modules
let ioInstance = null;

// Store active games in memory for quick access
const activeGames = new Map();
const gameTimers = new Map(); // Maps gameId to timer interval
const playerSockets = new Map(); // Maps socket.id to userId
const userSockets = new Map(); // Maps userId to socket.id
const onlineUsers = new Set(); // Set of online user IDs
const disconnectTimeouts = new Map(); // Maps userId to disconnect timeout (grace period)

/**
 * Helper function to parse image_location and get the correct image URL based on player
 */
function getImageUrlForPlayer(imageLocation, playerNumber) {
  if (!imageLocation) return null;
  
  try {
    const images = JSON.parse(imageLocation);
    if (Array.isArray(images) && images.length > 0) {
      // Use player 1's image (index 0) or player 2's image (index 1) if available
      const imageIndex = (playerNumber === 2 && images.length > 1) ? 1 : 0;
      const imagePath = images[imageIndex];
      return imagePath.startsWith('http') ? imagePath : imagePath.startsWith('/uploads/') ? imagePath : `/uploads/pieces/${imagePath}`;
    }
  } catch {
    const imagePath = imageLocation;
    if (imagePath.startsWith('http')) {
      return imagePath;
    } else if (imagePath.startsWith('/uploads/')) {
      return imagePath;
    } else {
      return `/uploads/pieces/${imagePath}`;
    }
  }
  
  return null;
}

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
 * Both players' pieces swap among their own starting squares, maintaining mirror symmetry
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
  
  const playerIds = Object.keys(piecesByPlayer).sort((a, b) => Number(a) - Number(b));
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
  
  // Sort both arrays by position (y then x) to pair corresponding pieces
  // Player 1 pieces sorted normally, Player 2 pieces sorted with Y inverted
  const sortedP1 = [...player1Pieces].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
  
  const sortedP2 = [...player2Pieces].sort((a, b) => {
    // Invert Y for sorting to match P1's order (bottom row of P2 = top row of P1)
    const aInvertedY = boardHeight - 1 - a.y;
    const bInvertedY = boardHeight - 1 - b.y;
    if (aInvertedY !== bInvertedY) return aInvertedY - bInvertedY;
    return a.x - b.x;
  });
  
  // Get starting squares for player 1
  const player1Squares = sortedP1.map(p => ({ x: p.x, y: p.y }));
  
  // Shuffle player 1's squares
  for (let i = player1Squares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [player1Squares[i], player1Squares[j]] = [player1Squares[j], player1Squares[i]];
  }
  
  // Apply to both players - player 2 gets mirrored positions
  const newPieces = [];
  
  sortedP1.forEach((piece, index) => {
    const newSquare = player1Squares[index];
    newPieces.push({ ...piece, x: newSquare.x, y: newSquare.y });
    console.log(`Player 1 - ${piece.piece_name}: (${piece.x},${piece.y}) -> (${newSquare.x},${newSquare.y})`);
  });
  
  sortedP2.forEach((piece, index) => {
    // Mirror the shuffled position from player 1
    const p1Square = player1Squares[index];
    const mirroredY = boardHeight - 1 - p1Square.y;
    const mirroredX = p1Square.x;
    newPieces.push({ ...piece, x: mirroredX, y: mirroredY });
    console.log(`Player 2 - ${piece.piece_name}: (${piece.x},${piece.y}) -> (${mirroredX},${mirroredY}) [mirrored from (${p1Square.x},${p1Square.y})]`);
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
  
  const playerIds = Object.keys(piecesByPlayer).sort((a, b) => Number(a) - Number(b));
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
  
  // Get back row pieces for each player, sorted by X position
  const player1BackRowPieces = player1Pieces
    .filter(p => p.y === parseInt(player1BackRow))
    .sort((a, b) => a.x - b.x);
  const player2BackRowPieces = player2Pieces
    .filter(p => p.y === parseInt(player2BackRow))
    .sort((a, b) => a.x - b.x);
  
  // Get player 1's x coordinates and shuffle them
  const p1XPositions = player1BackRowPieces.map(p => p.x);
  const shuffledXPositions = [...p1XPositions];
  
  // Shuffle the x positions using Fisher-Yates
  for (let i = shuffledXPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledXPositions[i], shuffledXPositions[j]] = [shuffledXPositions[j], shuffledXPositions[i]];
  }
  
  // Build a mapping from old X -> new X for player 1
  const xMapping = {};
  player1BackRowPieces.forEach((piece, index) => {
    xMapping[p1XPositions[index]] = shuffledXPositions[index];
  });
  
  // Apply shuffled positions to player 1's back row
  player1BackRowPieces.forEach((piece, index) => {
    const oldX = piece.x;
    piece.x = shuffledXPositions[index];
    console.log(`Player 1 back row - ${piece.piece_name}: (${oldX},${piece.y}) -> (${piece.x},${piece.y})`);
  });
  
  // Apply the SAME mapping to player 2's back row so it mirrors player 1
  // This ensures that whatever piece type was at X=0 for P1 is also at X=0 for P2
  player2BackRowPieces.forEach((piece) => {
    const oldX = piece.x;
    if (xMapping.hasOwnProperty(oldX)) {
      piece.x = xMapping[oldX];
    }
    console.log(`Player 2 back row - ${piece.piece_name}: (${oldX},${piece.y}) -> (${piece.x},${piece.y}) [mirrored]`);
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

  // Store io instance for access from other modules
  ioInstance = io;
  
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
          // Cancel any pending disconnect timeout for this user
          const existingTimeout = disconnectTimeouts.get(userId);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
            disconnectTimeouts.delete(userId);
            console.log(`Cancelled disconnect timeout for user ${username} (ID: ${userId}) - reconnected`);
          }
          
          playerSockets.set(socket.id, { id: userId, username });
          userSockets.set(userId.toString(), socket.id);
          onlineUsers.add(userId);
          socket.userId = userId;
          socket.username = username;
          console.log(`User ${username} (ID: ${userId}) authenticated on socket ${socket.id}`);
          
          // Broadcast updated online users list
          io.emit("onlineUsers", Array.from(onlineUsers));
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
        const { gameTypeId, timeControl, increment, hostId, hostUsername, allowSpectators = true, showPieceHelpers = false, rated = true, allowPremoves = true, startingMode = 'none', challengedUserId = null } = data;
        
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
        
        // Load pieces from junction table with full piece movement data
        let piecesArray = [];
        const pieceIdsToLoad = new Set();
        
        try {
          // Get pieces from junction table (now includes checkmate/capture flags)
          const [junctionPieces] = await db_pool.query(
            `SELECT gtp.*, gtp.ends_game_on_checkmate, gtp.ends_game_on_capture, p.piece_name, p.image_location
             FROM game_type_pieces gtp
             INNER JOIN pieces p ON gtp.piece_id = p.id
             WHERE gtp.game_type_id = ?`,
            [gameTypeId]
          );

          piecesArray = junctionPieces.map(piece => {
            return {
              ...piece,
              id: `${piece.piece_id}_${piece.y}_${piece.x}`, // Unique ID for this piece instance
              // Store initial position for promotion square checking
              initial_x: piece.x,
              initial_y: piece.y,
              // Checkmate/Capture flags from junction table
              ends_game_on_checkmate: !!piece.ends_game_on_checkmate,
              ends_game_on_capture: !!piece.ends_game_on_capture,
              // Control squares flag from junction table
              can_control_squares: !!piece.can_control_squares,
              // Castling partner override data from junction table
              manual_castling_partners: !!piece.manual_castling_partners,
              castling_partner_left_key: piece.castling_partner_left_key || null,
              castling_partner_right_key: piece.castling_partner_right_key || null
            };
          });
          
          junctionPieces.forEach(p => { if (p.piece_id) pieceIdsToLoad.add(p.piece_id); });
        } catch (e) {
          console.error("Error loading pieces from junction table:", e);
          piecesArray = [];
        }
        
        // Load full piece data including movement and capture rules from joined tables
        const pieceDataMap = {};
        if (pieceIdsToLoad.size > 0) {
          const [pieceRows] = await db_pool.query(
            `SELECT * FROM pieces WHERE id IN (?)`,
            [Array.from(pieceIdsToLoad)]
          );
          pieceRows.forEach(p => { pieceDataMap[p.id] = p; });
          
            // Debug: Check what's in the piece data
            if (pieceRows.length > 0) {
              console.log('CREATE GAME - First piece from DB:', {
                id: pieceRows[0].id,
                piece_name: pieceRows[0].piece_name,
                special_scenario_moves: pieceRows[0].special_scenario_moves,
                special_scenario_captures: pieceRows[0].special_scenario_captures
              });
              
              // Find a pawn to specifically check
              const pawn = pieceRows.find(p => p.piece_name === 'Pawn');
              if (pawn) {
                console.log('CREATE GAME - Pawn data from DB:', {
                  id: pawn.id,
                  piece_name: pawn.piece_name,
                  special_scenario_moves: pawn.special_scenario_moves,
                  special_scenario_captures: pawn.special_scenario_captures
                });
              }
            }
            
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
              can_capture_enemy_on_move: pieceRows[0].can_capture_enemy_on_move,
              special_scenario_moves: pieceRows[0].special_scenario_moves,
              special_scenario_captures: pieceRows[0].special_scenario_captures
            });
          }
        }
        
        // Fix player_id assignment based on Y position FIRST (before setting images)
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
        
        // Merge piece movement data into pieces array (now that player_id is set)
        piecesArray = piecesArray.map(piece => {
          const fullPieceData = pieceDataMap[piece.piece_id];
          if (fullPieceData) {
            const imageLocation = piece.image_location || fullPieceData.image_location;
            const imageUrl = getImageUrlForPlayer(imageLocation, piece.player_id);
            
            // Debug logging for first piece
            if (piece.piece_id === piecesArray[0]?.piece_id) {
              console.log('Processing piece image:', {
                piece_id: piece.piece_id,
                piece_name: piece.piece_name || fullPieceData.piece_name,
                player_id: piece.player_id,
                image_location: imageLocation,
                computed_image_url: imageUrl
              });
            }
            
            return {
              ...piece,
              // Image fields for frontend
              image_location: imageLocation,
              image: imageUrl,
              image_url: imageUrl,
              piece_name: piece.piece_name || fullPieceData.piece_name,
              // Movement data
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
              // Capture data
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
              can_castle: fullPieceData.can_castle,
              promotion_options: fullPieceData.promotion_options,
              has_checkmate_rule: fullPieceData.has_checkmate_rule,
              special_scenario_moves: fullPieceData.special_scenario_moves,
              special_scenario_captures: fullPieceData.special_scenario_captures,
              // Ranged attack data
              can_capture_enemy_via_range: fullPieceData.can_capture_enemy_via_range,
              up_attack_range: fullPieceData.up_attack_range,
              down_attack_range: fullPieceData.down_attack_range,
              left_attack_range: fullPieceData.left_attack_range,
              right_attack_range: fullPieceData.right_attack_range,
              up_left_attack_range: fullPieceData.up_left_attack_range,
              up_right_attack_range: fullPieceData.up_right_attack_range,
              down_left_attack_range: fullPieceData.down_left_attack_range,
              down_right_attack_range: fullPieceData.down_right_attack_range,
              up_attack_range_exact: fullPieceData.up_attack_range_exact,
              down_attack_range_exact: fullPieceData.down_attack_range_exact,
              left_attack_range_exact: fullPieceData.left_attack_range_exact,
              right_attack_range_exact: fullPieceData.right_attack_range_exact,
              up_left_attack_range_exact: fullPieceData.up_left_attack_range_exact,
              up_right_attack_range_exact: fullPieceData.up_right_attack_range_exact,
              down_left_attack_range_exact: fullPieceData.down_left_attack_range_exact,
              down_right_attack_range_exact: fullPieceData.down_right_attack_range_exact,
              ratio_one_attack_range: fullPieceData.ratio_one_attack_range,
              ratio_two_attack_range: fullPieceData.ratio_two_attack_range,
              step_by_step_attack_range: fullPieceData.step_by_step_attack_value,
              max_piece_captures_per_ranged_attack: fullPieceData.max_piece_captures_per_ranged_attack,
              can_fire_over_allies: fullPieceData.can_fire_over_allies,
              can_fire_over_enemies: fullPieceData.can_fire_over_enemies,
              // En passant
              can_en_passant: fullPieceData.can_en_passant
            };
          }
          return piece;
        });
        
        const piecesData = JSON.stringify(piecesArray);
        
        const isChallenge = challengedUserId ? 1 : 0;
        
        const [result] = await db_pool.query(
          `INSERT INTO games (created_at, turn_length, increment, player_count, player_turn, pieces, other_data, game_type_id, status, host_id, allow_spectators, show_piece_helpers, is_challenge, challenged_user_id)
           VALUES (?, ?, ?, 2, 1, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?)`,
          [currentTime, timeControl, increment || 0, piecesData, JSON.stringify({ moves: [], rated, allowPremoves, startingMode }), gameTypeId, hostId, allowSpectators ? 1 : 0, showPieceHelpers ? 1 : 0, isChallenge, challengedUserId]
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
          movesWithoutCapture: 0, // Track for draw by move limit
          positionHistory: {}, // Track position occurrences for N-fold repetition
          controlSquareTracking: {}, // Track control square occupancy: { "row,col": { playerId, turnCount } }
          startTime: null,
          playerTimes: {},
          allowSpectators,
          showPieceHelpers,
          rated,
          allowPremoves,
          startingMode,
          premove: null,
          isChallenge: !!challengedUserId,
          challengedUserId
        };

        activeGames.set(gameId.toString(), gameState);

        // Join the game room
        socket.join(`game-${gameId}`);

        // Emit game created event
        socket.emit("gameCreated", { gameId, gameState });

        // For challenge games, notify only the challenged user
        // For regular games, broadcast to all users
        if (challengedUserId) {
          // Find the challenged user's socket and send them a challenge notification
          const challengedSocketId = userSockets.get(challengedUserId);
          if (challengedSocketId) {
            io.to(challengedSocketId).emit("friendChallenge", {
              gameId,
              challengerUsername: hostUsername,
              challengerId: hostId,
              gameTypeName: gameType.game_name,
              timeControl,
              increment: increment || 0
            });
          }
          console.log(`Challenge game ${gameId} created by ${hostUsername} for user ${challengedUserId}`);
        } else {
          // Broadcast to all users that a new game is available
          io.emit("newOpenGame", {
            gameId,
            hostUsername,
            gameTypeName: gameType.game_name,
            timeControl,
            increment: increment || 0
          });
        }

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

          // Check if this is a challenge game and if user is allowed to join
          if (game.is_challenge && game.challenged_user_id !== userId) {
            return socket.emit("error", { message: "This is a private challenge. Only the challenged player can join." });
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

          // Parse and enrich pieces with movement and capture data
          let pieces = JSON.parse(game.pieces || "[]");
          const pieceIdsToLoad = new Set();
          pieces.forEach(p => {
            if (p.piece_id && !p.directional_movement_style) {
              pieceIdsToLoad.add(p.piece_id);
            }
          });
          
          if (pieceIdsToLoad.size > 0) {
            const [pieceRows] = await db_pool.query(
              `SELECT * FROM pieces WHERE id IN (?)`,
              [Array.from(pieceIdsToLoad)]
            );
            const pieceDataMap = {};
            pieceRows.forEach(p => { pieceDataMap[p.id] = p; });
            
            // Debug: Check what's in the piece data
            if (pieceRows.length > 0) {
              console.log('JOIN GAME - First piece from DB:', {
                id: pieceRows[0].id,
                name: pieceRows[0].name,
                special_scenario_moves: pieceRows[0].special_scenario_moves,
                special_scenario_captures: pieceRows[0].special_scenario_captures
              });
            }
            
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
                  // Capture data
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
                  promotion_options: fullPieceData.promotion_options,
                  has_checkmate_rule: fullPieceData.has_checkmate_rule,
                  special_scenario_moves: fullPieceData.special_scenario_moves,
                  special_scenario_captures: fullPieceData.special_scenario_captures,
                  // Ranged attack data
                  can_capture_enemy_via_range: fullPieceData.can_capture_enemy_via_range,
                  up_attack_range: fullPieceData.up_attack_range,
                  down_attack_range: fullPieceData.down_attack_range,
                  left_attack_range: fullPieceData.left_attack_range,
                  right_attack_range: fullPieceData.right_attack_range,
                  up_left_attack_range: fullPieceData.up_left_attack_range,
                  up_right_attack_range: fullPieceData.up_right_attack_range,
                  down_left_attack_range: fullPieceData.down_left_attack_range,
                  down_right_attack_range: fullPieceData.down_right_attack_range,
                  up_attack_range_exact: fullPieceData.up_attack_range_exact,
                  down_attack_range_exact: fullPieceData.down_attack_range_exact,
                  left_attack_range_exact: fullPieceData.left_attack_range_exact,
                  right_attack_range_exact: fullPieceData.right_attack_range_exact,
                  up_left_attack_range_exact: fullPieceData.up_left_attack_range_exact,
                  up_right_attack_range_exact: fullPieceData.up_right_attack_range_exact,
                  down_left_attack_range_exact: fullPieceData.down_left_attack_range_exact,
                  down_right_attack_range_exact: fullPieceData.down_right_attack_range_exact,
                  ratio_one_attack_range: fullPieceData.ratio_one_attack_range,
                  ratio_two_attack_range: fullPieceData.ratio_two_attack_range,
                  step_by_step_attack_range: fullPieceData.step_by_step_attack_value,
                  max_piece_captures_per_ranged_attack: fullPieceData.max_piece_captures_per_ranged_attack,
                  can_fire_over_allies: fullPieceData.can_fire_over_allies,
                  can_fire_over_enemies: fullPieceData.can_fire_over_enemies,
                  // En passant
                  can_en_passant: fullPieceData.can_en_passant
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
            controlSquareTracking: {}, // Track control square occupancy
            startTime: null,
            playerTimes: {},
            allowSpectators: game.allow_spectators !== 0,
            showPieceHelpers: game.show_piece_helpers === 1,
            allowPremoves: game.allow_premoves !== 0,
            rated: game.is_rated !== 0,
            startingMode: (() => {
              try {
                const otherData = JSON.parse(game.other_data || '{}');
                return otherData.startingMode || 'none';
              } catch { return 'none'; }
            })(),
            enPassantTarget: (() => {
              try {
                const otherData = JSON.parse(game.other_data || '{}');
                return otherData.enPassantTarget || null;
              } catch { return null; }
            })(),
            premove: null,
            isChallenge: !!game.is_challenge,
            challengedUserId: game.challenged_user_id
          };

          activeGames.set(gameIdStr, gameState);
        }

        // Check if this is a challenge game and if user is allowed to join
        if (gameState.isChallenge && gameState.challengedUserId !== userId) {
          return socket.emit("error", { message: "This is a private challenge. Only the challenged player can join." });
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

        // Check if randomized starting positions is enabled (use startingMode from game creation)
        const mode = gameState.startingMode || 'none';
        
        if (mode && mode !== 'none') {
          console.log(`Randomizing starting positions for game ${gameId} with mode: ${mode}`);
          gameState.pieces = randomizePiecePositions(gameState.pieces, gameState.players, mode, gameState.gameType);
          
          // Update the database with randomized pieces
          await db_pool.query(
            "UPDATE games SET pieces = ? WHERE id = ?",
            [JSON.stringify(gameState.pieces), gameId]
          );
        }

        // Update game status to ready
        gameState.status = 'ready';
        await db_pool.query(
          "UPDATE games SET status = 'ready' WHERE id = ?",
          [gameId]
        );
        
        // Initialize castling partners so they're available during the 'ready' phase
        initializeCastlingPartners(gameState);

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
          
          // Initialize position history with starting position (for N-fold repetition)
          if (gameState.gameType?.repetition_draw_count) {
            const initialPositionHash = getPositionHash(gameState.pieces, 1); // Player 1 starts
            gameState.positionHistory = { [initialPositionHash]: 1 };
          }
          
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
          timestamp: Date.now(),
          ...(moveResult.isRangedAttack ? { isRangedAttack: true } : {})
        };
        gameState.moveHistory.push(moveRecord);

        // Track moves without capture/promotable piece moves for draw conditions
        // Reset if capture OR if a promotable piece moved (like pawn in chess 50-move rule)
        if (moveResult.captured || moveResult.movingPiece?.can_promote) {
          gameState.movesWithoutCapture = 0; // Reset on capture or pawn/promotable piece move
        } else {
          gameState.movesWithoutCapture = (gameState.movesWithoutCapture || 0) + 1;
        }

        // Apply increment to current player's time
        if (gameState.increment && gameState.playerTimes[userId]) {
          gameState.playerTimes[userId] += gameState.increment;
        }

        // Check if promotion is required (only if there are valid options)
        if (moveResult.promotionEligible && moveResult.promotionEligible.options && moveResult.promotionEligible.options.length > 0) {
          // Store pending promotion
          gameState.pendingPromotion = {
            pieceId: moveResult.promotionEligible.pieceId,
            options: moveResult.promotionEligible.options,
            userId: userId,
            capturedPiece: moveResult.captured
          };

          // Update database with current state (before turn switch)
          await db_pool.query(
            "UPDATE games SET pieces = ?, other_data = ? WHERE id = ?",
            [JSON.stringify(gameState.pieces), 
             JSON.stringify({ 
               moves: gameState.moveHistory, 
               pendingPromotion: gameState.pendingPromotion,
               rated: gameState.rated,
               allowPremoves: gameState.allowPremoves
             }), gameId]
          );

          // Find the promoted piece for additional data
          const promotingPiece = gameState.pieces.find(p => p.id === moveResult.promotionEligible.pieceId);

          // Emit promotion required event - this will pause the game until promotion is complete
          socket.emit("promotionRequired", {
            gameId,
            pieceId: moveResult.promotionEligible.pieceId,
            pieceName: promotingPiece?.piece_name || 'Unknown',
            options: moveResult.promotionEligible.options,
            move: moveRecord,
            gameState: {
              pieces: gameState.pieces,
              currentTurn: gameState.currentTurn,
              playerTimes: gameState.playerTimes,
              moveHistory: gameState.moveHistory
            }
          });

          // Also broadcast the move to other players (but not the promotion modal)
          socket.to(`game-${gameId}`).emit("moveMade", {
            gameId,
            move: moveRecord,
            gameState: {
              pieces: gameState.pieces,
              currentTurn: gameState.currentTurn,
              playerTimes: gameState.playerTimes,
              moveHistory: gameState.moveHistory,
              pendingPromotion: true,
              controlSquareTracking: gameState.controlSquareTracking
            }
          });

          console.log(`Promotion required in game ${gameId} for piece ${moveResult.promotionEligible.pieceId}`);
          return; // Wait for promotion choice before continuing
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
              isPremove: true,
              ...(premove.move.isRangedAttack ? { isRangedAttack: true } : {})
            };
            gameState.moveHistory.push(premoveRecord);

            // Track moves without capture/promotable piece moves for draw conditions
            // Reset if capture OR if a promotable piece moved
            const premovePiece = gameState.pieces.find(p => p.id === premove.move.pieceId);
            if (premoveResult.captured || premovePiece?.can_promote) {
              gameState.movesWithoutCapture = 0; // Reset on capture or pawn/promotable piece move
            } else {
              gameState.movesWithoutCapture = (gameState.movesWithoutCapture || 0) + 1;
            }
            
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
            
            // Update control square tracking after premove
            const premoveControlWinResult = updateControlSquareTracking(gameState);
            if (premoveControlWinResult?.gameOver) {
              // Stop the timer
              stopGameTimer(gameId);
              
              gameState.status = 'completed';
              gameState.winner = premoveControlWinResult.winner;
              gameState.winReason = premoveControlWinResult.reason;

              // Find loser
              const loser = gameState.players.find(p => p.id !== premoveControlWinResult.winner);

              // Update ELO ratings only if game is rated
              let eloChanges = null;
              if (gameState.rated !== false && premoveControlWinResult.winner && loser) {
                eloChanges = await updateEloRatings(premoveControlWinResult.winner, loser.id);
              }

              const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
              await db_pool.query(
                `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
                 pieces = ?, other_data = ? WHERE id = ?`,
                [endTime, premoveControlWinResult.winner, JSON.stringify(gameState.pieces), 
                 JSON.stringify({ 
                   moves: gameState.moveHistory, 
                   winner: premoveControlWinResult.winner, 
                   reason: premoveControlWinResult.reason, 
                   eloChanges,
                   rated: gameState.rated,
                   allowPremoves: gameState.allowPremoves,
                   controlSquareTracking: gameState.controlSquareTracking
                 }),
                 gameId]
              );

              io.to(`game-${gameId}`).emit("gameOver", {
                gameId,
                winner: premoveControlWinResult.winner,
                reason: premoveControlWinResult.reason,
                finalState: gameState,
                eloChanges
              });
              
              return; // Exit early since game is over
            }

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

            // Check for stalemate after premove (only if mate_condition is enabled)
            if (!premoveCheckResult.inCheck && gameState.gameType?.mate_condition) {
              const legalMoves = getAllLegalMovesForPlayer(gameState, gameState.currentTurn);
              
              if (legalMoves.length === 0) {
                // Stalemate detected after premove
                console.log('STALEMATE DETECTED after premove! Ending game in a draw...');
                stopGameTimer(gameId);
                
                gameState.status = 'completed';
                gameState.winner = null;
                gameState.winReason = 'stalemate';

                // Update ELO ratings for draw (only if game is rated)
                let eloChanges = null;
                const player1 = gameState.players[0];
                const player2 = gameState.players[1];
                if (gameState.rated !== false && player1?.id && player2?.id) {
                  // For draws, pass higher rated player as 'winner' and lower as 'loser' with isDraw=true
                  // This ensures the higher player loses a bit and lower player gains a bit
                  const p1Elo = player1.elo || 1000;
                  const p2Elo = player2.elo || 1000;
                  const higherPlayer = p1Elo >= p2Elo ? player1.id : player2.id;
                  const lowerPlayer = p1Elo >= p2Elo ? player2.id : player1.id;
                  eloChanges = await updateEloRatings(higherPlayer, lowerPlayer, true);
                  console.log('ELO updated for stalemate (draw):', eloChanges);
                }

                const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
                await db_pool.query(
                  `UPDATE games SET status = 'completed', end_time = ?, winner_id = NULL,
                   pieces = ?, other_data = ? WHERE id = ?`,
                  [endTime, JSON.stringify(gameState.pieces), 
                   JSON.stringify({ 
                     moves: gameState.moveHistory, 
                     reason: 'stalemate',
                     eloChanges,
                     rated: gameState.rated,
                     allowPremoves: gameState.allowPremoves
                   }),
                   gameId]
                );

                io.to(`game-${gameId}`).emit("gameOver", {
                  gameId,
                  winner: null,
                  reason: 'stalemate',
                  finalState: gameState,
                  eloChanges
                });
                
                const stalematedPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
                console.log(`STALEMATE! Player ${stalematedPlayer?.username} has no legal moves in game ${gameId} after premove`);
                return; // Exit early since game is over
              }
            }

            // Track position for N-fold repetition detection after premove
            const premovePositionHash = getPositionHash(gameState.pieces, gameState.currentTurn);
            if (!gameState.positionHistory) {
              gameState.positionHistory = {};
            }
            gameState.positionHistory[premovePositionHash] = (gameState.positionHistory[premovePositionHash] || 0) + 1;

            // Check for draw by move limit after premove
            // Multiply limit by 2 since each 'move' in chess is one move per player
            const effectiveMoveLimit = gameState.gameType?.draw_move_limit ? gameState.gameType.draw_move_limit * 2 : null;
            if (effectiveMoveLimit && gameState.movesWithoutCapture >= effectiveMoveLimit) {
              console.log(`DRAW BY MOVE LIMIT after premove! ${gameState.movesWithoutCapture} half-moves without capture (limit: ${effectiveMoveLimit}) in game ${gameId}`);
              stopGameTimer(gameId);
              
              gameState.status = 'completed';
              gameState.winner = null;
              gameState.winReason = 'draw_move_limit';

              // Update ELO ratings for draw (only if game is rated)
              let eloChanges = null;
              const player1 = gameState.players[0];
              const player2 = gameState.players[1];
              if (gameState.rated !== false && player1?.id && player2?.id) {
                const p1Elo = player1.elo || 1000;
                const p2Elo = player2.elo || 1000;
                const higherPlayer = p1Elo >= p2Elo ? player1.id : player2.id;
                const lowerPlayer = p1Elo >= p2Elo ? player2.id : player1.id;
                eloChanges = await updateEloRatings(higherPlayer, lowerPlayer, true);
                console.log('ELO updated for draw by move limit after premove:', eloChanges);
              }

              const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
              await db_pool.query(
                `UPDATE games SET status = 'completed', end_time = ?, winner_id = NULL,
                 pieces = ?, other_data = ? WHERE id = ?`,
                [endTime, JSON.stringify(gameState.pieces), 
                 JSON.stringify({ 
                   moves: gameState.moveHistory, 
                   reason: 'draw_move_limit',
                   movesWithoutCapture: gameState.movesWithoutCapture,
                   eloChanges,
                   rated: gameState.rated,
                   allowPremoves: gameState.allowPremoves
                 }),
                 gameId]
              );

              io.to(`game-${gameId}`).emit("gameOver", {
                gameId,
                winner: null,
                reason: 'draw_move_limit',
                finalState: gameState,
                eloChanges
              });
              
              console.log(`DRAW BY MOVE LIMIT! Game ${gameId} drawn after premove`);
              return; // Exit early since game is over
            }

            // Check for draw by N-fold repetition after premove
            const premoveRepetitionLimit = gameState.gameType?.repetition_draw_count;
            const premovePositionCount = gameState.positionHistory[premovePositionHash] || 0;
            if (premoveRepetitionLimit && premovePositionCount >= premoveRepetitionLimit) {
              console.log(`DRAW BY ${premoveRepetitionLimit}-FOLD REPETITION after premove! Position occurred ${premovePositionCount} times in game ${gameId}`);
              stopGameTimer(gameId);
              
              gameState.status = 'completed';
              gameState.winner = null;
              gameState.winReason = 'repetition';

              // Update ELO ratings for draw (only if game is rated)
              let eloChanges = null;
              const player1 = gameState.players[0];
              const player2 = gameState.players[1];
              if (gameState.rated !== false && player1?.id && player2?.id) {
                const p1Elo = player1.elo || 1000;
                const p2Elo = player2.elo || 1000;
                const higherPlayer = p1Elo >= p2Elo ? player1.id : player2.id;
                const lowerPlayer = p1Elo >= p2Elo ? player2.id : player1.id;
                eloChanges = await updateEloRatings(higherPlayer, lowerPlayer, true);
                console.log('ELO updated for draw by repetition after premove:', eloChanges);
              }

              const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
              await db_pool.query(
                `UPDATE games SET status = 'completed', end_time = ?, winner_id = NULL,
                 pieces = ?, other_data = ? WHERE id = ?`,
                [endTime, JSON.stringify(gameState.pieces), 
                 JSON.stringify({ 
                   moves: gameState.moveHistory, 
                   reason: 'repetition',
                   repetitionCount: premovePositionCount,
                   positionHistory: gameState.positionHistory,
                   eloChanges,
                   rated: gameState.rated,
                   allowPremoves: gameState.allowPremoves
                 }),
                 gameId]
              );

              io.to(`game-${gameId}`).emit("gameOver", {
                gameId,
                winner: null,
                reason: 'repetition',
                finalState: gameState,
                eloChanges
              });
              
              console.log(`DRAW BY REPETITION! Game ${gameId} drawn after premove`);
              return; // Exit early since game is over
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

        // Update control square tracking after the move
        const controlWinResult = updateControlSquareTracking(gameState);
        if (controlWinResult?.gameOver) {
          // Stop the timer
          stopGameTimer(gameId);
          
          gameState.status = 'completed';
          gameState.winner = controlWinResult.winner;
          gameState.winReason = controlWinResult.reason;

          // Find loser
          const loser = gameState.players.find(p => p.id !== controlWinResult.winner);

          // Update ELO ratings only if game is rated
          let eloChanges = null;
          if (gameState.rated !== false && controlWinResult.winner && loser) {
            eloChanges = await updateEloRatings(controlWinResult.winner, loser.id);
          }

          const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
          await db_pool.query(
            `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
             pieces = ?, other_data = ? WHERE id = ?`,
            [endTime, controlWinResult.winner, JSON.stringify(gameState.pieces), 
             JSON.stringify({ 
               moves: gameState.moveHistory, 
               winner: controlWinResult.winner, 
               reason: controlWinResult.reason, 
               eloChanges,
               rated: gameState.rated,
               allowPremoves: gameState.allowPremoves,
               controlSquareTracking: gameState.controlSquareTracking
             }),
             gameId]
          );

          io.to(`game-${gameId}`).emit("gameOver", {
            gameId,
            winner: controlWinResult.winner,
            reason: controlWinResult.reason,
            finalState: gameState,
            eloChanges
          });
          return; // Exit early since game is over
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

          // Check for stalemate (only if mate_condition is enabled)
          if (!checkResult.inCheck && gameState.gameType?.mate_condition) {
            const legalMoves = getAllLegalMovesForPlayer(gameState, gameState.currentTurn);
            
            if (legalMoves.length === 0) {
              // Stalemate detected - no legal moves but not in check
              console.log('STALEMATE DETECTED! Ending game in a draw...');
              stopGameTimer(gameId);
              
              gameState.status = 'completed';
              gameState.winner = null; // Draw, no winner
              gameState.winReason = 'stalemate';

              // Update ELO ratings for draw (only if game is rated)
              let eloChanges = null;
              const player1 = gameState.players[0];
              const player2 = gameState.players[1];
              if (gameState.rated !== false && player1?.id && player2?.id) {
                // For draws, pass higher rated player as 'winner' and lower as 'loser' with isDraw=true
                // This ensures the higher player loses a bit and lower player gains a bit
                const p1Elo = player1.elo || 1000;
                const p2Elo = player2.elo || 1000;
                const higherPlayer = p1Elo >= p2Elo ? player1.id : player2.id;
                const lowerPlayer = p1Elo >= p2Elo ? player2.id : player1.id;
                eloChanges = await updateEloRatings(higherPlayer, lowerPlayer, true);
                console.log('ELO updated for stalemate (draw):', eloChanges);
              }

              const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
              try {
                await db_pool.query(
                  `UPDATE games SET status = 'completed', end_time = ?, winner_id = NULL,
                   pieces = ?, other_data = ? WHERE id = ?`,
                  [endTime, JSON.stringify(gameState.pieces), 
                   JSON.stringify({ 
                     moves: gameState.moveHistory, 
                     reason: 'stalemate',
                     eloChanges,
                     rated: gameState.rated,
                     allowPremoves: gameState.allowPremoves
                   }),
                   gameId]
                );
                console.log('Database updated for stalemate');
              } catch (dbError) {
                console.error('Failed to update database:', dbError);
              }

              io.to(`game-${gameId}`).emit("gameOver", {
                gameId,
                winner: null,
                reason: 'stalemate',
                finalState: gameState,
                eloChanges
              });
              console.log('gameOver event emitted for stalemate in game-' + gameId);
              
              const stalematedPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
              console.log(`STALEMATE! Player ${stalematedPlayer?.username} has no legal moves in game ${gameId}`);
              return; // Exit early since game is over
            }
          }

          // Track position for N-fold repetition detection
          const positionHash = getPositionHash(gameState.pieces, gameState.currentTurn);
          if (!gameState.positionHistory) {
            gameState.positionHistory = {};
          }
          gameState.positionHistory[positionHash] = (gameState.positionHistory[positionHash] || 0) + 1;

          // Check for draw by move limit (X moves without captures)
          // Multiply limit by 2 since each 'move' in chess is one move per player
          const effectiveMoveLimit = gameState.gameType?.draw_move_limit ? gameState.gameType.draw_move_limit * 2 : null;
          if (effectiveMoveLimit && gameState.movesWithoutCapture >= effectiveMoveLimit) {
            console.log(`DRAW BY MOVE LIMIT! ${gameState.movesWithoutCapture} half-moves without capture (limit: ${effectiveMoveLimit}) in game ${gameId}`);
            stopGameTimer(gameId);
            
            gameState.status = 'completed';
            gameState.winner = null;
            gameState.winReason = 'draw_move_limit';

            // Update ELO ratings for draw (only if game is rated)
            let eloChanges = null;
            const player1 = gameState.players[0];
            const player2 = gameState.players[1];
            if (gameState.rated !== false && player1?.id && player2?.id) {
              const p1Elo = player1.elo || 1000;
              const p2Elo = player2.elo || 1000;
              const higherPlayer = p1Elo >= p2Elo ? player1.id : player2.id;
              const lowerPlayer = p1Elo >= p2Elo ? player2.id : player1.id;
              eloChanges = await updateEloRatings(higherPlayer, lowerPlayer, true);
              console.log('ELO updated for draw by move limit:', eloChanges);
            }

            const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
            try {
              await db_pool.query(
                `UPDATE games SET status = 'completed', end_time = ?, winner_id = NULL,
                 pieces = ?, other_data = ? WHERE id = ?`,
                [endTime, JSON.stringify(gameState.pieces), 
                 JSON.stringify({ 
                   moves: gameState.moveHistory, 
                   reason: 'draw_move_limit',
                   movesWithoutCapture: gameState.movesWithoutCapture,
                   eloChanges,
                   rated: gameState.rated,
                   allowPremoves: gameState.allowPremoves
                 }),
                 gameId]
              );
              console.log('Database updated for draw by move limit');
            } catch (dbError) {
              console.error('Failed to update database:', dbError);
            }

            io.to(`game-${gameId}`).emit("gameOver", {
              gameId,
              winner: null,
              reason: 'draw_move_limit',
              finalState: gameState,
              eloChanges
            });
            console.log('gameOver event emitted for draw by move limit in game-' + gameId);
            return; // Exit early since game is over
          }

          // Check for draw by N-fold repetition
          const repetitionLimit = gameState.gameType?.repetition_draw_count;
          const currentPositionCount = gameState.positionHistory[positionHash] || 0;
          if (repetitionLimit && currentPositionCount >= repetitionLimit) {
            console.log(`DRAW BY ${repetitionLimit}-FOLD REPETITION! Position occurred ${currentPositionCount} times in game ${gameId}`);
            stopGameTimer(gameId);
            
            gameState.status = 'completed';
            gameState.winner = null;
            gameState.winReason = 'repetition';

            // Update ELO ratings for draw (only if game is rated)
            let eloChanges = null;
            const player1 = gameState.players[0];
            const player2 = gameState.players[1];
            if (gameState.rated !== false && player1?.id && player2?.id) {
              const p1Elo = player1.elo || 1000;
              const p2Elo = player2.elo || 1000;
              const higherPlayer = p1Elo >= p2Elo ? player1.id : player2.id;
              const lowerPlayer = p1Elo >= p2Elo ? player2.id : player1.id;
              eloChanges = await updateEloRatings(higherPlayer, lowerPlayer, true);
              console.log('ELO updated for draw by repetition:', eloChanges);
            }

            const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
            try {
              await db_pool.query(
                `UPDATE games SET status = 'completed', end_time = ?, winner_id = NULL,
                 pieces = ?, other_data = ? WHERE id = ?`,
                [endTime, JSON.stringify(gameState.pieces), 
                 JSON.stringify({ 
                   moves: gameState.moveHistory, 
                   reason: 'repetition',
                   repetitionCount: currentPositionCount,
                   positionHistory: gameState.positionHistory,
                   eloChanges,
                   rated: gameState.rated,
                   allowPremoves: gameState.allowPremoves
                 }),
                 gameId]
              );
              console.log('Database updated for draw by repetition');
            } catch (dbError) {
              console.error('Failed to update database:', dbError);
            }

            io.to(`game-${gameId}`).emit("gameOver", {
              gameId,
              winner: null,
              reason: 'repetition',
              finalState: gameState,
              eloChanges
            });
            console.log('gameOver event emitted for draw by repetition in game-' + gameId);
            return; // Exit early since game is over
          }

          // Update game state in database
          await db_pool.query(
            "UPDATE games SET player_turn = ?, pieces = ?, other_data = ? WHERE id = ?",
            [gameState.currentTurn, JSON.stringify(gameState.pieces), 
             JSON.stringify({ 
               moves: gameState.moveHistory, 
               inCheck: checkResult.inCheck,
               movesWithoutCapture: gameState.movesWithoutCapture,
               positionHistory: gameState.positionHistory,
               controlSquareTracking: gameState.controlSquareTracking,
               rated: gameState.rated,
               allowPremoves: gameState.allowPremoves,
               enPassantTarget: gameState.enPassantTarget
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
              rated: gameState.rated,
              enPassantTarget: gameState.enPassantTarget,
              controlSquareTracking: gameState.controlSquareTracking
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

    // Handle piece promotion
    socket.on("promotePiece", async (data) => {
      try {
        const { gameId, userId, pieceId, promoteToPieceId } = data;
        const gameIdStr = gameId.toString();
        const gameState = activeGames.get(gameIdStr);

        if (!gameState) {
          return socket.emit("error", { message: "Game not found" });
        }

        // Check if there's a pending promotion for this user
        if (!gameState.pendingPromotion || gameState.pendingPromotion.userId !== userId) {
          return socket.emit("error", { message: "No pending promotion for you" });
        }

        const pendingPromotion = gameState.pendingPromotion;
        if (pendingPromotion.pieceId !== pieceId) {
          return socket.emit("error", { message: "Wrong piece for promotion" });
        }

        // Find the piece to promote
        const pieceIndex = gameState.pieces.findIndex(p => p.id === pieceId);
        if (pieceIndex === -1) {
          gameState.pendingPromotion = null;
          return socket.emit("error", { message: "Piece not found" });
        }

        const piece = gameState.pieces[pieceIndex];

        // Find the promotion target piece data
        const targetPieceData = pendingPromotion.options.find(p => p.piece_id === promoteToPieceId);
        if (!targetPieceData) {
          return socket.emit("error", { message: "Invalid promotion choice" });
        }

        // Load full piece data for the new piece type
        const [[fullPieceData]] = await db_pool.query(
          `SELECT * FROM pieces WHERE id = ?`,
          [promoteToPieceId]
        );

        if (!fullPieceData) {
          return socket.emit("error", { message: "Promotion piece type not found" });
        }

        // Get the correct image for this player
        let imageUrl = null;
        if (fullPieceData.image_location) {
          try {
            const images = JSON.parse(fullPieceData.image_location);
            if (Array.isArray(images) && images.length > 0) {
              const playerIndex = (piece.player_id || piece.team || 1) - 1;
              imageUrl = images[playerIndex] || images[0];
            }
          } catch (e) {
            console.error('Error parsing image_location for promotion:', e);
          }
        }

        // Create the promoted piece, keeping position and ownership
        const promotedPiece = {
          ...piece,
          // New piece data
          piece_id: fullPieceData.id,
          piece_name: fullPieceData.piece_name,
          image_location: fullPieceData.image_location,
          image: imageUrl,
          image_url: imageUrl,
          // Movement data
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
          // Capture data
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
          // Special attributes
          piece_value: fullPieceData.piece_value,
          is_royal: fullPieceData.is_royal,
          can_promote: fullPieceData.can_promote,
          can_castle: fullPieceData.can_castle,
          has_checkmate_rule: fullPieceData.has_checkmate_rule,
          has_check_rule: fullPieceData.has_check_rule,
          special_scenario_moves: fullPieceData.special_scenario_moves,
          special_scenario_captures: fullPieceData.special_scenario_captures,
          // Ranged attack data
          can_capture_enemy_via_range: fullPieceData.can_capture_enemy_via_range,
          up_attack_range: fullPieceData.up_attack_range,
          down_attack_range: fullPieceData.down_attack_range,
          left_attack_range: fullPieceData.left_attack_range,
          right_attack_range: fullPieceData.right_attack_range,
          up_left_attack_range: fullPieceData.up_left_attack_range,
          up_right_attack_range: fullPieceData.up_right_attack_range,
          down_left_attack_range: fullPieceData.down_left_attack_range,
          down_right_attack_range: fullPieceData.down_right_attack_range,
          up_attack_range_exact: fullPieceData.up_attack_range_exact,
          down_attack_range_exact: fullPieceData.down_attack_range_exact,
          left_attack_range_exact: fullPieceData.left_attack_range_exact,
          right_attack_range_exact: fullPieceData.right_attack_range_exact,
          up_left_attack_range_exact: fullPieceData.up_left_attack_range_exact,
          up_right_attack_range_exact: fullPieceData.up_right_attack_range_exact,
          down_left_attack_range_exact: fullPieceData.down_left_attack_range_exact,
          down_right_attack_range_exact: fullPieceData.down_right_attack_range_exact,
          ratio_one_attack_range: fullPieceData.ratio_one_attack_range,
          ratio_two_attack_range: fullPieceData.ratio_two_attack_range,
          step_by_step_attack_range: fullPieceData.step_by_step_attack_value,
          max_piece_captures_per_ranged_attack: fullPieceData.max_piece_captures_per_ranged_attack,
          can_fire_over_allies: fullPieceData.can_fire_over_allies,
          can_fire_over_enemies: fullPieceData.can_fire_over_enemies,
          // En passant
          can_en_passant: fullPieceData.can_en_passant,
          // Reset move tracking for the new piece type
          moveCount: 0,
          hasMoved: false
        };

        // Update the piece in the game state
        gameState.pieces[pieceIndex] = promotedPiece;

        // Clear pending promotion
        gameState.pendingPromotion = null;

        // Switch turns after promotion
        gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;

        // Update database
        await db_pool.query(
          "UPDATE games SET pieces = ?, player_turn = ? WHERE id = ?",
          [JSON.stringify(gameState.pieces), gameState.currentTurn, gameId]
        );

        // Broadcast the promotion to all players
        io.to(`game-${gameId}`).emit("piecePromoted", {
          gameId,
          pieceId: piece.id,
          newPieceId: promotedPiece.piece_id,
          newPieceName: promotedPiece.piece_name,
          promotedPiece: promotedPiece,
          gameState: {
            pieces: gameState.pieces,
            currentTurn: gameState.currentTurn
          }
        });

        console.log(`Piece ${pieceId} promoted to ${promotedPiece.piece_name} in game ${gameId}`);

        // Now continue with the normal post-move flow that was paused
        // Update control square tracking after promotion
        const promotionControlWinResult = updateControlSquareTracking(gameState);
        if (promotionControlWinResult?.gameOver) {
          stopGameTimer(gameId);
          gameState.status = 'completed';
          gameState.winner = promotionControlWinResult.winner;
          gameState.winReason = promotionControlWinResult.reason;

          const loser = gameState.players.find(p => p.id !== promotionControlWinResult.winner);
          let eloChanges = null;
          if (gameState.rated !== false && promotionControlWinResult.winner && loser) {
            eloChanges = await updateEloRatings(promotionControlWinResult.winner, loser.id);
          }

          const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
          await db_pool.query(
            `UPDATE games SET status = 'completed', end_time = ?, winner_id = ?,
             pieces = ?, other_data = ? WHERE id = ?`,
            [endTime, promotionControlWinResult.winner, JSON.stringify(gameState.pieces), 
             JSON.stringify({ 
               moves: gameState.moveHistory, 
               winner: promotionControlWinResult.winner, 
               reason: promotionControlWinResult.reason, 
               eloChanges,
               rated: gameState.rated,
               allowPremoves: gameState.allowPremoves,
               controlSquareTracking: gameState.controlSquareTracking
             }),
             gameId]
          );

          io.to(`game-${gameId}`).emit("gameOver", {
            gameId,
            winner: promotionControlWinResult.winner,
            reason: promotionControlWinResult.reason,
            finalState: gameState,
            eloChanges
          });
          return;
        }

        // Check for win conditions after promotion
        const winResult = checkWinCondition(gameState, pendingPromotion.capturedPiece);
        if (winResult.gameOver) {
          stopGameTimer(gameId);
          gameState.status = 'completed';
          gameState.winner = winResult.winner;
          gameState.winReason = winResult.reason;

          const loser = gameState.players.find(p => p.id !== winResult.winner);
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
          return;
        }

        // Check for check/checkmate after promotion
        const checkResult = checkForCheck(gameState, gameState.currentTurn);
        gameState.inCheck = checkResult.inCheck;
        gameState.checkedPieces = checkResult.checkedPieces;

        if (checkResult.inCheck && gameState.gameType?.mate_condition) {
          const isInCheckmate = isCheckmate(gameState, gameState.currentTurn);
          
          if (isInCheckmate) {
            stopGameTimer(gameId);
            gameState.status = 'completed';
            const checkmatedPlayer = gameState.players.find(p => p.position === gameState.currentTurn);
            const winner = gameState.players.find(p => p.position !== gameState.currentTurn);
            gameState.winner = winner?.id;
            gameState.winReason = 'checkmate';

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
            return;
          }
        }

        // Broadcast check status if in check
        if (checkResult.inCheck) {
          io.to(`game-${gameId}`).emit("check", {
            gameId,
            playerInCheck: gameState.currentTurn,
            checkedPieces: checkResult.checkedPieces,
            gameState: {
              inCheck: true,
              checkedPieces: checkResult.checkedPieces
            }
          });
        }

      } catch (error) {
        console.error("Error processing promotion:", error);
        socket.emit("error", { message: "Failed to promote piece" });
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
            
            // Fall back to game type pieces from junction table if still empty
            if (pieces.length === 0 && gameType?.id) {
              const [junctionPieces] = await db_pool.query(
                `SELECT gtp.*, gtp.ends_game_on_checkmate, gtp.ends_game_on_capture, p.piece_name, p.image_location
                 FROM game_type_pieces gtp
                 INNER JOIN pieces p ON gtp.piece_id = p.id
                 WHERE gtp.game_type_id = ?`,
                [gameType.id]
              );
              
              pieces = junctionPieces.map(piece => ({
                ...piece,
                id: `${piece.piece_id}_${piece.y}_${piece.x}`,
                ends_game_on_checkmate: !!piece.ends_game_on_checkmate,
                ends_game_on_capture: !!piece.ends_game_on_capture,
                // Control squares flag from junction table
                can_control_squares: !!piece.can_control_squares,
                // Castling partner override data from junction table
                manual_castling_partners: !!piece.manual_castling_partners,
                castling_partner_left_key: piece.castling_partner_left_key || null,
                castling_partner_right_key: piece.castling_partner_right_key || null
              }));
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
                `SELECT * FROM pieces WHERE id IN (?)`,
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
                    // Capture data
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
                    can_castle: fullPieceData.can_castle,
                    promotion_options: fullPieceData.promotion_options,
                    special_scenario_moves: fullPieceData.special_scenario_moves,
                    special_scenario_captures: fullPieceData.special_scenario_captures,
                    // Ranged attack data
                    can_capture_enemy_via_range: fullPieceData.can_capture_enemy_via_range,
                    up_attack_range: fullPieceData.up_attack_range,
                    down_attack_range: fullPieceData.down_attack_range,
                    left_attack_range: fullPieceData.left_attack_range,
                    right_attack_range: fullPieceData.right_attack_range,
                    up_left_attack_range: fullPieceData.up_left_attack_range,
                    up_right_attack_range: fullPieceData.up_right_attack_range,
                    down_left_attack_range: fullPieceData.down_left_attack_range,
                    down_right_attack_range: fullPieceData.down_right_attack_range,
                    up_attack_range_exact: fullPieceData.up_attack_range_exact,
                    down_attack_range_exact: fullPieceData.down_attack_range_exact,
                    left_attack_range_exact: fullPieceData.left_attack_range_exact,
                    right_attack_range_exact: fullPieceData.right_attack_range_exact,
                    up_left_attack_range_exact: fullPieceData.up_left_attack_range_exact,
                    up_right_attack_range_exact: fullPieceData.up_right_attack_range_exact,
                    down_left_attack_range_exact: fullPieceData.down_left_attack_range_exact,
                    down_right_attack_range_exact: fullPieceData.down_right_attack_range_exact,
                    ratio_one_attack_range: fullPieceData.ratio_one_attack_range,
                    ratio_two_attack_range: fullPieceData.ratio_two_attack_range,
                    step_by_step_attack_range: fullPieceData.step_by_step_attack_value,
                    max_piece_captures_per_ranged_attack: fullPieceData.max_piece_captures_per_ranged_attack,
                    can_fire_over_allies: fullPieceData.can_fire_over_allies,
                    can_fire_over_enemies: fullPieceData.can_fire_over_enemies,
                    // En passant
                    can_en_passant: fullPieceData.can_en_passant
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
          let otherData = {};
          try {
            otherData = JSON.parse(game.other_data || '{}');
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
            movesWithoutCapture: otherData?.movesWithoutCapture || 0, // Load counter from DB
            positionHistory: otherData?.positionHistory || {}, // Load position history for repetition
            controlSquareTracking: otherData?.controlSquareTracking || {}, // Track control square occupancy
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

          // Initialize castling partners for pieces that can castle
          initializeCastlingPartners(gameState);

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

    // Handle draw offer request
    socket.on("offerDraw", async ({ gameId }) => {
      try {
        const gameState = activeGames.get(gameId.toString());
        if (!gameState) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        if (gameState.status !== 'active') {
          socket.emit("error", { message: "Game is not active" });
          return;
        }

        const userId = socket.userId;
        const playerIdx = gameState.players.findIndex(p => p.id === userId);
        if (playerIdx === -1) {
          socket.emit("error", { message: "You are not a player in this game" });
          return;
        }

        // Check if there's already a pending draw offer
        if (gameState.pendingDrawOffer) {
          socket.emit("error", { message: "A draw offer is already pending" });
          return;
        }

        // Set the pending draw offer
        gameState.pendingDrawOffer = {
          from: userId,
          fromUsername: gameState.players[playerIdx].username,
          timestamp: Date.now()
        };

        console.log(`Draw offered by ${gameState.players[playerIdx].username} in game ${gameId}`);

        // Notify all players in the game
        io.to(`game-${gameId}`).emit("drawOffered", {
          gameId,
          from: userId,
          fromUsername: gameState.players[playerIdx].username
        });
      } catch (error) {
        console.error("Error offering draw:", error);
        socket.emit("error", { message: "Failed to offer draw" });
      }
    });

    // Handle draw acceptance
    socket.on("acceptDraw", async ({ gameId }) => {
      try {
        const gameState = activeGames.get(gameId.toString());
        if (!gameState) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        if (!gameState.pendingDrawOffer) {
          socket.emit("error", { message: "No draw offer pending" });
          return;
        }

        const userId = socket.userId;
        const playerIdx = gameState.players.findIndex(p => p.id === userId);
        if (playerIdx === -1) {
          socket.emit("error", { message: "You are not a player in this game" });
          return;
        }

        // Only the opponent can accept (not the one who offered)
        if (gameState.pendingDrawOffer.from === userId) {
          socket.emit("error", { message: "You cannot accept your own draw offer" });
          return;
        }

        console.log(`Draw accepted by ${gameState.players[playerIdx].username} in game ${gameId}`);

        // Stop the timer
        stopGameTimer(gameId);

        // Mark game as drawn
        gameState.status = 'completed';
        gameState.winner = null;
        gameState.winReason = 'agreement';
        gameState.pendingDrawOffer = null;

        // Update ELO ratings for draw
        let eloChanges = null;
        const player1 = gameState.players[0];
        const player2 = gameState.players[1];
        if (gameState.rated !== false && player1?.id && player2?.id) {
          const p1Elo = player1.elo || 1000;
          const p2Elo = player2.elo || 1000;
          const higherPlayer = p1Elo >= p2Elo ? player1.id : player2.id;
          const lowerPlayer = p1Elo >= p2Elo ? player2.id : player1.id;
          eloChanges = await updateEloRatings(higherPlayer, lowerPlayer, true);
          console.log('ELO updated for draw by agreement:', eloChanges);
        }

        // Update database
        const endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        try {
          await db_pool.query(
            `UPDATE games SET status = 'completed', end_time = ?, winner_id = NULL,
             pieces = ?, other_data = ? WHERE id = ?`,
            [endTime, JSON.stringify(gameState.pieces), 
             JSON.stringify({ 
               moves: gameState.moveHistory, 
               reason: 'agreement',
               eloChanges,
               rated: gameState.rated,
               allowPremoves: gameState.allowPremoves
             }),
             gameId]
          );
          console.log('Database updated for draw by agreement');
        } catch (dbError) {
          console.error('Failed to update database:', dbError);
        }

        // Emit game over to all players
        io.to(`game-${gameId}`).emit("gameOver", {
          gameId,
          winner: null,
          reason: 'agreement',
          finalState: gameState,
          eloChanges
        });
        console.log('gameOver event emitted for draw by agreement in game-' + gameId);
      } catch (error) {
        console.error("Error accepting draw:", error);
        socket.emit("error", { message: "Failed to accept draw" });
      }
    });

    // Handle draw decline
    socket.on("declineDraw", async ({ gameId }) => {
      try {
        const gameState = activeGames.get(gameId.toString());
        if (!gameState) {
          socket.emit("error", { message: "Game not found" });
          return;
        }

        if (!gameState.pendingDrawOffer) {
          socket.emit("error", { message: "No draw offer pending" });
          return;
        }

        const userId = socket.userId;
        const playerIdx = gameState.players.findIndex(p => p.id === userId);
        if (playerIdx === -1) {
          socket.emit("error", { message: "You are not a player in this game" });
          return;
        }

        // Only the opponent can decline (not the one who offered)
        if (gameState.pendingDrawOffer.from === userId) {
          socket.emit("error", { message: "You cannot decline your own draw offer" });
          return;
        }

        console.log(`Draw declined by ${gameState.players[playerIdx].username} in game ${gameId}`);

        // Clear the pending draw offer
        gameState.pendingDrawOffer = null;

        // Notify all players
        io.to(`game-${gameId}`).emit("drawDeclined", {
          gameId,
          by: userId,
          byUsername: gameState.players[playerIdx].username
        });
      } catch (error) {
        console.error("Error declining draw:", error);
        socket.emit("error", { message: "Failed to decline draw" });
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      
      const userData = playerSockets.get(socket.id);
      if (userData) {
        // Don't immediately remove from onlineUsers - use a grace period
        // This allows users to refresh without disappearing from online friends
        const userId = userData.id;
        const username = userData.username;
        
        // Clear socket mappings immediately
        userSockets.delete(userId.toString());
        playerSockets.delete(socket.id);
        
        // Set a timeout before removing from onlineUsers (5 second grace period)
        const disconnectTimeout = setTimeout(() => {
          // Only remove if they haven't reconnected
          if (!userSockets.has(userId.toString())) {
            onlineUsers.delete(userId);
            console.log(`User ${username} (ID: ${userId}) removed from online users after grace period`);
            
            // Broadcast updated online users list
            io.emit("onlineUsers", Array.from(onlineUsers));
          }
          disconnectTimeouts.delete(userId);
        }, 5000); // 5 second grace period
        
        disconnectTimeouts.set(userId, disconnectTimeout);
        console.log(`Started disconnect grace period for user ${username} (ID: ${userId})`);
      }

      // Note: We don't automatically forfeit games on disconnect
      // The player can reconnect within a reasonable time
    });
  });

  return io;
}

/**
 * Get list of games waiting for players (excludes challenge games)
 */
async function getOpenLiveGames() {
  try {
    const [games] = await db_pool.query(
      `SELECT g.*, gt.game_name, gt.board_width, gt.board_height, u.username as host_username
       FROM games g
       JOIN game_types gt ON g.game_type_id = gt.id
       JOIN users u ON g.host_id = u.id
       WHERE g.status = 'waiting' AND (g.is_challenge = 0 OR g.is_challenge IS NULL)
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
    // Only initialize if piece can castle and partners aren't already set
    if (piece.can_castle && 
        piece.castling_partner_left_id === undefined && 
        piece.castling_partner_right_id === undefined) {
      
      // Check if manual castling partners are specified
      if (piece.manual_castling_partners) {
        // Manual override mode - use specified keys or null (disabling default)
        if (piece.castling_partner_left_key) {
          // Parse the key "row,col" to find the piece
          const [row, col] = piece.castling_partner_left_key.split(',').map(Number);
          const leftPartner = pieces.find(p => p.x === col && p.y === row);
          if (leftPartner) {
            piece.castling_partner_left_id = leftPartner.id;
          }
        }
        // Left partner explicitly not set = no left castling
        
        if (piece.castling_partner_right_key) {
          // Parse the key "row,col" to find the piece
          const [row, col] = piece.castling_partner_right_key.split(',').map(Number);
          const rightPartner = pieces.find(p => p.x === col && p.y === row);
          if (rightPartner) {
            piece.castling_partner_right_id = rightPartner.id;
          }
        }
        // Right partner explicitly not set = no right castling
        
        // Set to null (not undefined) to indicate partners were checked
        if (piece.castling_partner_left_id === undefined) {
          piece.castling_partner_left_id = null;
        }
        if (piece.castling_partner_right_id === undefined) {
          piece.castling_partner_right_id = null;
        }
      } else {
        // Default auto-discovery mode
        const pieceOwner = piece.team || piece.player_id;
        
        // Find furthest allied piece to the left (scan entire row)
        let leftPartner = null;
        for (let x = piece.x - 1; x >= 0; x--) {
          const foundPiece = pieces.find(p => p.x === x && p.y === piece.y);
          if (foundPiece) {
            const foundOwner = foundPiece.team || foundPiece.player_id;
            if (foundOwner === pieceOwner) {
              leftPartner = foundPiece;
            }
          }
        }
        
        // Find furthest allied piece to the right (scan entire row)
        let rightPartner = null;
        for (let x = piece.x + 1; x < boardWidth; x++) {
          const foundPiece = pieces.find(p => p.x === x && p.y === piece.y);
          if (foundPiece) {
            const foundOwner = foundPiece.team || foundPiece.player_id;
            if (foundOwner === pieceOwner) {
              rightPartner = foundPiece;
            }
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
  
  // Handle ranged attacks - piece stays in place, target is captured at range
  const isRangedAttack = move.isRangedAttack === true;
  
  if (isRangedAttack) {
    // Ranged attack: validate target exists and is an enemy
    if (destinationPieceIndex === -1) {
      return { valid: false, reason: "No target for ranged attack" };
    }
    const destPiece = pieces[destinationPieceIndex];
    const destPieceOwnerPosition = destPiece.team || destPiece.player_id;
    if (destPieceOwnerPosition === pieceOwnerPosition) {
      return { valid: false, reason: "Cannot ranged attack your own piece" };
    }
    // Validate using ranged attack rules
    const canRanged = canRangedAttackTo(piece.y, piece.x, to.y, to.x, piece, pieceOwnerPosition);
    if (!canRanged) {
      return { valid: false, reason: "Piece cannot ranged attack that square" };
    }
    
    // Check if path is clear for ranged attack (unless piece can fire over)
    const pathClear = isRangedPathClear(piece.x, piece.y, to.x, to.y, piece, pieces, pieceOwnerPosition);
    if (!pathClear) {
      return { valid: false, reason: "Ranged attack is blocked by another piece" };
    }
    
    capturedPiece = destPiece;
    
    // Remove the captured piece
    pieces.splice(destinationPieceIndex, 1);
    
    // Piece stays in place but turn still counts
    const movingPiece = pieces.find(p => p.id === pieceId);
    if (movingPiece) {
      movingPiece.hasMoved = true;
      if (movingPiece.moveCount === undefined) {
        movingPiece.moveCount = 1;
      } else {
        movingPiece.moveCount++;
      }
    }
    
    return { valid: true, captured: capturedPiece, promotionEligible: null, movingPiece, isRangedAttack: true };
  }
  
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
    // No piece at destination - check for en passant capture first
    let isEnPassantCapture = false;
    if (piece.can_en_passant && gameState.enPassantTarget) {
      const ept = gameState.enPassantTarget;
      console.log('[EN PASSANT DEBUG] Checking en passant opportunity:', {
        pieceCanEnPassant: piece.can_en_passant,
        moveTo: to,
        captureSquare: ept.captureSquare,
        victimPosition: ept.piecePosition,
        piecePosition: { x: piece.x, y: piece.y }
      });
      // Check if this move is to the en passant capture square
      if (to.x === ept.captureSquare.x && to.y === ept.captureSquare.y) {
        console.log('[EN PASSANT DEBUG] Move is to capture square');
        // Find the enemy piece that is vulnerable to en passant
        const enPassantVictimIndex = pieces.findIndex(p => 
          p.id === ept.pieceId && p.x === ept.piecePosition.x && p.y === ept.piecePosition.y
        );
        console.log('[EN PASSANT DEBUG] Victim index:', enPassantVictimIndex);
        if (enPassantVictimIndex !== -1) {
          const enPassantVictim = pieces[enPassantVictimIndex];
          const victimOwner = enPassantVictim.team || enPassantVictim.player_id;
          console.log('[EN PASSANT DEBUG] Victim found:', {
            victimOwner,
            pieceOwnerPosition,
            piecePieceId: piece.piece_id,
            victimPieceId: enPassantVictim.piece_id,
            pieceY: piece.y,
            victimY: enPassantVictim.y,
            xDiff: Math.abs(piece.x - enPassantVictim.x)
          });
          // Must be enemy piece
          if (victimOwner !== pieceOwnerPosition) {
            // Must be same piece type (e.g., pawn can only en passant capture another pawn)
            if (piece.piece_id === enPassantVictim.piece_id) {
              // Validate the capturing piece is horizontally adjacent to the victim
              if (piece.y === enPassantVictim.y && Math.abs(piece.x - enPassantVictim.x) === 1) {
                // Validate that the piece can actually capture diagonally to the capture square
                const canAttackDiagonal = canPieceAttackSquare(piece, to.x, to.y, pieces);
                console.log('[EN PASSANT DEBUG] Can attack diagonal to capture square:', canAttackDiagonal);
                if (canAttackDiagonal) {
                  capturedPiece = enPassantVictim;
                  isEnPassantCapture = true;
                  console.log('[EN PASSANT DEBUG] En passant capture VALID!');
                }
              }
            }
          }
        }
      }
    }
    
    if (!isEnPassantCapture) {
      // Validate this is a legal non-capture move
      // Use canPieceMoveToSquare which checks movement rules only (not capture rules)
      const canMove = canPieceMoveToSquare(piece, to.x, to.y, pieces);
      if (!canMove) {
        return { valid: false, reason: "Piece cannot move to that square" };
      }
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
  // Handle en passant capture (captured piece is at different position than destination)
  let isEnPassantCapture = false;
  if (capturedPiece && destinationPieceIndex === -1) {
    // This is an en passant capture - find and remove the captured piece
    const epCapturedIndex = pieces.findIndex(p => p.id === capturedPiece.id);
    if (epCapturedIndex !== -1) {
      pieces.splice(epCapturedIndex, 1);
      isEnPassantCapture = true;
    }
  } else if (destinationPieceIndex !== -1) {
    pieces.splice(destinationPieceIndex, 1);
  }

  // Update piece position
  const movingPiece = pieces.find(p => p.id === pieceId);
  let promotionEligible = null;
  
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

    // Check for promotion eligibility
    promotionEligible = checkPromotionEligibility(movingPiece, to, gameState);
  }

  // Clear previous en passant target - it's only valid for one turn
  gameState.enPassantTarget = null;
  
  // Check if this move creates a new en passant opportunity
  // A piece becomes vulnerable to en passant if:
  // 1. It moved using a first-move-only movement (moveCount was 0 before this move)
  // 2. It has no backward movement (to be a valid en passant target)
  // 3. The movement was significant (more than 1 square so opponent could have captured in between)
  console.log('[EN PASSANT DEBUG] Checking if move creates en passant opportunity:', {
    pieceName: movingPiece?.piece_name,
    moveCount: movingPiece?.moveCount,
    from,
    to,
    dy: to.y - from.y,
    dx: to.x - from.x
  });
  if (movingPiece && movingPiece.moveCount === 1) {
    const dy = to.y - from.y;
    const dx = to.x - from.x;
    
    // Determine if this was a first-move-only directional move
    // Check which direction was used and if it has available_for restriction
    let wasFirstMoveOnly = false;
    const pieceOwner = movingPiece.team || movingPiece.player_id;
    const isPlayer2 = pieceOwner === 2;
    const effectiveDy = isPlayer2 ? -dy : dy;
    const effectiveDx = isPlayer2 ? -dx : dx;
    
    // Helper to check special_scenario_moves for first-move-only additional movements
    const checkSpecialScenarioMoves = (direction, moveDistance) => {
      if (!movingPiece.special_scenario_moves) return false;
      let ssm = movingPiece.special_scenario_moves;
      if (typeof ssm === 'string') {
        try { ssm = JSON.parse(ssm); } catch (e) { return false; }
      }
      const additionalMovements = ssm?.additionalMovements?.[direction];
      if (!additionalMovements || !Array.isArray(additionalMovements)) return false;
      
      // Check if any additional movement has availableForMoves = 1 and matches the move distance
      return additionalMovements.some(m => m.availableForMoves === 1 && m.value >= moveDistance);
    };
    
    // Check vertical first-move-only (like pawn double move)
    if (dx === 0 && Math.abs(dy) > 1) {
      const dirProp = effectiveDy < 0 ? 'up_movement_available_for' : 'down_movement_available_for';
      const direction = effectiveDy < 0 ? 'up' : 'down';
      if (movingPiece[dirProp] === 1 || checkSpecialScenarioMoves(direction, Math.abs(dy))) {
        wasFirstMoveOnly = true;
      }
    }
    // Check diagonal first-move-only
    else if (Math.abs(dx) === Math.abs(dy) && Math.abs(dx) > 1) {
      let dirProp = null;
      let direction = null;
      if (effectiveDx < 0 && effectiveDy < 0) { dirProp = 'up_left_movement_available_for'; direction = 'up_left'; }
      else if (effectiveDx > 0 && effectiveDy < 0) { dirProp = 'up_right_movement_available_for'; direction = 'up_right'; }
      else if (effectiveDx < 0 && effectiveDy > 0) { dirProp = 'down_left_movement_available_for'; direction = 'down_left'; }
      else if (effectiveDx > 0 && effectiveDy > 0) { dirProp = 'down_right_movement_available_for'; direction = 'down_right'; }
      if (dirProp && (movingPiece[dirProp] === 1 || checkSpecialScenarioMoves(direction, Math.abs(dx)))) {
        wasFirstMoveOnly = true;
      }
    }
    // Check horizontal first-move-only
    else if (dy === 0 && Math.abs(dx) > 1) {
      const dirProp = effectiveDx < 0 ? 'left_movement_available_for' : 'right_movement_available_for';
      const direction = effectiveDx < 0 ? 'left' : 'right';
      if (movingPiece[dirProp] === 1 || checkSpecialScenarioMoves(direction, Math.abs(dx))) {
        wasFirstMoveOnly = true;
      }
    }
    
    console.log('[EN PASSANT DEBUG] wasFirstMoveOnly result:', wasFirstMoveOnly);
    
    if (wasFirstMoveOnly) {
      // The en passant capture square is where the piece "passed through"
      // For a standard 2-square forward move, it's one square behind
      const captureSquareX = to.x;
      const captureSquareY = from.y + Math.sign(dy); // One step in the direction of movement
      
      gameState.enPassantTarget = {
        pieceId: movingPiece.id,
        piecePosition: { x: to.x, y: to.y },
        captureSquare: { x: captureSquareX, y: captureSquareY },
        fromPosition: { x: from.x, y: from.y }
      };
      console.log('[EN PASSANT DEBUG] En passant target SET:', gameState.enPassantTarget);
    }
  }

  return { valid: true, captured: capturedPiece, promotionEligible, movingPiece, isEnPassantCapture };
}

/**
 * Generate a hash string representing the current board position
 * Used for N-fold repetition detection
 * @param {Array} pieces - Array of pieces on the board
 * @param {number} currentTurn - Whose turn it is (important for repetition)
 * @returns {string} - Position hash string
 */
function getPositionHash(pieces, currentTurn) {
  // Sort pieces by position and create a deterministic string representation
  const sortedPieces = pieces
    .map(p => `${p.piece_id}:${p.x},${p.y}:${p.team || p.player_id}`)
    .sort()
    .join('|');
  return `${currentTurn}:${sortedPieces}`;
}

/**
 * Check if a piece is eligible for promotion after moving to a square
 * @param {Object} piece - The piece that moved
 * @param {Object} targetSquare - The destination square {x, y}
 * @param {Object} gameState - The current game state
 * @returns {Object|null} - Promotion info if eligible, null otherwise
 */
function checkPromotionEligibility(piece, targetSquare, gameState) {
  if (!piece || !piece.can_promote) return null;
  
  const gameType = gameState.gameType;
  if (!gameType || !gameType.promotion_squares_string) return null;
  
  // Parse promotion squares
  let promotionSquares = {};
  try {
    promotionSquares = JSON.parse(gameType.promotion_squares_string);
  } catch (e) {
    console.error('Error parsing promotion_squares_string:', e);
    return null;
  }
  
  // Check if target square is a promotion square
  const squareKey = `${targetSquare.y},${targetSquare.x}`;
  if (!promotionSquares[squareKey]) return null;
  
  // Check if the piece started on this promotion square
  const initialKey = `${piece.initial_y},${piece.initial_x}`;
  if (initialKey === squareKey) return null; // Can't promote on starting square
  
  // Get eligible pieces for promotion (all starting piece types except:
  // - the piece being promoted
  // - any piece with has_checkmate_rule (can be checkmated)
  const eligiblePieces = getPromotionOptions(gameState, piece);
  
  if (eligiblePieces.length === 0) return null;
  
  return {
    eligible: true,
    pieceId: piece.id,
    options: eligiblePieces
  };
}

/**
 * Get available promotion options for a piece
 * @param {Object} gameState - The current game state
 * @param {Object} promotingPiece - The piece being promoted
 * @returns {Array} - Array of piece objects that can be promoted to
 */
function getPromotionOptions(gameState, promotingPiece) {
  const pieces = gameState.pieces;
  const pieceOwner = promotingPiece.player_id || promotingPiece.team;
  
  console.log('getPromotionOptions called:', {
    promotingPieceId: promotingPiece.piece_id,
    promotingPieceName: promotingPiece.piece_name,
  });
  
  // Get all unique piece types that the player started with
  const playerPieces = pieces.filter(p => {
    const owner = p.player_id || p.team;
    return owner === pieceOwner;
  });
  
  // Create a map of piece_id to piece data, keeping one example of each type
  // Also track if any piece of that type has checkmate/capture rules
  const pieceTypeMap = new Map();
  for (const p of playerPieces) {
    if (!pieceTypeMap.has(p.piece_id)) {
      pieceTypeMap.set(p.piece_id, {
        ...p,
        hasCheckmateRule: p.ends_game_on_checkmate || false,
        hasCaptureRule: p.ends_game_on_capture || false
      });
    } else {
      // If any piece of this type has the checkmate/capture rule, mark it
      const existing = pieceTypeMap.get(p.piece_id);
      if (p.ends_game_on_checkmate) existing.hasCheckmateRule = true;
      if (p.ends_game_on_capture) existing.hasCaptureRule = true;
    }
  }
  
  console.log('Piece type map:', Array.from(pieceTypeMap.entries()).map(([id, p]) => ({
    pieceId: id,
    pieceName: p.piece_name,
    hasCheckmateRule: p.hasCheckmateRule,
    hasCaptureRule: p.hasCaptureRule
  })));
  
  // Filter out:
  // 1. The piece type being promoted
  // 2. Pieces that have ends_game_on_checkmate flag (can be checkmated)
  // 3. Pieces that have ends_game_on_capture flag (lose on capture)
  const eligiblePieces = [];
  
  for (const [pieceId, pieceData] of pieceTypeMap) {
    const pieceIdNum = parseInt(pieceId);
    
    // Skip the same piece type
    if (pieceIdNum === parseInt(promotingPiece.piece_id)) continue;
    
    // Skip pieces with checkmate rule
    if (pieceData.hasCheckmateRule) {
      console.log(`Filtering out piece ${pieceId} (${pieceData.piece_name}) - has checkmate rule`);
      continue;
    }
    
    // Skip pieces with capture-loss rule
    if (pieceData.hasCaptureRule) {
      console.log(`Filtering out piece ${pieceId} (${pieceData.piece_name}) - has capture-loss rule`);
      continue;
    }
    
    console.log(`Adding eligible piece: ${pieceId} (${pieceData.piece_name})`);
    eligiblePieces.push({
      piece_id: pieceData.piece_id,
      piece_name: pieceData.piece_name,
      image_location: pieceData.image_location,
      image: pieceData.image,
      image_url: pieceData.image_url
    });
  }
  
  console.log(`Returning ${eligiblePieces.length} eligible pieces for promotion`);
  return eligiblePieces;
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
 * Helper: Get direction name from row/col differences (mirrors client pieceMovementUtils)
 */
function getDirectionFromDiff(rowDiff, colDiff) {
  if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'up_left';
  if (rowDiff < 0 && colDiff === 0) return 'up';
  if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'up_right';
  if (rowDiff === 0 && colDiff > 0) return 'right';
  if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'down_right';
  if (rowDiff > 0 && colDiff === 0) return 'down';
  if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'down_left';
  if (rowDiff === 0 && colDiff < 0) return 'left';
  return null;
}

/**
 * Helper: Get distance for a direction from row/col differences
 */
function getDistanceForDirection(rowDiff, colDiff, direction) {
  switch (direction) {
    case 'up': case 'down': return Math.abs(rowDiff);
    case 'left': case 'right': return Math.abs(colDiff);
    case 'up_left': case 'up_right': case 'down_left': case 'down_right': return Math.abs(rowDiff);
    default: return 0;
  }
}

/**
 * Helper: Check if a movement value allows a given distance
 */
function checkRangedMovement(value, distance, isExact) {
  if (value === 99) return true;
  if (value === 0 || value === null || value === undefined) return false;
  if (isExact) return distance === Math.abs(value);
  if (value > 0) return distance <= value;
  if (value < 0) return distance === Math.abs(value);
  return false;
}

/**
 * Check if the ranged attack path is blocked by other pieces
 * Returns true if the path is clear, false if blocked
 */
function isRangedPathClear(fromX, fromY, toX, toY, piece, allPieces, pieceOwnerPosition) {
  const canFireOverAllies = piece.can_fire_over_allies === 1 || piece.can_fire_over_allies === true;
  const canFireOverEnemies = piece.can_fire_over_enemies === 1 || piece.can_fire_over_enemies === true;
  
  // If can fire over both, path is always clear
  if (canFireOverAllies && canFireOverEnemies) return true;
  
  const dx = toX - fromX;
  const dy = toY - fromY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  
  // Only check path for directional attacks (not L-shape or step-by-step)
  // L-shape attacks are like knight moves and don't have a straight path
  if (absDx !== absDy && dx !== 0 && dy !== 0) {
    // L-shaped attack - no path blocking (similar to knight movement)
    return true;
  }
  
  // Calculate step direction
  const stepX = dx === 0 ? 0 : dx / absDx;
  const stepY = dy === 0 ? 0 : dy / absDy;
  
  // Check each square along the path (excluding start and end)
  let checkX = fromX + stepX;
  let checkY = fromY + stepY;
  
  while (checkX !== toX || checkY !== toY) {
    // Check if there's a piece at this position
    const blockingPiece = allPieces.find(p => p.x === checkX && p.y === checkY);
    if (blockingPiece) {
      const blockingOwner = blockingPiece.team || blockingPiece.player_id;
      const isAlly = blockingOwner === pieceOwnerPosition;
      
      if (isAlly && !canFireOverAllies) {
        return false; // Blocked by ally
      }
      if (!isAlly && !canFireOverEnemies) {
        return false; // Blocked by enemy
      }
    }
    
    checkX += stepX;
    checkY += stepY;
  }
  
  return true;
}

/**
 * Check if a piece can perform a ranged attack to a target position
 * Server-side mirror of client's canRangedAttackTo from pieceMovementUtils.js
 */
function canRangedAttackTo(fromRow, fromCol, toRow, toCol, pieceData, playerPosition) {
  if (!pieceData) return false;
  if (fromRow === toRow && fromCol === toCol) return false;
  if (!pieceData.can_capture_enemy_via_range) return false;

  const rowDiff = playerPosition === 2 ? (fromRow - toRow) : (toRow - fromRow);
  const colDiff = playerPosition === 2 ? (fromCol - toCol) : (toCol - fromCol);

  const direction = getDirectionFromDiff(rowDiff, colDiff);
  const distance = direction ? getDistanceForDirection(rowDiff, colDiff, direction) : 0;

  // Check directional ranged attack
  if (direction) {
    const attackFieldMap = {
      'up': 'up_attack_range', 'down': 'down_attack_range',
      'left': 'left_attack_range', 'right': 'right_attack_range',
      'up_left': 'up_left_attack_range', 'up_right': 'up_right_attack_range',
      'down_left': 'down_left_attack_range', 'down_right': 'down_right_attack_range'
    };
    const attackValue = pieceData[attackFieldMap[direction]];
    const isExact = !!pieceData[`${direction}_attack_range_exact`];
    if (checkRangedMovement(attackValue, distance, isExact)) return true;
  }

  // Check ratio attack range (L-shape)
  const ratio1 = pieceData.ratio_one_attack_range || 0;
  const ratio2 = pieceData.ratio_two_attack_range || 0;
  if (ratio1 > 0 && ratio2 > 0) {
    if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
        (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
      return true;
    }
  }

  // Check step-by-step attack
  const stepAttackValue = pieceData.step_by_step_attack_range;
  if (stepAttackValue) {
    const maxSteps = Math.abs(stepAttackValue);
    const noDiagonal = stepAttackValue < 0;
    if (noDiagonal) {
      if (Math.abs(rowDiff) + Math.abs(colDiff) <= maxSteps) return true;
    } else {
      if (Math.max(Math.abs(rowDiff), Math.abs(colDiff)) <= maxSteps) return true;
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
  
  // Step-by-step capture - use sign-based diagonal exclusion
  const stepCaptureValueRaw = piece.step_capture_value ?? (useMovementForCapture ? (piece.step_by_step_movement_value ?? piece.step_movement_value) : null);
  const stepCaptureValue = Number(stepCaptureValueRaw);
  if (!Number.isNaN(stepCaptureValue) && stepCaptureValue !== 0) {
    const maxSteps = Math.abs(stepCaptureValue);
    const noDiagonal = stepCaptureValue < 0;

    const manhattanDistance = absDx + absDy;
    const chebyshevDistance = Math.max(absDx, absDy);
    const inRange = noDiagonal
      ? (manhattanDistance > 0 && manhattanDistance <= maxSteps)
      : (chebyshevDistance > 0 && chebyshevDistance <= maxSteps);

    if (inRange) {
      // Use BFS traversal to check if target is reachable
      const occupied = new Set(
        allPieces
          .filter(p => p.id !== piece.id && !(p.x === targetX && p.y === targetY))
          .map(p => `${p.x},${p.y}`)
      );

      const queue = [{ x: piece.x, y: piece.y, steps: 0 }];
      const visited = new Set([`${piece.x},${piece.y}`]);
      const directions = noDiagonal
        ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

      while (queue.length > 0) {
        const current = queue.shift();
        if (current.steps >= maxSteps) continue;

        for (const [dirX, dirY] of directions) {
          const nextX = current.x + dirX;
          const nextY = current.y + dirY;
          const nextKey = `${nextX},${nextY}`;

          if (nextX === targetX && nextY === targetY) {
            return true;
          }

          if (occupied.has(nextKey) || visited.has(nextKey)) continue;

          visited.add(nextKey);
          queue.push({ x: nextX, y: nextY, steps: current.steps + 1 });
        }
      }
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

  const canReachStepByStep = (fromX, fromY, toX, toY, maxSteps, noDiagonal) => {
    if (maxSteps <= 0) return false;

    const occupied = new Set(
      allPieces
        .filter(p => p.id !== piece.id)
        .map(p => `${p.x},${p.y}`)
    );

    const queue = [{ x: fromX, y: fromY, steps: 0 }];
    const visited = new Set([`${fromX},${fromY}`]);
    const directions = noDiagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.steps >= maxSteps) {
        continue;
      }

      for (const [dirX, dirY] of directions) {
        const nextX = current.x + dirX;
        const nextY = current.y + dirY;
        const nextKey = `${nextX},${nextY}`;

        if (occupied.has(nextKey)) {
          continue;
        }

        if (nextX === toX && nextY === toY) {
          return true;
        }

        if (visited.has(nextKey)) {
          continue;
        }

        if (noDiagonal) {
          if (Math.abs(nextX - fromX) + Math.abs(nextY - fromY) > maxSteps) {
            continue;
          }
        } else {
          if (Math.max(Math.abs(nextX - fromX), Math.abs(nextY - fromY)) > maxSteps) {
            continue;
          }
        }

        visited.add(nextKey);
        queue.push({ x: nextX, y: nextY, steps: current.steps + 1 });
      }
    }

    return false;
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

  // Step-by-step movement
  const stepValueRaw = piece.step_by_step_movement_value ?? piece.step_movement_value;
  const stepValue = Number(stepValueRaw);
  if (!Number.isNaN(stepValue) && stepValue !== 0) {
    const maxSteps = Math.abs(stepValue);
    const noDiagonal = stepValue < 0;

    const manhattanDistance = Math.abs(dx) + Math.abs(dy);
    const chebyshevDistance = Math.max(Math.abs(dx), Math.abs(dy));
    const inRange = noDiagonal
      ? (manhattanDistance > 0 && manhattanDistance <= maxSteps)
      : (chebyshevDistance > 0 && chebyshevDistance <= maxSteps);

    if (inRange && canReachStepByStep(piece.x, piece.y, targetX, targetY, maxSteps, noDiagonal)) {
      return true;
    }
  }

  // Check special scenario moves (e.g., pawn's 2-square first move)
  if (piece.special_scenario_moves) {
    try {
      const specialMoves = typeof piece.special_scenario_moves === 'string' 
        ? JSON.parse(piece.special_scenario_moves) 
        : piece.special_scenario_moves;
      
      const additionalMovements = specialMoves?.additionalMovements || {};
      
      // Determine direction based on effective movement (player perspective)
      let direction = null;
      const distance = Math.max(absDx, absDy);
      
      // Use effective dx/dy for direction (already flipped for player 2)
      if (effectiveDy < 0 && effectiveDx === 0) direction = 'up';
      else if (effectiveDy > 0 && effectiveDx === 0) direction = 'down';
      else if (effectiveDy === 0 && effectiveDx < 0) direction = 'left';
      else if (effectiveDy === 0 && effectiveDx > 0) direction = 'right';
      else if (effectiveDy < 0 && effectiveDx < 0 && absDx === absDy) direction = 'up_left';
      else if (effectiveDy < 0 && effectiveDx > 0 && absDx === absDy) direction = 'up_right';
      else if (effectiveDy > 0 && effectiveDx < 0 && absDx === absDy) direction = 'down_left';
      else if (effectiveDy > 0 && effectiveDx > 0 && absDx === absDy) direction = 'down_right';
      
      if (direction && additionalMovements[direction]) {
        for (const movementOption of additionalMovements[direction]) {
          const value = movementOption.value || 0;
          const matches = (movementOption.infinite && distance > 0) ||
                         (movementOption.exact && distance === value) ||
                         (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value);
          
          if (matches && isPathClear(piece.x, piece.y, targetX, targetY)) {
            return true;
          }
        }
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  // Check for castling moves
  if (piece.can_castle && !piece.hasMoved && dy === 0 && absDx === 2) {
    const direction = dx < 0 ? 'left' : 'right';
    const partnerId = direction === 'left' 
      ? piece.castling_partner_left_id 
      : piece.castling_partner_right_id;
    
    if (partnerId) {
      const partner = allPieces.find(p => p.id === partnerId);
      if (partner && !partner.hasMoved) {
        // Calculate distance to partner
        const distanceToPartner = Math.abs(partner.x - piece.x);
        
        // Check if this is close-range castling (partner within 2 squares)
        const isCloseRange = distanceToPartner > 0 && distanceToPartner <= 2;
        
        if (isCloseRange) {
          // Close-range castling: king hops over pieces
          // Target is valid if: empty, OR occupied by the partner itself (who will move)
          const targetOccupiedByOther = allPieces.some(p => p.x === targetX && p.y === targetY && p.id !== partnerId);
          if (!targetOccupiedByOther) {
            return true;
          }
        } else {
          // Standard long-range castling: path must be clear
          const pathIsClear = isPathClear(piece.x, piece.y, targetX, targetY);
          if (pathIsClear) {
            return true;
          }
        }
      }
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
        const distanceToPartner = piece.x - rookPiece.x;
        const isCloseRange = distanceToPartner > 0 && distanceToPartner <= 2;
        
        let pathClear = true;
        
        if (isCloseRange) {
          // Close-range castling: king hops, target can be partner's position or empty
          const targetOccupiedByOther = allPieces.some(p => p.x === leftTarget.x && p.y === leftTarget.y && p.id !== rookPiece.id);
          pathClear = !targetOccupiedByOther;
        } else {
          // Standard long-range castling: check if all squares between are unoccupied
          for (let x = piece.x - 1; x >= rookPiece.x + 1; x--) {
            if (allPieces.some(p => p.x === x && p.y === piece.y)) {
              pathClear = false;
              break;
            }
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
        const distanceToPartner = rookPiece.x - piece.x;
        const isCloseRange = distanceToPartner > 0 && distanceToPartner <= 2;
        
        let pathClear = true;
        
        if (isCloseRange) {
          // Close-range castling: king hops, target can be partner's position or empty
          const targetOccupiedByOther = allPieces.some(p => p.x === rightTarget.x && p.y === rightTarget.y && p.id !== rookPiece.id);
          pathClear = !targetOccupiedByOther;
        } else {
          // Standard long-range castling: check if all squares between are unoccupied
          for (let x = piece.x + 1; x <= rookPiece.x - 1; x++) {
            if (allPieces.some(p => p.x === x && p.y === piece.y)) {
              pathClear = false;
              break;
            }
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
 * Update control square tracking after a move
 * Tracks which player (if any) has a piece with can_control_squares on each control square
 * and how many consecutive full turns they have controlled it
 * @param {Object} gameState - The current game state
 * @returns {Object|null} - Win result if a control square win condition is met, null otherwise
 */
function updateControlSquareTracking(gameState) {
  const { gameType, pieces, players } = gameState;
  
  if (!gameType?.control_squares_string) return null;
  
  let controlSquares;
  try {
    controlSquares = JSON.parse(gameType.control_squares_string);
  } catch (e) {
    console.error('Error parsing control_squares_string:', e);
    return null;
  }
  
  if (!controlSquares || Object.keys(controlSquares).length === 0) return null;
  
  // Ensure controlSquareTracking exists
  if (!gameState.controlSquareTracking) {
    gameState.controlSquareTracking = {};
  }
  
  // Check each control square
  for (const [squareKey, config] of Object.entries(controlSquares)) {
    const [row, col] = squareKey.split(',').map(Number);
    
    // Find a piece on this square that can control squares
    const controllingPiece = pieces.find(p => 
      p.x === col && p.y === row && p.can_control_squares
    );
    
    // Get the player ID controlling this square (if any)
    let controllingPlayerId = null;
    if (controllingPiece) {
      controllingPlayerId = controllingPiece.team || 
                           controllingPiece.player_id || 
                           controllingPiece.player_number;
    }
    
    const tracking = gameState.controlSquareTracking[squareKey];
    
    if (controllingPlayerId) {
      if (tracking && tracking.playerId === controllingPlayerId) {
        // Same player still controls - increment half-turn count
        tracking.halfTurns = (tracking.halfTurns || 0) + 1;
      } else {
        // New player takes control (or first time)
        gameState.controlSquareTracking[squareKey] = {
          playerId: controllingPlayerId,
          halfTurns: 1
        };
      }
    } else {
      // No one controlling - check consecutiveTurns setting
      if (tracking && config.consecutiveTurns) {
        // Lost control - reset if consecutive is required
        delete gameState.controlSquareTracking[squareKey];
      }
      // If not consecutive, keep the tracking as-is (don't increment but don't reset)
    }
    
    // Check if win condition is met
    const currentTracking = gameState.controlSquareTracking[squareKey];
    if (currentTracking) {
      const turnsRequired = config.turnsRequired || 1;
      // Convert turns to half-turns: turnsRequired full turns = turnsRequired * 2 half-turns
      // But a full turn is complete after both players move, so we need turnsRequired * 2 half-turns
      const halfTurnsRequired = turnsRequired * 2;
      
      console.log(`Control square ${squareKey}: player ${currentTracking.playerId} has ${currentTracking.halfTurns} half-turns, needs ${halfTurnsRequired}`);
      
      if (currentTracking.halfTurns >= halfTurnsRequired) {
        // Find the winning player
        const winner = players.find(p => 
          p.position === currentTracking.playerId || 
          p.id === currentTracking.playerId
        );
        
        console.log(`Control square win! Player ${currentTracking.playerId} controlled ${squareKey} for ${turnsRequired} full turns`);
        
        return {
          gameOver: true,
          winner: winner?.id,
          reason: 'control'
        };
      }
    }
  }
  
  return null;
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

  // Fallback: If no win conditions are defined, capturing all opponent pieces wins
  // This provides a reasonable default so games without explicit win conditions can still end
  const hasAnyWinCondition = gameType.mate_condition || gameType.capture_condition || 
                              gameType.value_condition || gameType.squares_condition || 
                              gameType.hill_condition;
  
  if (!hasAnyWinCondition) {
    for (const player of players) {
      // Get all pieces belonging to this player
      const playerPieces = pieces.filter(p => 
        p.team === player.position || 
        p.player_id === player.position || 
        p.player === player.id ||
        p.player_number === player.position
      );
      
      // If this player has no pieces left, they lose
      if (playerPieces.length === 0) {
        const winner = players.find(p => p.id !== player.id);
        return {
          gameOver: true,
          winner: winner?.id,
          reason: 'elimination'
        };
      }
    }
  }

  return { gameOver: false };
}

/**
 * Get the Socket.io instance for use in other modules
 */
function getIO() {
  return ioInstance;
}

module.exports = { initializeSocket, activeGames, onlineUsers, getIO };
