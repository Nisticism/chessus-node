require("dotenv").config();

//  Constants

const express = require("express");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

// const mysql = require("mysql");

const fs = require("fs");

const cors = require("cors");

const jwt = require("jsonwebtoken");

const bcrypt = require("bcrypt");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// JWT Secret Management - Generate stable secrets that persist across restarts
const SECRETS_FILE = path.join(__dirname, '.jwt-secrets.json');

function ensureJwtSecrets() {
  let secrets = {};
  
  // Try to load existing secrets from file
  if (fs.existsSync(SECRETS_FILE)) {
    try {
      secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
      console.log('Loaded JWT secrets from file');
    } catch (err) {
      console.warn('Failed to parse secrets file, will regenerate');
    }
  }
  
  // Use environment variables if set, otherwise use file secrets, otherwise generate new ones
  const accessSecret = process.env.ACCESS_TOKEN_SECRET || secrets.accessTokenSecret || crypto.randomBytes(64).toString('hex');
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET || secrets.refreshTokenSecret || crypto.randomBytes(64).toString('hex');
  
  // Save secrets to file if they weren't loaded from env vars
  if (!process.env.ACCESS_TOKEN_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
    const newSecrets = {
      accessTokenSecret: secrets.accessTokenSecret || accessSecret,
      refreshTokenSecret: secrets.refreshTokenSecret || refreshSecret,
      createdAt: secrets.createdAt || new Date().toISOString()
    };
    
    // Only write if secrets are new or file doesn't exist
    if (!secrets.accessTokenSecret || !secrets.refreshTokenSecret) {
      try {
        fs.writeFileSync(SECRETS_FILE, JSON.stringify(newSecrets, null, 2));
        console.log('Generated and saved new JWT secrets to file');
      } catch (err) {
        console.warn('Could not save secrets to file:', err.message);
      }
    }
  }
  
  // Set process.env so the rest of the code can use them
  process.env.ACCESS_TOKEN_SECRET = accessSecret;
  process.env.REFRESH_TOKEN_SECRET = refreshSecret;
}

// Initialize JWT secrets before anything else
ensureJwtSecrets();

// Security: bcrypt rounds (12 is recommended for modern hardware)
const BCRYPT_ROUNDS = 12;

// Security: Track failed login attempts (in-memory, resets on server restart)
const loginAttempts = new Map();
const LOGIN_LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

// Email service
const { sendWelcomeEmail, sendDonationEmail, sendContactEmail } = require("./email-service");

// Socket.io game handler
const { initializeSocket, onlineUsers } = require("./game-socket");

//  Express

const PORT = process.env.PORT || 3001;

const app = express();

// Some day I will set up a router to change this /api crap, but today is not that day.
// const router = express.Router();
// router.post('/login', app.login());

//app.use("/api", "*");

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    // Define allowed origins patterns
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      /^https?:\/\/(www\.)?squarestrat\.com$/,
    ];
    
    // Check if origin matches any allowed pattern
    const isAllowed = allowedOrigins.some(pattern => {
      if (typeof pattern === 'string') {
        return origin === pattern;
      }
      return pattern.test(origin);
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Allow sending cookies/authorization headers
  optionsSuccessStatus: 204, // Some legacy browsers require 204 for preflight success
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
};

app.use(cors(corsOptions));

// Security headers with helmet
app.use(helmet({
  contentSecurityPolicy: false, // Disable if it breaks your frontend
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting configuration
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 minutes (generous for heavy API usage)
  message: { message: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: { message: "Too many login attempts, please try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour per IP
  message: { message: "Too many accounts created, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all routes
app.use('/api/', generalLimiter);

// Additional middleware to handle Private Network Access
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

// const path = require('path');
const db_pool = require("../configs/db");
const dbHelpers = require("./db-helpers");

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
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

const TOURNAMENT_FORMATS = new Set(["single_elimination", "double_elimination", "pool_play"]);
const TERMINAL_TOURNAMENT_STATUSES = new Set(["started", "completed", "cancelled"]);

const parsePositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const parseBooleanValue = (value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }

  return null;
};

const normalizeStartDateTime = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const noTimezone = trimmed.replace("T", " ");
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(noTimezone)) {
      return noTimezone;
    }

    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(noTimezone)) {
      return `${noTimezone}:00`;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 19).replace("T", " ");
    }
  }

  return null;
};

const calculateTournamentRounds = ({ format, maxPlayers }) => {
  const normalizedPlayers = Math.max(2, parsePositiveInt(maxPlayers, 2));
  const eliminationRounds = Math.max(1, Math.ceil(Math.log2(normalizedPlayers)));

  if (format === "double_elimination") {
    return (eliminationRounds * 2) - 1;
  }

  if (format === "pool_play") {
    return eliminationRounds + 1;
  }

  return eliminationRounds;
};

const calculateExpectedLengthMinutes = ({ format, maxPlayers, timeControl, incrementSeconds }) => {
  const rounds = calculateTournamentRounds({ format, maxPlayers });
  const baseMinutes = Math.max(1, parsePositiveInt(timeControl, 10));
  const increment = Math.max(0, Number(incrementSeconds) || 0);
  const averageMovesPerPlayer = 40;
  const incrementMinutes = (increment * averageMovesPerPlayer) / 60;
  const betweenRoundBufferMinutes = 5;
  const matchLengthMinutes = Math.max(1, Math.ceil(baseMinutes + incrementMinutes + betweenRoundBufferMinutes));

  return rounds * matchLengthMinutes;
};

const mapTournamentRow = (row, participants = []) => ({
  id: String(row.id),
  format: row.format,
  gameTypeId: Number(row.game_type_id),
  gameTypeName: row.game_type_name,
  timeControl: Number(row.time_control),
  increment: Number(row.increment_seconds),
  minPlayers: Number(row.min_players),
  maxPlayers: Number(row.max_players),
  isPrivate: Boolean(row.is_private),
  startDateTime: row.start_datetime,
  numberOfRounds: Number(row.number_of_rounds),
  expectedLengthMinutes: Number(row.expected_length_minutes),
  status: row.status,
  createdById: Number(row.created_by_id),
  createdByUsername: row.created_by_username,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  participants
});

const getParticipantsByTournamentIds = async (tournamentIds) => {
  if (!Array.isArray(tournamentIds) || tournamentIds.length === 0) {
    return new Map();
  }

  const [participantRows] = await db_pool.query(
    `SELECT tp.tournament_id, u.id AS user_id, u.username
     FROM tournament_participants tp
     INNER JOIN users u ON u.id = tp.user_id
     WHERE tp.tournament_id IN (?)
     ORDER BY tp.joined_at ASC`,
    [tournamentIds]
  );

  const byTournamentId = new Map();
  participantRows.forEach((row) => {
    const key = String(row.tournament_id);
    if (!byTournamentId.has(key)) {
      byTournamentId.set(key, []);
    }

    byTournamentId.get(key).push({
      id: Number(row.user_id),
      username: row.username
    });
  });

  return byTournamentId;
};

const getTournamentByIdForResponse = async (tournamentId, requesterId = null) => {
  const [rows] = await db_pool.query(
    `SELECT
      t.id,
      t.format,
      t.game_type_id,
      t.time_control,
      t.increment_seconds,
      t.min_players,
      t.max_players,
      t.is_private,
      t.start_datetime,
      t.number_of_rounds,
      t.expected_length_minutes,
      t.status,
      t.created_by_id,
      t.created_at,
      t.updated_at,
      gt.game_name AS game_type_name,
      creator.username AS created_by_username,
      COUNT(tp.user_id) AS participant_count,
      EXISTS(
        SELECT 1
        FROM tournament_participants tp2
        WHERE tp2.tournament_id = t.id AND tp2.user_id = ?
      ) AS requester_is_participant
    FROM tournaments t
    INNER JOIN game_types gt ON gt.id = t.game_type_id
    INNER JOIN users creator ON creator.id = t.created_by_id
    LEFT JOIN tournament_participants tp ON tp.tournament_id = t.id
    WHERE t.id = ?
    GROUP BY t.id`,
    [requesterId || 0, tournamentId]
  );

  if (!rows.length) {
    return null;
  }

  const participantsById = await getParticipantsByTournamentIds([rows[0].id]);
  const tournament = mapTournamentRow(rows[0], participantsById.get(String(rows[0].id)) || []);
  tournament.requesterIsParticipant = Boolean(rows[0].requester_is_participant);
  return tournament;
};

app.get("/api/tournaments", optionalAuthenticate, async (req, res) => {
  try {
    const requesterId = req.user?.id ? Number(req.user.id) : null;
    const requesterRole = req.user?.role?.toLowerCase() || "";

    const [rows] = await db_pool.query(
      `SELECT
        t.id,
        t.format,
        t.game_type_id,
        t.time_control,
        t.increment_seconds,
        t.min_players,
        t.max_players,
        t.is_private,
        t.start_datetime,
        t.number_of_rounds,
        t.expected_length_minutes,
        t.status,
        t.created_by_id,
        t.created_at,
        t.updated_at,
        gt.game_name AS game_type_name,
        creator.username AS created_by_username,
        COUNT(tp.user_id) AS participant_count
      FROM tournaments t
      INNER JOIN game_types gt ON gt.id = t.game_type_id
      INNER JOIN users creator ON creator.id = t.created_by_id
      LEFT JOIN tournament_participants tp ON tp.tournament_id = t.id
      WHERE t.is_private = 0
        OR (
          ? IS NOT NULL AND (
            t.created_by_id = ?
            OR EXISTS (
              SELECT 1
              FROM tournament_participants tp2
              WHERE tp2.tournament_id = t.id AND tp2.user_id = ?
            )
            OR ? IN ('admin', 'owner')
          )
        )
      GROUP BY t.id
      ORDER BY t.created_at DESC`,
      [requesterId, requesterId, requesterId, requesterRole]
    );

    const tournamentIds = rows.map((row) => row.id);
    const participantsByTournamentId = await getParticipantsByTournamentIds(tournamentIds);
    const tournaments = rows.map((row) => mapTournamentRow(row, participantsByTournamentId.get(String(row.id)) || []));

    res.status(200).json({ tournaments });
  } catch (err) {
    console.error("Error in /api/tournaments:", err);
    res.status(500).send({ message: "Failed to load tournaments", err: err.message });
  }
});

app.get("/api/tournaments/:tournamentId", optionalAuthenticate, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const requesterId = req.user?.id ? Number(req.user.id) : null;
    const requesterRole = req.user?.role?.toLowerCase() || "";
    const tournament = await getTournamentByIdForResponse(tournamentId, requesterId);

    if (!tournament) {
      return res.status(404).send({ message: "Tournament not found" });
    }

    const canViewPrivate = requesterRole === "admin"
      || requesterRole === "owner"
      || (requesterId && tournament.createdById === requesterId)
      || tournament.requesterIsParticipant;

    if (tournament.isPrivate && !canViewPrivate) {
      return res.status(403).send({ message: "This private tournament is not visible to your account" });
    }

    delete tournament.requesterIsParticipant;
    return res.status(200).json({ tournament });
  } catch (err) {
    console.error("Error in /api/tournaments/:tournamentId:", err);
    return res.status(500).send({ message: "Failed to load tournament", err: err.message });
  }
});

app.post("/api/tournaments", authenticateToken, async (req, res) => {
  const {
    format,
    gameTypeId,
    timeControl,
    increment,
    minPlayers,
    maxPlayers,
    isPrivate,
    startDateTime
  } = req.body;

  const normalizedFormat = String(format || "").trim();
  const normalizedGameTypeId = parsePositiveInt(gameTypeId);
  const normalizedTimeControl = parsePositiveInt(timeControl);
  const normalizedIncrement = Math.max(0, Number(increment) || 0);
  const normalizedMinPlayers = Math.max(2, parsePositiveInt(minPlayers, 2));
  const normalizedMaxPlayers = Math.max(2, parsePositiveInt(maxPlayers, 8));
  const normalizedPrivate = parseBooleanValue(isPrivate);
  const normalizedStartDateTime = normalizeStartDateTime(startDateTime);

  if (!TOURNAMENT_FORMATS.has(normalizedFormat)) {
    return res.status(400).send({ message: "Invalid tournament format" });
  }

  if (!normalizedGameTypeId) {
    return res.status(400).send({ message: "A valid game type is required" });
  }

  if (!normalizedTimeControl) {
    return res.status(400).send({ message: "A valid time control is required" });
  }

  if (!normalizedStartDateTime) {
    return res.status(400).send({ message: "A valid start date and time is required" });
  }

  if (normalizedMinPlayers > normalizedMaxPlayers) {
    return res.status(400).send({ message: "Minimum players cannot exceed maximum players" });
  }

  const numberOfRounds = calculateTournamentRounds({
    format: normalizedFormat,
    maxPlayers: normalizedMaxPlayers
  });

  const expectedLengthMinutes = calculateExpectedLengthMinutes({
    format: normalizedFormat,
    maxPlayers: normalizedMaxPlayers,
    timeControl: normalizedTimeControl,
    incrementSeconds: normalizedIncrement
  });

  const connection = await db_pool.getConnection();
  try {
    await connection.beginTransaction();

    const [insertResult] = await connection.query(
      `INSERT INTO tournaments (
        format,
        game_type_id,
        time_control,
        increment_seconds,
        min_players,
        max_players,
        is_private,
        start_datetime,
        number_of_rounds,
        expected_length_minutes,
        status,
        created_by_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        normalizedFormat,
        normalizedGameTypeId,
        normalizedTimeControl,
        normalizedIncrement,
        normalizedMinPlayers,
        normalizedMaxPlayers,
        normalizedPrivate ? 1 : 0,
        normalizedStartDateTime,
        numberOfRounds,
        expectedLengthMinutes,
        Number(req.user.id)
      ]
    );

    await connection.query(
      "INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)",
      [insertResult.insertId, Number(req.user.id)]
    );

    await connection.commit();
    const tournament = await getTournamentByIdForResponse(insertResult.insertId, Number(req.user.id));
    if (tournament) {
      delete tournament.requesterIsParticipant;
    }
    return res.status(201).json({ tournament });
  } catch (err) {
    await connection.rollback();
    console.error("Error in POST /api/tournaments:", err);
    return res.status(500).send({ message: "Failed to create tournament", err: err.message });
  } finally {
    connection.release();
  }
});

app.post("/api/tournaments/:tournamentId/join", authenticateToken, async (req, res) => {
  const { tournamentId } = req.params;
  const requesterId = Number(req.user.id);
  const connection = await db_pool.getConnection();

  try {
    await connection.beginTransaction();

    const [tournamentRows] = await connection.query(
      "SELECT id, max_players, status FROM tournaments WHERE id = ? FOR UPDATE",
      [tournamentId]
    );

    if (!tournamentRows.length) {
      await connection.rollback();
      return res.status(404).send({ message: "Tournament not found" });
    }

    const tournament = tournamentRows[0];

    const [existingRows] = await connection.query(
      "SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ? LIMIT 1",
      [tournamentId, requesterId]
    );

    if (existingRows.length) {
      await connection.commit();
      const existingTournament = await getTournamentByIdForResponse(tournamentId, requesterId);
      if (existingTournament) {
        delete existingTournament.requesterIsParticipant;
      }
      return res.status(200).json({ tournament: existingTournament });
    }

    const [participantCountRows] = await connection.query(
      "SELECT COUNT(*) AS participant_count FROM tournament_participants WHERE tournament_id = ?",
      [tournamentId]
    );
    const participantCount = Number(participantCountRows[0].participant_count || 0);

    if (participantCount >= Number(tournament.max_players)) {
      await connection.rollback();
      return res.status(400).send({ message: "Tournament is already full" });
    }

    await connection.query(
      "INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)",
      [tournamentId, requesterId]
    );

    const updatedCount = participantCount + 1;
    if (updatedCount >= Number(tournament.max_players) && tournament.status === "open") {
      await connection.query(
        "UPDATE tournaments SET status = 'full' WHERE id = ?",
        [tournamentId]
      );
    }

    await connection.commit();
    const updatedTournament = await getTournamentByIdForResponse(tournamentId, requesterId);
    if (updatedTournament) {
      delete updatedTournament.requesterIsParticipant;
    }
    return res.status(200).json({ tournament: updatedTournament });
  } catch (err) {
    await connection.rollback();
    console.error("Error in POST /api/tournaments/:tournamentId/join:", err);
    return res.status(500).send({ message: "Failed to join tournament", err: err.message });
  } finally {
    connection.release();
  }
});

app.put("/api/tournaments/:tournamentId", authenticateToken, async (req, res) => {
  const { tournamentId } = req.params;
  const requesterId = Number(req.user.id);
  const requesterRole = req.user?.role?.toLowerCase() || "";
  const connection = await db_pool.getConnection();

  try {
    await connection.beginTransaction();

    const [currentRows] = await connection.query(
      `SELECT
        id,
        format,
        game_type_id,
        time_control,
        increment_seconds,
        min_players,
        max_players,
        is_private,
        start_datetime,
        status,
        created_by_id
      FROM tournaments
      WHERE id = ?
      FOR UPDATE`,
      [tournamentId]
    );

    if (!currentRows.length) {
      await connection.rollback();
      return res.status(404).send({ message: "Tournament not found" });
    }

    const currentTournament = currentRows[0];
    const isOwner = Number(currentTournament.created_by_id) === requesterId;
    const isAdmin = requesterRole === "admin" || requesterRole === "owner";

    if (!isOwner && !isAdmin) {
      await connection.rollback();
      return res.status(403).send({ message: "Only the host can edit this tournament" });
    }

    const nextFormat = req.body.format !== undefined ? String(req.body.format).trim() : currentTournament.format;
    const nextGameTypeId = req.body.gameTypeId !== undefined
      ? parsePositiveInt(req.body.gameTypeId)
      : Number(currentTournament.game_type_id);
    const nextTimeControl = req.body.timeControl !== undefined
      ? parsePositiveInt(req.body.timeControl)
      : Number(currentTournament.time_control);
    const nextIncrement = req.body.increment !== undefined
      ? Math.max(0, Number(req.body.increment) || 0)
      : Number(currentTournament.increment_seconds);
    const nextMinPlayers = req.body.minPlayers !== undefined
      ? Math.max(2, parsePositiveInt(req.body.minPlayers, 2))
      : Number(currentTournament.min_players);
    const nextMaxPlayers = req.body.maxPlayers !== undefined
      ? Math.max(2, parsePositiveInt(req.body.maxPlayers, 8))
      : Number(currentTournament.max_players);
    const parsedPrivate = req.body.isPrivate !== undefined
      ? parseBooleanValue(req.body.isPrivate)
      : Boolean(currentTournament.is_private);
    const nextIsPrivate = parsedPrivate === null ? Boolean(currentTournament.is_private) : parsedPrivate;
    const nextStartDateTime = req.body.startDateTime !== undefined
      ? normalizeStartDateTime(req.body.startDateTime)
      : normalizeStartDateTime(currentTournament.start_datetime);

    if (!TOURNAMENT_FORMATS.has(nextFormat)) {
      await connection.rollback();
      return res.status(400).send({ message: "Invalid tournament format" });
    }

    if (!nextGameTypeId) {
      await connection.rollback();
      return res.status(400).send({ message: "A valid game type is required" });
    }

    if (!nextTimeControl) {
      await connection.rollback();
      return res.status(400).send({ message: "A valid time control is required" });
    }

    if (!nextStartDateTime) {
      await connection.rollback();
      return res.status(400).send({ message: "A valid start date and time is required" });
    }

    if (nextMinPlayers > nextMaxPlayers) {
      await connection.rollback();
      return res.status(400).send({ message: "Minimum players cannot exceed maximum players" });
    }

    const [participantCountRows] = await connection.query(
      "SELECT COUNT(*) AS participant_count FROM tournament_participants WHERE tournament_id = ?",
      [tournamentId]
    );
    const participantCount = Number(participantCountRows[0].participant_count || 0);

    if (nextMaxPlayers < participantCount) {
      await connection.rollback();
      return res.status(400).send({
        message: "Maximum players cannot be less than the number of joined participants"
      });
    }

    const numberOfRounds = calculateTournamentRounds({ format: nextFormat, maxPlayers: nextMaxPlayers });
    const expectedLengthMinutes = calculateExpectedLengthMinutes({
      format: nextFormat,
      maxPlayers: nextMaxPlayers,
      timeControl: nextTimeControl,
      incrementSeconds: nextIncrement
    });

    let nextStatus = currentTournament.status;
    if (req.body.status && ["open", "full", "started", "completed", "cancelled"].includes(req.body.status)) {
      nextStatus = req.body.status;
    } else if (!TERMINAL_TOURNAMENT_STATUSES.has(currentTournament.status)) {
      nextStatus = participantCount >= nextMaxPlayers ? "full" : "open";
    }

    await connection.query(
      `UPDATE tournaments
       SET format = ?,
           game_type_id = ?,
           time_control = ?,
           increment_seconds = ?,
           min_players = ?,
           max_players = ?,
           is_private = ?,
           start_datetime = ?,
           number_of_rounds = ?,
           expected_length_minutes = ?,
           status = ?
       WHERE id = ?`,
      [
        nextFormat,
        nextGameTypeId,
        nextTimeControl,
        nextIncrement,
        nextMinPlayers,
        nextMaxPlayers,
        nextIsPrivate ? 1 : 0,
        nextStartDateTime,
        numberOfRounds,
        expectedLengthMinutes,
        nextStatus,
        tournamentId
      ]
    );

    await connection.commit();
    const updatedTournament = await getTournamentByIdForResponse(tournamentId, requesterId);
    if (updatedTournament) {
      delete updatedTournament.requesterIsParticipant;
    }
    return res.status(200).json({ tournament: updatedTournament });
  } catch (err) {
    await connection.rollback();
    console.error("Error in PUT /api/tournaments/:tournamentId:", err);
    return res.status(500).send({ message: "Failed to update tournament", err: err.message });
  } finally {
    connection.release();
  }
});

app.get("/api/user", optionalAuthenticate, async (req, res) => {
  try {
    const username = req.query.username;
    const user = await dbHelpers.findUserByUsername(username);
    
    if (!user) {
      return res.status(400).send({ auth: false, message: "Username does not exist" });
    }
    
    // Strip personal information if viewing someone else's profile
    const isOwnProfile = req.user && req.user.username === username;
    if (!isOwnProfile) {
      delete user.email;
      delete user.first_name;
      delete user.last_name;
    }
    
    res.json({ result: user, message: "User found" });
  } catch (err) {
    console.error("Error in /api/user:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get total count
    const [countResult] = await db_pool.query("SELECT COUNT(*) as total FROM users");
    const total = countResult[0].total;
    
    // Get paginated users - exclude personal information (email, first_name, last_name)
    const [users] = await db_pool.query(
      `SELECT id, username, role, profile_picture, elo, last_active_at FROM users ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    );
    
    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/users:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get match history for a user
app.get("/api/users/:userId/match-history", async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Get completed games where the user was a player
    const [games] = await db_pool.query(`
      SELECT 
        g.id,
        g.created_at,
        g.start_time,
        g.end_time,
        g.status,
        g.winner_id,
        g.pieces,
        g.other_data,
        g.turn_length,
        g.increment,
        gt.game_name as game_type_name,
        gt.board_width,
        gt.board_height,
        p1.user_id as player1_id,
        p1.player_position as player1_position,
        u1.username as player1_username,
        u1.elo as player1_elo,
        p2.user_id as player2_id,
        p2.player_position as player2_position,
        u2.username as player2_username,
        u2.elo as player2_elo
      FROM games g
      LEFT JOIN game_types gt ON g.game_type_id = gt.id
      LEFT JOIN players p1 ON g.id = p1.game_id AND p1.player_position = 1
      LEFT JOIN users u1 ON p1.user_id = u1.id
      LEFT JOIN players p2 ON g.id = p2.game_id AND p2.player_position = 2
      LEFT JOIN users u2 ON p2.user_id = u2.id
      WHERE g.status = 'completed'
        AND (p1.user_id = ? OR p2.user_id = ?)
      ORDER BY g.end_time DESC
      LIMIT ? OFFSET ?
    `, [userId, userId, limit, offset]);

    // Get total count for pagination
    const [countResult] = await db_pool.query(`
      SELECT COUNT(DISTINCT g.id) as total
      FROM games g
      LEFT JOIN players p ON g.id = p.game_id
      WHERE g.status = 'completed' AND p.user_id = ?
    `, [userId]);

    const total = countResult[0].total;

    // Format the response
    const formattedGames = games.map(game => {
      let otherData = {};
      try {
        otherData = JSON.parse(game.other_data || '{}');
      } catch (e) {}

      // Use winner_id column, fall back to other_data.winner for older games
      const winnerId = game.winner_id || otherData.winner || null;
      const isWinner = winnerId && winnerId === parseInt(userId);
      const isDraw = !winnerId;

      return {
        id: game.id,
        createdAt: game.created_at,
        startTime: game.start_time,
        endTime: game.end_time,
        status: game.status,
        winnerId: winnerId,
        result: isDraw ? 'draw' : (isWinner ? 'win' : 'loss'),
        reason: otherData.reason || 'unknown',
        eloChanges: otherData.eloChanges || null,
        gameTypeName: game.game_type_name,
        boardWidth: game.board_width,
        boardHeight: game.board_height,
        timeControl: game.turn_length,
        increment: game.increment,
        players: [
          {
            id: game.player1_id,
            username: game.player1_username,
            elo: game.player1_elo,
            position: game.player1_position
          },
          {
            id: game.player2_id,
            username: game.player2_username,
            elo: game.player2_elo,
            position: game.player2_position
          }
        ].filter(p => p.id)
      };
    });

    res.json({
      games: formattedGames,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/users/:userId/match-history:", err);
    res.status(500).send({ err: err.message });
  }
});

// ===== FRIENDS ENDPOINTS =====

// Get user's friends list (only accepted friendships)
app.get("/api/users/:userId/friends", async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [friends] = await db_pool.query(`
      SELECT 
        u.id,
        u.username,
        u.elo,
        u.profile_picture,
        f.created_at as friendship_created_at
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ? AND f.status = 'accepted'
      ORDER BY u.username ASC
    `, [userId]);
    
    res.json(friends);
  } catch (err) {
    console.error("Error in /api/users/:userId/friends:", err);
    res.status(500).send({ err: err.message });
  }
});

// Send a friend request (creates a pending request)
app.post("/api/users/:userId/friends", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { friendId } = req.body;
    
    // Verify the requesting user is the same as userId
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Can't friend yourself
    if (parseInt(userId) === parseInt(friendId)) {
      return res.status(400).json({ error: "Cannot send friend request to yourself" });
    }
    
    // Check if any relationship already exists (pending or accepted)
    const [existing] = await db_pool.query(
      "SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
      [userId, friendId, friendId, userId]
    );
    
    if (existing.length > 0) {
      const existingRequest = existing[0];
      if (existingRequest.status === 'accepted') {
        return res.status(400).json({ error: "Already friends" });
      } else if (existingRequest.status === 'pending') {
        // Check if this is a request TO me that I can accept
        if (existingRequest.user_id === parseInt(friendId)) {
          return res.status(400).json({ error: "This user has already sent you a friend request. Check your pending requests." });
        }
        return res.status(400).json({ error: "Friend request already sent" });
      } else if (existingRequest.status === 'declined') {
        // Allow re-sending if previously declined - update existing record
        await db_pool.query(
          "UPDATE friends SET status = 'pending', created_at = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ?",
          [userId, friendId]
        );
        
        const [friend] = await db_pool.query(
          "SELECT id, username, elo, profile_picture FROM users WHERE id = ?",
          [friendId]
        );
        
        return res.json({ message: "Friend request sent", friend: friend[0] });
      }
    }
    
    // Create a pending friend request (one-way only)
    await db_pool.query(
      "INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')",
      [userId, friendId]
    );
    
    // Get the friend's info
    const [friend] = await db_pool.query(
      "SELECT id, username, elo, profile_picture FROM users WHERE id = ?",
      [friendId]
    );
    
    res.json({ message: "Friend request sent", friend: friend[0] });
  } catch (err) {
    console.error("Error in /api/users/:userId/friends POST:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get incoming friend requests (requests sent TO this user)
app.get("/api/users/:userId/friend-requests/incoming", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Verify the requesting user is the same as userId
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    const [requests] = await db_pool.query(`
      SELECT 
        f.id as request_id,
        u.id,
        u.username,
        u.elo,
        u.profile_picture,
        f.created_at as request_date
      FROM friends f
      JOIN users u ON f.user_id = u.id
      WHERE f.friend_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [userId]);
    
    res.json(requests);
  } catch (err) {
    console.error("Error in /api/users/:userId/friend-requests/incoming:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get outgoing friend requests (requests sent BY this user)
app.get("/api/users/:userId/friend-requests/outgoing", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Verify the requesting user is the same as userId
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    const [requests] = await db_pool.query(`
      SELECT 
        f.id as request_id,
        u.id,
        u.username,
        u.elo,
        u.profile_picture,
        f.created_at as request_date
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [userId]);
    
    res.json(requests);
  } catch (err) {
    console.error("Error in /api/users/:userId/friend-requests/outgoing:", err);
    res.status(500).send({ err: err.message });
  }
});

// Accept a friend request
app.post("/api/users/:userId/friend-requests/:requestId/accept", authenticateToken, async (req, res) => {
  try {
    const { userId, requestId } = req.params;
    
    // Verify the requesting user is the same as userId
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Get the request to verify it's TO this user
    const [request] = await db_pool.query(
      "SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'",
      [requestId, userId]
    );
    
    if (request.length === 0) {
      return res.status(404).json({ error: "Friend request not found" });
    }
    
    const senderId = request[0].user_id;
    
    // Update the request to accepted
    await db_pool.query(
      "UPDATE friends SET status = 'accepted' WHERE id = ?",
      [requestId]
    );
    
    // Create the reverse friendship (so both users see each other as friends)
    await db_pool.query(
      "INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted') ON DUPLICATE KEY UPDATE status = 'accepted'",
      [userId, senderId]
    );
    
    // Get the friend's info
    const [friend] = await db_pool.query(
      "SELECT id, username, elo, profile_picture FROM users WHERE id = ?",
      [senderId]
    );
    
    res.json({ message: "Friend request accepted", friend: friend[0] });
  } catch (err) {
    console.error("Error in /api/users/:userId/friend-requests/:requestId/accept:", err);
    res.status(500).send({ err: err.message });
  }
});

// Decline a friend request
app.post("/api/users/:userId/friend-requests/:requestId/decline", authenticateToken, async (req, res) => {
  try {
    const { userId, requestId } = req.params;
    
    // Verify the requesting user is the same as userId
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Get the request to verify it's TO this user
    const [request] = await db_pool.query(
      "SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'",
      [requestId, userId]
    );
    
    if (request.length === 0) {
      return res.status(404).json({ error: "Friend request not found" });
    }
    
    // Update the request to declined
    await db_pool.query(
      "UPDATE friends SET status = 'declined' WHERE id = ?",
      [requestId]
    );
    
    res.json({ message: "Friend request declined" });
  } catch (err) {
    console.error("Error in /api/users/:userId/friend-requests/:requestId/decline:", err);
    res.status(500).send({ err: err.message });
  }
});

// Cancel a sent friend request
app.delete("/api/users/:userId/friend-requests/:requestId", authenticateToken, async (req, res) => {
  try {
    const { userId, requestId } = req.params;
    
    // Verify the requesting user is the same as userId
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Verify this is an outgoing request FROM this user
    const [request] = await db_pool.query(
      "SELECT * FROM friends WHERE id = ? AND user_id = ? AND status = 'pending'",
      [requestId, userId]
    );
    
    if (request.length === 0) {
      return res.status(404).json({ error: "Friend request not found" });
    }
    
    // Delete the request
    await db_pool.query(
      "DELETE FROM friends WHERE id = ?",
      [requestId]
    );
    
    res.json({ message: "Friend request cancelled" });
  } catch (err) {
    console.error("Error in /api/users/:userId/friend-requests/:requestId DELETE:", err);
    res.status(500).send({ err: err.message });
  }
});

// Remove a friend
app.delete("/api/users/:userId/friends/:friendId", authenticateToken, async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    
    // Verify the requesting user is the same as userId
    if (req.user.id !== parseInt(userId)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Remove friendship (both directions)
    await db_pool.query(
      "DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
      [userId, friendId, friendId, userId]
    );
    
    res.json({ message: "Friend removed" });
  } catch (err) {
    console.error("Error in /api/users/:userId/friends DELETE:", err);
    res.status(500).send({ err: err.message });
  }
});

// Check friendship status between two users
app.get("/api/users/:userId/friends/:friendId/status", async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    
    // Check for accepted friendship
    const [accepted] = await db_pool.query(
      "SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'",
      [userId, friendId]
    );
    
    if (accepted.length > 0) {
      return res.json({ status: 'friends', areFriends: true });
    }
    
    // Check for pending request FROM userId TO friendId
    const [outgoing] = await db_pool.query(
      "SELECT id FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'",
      [userId, friendId]
    );
    
    if (outgoing.length > 0) {
      return res.json({ status: 'pending_outgoing', areFriends: false, requestId: outgoing[0].id });
    }
    
    // Check for pending request FROM friendId TO userId
    const [incoming] = await db_pool.query(
      "SELECT id FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'",
      [friendId, userId]
    );
    
    if (incoming.length > 0) {
      return res.json({ status: 'pending_incoming', areFriends: false, requestId: incoming[0].id });
    }
    
    res.json({ status: 'none', areFriends: false });
  } catch (err) {
    console.error("Error in /api/users/:userId/friends/:friendId/status:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get online friends (only accepted friendships)
app.get("/api/users/:userId/friends/online", async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user's accepted friends list
    const [friends] = await db_pool.query(`
      SELECT 
        u.id,
        u.username,
        u.elo,
        u.profile_picture
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ? AND f.status = 'accepted'
    `, [userId]);
    
    // Filter to only online friends
    const onlineFriends = friends.filter(friend => onlineUsers.has(friend.id));
    
    res.json(onlineFriends);
  } catch (err) {
    console.error("Error in /api/users/:userId/friends/online:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get a specific completed game with full details (for viewing past games)
app.get("/api/match/:gameId", async (req, res) => {
  try {
    const { gameId } = req.params;

    const [games] = await db_pool.query(`
      SELECT 
        g.*,
        gt.game_name as game_type_name,
        gt.board_width,
        gt.board_height,
        gt.descript as game_description
      FROM games g
      LEFT JOIN game_types gt ON g.game_type_id = gt.id
      WHERE g.id = ?
    `, [gameId]);

    if (games.length === 0) {
      return res.status(404).send({ message: "Game not found" });
    }

    const game = games[0];

    // Get players for this game
    const [players] = await db_pool.query(`
      SELECT 
        p.*,
        u.username,
        u.elo,
        u.profile_picture
      FROM players p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.game_id = ?
      ORDER BY p.player_position
    `, [gameId]);

    // Parse JSON fields
    let pieces = [];
    let otherData = {};
    try {
      pieces = JSON.parse(game.pieces || '[]');
    } catch (e) {}
    try {
      otherData = JSON.parse(game.other_data || '{}');
    } catch (e) {}

    // Use winner_id column, fall back to other_data.winner for older games
    const winnerId = game.winner_id || otherData.winner || null;

    res.json({
      id: game.id,
      createdAt: game.created_at,
      startTime: game.start_time,
      endTime: game.end_time,
      status: game.status,
      winnerId: winnerId,
      pieces,
      moveHistory: otherData.moves || [],
      reason: otherData.reason || 'unknown',
      eloChanges: otherData.eloChanges || null,
      gameTypeName: game.game_type_name,
      gameDescription: game.game_description,
      boardWidth: game.board_width || 8,
      boardHeight: game.board_height || 8,
      timeControl: game.turn_length,
      increment: game.increment,
      players: players.map(p => ({
        id: p.user_id,
        username: p.username,
        elo: p.elo,
        position: p.player_position,
        profilePicture: p.profile_picture
      }))
    });
  } catch (err) {
    console.error("Error in /api/match/:gameId:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/pieces", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get total count
    const [countResult] = await db_pool.query("SELECT COUNT(*) as total FROM pieces");
    const total = countResult[0].total;
    
    // Get paginated pieces
    const [pieces] = await db_pool.query(
      `SELECT * FROM pieces ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    );
    
    res.json({
      pieces,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/pieces:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get all pieces with full movement/capture data (for sandbox mode)
app.get("/api/pieces/full", async (req, res) => {
  try {
    const pieces = await dbHelpers.getAllPiecesWithMovement();
    res.json(pieces);
  } catch (err) {
    console.error("Error in /api/pieces/full:", err);
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

// Get all game types that use a specific piece
app.get("/api/pieces/:pieceId/games", async (req, res) => {
  try {
    const { pieceId } = req.params;
    const games = await dbHelpers.getGameTypesByPieceId(pieceId);
    res.json(games);
  } catch (err) {
    console.error("Error in /api/pieces/:pieceId/games:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/games", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get total count
    const [countResult] = await db_pool.query("SELECT COUNT(*) as total FROM game_types");
    const total = countResult[0].total;
    
    // Get paginated games
    const [games] = await db_pool.query(
      `SELECT * FROM game_types ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    );
    
    res.json({
      games,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
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
    
    // Find forum by querying articles table with game_type_id
    const [forumRows] = await db_pool.query(
      'SELECT id FROM articles WHERE game_type_id = ? LIMIT 1',
      [gameId]
    );
    if (forumRows.length > 0) {
      game.article_id = forumRows[0].id;
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
    const userRole = req.user.role;
    
    // Check if game exists
    const existingGame = await dbHelpers.getGameById(gameId);
    if (!existingGame) {
      return res.status(404).send({ message: "Game not found" });
    }
    
    // Debug logging
    console.log('Game Update Authorization:', {
      gameId,
      creator_id: existingGame.creator_id,
      creator_id_type: typeof existingGame.creator_id,
      userId,
      userId_type: typeof userId,
      userRole,
      match: existingGame.creator_id === userId
    });
    
    // Verify ownership (creator or Admin/Owner)
    if (existingGame.creator_id !== userId && userRole !== "admin" && userRole !== "owner") {
      return res.status(403).send({ message: "You can only edit your own games" });
    }

    // Force player_count to 2 (only 2-player games currently supported)
    gameData.player_count = 2;
    
    // Build the SQL query for updating
    const sql = `
      UPDATE game_types SET
        game_name = ?, descript = ?, rules = ?,
        mate_condition = ?, mate_piece = ?, capture_condition = ?, capture_piece = ?,
        value_condition = ?, value_piece = ?, value_max = ?, value_title = ?,
        squares_condition = ?, squares_count = ?, hill_condition = ?, hill_x = ?, hill_y = ?, hill_turns = ?,
        actions_per_turn = ?, board_width = ?, board_height = ?, player_count = ?,
        starting_piece_count = ?, range_squares_string = ?,
        promotion_squares_string = ?, special_squares_string = ?,
        randomized_starting_positions = ?, other_game_data = ?, optional_condition = ?, draw_move_limit = ?, repetition_draw_count = ?
      WHERE id = ?
    `;
    
    const values = [
      gameData.game_name,
      gameData.descript,
      gameData.rules,
      gameData.mate_condition || false,
      gameData.mate_piece != null ? gameData.mate_piece : null,
      gameData.capture_condition || false,
      gameData.capture_piece != null ? gameData.capture_piece : null,
      gameData.value_condition || false,
      gameData.value_piece != null ? gameData.value_piece : null,
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
      gameData.range_squares_string || null,
      gameData.promotion_squares_string || null,
      gameData.special_squares_string || null,
      gameData.randomized_starting_positions || null,
      gameData.other_game_data || null,
      gameData.optional_condition || null,
      gameData.draw_move_limit != null ? gameData.draw_move_limit : null,
      gameData.repetition_draw_count != null && gameData.repetition_draw_count >= 2 && gameData.repetition_draw_count <= 9 ? gameData.repetition_draw_count : null,
      gameId
    ];
    
    await db_pool.query(sql, values);

    // Update pieces in junction table if provided
    if (gameData.pieces_string) {
      try {
        // Remove existing pieces
        await dbHelpers.removeAllPiecesFromGameType(gameId);

        // Parse and insert new pieces
        const piecesData = JSON.parse(gameData.pieces_string);
        let piecesToInsert = [];

        // Handle both array and object formats
        if (Array.isArray(piecesData)) {
          piecesToInsert = piecesData;
        } else if (typeof piecesData === 'object') {
          // Convert object format {"row,col": {...}} to array
          // The key determines the position - use it as the source of truth
          piecesToInsert = Object.entries(piecesData).map(([key, piece]) => {
            const [row, col] = key.split(',').map(Number);
            return {
              ...piece,
              // Key is the source of truth for position (handles 0 values correctly)
              x: col,
              y: row
            };
          });
        }

        // Insert each piece
        for (const piece of piecesToInsert) {
          if (piece.piece_id) {
            const playerNum = Number(piece.player_id ?? piece.player_number ?? piece.player ?? 1);
            await dbHelpers.addPieceToGameType(
              gameId,
              piece.piece_id,
              piece.x ?? 0,
              piece.y ?? 0,
              playerNum,
              piece.ends_game_on_checkmate || false,
              piece.ends_game_on_capture || false,
              piece.manual_castling_partners || false,
              piece.castling_partner_left_key || null,
              piece.castling_partner_right_key || null
            );
          }
        }
      } catch (parseError) {
        console.error('Error parsing pieces_string:', parseError);
      }
    }
    
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

app.post("/api/register", registerLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || username.length === 0) {
      return res.status(400).send({ message: "Username cannot be blank" });
    }

    // Security: Username validation
    if (username.length < 3 || username.length > 20) {
      return res.status(400).send({ message: "Username must be between 3 and 20 characters" });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).send({ message: "Username can only contain letters, numbers, underscores, and hyphens" });
    }

    // Security: Password validation
    if (!password || password.length < 8) {
      return res.status(400).send({ message: "Password must be at least 8 characters long" });
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).send({ message: "Password must contain at least one uppercase letter, one lowercase letter, and one number" });
    }

    // Security: Email validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).send({ message: "Please provide a valid email address" });
    }

    // Check if username already exists
    const existingUser = await dbHelpers.findUserByUsername(username);
    if (existingUser) {
      return res.status(400).send({ message: "Username already exists" });
    }

    // Check if email already taken
    const existingEmail = await dbHelpers.findUserByEmail(email);
    if (existingEmail) {
      return res.status(400).send({ message: "Email already taken" });
    }

    // Create new user with stronger bcrypt rounds
    const hashedPassword = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const user = await dbHelpers.createUser(username, hashedPassword, email);
    
    // Send welcome email (non-blocking, won't fail registration if SendGrid not configured)
    sendWelcomeEmail(email, username)
      .then(result => {
        if (result.success) {
          console.log(`✅ Welcome email sent to ${email}`);
        } else {
          console.log(`⚠️ Welcome email not sent: ${result.message}`);
        }
      })
      .catch(err => {
        console.error('⚠️ Email sending failed:', err.message);
      });
    
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
    // Security: Never log passwords

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
      if (current_user.role !== "admin" && current_user.role !== "owner") {
        if (!oldPassword) {
          return res.status(400).send({ message: "Current password is required to change password" });
        }
        
        // Verify the old password
        const passwordMatch = bcrypt.compareSync(oldPassword, currentUser.password);
        if (!passwordMatch) {
          return res.status(400).send({ message: "Current password is incorrect" });
        }
      }
      
      // Security: Validate new password
      if (password.length < 8) {
        return res.status(400).send({ message: "Password must be at least 8 characters long" });
      }
      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
        return res.status(400).send({ message: "Password must contain at least one uppercase letter, one lowercase letter, and one number" });
      }
      
      const hashedPassword = bcrypt.hashSync(password, BCRYPT_ROUNDS);
      updatedUser.password = hashedPassword;
      console.log("Password updated for user id: " + id);
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

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    const lockoutKey = `${clientIP}:${username}`;

    // Security: Check for account lockout
    const attempts = loginAttempts.get(lockoutKey);
    if (attempts && attempts.count >= MAX_LOGIN_ATTEMPTS) {
      const timeLeft = Math.ceil((attempts.lockoutUntil - Date.now()) / 60000);
      if (Date.now() < attempts.lockoutUntil) {
        return res.status(429).send({ 
          auth: false, 
          message: `Account temporarily locked. Try again in ${timeLeft} minutes.` 
        });
      } else {
        // Lockout expired, reset
        loginAttempts.delete(lockoutKey);
      }
    }

    // Find user
    const user = await dbHelpers.findUserByUsername(username);
    if (!user) {
      // Security: Track failed attempt (but don't reveal if user exists)
      trackFailedLogin(lockoutKey);
      return res.status(400).send({ auth: false, message: "Invalid username or password" });
    }

    // Check if user is banned
    if (user.banned) {
      // Check if ban has expired
      if (user.ban_expires_at && new Date(user.ban_expires_at) < new Date()) {
        // Ban expired, unban the user
        await db_pool.query(
          "UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
          [user.id]
        );
      } else {
        // User is still banned
        const banMessage = user.ban_expires_at 
          ? `Your account is temporarily banned until ${new Date(user.ban_expires_at).toLocaleString()}.`
          : 'Your account has been permanently banned.';
        const reason = user.ban_reason ? ` Reason: ${user.ban_reason}` : '';
        return res.status(403).send({ 
          auth: false, 
          message: `${banMessage}${reason}`,
          banned: true 
        });
      }
    }

    // Compare passwords
    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      // Security: Track failed attempt
      trackFailedLogin(lockoutKey);
      return res.status(400).send({ auth: false, message: "Invalid username or password" });
    }

    // Security: Clear failed attempts on successful login
    loginAttempts.delete(lockoutKey);

    // Generate tokens
    const userPayload = { id: user.id, username: user.username, role: user.role };
    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload);
    
    // Store refresh token and update last_active_at in database
    try {
      await db_pool.query(
        "UPDATE users SET refresh_token = ?, last_active_at = NOW() WHERE id = ?",
        [refreshToken, user.id]
      );
    } catch (dbErr) {
      console.warn("Could not store refresh token (column may not exist yet):", dbErr.message);
    }
    
    user.accessToken = accessToken;
    user.refreshToken = refreshToken;
    delete user.password; // Don't send password to client
    delete user.refresh_token; // Don't expose the stored token
    delete user.banned; // Don't expose ban status
    delete user.ban_reason;
    delete user.banned_at;
    delete user.banned_by;
    delete user.ban_expires_at;
    
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

app.post("/api/delete", authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    const requestingUser = req.user;
    
    // Security: Only allow users to delete their own account, or admins/owners to delete any account
    if (requestingUser.username !== username && 
        requestingUser.role !== 'admin' && 
        requestingUser.role !== 'owner') {
      return res.status(403).send({ message: "Not authorized to delete this account" });
    }
    
    console.log(`User ${requestingUser.username} (role: ${requestingUser.role}) deleting account: ${username}`);
    
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

// ----------------------- User Management (Admin/Owner) ------------------------------

// Get all users (admin/owner only)
app.get("/api/admin/users", authenticateToken, async (req, res) => {
  try {
    const requesterRole = req.user.role;

    if (requesterRole !== 'admin' && requesterRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Admin or owner role required." });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [users] = await db_pool.query(
      `SELECT id, username, email, first_name, last_name, role, elo, profile_picture, bio,
              banned, ban_reason, banned_at, banned_by, ban_expires_at
       FROM users
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) as total FROM users");

    // Don't send passwords or refresh tokens
    const sanitizedUsers = users.map(user => {
      const sanitized = { ...user };
      delete sanitized.password;
      delete sanitized.refresh_token;
      return sanitized;
    });

    res.json({
      data: sanitizedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).send({ message: "Failed to fetch users", err: err.message });
  }
});

// Ban user (admin/owner only)
app.post("/api/admin/users/:userId/ban", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, expiresAt } = req.body;
    const bannerId = req.user.id;
    const bannerRole = req.user.role;

    if (bannerRole !== 'admin' && bannerRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Admin or owner role required." });
    }

    // Check target user
    const [targetUsers] = await db_pool.query(
      "SELECT id, username, role FROM users WHERE id = ?",
      [userId]
    );

    if (targetUsers.length === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    const targetUser = targetUsers[0];

    // Cannot ban owner
    if (targetUser.role === 'owner') {
      return res.status(403).send({ message: "Cannot ban the owner" });
    }

    // Admin cannot ban another admin
    if (bannerRole === 'admin' && targetUser.role === 'admin') {
      return res.status(403).send({ message: "Admins cannot ban other admins" });
    }

    // Ban the user
    await db_pool.query(
      `UPDATE users 
       SET banned = 1, ban_reason = ?, banned_at = NOW(), banned_by = ?, ban_expires_at = ?
       WHERE id = ?`,
      [reason || 'No reason provided', bannerId, expiresAt || null, userId]
    );

    // Clear their refresh token to force logout
    await db_pool.query(
      "UPDATE users SET refresh_token = NULL WHERE id = ?",
      [userId]
    );

    res.json({ message: "User banned successfully" });
  } catch (err) {
    console.error("Error banning user:", err);
    res.status(500).send({ message: "Failed to ban user", err: err.message });
  }
});

// Unban user (admin/owner only)
app.post("/api/admin/users/:userId/unban", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterRole = req.user.role;

    if (requesterRole !== 'admin' && requesterRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Admin or owner role required." });
    }

    await db_pool.query(
      `UPDATE users 
       SET banned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL, ban_expires_at = NULL
       WHERE id = ?`,
      [userId]
    );

    res.json({ message: "User unbanned successfully" });
  } catch (err) {
    console.error("Error unbanning user:", err);
    res.status(500).send({ message: "Failed to unban user", err: err.message });
  }
});

// Delete bugged game (admin/owner only) - does not affect player ELO
app.delete("/api/admin/games/:gameId", authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const requesterRole = req.user.role?.toLowerCase();

    if (requesterRole !== 'admin' && requesterRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Admin or owner role required." });
    }

    // Delete game and associated data
    await db_pool.query("DELETE FROM players WHERE game_id = ?", [gameId]);
    await db_pool.query("DELETE FROM games WHERE id = ?", [gameId]);

    console.log(`Admin ${req.user.id} deleted bugged game ${gameId}`);
    res.json({ message: "Game deleted successfully" });
  } catch (err) {
    console.error("Error deleting game:", err);
    res.status(500).send({ message: "Failed to delete game", err: err.message });
  }
});

// Promote user to admin (owner only)
app.post("/api/admin/users/:userId/promote", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterRole = req.user.role;

    if (requesterRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Only the owner can promote users to admin." });
    }

    const [targetUsers] = await db_pool.query(
      "SELECT id, username, role FROM users WHERE id = ?",
      [userId]
    );

    if (targetUsers.length === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    const targetUser = targetUsers[0];

    if (targetUser.role === 'owner') {
      return res.status(400).send({ message: "User is already the owner" });
    }

    if (targetUser.role === 'admin') {
      return res.status(400).send({ message: "User is already an admin" });
    }

    await db_pool.query(
      "UPDATE users SET role = 'admin' WHERE id = ?",
      [userId]
    );

    res.json({ message: "User promoted to admin successfully" });
  } catch (err) {
    console.error("Error promoting user:", err);
    res.status(500).send({ message: "Failed to promote user", err: err.message });
  }
});

// Demote admin to user (owner only)
app.post("/api/admin/users/:userId/demote", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterRole = req.user.role;

    if (requesterRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Only the owner can demote admins." });
    }

    const [targetUsers] = await db_pool.query(
      "SELECT id, username, role FROM users WHERE id = ?",
      [userId]
    );

    if (targetUsers.length === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    const targetUser = targetUsers[0];

    if (targetUser.role === 'owner') {
      return res.status(400).send({ message: "Cannot demote the owner" });
    }

    if (targetUser.role === 'user') {
      return res.status(400).send({ message: "User is already a regular user" });
    }

    await db_pool.query(
      "UPDATE users SET role = 'user' WHERE id = ?",
      [userId]
    );

    res.json({ message: "Admin demoted to user successfully" });
  } catch (err) {
    console.error("Error demoting admin:", err);
    res.status(500).send({ message: "Failed to demote admin", err: err.message });
  }
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
    const { title, content, created_at, author_id, game_type_id } = req.body;
    console.log(content);
    
    // If this is a game forum, check if one already exists
    if (game_type_id) {
      const [existingForums] = await db_pool.query(
        'SELECT id FROM articles WHERE game_type_id = ? LIMIT 1',
        [game_type_id]
      );
      if (existingForums.length > 0) {
        return res.status(400).send({ 
          message: "A forum already exists for this game type",
          existing_forum_id: existingForums[0].id
        });
      }
    }
    
    const forum = await dbHelpers.createForum({ author_id, title, content, created_at, game_type_id });
    res.json({ result: forum });
  } catch (err) {
    console.error("Error in /api/forums/new:", err);
    res.status(500).send({ message: "Forum creation failed", err: err.message });
  }
});

app.get("/api/forums", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const gameTypeId = req.query.gameTypeId;
    
    // Build query with optional gameTypeId filter
    // Always exclude career postings (is_career = 1) and news articles (is_news = 1)
    let whereConditions = ["(is_career IS NULL OR is_career = 0)", "(is_news IS NULL OR is_news = 0)"];
    
    if (gameTypeId) {
      whereConditions.push(`game_type_id = ${db_pool.escape(gameTypeId)}`);
    }
    
    const whereClause = whereConditions.length > 0 ? ` WHERE ${whereConditions.join(" AND ")}` : "";
    
    let countQuery = "SELECT COUNT(*) as total FROM articles" + whereClause;
    let articlesQuery = "SELECT * FROM articles" + whereClause;
    
    articlesQuery += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    
    // Get total count
    const [countResult] = await db_pool.query(countQuery);
    const total = countResult[0].total;
    
    // Get paginated articles
    const [articles] = await db_pool.query(articlesQuery);
    
    // Enrich each forum with author name, comment count, likes, and game name
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
      
      // Get game name if this is a game forum
      if (forum.game_type_id) {
        try {
          const [gameRows] = await db_pool.query('SELECT game_name FROM game_types WHERE id = ?', [forum.game_type_id]);
          forum.game_name = gameRows.length > 0 ? gameRows[0].game_name : null;
        } catch (err) {
          console.error(`Error fetching game name for game_type_id ${forum.game_type_id}:`, err);
          forum.game_name = null;
        }
      }
      
      return forum;
    }));
    
    console.log("in get all forums route. Forums: " + forums.length);
    res.json({
      forums,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
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
    
    // Get game name if this is a game forum
    if (forum.game_type_id) {
      try {
        const [gameRows] = await db_pool.query('SELECT game_name FROM game_types WHERE id = ?', [forum.game_type_id]);
        forum.game_name = gameRows.length > 0 ? gameRows[0].game_name : null;
      } catch (err) {
        console.error(`Error fetching game name for game_type_id ${forum.game_type_id}:`, err);
        forum.game_name = null;
      }
    }

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
  try {
    const { author_id, title, content, created_at } = req.body;
    
    if (!author_id || !title || !content) {
      return res.status(400).send({ message: "Missing required fields" });
    }

    const [result] = await db_pool.query(
      `INSERT INTO articles (author_id, title, content, created_at, game_type_id, is_news, public) 
       VALUES (?, ?, ?, ?, NULL, 1, 1)`,
      [author_id, title, content, created_at || new Date()]
    );

    const newsArticle = {
      id: result.insertId,
      author_id,
      title,
      content,
      created_at: created_at || new Date()
    };

    res.json({ result: newsArticle, message: "News article created successfully" });
  } catch (err) {
    console.error("Error creating news article:", err);
    res.status(500).send({ message: "Failed to create news article", err: err.message });
  }
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

//  ---------------------- Careers ------------------------------

app.get("/api/careers", async (req, res) => {
  try {
    const [careers] = await db_pool.query(
      `SELECT 
        a.id as article_id,
        a.author_id,
        a.title,
        a.descript,
        a.content,
        a.created_at,
        a.genre,
        u.username as author_name
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      WHERE a.is_career = 1 AND a.public = 1
      ORDER BY a.created_at DESC`
    );

    res.json(careers);
  } catch (err) {
    console.error("Error fetching careers:", err);
    res.status(500).send({ message: "Failed to fetch job postings", err: err.message });
  }
});

// Get a single career posting by ID
app.get("/api/careers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [careers] = await db_pool.query(
      `SELECT 
        a.id as article_id,
        a.author_id,
        a.title,
        a.descript,
        a.content,
        a.created_at,
        a.genre,
        u.username as author_name
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      WHERE a.id = ? AND a.is_career = 1`,
      [id]
    );

    if (careers.length === 0) {
      return res.status(404).send({ message: "Job posting not found" });
    }

    res.json(careers[0]);
  } catch (err) {
    console.error("Error fetching career:", err);
    res.status(500).send({ message: "Failed to fetch job posting", err: err.message });
  }
});

app.post("/api/careers", async (req, res) => {
  try {
    const { author_id, title, descript, content, genre } = req.body;
    
    // Check if user is admin
    const [users] = await db_pool.query(
      "SELECT role FROM users WHERE id = ?",
      [author_id]
    );

    if (users.length === 0 || (users[0].role !== 'admin' && users[0].role !== 'owner')) {
      return res.status(403).send({ message: "Only owners can create job postings" });
    }

    if (!title || !content) {
      return res.status(400).send({ message: "Title and content are required" });
    }

    const [result] = await db_pool.query(
      `INSERT INTO articles (author_id, title, descript, content, created_at, game_type_id, is_career, public, genre) 
       VALUES (?, ?, ?, ?, NOW(), NULL, 1, 1, ?)`,
      [author_id, title, descript || null, content, genre || 'Careers']
    );

    const career = {
      article_id: result.insertId,
      author_id,
      title,
      descript,
      content,
      genre: genre || 'Careers',
      created_at: new Date()
    };

    res.json({ result: career, message: "Job posting created successfully" });
  } catch (err) {
    console.error("Error creating job posting:", err);
    res.status(500).send({ message: "Failed to create job posting", err: err.message });
  }
});

app.put("/api/careers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { author_id, title, descript, content, genre } = req.body;
    
    // Check if user is admin
    const [users] = await db_pool.query(
      "SELECT role FROM users WHERE id = ?",
      [author_id]
    );

    if (users.length === 0 || (users[0].role !== 'admin' && users[0].role !== 'owner')) {
      return res.status(403).send({ message: "Only owners can edit job postings" });
    }

    if (!title || !content) {
      return res.status(400).send({ message: "Title and content are required" });
    }

    await db_pool.query(
      `UPDATE articles 
       SET title = ?, descript = ?, content = ?, genre = ?, last_updated_at = NOW()
       WHERE id = ? AND is_career = 1`,
      [title, descript || null, content, genre || 'Careers', id]
    );

    res.json({ message: "Job posting updated successfully" });
  } catch (err) {
    console.error("Error updating job posting:", err);
    res.status(500).send({ message: "Failed to update job posting", err: err.message });
  }
});

app.delete("/api/careers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { author_id } = req.body;
    
    // Check if user is admin
    const [users] = await db_pool.query(
      "SELECT role FROM users WHERE id = ?",
      [author_id]
    );

    if (users.length === 0 || (users[0].role !== 'admin' && users[0].role !== 'owner')) {
      return res.status(403).send({ message: "Only owners can delete job postings" });
    }

    await db_pool.query(
      "DELETE FROM articles WHERE id = ? AND is_career = 1",
      [id]
    );

    res.json({ message: "Job posting deleted successfully" });
  } catch (err) {
    console.error("Error deleting job posting:", err);
    res.status(500).send({ message: "Failed to delete job posting", err: err.message });
  }
});

//  ---------------------- Token -----------------------------

app.post('/api/token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).send({ message: "Refresh token required" });
    }

    // Verify the refresh token JWT signature
    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, async (err, user) => {
      if (err) {
        return res.status(403).send({ message: "Invalid refresh token" });
      }

      // Check if user exists and is not banned (but allow multiple devices - don't require exact token match)
      const [users] = await db_pool.query(
        "SELECT id, username, role, banned, ban_expires_at FROM users WHERE id = ?",
        [user.id]
      );

      if (users.length === 0) {
        return res.status(403).send({ message: "User not found" });
      }

      const dbUser = users[0];

      // Check if user is banned
      if (dbUser.banned) {
        // Check if ban has expired
        if (dbUser.ban_expires_at && new Date(dbUser.ban_expires_at) < new Date()) {
          // Ban expired, unban the user
          await db_pool.query(
            "UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
            [dbUser.id]
          );
        } else {
          return res.status(403).send({ message: "Your account is banned", banned: true });
        }
      }

      // Generate new access token
      const userPayload = { id: dbUser.id, username: dbUser.username, role: dbUser.role };
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

    // Force player_count to 2 (only 2-player games currently supported)
    gameData.player_count = 2;

    // Log the randomized_starting_positions length if present
    if (gameData.randomized_starting_positions) {
      console.log('randomized_starting_positions length:', gameData.randomized_starting_positions.length);
      // TEXT column can handle up to 65,535 characters
      if (gameData.randomized_starting_positions.length > 65000) {
        console.warn('WARNING: randomized_starting_positions exceeds reasonable size!');
        return res.status(400).send({ 
          message: "Randomized starting positions data is too large. Please simplify your game configuration.",
          length: gameData.randomized_starting_positions.length 
        });
      }
    }

    // Build the SQL query
    const sql = `
      INSERT INTO game_types (
        creator_id, game_name, descript, rules,
        mate_condition, mate_piece, capture_condition, capture_piece,
        value_condition, value_piece, value_max, value_title,
        squares_condition, squares_count, hill_condition, hill_x, hill_y, hill_turns,
        actions_per_turn, board_width, board_height, player_count,
        starting_piece_count, range_squares_string,
        promotion_squares_string, special_squares_string,
        randomized_starting_positions, other_game_data, optional_condition, draw_move_limit, repetition_draw_count,
        pieces_string
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      creator_id,
      gameData.game_name,
      gameData.descript,
      gameData.rules,
      gameData.mate_condition || false,
      gameData.mate_piece != null ? gameData.mate_piece : null,
      gameData.capture_condition || false,
      gameData.capture_piece != null ? gameData.capture_piece : null,
      gameData.value_condition || false,
      gameData.value_piece != null ? gameData.value_piece : null,
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
      gameData.range_squares_string || null,
      gameData.promotion_squares_string || null,
      gameData.special_squares_string || null,
      gameData.randomized_starting_positions || null,
      gameData.other_game_data || null,
      gameData.optional_condition || null,
      gameData.draw_move_limit != null ? gameData.draw_move_limit : null,
      gameData.repetition_draw_count != null && gameData.repetition_draw_count >= 2 && gameData.repetition_draw_count <= 9 ? gameData.repetition_draw_count : null,
      gameData.pieces_string || '{}'
    ];

    const [result] = await db_pool.query(sql, values);
    
    const gameId = result.insertId;

    // Insert pieces into junction table if provided
    if (gameData.pieces_string) {
      try {
        const piecesData = JSON.parse(gameData.pieces_string);
        let piecesToInsert = [];

        // Handle both array and object formats
        if (Array.isArray(piecesData)) {
          piecesToInsert = piecesData;
        } else if (typeof piecesData === 'object') {
          // Convert object format {"row,col": {...}} to array
          // The key determines the position - use it as the source of truth
          piecesToInsert = Object.entries(piecesData).map(([key, piece]) => {
            const [row, col] = key.split(',').map(Number);
            return {
              ...piece,
              // Key is the source of truth for position (handles 0 values correctly)
              x: col,
              y: row
            };
          });
        }

        // Insert each piece
        for (const piece of piecesToInsert) {
          if (piece.piece_id) {
            await dbHelpers.addPieceToGameType(
              gameId,
              piece.piece_id,
              piece.x ?? 0,
              piece.y ?? 0,
              Number(piece.player_id ?? piece.player_number ?? piece.player ?? 1),
              piece.ends_game_on_checkmate || false,
              piece.ends_game_on_capture || false,
              piece.manual_castling_partners || false,
              piece.castling_partner_left_key || null,
              piece.castling_partner_right_key || null
            );
          }
        }
      } catch (parseError) {
        console.error('Error parsing pieces_string:', parseError);
      }
    }
    
    // Automatically create a forum for this game
    const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const forumTitle = `${gameData.game_name} - Discussion`;
    const forumContent = `Welcome to the ${gameData.game_name} discussion forum! Share strategies, ask questions, and connect with other players of this game.${gameData.descript ? '\n\n' + gameData.descript : ''}`;
    
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
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      sqlMessage: err.sqlMessage,
      sql: err.sql
    });
    res.status(500).send({ 
      message: "Failed to create game", 
      error: err.message,
      details: err.sqlMessage || err.message 
    });
  }
});

// ----------------------- Pieces Create ------------------------------

const parseBooleanField = (value) => value === true || value === 'true' || value === 1 || value === '1';

app.post("/api/pieces/create", pieceUpload.array('piece_images', 8), async (req, res) => {
  try {
    const pieceData = req.body;
    const imageFiles = Array.isArray(req.files) ? req.files : [];

    if (!imageFiles || imageFiles.length === 0) {
      return res.status(400).send({ message: "At least one piece image is required" });
    }

    const imagePaths = imageFiles.map(file => `/uploads/pieces/${file.filename}`);
    const imagesJSON = JSON.stringify(imagePaths);
    const hasRangedAttack = pieceData.can_capture_enemy_via_range === 'true';

    // Insert into consolidated pieces table (all fields in one table now)
    const pieceSql = `
      INSERT INTO pieces (
        piece_name, image_location, piece_width, piece_height, creator_id, piece_description,
        piece_category, has_checkmate_rule, has_check_rule, has_lose_on_capture_rule, can_castle, can_promote,
        directional_movement_style, repeating_movement, max_directional_movement_iterations, min_directional_movement_iterations,
        up_left_movement, up_movement, up_right_movement, right_movement, down_right_movement, down_movement, down_left_movement, left_movement,
        up_left_movement_exact, up_movement_exact, up_right_movement_exact, right_movement_exact, 
        down_right_movement_exact, down_movement_exact, down_left_movement_exact, left_movement_exact,
        up_left_movement_available_for, up_movement_available_for, up_right_movement_available_for, right_movement_available_for,
        down_right_movement_available_for, down_movement_available_for, down_left_movement_available_for, left_movement_available_for,
        ratio_movement_style, ratio_one_movement, ratio_two_movement, repeating_ratio, max_ratio_iterations, min_ratio_iterations,
        step_by_step_movement_style, step_by_step_movement_value,
        can_hop_over_allies, can_hop_over_enemies, min_turns_per_move, max_turns_per_move,
        first_move_only, available_for_moves, special_scenario_moves,
        can_capture_enemy_via_range, can_capture_ally_via_range, can_capture_enemy_on_move, can_capture_ally_on_range, can_attack_on_iteration,
        first_move_only_capture, available_for_captures,
        up_left_capture, up_capture, up_right_capture, right_capture, down_right_capture, down_capture, down_left_capture, left_capture,
        up_left_capture_exact, up_capture_exact, up_right_capture_exact, right_capture_exact,
        down_right_capture_exact, down_capture_exact, down_left_capture_exact, left_capture_exact,
        up_left_capture_available_for, up_capture_available_for, up_right_capture_available_for, right_capture_available_for,
        down_right_capture_available_for, down_capture_available_for, down_left_capture_available_for, left_capture_available_for,
        ratio_one_capture, ratio_two_capture, step_by_step_capture,
        up_left_attack_range, up_attack_range, up_right_attack_range, right_attack_range, down_right_attack_range, down_attack_range, down_left_attack_range, left_attack_range,
        up_left_attack_range_exact, up_attack_range_exact, up_right_attack_range_exact, right_attack_range_exact,
        down_right_attack_range_exact, down_attack_range_exact, down_left_attack_range_exact, left_attack_range_exact,
        up_left_attack_range_available_for, up_attack_range_available_for, up_right_attack_range_available_for, right_attack_range_available_for,
        down_right_attack_range_available_for, down_attack_range_available_for, down_left_attack_range_available_for, left_attack_range_available_for,
        repeating_directional_ranged_attack, max_directional_ranged_attack_iterations, min_directional_ranged_attack_iterations,
        ratio_one_attack_range, ratio_two_attack_range, repeating_ratio_ranged_attack, max_ratio_ranged_attack_iterations, min_ratio_ranged_attack_iterations,
        step_by_step_attack_style, step_by_step_attack_value,
        max_piece_captures_per_move, max_piece_captures_per_ranged_attack,
        special_scenario_captures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const pieceValues = [
      pieceData.piece_name,
      imagesJSON,
      parseInt(pieceData.piece_width) || 1,
      parseInt(pieceData.piece_height) || 1,
      parseInt(pieceData.creator_id) || null,
      pieceData.piece_description || null,
      // Piece metadata
      pieceData.piece_category || null,
      pieceData.has_checkmate_rule === 'true',
      pieceData.has_check_rule === 'true',
      pieceData.has_lose_on_capture_rule === 'true',
      pieceData.can_castle === 'true',
      pieceData.can_promote === 'true',
      // Movement fields
      parseBooleanField(pieceData.directional_movement_style),
      parseBooleanField(pieceData.repeating_movement),
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
      // Movement exact flags
      pieceData.up_left_movement_exact === 'true' || pieceData.up_left_movement_exact === true,
      pieceData.up_movement_exact === 'true' || pieceData.up_movement_exact === true,
      pieceData.up_right_movement_exact === 'true' || pieceData.up_right_movement_exact === true,
      pieceData.right_movement_exact === 'true' || pieceData.right_movement_exact === true,
      pieceData.down_right_movement_exact === 'true' || pieceData.down_right_movement_exact === true,
      pieceData.down_movement_exact === 'true' || pieceData.down_movement_exact === true,
      pieceData.down_left_movement_exact === 'true' || pieceData.down_left_movement_exact === true,
      pieceData.left_movement_exact === 'true' || pieceData.left_movement_exact === true,
      // Movement available_for flags
      parseInt(pieceData.up_left_movement_available_for) || null,
      parseInt(pieceData.up_movement_available_for) || null,
      parseInt(pieceData.up_right_movement_available_for) || null,
      parseInt(pieceData.right_movement_available_for) || null,
      parseInt(pieceData.down_right_movement_available_for) || null,
      parseInt(pieceData.down_movement_available_for) || null,
      parseInt(pieceData.down_left_movement_available_for) || null,
      parseInt(pieceData.left_movement_available_for) || null,
      parseBooleanField(pieceData.ratio_movement_style),
      parseInt(pieceData.ratio_one_movement) || null,
      parseInt(pieceData.ratio_two_movement) || null,
      parseBooleanField(pieceData.repeating_ratio),
      parseInt(pieceData.max_ratio_iterations) || null,
      parseInt(pieceData.min_ratio_iterations) || null,
      parseBooleanField(pieceData.step_by_step_movement_style),
      parseInt(pieceData.step_by_step_movement_value) || null,
      parseBooleanField(pieceData.can_hop_over_allies),
      parseBooleanField(pieceData.can_hop_over_enemies),
      parseInt(pieceData.min_turns_per_move) || null,
      parseInt(pieceData.max_turns_per_move) || null,
      // Movement special scenario fields
      pieceData.first_move_only === 'true',
      parseInt(pieceData.available_for_moves) || null,
      Array.isArray(pieceData.special_scenario_moves) 
        ? (pieceData.special_scenario_moves.find(s => s && s.length > 0) || null)
        : (pieceData.special_scenario_moves || null),
      // Capture fields
      hasRangedAttack,
      pieceData.can_capture_ally_via_range === 'true',
      pieceData.can_capture_enemy_on_move === 'true',
      pieceData.can_capture_ally_on_range === 'true',
      pieceData.can_attack_on_iteration === 'true',
      // Capture special scenario fields
      pieceData.first_move_only_capture === 'true',
      parseInt(pieceData.available_for_captures) || null,
      // Capture directional values
      parseInt(pieceData.up_left_capture) || 0,
      parseInt(pieceData.up_capture) || 0,
      parseInt(pieceData.up_right_capture) || 0,
      parseInt(pieceData.right_capture) || 0,
      parseInt(pieceData.down_right_capture) || 0,
      parseInt(pieceData.down_capture) || 0,
      parseInt(pieceData.down_left_capture) || 0,
      parseInt(pieceData.left_capture) || 0,
      // Capture exact flags
      pieceData.up_left_capture_exact === 'true' || pieceData.up_left_capture_exact === true,
      pieceData.up_capture_exact === 'true' || pieceData.up_capture_exact === true,
      pieceData.up_right_capture_exact === 'true' || pieceData.up_right_capture_exact === true,
      pieceData.right_capture_exact === 'true' || pieceData.right_capture_exact === true,
      pieceData.down_right_capture_exact === 'true' || pieceData.down_right_capture_exact === true,
      pieceData.down_capture_exact === 'true' || pieceData.down_capture_exact === true,
      pieceData.down_left_capture_exact === 'true' || pieceData.down_left_capture_exact === true,
      pieceData.left_capture_exact === 'true' || pieceData.left_capture_exact === true,
      // Capture available_for flags
      parseInt(pieceData.up_left_capture_available_for) || null,
      parseInt(pieceData.up_capture_available_for) || null,
      parseInt(pieceData.up_right_capture_available_for) || null,
      parseInt(pieceData.right_capture_available_for) || null,
      parseInt(pieceData.down_right_capture_available_for) || null,
      parseInt(pieceData.down_capture_available_for) || null,
      parseInt(pieceData.down_left_capture_available_for) || null,
      parseInt(pieceData.left_capture_available_for) || null,
      parseInt(pieceData.ratio_one_capture) || null,
      parseInt(pieceData.ratio_two_capture) || null,
      parseInt(pieceData.step_by_step_capture) || null,
      // Attack range values
      parseInt(pieceData.up_left_attack_range) || 0,
      parseInt(pieceData.up_attack_range) || 0,
      parseInt(pieceData.up_right_attack_range) || 0,
      parseInt(pieceData.right_attack_range) || 0,
      parseInt(pieceData.down_right_attack_range) || 0,
      parseInt(pieceData.down_attack_range) || 0,
      parseInt(pieceData.down_left_attack_range) || 0,
      parseInt(pieceData.left_attack_range) || 0,
      // Attack range exact flags
      pieceData.up_left_attack_range_exact === 'true' || pieceData.up_left_attack_range_exact === true,
      pieceData.up_attack_range_exact === 'true' || pieceData.up_attack_range_exact === true,
      pieceData.up_right_attack_range_exact === 'true' || pieceData.up_right_attack_range_exact === true,
      pieceData.right_attack_range_exact === 'true' || pieceData.right_attack_range_exact === true,
      pieceData.down_right_attack_range_exact === 'true' || pieceData.down_right_attack_range_exact === true,
      pieceData.down_attack_range_exact === 'true' || pieceData.down_attack_range_exact === true,
      pieceData.down_left_attack_range_exact === 'true' || pieceData.down_left_attack_range_exact === true,
      pieceData.left_attack_range_exact === 'true' || pieceData.left_attack_range_exact === true,
      // Attack range available_for flags
      parseInt(pieceData.up_left_attack_range_available_for) || null,
      parseInt(pieceData.up_attack_range_available_for) || null,
      parseInt(pieceData.up_right_attack_range_available_for) || null,
      parseInt(pieceData.right_attack_range_available_for) || null,
      parseInt(pieceData.down_right_attack_range_available_for) || null,
      parseInt(pieceData.down_attack_range_available_for) || null,
      parseInt(pieceData.down_left_attack_range_available_for) || null,
      parseInt(pieceData.left_attack_range_available_for) || null,
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
      parseInt(pieceData.max_piece_captures_per_move) || 1,
      hasRangedAttack ? (parseInt(pieceData.max_piece_captures_per_ranged_attack) || 1) : null,
      pieceData.special_scenario_captures || null
    ];

    const [result] = await db_pool.query(pieceSql, pieceValues);
    const pieceId = result.insertId;

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
    if (existingPiece.creator_id !== parseInt(pieceData.creator_id) && pieceData.user_role !== 'admin' && pieceData.user_role !== 'owner') {
      return res.status(403).send({ message: "You don't have permission to edit this piece" });
    }

    // Handle images
    let imagesJSON = existingPiece.image_location; // Keep existing if no new images
    
    // Parse the original images from the database
    let originalImagePaths = [];
    try {
      originalImagePaths = JSON.parse(existingPiece.image_location || '[]');
    } catch (err) {
      console.error("Error parsing original image_location:", err);
    }
    
    // Parse the images the user wants to keep
    let keptImagePaths = [];
    if (pieceData.existing_images) {
      try {
        keptImagePaths = JSON.parse(pieceData.existing_images);
      } catch (err) {
        console.error("Error parsing existing_images:", err);
      }
    }
    
    // Find images that were removed (in original but not in kept)
    const removedImages = originalImagePaths.filter(img => !keptImagePaths.includes(img));
    
    // Delete removed images from filesystem
    for (const imagePath of removedImages) {
      try {
        const fullPath = path.join(__dirname, '..', imagePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`Deleted removed piece image: ${fullPath}`);
        }
      } catch (err) {
        console.error(`Error deleting image ${imagePath}:`, err.message);
      }
    }
    
    // Add new image paths if any
    const newImagePaths = imageFiles ? imageFiles.map(file => `/uploads/pieces/${file.filename}`) : [];
    
    // Combine kept and new images (max 8 total)
    const allImagePaths = [...keptImagePaths, ...newImagePaths].slice(0, 8);
    imagesJSON = JSON.stringify(allImagePaths);

    const hasRangedAttack = pieceData.can_capture_enemy_via_range === 'true';
    
    // Update consolidated pieces table (all fields in one table now)
    const pieceSql = `
      UPDATE pieces SET
        piece_name = ?,
        image_location = ?,
        piece_width = ?,
        piece_height = ?,
        piece_description = ?,
        piece_category = ?,
        has_checkmate_rule = ?,
        has_check_rule = ?,
        has_lose_on_capture_rule = ?,
        can_castle = ?,
        can_promote = ?,
        directional_movement_style = ?,
        repeating_movement = ?,
        max_directional_movement_iterations = ?,
        min_directional_movement_iterations = ?,
        up_left_movement = ?,
        up_movement = ?,
        up_right_movement = ?,
        right_movement = ?,
        down_right_movement = ?,
        down_movement = ?,
        down_left_movement = ?,
        left_movement = ?,
        up_left_movement_exact = ?,
        up_movement_exact = ?,
        up_right_movement_exact = ?,
        right_movement_exact = ?,
        down_right_movement_exact = ?,
        down_movement_exact = ?,
        down_left_movement_exact = ?,
        left_movement_exact = ?,
        up_left_movement_available_for = ?,
        up_movement_available_for = ?,
        up_right_movement_available_for = ?,
        right_movement_available_for = ?,
        down_right_movement_available_for = ?,
        down_movement_available_for = ?,
        down_left_movement_available_for = ?,
        left_movement_available_for = ?,
        ratio_movement_style = ?,
        ratio_one_movement = ?,
        ratio_two_movement = ?,
        repeating_ratio = ?,
        max_ratio_iterations = ?,
        min_ratio_iterations = ?,
        step_by_step_movement_style = ?,
        step_by_step_movement_value = ?,
        can_hop_over_allies = ?,
        can_hop_over_enemies = ?,
        min_turns_per_move = ?,
        max_turns_per_move = ?,
        first_move_only = ?,
        available_for_moves = ?,
        special_scenario_moves = ?,
        can_capture_enemy_via_range = ?,
        can_capture_ally_via_range = ?,
        can_capture_enemy_on_move = ?,
        can_capture_ally_on_range = ?,
        can_attack_on_iteration = ?,
        first_move_only_capture = ?,
        available_for_captures = ?,
        up_left_capture = ?,
        up_capture = ?,
        up_right_capture = ?,
        right_capture = ?,
        down_right_capture = ?,
        down_capture = ?,
        down_left_capture = ?,
        left_capture = ?,
        up_left_capture_exact = ?,
        up_capture_exact = ?,
        up_right_capture_exact = ?,
        right_capture_exact = ?,
        down_right_capture_exact = ?,
        down_capture_exact = ?,
        down_left_capture_exact = ?,
        left_capture_exact = ?,
        up_left_capture_available_for = ?,
        up_capture_available_for = ?,
        up_right_capture_available_for = ?,
        right_capture_available_for = ?,
        down_right_capture_available_for = ?,
        down_capture_available_for = ?,
        down_left_capture_available_for = ?,
        left_capture_available_for = ?,
        ratio_one_capture = ?,
        ratio_two_capture = ?,
        step_by_step_capture = ?,
        up_left_attack_range = ?,
        up_attack_range = ?,
        up_right_attack_range = ?,
        right_attack_range = ?,
        down_right_attack_range = ?,
        down_attack_range = ?,
        down_left_attack_range = ?,
        left_attack_range = ?,
        up_left_attack_range_exact = ?,
        up_attack_range_exact = ?,
        up_right_attack_range_exact = ?,
        right_attack_range_exact = ?,
        down_right_attack_range_exact = ?,
        down_attack_range_exact = ?,
        down_left_attack_range_exact = ?,
        left_attack_range_exact = ?,
        up_left_attack_range_available_for = ?,
        up_attack_range_available_for = ?,
        up_right_attack_range_available_for = ?,
        right_attack_range_available_for = ?,
        down_right_attack_range_available_for = ?,
        down_attack_range_available_for = ?,
        down_left_attack_range_available_for = ?,
        left_attack_range_available_for = ?,
        repeating_directional_ranged_attack = ?,
        max_directional_ranged_attack_iterations = ?,
        min_directional_ranged_attack_iterations = ?,
        ratio_one_attack_range = ?,
        ratio_two_attack_range = ?,
        repeating_ratio_ranged_attack = ?,
        max_ratio_ranged_attack_iterations = ?,
        min_ratio_ranged_attack_iterations = ?,
        step_by_step_attack_style = ?,
        step_by_step_attack_value = ?,
        max_piece_captures_per_move = ?,
        max_piece_captures_per_ranged_attack = ?,
        special_scenario_captures = ?
      WHERE id = ?
    `;

    const pieceValues = [
      pieceData.piece_name,
      imagesJSON,
      parseInt(pieceData.piece_width) || 1,
      parseInt(pieceData.piece_height) || 1,
      pieceData.piece_description || null,
      pieceData.piece_category || null,
      pieceData.has_checkmate_rule === 'true',
      pieceData.has_check_rule === 'true',
      pieceData.has_lose_on_capture_rule === 'true',
      pieceData.can_castle === 'true',
      pieceData.can_promote === 'true',
      // Movement fields
      parseBooleanField(pieceData.directional_movement_style),
      parseBooleanField(pieceData.repeating_movement),
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
      // Movement exact flags
      pieceData.up_left_movement_exact === 'true' || pieceData.up_left_movement_exact === true,
      pieceData.up_movement_exact === 'true' || pieceData.up_movement_exact === true,
      pieceData.up_right_movement_exact === 'true' || pieceData.up_right_movement_exact === true,
      pieceData.right_movement_exact === 'true' || pieceData.right_movement_exact === true,
      pieceData.down_right_movement_exact === 'true' || pieceData.down_right_movement_exact === true,
      pieceData.down_movement_exact === 'true' || pieceData.down_movement_exact === true,
      pieceData.down_left_movement_exact === 'true' || pieceData.down_left_movement_exact === true,
      pieceData.left_movement_exact === 'true' || pieceData.left_movement_exact === true,
      // Movement available_for flags
      parseInt(pieceData.up_left_movement_available_for) || null,
      parseInt(pieceData.up_movement_available_for) || null,
      parseInt(pieceData.up_right_movement_available_for) || null,
      parseInt(pieceData.right_movement_available_for) || null,
      parseInt(pieceData.down_right_movement_available_for) || null,
      parseInt(pieceData.down_movement_available_for) || null,
      parseInt(pieceData.down_left_movement_available_for) || null,
      parseInt(pieceData.left_movement_available_for) || null,
      parseBooleanField(pieceData.ratio_movement_style),
      parseInt(pieceData.ratio_one_movement) || null,
      parseInt(pieceData.ratio_two_movement) || null,
      parseBooleanField(pieceData.repeating_ratio),
      parseInt(pieceData.max_ratio_iterations) || null,
      parseInt(pieceData.min_ratio_iterations) || null,
      parseBooleanField(pieceData.step_by_step_movement_style),
      parseInt(pieceData.step_by_step_movement_value) || null,
      parseBooleanField(pieceData.can_hop_over_allies),
      parseBooleanField(pieceData.can_hop_over_enemies),
      parseInt(pieceData.min_turns_per_move) || null,
      parseInt(pieceData.max_turns_per_move) || null,
      // Movement special scenario fields
      pieceData.first_move_only === 'true',
      parseInt(pieceData.available_for_moves) || null,
      Array.isArray(pieceData.special_scenario_moves) 
        ? (pieceData.special_scenario_moves.find(s => s && s.length > 0) || null)
        : (pieceData.special_scenario_moves || null),
      // Capture fields
      hasRangedAttack,
      pieceData.can_capture_ally_via_range === 'true',
      pieceData.can_capture_enemy_on_move === 'true',
      pieceData.can_capture_ally_on_range === 'true',
      pieceData.can_attack_on_iteration === 'true',
      // Capture special scenario fields
      pieceData.first_move_only_capture === 'true',
      parseInt(pieceData.available_for_captures) || null,
      // Capture directional values
      parseInt(pieceData.up_left_capture) || 0,
      parseInt(pieceData.up_capture) || 0,
      parseInt(pieceData.up_right_capture) || 0,
      parseInt(pieceData.right_capture) || 0,
      parseInt(pieceData.down_right_capture) || 0,
      parseInt(pieceData.down_capture) || 0,
      parseInt(pieceData.down_left_capture) || 0,
      parseInt(pieceData.left_capture) || 0,
      // Capture exact flags
      pieceData.up_left_capture_exact === 'true' || pieceData.up_left_capture_exact === true,
      pieceData.up_capture_exact === 'true' || pieceData.up_capture_exact === true,
      pieceData.up_right_capture_exact === 'true' || pieceData.up_right_capture_exact === true,
      pieceData.right_capture_exact === 'true' || pieceData.right_capture_exact === true,
      pieceData.down_right_capture_exact === 'true' || pieceData.down_right_capture_exact === true,
      pieceData.down_capture_exact === 'true' || pieceData.down_capture_exact === true,
      pieceData.down_left_capture_exact === 'true' || pieceData.down_left_capture_exact === true,
      pieceData.left_capture_exact === 'true' || pieceData.left_capture_exact === true,
      // Capture available_for flags
      parseInt(pieceData.up_left_capture_available_for) || null,
      parseInt(pieceData.up_capture_available_for) || null,
      parseInt(pieceData.up_right_capture_available_for) || null,
      parseInt(pieceData.right_capture_available_for) || null,
      parseInt(pieceData.down_right_capture_available_for) || null,
      parseInt(pieceData.down_capture_available_for) || null,
      parseInt(pieceData.down_left_capture_available_for) || null,
      parseInt(pieceData.left_capture_available_for) || null,
      parseInt(pieceData.ratio_one_capture) || null,
      parseInt(pieceData.ratio_two_capture) || null,
      parseInt(pieceData.step_by_step_capture) || null,
      // Attack range values
      parseInt(pieceData.up_left_attack_range) || 0,
      parseInt(pieceData.up_attack_range) || 0,
      parseInt(pieceData.up_right_attack_range) || 0,
      parseInt(pieceData.right_attack_range) || 0,
      parseInt(pieceData.down_right_attack_range) || 0,
      parseInt(pieceData.down_attack_range) || 0,
      parseInt(pieceData.down_left_attack_range) || 0,
      parseInt(pieceData.left_attack_range) || 0,
      // Attack range exact flags
      pieceData.up_left_attack_range_exact === 'true' || pieceData.up_left_attack_range_exact === true,
      pieceData.up_attack_range_exact === 'true' || pieceData.up_attack_range_exact === true,
      pieceData.up_right_attack_range_exact === 'true' || pieceData.up_right_attack_range_exact === true,
      pieceData.right_attack_range_exact === 'true' || pieceData.right_attack_range_exact === true,
      pieceData.down_right_attack_range_exact === 'true' || pieceData.down_right_attack_range_exact === true,
      pieceData.down_attack_range_exact === 'true' || pieceData.down_attack_range_exact === true,
      pieceData.down_left_attack_range_exact === 'true' || pieceData.down_left_attack_range_exact === true,
      pieceData.left_attack_range_exact === 'true' || pieceData.left_attack_range_exact === true,
      // Attack range available_for flags
      parseInt(pieceData.up_left_attack_range_available_for) || null,
      parseInt(pieceData.up_attack_range_available_for) || null,
      parseInt(pieceData.up_right_attack_range_available_for) || null,
      parseInt(pieceData.right_attack_range_available_for) || null,
      parseInt(pieceData.down_right_attack_range_available_for) || null,
      parseInt(pieceData.down_attack_range_available_for) || null,
      parseInt(pieceData.down_left_attack_range_available_for) || null,
      parseInt(pieceData.left_attack_range_available_for) || null,
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
      parseInt(pieceData.max_piece_captures_per_move) || 1,
      hasRangedAttack ? (parseInt(pieceData.max_piece_captures_per_ranged_attack) || 1) : null,
      pieceData.special_scenario_captures || null,
      pieceId
    ];

    await db_pool.query(pieceSql, pieceValues);

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
    if (existingPiece.creator_id !== parseInt(userId) && userRole !== 'admin' && userRole !== 'owner') {
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
    if (err) {
      // Only log unexpected errors, not routine token expirations
      if (err.name !== 'TokenExpiredError') {
        console.log('JWT verification failed:', err.message);
      }
      return res.status(403).send({ message: "Invalid or expired token" });
    }
    req.user = user
    next()
  })
}

// Optional authentication - sets req.user if token is valid, but doesn't fail if not
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (token == null) {
    return next(); // No token, continue without user
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (!err) {
      req.user = user;
    }
    next(); // Continue regardless of token validity
  })
}

function authenticateAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner') {
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
  // Refresh tokens expire in 30 days (extended from 7 days for better UX)
  const token = jwt.sign(user, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '30d' });
  return token;
}

// Security: Track failed login attempts
function trackFailedLogin(lockoutKey) {
  const attempts = loginAttempts.get(lockoutKey) || { count: 0 };
  attempts.count += 1;
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockoutUntil = Date.now() + LOGIN_LOCKOUT_TIME;
  }
  loginAttempts.set(lockoutKey, attempts);
}

// Security: Clean up old lockout entries periodically (every hour)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of loginAttempts.entries()) {
    if (value.lockoutUntil && now > value.lockoutUntil) {
      loginAttempts.delete(key);
    }
  }
}, 60 * 60 * 1000);

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
       p.directional_movement_style as movement_directional, 
       p.ratio_movement_style as movement_ratio,
       p.can_capture_enemy_on_move as can_capture
       FROM pieces p
       LEFT JOIN users u ON p.creator_id = u.id
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
      `SELECT a.*, u.username as author_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       WHERE a.game_type_id IS NULL
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query(
      "SELECT COUNT(*) as total FROM articles WHERE game_type_id IS NULL"
    );

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

// Get single news article (admin only)
app.get("/api/admin/news/:newsId", authenticateAdmin, async (req, res) => {
  try {
    const { newsId } = req.params;
    
    const [[news]] = await db_pool.query(
      `SELECT a.*, u.username as author_name
       FROM articles a
       LEFT JOIN users u ON a.author_id = u.id
       WHERE a.id = ? AND a.game_type_id IS NULL`,
      [newsId]
    );

    if (!news) {
      return res.status(404).send({ message: "News article not found" });
    }

    res.json({ data: news });
  } catch (err) {
    console.error("Error in /api/admin/news/:newsId:", err);
    res.status(500).send({ message: "Failed to fetch news article", err: err.message });
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
    
    // Map frontend field names to database column names
    const fieldMapping = {
      'movement_': '',
      'attack_': ''
    };
    
    const allFields = Object.keys(updates).filter(key => key !== 'id');
    if (allFields.length === 0) {
      return res.status(400).send({ message: "No fields to update" });
    }
    
    // Map field names - remove movement_ and attack_ prefixes
    const mappedFields = {};
    allFields.forEach(key => {
      let dbField = key;
      if (key.startsWith('movement_')) {
        dbField = key.replace('movement_', '');
      } else if (key.startsWith('attack_')) {
        dbField = key.replace('attack_', '');
      }
      mappedFields[dbField] = updates[key];
    });
    
    const setClause = Object.keys(mappedFields).map(field => `${field} = ?`).join(', ');
    const values = Object.values(mappedFields);
    values.push(pieceId);
    
    await db_pool.query(`UPDATE pieces SET ${setClause} WHERE id = ?`, values);

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

    await db_pool.query(`UPDATE articles SET ${setClause} WHERE id = ? AND game_type_id IS NULL`, values);

    const [[updatedNews]] = await db_pool.query(
      "SELECT * FROM articles WHERE id = ? AND game_type_id IS NULL", 
      [newsId]
    );

    res.json({ success: true, news: updatedNews, message: "News updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/news/:newsId (PUT):", err);
    res.status(500).send({ message: "Failed to update news", err: err.message });
  }
});

//  -----------------------  Other/Port -------------------------

// ═══════════════════════════════════════════════════════════════════════════
//  PAYMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Create Stripe checkout session
app.post("/api/create-stripe-checkout", async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Squarestrat Donation',
              description: 'Support the development of Squarestrat',
            },
            unit_amount: Math.round(amount * 100), // Convert dollars to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/donate?success=true&amount=${amount}&method=stripe`,
      cancel_url: `${process.env.CLIENT_URL}/donate`,
    });

    // Return the checkout URL for direct redirect
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Confirm donation and send email (called from frontend after successful payment)
app.post("/api/confirm-donation", async (req, res) => {
  try {
    const { email, username, amount } = req.body;
    
    if (!email || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update user's total donations in database
    try {
      await dbHelpers.updateUserDonations(email, parseFloat(amount));
      console.log(`✅ Updated total donations for ${email}: +$${amount}`);
    } catch (dbError) {
      console.error('⚠️ Failed to update donation total:', dbError.message);
      // Continue anyway - email is more important than tracking
    }

    // Send donation thank you email (non-blocking, won't fail if SendGrid not configured)
    sendDonationEmail(email, username, amount)
      .then(result => {
        if (result.success) {
          console.log(`✅ Donation email sent to ${email}`);
        } else {
          console.log(`⚠️ Donation email not sent: ${result.message}`);
        }
      })
      .catch(err => {
        console.error('⚠️ Email sending failed:', err.message);
      });
    
    // Always return success - the donation was successful regardless of email
    res.json({ message: 'Donation confirmed', emailStatus: 'pending' });
  } catch (error) {
    console.error('Donation confirmation error:', error);
    res.status(500).json({ error: 'Failed to confirm donation' });
  }
});

// Contact form endpoint
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Send contact email (non-blocking)
    const result = await sendContactEmail(name, email, subject, message);
    
    if (result.success) {
      res.json({ message: 'Message sent successfully' });
    } else {
      res.status(500).json({ 
        error: 'Failed to send message', 
        details: result.message 
      });
    }
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// All other GET requests not handled before will return our React app
app.get('/api/*', (req, res) => {
  res.json({ message: "No data to return from this endpoint!" });
});

// Create HTTP server and initialize Socket.io
const server = http.createServer(app);
const io = initializeSocket(server);

// Store io instance for use in routes if needed
app.set('io', io);

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  console.log(`Socket.io ready for connections`);
});