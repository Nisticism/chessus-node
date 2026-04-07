const db = require("../configs/db");

/**
 * Database query wrapper (now using promise-based pool)
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
const query = async (sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return rows;
};

/**
 * Find user by username
 * @param {string} username - Username to search for
 * @returns {Promise<Object|null>} User object or null
 */
const findUserByUsername = async (username) => {
  const result = await query("SELECT * FROM chessusnode.users WHERE username = ?", [username]);
  return result.length > 0 ? result[0] : null;
};

/**
 * Find user by email
 * @param {string} email - Email to search for
 * @returns {Promise<Object|null>} User object or null
 */
const findUserByEmail = async (email) => {
  const result = await query("SELECT * FROM chessusnode.users WHERE email = ?", [email]);
  return result.length > 0 ? result[0] : null;
};

/**
 * Find user by ID
 * @param {number} id - User ID
 * @returns {Promise<Object|null>} User object or null
 */
const findUserById = async (id) => {
  const result = await query("SELECT * FROM chessusnode.users WHERE id = ?", [id]);
  return result.length > 0 ? result[0] : null;
};

/**
 * Create a new user
 * @param {string} username - Username
 * @param {string} hashedPassword - Hashed password
 * @param {string} email - Email address
 * @returns {Promise<Object>} Created user object
 */
const createUser = async (username, hashedPassword, email) => {
  // Default board colors are the "Wood" theme
  const defaultLightColor = '#e3d4bf';  // Wood light: hsl(35, 40%, 82%)
  const defaultDarkColor = '#64472b';   // Wood dark: hsl(30, 40%, 28%)
  
  await query(
    "INSERT INTO chessusnode.users (username, password, email, light_square_color, dark_square_color, allow_non_friend_dms, sound_enabled) VALUES (?,?,?,?,?,1,1)",
    [username, hashedPassword, email, defaultLightColor, defaultDarkColor]
  );
  return { username, password: hashedPassword, email, light_square_color: defaultLightColor, dark_square_color: defaultDarkColor, allow_non_friend_dms: 1, sound_enabled: 1 };
};

/**
 * Update user profile
 * @param {Object} userData - User data to update
 * @param {number} id - User ID
 * @returns {Promise<Object>} Result of update
 */
const updateUser = async (userData, id) => {
  const { username, password, email, first_name, last_name, bio, show_display_name } = userData;
  
  if (password) {
    return await query(
      "UPDATE chessusnode.users SET username = ?, password = ?, email = ?, first_name = ?, last_name = ?, bio = ?, show_display_name = COALESCE(?, show_display_name) WHERE id = ?",
      [username, password, email, first_name, last_name, bio, show_display_name !== undefined ? show_display_name : null, id]
    );
  } else {
    return await query(
      "UPDATE chessusnode.users SET username = ?, email = ?, first_name = ?, last_name = ?, bio = ?, show_display_name = COALESCE(?, show_display_name) WHERE id = ?",
      [username, email, first_name, last_name, bio, show_display_name !== undefined ? show_display_name : null, id]
    );
  }
};

/**
 * Delete user by username — disables FK checks so that articles/comments
 * retain their author_id (server resolves missing users as "User Deleted").
 * @param {string} username - Username
 * @returns {Promise<Object>} Result of deletion
 */
const deleteUser = async (username) => {
  // Find the user first
  const user = await query("SELECT id FROM chessusnode.users WHERE username = ?", [username]);
  if (!user || user.length === 0) return null;
  const userId = user[0].id;
  
  // Clean up tables that have strict FK constraints (non-content tables)
  await query("DELETE FROM notifications WHERE user_id = ? OR sender_id = ?", [userId, userId]);
  await query("DELETE FROM friends WHERE user_id = ? OR friend_id = ?", [userId, userId]);
  await query("DELETE FROM friend_requests WHERE sender_id = ? OR receiver_id = ?", [userId, userId]);
  await query("DELETE FROM players WHERE user_id = ?", [userId]);
  await query("DELETE FROM liked_articles WHERE user_id = ?", [userId]);
  
  // Disable FK checks to allow user deletion while preserving author_id
  // references in articles/comments (so they display as "User Deleted")
  await query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    const result = await query("DELETE FROM chessusnode.users WHERE username = ?", [username]);
    await query("SET FOREIGN_KEY_CHECKS = 1");
    return result;
  } catch (err) {
    await query("SET FOREIGN_KEY_CHECKS = 1");
    throw err;
  }
};

/**
 * Get all users
 * @returns {Promise<Array>} Array of users
 */
const getAllUsers = async () => {
  return await query("SELECT * FROM chessusnode.users");
};

/**
 * Get all pieces
 * @returns {Promise<Array>} Array of pieces
 */
const getAllPieces = async () => {
  return await query(`
    SELECT 
      p.id,
      p.piece_name,
      p.piece_description,
      p.piece_width,
      p.piece_height,
      p.image_location,
      p.creator_id,
      p.is_anonymous_creator,
      CASE WHEN p.is_anonymous_creator = 1 THEN 'Anonymous' ELSE u.username END as creator_username,
      gt.game_name as game_type_name
    FROM chessusnode.pieces p
    LEFT JOIN chessusnode.users u ON p.creator_id = u.id
    LEFT JOIN chessusnode.game_types gt ON p.game_type_id = gt.id
    ORDER BY p.id DESC
  `);
};

/**
 * Get all pieces with full movement and capture data (for sandbox mode)
 * @returns {Promise<Array>} Array of pieces with movement/capture data
 */
const getAllPiecesWithMovement = async () => {
  return await query(`
    SELECT 
      p.id as piece_id,
      p.piece_name,
      p.piece_description,
      p.piece_category,
      p.piece_width,
      p.piece_height,
      p.image_location,
      p.creator_id,
      p.is_anonymous_creator,
      CASE WHEN p.is_anonymous_creator = 1 THEN 'Anonymous' ELSE u.username END as creator_username,
      u.id as creator_user_id,
      -- Movement data
      p.directional_movement_style,
      p.repeating_movement,
      p.first_move_only,
      p.up_movement,
      p.down_movement,
      p.left_movement,
      p.right_movement,
      p.up_left_movement,
      p.up_right_movement,
      p.down_left_movement,
      p.down_right_movement,
      -- Movement exact flags
      p.up_left_movement_exact,
      p.up_movement_exact,
      p.up_right_movement_exact,
      p.right_movement_exact,
      p.down_right_movement_exact,
      p.down_movement_exact,
      p.down_left_movement_exact,
      p.left_movement_exact,
      -- Movement available_for flags
      p.up_left_movement_available_for,
      p.up_movement_available_for,
      p.up_right_movement_available_for,
      p.right_movement_available_for,
      p.down_right_movement_available_for,
      p.down_movement_available_for,
      p.down_left_movement_available_for,
      p.left_movement_available_for,
      p.ratio_movement_style,
      p.ratio_one_movement,
      p.ratio_two_movement,
      p.repeating_ratio,
      p.max_ratio_iterations,
      p.step_by_step_movement_style,
      p.step_by_step_movement_value,
      p.can_hop_over_allies,
      p.can_hop_over_enemies,
      p.exact_ratio_hop_only,
      p.directional_hop_disabled,
      p.min_turns_per_move,
      p.max_turns_per_move,
      p.available_for_moves,
      p.special_scenario_moves,
      -- Capture data
      p.can_capture_enemy_via_range,
      p.can_capture_enemy_on_move,
      p.first_move_only_capture,
      p.available_for_captures,
      p.up_capture,
      p.down_capture,
      p.left_capture,
      p.right_capture,
      p.up_left_capture,
      p.up_right_capture,
      p.down_left_capture,
      p.down_right_capture,
      -- Capture exact flags
      p.up_left_capture_exact,
      p.up_capture_exact,
      p.up_right_capture_exact,
      p.right_capture_exact,
      p.down_right_capture_exact,
      p.down_capture_exact,
      p.down_left_capture_exact,
      p.left_capture_exact,
      -- Capture available_for flags
      p.up_left_capture_available_for,
      p.up_capture_available_for,
      p.up_right_capture_available_for,
      p.right_capture_available_for,
      p.down_right_capture_available_for,
      p.down_capture_available_for,
      p.down_left_capture_available_for,
      p.left_capture_available_for,
      p.ratio_one_capture,
      p.ratio_two_capture,
      p.repeating_capture,
      p.repeating_ratio_capture,
      p.max_ratio_capture_iterations,
      p.step_by_step_capture,
      -- Attack range values
      p.up_left_attack_range,
      p.up_attack_range,
      p.up_right_attack_range,
      p.right_attack_range,
      p.down_right_attack_range,
      p.down_attack_range,
      p.down_left_attack_range,
      p.left_attack_range,
      -- Attack range exact flags
      p.up_left_attack_range_exact,
      p.up_attack_range_exact,
      p.up_right_attack_range_exact,
      p.right_attack_range_exact,
      p.down_right_attack_range_exact,
      p.down_attack_range_exact,
      p.down_left_attack_range_exact,
      p.left_attack_range_exact,
      -- Attack range available_for flags
      p.up_left_attack_range_available_for,
      p.up_attack_range_available_for,
      p.up_right_attack_range_available_for,
      p.right_attack_range_available_for,
      p.down_right_attack_range_available_for,
      p.down_attack_range_available_for,
      p.down_left_attack_range_available_for,
      p.left_attack_range_available_for,
      p.ratio_one_attack_range,
      p.ratio_two_attack_range,
      p.step_by_step_attack_style,
      p.step_by_step_attack_value,
      p.max_piece_captures_per_move,
      p.max_piece_captures_per_ranged_attack,
      p.special_scenario_captures,
      p.has_checkmate_rule,
      p.has_check_rule,
      p.has_lose_on_capture_rule,
      p.can_castle,
      p.can_promote,
      p.capture_on_hop,
      p.chain_capture_enabled,
      p.free_move_after_promotion,
      p.can_en_passant,
      p.can_fire_over_allies,
      p.can_fire_over_enemies,
      p.can_capture_allies,
      p.cannot_be_captured,
      p.custom_movement_squares,
      p.custom_attack_squares
    FROM chessusnode.pieces p
    LEFT JOIN chessusnode.users u ON p.creator_id = u.id
    ORDER BY p.id DESC
  `);
};

/**
 * Get piece by ID with all related data
 * @param {number} pieceId - Piece ID
 * @returns {Promise<Object|null>} Piece object or null
 */
const getPieceById = async (pieceId) => {
  const result = await query(`
    SELECT 
      p.id as piece_id,
      p.piece_name,
      p.piece_description,
      p.piece_category,
      p.piece_width,
      p.piece_height,
      p.image_location,
      p.creator_id,
      p.can_promote,
      p.is_anonymous_creator,
      CASE WHEN p.is_anonymous_creator = 1 THEN 'Anonymous' ELSE u.username END as creator_username, 
      u.id as creator_user_id, 
      -- Movement data
      p.directional_movement_style,
      p.repeating_movement,
      p.first_move_only,
      p.up_movement,
      p.down_movement,
      p.left_movement,
      p.right_movement,
      p.up_left_movement,
      p.up_right_movement,
      p.down_left_movement,
      p.down_right_movement,
      -- Movement exact flags
      p.up_left_movement_exact,
      p.up_movement_exact,
      p.up_right_movement_exact,
      p.right_movement_exact,
      p.down_right_movement_exact,
      p.down_movement_exact,
      p.down_left_movement_exact,
      p.left_movement_exact,
      -- Movement available_for flags
      p.up_left_movement_available_for,
      p.up_movement_available_for,
      p.up_right_movement_available_for,
      p.right_movement_available_for,
      p.down_right_movement_available_for,
      p.down_movement_available_for,
      p.down_left_movement_available_for,
      p.left_movement_available_for,
      p.ratio_movement_style,
      p.ratio_one_movement,
      p.ratio_two_movement,
      p.repeating_ratio,
      p.max_ratio_iterations,
      p.step_by_step_movement_style,
      p.step_by_step_movement_value,
      p.can_hop_over_allies,
      p.can_hop_over_enemies,
      p.exact_ratio_hop_only,
      p.directional_hop_disabled,
      p.min_turns_per_move,
      p.max_turns_per_move,
      p.available_for_moves,
      p.special_scenario_moves,
      -- Capture data
      p.can_capture_enemy_via_range,
      p.can_capture_enemy_on_move,
      p.first_move_only_capture,
      p.available_for_captures,
      p.up_capture,
      p.down_capture,
      p.left_capture,
      p.right_capture,
      p.up_left_capture,
      p.up_right_capture,
      p.down_left_capture,
      p.down_right_capture,
      -- Capture exact flags
      p.up_left_capture_exact,
      p.up_capture_exact,
      p.up_right_capture_exact,
      p.right_capture_exact,
      p.down_right_capture_exact,
      p.down_capture_exact,
      p.down_left_capture_exact,
      p.left_capture_exact,
      -- Capture available_for flags
      p.up_left_capture_available_for,
      p.up_capture_available_for,
      p.up_right_capture_available_for,
      p.right_capture_available_for,
      p.down_right_capture_available_for,
      p.down_capture_available_for,
      p.down_left_capture_available_for,
      p.left_capture_available_for,
      p.ratio_one_capture,
      p.ratio_two_capture,
      p.repeating_capture,
      p.repeating_ratio_capture,
      p.max_ratio_capture_iterations,
      p.step_by_step_capture,
      -- Attack range values
      p.up_left_attack_range,
      p.up_attack_range,
      p.up_right_attack_range,
      p.right_attack_range,
      p.down_right_attack_range,
      p.down_attack_range,
      p.down_left_attack_range,
      p.left_attack_range,
      -- Attack range exact flags
      p.up_left_attack_range_exact,
      p.up_attack_range_exact,
      p.up_right_attack_range_exact,
      p.right_attack_range_exact,
      p.down_right_attack_range_exact,
      p.down_attack_range_exact,
      p.down_left_attack_range_exact,
      p.left_attack_range_exact,
      -- Attack range available_for flags
      p.up_left_attack_range_available_for,
      p.up_attack_range_available_for,
      p.up_right_attack_range_available_for,
      p.right_attack_range_available_for,
      p.down_right_attack_range_available_for,
      p.down_attack_range_available_for,
      p.down_left_attack_range_available_for,
      p.left_attack_range_available_for,
      p.ratio_one_attack_range,
      p.ratio_two_attack_range,
      p.step_by_step_attack_style,
      p.step_by_step_attack_value,
      p.max_piece_captures_per_move,
      p.max_piece_captures_per_ranged_attack,
      p.special_scenario_captures,
      p.has_checkmate_rule,
      p.has_check_rule,
      p.has_lose_on_capture_rule,
      p.can_castle,
      p.can_fire_over_allies,
      p.can_fire_over_enemies,
      p.can_en_passant,
      p.capture_on_hop,
      p.chain_capture_enabled,
      p.chain_hop_allies,
      p.can_hop_attack_over_allies,
      p.can_hop_attack_over_enemies,
      p.free_move_after_promotion,
      p.promotion_pieces_ids,
      p.can_capture_allies,
      p.cannot_be_captured,
      p.custom_movement_squares,
      p.custom_attack_squares,
      p.created_at
    FROM chessusnode.pieces p
    LEFT JOIN chessusnode.users u ON p.creator_id = u.id
    WHERE p.id = ?
  `, [pieceId]);
  return result.length > 0 ? result[0] : null;
};

/**
 * Get all games
 * @returns {Promise<Array>} Array of games with creator information
 */
const getAllGames = async () => {
  return await query(`
    SELECT gt.*, 
      CASE WHEN gt.is_anonymous_creator = 1 THEN 'Anonymous' ELSE u.username END as creator_username,
      u.id as creator_user_id
    FROM chessusnode.game_types gt
    LEFT JOIN chessusnode.users u ON gt.creator_id = u.id
    ORDER BY gt.id DESC
  `);
};

/**
 * Get game by ID
 * @param {number} gameId - Game ID
 * @returns {Promise<Object|null>} Game object or null
 */
const getGameById = async (gameId) => {
  const result = await query(`
    SELECT gt.*, 
      CASE WHEN gt.is_anonymous_creator = 1 THEN 'Anonymous' ELSE u.username END as creator_username,
      u.id as creator_user_id
    FROM chessusnode.game_types gt
    LEFT JOIN chessusnode.users u ON gt.creator_id = u.id
    WHERE gt.id = ?
  `, [gameId]);
  
  if (result.length === 0) return null;
  
  const game = result[0];
  
  // Parse the original pieces_string to get player_id values (which are correct)
  // This is needed because the junction table may have incorrect player_number values
  let originalPiecePlayerMap = {};
  if (game.pieces_string) {
    try {
      const originalPieces = JSON.parse(game.pieces_string);
      if (typeof originalPieces === 'object' && !Array.isArray(originalPieces)) {
        Object.entries(originalPieces).forEach(([key, piece]) => {
          originalPiecePlayerMap[key] = piece.player_id || piece.player_number || piece.player || null;
        });
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  // Fetch pieces from junction table and construct pieces_string
  const pieces = await getPiecesForGameType(gameId);
  if (pieces && pieces.length > 0) {
    const piecesObj = {};
    for (const piece of pieces) {
      const key = `${piece.y},${piece.x}`;
      
      // Priority: 1) original pieces_string, 2) junction table player_number
      let playerId = originalPiecePlayerMap[key] || piece.player_number || 1;
      
      // Parse image_location and get the correct player image
      let imageUrl = null;
      if (piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          if (Array.isArray(images) && images.length > 0) {
            const imageIndex = Math.min((playerId || 1) - 1, images.length - 1);
            const imagePath = images[imageIndex];
            if (imagePath) {
              imageUrl = imagePath.startsWith('http') ? imagePath : 
                         imagePath.startsWith('/') ? imagePath : `/uploads/pieces/${imagePath}`;
            }
          }
        } catch (e) {
          imageUrl = piece.image_location;
        }
      }
      
      const pw = piece.piece_width || 1;
      const ph = piece.piece_height || 1;

      piecesObj[key] = {
        piece_id: piece.piece_id,
        x: piece.x,
        y: piece.y,
        player_number: playerId,
        player_id: playerId,
        player: playerId,
        piece_width: pw,
        piece_height: ph,
        ends_game_on_checkmate: Boolean(piece.ends_game_on_checkmate),
        ends_game_on_capture: Boolean(piece.ends_game_on_capture),
        manual_castling_partners: Boolean(piece.manual_castling_partners),
        castling_partner_left_key: piece.castling_partner_left_key,
        castling_partner_right_key: piece.castling_partner_right_key,
        can_control_squares: Boolean(piece.can_control_squares),
        castling_distance: piece.castling_distance ?? 2,
        capture_on_hop: Boolean(piece.capture_on_hop),
        chain_capture_enabled: Boolean(piece.chain_capture_enabled),
        piece_name: piece.piece_name,
        image_url: imageUrl,
        image_location: piece.image_location,
        // HP/AD system
        hit_points: piece.hit_points ?? 1,
        attack_damage: piece.attack_damage ?? 1,
        show_hp_ad: Boolean(piece.show_hp_ad),
        hp_regen: piece.hp_regen ?? 0,
        cannot_be_captured: Boolean(piece.cannot_be_captured),
        show_regen: Boolean(piece.show_regen),
        burn_damage: piece.burn_damage ?? 0,
        burn_duration: piece.burn_duration ?? 0,
        show_burn: Boolean(piece.show_burn),
        // Trample & Ghostwalk
        trample: Boolean(piece.trample),
        trample_radius: piece.trample_radius ?? 0,
        ghostwalk: Boolean(piece.ghostwalk)
      };

      // For multi-tile pieces, create extension square markers
      if (pw > 1 || ph > 1) {
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            if (dx === 0 && dy === 0) continue; // skip anchor
            const extKey = `${piece.y + dy},${piece.x + dx}`;
            piecesObj[extKey] = {
              _anchorKey: key,
              piece_id: piece.piece_id,
              player_id: playerId,
              piece_name: piece.piece_name,
              _occupied: true
            };
          }
        }
      }
    }
    game.pieces_string = JSON.stringify(piecesObj);
  }
  // If no junction pieces, keep original pieces_string as-is
  
  return game;
};

/**
 * Get all game types that use a specific piece
 * @param {number} pieceId - Piece ID
 * @returns {Promise<Array>} Array of game type objects
 */
const getGameTypesByPieceId = async (pieceId) => {
  const result = await query(`
    SELECT DISTINCT gt.*, 
      CASE WHEN gt.is_anonymous_creator = 1 THEN 'Anonymous' ELSE u.username END as creator_username,
      u.id as creator_user_id
    FROM chessusnode.game_types gt
    LEFT JOIN chessusnode.users u ON gt.creator_id = u.id
    INNER JOIN chessusnode.game_type_pieces gtp ON gt.id = gtp.game_type_id
    WHERE gtp.piece_id = ?
    ORDER BY gt.id DESC
  `, [pieceId]);
  return result;
};

/**
 * Get pieces for a game type from junction table
 * @param {number} gameTypeId - Game type ID
 * @returns {Promise<Array>} Array of piece objects with positions
 */
const getPiecesForGameType = async (gameTypeId) => {
  const result = await query(`
    SELECT gtp.*, p.*,
      gtp.x, gtp.y, gtp.player_number,
      gtp.id as junction_id,
      gtp.trample as trample,
      gtp.trample_radius as trample_radius,
      gtp.ghostwalk as ghostwalk,
      gtp.cannot_be_captured as cannot_be_captured
    FROM chessusnode.game_type_pieces gtp
    INNER JOIN chessusnode.pieces p ON gtp.piece_id = p.id
    WHERE gtp.game_type_id = ?
    ORDER BY gtp.player_number, gtp.y, gtp.x
  `, [gameTypeId]);
  return result;
};

/**
 * Add piece to game type
 * @param {number} gameTypeId - Game type ID
 * @param {number} pieceId - Piece ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} playerNumber - Player number (default 1)
 * @param {boolean} endsGameOnCheckmate - If true, game ends when this piece is checkmated
 * @param {boolean} endsGameOnCapture - If true, game ends when this piece is captured
 * @param {boolean} manualCastlingPartners - Whether castling partners are manually set
 * @param {string|null} castlingPartnerLeftKey - Key for left castling partner (e.g., "0,0")
 * @param {string|null} castlingPartnerRightKey - Key for right castling partner (e.g., "0,7")
 * @param {boolean} canControlSquares - If true, this piece can control squares for the control squares win condition
 * @returns {Promise<Object>} Insert result
 */
const addPieceToGameType = async (gameTypeId, pieceId, x, y, playerNumber = 1, endsGameOnCheckmate = false, endsGameOnCapture = false, manualCastlingPartners = false, castlingPartnerLeftKey = null, castlingPartnerRightKey = null, canControlSquares = false, castlingDistance = 2, hitPoints = 1, attackDamage = 1, showHpAd = false, hpRegen = 0, cannotBeCaptured = false, showRegen = false, burnDamage = 0, burnDuration = 0, showBurn = false, trample = false, trampleRadius = 0, ghostwalk = false) => {
  const result = await query(`
    INSERT INTO chessusnode.game_type_pieces (game_type_id, piece_id, x, y, player_number, ends_game_on_checkmate, ends_game_on_capture, manual_castling_partners, castling_partner_left_key, castling_partner_right_key, can_control_squares, castling_distance, hit_points, attack_damage, show_hp_ad, hp_regen, cannot_be_captured, show_regen, burn_damage, burn_duration, show_burn, trample, trample_radius, ghostwalk)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [gameTypeId, pieceId, x, y, playerNumber, endsGameOnCheckmate ? 1 : 0, endsGameOnCapture ? 1 : 0, manualCastlingPartners ? 1 : 0, castlingPartnerLeftKey, castlingPartnerRightKey, canControlSquares ? 1 : 0, castlingDistance || 2, hitPoints || 1, attackDamage || 1, showHpAd ? 1 : 0, hpRegen || 0, cannotBeCaptured ? 1 : 0, showRegen ? 1 : 0, burnDamage || 0, burnDuration || 0, showBurn ? 1 : 0, trample ? 1 : 0, trampleRadius || 0, ghostwalk ? 1 : 0]);
  return result;
};

/**
 * Remove all pieces from a game type
 * @param {number} gameTypeId - Game type ID
 * @returns {Promise<Object>} Delete result
 */
const removeAllPiecesFromGameType = async (gameTypeId) => {
  const result = await query(`
    DELETE FROM chessusnode.game_type_pieces WHERE game_type_id = ?
  `, [gameTypeId]);
  return result;
};

/**
 * Find article by ID
 * @param {number} articleId - Article ID
 * @returns {Promise<Object|null>} Article object or null
 */
const findArticleById = async (articleId) => {
  const result = await query("SELECT * FROM chessusnode.articles WHERE id = ?", [articleId]);
  return result.length > 0 ? result[0] : null;
};

/**
 * Get all articles/forums
 * @returns {Promise<Array>} Array of articles
 */
const getAllArticles = async () => {
  return await query("SELECT * FROM chessusnode.articles WHERE is_career IS NULL OR is_career = 0");
};

/**
 * Create a new forum post
 * @param {Object} forumData - Forum post data
 * @returns {Promise<Object>} Created forum object
 */
const createForum = async ({ author_id, title, content, created_at, game_type_id }) => {
  const result = await query(
    "INSERT INTO chessusnode.articles (author_id, title, content, created_at, game_type_id) VALUES (?,?,?,?,?)",
    [author_id, title, content, created_at, game_type_id || null]
  );
  const newArticleId = result.insertId;
  
  return { id: newArticleId, author_id, title, content, created_at, game_type_id };
};

/**
 * Update forum post
 * @param {Object} forumData - Forum data to update
 * @returns {Promise<Object>} Result of update
 */
const updateForum = async ({ title, content, last_updated_at, id }) => {
  return await query(
    "UPDATE chessusnode.articles SET title = ?, content = ?, last_updated_at = ? WHERE id = ?",
    [title, content, last_updated_at, id]
  );
};

/**
 * Delete forum post and related data
 * @param {number} id - Forum post ID
 * @returns {Promise<void>}
 */
const deleteForum = async (id) => {
  await query("DELETE FROM chessusnode.comments WHERE article_id = ?", [id]);
  await query("DELETE FROM chessusnode.likes WHERE article_id = ?", [id]);
  await query("DELETE FROM chessusnode.articles WHERE id = ?", [id]);
};

/**
 * Get comments by article ID
 * @param {number} articleId - Article ID
 * @returns {Promise<Array>} Array of comments
 */
const getCommentsByArticleId = async (articleId) => {
  return await query("SELECT * FROM chessusnode.comments WHERE article_id = ?", [articleId]);
};

/**
 * Get likes by article ID
 * @param {number} articleId - Article ID
 * @returns {Promise<Array>} Array of likes
 */
const getLikesByArticleId = async (articleId) => {
  return await query("SELECT * FROM chessusnode.likes WHERE article_id = ?", [articleId]);
};

/**
 * Create a new comment
 * @param {Object} commentData - Comment data
 * @returns {Promise<Object>} Created comment with ID
 */
const createComment = async ({ author_id, article_id, content, created_at, author_name, parent_id = null }) => {
  const result = await query(
    "INSERT INTO chessusnode.comments (author_id, article_id, content, created_at, last_updated_at, parent_id) VALUES (?,?,?,?,?,?)",
    [author_id, article_id, content, created_at, created_at, parent_id]
  );
  return {
    id: result.insertId,
    author_id,
    article_id,
    content,
    created_at,
    last_updated_at: created_at,
    author_name,
    parent_id
  };
};

/**
 * Update comment
 * @param {Object} commentData - Comment data to update
 * @returns {Promise<Object>} Updated comment data
 */
const updateComment = async ({ id, content, last_updated_at }) => {
  await query(
    "UPDATE chessusnode.comments SET content = ?, last_updated_at = ? WHERE id = ?",
    [content, last_updated_at, id]
  );
  return { id, content, last_updated_at };
};

/**
 * Delete comment
 * @param {number} id - Comment ID
 * @returns {Promise<Object>} Result of deletion
 */
const deleteComment = async (id) => {
  // Replies are deleted via ON DELETE CASCADE on parent_id FK
  return await query("DELETE FROM chessusnode.comments WHERE id = ?", [id]);
};

/**
 * Create a new like
 * @param {Object} likeData - Like data
 * @returns {Promise<Object>} Created like with ID
 */
const createLike = async ({ user_id, article_id }) => {
  const result = await query(
    "INSERT INTO chessusnode.likes (user_id, article_id, liked) VALUES (?,?,?)",
    [user_id, article_id, true]
  );
  return {
    id: result.insertId,
    user_id,
    article_id,
    liked: true
  };
};

/**
 * Delete like
 * @param {number} id - Like ID
 * @returns {Promise<Object>} Result of deletion
 */
const deleteLike = async (id) => {
  return await query("DELETE FROM chessusnode.likes WHERE id = ?", [id]);
};

/**
 * Get all news
 * @returns {Promise<Array>} Array of news items
 */
const getAllNews = async () => {
  return await query(`
    SELECT a.*, 
           u.username as author, 
           u.id as author_id,
           a.created_at as date_published,
           NULL as image_url,
           NULL as url,
           NULL as source_name
    FROM chessusnode.articles a
    LEFT JOIN chessusnode.users u ON a.author_id = u.id
    WHERE a.is_news = 1
    ORDER BY a.created_at DESC
  `);
};

/**
 * Update user's total donations
 * @param {string} email - User email
 * @param {number} amount - Donation amount to add
 * @returns {Promise<Object>} Update result
 */
const updateUserDonations = async (email, amount) => {
  const result = await query(
    "UPDATE chessusnode.users SET total_donations = COALESCE(total_donations, 0) + ? WHERE email = ?",
    [amount, email]
  );
  return result;
};

// ----------------------- Notifications ---------------------------

const createNotification = async ({ user_id, sender_id, type, title, content, related_id, action_url }) => {
  const result = await query(
    `INSERT INTO notifications (user_id, sender_id, type, title, content, related_id, action_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user_id, sender_id || null, type, title, content || null, related_id || null, action_url || null]
  );
  return { id: result.insertId, user_id, sender_id, type, title, content, related_id, action_url, is_read: 0, is_actioned: 0 };
};

const findUnreadNotification = async (userId, type, relatedId) => {
  const rows = await query(
    `SELECT * FROM notifications WHERE user_id = ? AND type = ? AND related_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 1`,
    [userId, type, relatedId]
  );
  return rows.length > 0 ? rows[0] : null;
};

const updateNotification = async (notificationId, { sender_id, title, content }) => {
  await query(
    `UPDATE notifications SET sender_id = ?, title = ?, content = ?, created_at = NOW() WHERE id = ?`,
    [sender_id || null, title, content || null, notificationId]
  );
};

const getNotificationsByUserId = async (userId, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const notifications = await query(
    `SELECT n.*, u.username as sender_username, u.profile_picture as sender_profile_picture
     FROM notifications n
     LEFT JOIN users u ON n.sender_id = u.id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return notifications;
};

const getUnreadNotificationCount = async (userId) => {
  const result = await query(
    "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
    [userId]
  );
  return result[0].count;
};

const markNotificationRead = async (notificationId, userId) => {
  await query(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
    [notificationId, userId]
  );
};

const markAllNotificationsRead = async (userId) => {
  await query(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
    [userId]
  );
};

const markNotificationActioned = async (notificationId, userId) => {
  await query(
    "UPDATE notifications SET is_actioned = 1, is_read = 1 WHERE id = ? AND user_id = ?",
    [notificationId, userId]
  );
};

const deleteNotification = async (notificationId, userId) => {
  await query(
    "DELETE FROM notifications WHERE id = ? AND user_id = ?",
    [notificationId, userId]
  );
};

const getWeeklyNotificationCounts = async (weekStart) => {
  const results = await query(
    `SELECT n.user_id, u.username, u.email, COUNT(*) as notification_count
     FROM notifications n
     JOIN users u ON n.user_id = u.id
     WHERE n.created_at >= ? AND u.email IS NOT NULL AND u.email != ''
     GROUP BY n.user_id
     HAVING notification_count > 10`,
    [weekStart]
  );
  return results;
};

const getNotificationSummaryForUser = async (userId, weekStart) => {
  const results = await query(
    `SELECT type, COUNT(*) as count FROM notifications
     WHERE user_id = ? AND created_at >= ?
     GROUP BY type`,
    [userId, weekStart]
  );
  return results;
};

const logNotificationEmail = async (userId, notificationCount, weekStart) => {
  await query(
    `INSERT INTO notification_email_log (user_id, notification_count, week_start) VALUES (?, ?, ?)`,
    [userId, notificationCount, weekStart]
  );
};

const hasEmailBeenSentForWeek = async (userId, weekStart) => {
  const result = await query(
    "SELECT COUNT(*) as count FROM notification_email_log WHERE user_id = ? AND week_start = ?",
    [userId, weekStart]
  );
  return result[0].count > 0;
};

// ----------------------- Direct Messages ---------------------------

const sendDirectMessage = async (senderId, recipientId, content) => {
  const result = await query(
    `INSERT INTO direct_messages (sender_id, recipient_id, content) VALUES (?, ?, ?)`,
    [senderId, recipientId, content]
  );
  const message = await query(
    `SELECT dm.*, u.username as sender_username, u.profile_picture as sender_profile_picture
     FROM direct_messages dm
     JOIN users u ON dm.sender_id = u.id
     WHERE dm.id = ?`,
    [result.insertId]
  );
  return message[0];
};

const getConversations = async (userId) => {
  const rows = await query(
    `SELECT 
       other_user.id as user_id,
       other_user.username,
       other_user.profile_picture,
       latest.content as last_message,
       latest.created_at as last_message_time,
       latest.sender_id as last_sender_id,
       COALESCE(unread.unread_count, 0) as unread_count
     FROM (
       SELECT 
         CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as other_id,
         MAX(id) as max_id
       FROM direct_messages
       WHERE sender_id = ? OR recipient_id = ?
       GROUP BY other_id
     ) conv
     JOIN direct_messages latest ON latest.id = conv.max_id
     JOIN users other_user ON other_user.id = conv.other_id
     LEFT JOIN (
       SELECT sender_id, COUNT(*) as unread_count
       FROM direct_messages
       WHERE recipient_id = ? AND is_read = 0
       GROUP BY sender_id
     ) unread ON unread.sender_id = conv.other_id
     ORDER BY latest.created_at DESC`,
    [userId, userId, userId, userId]
  );
  return rows;
};

const getDirectMessages = async (userId, otherUserId, page = 1, limit = 50) => {
  const offset = (page - 1) * limit;
  const messages = await query(
    `SELECT dm.*, u.username as sender_username, u.profile_picture as sender_profile_picture
     FROM direct_messages dm
     JOIN users u ON dm.sender_id = u.id
     WHERE (dm.sender_id = ? AND dm.recipient_id = ?) 
        OR (dm.sender_id = ? AND dm.recipient_id = ?)
     ORDER BY dm.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, otherUserId, otherUserId, userId, limit, offset]
  );
  return messages.reverse();
};

const markDirectMessagesRead = async (recipientId, senderId) => {
  await query(
    `UPDATE direct_messages SET is_read = 1 WHERE recipient_id = ? AND sender_id = ? AND is_read = 0`,
    [recipientId, senderId]
  );
};

const getUnreadDMCount = async (userId) => {
  const result = await query(
    "SELECT COUNT(*) as count FROM direct_messages WHERE recipient_id = ? AND is_read = 0",
    [userId]
  );
  return result[0].count;
};

const checkFriendship = async (userId, otherUserId) => {
  const rows = await query(
    `SELECT status FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted' LIMIT 1`,
    [userId, otherUserId]
  );
  return rows.length > 0;
};

// ----------------------- Game Chat ---------------------------

const saveGameChatMessages = async (gameId, messages) => {
  if (!messages || messages.length === 0) return;
  const values = messages.map(m => [gameId, m.senderId || null, m.senderUsername, m.content, m.timestamp ? new Date(m.timestamp) : new Date()]);
  await query(
    `INSERT INTO game_chat_messages (game_id, sender_id, sender_username, content, created_at) VALUES ?`,
    [values]
  );
};

const getGameChatMessages = async (gameId) => {
  const rows = await query(
    `SELECT * FROM game_chat_messages WHERE game_id = ? ORDER BY created_at ASC`,
    [gameId]
  );
  return rows;
};

module.exports = {
  query,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  getAllUsers,
  getAllPieces,
  getAllPiecesWithMovement,
  getPieceById,
  getAllGames,
  getGameById,
  getGameTypesByPieceId,
  getPiecesForGameType,
  addPieceToGameType,
  removeAllPiecesFromGameType,
  findArticleById,
  getAllArticles,
  createForum,
  updateForum,
  deleteForum,
  getCommentsByArticleId,
  getLikesByArticleId,
  createComment,
  updateComment,
  deleteComment,
  createLike,
  deleteLike,
  getAllNews,
  updateUserDonations,
  createNotification,
  findUnreadNotification,
  updateNotification,
  getNotificationsByUserId,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  markNotificationActioned,
  deleteNotification,
  getWeeklyNotificationCounts,
  getNotificationSummaryForUser,
  logNotificationEmail,
  hasEmailBeenSentForWeek,
  // Direct Messages
  sendDirectMessage,
  getConversations,
  getDirectMessages,
  markDirectMessagesRead,
  getUnreadDMCount,
  checkFriendship,
  // Game Chat
  saveGameChatMessages,
  getGameChatMessages,
};
