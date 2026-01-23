require("dotenv").config();

//  Constants

const express = require("express");
const path = require("path");

// const mysql = require("mysql");

const fs = require("fs");

const cors = require("cors");

const jwt = require("jsonwebtoken");

const bcrypt = require("bcrypt");

//  Express

const PORT = process.env.PORT || 3001;

const app = express();

// Some day I will set up a router to change this /api crap, but today is not that day.
// const router = express.Router();
// router.post('/login', app.login());

//app.use("/api", "*");

const corsOptions = {
  origin: ['http://squarestrat.com', 'https://squarestrat.com', 'http://localhost:3000', 'http://localhost:3001'], // Specify allowed origins
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Allow sending cookies/authorization headers
  optionsSuccessStatus: 204, // Some legacy browsers require 204 for preflight success
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
};

app.use(cors(corsOptions));

// Additional middleware to handle Private Network Access
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

// const path = require('path');
const db_pool = require("../configs/db");
const dbHelpers = require("./db-helpers");

app.use(express.json());

// Serve static files from uploads directory with CORS headers
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../uploads')));

// Configure multer for file uploads
const multer = require('multer');

// Configure multer for piece image uploads
const pieceStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/pieces');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'piece-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const pieceUpload = multer({ 
  storage: pieceStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Configure multer for profile picture uploads
const profilePictureStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/profile-pictures');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const profilePictureUpload = multer({ 
  storage: profilePictureStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

//  -----------  Auto-create Tables and Run Migrations on Startup -----------------

const { runMigrations } = require("./migrations");

// Run migrations to add any missing columns
runMigrations().catch(err => {
  console.error("Migration error:", err);
});

//  -----------  End Auto-create Tables -----------------

//  ----------------- End of seeding/tables ----------------------



// Have Node serve the files for our built React app
// app.use(express.static(path.resolve(__dirname, '../chessus-frontend/public')));



//  ------------------ Routes --------------------------

app.get("/api/api", (req, res) => {
  res.json({ message: "Hello from server!" });
});

app.get("/api/", (req, res) => {
  res.json({ message: "Home page!" });
})

app.get("/api/user", async (params, res) => {
  try {
    const username = params.query.username;
    const user = await dbHelpers.findUserByUsername(username);
    
    if (!user) {
      return res.status(400).send({ auth: false, message: "Username does not exist" });
    }
    
    res.json({ result: user, message: "User found" });
  } catch (err) {
    console.error("Error in /api/user:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await dbHelpers.getAllUsers();
    res.json(users);
  } catch (err) {
    console.error("Error in /api/users:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/pieces", async (req, res) => {
  try {
    const pieces = await dbHelpers.getAllPieces();
    res.json(pieces);
  } catch (err) {
    console.error("Error in /api/pieces:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get single piece by ID
app.get("/api/pieces/:pieceId", async (req, res) => {
  try {
    const { pieceId } = req.params;
    const piece = await dbHelpers.getPieceById(pieceId);
    if (!piece) {
      return res.status(404).send({ message: "Piece not found" });
    }
    res.json(piece);
  } catch (err) {
    console.error("Error in /api/pieces/:pieceId:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/games", async (req, res) => {
  try {
    const games = await dbHelpers.getAllGames();
    res.json(games);
  } catch (err) {
    console.error("Error in /api/games:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get single game by ID
app.get("/api/games/:gameId", async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await dbHelpers.getGameById(gameId);
    
    if (!game) {
      return res.status(404).send({ message: "Game not found" });
    }
    
    res.json(game);
  } catch (err) {
    console.error("Error in GET /api/games/:gameId:", err);
    res.status(500).send({ err: err.message });
  }
});

// Update game by ID
app.put("/api/games/:gameId", authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const gameData = req.body;
    const userId = req.user.id;
    
    // Check if game exists
    const existingGame = await dbHelpers.getGameById(gameId);
    if (!existingGame) {
      return res.status(404).send({ message: "Game not found" });
    }
    
    // Verify ownership
    if (existingGame.creator_id !== userId) {
      return res.status(403).send({ message: "You can only edit your own games" });
    }
    
    // Build the SQL query for updating
    const sql = `
      UPDATE game_types SET
        game_name = ?, descript = ?, rules = ?,
        mate_condition = ?, mate_piece = ?, capture_condition = ?, capture_piece = ?,
        value_condition = ?, value_piece = ?, value_max = ?, value_title = ?,
        squares_condition = ?, squares_count = ?, hill_condition = ?, hill_x = ?, hill_y = ?, hill_turns = ?,
        actions_per_turn = ?, board_width = ?, board_height = ?, player_count = ?,
        starting_piece_count = ?, pieces_string = ?, range_squares_string = ?,
        promotion_squares_string = ?, special_squares_string = ?,
        randomized_starting_positions = ?, other_game_data = ?, optional_condition = ?
      WHERE id = ?
    `;
    
    const values = [
      gameData.game_name,
      gameData.descript,
      gameData.rules,
      gameData.mate_condition || false,
      gameData.mate_piece || null,
      gameData.capture_condition || false,
      gameData.capture_piece || null,
      gameData.value_condition || false,
      gameData.value_piece || null,
      gameData.value_max || null,
      gameData.value_title || null,
      gameData.squares_condition || false,
      gameData.squares_count || null,
      gameData.hill_condition || false,
      gameData.hill_x || null,
      gameData.hill_y || null,
      gameData.hill_turns || null,
      gameData.actions_per_turn || 1,
      gameData.board_width || 8,
      gameData.board_height || 8,
      gameData.player_count || 2,
      gameData.starting_piece_count || 0,
      gameData.pieces_string || "[]",
      gameData.range_squares_string || null,
      gameData.promotion_squares_string || null,
      gameData.special_squares_string || null,
      gameData.randomized_starting_positions || null,
      gameData.other_game_data || null,
      gameData.optional_condition || null,
      gameId
    ];
    
    await db_pool.query(sql, values);
    
    res.json({ 
      message: "Game updated successfully",
      game: { id: gameId, ...gameData }
    });
  } catch (err) {
    console.error("Error in PUT /api/games/:gameId:", err);
    res.status(500).send({ message: "Failed to update game", err: err.message });
  }
});

// Delete game by ID
app.delete("/api/games/:gameId", authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;
    
    // Check if game exists
    const existingGame = await dbHelpers.getGameById(gameId);
    if (!existingGame) {
      return res.status(404).send({ message: "Game not found" });
    }
    
    // Verify ownership
    if (existingGame.creator_id !== userId) {
      return res.status(403).send({ message: "You can only delete your own games" });
    }
    
    // Delete associated forum posts first
    await db_pool.query("DELETE FROM articles WHERE game_type_id = ?", [gameId]);
    
    // Delete the game
    await db_pool.query("DELETE FROM game_types WHERE id = ?", [gameId]);
    
    res.json({ message: "Game deleted successfully" });
  } catch (err) {
    console.error("Error in DELETE /api/games/:gameId:", err);
    res.status(500).send({ message: "Failed to delete game", err: err.message });
  }
});

// app.post("/api/users", (req, res) => {

// })

app.post("/api/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || username.length === 0) {
      return res.status(500).send({ message: "Username cannot be blank" });
    }

    // Check if username already exists
    const existingUser = await dbHelpers.findUserByUsername(username);
    if (existingUser) {
      return res.status(500).send({ message: "Username already exists" });
    }

    // Check if email already taken
    const existingEmail = await dbHelpers.findUserByEmail(email);
    if (existingEmail) {
      return res.status(500).send({ message: "Email already taken" });
    }

    // Create new user
    const salt = bcrypt.genSaltSync();
    const hashedPassword = bcrypt.hashSync(password, salt);
    const user = await dbHelpers.createUser(username, hashedPassword, email);
    
    res.status(201).send(user);
  } catch (err) {
    console.error("Error in /api/register:", err);
    res.status(500).send({ message: "Registration failed", err: err.message });
  }
});

app.post("/api/profile/edit", async (req, res) => {
  try {
    const { username, current_user, password, oldPassword, bio, email, first_name, last_name, id } = req.body;
    const logged_in_username = current_user.username;
    const logged_in_email = current_user.email;

    console.log("in the edit backend");
    console.log("username: " + username + " id: " + id);
    console.log("previous username: " + logged_in_username);
    console.log("the password is still " + password);

    // Verify the user exists
    const currentUser = await dbHelpers.findUserByUsername(logged_in_username);
    if (!currentUser) {
      return res.status(404).send({ message: "User no longer exists" });
    }

    // Check if new username is already taken by another user
    const usernameCheck = await dbHelpers.findUserByUsername(username);
    if (usernameCheck && usernameCheck.username !== logged_in_username) {
      return res.status(500).send({ message: "Username already taken" });
    }

    // Check username length
    if (!username || username.length < 1) {
      return res.status(500).send({ message: "Username must be between 1 and 20 characters" });
    }

    // Check if new email is already taken by another user
    const emailCheck = await dbHelpers.findUserByEmail(email);
    if (emailCheck && emailCheck.email !== logged_in_email) {
      return res.status(500).send({ message: "Email already taken" });
    }

    // Prepare user data
    let updatedUser = {
      username,
      email,
      first_name,
      last_name,
      bio,
      id
    };

    // Hash password if provided
    if (password && password.length > 0) {
      // Require old password verification for non-admin users
      if (current_user.role !== "Admin") {
        if (!oldPassword) {
          return res.status(400).send({ message: "Current password is required to change password" });
        }
        
        // Verify the old password
        const passwordMatch = bcrypt.compareSync(oldPassword, currentUser.password);
        if (!passwordMatch) {
          return res.status(400).send({ message: "Current password is incorrect" });
        }
      }
      
      const salt = bcrypt.genSaltSync();
      const hashedPassword = bcrypt.hashSync(password, salt);
      updatedUser.password = hashedPassword;
      console.log("about to attempt update on id of: " + id + " WITH a password change");
    } else {
      console.log("about to attempt update on id of: " + id + " with no password change");
    }

    // Update user in database
    await dbHelpers.updateUser(updatedUser, id);

    // Return updated user (without password in response)
    const responseUser = { ...currentUser, ...updatedUser };
    delete responseUser.password;
    
    res.json({ auth: true, result: responseUser, message: "User successfully updated" });
  } catch (err) {
    console.error("Error in /api/profile/edit:", err);
    res.status(500).send({ message: "Update failed", err: err.message });
  }
});

app.post("/api/profile/upload-picture", profilePictureUpload.single('profile_picture'), async (req, res) => {
  try {
    const userId = req.body.user_id;
    const imageFile = req.file;

    if (!imageFile) {
      return res.status(400).send({ message: "Profile picture is required" });
    }

    if (!userId) {
      return res.status(400).send({ message: "User ID is required" });
    }

    // Get user's current profile picture before updating
    const currentUser = await dbHelpers.findUserById(userId);
    const oldPicturePath = currentUser?.profile_picture;

    // Store relative path for database
    const imagePath = `/uploads/profile-pictures/${imageFile.filename}`;

    // Update user's profile picture in database
    await db_pool.query(
      "UPDATE chessusnode.users SET profile_picture = ? WHERE id = ?",
      [imagePath, userId]
    );

    // Delete old profile picture if it exists
    if (oldPicturePath) {
      const oldFilePath = path.join(__dirname, '..', oldPicturePath);
      fs.unlink(oldFilePath, (err) => {
        if (err) {
          console.error("Error deleting old profile picture:", err);
          // Don't fail the request if deletion fails
        } else {
          console.log("Deleted old profile picture:", oldFilePath);
        }
      });
    }

    // Fetch and return the updated user
    const updatedUser = await dbHelpers.findUserById(userId);
    if (updatedUser) {
      delete updatedUser.password; // Don't send password to client
    }

    res.json({ 
      success: true, 
      profile_picture: imagePath,
      user: updatedUser,
      message: "Profile picture uploaded successfully" 
    });
  } catch (err) {
    console.error("Error uploading profile picture:", err);
    res.status(500).send({ message: "Upload failed", err: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find user
    const user = await dbHelpers.findUserByUsername(username);
    if (!user) {
      console.log("username does not exist");
      return res.status(400).send({ auth: false, message: "Username does not exist" });
    }

    // Compare passwords
    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(400).send({ auth: false, message: "Incorrect password" });
    }

    // Generate tokens
    const userPayload = { id: user.id, username: user.username, role: user.role };
    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload);
    
    // Store refresh token in database (ignore error if column doesn't exist yet)
    try {
      await db_pool.query(
        "UPDATE users SET refresh_token = ? WHERE id = ?",
        [refreshToken, user.id]
      );
    } catch (dbErr) {
      console.warn("Could not store refresh token (column may not exist yet):", dbErr.message);
    }
    
    user.accessToken = accessToken;
    user.refreshToken = refreshToken;
    delete user.password; // Don't send password to client
    delete user.refresh_token; // Don't expose the stored token
    
    res.json({ auth: true, result: user });
  } catch (err) {
    console.error("Error in /api/login:", err);
    res.status(500).send({ auth: false, message: "Login failed", err: err.message });
  }
});

app.post("/api/logout", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Clear refresh token from database
    await db_pool.query(
      "UPDATE users SET refresh_token = NULL WHERE id = ?",
      [userId]
    );
    
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Error in /api/logout:", err);
    res.status(500).send({ message: "Logout failed", err: err.message });
  }
});

app.post("/api/delete", async (req, res) => {
  try {
    const { username, admin_id } = req.body;
    console.log("attempting to delete user with username " + username);
    if (admin_id) {
      console.log("admin with id of " + admin_id + " attempting deletion of user");
    }
    
    await dbHelpers.deleteUser(username);
    res.json({ message: "Account deleted" });
  } catch (err) {
    console.error("Error in /api/delete:", err);
    res.status(500).send({ message: "Deletion failed", err: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  res.status(200).json({ message: "Logged out successfully" });
});

app.post("/api/preferences/colors", async (req, res) => {
  try {
    const { user_id, light_square_color, dark_square_color } = req.body;
    
    if (!user_id) {
      return res.status(400).send({ message: "User ID is required" });
    }
    
    const sql = "UPDATE chessusnode.users SET light_square_color = ?, dark_square_color = ? WHERE id = ?";
    await dbHelpers.query(sql, [light_square_color, dark_square_color, user_id]);
    
    res.json({ 
      message: "Preferences saved successfully",
      light_square_color,
      dark_square_color
    });
  } catch (err) {
    console.error("Error in /api/preferences/colors:", err);
    res.status(500).send({ message: "Failed to save preferences", err: err.message });
  }
});

const posts = [{
  username: 'NewAccount',
  title: "Post 1"
},
{
  username: "NewAccount2",
  title: "Post 2"
}]

// app.get('/api/posts', authenticateToken, (req, res) => {
//   res.json(posts.filter(post => post.username === req.user.username))
// })

//  ---------------------- Forums ---------------------------------

app.post("/api/articles/new", async (req, res) => {
  try {
    const { title, genre, content, created_at, author_id, game_type_id, public_setting, description } = req.body;
    
    const article = {
      game_type_id,
      author_id,
      title,
      description,
      content,
      created_at,
      genre,
      public: public_setting
    };

    await dbHelpers.query(
      "INSERT INTO chessusnode.articles (game_type_id, author_id, title, descript, content, created_at, genre, public) VALUES (?,?,?,?,?,?,?,?)",
      [game_type_id, author_id, title, description, content, created_at, genre, public_setting]
    );
    
    res.status(201).send(article);
  } catch (err) {
    console.error("Error in /api/articles/new:", err);
    res.status(500).send({ message: "Article creation failed", err: err.message });
  }
});

app.get('/api/articles', (req, res) => {
  db_pool.query("SELECT * FROM chessusnode.articles"), (err, result) => {
    if (err) {
      res.send({ err: err});
    }
    let forums = result;
    res.json(result);
  }
})

app.get("/api/article", async (params, res) => {
  try {
    const article_id = params.query.article_id;
    const article = await dbHelpers.findArticleById(article_id);
    
    if (!article) {
      return res.status(400).send({ auth: false, message: "Article does not exist" });
    }
    
    res.json({ result: article, message: "Article found" });
  } catch (err) {
    console.error("Error in /api/article:", err);
    res.status(500).send({ err: err.message });
  }
});

//  ---------------------- Forums ---------------------------------

app.post("/api/forums/new", async (req, res) => {
  try {
    const { title, content, created_at, author_id } = req.body;
    console.log(content);
    
    const forum = await dbHelpers.createForum({ author_id, title, content, created_at });
    res.json({ result: forum });
  } catch (err) {
    console.error("Error in /api/forums/new:", err);
    res.status(500).send({ message: "Forum creation failed", err: err.message });
  }
});

app.get("/api/forums", async (req, res) => {
  try {
    const articles = await dbHelpers.getAllArticles();
    
    // Enrich each forum with author name, comment count, and likes
    const forums = await Promise.all(articles.map(async (forum) => {
      // Get comment count
      const comments = await dbHelpers.getCommentsByArticleId(forum.id);
      forum.comment_count = comments.length;
      
      // Get likes
      const likes = await dbHelpers.getLikesByArticleId(forum.id);
      forum.likes = likes;
      
      // Get author name
      const author = await dbHelpers.findUserById(forum.author_id);
      forum.author_name = author ? author.username : "User Deleted";
      
      return forum;
    }));
    
    console.log("in get all forums route. Forums: " + forums.length);
    res.json(forums);
  } catch (err) {
    console.error("Error in /api/forums:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/forum", async (params, res) => {
  try {
    console.log("in get forum route");
    const forum_id = params.query.forum_id;
    console.log("forum id: " + forum_id);
    
    const forum = await dbHelpers.findArticleById(forum_id);
    if (!forum) {
      return res.status(400).send({ auth: false, message: "Forum post does not exist" });
    }

    // Get author name
    if (forum.author_id) {
      const author = await dbHelpers.findUserById(forum.author_id);
      forum.author_name = author ? author.username : "User Deleted";
    } else {
      forum.author_name = "User Deleted";
    }

    // Get likes
    const likes = await dbHelpers.getLikesByArticleId(forum_id);
    forum.likes = likes;

    // Get all comments
    const comments = await dbHelpers.getCommentsByArticleId(forum.id);
    console.log("got the comments");
    console.log(comments);

    // Get author names for all comments
    if (comments.length > 0) {
      const enrichedComments = await Promise.all(comments.map(async (comment) => {
        const commentAuthor = await dbHelpers.findUserById(comment.author_id);
        comment.author_name = commentAuthor ? commentAuthor.username : "User Deleted";
        return comment;
      }));
      forum.comments = enrichedComments;
    }

    console.log("Forum before json send: " + forum);
    res.json({ result: forum, message: "Forum found" });
  } catch (err) {
    console.error("Error in /api/forum:", err);
    res.status(500).send({ err: err.message });
  }
});

app.put("/api/forums/edit", async (req, res) => {
  try {
    const { title, id, content, last_updated_at } = req.body;
    console.log(content);
    console.log("in edit forum route");
    
    await dbHelpers.updateForum({ title, content, last_updated_at, id });
    
    const forum = { title, content, last_updated_at, id };
    console.log("forum: " + forum.title + "content: " + forum.content + "last updated: " + forum.last_updated_at + ", id: " + id);
    res.json({ result: forum });
  } catch (err) {
    console.error("Error in /api/forums/edit:", err);
    res.status(500).send({ message: "Forum edit failed", err: err.message });
  }
});

app.post("/api/forums/delete", async (req, res) => {
  try {
    console.log("in delete post route");
    console.log(req.body);
    const id = req.body.id;
    console.log(id);
    
    await dbHelpers.deleteForum(id);
    console.log("post deleted");
    res.json({ message: "Post deleted" });
  } catch (err) {
    console.error("Error in /api/forums/delete:", err);
    res.status(500).send({ message: "Forum deletion failed", err: err.message });
  }
});




// ----------------------- Comments ---------------------------


app.post("/api/comments/new", async (req, res) => {
  try {
    const { author_id, forum_id, content, created_at, author_name } = req.body;
    
    const comment = await dbHelpers.createComment({
      author_id,
      article_id: forum_id,
      content,
      created_at,
      author_name
    });
    
    res.json({ result: comment });
  } catch (err) {
    console.error("Error in /api/comments/new:", err);
    res.status(500).send({ message: "Comment creation failed", err: err.message });
  }
});

app.post("/api/delete-comment", async (req, res) => {
  try {
    console.log("in delete comment route");
    const id = req.body.id;
    
    await dbHelpers.deleteComment(id);
    res.json({ message: "Comment deleted" });
  } catch (err) {
    console.error("Error in /api/delete-comment:", err);
    res.status(500).send({ message: "Comment deletion failed", err: err.message });
  }
});

app.put("/api/comments/edit", async (req, res) => {
  try {
    const { id, content, last_updated_at } = req.body;
    
    const comment_update = await dbHelpers.updateComment({ id, content, last_updated_at });
    res.json({ result: comment_update });
  } catch (err) {
    console.error("Error in /api/comments/edit:", err);
    res.status(500).send({ message: "Comment edit failed", err: err.message });
  }
});



// ----------------------- Likes ----------------------------

app.post("/api/likes/new", async (req, res) => {
  try {
    const { user_id, article_id } = req.body;
    
    const like = await dbHelpers.createLike({ user_id, article_id });
    res.json({ result: like });
  } catch (err) {
    console.error("Error in /api/likes/new:", err);
    res.status(500).send({ message: "Like creation failed", err: err.message });
  }
});

app.post("/api/likes/delete", async (req, res) => {
  try {
    console.log("in delete likes route");
    const id = req.body.id;
    
    await dbHelpers.deleteLike(id);
    res.json({ message: "Like deleted" });
  } catch (err) {
    console.error("Error in /api/likes/delete:", err);
    res.status(500).send({ message: "Like deletion failed", err: err.message });
  }
});


//  ---------------------- News ------------------------------

app.post("/api/news/new", async (req, res) => {
  const author = req.body.author;
  const article_id = req.body.article_id;
  const liked = true;
  db_pool.query("INSERT INTO chessusnode.news (user_id, article_id, liked) VALUES (?,?,?)",
    [user_id, article_id, liked],
    (err, result) => {
      if (err) {
        res.send({ err: err});
      }
      let news;
      news = { id: result.insertId, user_id: user_id, article_id: article_id, liked: liked}
      console.log(result);
      res.json({result: news });
    }
  );
});


app.get("/api/news", async (req, res) => {
  try {
    const news = await dbHelpers.getAllNews();
    
    if (news.length > 0) {
      console.log("In get news route");
      res.json({ news });
    } else {
      res.json({ message: "No news to be found" });
    }
  } catch (err) {
    console.error("Error in /api/news:", err);
    res.status(500).send({ err: err.message });
  }
});

//  ---------------------- Token -----------------------------

app.post('/api/token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).send({ message: "Refresh token required" });
    }

    // Verify the refresh token
    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, async (err, user) => {
      if (err) {
        return res.status(403).send({ message: "Invalid refresh token" });
      }

      // Check if refresh token exists in database
      const [users] = await db_pool.query(
        "SELECT id, username, role, refresh_token FROM users WHERE id = ?",
        [user.id]
      );

      if (users.length === 0 || users[0].refresh_token !== refreshToken) {
        return res.status(403).send({ message: "Refresh token not found or revoked" });
      }

      // Generate new access token
      const userPayload = { id: user.id, username: user.username, role: user.role };
      const accessToken = generateAccessToken(userPayload);

      res.json({ accessToken });
    });
  } catch (err) {
    console.error("Error in /api/token:", err);
    res.status(500).send({ message: "Token refresh failed", err: err.message });
  }
})

// ----------------------- Games/Game Types ------------------------------

app.post("/api/games/create", authenticateToken, async (req, res) => {
  try {
    const gameData = req.body;
    const creator_id = gameData.creator_id;

    // Validate required fields
    if (!gameData.game_name || gameData.game_name.length < 3) {
      return res.status(400).send({ message: "Game name must be at least 3 characters" });
    }

    if (!gameData.descript || gameData.descript.length < 50) {
      return res.status(400).send({ message: "Description must be at least 50 characters" });
    }

    if (!gameData.rules || gameData.rules.length === 0) {
      return res.status(400).send({ message: "Rules are required" });
    }

    // Build the SQL query
    const sql = `
      INSERT INTO game_types (
        creator_id, game_name, descript, rules,
        mate_condition, mate_piece, capture_condition, capture_piece,
        value_condition, value_piece, value_max, value_title,
        squares_condition, squares_count, hill_condition, hill_x, hill_y, hill_turns,
        actions_per_turn, board_width, board_height, player_count,
        starting_piece_count, pieces_string, range_squares_string,
        promotion_squares_string, special_squares_string,
        randomized_starting_positions, other_game_data, optional_condition
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      creator_id,
      gameData.game_name,
      gameData.descript,
      gameData.rules,
      gameData.mate_condition || false,
      gameData.mate_piece || null,
      gameData.capture_condition || false,
      gameData.capture_piece || null,
      gameData.value_condition || false,
      gameData.value_piece || null,
      gameData.value_max || null,
      gameData.value_title || null,
      gameData.squares_condition || false,
      gameData.squares_count || null,
      gameData.hill_condition || false,
      gameData.hill_x || null,
      gameData.hill_y || null,
      gameData.hill_turns || null,
      gameData.actions_per_turn || 1,
      gameData.board_width || 8,
      gameData.board_height || 8,
      gameData.player_count || 2,
      gameData.starting_piece_count || 0,
      gameData.pieces_string || "[]",
      gameData.range_squares_string || null,
      gameData.promotion_squares_string || null,
      gameData.special_squares_string || null,
      gameData.randomized_starting_positions || null,
      gameData.other_game_data || null,
      gameData.optional_condition || null
    ];

    const [result] = await db_pool.query(sql, values);
    
    const gameId = result.insertId;
    
    // Automatically create a forum for this game
    const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const forumTitle = `${gameData.game_name} - Discussion`;
    const forumContent = `Welcome to the ${gameData.game_name} discussion forum! Share strategies, ask questions, and connect with other players of this game.\n\n${gameData.descript}`;
    
    const forumSql = `
      INSERT INTO articles (author_id, game_type_id, title, content, created_at, public)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    await db_pool.query(forumSql, [creator_id, gameId, forumTitle, forumContent, currentTime, true]);

    res.status(201).send({
      message: "Game created successfully!",
      result: {
        id: result.insertId,
        game_name: gameData.game_name
      }
    });

  } catch (err) {
    console.error("Error in /api/games/create:", err);
    res.status(500).send({ message: "Failed to create game", err: err.message });
  }
});

// ----------------------- Pieces Create ------------------------------

app.post("/api/pieces/create", pieceUpload.array('piece_images', 8), async (req, res) => {
  try {
    const pieceData = req.body;
    const imageFiles = req.files;

    if (!imageFiles || imageFiles.length === 0) {
      return res.status(400).send({ message: "At least one piece image is required" });
    }

    const imagePaths = imageFiles.map(file => `/uploads/pieces/${file.filename}`);
    const imagesJSON = JSON.stringify(imagePaths);

    // Insert into pieces table (basic info only)
    const pieceSql = `
      INSERT INTO pieces (
        piece_name, image_location, piece_width, piece_height, creator_id, piece_description
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    const pieceValues = [
      pieceData.piece_name,
      imagesJSON,
      parseInt(pieceData.piece_width) || 1,
      parseInt(pieceData.piece_height) || 1,
      parseInt(pieceData.creator_id) || null,
      pieceData.piece_description || null
    ];

    const [result] = await db_pool.query(pieceSql, pieceValues);
    const pieceId = result.insertId;

    // Insert into piece_movement table
    const movementSql = `
      INSERT INTO piece_movement (
        piece_id,
        directional_movement_style,
        repeating_movement,
        max_directional_movement_iterations,
        min_directional_movement_iterations,
        up_left_movement, up_movement, up_right_movement,
        right_movement, down_right_movement, down_movement, down_left_movement, left_movement,
        ratio_movement_style, ratio_one_movement, ratio_two_movement,
        repeating_ratio,
        max_ratio_iterations,
        min_ratio_iterations,
        step_by_step_movement_style, step_by_step_movement_value,
        can_hop_over_allies, can_hop_over_enemies,
        min_turns_per_move,
        max_turns_per_move,
        special_scenario_moves
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const movementValues = [
      pieceId,
      pieceData.directional_movement_style === 'true',
      pieceData.repeating_movement === 'true',
      parseInt(pieceData.max_directional_movement_iterations) || null,
      parseInt(pieceData.min_directional_movement_iterations) || null,
      parseInt(pieceData.up_left_movement) || 0,
      parseInt(pieceData.up_movement) || 0,
      parseInt(pieceData.up_right_movement) || 0,
      parseInt(pieceData.right_movement) || 0,
      parseInt(pieceData.down_right_movement) || 0,
      parseInt(pieceData.down_movement) || 0,
      parseInt(pieceData.down_left_movement) || 0,
      parseInt(pieceData.left_movement) || 0,
      pieceData.ratio_movement_style === 'true',
      parseInt(pieceData.ratio_one_movement) || null,
      parseInt(pieceData.ratio_two_movement) || null,
      pieceData.repeating_ratio === 'true',
      parseInt(pieceData.max_ratio_iterations) || null,
      parseInt(pieceData.min_ratio_iterations) || null,
      pieceData.step_by_step_movement_style === 'true',
      parseInt(pieceData.step_by_step_movement_value) || null,
      pieceData.can_hop_over_allies === 'true',
      pieceData.can_hop_over_enemies === 'true',
      parseInt(pieceData.min_turns_per_move) || null,
      parseInt(pieceData.max_turns_per_move) || null,
      pieceData.special_scenario_movement || null
    ];

    await db_pool.query(movementSql, movementValues);

    // Insert into piece_capture table
    const captureSql = `
      INSERT INTO piece_capture (
        piece_id,
        can_capture_enemy_via_range,
        can_capture_ally_via_range,
        can_capture_enemy_on_move,
        can_capture_ally_on_range,
        can_attack_on_iteration,
        up_left_capture, up_capture, up_right_capture,
        right_capture, down_right_capture, down_capture, down_left_capture, left_capture,
        ratio_one_capture, ratio_two_capture, step_by_step_capture,
        up_left_attack_range, up_attack_range, up_right_attack_range,
        right_attack_range, down_right_attack_range, down_attack_range, down_left_attack_range, left_attack_range,
        repeating_directional_ranged_attack,
        max_directional_ranged_attack_iterations,
        min_directional_ranged_attack_iterations,
        ratio_one_attack_range, ratio_two_attack_range,
        repeating_ratio_ranged_attack,
        max_ratio_ranged_attack_iterations,
        min_ratio_ranged_attack_iterations,
        step_by_step_attack_style,
        step_by_step_attack_value,
        max_piece_captures_per_move,
        max_piece_captures_per_ranged_attack,
        special_scenario_captures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const captureValues = [
      pieceId,
      pieceData.can_capture_enemy_via_range === 'true',
      pieceData.can_capture_ally_via_range === 'true',
      pieceData.can_capture_enemy_on_move === 'true',
      pieceData.can_capture_ally_on_range === 'true',
      pieceData.can_attack_on_iteration === 'true',
      parseInt(pieceData.up_left_capture) || 0,
      parseInt(pieceData.up_capture) || 0,
      parseInt(pieceData.up_right_capture) || 0,
      parseInt(pieceData.right_capture) || 0,
      parseInt(pieceData.down_right_capture) || 0,
      parseInt(pieceData.down_capture) || 0,
      parseInt(pieceData.down_left_capture) || 0,
      parseInt(pieceData.left_capture) || 0,
      parseInt(pieceData.ratio_one_capture) || null,
      parseInt(pieceData.ratio_two_capture) || null,
      parseInt(pieceData.step_by_step_capture) || null,
      parseInt(pieceData.up_left_attack_range) || 0,
      parseInt(pieceData.up_attack_range) || 0,
      parseInt(pieceData.up_right_attack_range) || 0,
      parseInt(pieceData.right_attack_range) || 0,
      parseInt(pieceData.down_right_attack_range) || 0,
      parseInt(pieceData.down_attack_range) || 0,
      parseInt(pieceData.down_left_attack_range) || 0,
      parseInt(pieceData.left_attack_range) || 0,
      pieceData.repeating_directional_ranged_attack === 'true',
      parseInt(pieceData.max_directional_ranged_attack_iterations) || null,
      parseInt(pieceData.min_directional_ranged_attack_iterations) || null,
      parseInt(pieceData.ratio_one_attack_range) || null,
      parseInt(pieceData.ratio_two_attack_range) || null,
      pieceData.repeating_ratio_ranged_attack === 'true',
      parseInt(pieceData.max_ratio_ranged_attack_iterations) || null,
      parseInt(pieceData.min_ratio_ranged_attack_iterations) || null,
      pieceData.step_by_step_attack_style === 'true',
      parseInt(pieceData.step_by_step_attack_value) || null,
      parseInt(pieceData.max_captures_per_move) || null,
      parseInt(pieceData.max_captures_via_ranged_attack) || null,
      pieceData.special_scenario_capture || null
    ];

    await db_pool.query(captureSql, captureValues);

    res.status(201).send({
      message: "Piece created successfully!",
      result: {
        id: pieceId,
        piece_name: pieceData.piece_name,
        piece_images: imagePaths
      }
    });

  } catch (err) {
    console.error("Error in /api/pieces/create:", err);
    res.status(500).send({ message: "Failed to create piece", err: err.message });
  }
});

// ----------------------- Pieces Update ------------------------------

app.put("/api/pieces/:pieceId", pieceUpload.array('piece_images', 8), async (req, res) => {
  try {
    const { pieceId } = req.params;
    const pieceData = req.body;
    const imageFiles = req.files;

    // Check if piece exists and user is creator
    const existingPiece = await dbHelpers.getPieceById(pieceId);
    if (!existingPiece) {
      return res.status(404).send({ message: "Piece not found" });
    }

    // Verify ownership (creator_id check)
    if (existingPiece.creator_id !== parseInt(pieceData.creator_id) && pieceData.user_role !== 'Admin') {
      return res.status(403).send({ message: "You don't have permission to edit this piece" });
    }

    // Handle images
    let imagesJSON = existingPiece.image_location; // Keep existing if no new images
    if (imageFiles && imageFiles.length > 0) {
      // Delete old images before saving new ones
      if (existingPiece.image_location) {
        try {
          const oldImages = JSON.parse(existingPiece.image_location);
          if (Array.isArray(oldImages)) {
            oldImages.forEach(imagePath => {
              const oldFilePath = path.join(__dirname, '..', imagePath);
              fs.unlink(oldFilePath, (err) => {
                if (err) {
                  console.error("Error deleting old piece image:", err);
                } else {
                  console.log("Deleted old piece image:", oldFilePath);
                }
              });
            });
          }
        } catch (err) {
          console.error("Error parsing old image paths:", err);
        }
      }
      
      const imagePaths = imageFiles.map(file => `/uploads/pieces/${file.filename}`);
      imagesJSON = JSON.stringify(imagePaths);
    }

    // Update pieces table
    const pieceSql = `
      UPDATE pieces SET
        piece_name = ?,
        image_location = ?,
        piece_width = ?,
        piece_height = ?,
        piece_description = ?
      WHERE id = ?
    `;

    const pieceValues = [
      pieceData.piece_name,
      imagesJSON,
      parseInt(pieceData.piece_width) || 1,
      parseInt(pieceData.piece_height) || 1,
      pieceData.piece_description || null,
      pieceId
    ];

    await db_pool.query(pieceSql, pieceValues);

    // Update piece_movement table
    const movementSql = `
      UPDATE piece_movement SET
        directional_movement_style = ?,
        repeating_movement = ?,
        max_directional_movement_iterations = ?,
        min_directional_movement_iterations = ?,
        up_left_movement = ?, up_movement = ?, up_right_movement = ?,
        right_movement = ?, down_right_movement = ?, down_movement = ?, down_left_movement = ?, left_movement = ?,
        ratio_movement_style = ?, ratio_one_movement = ?, ratio_two_movement = ?,
        repeating_ratio = ?,
        max_ratio_iterations = ?,
        min_ratio_iterations = ?,
        step_by_step_movement_style = ?, step_by_step_movement_value = ?,
        can_hop_over_allies = ?, can_hop_over_enemies = ?,
        min_turns_per_move = ?,
        max_turns_per_move = ?,
        special_scenario_moves = ?
      WHERE piece_id = ?
    `;

    const movementValues = [
      pieceData.directional_movement_style === 'true',
      pieceData.repeating_movement === 'true',
      parseInt(pieceData.max_directional_movement_iterations) || null,
      parseInt(pieceData.min_directional_movement_iterations) || null,
      parseInt(pieceData.up_left_movement) || 0,
      parseInt(pieceData.up_movement) || 0,
      parseInt(pieceData.up_right_movement) || 0,
      parseInt(pieceData.right_movement) || 0,
      parseInt(pieceData.down_right_movement) || 0,
      parseInt(pieceData.down_movement) || 0,
      parseInt(pieceData.down_left_movement) || 0,
      parseInt(pieceData.left_movement) || 0,
      pieceData.ratio_movement_style === 'true',
      parseInt(pieceData.ratio_one_movement) || null,
      parseInt(pieceData.ratio_two_movement) || null,
      pieceData.repeating_ratio === 'true',
      parseInt(pieceData.max_ratio_iterations) || null,
      parseInt(pieceData.min_ratio_iterations) || null,
      pieceData.step_by_step_movement_style === 'true',
      parseInt(pieceData.step_by_step_movement_value) || null,
      pieceData.can_hop_over_allies === 'true',
      pieceData.can_hop_over_enemies === 'true',
      parseInt(pieceData.min_turns_per_move) || null,
      parseInt(pieceData.max_turns_per_move) || null,
      pieceData.special_scenario_movement || null,
      pieceId
    ];

    await db_pool.query(movementSql, movementValues);

    // Update piece_capture table
    const captureSql = `
      UPDATE piece_capture SET
        can_capture_enemy_via_range = ?,
        can_capture_ally_via_range = ?,
        can_capture_enemy_on_move = ?,
        can_capture_ally_on_range = ?,
        can_attack_on_iteration = ?,
        up_left_capture = ?, up_capture = ?, up_right_capture = ?,
        right_capture = ?, down_right_capture = ?, down_capture = ?, down_left_capture = ?, left_capture = ?,
        ratio_one_capture = ?, ratio_two_capture = ?, step_by_step_capture = ?,
        up_left_attack_range = ?, up_attack_range = ?, up_right_attack_range = ?,
        right_attack_range = ?, down_right_attack_range = ?, down_attack_range = ?, down_left_attack_range = ?, left_attack_range = ?,
        repeating_directional_ranged_attack = ?,
        max_directional_ranged_attack_iterations = ?,
        min_directional_ranged_attack_iterations = ?,
        ratio_one_attack_range = ?, ratio_two_attack_range = ?,
        repeating_ratio_ranged_attack = ?,
        max_ratio_ranged_attack_iterations = ?,
        min_ratio_ranged_attack_iterations = ?,
        step_by_step_attack_style = ?,
        step_by_step_attack_value = ?,
        max_piece_captures_per_move = ?,
        max_piece_captures_per_ranged_attack = ?,
        special_scenario_captures = ?
      WHERE piece_id = ?
    `;

    const captureValues = [
      pieceData.can_capture_enemy_via_range === 'true',
      pieceData.can_capture_ally_via_range === 'true',
      pieceData.can_capture_enemy_on_move === 'true',
      pieceData.can_capture_ally_on_range === 'true',
      pieceData.can_attack_on_iteration === 'true',
      parseInt(pieceData.up_left_capture) || 0,
      parseInt(pieceData.up_capture) || 0,
      parseInt(pieceData.up_right_capture) || 0,
      parseInt(pieceData.right_capture) || 0,
      parseInt(pieceData.down_right_capture) || 0,
      parseInt(pieceData.down_capture) || 0,
      parseInt(pieceData.down_left_capture) || 0,
      parseInt(pieceData.left_capture) || 0,
      parseInt(pieceData.ratio_one_capture) || null,
      parseInt(pieceData.ratio_two_capture) || null,
      parseInt(pieceData.step_by_step_capture) || null,
      parseInt(pieceData.up_left_attack_range) || 0,
      parseInt(pieceData.up_attack_range) || 0,
      parseInt(pieceData.up_right_attack_range) || 0,
      parseInt(pieceData.right_attack_range) || 0,
      parseInt(pieceData.down_right_attack_range) || 0,
      parseInt(pieceData.down_attack_range) || 0,
      parseInt(pieceData.down_left_attack_range) || 0,
      parseInt(pieceData.left_attack_range) || 0,
      pieceData.repeating_directional_ranged_attack === 'true',
      parseInt(pieceData.max_directional_ranged_attack_iterations) || null,
      parseInt(pieceData.min_directional_ranged_attack_iterations) || null,
      parseInt(pieceData.ratio_one_attack_range) || null,
      parseInt(pieceData.ratio_two_attack_range) || null,
      pieceData.repeating_ratio_ranged_attack === 'true',
      parseInt(pieceData.max_ratio_ranged_attack_iterations) || null,
      parseInt(pieceData.min_ratio_ranged_attack_iterations) || null,
      pieceData.step_by_step_attack_style === 'true',
      parseInt(pieceData.step_by_step_attack_value) || null,
      parseInt(pieceData.max_captures_per_move) || null,
      parseInt(pieceData.max_captures_via_ranged_attack) || null,
      pieceData.special_scenario_capture || null,
      pieceId
    ];

    await db_pool.query(captureSql, captureValues);

    res.status(200).send({
      message: "Piece updated successfully!",
      result: {
        id: pieceId,
        piece_name: pieceData.piece_name
      }
    });

  } catch (err) {
    console.error("Error in /api/pieces/:pieceId (PUT):", err);
    res.status(500).send({ message: "Failed to update piece", err: err.message });
  }
});

// ----------------------- Pieces Delete ------------------------------

app.delete("/api/pieces/:pieceId", authenticateToken, async (req, res) => {
  try {
    const { pieceId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if piece exists
    const [existingPieceRows] = await db_pool.query(
      "SELECT * FROM pieces WHERE id = ?", 
      [pieceId]
    );
    
    if (existingPieceRows.length === 0) {
      return res.status(404).send({ message: "Piece not found" });
    }
    
    const existingPiece = existingPieceRows[0];

    // Verify ownership
    if (existingPiece.creator_id !== parseInt(userId) && userRole !== 'Admin') {
      return res.status(403).send({ message: "You don't have permission to delete this piece" });
    }

    // Delete the piece (CASCADE will handle related tables)
    await db_pool.query("DELETE FROM pieces WHERE id = ?", [pieceId]);

    res.status(200).send({ message: "Piece deleted successfully" });

  } catch (err) {
    console.error("Error in /api/pieces/:pieceId (DELETE):", err);
    res.status(500).send({ message: "Failed to delete piece", err: err.message });
  }
});

// ----------------------- Middleware ------------------------------

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (token == null) {
    return res.status(401).send({ message: "No token provided" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403)
    req.user = user
    next()
  })
}

function authenticateAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'Admin') {
      return res.status(403).send({ message: "Admin access required" });
    }
    next();
  });
}

function generateAccessToken(user) {
  // Access tokens expire in 15 minutes
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
  return token;
}

function generateRefreshToken(user) {
  // Refresh tokens expire in 7 days
  const token = jwt.sign(user, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
  return token;
}

// ----------------------- Admin Dashboard Routes ------------------------------

// Get all users with pagination
app.get("/api/admin/users", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [users] = await db_pool.query(
      `SELECT id, username, email, first_name, last_name, bio, role, profile_picture, 
       last_active_at, timezone, lang, country, light_square_color, dark_square_color, elo
       FROM users 
       ORDER BY id DESC 
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) as total FROM users");

    res.json({
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/admin/users:", err);
    res.status(500).send({ message: "Failed to fetch users", err: err.message });
  }
});

// Get all pieces with pagination (includes movement and attack data)
app.get("/api/admin/pieces", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [pieces] = await db_pool.query(
      `SELECT p.id, p.piece_name, p.piece_category, p.piece_description, 
       p.creator_id, p.image_location,
       u.username as creator_name,
       pm.directional_movement_style as movement_directional, 
       pm.ratio_movement_style as movement_ratio,
       pc.can_capture_enemy_on_move as can_capture
       FROM pieces p
       LEFT JOIN users u ON p.creator_id = u.id
       LEFT JOIN piece_movement pm ON p.id = pm.piece_id
       LEFT JOIN piece_capture pc ON p.id = pc.piece_id
       ORDER BY p.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) as total FROM pieces");

    res.json({
      data: pieces,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/admin/pieces:", err);
    res.status(500).send({ message: "Failed to fetch pieces", err: err.message });
  }
});

// Get all games with pagination
app.get("/api/admin/games", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [games] = await db_pool.query(
      `SELECT g.id, g.game_name, g.descript, g.board_width, g.board_height, 
       g.player_count, g.last_played_at, u.username as creator_name 
       FROM game_types g
       LEFT JOIN users u ON g.creator_id = u.id
       ORDER BY g.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) as total FROM game_types");

    res.json({
      data: games,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/admin/games:", err);
    res.status(500).send({ message: "Failed to fetch games", err: err.message });
  }
});

// Get all forum articles with pagination
app.get("/api/admin/forums", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [forums] = await db_pool.query(
      `SELECT a.id, a.title, a.descript, a.content, a.genre, a.public, a.created_at,
       u.username as author_name, g.game_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       LEFT JOIN game_types g ON a.game_type_id = g.id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) as total FROM articles");

    res.json({
      data: forums,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/admin/forums:", err);
    res.status(500).send({ message: "Failed to fetch forums", err: err.message });
  }
});

// Get all news with pagination
app.get("/api/admin/news", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [news] = await db_pool.query(
      `SELECT n.*, u.username as author_name
       FROM news n
       LEFT JOIN users u ON n.author_id = u.id
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) as total FROM news");

    res.json({
      data: news,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/admin/news:", err);
    res.status(500).send({ message: "Failed to fetch news", err: err.message });
  }
});

// Update any user field (admin only)
app.put("/api/admin/users/:userId", authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const fields = Object.keys(updates).filter(key => key !== 'id');
    if (fields.length === 0) {
      return res.status(400).send({ message: "No fields to update" });
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => updates[field]);
    values.push(userId);

    await db_pool.query(
      `UPDATE users SET ${setClause} WHERE id = ?`,
      values
    );

    const [[updatedUser]] = await db_pool.query(
      "SELECT * FROM users WHERE id = ?",
      [userId]
    );
    delete updatedUser.password;

    res.json({ success: true, user: updatedUser, message: "User updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/users/:userId (PUT):", err);
    res.status(500).send({ message: "Failed to update user", err: err.message });
  }
});

// Update any piece field (admin only)
app.put("/api/admin/pieces/:pieceId", authenticateAdmin, async (req, res) => {
  try {
    const { pieceId } = req.params;
    const updates = req.body;
    
    const fields = Object.keys(updates).filter(key => key !== 'id' && !key.includes('movement_') && !key.includes('attack_'));
    if (fields.length > 0) {
      const setClause = fields.map(field => `${field} = ?`).join(', ');
      const values = fields.map(field => updates[field]);
      values.push(pieceId);
      await db_pool.query(`UPDATE pieces SET ${setClause} WHERE id = ?`, values);
    }

    // Update movement fields if present
    const movementFields = Object.keys(updates).filter(key => key.startsWith('movement_'));
    if (movementFields.length > 0) {
      const setClause = movementFields.map(field => `${field.replace('movement_', '')} = ?`).join(', ');
      const values = movementFields.map(field => updates[field]);
      values.push(pieceId);
      await db_pool.query(`UPDATE piece_movement SET ${setClause} WHERE piece_id = ?`, values);
    }

    // Update attack/capture fields if present
    const attackFields = Object.keys(updates).filter(key => key.startsWith('attack_'));
    if (attackFields.length > 0) {
      const setClause = attackFields.map(field => `${field.replace('attack_', '')} = ?`).join(', ');
      const values = attackFields.map(field => updates[field]);
      values.push(pieceId);
      await db_pool.query(`UPDATE piece_capture SET ${setClause} WHERE piece_id = ?`, values);
    }

    res.json({ success: true, message: "Piece updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/pieces/:pieceId (PUT):", err);
    res.status(500).send({ message: "Failed to update piece", err: err.message });
  }
});

// Update any game field (admin only)
app.put("/api/admin/games/:gameId", authenticateAdmin, async (req, res) => {
  try {
    const { gameId } = req.params;
    const updates = req.body;
    
    const fields = Object.keys(updates).filter(key => key !== 'id');
    if (fields.length === 0) {
      return res.status(400).send({ message: "No fields to update" });
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => updates[field]);
    values.push(gameId);

    await db_pool.query(`UPDATE game_types SET ${setClause} WHERE id = ?`, values);

    const [[updatedGame]] = await db_pool.query("SELECT * FROM game_types WHERE id = ?", [gameId]);

    res.json({ success: true, game: updatedGame, message: "Game updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/games/:gameId (PUT):", err);
    res.status(500).send({ message: "Failed to update game", err: err.message });
  }
});

// Update any forum article field (admin only)
app.put("/api/admin/forums/:articleId", authenticateAdmin, async (req, res) => {
  try {
    const { articleId } = req.params;
    const updates = req.body;
    
    const fields = Object.keys(updates).filter(key => key !== 'id');
    if (fields.length === 0) {
      return res.status(400).send({ message: "No fields to update" });
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => updates[field]);
    values.push(articleId);

    await db_pool.query(`UPDATE articles SET ${setClause} WHERE id = ?`, values);

    const [[updatedArticle]] = await db_pool.query("SELECT * FROM articles WHERE id = ?", [articleId]);

    res.json({ success: true, article: updatedArticle, message: "Forum article updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/forums/:articleId (PUT):", err);
    res.status(500).send({ message: "Failed to update forum article", err: err.message });
  }
});

// Update any news field (admin only)
app.put("/api/admin/news/:newsId", authenticateAdmin, async (req, res) => {
  try {
    const { newsId } = req.params;
    const updates = req.body;
    
    const fields = Object.keys(updates).filter(key => key !== 'id');
    if (fields.length === 0) {
      return res.status(400).send({ message: "No fields to update" });
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => updates[field]);
    values.push(newsId);

    await db_pool.query(`UPDATE news SET ${setClause} WHERE id = ?`, values);

    const [[updatedNews]] = await db_pool.query("SELECT * FROM news WHERE id = ?", [newsId]);

    res.json({ success: true, news: updatedNews, message: "News updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/news/:newsId (PUT):", err);
    res.status(500).send({ message: "Failed to update news", err: err.message });
  }
});

//  -----------------------  Other/Port -------------------------

// All other GET requests not handled before will return our React app
app.get('/api/*', (req, res) => {
  res.json({ message: "No data to return from this endpoint!" });
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});