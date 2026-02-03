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
  await query(
    "INSERT INTO chessusnode.users (username, password, email) VALUES (?,?,?)",
    [username, hashedPassword, email]
  );
  return { username, password: hashedPassword, email };
};

/**
 * Update user profile
 * @param {Object} userData - User data to update
 * @param {number} id - User ID
 * @returns {Promise<Object>} Result of update
 */
const updateUser = async (userData, id) => {
  const { username, password, email, first_name, last_name, bio } = userData;
  
  if (password) {
    return await query(
      "UPDATE chessusnode.users SET username = ?, password = ?, email = ?, first_name = ?, last_name = ?, bio = ? WHERE id = ?",
      [username, password, email, first_name, last_name, bio, id]
    );
  } else {
    return await query(
      "UPDATE chessusnode.users SET username = ?, email = ?, first_name = ?, last_name = ?, bio = ? WHERE id = ?",
      [username, email, first_name, last_name, bio, id]
    );
  }
};

/**
 * Delete user by username
 * @param {string} username - Username
 * @returns {Promise<Object>} Result of deletion
 */
const deleteUser = async (username) => {
  return await query("DELETE FROM chessusnode.users WHERE username = ?", [username]);
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
      u.username as creator_username,
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
      p.game_type_id,
      u.username as creator_username,
      u.id as creator_user_id,
      gt.game_name as game_type_name,
      -- Movement data from piece_movement table
      pm.directional_movement_style,
      pm.up_movement,
      pm.down_movement,
      pm.left_movement,
      pm.right_movement,
      pm.up_left_movement,
      pm.up_right_movement,
      pm.down_left_movement,
      pm.down_right_movement,
      pm.ratio_movement_style,
      pm.ratio_one_movement,
      pm.ratio_two_movement,
      pm.step_by_step_movement_style,
      pm.step_by_step_movement_value,
      pm.can_hop_over_allies,
      pm.can_hop_over_enemies,
      -- Capture data from piece_capture table
      pc.can_capture_enemy_on_move,
      pc.up_capture,
      pc.down_capture,
      pc.left_capture,
      pc.right_capture,
      pc.up_left_capture,
      pc.up_right_capture,
      pc.down_left_capture,
      pc.down_right_capture,
      pc.ratio_one_capture,
      pc.ratio_two_capture,
      pc.step_by_step_capture
    FROM chessusnode.pieces p
    LEFT JOIN chessusnode.piece_movement pm ON p.id = pm.piece_id
    LEFT JOIN chessusnode.piece_capture pc ON p.id = pc.piece_id
    LEFT JOIN chessusnode.users u ON p.creator_id = u.id
    LEFT JOIN chessusnode.game_types gt ON p.game_type_id = gt.id
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
      p.game_type_id,
      p.can_promote,
      p.promotion_options,
      u.username as creator_username, 
      u.id as creator_user_id, 
      gt.game_name as game_type_name,
      -- Movement data from piece_movement table
      pm.directional_movement_style,
      pm.repeating_movement,
      pm.first_move_only,
      pm.max_directional_movement_iterations,
      pm.min_directional_movement_iterations,
      pm.up_movement,
      pm.down_movement,
      pm.left_movement,
      pm.right_movement,
      pm.up_left_movement,
      pm.up_right_movement,
      pm.down_left_movement,
      pm.down_right_movement,
      pm.ratio_movement_style,
      pm.ratio_one_movement,
      pm.ratio_two_movement,
      pm.repeating_ratio,
      pm.max_ratio_iterations,
      pm.min_ratio_iterations,
      pm.step_by_step_movement_style,
      pm.step_by_step_movement_value,
      pm.can_hop_over_allies,
      pm.can_hop_over_enemies,
      pm.min_turns_per_move,
      pm.max_turns_per_move,
      pm.available_for_moves,
      pm.special_scenario_moves,
      -- Capture data from piece_capture table
      pc.can_capture_enemy_via_range,
      pc.can_capture_ally_via_range,
      pc.can_capture_enemy_on_move,
      pc.can_capture_ally_on_range,
      pc.can_attack_on_iteration,
      pc.first_move_only_capture,
      pc.up_capture,
      pc.down_capture,
      pc.left_capture,
      pc.right_capture,
      pc.up_left_capture,
      pc.up_right_capture,
      pc.down_left_capture,
      pc.down_right_capture,
      pc.ratio_one_capture,
      pc.ratio_two_capture,
      pc.step_by_step_capture,
      pc.up_left_attack_range,
      pc.up_attack_range,
      pc.up_right_attack_range,
      pc.right_attack_range,
      pc.down_right_attack_range,
      pc.down_attack_range,
      pc.down_left_attack_range,
      pc.left_attack_range,
      pc.repeating_directional_ranged_attack,
      pc.max_directional_ranged_attack_iterations,
      pc.min_directional_ranged_attack_iterations,
      pc.ratio_one_attack_range,
      pc.ratio_two_attack_range,
      pc.repeating_ratio_ranged_attack,
      pc.max_ratio_ranged_attack_iterations,
      pc.min_ratio_ranged_attack_iterations,
      pc.step_by_step_attack_style,
      pc.step_by_step_attack_value,
      pc.max_piece_captures_per_move,
      pc.max_piece_captures_per_ranged_attack,
      pc.special_scenario_captures,
      p.has_checkmate_rule,
      p.has_check_rule,
      p.has_lose_on_capture_rule
    FROM chessusnode.pieces p
    LEFT JOIN chessusnode.piece_movement pm ON p.id = pm.piece_id
    LEFT JOIN chessusnode.piece_capture pc ON p.id = pc.piece_id
    LEFT JOIN chessusnode.users u ON p.creator_id = u.id
    LEFT JOIN chessusnode.game_types gt ON p.game_type_id = gt.id
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
    SELECT gt.*, u.username as creator_username, u.id as creator_user_id
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
    SELECT gt.*, u.username as creator_username, u.id as creator_user_id
    FROM chessusnode.game_types gt
    LEFT JOIN chessusnode.users u ON gt.creator_id = u.id
    WHERE gt.id = ?
  `, [gameId]);
  return result.length > 0 ? result[0] : null;
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
const createComment = async ({ author_id, article_id, content, created_at, author_name }) => {
  const result = await query(
    "INSERT INTO chessusnode.comments (author_id, article_id, content, created_at, last_updated_at) VALUES (?,?,?,?,?)",
    [author_id, article_id, content, created_at, created_at]
  );
  return {
    id: result.insertId,
    author_id,
    article_id,
    content,
    created_at,
    last_updated_at: created_at,
    author_name
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
};
