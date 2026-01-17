require("dotenv").config();

//  Constants

const express = require("express");

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

// const corsOptions = {
//   origin: ['http://squarestrat.com', 'https://squarestrat.com', 'http://localhost:3000'], // Specify allowed origins
//   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
//   credentials: true, // Allow sending cookies/authorization headers
//   optionsSuccessStatus: 204 // Some legacy browsers require 204 for preflight success
// };

// app.use(cors(corsOptions));
app.use(cors());

// const path = require('path');
const db_pool = require("../configs/db");
const db = require("../configs/db");
const dbHelpers = require("./db-helpers");

app.use(express.json());

// db.connect(err => {
//   if (err) {
//     throw err;
//   }
//   console.log('MySQL Connected')
// });


// Create Database

// app.get('/api/create-db', (req, res) => {
//   let sql = 'CREATE DATABASE IF NOT EXISTS ChessusNode'
//   db.query(sql, err => {
//     if (err) {
//       throw err;
//     }
//     res.send("Database Created or Exists");
//   })
// });


//  -----------  Seeding/Tables -----------------

// // Read SQL table seed query
// const tableQuery = fs.readFileSync("db/tables-seed.sql", {
//   encoding: "utf-8",
// })

// // Run tables-seed.sql.  Go to /create-tables to create the tables.
// app.get('/api/create-tables', (req, res) => {
//   let sql = tableQuery;
//   db.query(sql, err => {
//     if (err) {
//       throw err;
//     }
//     res.send("Tables Created or Exist");
//   })
// })

// // Read SQL seed query
// const seedQuery = fs.readFileSync("db/seed.sql", {
//   encoding: "utf-8",
// })

// // Run seed.sql.  Go to /seed to create seed data.
// app.get('/api/seed', (req, res) => {
//   let sql = seedQuery;
//   db.query(sql, err => {
//     if (err) {
//       throw err;
//     }
//     res.send("Seed data created or exist");
//   })
// })

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
    const { username, current_user, password, bio, email, first_name, last_name, id } = req.body;
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
    console.log("trying to compare passwords");
    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      console.log("we are in the failed login backend method - possibly incorrect password");
      return res.status(400).send({ auth: false, message: "Incorrect password" });
    }

    // Generate token
    console.log("login should be successful now");
    const userForToken = { username, password };
    console.log("testing 1");
    console.log(process.env.TESTING);
    console.log("testing env");
    const accessToken = generateAccessToken(userForToken);
    console.log("testing 2");
    console.log("result: " + user + " username: " + user.username);
    console.log("testing 3");
    
    user.accessToken = accessToken;
    res.json({ auth: true, result: user });
  } catch (err) {
    console.error("Error in /api/login:", err);
    res.status(500).send({ auth: false, message: "Login failed", err: err.message });
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
  console.log("You have been logged out");
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
  db.query("SELECT * FROM chessusnode.articles"), (err, result) => {
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
  db.query("INSERT INTO chessusnode.news (user_id, article_id, liked) VALUES (?,?,?)",
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

app.post('/api/token', (req, res) => {
  const refreshToken = req.body.token
})

// ----------------------- Middleware ------------------------------

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (token == null) {
    res.send("No token!");
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403)
    req.user = user
    next()
  })
}

function generateAccessToken(user) {
  console.log("in generate access token method");
  console.log(user);
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '5s'})
  console.log("should return token now")
  return token;
}

//  -----------------------  Other/Port -------------------------

// All other GET requests not handled before will return our React app
app.get('/api/*', (req, res) => {
  res.json({ message: "No data to return from this endpoint!" });
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});