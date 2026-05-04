// --- Game Session Limits ---
const GAME_LIMITS = {
  live: 8,
  correspondence: 24,
  challenge: 16,
  open: 8,
  live_anon: 4,
  correspondence_anon: 12,
  challenge_anon: 8,
  open_anon: 4,
};

/**
 * Count the number of active games for a user (by userId or anonId).
 * Types: live, correspondence, challenge, open. Status: waiting, ready, active.
 * Returns { live, correspondence, challenge, open }
 */
async function countUserActiveGames(identifier) {
  // identifier: userId (number) or anonId (string)
  const isAnon = typeof identifier === 'string' && identifier.startsWith('anon_');
  let userWhere = isAnon
    ? '(g.player1_anon_id = ? OR g.player2_anon_id = ?)' // adjust if anon columns differ
    : '(p1.user_id = ? OR p2.user_id = ?)';
  let params = isAnon ? [identifier, identifier] : [identifier, identifier];
  const [rows] = await db_pool.query(`
    SELECT g.is_correspondence, g.is_challenge, g.status
    FROM games g
    LEFT JOIN players p1 ON g.id = p1.game_id AND p1.player_position = 1
    LEFT JOIN players p2 ON g.id = p2.game_id AND p2.player_position = 2
    WHERE ${userWhere} AND g.status IN ('active','ready','waiting')
  `, params);
  let live = 0, correspondence = 0, challenge = 0, open = 0;
  for (const row of rows) {
    if (row.is_challenge) challenge++;
    else if (row.is_correspondence) correspondence++;
    else if (row.status === 'waiting' || row.status === 'ready' || row.status === 'active') live++;
    // Open matches: status 'waiting' and not challenge/correspondence
    if (!row.is_challenge && !row.is_correspondence && row.status === 'waiting') open++;
  }
  return { live, correspondence, challenge, open };
}

// --- Enforce session/game limits in game creation/join endpoints ---
// Example usage in POST /api/games and join logic:
//   const limits = await countUserActiveGames(userIdOrAnonId);
//   const isAnon = ...;
//   if (limits.live >= (isAnon ? GAME_LIMITS.live_anon : GAME_LIMITS.live)) {
//     return res.status(400).json({ message: 'You are already in 8 live games...' });
//   }
require("dotenv").config();

// Patch console methods in production to prepend a CST timestamp.
// Uses a single cached Intl.DateTimeFormat instance — overhead is negligible
// (< 1ms per call) even under high log volume.
if (process.env.NODE_ENV === 'production') {
  const _cstFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const _cstStamp = () => `[${_cstFmt.format(new Date())}]`;
  const _origLog  = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origErr  = console.error.bind(console);
  const _origInfo = console.info.bind(console);
  console.log   = (...a) => _origLog(_cstStamp(),  ...a);
  console.warn  = (...a) => _origWarn(_cstStamp(), ...a);
  console.error = (...a) => _origErr(_cstStamp(),  ...a);
  console.info  = (...a) => _origInfo(_cstStamp(), ...a);
}

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
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");

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
const MAX_LOGIN_ATTEMPTS = 10; // Allow 10 failed attempts before lockout

// Email service
const { sendWelcomeEmail, sendDonationEmail, sendContactEmail, sendPasswordResetEmail, sendNotificationSummaryEmail, verifyUnsubscribeToken } = require("./email-service");

// Socket.io game handler
const { initializeSocket, activeGames: gsActiveGames, gameTimers: gsGameTimers, disconnectTimeouts: gsDisconnectTimeouts, onlineUsers, reconcileOnlineUsers, getIO } = require("./game-socket");

//  Express

const PORT = process.env.PORT || 3001;

const app = express();

// Trust proxy for EC2/load balancer - set to 1 for single proxy hop
// This makes req.ip use the first X-Forwarded-For value
app.set('trust proxy', 1);

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
      /^https?:\/\/(www\.)?gridgrove\.gg$/,
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
      // Silently reject — callback(null, false) tells the cors middleware NOT
      // to set Access-Control-Allow-Origin, so the browser blocks the response.
      // Using callback(new Error()) instead would log an unhandled error in PM2
      // every time a bot or crawler hits the API from a foreign origin.
      callback(null, false);
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

// Gzip compression for all responses
app.use(compression());

// Track 429s in-memory so the admin memory-stats endpoint can surface them.
let rateLimitHits = 0;

// Rate limiting configuration
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 minutes (generous for heavy API usage)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    rateLimitHits++;
    res.status(options.statusCode).json({ message: "Too many requests, please try again later" });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: { message: "Too many login attempts, please try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 10, // 10 registrations per 30 minutes per IP
  message: { message: "Too many accounts created, please try again in 30 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all routes EXCEPT /api/admin/* (admin endpoints
// are already gated by authenticateAdmin and the dashboard can poll heavily)
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/admin/')) return next();
  return generalLimiter(req, res, next);
});

// Additional middleware to handle Private Network Access
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

// const path = require('path');
const db_pool = require("../configs/db");
const dbHelpers = require("./db-helpers");
const { checkUsername, validateContent, checkProfessionalName } = require("./content-moderation");
const imageModeration = require("./image-moderation");
const initialStateValidator = require("./initial-state-validator");

/**
 * Extract all unique GridGrove usernames mentioned via profile links in a
 * piece of text.  Matches both:
 *   /profile/<username>
 *   gridgrove.gg/profile/<username>
 * Returns an array of lowercased username strings (deduplicated).
 */
function extractMentionedUsernames(text) {
  if (!text) return [];
  const re = /(?:(?:https?:\/\/)?(?:www\.)?gridgrove\.gg)?\/profile\/([A-Za-z0-9_-]{1,50})/gi;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

/**
 * Fire mention notifications for every GridGrove profile URL found in `text`.
 * @param {string}  text       - Raw text that may contain /profile/<username> links
 * @param {number}  senderId   - User ID of the author (won't notify themselves)
 * @param {string}  senderName - Display name of the author
 * @param {string}  contextTitle - Short description of where the mention came from
 * @param {string}  actionUrl  - URL the notification links to
 */
async function notifyMentionedUsers(text, senderId, senderName, contextTitle, actionUrl) {
  try {
    const usernames = extractMentionedUsernames(text);
    if (usernames.length === 0) return;
    const io = app.get('io');
    const { userSockets } = require('./game-socket');
    for (const username of usernames) {
      try {
        const user = await dbHelpers.findUserByUsername(username);
        if (!user || user.id === parseInt(senderId)) continue;
        const notification = await dbHelpers.createNotification({
          user_id: user.id,
          sender_id: parseInt(senderId),
          type: 'mention',
          title: `${senderName} mentioned you`,
          content: contextTitle,
          action_url: actionUrl,
        });
        if (io) {
          const socketId = userSockets?.get(user.id);
          if (socketId) {
            io.to(socketId).emit('newNotification', { ...notification, sender_username: senderName });
          }
        }
      } catch (e) {
        console.error('[mention] Failed to notify user:', username, e.message);
      }
    }
  } catch (e) {
    console.error('[mention] notifyMentionedUsers error:', e.message);
  }
}

// NSFW model loads lazily on first image upload (avoids slow TensorFlow startup)
// imageModeration.initialize();

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
    // Sanitize extension - handle MIME type suffixes like svg+xml -> svg
    let ext = path.extname(file.originalname).toLowerCase();
    if (ext.includes('+')) {
      ext = '.' + ext.split('.').pop().split('+')[0];
    }
    cb(null, 'piece-' + uniqueSuffix + ext);
  }
});

const pieceUpload = multer({ 
  storage: pieceStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit (pixel-art / SVG pieces don't need more)
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
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
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

/**
 * Wraps a multer middleware so that MulterError (e.g. LIMIT_FILE_SIZE) is
 * caught before it reaches Express's default error handler and returned as a
 * clean 413/400 JSON response that the frontend can display directly.
 *
 * @param {Function} middleware - multer .single() / .array() / .fields() middleware
 * @param {string}   sizeLabel  - human-readable size limit shown in the error, e.g. "2 MB"
 */
function multerWrap(middleware, sizeLabel = '2 MB') {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          message: `File too large. The maximum allowed size is ${sizeLabel}. Please reduce the file size and try again.`
        });
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: `Upload error: ${err.message}` });
      }
      return next(err);
    });
  };
}

/**
 * Deduplicate an uploaded image file by SHA-256 content hash.
 * If a file with the same hash already exists in the same upload directory,
 * the new upload is deleted and the existing filename is reused. Otherwise
 * the file is renamed to <hash><ext> so future uploads of the same content
 * can find and reuse it.
 *
 * Mutates `file.filename` in place (and updates `file.path`) so callers can
 * keep using the multer file object as before.
 *
 * @param {object} file - Multer file object
 * @returns {string} the final filename to use
 */
function dedupeUploadedFile(file) {
  if (!file || !file.destination || !file.filename) return file?.filename;
  const fullPath = path.join(file.destination, file.filename);
  let hash;
  try {
    const buffer = fs.readFileSync(fullPath);
    hash = crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (e) {
    console.error('dedupeUploadedFile: failed to hash file', file.filename, e.message);
    return file.filename;
  }

  const ext = path.extname(file.filename).toLowerCase();
  const targetName = `${hash}${ext}`;
  const targetPath = path.join(file.destination, targetName);

  if (targetName === file.filename) {
    return file.filename;
  }

  if (fs.existsSync(targetPath)) {
    // Duplicate content already on disk � delete the new upload and reuse.
    try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
    file.filename = targetName;
    file.path = targetPath;
    return targetName;
  }

  // No existing file with this hash � rename so future uploads can dedupe.
  try {
    fs.renameSync(fullPath, targetPath);
    file.filename = targetName;
    file.path = targetPath;
  } catch (e) {
    console.error('dedupeUploadedFile: failed to rename', e.message);
  }
  return file.filename;
}

//  -----------  Auto-create Tables and Run Migrations on Startup -----------------

const { runMigrations } = require("./migrations");
const { backfillGameTypePieces } = require("../scripts/backfill-game-type-pieces");

// Run migrations to add any missing columns, then backfill game_type_pieces
runMigrations().then(() => {
  return backfillGameTypePieces();
}).then(() => {
  // After migrations, mark any orphaned AI training jobs as interrupted.
  try {
    const trainingManager = require('./ai/training-manager');
    return trainingManager.markInterruptedJobs();
  } catch (e) {
    // Not fatal — training is an optional subsystem.
    console.warn('AI training subsystem unavailable:', e.message);
  }
}).catch(err => {
  console.error("Migration/backfill error:", err);
});

//  -----------  End Auto-create Tables -----------------

// ----- AI training rules auto-sync -----
//
// When a game type or piece is edited, the cached `ai-training/<id>/rules.json`
// dump becomes stale. We re-export it best-effort (fire-and-forget). Failures
// never block the user's save.
const _aiExport = (() => {
  try { return require('./ai/export-game-rules'); }
  catch (e) { return null; }
})();
function _resyncAiRules(gameTypeId) {
  if (!_aiExport || !gameTypeId) return;
  Promise.resolve()
    .then(() => _aiExport.exportGameRules(gameTypeId))
    .catch((e) => console.warn(`AI rules re-export failed for game ${gameTypeId}:`, e.message));
}
async function _resyncAiRulesForPiece(pieceId) {
  if (!_aiExport || !pieceId) return;
  try {
    const [rows] = await db_pool.query(
      'SELECT DISTINCT game_type_id FROM game_type_pieces WHERE piece_id = ?',
      [pieceId],
    );
    for (const row of rows) _resyncAiRules(row.game_type_id);
  } catch (e) {
    console.warn(`AI rules re-export lookup failed for piece ${pieceId}:`, e.message);
  }
}

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
      // Only show name if user has opted in via show_display_name
      if (!user.show_display_name) {
        delete user.first_name;
        delete user.last_name;
      }
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
    const search = req.query.search || '';
    const friendsOf = parseInt(req.query.friendsOf) || 0;

    // Validate sort parameters
    const allowedSortFields = ['username', 'elo', 'last_active_at', 'id'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'id';
    const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Build WHERE clauses
    const whereClauses = [];
    const whereParams = [];

    if (search) {
      whereClauses.push('u.username LIKE ?');
      whereParams.push(`%${search}%`);
    }

    // Friends filter: join with friends table
    let joinClause = '';
    if (friendsOf) {
      joinClause = 'INNER JOIN friends f ON (f.friend_id = u.id AND f.user_id = ?)';
      whereParams.unshift(friendsOf);
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Build query strings
    const countQuery = `SELECT COUNT(*) as total FROM users u ${joinClause} ${whereSQL}`;
    // Get paginated users - exclude personal information (email, first_name, last_name)
    const dataQuery = `SELECT u.id, u.username, u.role, u.profile_picture, u.elo, u.last_active_at FROM users u ${joinClause} ${whereSQL} ORDER BY u.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;

    // Get total count with filters and paginated data in parallel
    const [[countResult], [users]] = await Promise.all([
      db_pool.query(countQuery, whereParams),
      db_pool.query(dataQuery, [...whereParams, limit, offset])
    ]);
    const total = countResult[0].total;
    
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
    // Uses a single players join to find any row for this user, then separately
    // joins p1/p2 for display. This handles bot games where only one player row exists.
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
      INNER JOIN players pme ON g.id = pme.game_id AND pme.user_id = ?
      LEFT JOIN game_types gt ON g.game_type_id = gt.id
      LEFT JOIN players p1 ON g.id = p1.game_id AND p1.player_position = 1
      LEFT JOIN users u1 ON p1.user_id = u1.id
      LEFT JOIN players p2 ON g.id = p2.game_id AND p2.player_position = 2
      LEFT JOIN users u2 ON p2.user_id = u2.id
      WHERE g.status = 'completed'
      ORDER BY g.end_time DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    // Get total count for pagination
    const [countResult] = await db_pool.query(`
      SELECT COUNT(DISTINCT g.id) as total
      FROM games g
      INNER JOIN players p ON g.id = p.game_id AND p.user_id = ?
      WHERE g.status = 'completed'
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
      const isWinner = winnerId && (winnerId === parseInt(userId) || winnerId === userId);
      // In bot games, if winner is 'bot', the human lost
      const isBotWin = otherData.isBotGame && (winnerId === 'bot' || (!game.winner_id && otherData.winner === 'bot'));
      const isDraw = !winnerId;

      return {
        id: game.id,
        createdAt: game.created_at,
        startTime: game.start_time,
        endTime: game.end_time,
        status: game.status,
        winnerId: winnerId,
        result: isDraw ? 'draw' : (isBotWin ? 'loss' : (isWinner ? 'win' : 'loss')),
        reason: otherData.reason || 'unknown',
        eloChanges: otherData.eloChanges || null,
        isBotGame: !!otherData.isBotGame,
        botDifficulty: otherData.botDifficulty || null,
        gameTypeName: game.game_type_name,
        boardWidth: game.board_width,
        boardHeight: game.board_height,
        timeControl: game.turn_length,
        increment: game.increment,
        players: (() => {
          const botUsername = otherData.isBotGame
            ? `Computer (${(otherData.botDifficulty || 'medium').charAt(0).toUpperCase() + (otherData.botDifficulty || 'medium').slice(1)})`
            : null;
          const botPosition = otherData.botPosition || 2;
          const anonLivePlayers = otherData.anonLivePlayers || null;
          const anonNameForPosition = (position) => {
            const perPos = anonLivePlayers?.[position]?.username;
            const fallback = otherData.guestName || null;
            const name = perPos || fallback;
            return name ? `Guest: ${name}` : 'Guest';
          };
          const p1 = game.player1_id
            ? { id: game.player1_id, username: game.player1_username, elo: game.player1_elo, position: game.player1_position }
            : (otherData.isBotGame && botPosition === 1
              ? { id: 'bot', username: botUsername, elo: null, position: 1 }
              : (game.player1_position != null
                ? { id: null, username: anonNameForPosition(1), elo: null, position: game.player1_position }
                : null));
          const p2 = game.player2_id
            ? { id: game.player2_id, username: game.player2_username, elo: game.player2_elo, position: game.player2_position }
            : (otherData.isBotGame && botPosition === 2
              ? { id: 'bot', username: botUsername, elo: null, position: 2 }
              : (game.player2_position != null
                ? { id: null, username: anonNameForPosition(2), elo: null, position: game.player2_position }
                : null));
          return [p1, p2].filter(Boolean);
        })()
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

// GET /api/users/:userId/ongoing-games - Active games a user is participating in (for profile page)
app.get("/api/users/:userId/ongoing-games", async (req, res) => {
  try {
    const { userId } = req.params;

    const [games] = await db_pool.query(`
      SELECT
        g.id,
        g.created_at,
        g.start_time,
        g.status,
        g.turn_length,
        g.increment,
        g.is_correspondence,
        g.correspondence_days,
        g.other_data,
        g.player_turn,
        gt.game_name as game_type_name,
        gt.board_width,
        gt.board_height,
        gt.simultaneous_turns,
        p1.user_id as player1_id,
        u1.username as player1_username,
        u1.elo as player1_elo,
        p2.user_id as player2_id,
        u2.username as player2_username,
        u2.elo as player2_elo
      FROM games g
      LEFT JOIN game_types gt ON g.game_type_id = gt.id
      LEFT JOIN players p1 ON g.id = p1.game_id AND p1.player_position = 1
      LEFT JOIN users u1 ON p1.user_id = u1.id
      LEFT JOIN players p2 ON g.id = p2.game_id AND p2.player_position = 2
      LEFT JOIN users u2 ON p2.user_id = u2.id
      WHERE g.status IN ('active', 'ready', 'waiting')
        AND (p1.user_id = ? OR p2.user_id = ?)
      ORDER BY g.start_time DESC, g.created_at DESC
    `, [userId, userId]);

    const formattedGames = games.map(game => {
      let otherData = {};
      try {
        otherData = JSON.parse(game.other_data || '{}');
      } catch (e) {}

      const isBotGame = !!otherData.isBotGame;
      const botPosition = otherData.botPosition || 2;
      const botUsername = isBotGame
        ? `Computer (${(otherData.botDifficulty || 'medium').charAt(0).toUpperCase() + (otherData.botDifficulty || 'medium').slice(1)})`
        : null;

      const p1 = game.player1_id
        ? { id: game.player1_id, username: game.player1_username, elo: game.player1_elo }
        : (isBotGame && botPosition === 1 ? { id: 'bot', username: botUsername, elo: null } : null);
      const p2 = game.player2_id
        ? { id: game.player2_id, username: game.player2_username, elo: game.player2_elo }
        : (isBotGame && botPosition === 2 ? { id: 'bot', username: botUsername, elo: null } : null);

      return {
        id: game.id,
        createdAt: game.created_at,
        startTime: game.start_time,
        status: game.status,
        gameTypeName: game.game_type_name,
        boardWidth: game.board_width,
        boardHeight: game.board_height,
        timeControl: game.turn_length,
        increment: game.increment,
        isCorrespondence: !!game.is_correspondence,
        correspondenceDays: game.correspondence_days,
        simultaneousTurns: !!game.simultaneous_turns,
        playerTurn: game.player_turn ?? null,
        simulSubmittedPlayerIds: otherData.simulSubmittedPlayerIds || [],
        players: [p1, p2].filter(Boolean)
      };
    });

    res.json({ games: formattedGames });
  } catch (err) {
    console.error("Error in /api/users/:userId/ongoing-games:", err);
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

        // Create notification for re-sent friend request
        const senderUser = await dbHelpers.findUserById(parseInt(userId));
        const notification = await dbHelpers.createNotification({
          user_id: parseInt(friendId),
          sender_id: parseInt(userId),
          type: 'friend_request',
          title: `${senderUser.username} sent you a friend request`,
          content: 'You have a new friend request. Accept or decline from your notifications.',
          related_id: existingRequest.id,
          action_url: '/notifications'
        });
        const io = app.get('io');
        if (io) {
          const { userSockets } = require('./game-socket');
          const targetSocketId = userSockets?.get(parseInt(friendId));
          if (targetSocketId) {
            io.to(targetSocketId).emit('newNotification', { ...notification, sender_username: senderUser.username });
          }
        }
        
        return res.json({ message: "Friend request sent", friend: friend[0] });
      }
    }
    
    // Create a pending friend request (one-way only)
    const [insertResult] = await db_pool.query(
      "INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')",
      [userId, friendId]
    );
    
    // Get the friend's info
    const [friend] = await db_pool.query(
      "SELECT id, username, elo, profile_picture FROM users WHERE id = ?",
      [friendId]
    );

    // Create notification for the friend request recipient
    const senderUser = await dbHelpers.findUserById(parseInt(userId));
    const notification = await dbHelpers.createNotification({
      user_id: parseInt(friendId),
      sender_id: parseInt(userId),
      type: 'friend_request',
      title: `${senderUser.username} sent you a friend request`,
      content: 'You have a new friend request. Accept or decline from your notifications.',
      related_id: insertResult.insertId,
      action_url: '/notifications'
    });
    // Real-time push via socket
    const io = app.get('io');
    if (io) {
      const { userSockets } = require('./game-socket');
      const targetSocketId = userSockets?.get(parseInt(friendId));
      if (targetSocketId) {
        io.to(targetSocketId).emit('newNotification', { ...notification, sender_username: senderUser.username });
      }
    }
    
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
      initialPieces: otherData.initialPieces || null,
      reason: otherData.reason || 'unknown',
      eloChanges: otherData.eloChanges || null,
      gameTypeName: game.game_type_name,
      gameDescription: game.game_description,
      boardWidth: game.board_width || 8,
      boardHeight: game.board_height || 8,
      timeControl: game.turn_length,
      increment: game.increment,
      settings: {
        rated: otherData.rated !== false,
        allowPremoves: otherData.allowPremoves !== false,
        premoveTimeCost: otherData.premoveTimeCost || 0,
        allowSpectators: game.allow_spectators !== 0,
        showPieceHelpers: game.show_piece_helpers === 1,
        materialClockPenalty: !!otherData.materialClockPenalty,
        materialClockHandicap: !!otherData.materialClockHandicap,
        startingMode: otherData.startingMode || 'none',
        isBotGame: !!otherData.isBotGame,
        botDifficulty: otherData.botDifficulty || null,
        isCorrespondence: !!game.is_correspondence,
        correspondenceDays: game.correspondence_days || null
      },
      players: (() => {
        const anonLivePlayers = otherData.anonLivePlayers || null;
        const anonCorresPlayers = otherData.anonCorresPlayers || null;
        const anonNameForPosition = (position) => {
          const perPos = anonLivePlayers?.[position]?.username
            || anonCorresPlayers?.[position]?.username
            || null;
          const fallback = otherData.guestName || null;
          const name = perPos || fallback;
          return name ? `Guest: ${name}` : 'Guest';
        };
        const mapped = players.map(p => ({
          id: p.user_id,
          username: p.username || (p.user_id == null ? anonNameForPosition(p.player_position) : null),
          elo: p.elo,
          position: p.player_position,
          profilePicture: p.profile_picture
        }));
        if (otherData.isBotGame) {
          const botPos = otherData.botPosition || 2;
          const botLabel = `Computer (${(otherData.botDifficulty || 'medium').charAt(0).toUpperCase() + (otherData.botDifficulty || 'medium').slice(1)})`;
          if (!mapped.some(p => p.id === 'bot' || p.position === botPos)) {
            mapped.push({
              id: 'bot',
              username: botLabel,
              elo: null,
              position: botPos,
              profilePicture: null
            });
          }
        }
        return mapped;
      })()
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
    const sort = req.query.sort || 'newest';
    const search = req.query.search || '';
    const creatorId = req.query.creatorId ? parseInt(req.query.creatorId) : null;

    // Build WHERE clause
    let whereClause = '';
    const whereParams = [];
    const conditions = [];

    if (creatorId) {
      conditions.push('p.creator_id = ?');
      whereParams.push(creatorId);
    }

    // Exclude pieces whose name is pending professional-name review from public listings.
    // When filtering by a specific creator, show their pending items so they can track status.
    if (!creatorId) {
      conditions.push("(p.name_review_status IS NULL OR p.name_review_status != 'pending_review')");
    }

    if (search) {
      conditions.push('p.piece_name LIKE ?');
      whereParams.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    // Build ORDER BY clause
    let orderClause = 'ORDER BY p.id DESC';
    let joinClause = '';
    let selectExtra = '';

    switch (sort) {
      case 'most_used':
        joinClause = 'LEFT JOIN game_type_pieces gtp ON p.id = gtp.piece_id';
        selectExtra = ', COUNT(DISTINCT gtp.game_type_id) as game_count';
        orderClause = 'ORDER BY game_count DESC, p.id DESC';
        break;
      case 'alphabetical':
        orderClause = 'ORDER BY p.piece_name ASC';
        break;
      case 'newest':
      default:
        orderClause = 'ORDER BY p.id DESC';
        break;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM pieces p ${whereClause}`;
    const [countResult] = await db_pool.query(countQuery, whereParams);
    const total = countResult[0].total;

    // Get paginated pieces
    const groupBy = joinClause ? 'GROUP BY p.id' : '';
    const dataQuery = `SELECT p.*${selectExtra} FROM pieces p ${joinClause} ${whereClause} ${groupBy} ${orderClause} LIMIT ? OFFSET ?`;
    const [pieces] = await db_pool.query(dataQuery, [...whereParams, limit, offset]);
    
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

// Browse community-uploaded piece images (used in the piece wizard image library).
// Returns one image per piece (the first in image_location) along with creator info.
// Query params: page, limit, sort (newest|alphabetical|by_uploader), search
app.get("/api/pieces/community-images", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 40));
    const offset = (page - 1) * limit;
    const sort = req.query.sort || 'newest';
    const search = (req.query.search || '').trim();

    const conditions = [
      "p.image_location IS NOT NULL",
      "p.image_location != '[]'",
      "(p.name_review_status IS NULL OR p.name_review_status != 'pending_review')",
    ];
    const params = [];

    if (search) {
      conditions.push("p.piece_name LIKE ?");
      params.push(`%${search}%`);
    }

    const whereClause = "WHERE " + conditions.join(" AND ");

    let orderClause;
    switch (sort) {
      case 'alphabetical':
        orderClause = "ORDER BY p.piece_name ASC";
        break;
      case 'by_uploader':
        orderClause = "ORDER BY creator_name ASC, p.piece_name ASC";
        break;
      case 'newest':
      default:
        orderClause = "ORDER BY p.id DESC";
        break;
    }

    const [[{ total }]] = await db_pool.query(
      `SELECT COUNT(*) as total FROM pieces p ${whereClause}`,
      params
    );

    const [rows] = await db_pool.query(
      `SELECT p.id, p.piece_name, p.image_location, p.created_at,
              CASE WHEN p.is_anonymous_creator = 1 THEN 'Anonymous'
                   ELSE COALESCE(u.username, 'Unknown') END as creator_name
       FROM pieces p
       LEFT JOIN users u ON p.creator_id = u.id
       ${whereClause}
       ${orderClause}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Parse the first image from each piece's image_location JSON array
    const images = rows.map(row => {
      let firstImage = null;
      try {
        const arr = JSON.parse(row.image_location || '[]');
        firstImage = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
      } catch (_) {}
      return {
        id: row.id,
        piece_name: row.piece_name,
        creator_name: row.creator_name,
        created_at: row.created_at,
        image_url: firstImage,
      };
    }).filter(r => r.image_url);

    res.json({
      images,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) {
    console.error("Error in /api/pieces/community-images:", err);
    res.status(500).send({ err: err.message });
  }
});

// ---- Duplicate-ruleset check (used by the piece wizard before save) ----
// Accepts { fields: <DB-column-named object>, excludeId: <number|null> }
// Returns { matches: [{id, piece_name, creator_username, is_anonymous_creator}] }
// Does NOT require authentication — the wizard must call this for anonymous
// creators too. Read-only and returns only identity columns, no sensitive data.
app.post("/api/pieces/duplicates", async (req, res) => {
  try {
    const { fields, excludeId } = req.body || {};
    if (!fields || typeof fields !== 'object') {
      return res.json({ matches: [] });
    }

    // These are ALL functional columns — everything that controls how a piece
    // actually behaves, excluding identity (name, images, description, category,
    // creator, timestamps). Comparison is field-by-field, short-circuits on
    // the first difference so the inner loop is fast.
    const BOOL_COLS = [
      'directional_movement_style','repeating_movement','first_move_only','first_move_only_capture',
      'up_left_movement_exact','up_movement_exact','up_right_movement_exact','right_movement_exact',
      'down_right_movement_exact','down_movement_exact','down_left_movement_exact','left_movement_exact',
      'up_left_capture_exact','up_capture_exact','up_right_capture_exact','right_capture_exact',
      'down_right_capture_exact','down_capture_exact','down_left_capture_exact','left_capture_exact',
      'up_left_attack_range_exact','up_attack_range_exact','up_right_attack_range_exact','right_attack_range_exact',
      'down_right_attack_range_exact','down_attack_range_exact','down_left_attack_range_exact','left_attack_range_exact',
      'ratio_movement_style','repeating_ratio','repeating_capture','repeating_ratio_capture',
      'step_by_step_movement_style','step_by_step_attack_style',
      'can_hop_over_allies','can_hop_over_enemies','exact_ratio_hop_only','directional_hop_disabled',
      'can_hop_attack_over_allies','can_hop_attack_over_enemies',
      'can_fire_over_allies','can_fire_over_enemies',
      'can_capture_enemy_via_range','can_capture_enemy_on_move',
      'can_capture_allies','cannot_be_captured',
      'has_checkmate_rule','has_check_rule','has_lose_on_capture_rule',
      'can_castle','can_promote','can_en_passant',
      'capture_on_hop','chain_capture_enabled','free_move_after_promotion',
      'chain_hop_allies','must_move_if_able','must_move_uses_action',
    ];
    // Integer columns — null-preserving (0 and null are semantically different
    // for some of these; compare normalized integers so NULL==NULL and 0==0).
    const INT_COLS = [
      'piece_width','piece_height',
      'up_left_movement','up_movement','up_right_movement','right_movement',
      'down_right_movement','down_movement','down_left_movement','left_movement',
      'up_left_movement_available_for','up_movement_available_for','up_right_movement_available_for','right_movement_available_for',
      'down_right_movement_available_for','down_movement_available_for','down_left_movement_available_for','left_movement_available_for',
      'ratio_one_movement','ratio_two_movement','max_ratio_iterations',
      'step_by_step_movement_value',
      'min_turns_per_move','max_turns_per_move','available_for_moves',
      'up_left_capture','up_capture','up_right_capture','right_capture',
      'down_right_capture','down_capture','down_left_capture','left_capture',
      'up_left_capture_available_for','up_capture_available_for','up_right_capture_available_for','right_capture_available_for',
      'down_right_capture_available_for','down_capture_available_for','down_left_capture_available_for','left_capture_available_for',
      'ratio_one_capture','ratio_two_capture','max_ratio_capture_iterations','step_by_step_capture',
      'up_left_attack_range','up_attack_range','up_right_attack_range','right_attack_range',
      'down_right_attack_range','down_attack_range','down_left_attack_range','left_attack_range',
      'up_left_attack_range_available_for','up_attack_range_available_for','up_right_attack_range_available_for','right_attack_range_available_for',
      'down_right_attack_range_available_for','down_attack_range_available_for','down_left_attack_range_available_for','left_attack_range_available_for',
      'ratio_one_attack_range','ratio_two_attack_range',
      'step_by_step_attack_value',
      'max_piece_captures_per_move','max_piece_captures_per_ranged_attack',
      'max_chain_hops',
    ];
    // JSON / text columns — compare by canonical JSON (or trimmed string).
    const JSON_COLS = [
      'special_scenario_moves','special_scenario_captures',
      'custom_movement_squares','custom_attack_squares',
      'promotion_pieces_ids','available_for_captures',
    ];

    const normBool = (v) => (v === 1 || v === true || v === 'true' || v === '1') ? 1 : 0;
    const normInt  = (v) => (v === null || v === undefined || v === '' || v === 'null') ? null : (parseInt(v, 10) || 0);
    const normJson = (v) => {
      if (v === null || v === undefined || v === '' || v === 'null') return null;
      if (typeof v === 'string') {
        try { return JSON.stringify(JSON.parse(v)); } catch { return v.trim() || null; }
      }
      try { return JSON.stringify(v); } catch { return null; }
    };

    // Check if two pieces are functionally identical. Short-circuits on first diff.
    const isIdentical = (dbPiece) => {
      for (const col of BOOL_COLS) {
        if (normBool(dbPiece[col]) !== normBool(fields[col])) return false;
      }
      for (const col of INT_COLS) {
        if (normInt(dbPiece[col]) !== normInt(fields[col])) return false;
      }
      for (const col of JSON_COLS) {
        if (normJson(dbPiece[col]) !== normJson(fields[col])) return false;
      }
      return true;
    };

    const [pieces] = await db_pool.query(`
      SELECT p.id, p.piece_name, p.is_anonymous_creator,
        CASE WHEN p.is_anonymous_creator = 1 THEN 'Anonymous' ELSE u.username END AS creator_username,
        p.piece_width, p.piece_height,
        p.directional_movement_style, p.repeating_movement, p.first_move_only, p.first_move_only_capture,
        p.up_left_movement, p.up_movement, p.up_right_movement, p.right_movement,
        p.down_right_movement, p.down_movement, p.down_left_movement, p.left_movement,
        p.up_left_movement_exact, p.up_movement_exact, p.up_right_movement_exact, p.right_movement_exact,
        p.down_right_movement_exact, p.down_movement_exact, p.down_left_movement_exact, p.left_movement_exact,
        p.up_left_movement_available_for, p.up_movement_available_for, p.up_right_movement_available_for, p.right_movement_available_for,
        p.down_right_movement_available_for, p.down_movement_available_for, p.down_left_movement_available_for, p.left_movement_available_for,
        p.ratio_movement_style, p.ratio_one_movement, p.ratio_two_movement, p.repeating_ratio, p.max_ratio_iterations,
        p.step_by_step_movement_style, p.step_by_step_movement_value,
        p.can_hop_over_allies, p.can_hop_over_enemies, p.exact_ratio_hop_only, p.directional_hop_disabled,
        p.min_turns_per_move, p.max_turns_per_move, p.available_for_moves,
        p.special_scenario_moves,
        p.can_capture_enemy_via_range, p.can_capture_enemy_on_move,
        p.first_move_only_capture, p.available_for_captures,
        p.up_left_capture, p.up_capture, p.up_right_capture, p.right_capture,
        p.down_right_capture, p.down_capture, p.down_left_capture, p.left_capture,
        p.up_left_capture_exact, p.up_capture_exact, p.up_right_capture_exact, p.right_capture_exact,
        p.down_right_capture_exact, p.down_capture_exact, p.down_left_capture_exact, p.left_capture_exact,
        p.up_left_capture_available_for, p.up_capture_available_for, p.up_right_capture_available_for, p.right_capture_available_for,
        p.down_right_capture_available_for, p.down_capture_available_for, p.down_left_capture_available_for, p.left_capture_available_for,
        p.ratio_one_capture, p.ratio_two_capture, p.repeating_capture, p.repeating_ratio_capture, p.max_ratio_capture_iterations, p.step_by_step_capture,
        p.up_left_attack_range, p.up_attack_range, p.up_right_attack_range, p.right_attack_range,
        p.down_right_attack_range, p.down_attack_range, p.down_left_attack_range, p.left_attack_range,
        p.up_left_attack_range_exact, p.up_attack_range_exact, p.up_right_attack_range_exact, p.right_attack_range_exact,
        p.down_right_attack_range_exact, p.down_attack_range_exact, p.down_left_attack_range_exact, p.left_attack_range_exact,
        p.up_left_attack_range_available_for, p.up_attack_range_available_for, p.up_right_attack_range_available_for, p.right_attack_range_available_for,
        p.down_right_attack_range_available_for, p.down_attack_range_available_for, p.down_left_attack_range_available_for, p.left_attack_range_available_for,
        p.ratio_one_attack_range, p.ratio_two_attack_range,
        p.step_by_step_attack_style, p.step_by_step_attack_value,
        p.max_piece_captures_per_move, p.max_piece_captures_per_ranged_attack,
        p.special_scenario_captures,
        p.can_fire_over_allies, p.can_fire_over_enemies, p.can_en_passant,
        p.capture_on_hop, p.chain_capture_enabled, p.free_move_after_promotion, p.promotion_pieces_ids,
        p.can_hop_attack_over_allies, p.can_hop_attack_over_enemies, p.chain_hop_allies,
        p.can_capture_allies, p.cannot_be_captured, p.max_chain_hops,
        p.custom_movement_squares, p.custom_attack_squares,
        p.must_move_if_able, p.must_move_uses_action,
        p.has_checkmate_rule, p.has_check_rule, p.has_lose_on_capture_rule,
        p.can_castle, p.can_promote
      FROM chessusnode.pieces p
      LEFT JOIN chessusnode.users u ON p.creator_id = u.id
    `);

    const excludeNum = excludeId != null ? Number(excludeId) : null;
    const matches = [];
    for (const piece of pieces) {
      if (excludeNum !== null && piece.id === excludeNum) continue;
      if (isIdentical(piece)) {
        matches.push({
          id: piece.id,
          piece_name: piece.piece_name,
          creator_username: piece.creator_username || 'Anonymous',
          is_anonymous_creator: piece.is_anonymous_creator,
        });
      }
    }
    res.json({ matches });
  } catch (err) {
    console.error("Error in /api/pieces/duplicates:", err);
    res.json({ matches: [] }); // non-fatal — wizard can still save
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

// Get most popular game types based on number of games played
// Prioritizes admin-featured games (featured_order column)
app.get("/api/games/popular", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 3;

    // First, check for admin-featured games. Include real play counts so the
    // home page can display them accurately. The COUNT JOIN is cheap here
    // because there are at most a handful of featured games.
    const [featuredGames] = await db_pool.query(`
      SELECT gt.*, COUNT(g.id) as play_count
      FROM game_types gt
      LEFT JOIN games g ON gt.id = g.game_type_id
      WHERE gt.featured_order IS NOT NULL
      GROUP BY gt.id
      ORDER BY gt.featured_order ASC
      LIMIT ?
    `, [limit]);

    // If we have enough featured games, load pieces in parallel and return.
    if (featuredGames.length >= limit) {
      await Promise.all(featuredGames.map(async (game) => {
        game.pieces = await dbHelpers.getPiecesForGameType(game.id);
      }));
      return res.json(featuredGames);
    }

    // If we have some featured games but not enough, fill with popular games
    const featuredIds = featuredGames.map(g => g.id);
    const remainingCount = limit - featuredGames.length;

    // Get popular games that aren't already featured. The COUNT join here is
    // unavoidable for "popular" ordering, but we cap to remainingCount and
    // assume the games table has an index on game_type_id.
    const [popularGames] = await db_pool.query(`
      SELECT gt.*, COUNT(g.id) as play_count
      FROM game_types gt
      LEFT JOIN games g ON gt.id = g.game_type_id
      ${featuredIds.length > 0 ? 'WHERE gt.id NOT IN (?)' : ''}
      GROUP BY gt.id
      ORDER BY play_count DESC, gt.id DESC
      LIMIT ?
    `, featuredIds.length > 0 ? [featuredIds, remainingCount] : [remainingCount]);

    // Combine featured + popular
    const allGames = [...featuredGames, ...popularGames];

    // If still no games, fall back to most recent game types
    if (allGames.length === 0) {
      const [recentGames] = await db_pool.query(
        `SELECT *, 0 as play_count FROM game_types ORDER BY id DESC LIMIT ?`,
        [limit]
      );
      await Promise.all(recentGames.map(async (game) => {
        game.pieces = await dbHelpers.getPiecesForGameType(game.id);
      }));
      return res.json(recentGames);
    }

    // Load pieces for each game type in parallel (was sequential N+1)
    await Promise.all(allGames.map(async (game) => {
      if (!game.pieces) {
        game.pieces = await dbHelpers.getPiecesForGameType(game.id);
      }
    }));

    res.json(allGames);
  } catch (err) {
    console.error("Error in /api/games/popular:", err);
    res.status(500).send({ err: err.message });
  }
});

app.get("/api/games", optionalAuthenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const sort = req.query.sort || 'newest';
    const winCondition = req.query.winCondition || '';
    const search = req.query.search || '';
    const creatorId = req.query.creatorId ? parseInt(req.query.creatorId) : null;
    const includeDrafts = req.query.includeDrafts === 'true';
    const userId = req.user?.id || 0;

    // Build WHERE clause
    let whereClause = '';
    const whereParams = [];
    const conditions = [];

    // By default, exclude drafts and training-only games from public listings
    // Only show drafts when explicitly requested AND filtering by creator
    if (!includeDrafts || !creatorId) {
      conditions.push('(gt.is_draft = 0 OR gt.is_draft IS NULL)');
      conditions.push('(gt.is_training_only = 0 OR gt.is_training_only IS NULL)');
    }

    // Exclude games whose name is pending professional-name review from public listings.
    // When filtering by a specific creator (e.g. My Games), show their pending items so
    // they can see the review status on their own games.
    if (!creatorId) {
      conditions.push("(gt.name_review_status IS NULL OR gt.name_review_status != 'pending_review')");
    }

    if (creatorId) {
      conditions.push('gt.creator_id = ?');
      whereParams.push(creatorId);
    }

    if (winCondition) {
      const condMap = {
        'checkmate': 'gt.mate_condition = 1',
        'capture': 'gt.capture_condition = 1',
        'points': 'gt.value_condition = 1',
        'territory': 'gt.squares_condition = 1',
        'hill': 'gt.hill_condition = 1',
        'piece_count': 'gt.piece_count_condition = 1',
        'no_moves': 'gt.no_moves_condition = 1',
        'promotion': 'gt.promotion_condition = 1',
      };
      if (condMap[winCondition]) {
        conditions.push(condMap[winCondition]);
      }
    }

    if (search) {
      conditions.push('gt.game_name LIKE ?');
      whereParams.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    // Build ORDER BY clause
    let orderClause = 'ORDER BY gt.id DESC';
    let joinClause = '';
    let selectExtra = '';

    // Always include upvote count + whether the current user has upvoted
    joinClause = 'LEFT JOIN game_type_upvotes gu ON gt.id = gu.game_type_id LEFT JOIN chessusnode.users cu ON gt.creator_id = cu.id';
    selectExtra = ', COUNT(DISTINCT gu.id) as upvote_count, MAX(CASE WHEN gu.user_id = ? THEN 1 ELSE 0 END) as upvoted_by_user, CASE WHEN gt.is_anonymous_creator = 1 THEN \'Anonymous\' ELSE cu.username END as creator_username';

    switch (sort) {
      case 'popular':
        joinClause += ' LEFT JOIN games g ON gt.id = g.game_type_id';
        selectExtra += ', COUNT(DISTINCT g.id) as play_count';
        orderClause = 'ORDER BY play_count DESC, gt.id DESC';
        break;
      case 'most_upvoted':
        orderClause = 'ORDER BY upvote_count DESC, gt.id DESC';
        break;
      case 'last_played':
        orderClause = 'ORDER BY gt.last_played_at DESC NULLS LAST, gt.id DESC';
        break;
      case 'alphabetical':
        orderClause = 'ORDER BY gt.game_name ASC';
        break;
      case 'newest':
      default:
        orderClause = 'ORDER BY gt.id DESC';
        break;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM game_types gt ${whereClause}`;
    const [countResult] = await db_pool.query(countQuery, whereParams);
    const total = countResult[0].total;

    // Get paginated games
    const dataQuery = `SELECT gt.*${selectExtra} FROM game_types gt ${joinClause} ${whereClause} GROUP BY gt.id ${orderClause} LIMIT ? OFFSET ?`;
    const [games] = await db_pool.query(dataQuery, [userId, ...whereParams, limit, offset]);
    
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
    
    // forum_id and upvote_count are independent — run them in parallel
    const [forumRows, upvoteResult] = await Promise.all([
      db_pool.query('SELECT id FROM articles WHERE game_type_id = ? LIMIT 1', [gameId]),
      db_pool.query('SELECT COUNT(*) as count FROM game_type_upvotes WHERE game_type_id = ?', [gameId]),
    ]);

    if (forumRows[0].length > 0) {
      game.article_id = forumRows[0][0].id;
    }
    game.upvote_count = upvoteResult[0][0].count;
    
    res.json(game);
  } catch (err) {
    console.error("Error in GET /api/games/:gameId:", err);
    res.status(500).send({ err: err.message });
  }
});

// Toggle upvote on a game type
app.post("/api/games/:gameId/upvote", authenticateToken, async (req, res) => {
  try {
    const gameTypeId = parseInt(req.params.gameId);
    const userId = req.user.id;

    // Check if already upvoted
    const [existing] = await db_pool.query(
      'SELECT id FROM game_type_upvotes WHERE game_type_id = ? AND user_id = ?',
      [gameTypeId, userId]
    );

    if (existing.length > 0) {
      // Remove upvote
      await db_pool.query(
        'DELETE FROM game_type_upvotes WHERE game_type_id = ? AND user_id = ?',
        [gameTypeId, userId]
      );
    } else {
      // Add upvote
      await db_pool.query(
        'INSERT INTO game_type_upvotes (game_type_id, user_id) VALUES (?, ?)',
        [gameTypeId, userId]
      );
    }

    // Return updated count
    const [countResult] = await db_pool.query(
      'SELECT COUNT(*) as count FROM game_type_upvotes WHERE game_type_id = ?',
      [gameTypeId]
    );

    res.json({
      upvoted: existing.length === 0,
      upvote_count: countResult[0].count
    });
  } catch (err) {
    console.error("Error in POST /api/games/:gameId/upvote:", err);
    res.status(500).send({ err: err.message });
  }
});

// Get upvote status for a game (requires auth to know if user upvoted)
app.get("/api/games/:gameId/upvote", optionalAuthenticate, async (req, res) => {
  try {
    const gameTypeId = parseInt(req.params.gameId);
    const userId = req.user?.id;

    const [countResult] = await db_pool.query(
      'SELECT COUNT(*) as count FROM game_type_upvotes WHERE game_type_id = ?',
      [gameTypeId]
    );

    let upvoted = false;
    if (userId) {
      const [existing] = await db_pool.query(
        'SELECT id FROM game_type_upvotes WHERE game_type_id = ? AND user_id = ?',
        [gameTypeId, userId]
      );
      upvoted = existing.length > 0;
    }

    res.json({
      upvoted,
      upvote_count: countResult[0].count
    });
  } catch (err) {
    console.error("Error in GET /api/games/:gameId/upvote:", err);
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
    
    // Verify ownership (creator or moderation rights)
    if (existingGame.creator_id !== userId) {
      // Look up the game creator's role
      const creator = await dbHelpers.findUserById(existingGame.creator_id);
      const creatorRole = creator?.role || 'user';
      if (!canModerate(userRole, creatorRole)) {
        return res.status(403).send({ message: "You can only edit your own games" });
      }
    }

    // Validate required fields (matching create validation)
    if (!gameData.game_name || gameData.game_name.length < 3) {
      return res.status(400).send({ message: "Game name must be at least 3 characters" });
    }

    // Content moderation: Check game name
    const nameCheck = validateContent(gameData.game_name, { fieldName: 'Game name', maxLength: 100 });
    if (!nameCheck.isValid) {
      return res.status(400).send({ message: nameCheck.errors[0] });
    }

    // Professional name check: flag games with sensitive terms for moderator review
    const gameEditProfCheck = checkProfessionalName(gameData.game_name);
    const gameEditNeedsNameReview = !gameEditProfCheck.isProfessional;

    // Content moderation: Check description
    if (gameData.descript) {
      const descCheck = validateContent(gameData.descript, { fieldName: 'Description', maxLength: 8000, allowLinks: 'whitelist' });
      if (!descCheck.isValid) {
        return res.status(400).send({ message: descCheck.errors[0] });
      }
    }

    // Content moderation: Check rules
    if (gameData.rules) {
      const rulesCheck = validateContent(gameData.rules, { fieldName: 'Rules', maxLength: 8000, allowLinks: 'whitelist' });
      if (!rulesCheck.isValid) {
        return res.status(400).send({ message: rulesCheck.errors[0] });
      }
    }

    // Validate actions_per_turn range
    if (gameData.actions_per_turn && (gameData.actions_per_turn < 1 || gameData.actions_per_turn > 8)) {
      return res.status(400).send({ message: "Actions per turn must be between 1 and 8" });
    }

    // Validate board size (max 48x48)
    if (gameData.board_width) gameData.board_width = Math.max(1, Math.min(48, parseInt(gameData.board_width) || 8));
    if (gameData.board_height) gameData.board_height = Math.max(1, Math.min(48, parseInt(gameData.board_height) || 8));

    // Validate randomized_starting_positions size (matching create validation)
    if (gameData.randomized_starting_positions) {
      if (gameData.randomized_starting_positions.length > 65000) {
        return res.status(400).send({ 
          message: "Randomized starting positions data is too large. Please simplify your game configuration.",
          length: gameData.randomized_starting_positions.length 
        });
      }
    }

    // Force player_count to 2 (only 2-player games currently supported)
    gameData.player_count = 2;
    
    // Build the SQL query for updating
    const isDraft = gameData.is_draft ? 1 : 0;
    const draftSavedStep = gameData.draft_saved_step || null;
    const wasPublished = !existingGame.is_draft;

    // Initial-position validation: only enforce for published games (drafts
    // can be in any state). Mirrors the check in POST /api/games/create.
    if (!isDraft) {
      try {
        const checkResult = await initialStateValidator.validateGameTypeFromRequestBody(gameData);
        if (checkResult && checkResult.decided) {
          return res.status(400).send({
            message: checkResult.reason,
            initialStateError: {
              type: checkResult.type,
              code: checkResult.code,
              reason: checkResult.reason,
              forPlayer: checkResult.forPlayer || null,
            },
          });
        }
      } catch (validationErr) {
        console.error('[initial-state] Pre-update validation error:', validationErr.message);
      }
    }
    
    // Dynamic UPDATE builder — column name and value are always co-located so
    // adding a new column in future cannot cause a placeholder/values mismatch.
    const updateMap = {
      game_name:                             gameData.game_name,
      descript:                              gameData.descript,
      rules:                                 gameData.rules,
      mate_condition:                        gameData.mate_condition || false,
      mate_piece:                            gameData.mate_piece != null ? gameData.mate_piece : null,
      capture_condition:                     gameData.capture_condition || false,
      capture_piece:                         gameData.capture_piece != null ? gameData.capture_piece : null,
      capture_condition_requires_all:        gameData.capture_condition_requires_all || false,
      mate_condition_requires_all:           gameData.mate_condition_requires_all || false,
      value_condition:                       gameData.value_condition || false,
      value_piece:                           gameData.value_piece != null ? gameData.value_piece : null,
      value_max:                             gameData.value_max || null,
      value_title:                           gameData.value_title || null,
      squares_condition:                     gameData.squares_condition || false,
      squares_count:                         gameData.squares_count || null,
      hill_condition:                        gameData.hill_condition || false,
      hill_x:                                gameData.hill_x || null,
      hill_y:                                gameData.hill_y || null,
      hill_turns:                            gameData.hill_turns || null,
      actions_per_turn:                      gameData.actions_per_turn || 1,
      simultaneous_turns:                    gameData.simultaneous_turns || false,
      simul_turns_clock_pause:               gameData.simul_turns_clock_pause ? 1 : 0,
      simul_turns_draw_after_cancellations:  Math.max(0, Math.min(99, Number(gameData.simul_turns_draw_after_cancellations) || 0)),
      simul_turns_submit_mode:               ['immediate', 'stage'].includes(gameData.simul_turns_submit_mode) ? gameData.simul_turns_submit_mode : 'immediate',
      simul_turns_place_conflict:            ['cancel', 'allow'].includes(gameData.simul_turns_place_conflict) ? gameData.simul_turns_place_conflict : 'cancel',
      simul_turns_free_move_after_capture:   ['disable', 'restage', 'allow'].includes(gameData.simul_turns_free_move_after_capture) ? gameData.simul_turns_free_move_after_capture : 'disable',
      simul_turns_simultaneous_capture_draw: gameData.simul_turns_simultaneous_capture_draw === false || gameData.simul_turns_simultaneous_capture_draw === 0 ? 0 : 1,
      simul_turns_simultaneous_checkmate_draw: gameData.simul_turns_simultaneous_checkmate_draw === false || gameData.simul_turns_simultaneous_checkmate_draw === 0 ? 0 : 1,
      board_width:                           gameData.board_width || 8,
      board_height:                          gameData.board_height || 8,
      player_count:                          gameData.player_count || 2,
      starting_piece_count:                  gameData.starting_piece_count || 0,
      pieces_string:                         gameData.pieces_string || null,
      range_squares_string:                  sanitizeRangeSquaresJSON(gameData.range_squares_string) || null,
      promotion_squares_string:              gameData.promotion_squares_string || null,
      special_squares_string:                sanitizeSpecialSquaresJSON(gameData.special_squares_string) || null,
      control_squares_string:                gameData.control_squares_string || null,
      randomized_starting_positions:         gameData.randomized_starting_positions || null,
      default_starting_mode:                 ['none','backrow','mirrored','independent','shared','full'].includes(gameData.default_starting_mode) ? gameData.default_starting_mode : null,
      other_game_data:                       gameData.other_game_data || null,
      optional_condition:                    gameData.optional_condition || null,
      draw_move_limit:                       gameData.draw_move_limit != null ? gameData.draw_move_limit : null,
      repetition_draw_count:                 (gameData.repetition_draw_count != null && gameData.repetition_draw_count >= 2 && gameData.repetition_draw_count <= 9) ? gameData.repetition_draw_count : null,
      no_moves_condition:                    gameData.no_moves_condition || false,
      piece_count_condition:                 gameData.piece_count_condition || false,
      promotion_condition:                   gameData.promotion_condition || false,
      lose_all_pieces_condition:             gameData.lose_all_pieces_condition || false,
      stalemate_win_condition:               gameData.stalemate_win_condition || false,
      stalemate_draw_condition:              gameData.stalemate_draw_condition !== undefined ? !!gameData.stalemate_draw_condition : true,
      forced_capture_condition:              gameData.forced_capture_condition || false,
      points_to_win:                         (gameData.points_to_win != null && gameData.points_to_win > 0) ? Math.min(9999, Math.max(1, Number(gameData.points_to_win))) : null,
      starting_points_p1:                    Math.max(0, Math.min(9999, Number(gameData.starting_points_p1) || 0)),
      starting_points_p2:                    Math.max(0, Math.min(9999, Number(gameData.starting_points_p2) || 0)),
      draw_equal_points_at_turn:             (gameData.draw_equal_points_at_turn != null && gameData.draw_equal_points_at_turn > 0) ? Math.min(9999, Math.max(1, Number(gameData.draw_equal_points_at_turn))) : null,
      draw_equal_points_consecutive:         (gameData.draw_equal_points_consecutive != null && gameData.draw_equal_points_consecutive > 0) ? Math.min(999, Math.max(1, Number(gameData.draw_equal_points_consecutive))) : null,
      is_draft:                              isDraft,
      draft_saved_step:                      draftSavedStep,
      // Reset uniqueness on every save so the uniqueness job re-evaluates the updated game.
      is_unique:                             null,
      uniqueness_score:                      null,
      similar_games:                         null,
    };
    const setClause = Object.keys(updateMap).map(k => `${k} = ?`).join(', ');
    const sql = `UPDATE game_types SET ${setClause} WHERE id = ?`;
    const values = [...Object.values(updateMap), gameId];
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

        // Insert each piece (skip multi-tile extension squares, only save anchors)
        for (const piece of piecesToInsert) {
          if (piece.piece_id && !piece._occupied && !piece._anchorKey) {
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
              piece.castling_partner_right_key || null,
              piece.can_control_squares || false,
              piece.castling_distance ?? 2,
              piece.hit_points ?? 1,
              piece.attack_damage ?? 1,
              piece.show_hp_ad || false,
              piece.hp_regen ?? 0,
              piece.cannot_be_captured || false,
              piece.show_regen ?? false,
              piece.burn_damage ?? 0,
              piece.burn_duration ?? 0,
              piece.show_burn ?? false,
              piece.trample || false,
              piece.trample_radius ?? 0,
              piece.ghostwalk || false,
              piece.die_on_capture || false,
              piece.attack_radius ?? 0,
              (piece.image_index != null && piece.image_index >= 0) ? Number(piece.image_index) : null,
              piece.promotion_pieces_override ?? null,
              piece.can_promote_to_checkmate || false,
              piece.limit_promote_checkmate_to_original || false,
              piece.can_promote_to_capture || false,
              piece.limit_promote_capture_to_original || false,
              piece.capture_points_gain ?? 0,
              piece.capture_points_loss ?? 0,
              piece.cannot_move_outside_zone || false,
              piece.is_neutral || false
            );
          }
        }
      } catch (parseError) {
        console.error('Error parsing pieces_string:', parseError);
      }
    }

    // If publishing a draft (was draft, now not), create forum and notify owner
    if (existingGame.is_draft && !isDraft) {
      try {
        const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const forumTitle = `${gameData.game_name} - Discussion`;
        const forumContent = `Welcome to the ${gameData.game_name} discussion forum! Share strategies, ask questions, and connect with other players of this game.${gameData.descript ? '\n\n' + gameData.descript : ''}`;
        const forumAuthorId = existingGame.is_anonymous_creator ? null : existingGame.creator_id;
        const forumPublicValue = gameEditNeedsNameReview ? false : true;
        await db_pool.query(
          `INSERT INTO articles (author_id, game_type_id, title, content, created_at, public) VALUES (?, ?, ?, ?, ?, ?)`,
          [forumAuthorId, gameId, forumTitle, forumContent, currentTime, forumPublicValue]
        );
      } catch (forumErr) {
        console.error('Error creating forum for published draft:', forumErr.message);
      }
    }

    // Flag game for name review if the updated name contains sensitive terms
    if (!isDraft && gameEditNeedsNameReview) {
      try {
        await db_pool.query(
          "UPDATE game_types SET name_review_status = 'pending_review' WHERE id = ?",
          [gameId]
        );
        await db_pool.query(
          `INSERT INTO name_review_queue (item_type, item_id, submitter_id, flagged_name, triggered_words)
           VALUES ('game', ?, ?, ?, ?)`,
          [gameId, req.user.id, gameData.game_name, (gameEditProfCheck?.matches || []).join(', ')]
        );
      } catch (reviewErr) {
        console.error('Error inserting into name_review_queue (game edit):', reviewErr.message);
      }
    }
    
    res.json({ 
      message: isDraft ? "Draft saved successfully" : (gameEditNeedsNameReview ? "Game updated! Your game name is under review and will be published once approved." : "Game updated successfully"),
      game: { id: gameId, ...gameData, is_draft: isDraft, needs_name_review: gameEditNeedsNameReview }
    });
    _resyncAiRules(gameId);
    // Clear any stale "starting position is decided" warning since the
    // content just passed validation. Drafts also clear (they're not visible
    // anyway, but keeps the column clean).
    initialStateValidator.writeInitialStateWarning(gameId, null).catch(() => {});
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
    
    // Verify ownership or moderation rights
    if (existingGame.creator_id !== userId) {
      const creator = await dbHelpers.findUserById(existingGame.creator_id);
      const creatorRole = creator?.role || 'user';
      // Admin 2 cannot delete game types
      if (req.user.role === 'admin' && req.user.admin_level === 2) {
        return res.status(403).send({ message: "Admin 2 does not have permission to delete game types" });
      }
      if (!canModerate(req.user.role, creatorRole)) {
        return res.status(403).send({ message: "You can only delete your own games" });
      }
    }
    
    // Delete all related records first (in order of dependencies)
    // Delete game instances/matches that use this game type
    await db_pool.query("DELETE FROM games WHERE game_type_id = ?", [gameId]);
    
    // Delete tournaments that use this game type
    await db_pool.query("DELETE FROM tournaments WHERE game_type_id = ?", [gameId]);
    
    // Delete associated forum posts
    await db_pool.query("DELETE FROM articles WHERE game_type_id = ?", [gameId]);
    
    // Delete the game type (game_type_pieces will cascade automatically)
    await db_pool.query("DELETE FROM game_types WHERE id = ?", [gameId]);
    
    res.json({ message: "Game deleted successfully" });
    // Best-effort cleanup of cached AI rules dump
    try {
      const fsMod = require('fs');
      const pathMod = require('path');
      const dir = pathMod.join(__dirname, '..', 'ai-training', String(gameId));
      if (fsMod.existsSync(dir)) fsMod.rmSync(dir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  } catch (err) {
    console.error("Error in DELETE /api/games/:gameId:", err);
    res.status(500).send({ message: "Failed to delete game", err: err.message });
  }
});

// Uniqueness checker � compares a game's full configuration against all other games
app.post("/api/games/:gameId/uniqueness-check", authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;
    const userRole = (req.user.role || '').toLowerCase();

    // Fetch the target game
    const targetGame = await dbHelpers.getGameById(gameId);
    if (!targetGame) {
      return res.status(404).send({ message: "Game not found" });
    }

    // Verify ownership (only the game creator can run the check, or admins)
    if (Number(targetGame.creator_id) !== Number(userId) && userRole !== 'admin' && userRole !== 'owner') {
      return res.status(403).send({ message: "Only the game creator can run a uniqueness check" });
    }

    // Can't check drafts
    if (targetGame.is_draft) {
      return res.status(400).send({ message: "Publish your game before running a uniqueness check" });
    }

    // Rate limit: once per day per game
    if (targetGame.last_uniqueness_check) {
      const lastCheck = new Date(targetGame.last_uniqueness_check);
      const now = new Date();
      const hoursSince = (now - lastCheck) / (1000 * 60 * 60);
      if (hoursSince < 24 && userRole !== 'admin' && userRole !== 'owner') {
        const hoursRemaining = Math.ceil(24 - hoursSince);
        return res.status(429).send({ message: `You can only run the uniqueness check once per day. Try again in ${hoursRemaining} hour${hoursRemaining !== 1 ? 's' : ''}.` });
      }
    }

    // Fetch all other published games (excluding this one and drafts)
    const [allGames] = await db_pool.query(
      `SELECT id, mate_condition, mate_piece, capture_condition, capture_piece,
              value_condition, value_piece, value_max, value_title,
              squares_condition, squares_count, hill_condition, hill_x, hill_y, hill_turns,
              no_moves_condition, piece_count_condition, promotion_condition, optional_condition,
              lose_all_pieces_condition, stalemate_win_condition, forced_capture_condition,
              actions_per_turn, simultaneous_turns, board_width, board_height, player_count,
              draw_move_limit, repetition_draw_count,
              range_squares_string, promotion_squares_string, special_squares_string, control_squares_string,
              other_game_data, game_name, created_at
       FROM game_types
       WHERE id != ? AND (is_draft = 0 OR is_draft IS NULL) AND (is_training_only = 0 OR is_training_only IS NULL)`,
      [gameId]
    );

    if (allGames.length === 0) {
      // No other games to compare against � automatically unique
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await db_pool.query(
        `UPDATE game_types SET is_unique = 1, unique_badge_date = COALESCE(unique_badge_date, ?), uniqueness_score = 100, similar_games = '[]', last_uniqueness_check = ? WHERE id = ?`,
        [now, now, gameId]
      );
      return res.json({
        is_unique: true,
        uniqueness_score: 100,
        similar_games: [],
        badge_date: targetGame.unique_badge_date || now
      });
    }

    // Fetch target game's pieces from junction table with full piece data
    const targetPieces = await dbHelpers.getPiecesForGameType(gameId);

    // Helper: normalize special squares JSON for comparison (ignoring empty)
    const normalizeSquaresJSON = (str) => {
      if (!str) return null;
      try {
        const parsed = JSON.parse(str);
        if (!parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) return null;
        return parsed;
      } catch { return null; }
    };

    // Helper: deep compare two objects/arrays
    const deepEqual = (a, b) => {
      if (a === b) return true;
      if (a == null && b == null) return true;
      if (a == null || b == null) return false;
      if (typeof a !== typeof b) return false;
      if (typeof a !== 'object') return String(a) === String(b);
      const keysA = Object.keys(a).sort();
      const keysB = Object.keys(b).sort();
      if (keysA.length !== keysB.length) return false;
      for (let i = 0; i < keysA.length; i++) {
        if (keysA[i] !== keysB[i]) return false;
        if (!deepEqual(a[keysA[i]], b[keysB[i]])) return false;
      }
      return true;
    };

    // Piece columns to compare for uniqueness (from pieces table � movement/attack settings)
    const pieceCompareColumns = [
      'directional_movement_style', 'repeating_movement',
      'max_directional_movement_iterations', 'min_directional_movement_iterations',
      'up_left_movement', 'up_movement', 'up_right_movement', 'right_movement',
      'down_right_movement', 'down_movement', 'down_left_movement', 'left_movement',
      'ratio_movement_style', 'ratio_one_movement', 'ratio_two_movement',
      'repeating_ratio', 'max_ratio_iterations', 'min_ratio_iterations',
      'step_by_step_movement_style', 'step_by_step_movement_value',
      'can_hop_over_allies', 'can_hop_over_enemies',
      'can_capture_enemy_via_range', 'can_capture_ally_via_range',
      'can_capture_enemy_on_move', 'can_capture_ally_on_range', 'can_attack_on_iteration',
      'up_left_attack_range', 'up_attack_range', 'up_right_attack_range', 'right_attack_range',
      'down_right_attack_range', 'down_attack_range', 'down_left_attack_range', 'left_attack_range',
      'repeating_directional_ranged_attack', 'max_directional_ranged_attack_iterations',
      'min_directional_ranged_attack_iterations',
      'ratio_one_attack_range', 'ratio_two_attack_range',
      'repeating_ratio_ranged_attack', 'max_ratio_ranged_attack_iterations',
      'min_ratio_ranged_attack_iterations',
      'step_by_step_attack_style', 'step_by_step_attack_value',
      'max_piece_captures_per_move', 'max_piece_captures_per_ranged_attack',
      'special_scenario_moves', 'special_scenario_captures',
      'has_checkmate_rule', 'has_check_rule', 'has_lose_on_capture_rule',
      'can_castle', 'can_promote',
      'piece_width', 'piece_height',
      'can_fire_over_allies', 'can_fire_over_enemies', 'can_en_passant',
      'exact_ratio_hop_only', 'directional_hop_disabled',
      'repeating_capture', 'repeating_ratio_capture', 'max_ratio_capture_iterations',
      'can_capture_allies', 'cannot_be_captured', 'max_chain_hops',
      'promotion_pieces_ids'
    ];

    // Junction table columns to compare (HP, attack, etc.)
    const junctionCompareColumns = [
      'ends_game_on_checkmate', 'ends_game_on_capture',
      'manual_castling_partners', 'castling_partner_left_key', 'castling_partner_right_key',
      'castling_distance', 'can_control_squares',
      'hit_points', 'attack_damage', 'hp_regen',
      'cannot_be_captured', 'burn_damage', 'burn_duration',
      'trample', 'trample_radius', 'ghostwalk', 'die_on_capture', 'attack_radius',
      'cannot_move_outside_zone'
    ];

    // Build a fingerprint for a piece that captures all gameplay-relevant settings
    const buildPieceFingerprint = (piece) => {
      const fp = {};
      for (const col of pieceCompareColumns) {
        fp[col] = piece[col] ?? null;
      }
      for (const col of junctionCompareColumns) {
        fp[col] = piece[col] ?? null;
      }
      // Include position and player number
      fp.x = piece.x;
      fp.y = piece.y;
      fp.player_number = piece.player_number;
      return fp;
    };

    // Build sorted fingerprints for target game's pieces
    const targetFingerprints = targetPieces
      .map(p => buildPieceFingerprint(p))
      .sort((a, b) => a.player_number - b.player_number || a.y - b.y || a.x - b.x);

    // Target game data for comparison
    const targetSquares = {
      range: normalizeSquaresJSON(targetGame.range_squares_string),
      promotion: normalizeSquaresJSON(targetGame.promotion_squares_string),
      special: normalizeSquaresJSON(targetGame.special_squares_string),
      control: normalizeSquaresJSON(targetGame.control_squares_string),
    };

    // Parse target other_game_data for gameplay-relevant settings
    let targetOtherData = {};
    try { targetOtherData = JSON.parse(targetGame.other_game_data || '{}') || {}; } catch {}
    // Only keep gameplay-relevant keys from other_game_data
    const gameplayOtherDataKeys = ['place_pieces_action', 'placeable_pieces'];
    const targetOtherDataFiltered = {};
    for (const key of gameplayOtherDataKeys) {
      if (targetOtherData[key] !== undefined) targetOtherDataFiltered[key] = targetOtherData[key];
    }

    // Compare each game and calculate similarity
    const similarities = []; // { id, name, score, created_at }
    let isUnique = true;

    for (const otherGame of allGames) {
      let matchScore = 0;
      let totalWeight = 0;
      let isIdentical = true;

      // --- LEVEL 1: Win conditions (weight: 30) ---
      const winConditionFields = [
        'mate_condition', 'capture_condition', 'value_condition', 'squares_condition',
        'hill_condition', 'no_moves_condition', 'piece_count_condition', 'promotion_condition',
        'lose_all_pieces_condition', 'stalemate_win_condition', 'forced_capture_condition'
      ];
      const winWeight = 30;
      totalWeight += winWeight;
      let winMatches = 0;
      for (const field of winConditionFields) {
        if (Boolean(targetGame[field]) === Boolean(otherGame[field])) {
          winMatches++;
        } else {
          isIdentical = false;
        }
      }
      // Also check win condition parameters
      const winParamFields = ['mate_piece', 'capture_piece', 'value_piece', 'value_max',
        'squares_count', 'hill_x', 'hill_y', 'hill_turns', 'optional_condition'];
      let winParamMatches = 0;
      for (const field of winParamFields) {
        const tVal = targetGame[field] ?? null;
        const oVal = otherGame[field] ?? null;
        if (String(tVal) === String(oVal)) {
          winParamMatches++;
        } else {
          isIdentical = false;
        }
      }
      const totalWinFields = winConditionFields.length + winParamFields.length;
      matchScore += winWeight * ((winMatches + winParamMatches) / totalWinFields);

      if (!isIdentical) {
        // Continue to compute similarity but we already know it's not identical
      }

      // --- LEVEL 2: Board settings (weight: 15) ---
      const boardWeight = 15;
      totalWeight += boardWeight;
      const boardFields = ['board_width', 'board_height', 'player_count', 'actions_per_turn',
        'simultaneous_turns', 'draw_move_limit', 'repetition_draw_count'];
      let boardMatches = 0;
      for (const field of boardFields) {
        const tVal = targetGame[field] ?? null;
        const oVal = otherGame[field] ?? null;
        if (String(tVal) === String(oVal)) {
          boardMatches++;
        } else {
          isIdentical = false;
        }
      }
      matchScore += boardWeight * (boardMatches / boardFields.length);

      // --- LEVEL 3: Special squares (weight: 15) ---
      const squaresWeight = 15;
      totalWeight += squaresWeight;
      const otherSquares = {
        range: normalizeSquaresJSON(otherGame.range_squares_string),
        promotion: normalizeSquaresJSON(otherGame.promotion_squares_string),
        special: normalizeSquaresJSON(otherGame.special_squares_string),
        control: normalizeSquaresJSON(otherGame.control_squares_string),
      };
      let squareMatches = 0;
      const squareTypes = ['range', 'promotion', 'special', 'control'];
      for (const type of squareTypes) {
        if (deepEqual(targetSquares[type], otherSquares[type])) {
          squareMatches++;
        } else {
          isIdentical = false;
        }
      }
      matchScore += squaresWeight * (squareMatches / squareTypes.length);

      // --- LEVEL 3.5: Other game data (weight: 5) ---
      const otherDataWeight = 5;
      totalWeight += otherDataWeight;
      let otherOtherData = {};
      try { otherOtherData = JSON.parse(otherGame.other_game_data || '{}') || {}; } catch {}
      const otherOtherDataFiltered = {};
      for (const key of gameplayOtherDataKeys) {
        if (otherOtherData[key] !== undefined) otherOtherDataFiltered[key] = otherOtherData[key];
      }
      if (deepEqual(targetOtherDataFiltered, otherOtherDataFiltered)) {
        matchScore += otherDataWeight;
      } else {
        isIdentical = false;
      }

      // --- LEVEL 4: Pieces (weight: 35) � most expensive, do last ---
      const piecesWeight = 35;
      totalWeight += piecesWeight;

      // Only do full piece comparison if still potentially identical or for scoring
      const otherPieces = await dbHelpers.getPiecesForGameType(otherGame.id);
      const otherFingerprints = otherPieces
        .map(p => buildPieceFingerprint(p))
        .sort((a, b) => a.player_number - b.player_number || a.y - b.y || a.x - b.x);

      if (targetFingerprints.length !== otherFingerprints.length) {
        isIdentical = false;
        // Score based on piece count similarity
        const maxPieces = Math.max(targetFingerprints.length, otherFingerprints.length);
        const minPieces = Math.min(targetFingerprints.length, otherFingerprints.length);
        matchScore += piecesWeight * (minPieces / maxPieces) * 0.5; // partial credit
      } else {
        // Compare piece by piece (sorted by position)
        let pieceMatches = 0;
        for (let i = 0; i < targetFingerprints.length; i++) {
          if (deepEqual(targetFingerprints[i], otherFingerprints[i])) {
            pieceMatches++;
          } else {
            isIdentical = false;
            // Partial credit: count matching fields
            const allCols = [...pieceCompareColumns, ...junctionCompareColumns, 'x', 'y', 'player_number'];
            let fieldMatches = 0;
            for (const col of allCols) {
              if (String(targetFingerprints[i][col] ?? '') === String(otherFingerprints[i][col] ?? '')) {
                fieldMatches++;
              }
            }
            pieceMatches += fieldMatches / allCols.length;
          }
        }
        matchScore += piecesWeight * (pieceMatches / targetFingerprints.length);
      }

      // Calculate final similarity percentage
      const similarityScore = Math.round((matchScore / totalWeight) * 100);

      if (isIdentical) {
        isUnique = false;
      }

      similarities.push({
        id: otherGame.id,
        name: otherGame.game_name,
        score: similarityScore,
        created_at: otherGame.created_at
      });
    }

    // Sort by similarity score descending, take top 3
    similarities.sort((a, b) => b.score - a.score);
    const topSimilar = similarities.slice(0, 3).map(s => ({
      id: s.id,
      name: s.name,
      similarity: s.score
    }));

    // Calculate uniqueness score (inverse of highest similarity)
    const highestSimilarity = similarities.length > 0 ? similarities[0].score : 0;
    const uniquenessScore = Math.max(0, 100 - highestSimilarity);

    // Determine badge date logic:
    // If unique and previously had badge, keep old date
    // If unique and no previous badge, set new date
    // If not unique but previously had badge AND was the first creator: keep badge date
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let badgeDate = targetGame.unique_badge_date;

    if (isUnique) {
      // Award or keep badge
      if (!badgeDate) {
        badgeDate = now;
      }
    } else {
      // Check if this game was created before any identical game
      const identicalGames = similarities.filter(s => s.score === 100);
      const targetCreatedAt = targetGame.created_at ? new Date(targetGame.created_at) : null;
      let wasFirst = true;
      for (const ig of identicalGames) {
        if (ig.created_at && targetCreatedAt && new Date(ig.created_at) < targetCreatedAt) {
          wasFirst = false;
          break;
        }
      }
      if (wasFirst && badgeDate) {
        // Creator was first � keep their badge date
        isUnique = true; // they maintain their badge
      } else if (!wasFirst) {
        // Not the first � lose badge
        badgeDate = null;
      }
    }

    // Update database
    await db_pool.query(
      `UPDATE game_types SET is_unique = ?, unique_badge_date = ?, uniqueness_score = ?, similar_games = ?, last_uniqueness_check = ? WHERE id = ?`,
      [isUnique ? 1 : 0, badgeDate, uniquenessScore, JSON.stringify(topSimilar), now, gameId]
    );

    res.json({
      is_unique: isUnique,
      uniqueness_score: uniquenessScore,
      similar_games: topSimilar,
      badge_date: badgeDate,
      games_compared: allGames.length
    });

  } catch (err) {
    console.error("Error in POST /api/games/:gameId/uniqueness-check:", err);
    res.status(500).send({ message: "Failed to run uniqueness check", err: err.message });
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
    if (username.toLowerCase() === 'anonymous') {
      return res.status(400).send({ message: "This username is reserved and cannot be used" });
    }

    // Content moderation: Check username for offensive content
    const usernameCheck = checkUsername(username);
    if (!usernameCheck.isClean) {
      return res.status(400).send({ message: "This username contains inappropriate language. Please choose a different username." });
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
    
    // Notify owner of new user registration (non-blocking)
    dbHelpers.getOwnerUserId().then(async (ownerId) => {
      if (ownerId && ownerId !== user.id) {
        try {
          await dbHelpers.createNotification({
            user_id: ownerId,
            sender_id: user.id,
            type: 'system',
            title: `New user registered: ${username}`,
            content: `A new user "${username}" has joined the site.`,
            // Store the user's id so the link still resolves if they later
            // change their username. /profile/id/:userId looks up the
            // current username server-side and redirects.
            related_id: user.id,
            action_url: `/profile/id/${user.id}`
          });
          // Push real-time notification if owner is online
          const gameSocket = require("./game-socket");
          const ownerSocketId = gameSocket.userSockets.get(ownerId.toString());
          if (ownerSocketId && gameSocket.getIO()) {
            const unreadCount = await dbHelpers.getUnreadNotificationCount(ownerId);
            gameSocket.getIO().to(ownerSocketId).emit('newNotification', { type: 'system', title: `New user registered: ${username}` });
            gameSocket.getIO().to(ownerSocketId).emit('unreadNotificationCount', { unreadCount });
          }
        } catch (err) { console.error('Owner notification (new user) failed:', err.message); }
      }
    }).catch(() => {});

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

app.post("/api/profile/edit", authenticateToken, async (req, res) => {
  try {
    const { username, current_user, password, oldPassword, bio, email, first_name, last_name, id, show_display_name, chess_com_username, lichess_username } = req.body;
    const logged_in_username = current_user.username;
    const logged_in_email = current_user.email;
    const requesterRole = req.user.role?.toLowerCase();

    console.log("in the edit backend");
    console.log("username: " + username + " id: " + id);
    console.log("previous username: " + logged_in_username);
    // Security: Never log passwords

    // Verify the user exists
    const currentUser = await dbHelpers.findUserByUsername(logged_in_username);
    if (!currentUser) {
      return res.status(404).send({ message: "User no longer exists" });
    }

    // If editing another user's profile, check moderation rights
    if (req.user.id !== parseInt(id)) {
      const targetUser = await dbHelpers.findUserById(id);
      if (!targetUser) {
        return res.status(404).send({ message: "Target user not found" });
      }
      if (!canModerate(requesterRole, targetUser.role)) {
        return res.status(403).send({ message: "Not authorized to edit this account" });
      }
    }

    // Check if new username is already taken by another user
    const usernameCheck = await dbHelpers.findUserByUsername(username);
    if (usernameCheck && usernameCheck.username !== logged_in_username) {
      return res.status(500).send({ message: "Username already taken" });
    }

    // Check username length and format (matching registration validation)
    if (!username || username.length < 3 || username.length > 20) {
      return res.status(400).send({ message: "Username must be between 3 and 20 characters" });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).send({ message: "Username can only contain letters, numbers, underscores, and hyphens" });
    }
    if (username.toLowerCase() === 'anonymous') {
      return res.status(400).send({ message: "This username is reserved and cannot be used" });
    }

    // Content moderation: Check username for offensive content
    const usernameContentCheck = checkUsername(username);
    if (!usernameContentCheck.isClean) {
      return res.status(400).send({ message: "This username contains inappropriate language. Please choose a different username." });
    }

    // Content moderation: Check bio for offensive content and links
    if (bio) {
      const bioCheck = validateContent(bio, { fieldName: 'Bio', maxLength: 500, allowLinks: 'whitelist' });
      if (!bioCheck.isValid) {
        return res.status(400).send({ message: bioCheck.errors[0] });
      }
    }

    // Security: Email validation (matching registration validation)
    // Waive email requirement for Lichess OAuth users (Lichess API does not expose emails)
    const editTargetUser = req.user.id !== parseInt(id) ? await dbHelpers.findUserById(id) : currentUser;
    const isLichessUser = !!(editTargetUser && editTargetUser.lichess_id);
    if (!isLichessUser && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).send({ message: "Please provide a valid email address" });
    }
    if (email && email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).send({ message: "Please provide a valid email address" });
    }

    // Check if new email is already taken by another user
    const emailCheck = await dbHelpers.findUserByEmail(email);
    if (emailCheck && emailCheck.email !== logged_in_email) {
      return res.status(400).send({ message: "Email already taken" });
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

    // Handle show_display_name setting
    if (show_display_name !== undefined) {
      updatedUser.show_display_name = show_display_name ? 1 : 0;
    }

    // Validate and apply chess.com / lichess.org username links (max 50 chars,
    // alphanumeric + underscore + hyphen + dot). Empty string clears the link.
    const PROFILE_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;
    if (chess_com_username !== undefined) {
      const trimmed = (chess_com_username || "").trim();
      if (trimmed.length > 0 && !PROFILE_USERNAME_PATTERN.test(trimmed)) {
        return res.status(400).send({ message: "Chess.com username can only contain letters, numbers, underscores, hyphens, and periods (max 50 chars)." });
      }
      updatedUser.chess_com_username = trimmed.length > 0 ? trimmed : null;
    }
    if (lichess_username !== undefined) {
      const trimmed = (lichess_username || "").trim();
      if (trimmed.length > 0 && !PROFILE_USERNAME_PATTERN.test(trimmed)) {
        return res.status(400).send({ message: "Lichess username can only contain letters, numbers, underscores, hyphens, and periods (max 50 chars)." });
      }
      updatedUser.lichess_username = trimmed.length > 0 ? trimmed : null;
    }

    // Hash password if provided
    if (password && password.length > 0) {
      // Require old password verification for non-admin users
      if (requesterRole !== "admin" && requesterRole !== "owner") {
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

// Password-only update endpoint
app.post("/api/profile/change-password", authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).send({ message: "Current password and new password are required" });
    }

    // Fetch current user
    const [userRows] = await db_pool.query("SELECT id, password FROM users WHERE id = ?", [userId]);
    if (!userRows || userRows.length === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    const user = userRows[0];

    // Verify old password
    const passwordMatch = bcrypt.compareSync(oldPassword, user.password);
    if (!passwordMatch) {
      return res.status(400).send({ message: "Current password is incorrect" });
    }

    // Validate new password
    if (newPassword.length < 8) {
      return res.status(400).send({ message: "Password must be at least 8 characters long" });
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      return res.status(400).send({ message: "Password must contain at least one uppercase letter, one lowercase letter, and one number" });
    }

    // Hash and update
    const hashedPassword = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    await db_pool.query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, userId]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Error in /api/profile/change-password:", err);
    res.status(500).send({ message: "Password update failed" });
  }
});

app.post("/api/profile/upload-picture", multerWrap(profilePictureUpload.single('profile_picture'), '2 MB'), async (req, res) => {
  try {
    const userId = req.body.user_id;
    const imageFile = req.file;

    if (!imageFile) {
      return res.status(400).send({ message: "Profile picture is required" });
    }

    if (!userId) {
      return res.status(400).send({ message: "User ID is required" });
    }

    // NSFW scan on profile picture
    const filePath = path.join(imageFile.destination, imageFile.filename);
    const scanResult = await imageModeration.classifyImage(filePath);
    if (scanResult.status === 'rejected') {
      try { fs.unlinkSync(filePath); } catch (e) {}
      return res.status(400).send({
        message: "Your profile picture was rejected by our content filter. Please use an appropriate image.",
        details: [scanResult.reason]
      });
    }

    // Deduplicate by content hash so re-uploads of the same image reuse the
    // existing file on disk instead of creating duplicates.
    dedupeUploadedFile(imageFile);

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

    // Delete old profile picture if it exists � but only if no other user
    // (or this user's new picture) is still referencing the same path.
    if (oldPicturePath && oldPicturePath !== imagePath) {
      const [refRows] = await db_pool.query(
        "SELECT COUNT(*) AS refs FROM chessusnode.users WHERE profile_picture = ?",
        [oldPicturePath]
      );
      if (refRows[0].refs === 0) {
        const oldFilePath = path.join(__dirname, '..', oldPicturePath);
        fs.unlink(oldFilePath, (err) => {
          if (err) {
            console.error("Error deleting old profile picture:", err);
          } else {
            console.log("Deleted old profile picture:", oldFilePath);
          }
        });
      }
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
      message: scanResult.status === 'pending_review'
        ? "Profile picture uploaded! It's being reviewed and may take a short time to appear publicly."
        : "Profile picture uploaded successfully"
    });
  } catch (err) {
    console.error("Error uploading profile picture:", err);
    res.status(500).send({ message: "Upload failed", err: err.message });
  }
});

// Note: Using custom loginAttempts tracking instead of authLimiter
// This only counts FAILED attempts, so successful logins aren't rate-limited
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    // Lock out per username only - prevents cross-user lockout issues
    // while still protecting against brute force on specific accounts
    const lockoutKey = username.toLowerCase();

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
    const userPayload = { id: user.id, username: user.username, role: user.role, admin_level: user.admin_level ?? null };
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

// Google Sign-In
app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).send({ auth: false, message: "Google credential is required" });
    }

    const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return res.status(500).send({ auth: false, message: "Google Sign-In is not configured on the server" });
    }

    // Verify the Google ID token
    const client = new OAuth2Client(googleClientId);
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: googleClientId,
      });
    } catch (verifyErr) {
      return res.status(401).send({ auth: false, message: "Invalid Google token" });
    }

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || "";

    if (!email) {
      return res.status(400).send({ auth: false, message: "Google account must have an email address" });
    }

    // Check if a user with this google_id already exists
    let user;
    const [googleUsers] = await db_pool.query(
      "SELECT * FROM chessusnode.users WHERE google_id = ?", [googleId]
    );

    if (googleUsers.length > 0) {
      user = googleUsers[0];
    } else {
      // Check if a user with this email already exists (link accounts)
      user = await dbHelpers.findUserByEmail(email);

      if (user) {
        // Link existing account to Google
        await db_pool.query(
          "UPDATE chessusnode.users SET google_id = ? WHERE id = ?",
          [googleId, user.id]
        );
      } else {
        // Create a new account
        // Generate a unique username from the email prefix
        let baseUsername = email.split("@")[0]
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .substring(0, 16);
        if (baseUsername.length < 3) baseUsername = "user";

        let username = baseUsername;
        let suffix = 1;
        while (await dbHelpers.findUserByUsername(username)) {
          username = `${baseUsername}${suffix}`;
          suffix++;
        }

        // Create user with no password (Google-only auth)
        const defaultLightColor = '#e3d4bf';
        const defaultDarkColor = '#64472b';
        await db_pool.query(
          "INSERT INTO chessusnode.users (username, password, email, google_id, light_square_color, dark_square_color, allow_non_friend_dms, sound_enabled) VALUES (?,?,?,?,?,?,1,1)",
          [username, "", email, googleId, defaultLightColor, defaultDarkColor]
        );

        user = await dbHelpers.findUserByEmail(email);

        // Notify owner of new user registration via Google (non-blocking)
        dbHelpers.getOwnerUserId().then(async (ownerId) => {
          if (ownerId && ownerId !== user.id) {
            try {
              await dbHelpers.createNotification({
                user_id: ownerId,
                sender_id: user.id,
                type: 'system',
                title: `New user registered: ${username}`,
                content: `A new user "${username}" has joined via Google sign-in.`,
                action_url: `/profile/${username}`
              });
              const gameSocket = require("./game-socket");
              const ownerSocketId = gameSocket.userSockets.get(ownerId.toString());
              if (ownerSocketId && gameSocket.getIO()) {
                const unreadCount = await dbHelpers.getUnreadNotificationCount(ownerId);
                gameSocket.getIO().to(ownerSocketId).emit('newNotification', { type: 'system', title: `New user registered: ${username}` });
                gameSocket.getIO().to(ownerSocketId).emit('unreadNotificationCount', { unreadCount });
              }
            } catch (err) { console.error('Owner notification (new Google user) failed:', err.message); }
          }
        }).catch(() => {});

        // Send welcome email (non-blocking)
        sendWelcomeEmail(email, username).catch(err => {
          console.error("Welcome email failed:", err.message);
        });
      }
    }

    // Check if user is banned
    if (user.banned) {
      if (user.ban_expires_at && new Date(user.ban_expires_at) < new Date()) {
        await db_pool.query(
          "UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
          [user.id]
        );
      } else {
        const banMessage = user.ban_expires_at
          ? `Your account is temporarily banned until ${new Date(user.ban_expires_at).toLocaleString()}.`
          : 'Your account has been permanently banned.';
        return res.status(403).send({ auth: false, message: banMessage, banned: true });
      }
    }

    // Generate tokens
    const userPayload = { id: user.id, username: user.username, role: user.role, admin_level: user.admin_level ?? null };
    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload);

    await db_pool.query(
      "UPDATE users SET refresh_token = ?, last_active_at = NOW() WHERE id = ?",
      [refreshToken, user.id]
    );

    user.accessToken = accessToken;
    user.refreshToken = refreshToken;
    delete user.password;
    delete user.refresh_token;
    delete user.banned;
    delete user.ban_reason;
    delete user.banned_at;
    delete user.banned_by;
    delete user.ban_expires_at;

    res.json({ auth: true, result: user });
  } catch (err) {
    console.error("Error in /api/auth/google:", err);
    res.status(500).send({ auth: false, message: "Google Sign-In failed", err: err.message });
  }
});

// Lichess OAuth Login
app.post("/api/auth/lichess", async (req, res) => {
  try {
    const { code, codeVerifier, redirectUri } = req.body;
    if (!code || !codeVerifier || !redirectUri) {
      return res.status(400).send({ auth: false, message: "Lichess authorization code, code verifier, and redirect URI are required" });
    }

    const lichessClientId = process.env.LICHESS_CLIENT_ID;
    if (!lichessClientId) {
      return res.status(500).send({ auth: false, message: "Lichess OAuth is not configured on the server" });
    }

    // Exchange authorization code for access token
    let tokenResponse;
    try {
      tokenResponse = await fetch("https://lichess.org/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          client_id: lichessClientId,
        }),
      });
    } catch (fetchErr) {
      return res.status(502).send({ auth: false, message: "Failed to connect to Lichess" });
    }

    if (!tokenResponse.ok) {
      return res.status(401).send({ auth: false, message: "Invalid Lichess authorization code" });
    }

    const tokenData = await tokenResponse.json();
    const lichessAccessToken = tokenData.access_token;

    if (!lichessAccessToken) {
      return res.status(401).send({ auth: false, message: "Failed to obtain Lichess access token" });
    }

    // Fetch the Lichess user profile
    let profileResponse;
    try {
      profileResponse = await fetch("https://lichess.org/api/account", {
        headers: { Authorization: `Bearer ${lichessAccessToken}` },
      });
    } catch (fetchErr) {
      return res.status(502).send({ auth: false, message: "Failed to fetch Lichess profile" });
    }

    if (!profileResponse.ok) {
      return res.status(401).send({ auth: false, message: "Failed to verify Lichess account" });
    }

    const lichessProfile = await profileResponse.json();
    const lichessId = lichessProfile.id; // lowercase username
    const lichessUsername = lichessProfile.username;

    if (!lichessId) {
      return res.status(400).send({ auth: false, message: "Could not retrieve Lichess user ID" });
    }

    // Check if a user with this lichess_id already exists
    let user;
    const [lichessUsers] = await db_pool.query(
      "SELECT * FROM chessusnode.users WHERE lichess_id = ?", [lichessId]
    );

    if (lichessUsers.length > 0) {
      user = lichessUsers[0];
    } else {
      // Check if a user with the same username exists (try to link)
      const existingUser = await dbHelpers.findUserByUsername(lichessUsername);

      if (existingUser && existingUser.lichess_id) {
        // Username taken by someone with a different lichess account
        // Create a new account with a suffixed username
        let username = lichessUsername;
        let suffix = 1;
        while (await dbHelpers.findUserByUsername(username)) {
          username = `${lichessUsername.substring(0, 16)}${suffix}`;
          suffix++;
        }

        const defaultLightColor = '#e3d4bf';
        const defaultDarkColor = '#64472b';
        await db_pool.query(
          "INSERT INTO chessusnode.users (username, password, lichess_id, light_square_color, dark_square_color, allow_non_friend_dms, sound_enabled) VALUES (?,?,?,?,?,1,1)",
          [username, "", lichessId, defaultLightColor, defaultDarkColor]
        );

        user = await dbHelpers.findUserByUsername(username);
      } else if (existingUser) {
        // Link existing account to Lichess
        await db_pool.query(
          "UPDATE chessusnode.users SET lichess_id = ? WHERE id = ?",
          [lichessId, existingUser.id]
        );
        user = existingUser;
      } else {
        // Create a new account
        let baseUsername = lichessUsername
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .substring(0, 20);
        if (baseUsername.length < 3) baseUsername = "user";

        let username = baseUsername;
        let suffix = 1;
        while (await dbHelpers.findUserByUsername(username)) {
          username = `${baseUsername.substring(0, 16)}${suffix}`;
          suffix++;
        }

        const defaultLightColor = '#e3d4bf';
        const defaultDarkColor = '#64472b';
        await db_pool.query(
          "INSERT INTO chessusnode.users (username, password, lichess_id, light_square_color, dark_square_color, allow_non_friend_dms, sound_enabled) VALUES (?,?,?,?,?,1,1)",
          [username, "", lichessId, defaultLightColor, defaultDarkColor]
        );

        user = await dbHelpers.findUserByUsername(username);

        // Notify owner of new user registration via Lichess (non-blocking)
        dbHelpers.getOwnerUserId().then(async (ownerId) => {
          if (ownerId && ownerId !== user.id) {
            try {
              await dbHelpers.createNotification({
                user_id: ownerId,
                sender_id: user.id,
                type: 'system',
                title: `New user registered: ${username}`,
                content: `A new user "${username}" has joined via Lichess sign-in.`,
                action_url: `/profile/${username}`
              });
              const gameSocket = require("./game-socket");
              const ownerSocketId = gameSocket.userSockets.get(ownerId.toString());
              if (ownerSocketId && gameSocket.getIO()) {
                const unreadCount = await dbHelpers.getUnreadNotificationCount(ownerId);
                gameSocket.getIO().to(ownerSocketId).emit('newNotification', { type: 'system', title: `New user registered: ${username}` });
                gameSocket.getIO().to(ownerSocketId).emit('unreadNotificationCount', { unreadCount });
              }
            } catch (err) { console.error('Owner notification (new Lichess user) failed:', err.message); }
          }
        }).catch(() => {});
      }
    }

    // Check if user is banned
    if (user.banned) {
      if (user.ban_expires_at && new Date(user.ban_expires_at) < new Date()) {
        await db_pool.query(
          "UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
          [user.id]
        );
      } else {
        const banMessage = user.ban_expires_at
          ? `Your account is temporarily banned until ${new Date(user.ban_expires_at).toLocaleString()}.`
          : 'Your account has been permanently banned.';
        return res.status(403).send({ auth: false, message: banMessage, banned: true });
      }
    }

    // Generate tokens
    const userPayload = { id: user.id, username: user.username, role: user.role, admin_level: user.admin_level ?? null };
    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload);

    await db_pool.query(
      "UPDATE users SET refresh_token = ?, last_active_at = NOW() WHERE id = ?",
      [refreshToken, user.id]
    );

    user.accessToken = accessToken;
    user.refreshToken = refreshToken;
    delete user.password;
    delete user.refresh_token;
    delete user.banned;
    delete user.ban_reason;
    delete user.banned_at;
    delete user.banned_by;
    delete user.ban_expires_at;

    res.json({ auth: true, result: user });
  } catch (err) {
    console.error("Error in /api/auth/lichess:", err);
    res.status(500).send({ auth: false, message: "Lichess Sign-In failed", err: err.message });
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

// Request password reset
app.post("/api/forgot-password", authLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    // Find user by email
    const user = await dbHelpers.findUserByEmail(email);
    
    // Always return success to prevent email enumeration
    if (!user) {
      console.log(`Password reset requested for non-existent email: ${email}`);
      return res.json({ message: "If an account with that email exists, a password reset link has been sent." });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour from now

    // Store token in database
    await db_pool.query(
      "UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?",
      [resetToken, resetExpires, user.id]
    );

    // Send reset email
    const emailResult = await sendPasswordResetEmail(email, user.username, resetToken);
    
    if (!emailResult.success) {
      console.warn(`Failed to send password reset email to ${email}:`, emailResult.message || emailResult.error?.message);
    }

    res.json({ message: "If an account with that email exists, a password reset link has been sent." });
  } catch (err) {
    console.error("Error in /api/forgot-password:", err);
    res.status(500).send({ message: "Failed to process password reset request" });
  }
});

// Verify reset token (check if valid)
app.get("/api/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const [users] = await db_pool.query(
      "SELECT id, username FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()",
      [token]
    );

    if (users.length === 0) {
      return res.status(400).send({ valid: false, message: "Invalid or expired reset token" });
    }

    res.json({ valid: true, username: users[0].username });
  } catch (err) {
    console.error("Error verifying reset token:", err);
    res.status(500).send({ valid: false, message: "Failed to verify reset token" });
  }
});

// Reset password with token
app.post("/api/reset-password", authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).send({ message: "Token and password are required" });
    }

    // Security: Password validation
    if (password.length < 8) {
      return res.status(400).send({ message: "Password must be at least 8 characters long" });
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).send({ message: "Password must contain at least one uppercase letter, one lowercase letter, and one number" });
    }

    // Find user with valid token
    const [users] = await db_pool.query(
      "SELECT id, username FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()",
      [token]
    );

    if (users.length === 0) {
      return res.status(400).send({ message: "Invalid or expired reset token" });
    }

    const user = users[0];

    // Hash new password
    const hashedPassword = bcrypt.hashSync(password, BCRYPT_ROUNDS);

    // Update password and clear reset token
    await db_pool.query(
      "UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?",
      [hashedPassword, user.id]
    );

    console.log(`Password reset successful for user: ${user.username}`);
    res.json({ message: "Password has been reset successfully. You can now log in with your new password." });
  } catch (err) {
    console.error("Error in /api/reset-password:", err);
    res.status(500).send({ message: "Failed to reset password" });
  }
});

app.post("/api/delete", authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    const requestingUser = req.user;
    
    // Security: Only allow users to delete their own account, or authorized admins/owners
    if (requestingUser.username !== username) {
      // Look up target user's role
      const [[targetUser]] = await db_pool.query("SELECT role FROM users WHERE username = ?", [username]);
      if (!targetUser) {
        return res.status(404).send({ message: "User not found" });
      }
      // Admin 2 cannot delete user accounts
      if (requestingUser.role === 'admin' && requestingUser.admin_level === 2) {
        return res.status(403).send({ message: "Admin 2 does not have permission to delete user accounts" });
      }
      if (!canModerate(requestingUser.role, targetUser.role)) {
        return res.status(403).send({ message: "Not authorized to delete this account" });
      }
    }
    
    console.log(`User ${requestingUser.username} (role: ${requestingUser.role}) deleting account: ${username}`);
    
    const isSelf = requestingUser.username === username;
    await dbHelpers.deleteUser(username, {
      deletedByUserId: isSelf ? null : requestingUser.id,
      deletionType: isSelf ? 'self' : 'admin'
    });
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

    const [[users], [[{ total }]]] = await Promise.all([
      db_pool.query(
        `SELECT id, username, email, first_name, last_name, role, elo, profile_picture, bio,
                banned, ban_reason, banned_at, banned_by, ban_expires_at, last_active_at,
                total_donations
         FROM users
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      db_pool.query("SELECT COUNT(*) as total FROM users"),
    ]);

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

    // Admin 2 cannot delete game types
    if (requesterRole === 'admin' && req.user.admin_level === 2) {
      return res.status(403).send({ message: "Admin 2 does not have permission to delete game types" });
    }

    // Notify all players in the game before deleting
    const io = getIO();
    if (io) {
      io.to(`game:${gameId}`).emit('gameDeleted', {
        gameId,
        message: 'This game has been deleted by an administrator.',
        deletedBy: req.user.username
      });
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

    // admin_level: 1 = full, 2 = restricted. Default to 1 if not provided or invalid.
    const rawLevel = parseInt(req.body.admin_level, 10);
    const adminLevel = rawLevel === 2 ? 2 : 1;

    await db_pool.query(
      "UPDATE users SET role = 'admin', admin_level = ? WHERE id = ?",
      [adminLevel, userId]
    );

    res.json({ message: `User promoted to Admin ${adminLevel} successfully` });
  } catch (err) {
    console.error("Error promoting user:", err);
    res.status(500).send({ message: "Failed to promote user", err: err.message });
  }
});

// Set user's total donations / donor badge (admin/owner only)
app.post("/api/admin/users/:userId/set-donations", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterRole = req.user.role;

    if (requesterRole !== 'admin' && requesterRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Admin or owner role required." });
    }

    const { amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount < 0) {
      return res.status(400).send({ message: "Invalid donation amount — must be 0 or a positive number" });
    }

    const [users] = await db_pool.query(
      "SELECT id, username FROM users WHERE id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    await db_pool.query(
      "UPDATE users SET total_donations = ? WHERE id = ?",
      [parsedAmount, userId]
    );

    console.log(`Admin ${req.user.id} set total_donations=${parsedAmount} for user ${users[0].username} (id ${userId})`);
    res.json({ message: `Donor badge updated for ${users[0].username}`, total_donations: parsedAmount });
  } catch (err) {
    console.error("Error setting donations:", err);
    res.status(500).send({ message: "Failed to update donor badge", err: err.message });
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
      "UPDATE users SET role = 'user', admin_level = NULL WHERE id = ?",
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
    const { user_id, light_square_color, dark_square_color, hide_donation_badge } = req.body;
    
    if (!user_id) {
      return res.status(400).send({ message: "User ID is required" });
    }
    
    const fields = [];
    const values = [];
    
    if (light_square_color !== undefined) {
      fields.push("light_square_color = ?");
      values.push(light_square_color);
    }
    if (dark_square_color !== undefined) {
      fields.push("dark_square_color = ?");
      values.push(dark_square_color);
    }
    if (hide_donation_badge !== undefined) {
      fields.push("hide_donation_badge = ?");
      values.push(hide_donation_badge ? 1 : 0);
    }
    
    if (fields.length > 0) {
      values.push(user_id);
      const sql = `UPDATE chessusnode.users SET ${fields.join(", ")} WHERE id = ?`;
      await dbHelpers.query(sql, values);
    }
    
    res.json({ 
      message: "Preferences saved successfully",
      light_square_color,
      dark_square_color,
      hide_donation_badge
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

    // Content moderation
    if (title) {
      const titleCheck = validateContent(title, { fieldName: 'Title', maxLength: 200 });
      if (!titleCheck.isValid) return res.status(400).send({ message: titleCheck.errors[0] });
    }
    if (content) {
      const contentCheck = validateContent(content, { fieldName: 'Content', maxLength: 50000, allowLinks: 'whitelist' });
      if (!contentCheck.isValid) return res.status(400).send({ message: contentCheck.errors[0] });
    }
    if (description) {
      const descCheck = validateContent(description, { fieldName: 'Description', maxLength: 500, allowLinks: 'whitelist' });
      if (!descCheck.isValid) return res.status(400).send({ message: descCheck.errors[0] });
    }

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
    const { title, content, created_at, author_id, game_type_id, category } = req.body;
    console.log(content);

    // Whitelist of valid general-forum categories. Game forums force 'game'.
    const VALID_CATEGORIES = ['general', 'bug-report', 'social', 'misc', 'gameplay', 'feedback', 'announcement'];
    let finalCategory;
    if (game_type_id) {
      finalCategory = 'game';
    } else {
      finalCategory = category && VALID_CATEGORIES.includes(category) ? category : 'general';
    }

    // Content moderation
    if (title) {
      const titleCheck = validateContent(title, { fieldName: 'Title', maxLength: 200 });
      if (!titleCheck.isValid) return res.status(400).send({ message: titleCheck.errors[0] });
    }
    if (content) {
      const contentCheck = validateContent(content, { fieldName: 'Content', maxLength: 50000, allowLinks: 'whitelist' });
      if (!contentCheck.isValid) return res.status(400).send({ message: contentCheck.errors[0] });
    }
    
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
    
    const forum = await dbHelpers.createForum({ author_id, title, content, created_at, game_type_id, category: finalCategory });
    const forumId = forum.insertId || forum.id;
    const forumUrl = `/forums/${forumId}`;

    // Notify game creator when a forum thread is created for their game
    if (game_type_id) {
      try {
        const gameType = await dbHelpers.getGameById(game_type_id);
        if (gameType && gameType.creator_id && gameType.creator_id !== parseInt(author_id)) {
          const author = await dbHelpers.findUserById(parseInt(author_id));
          const notification = await dbHelpers.createNotification({
            user_id: gameType.creator_id,
            sender_id: parseInt(author_id),
            type: 'game_thread',
            title: `New discussion thread about ${gameType.game_name}`,
            content: title,
            related_id: forumId,
            action_url: forumUrl
          });
          const io = app.get('io');
          if (io) {
            const { userSockets } = require('./game-socket');
            const targetSocketId = userSockets?.get(gameType.creator_id);
            if (targetSocketId) {
              io.to(targetSocketId).emit('newNotification', { ...notification, sender_username: author?.username });
            }
          }
        }
      } catch (notifErr) {
        console.error('Error creating game thread notification:', notifErr.message);
      }
    }

    // Notify any users whose profiles are linked in the title or body
    const authorForMention = await dbHelpers.findUserById(parseInt(author_id));
    const senderName = authorForMention?.username || 'Someone';
    await notifyMentionedUsers(title + ' ' + (content || ''), author_id, senderName, `mentioned you in a forum post: "${title}"`, forumUrl);

    res.json({ result: forum });
  } catch (err) {
    console.error("Error in /api/forums/new:", err);
    res.status(500).send({ message: "Forum creation failed", err: err.message });
  }
});

app.get("/api/forums", optionalAuthenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const gameTypeId = req.query.gameTypeId;
    const scope = req.query.scope; // 'general' | 'game' | undefined (all)
    const category = req.query.category;
    const userId = req.user?.id || null;

    // Build query with optional gameTypeId / scope / category filter.
    // Always exclude career postings (is_career = 1) and news articles (is_news = 1).
    let whereConditions = ["(a.is_career IS NULL OR a.is_career = 0)", "(a.is_news IS NULL OR a.is_news = 0)"];

    if (gameTypeId) {
      whereConditions.push(`a.game_type_id = ${db_pool.escape(gameTypeId)}`);
    }
    if (scope === 'general') {
      whereConditions.push("a.game_type_id IS NULL");
    } else if (scope === 'game') {
      whereConditions.push("a.game_type_id IS NOT NULL");
    }
    if (category) {
      whereConditions.push(`a.category = ${db_pool.escape(category)}`);
    }

    const whereClause = whereConditions.length > 0 ? ` WHERE ${whereConditions.join(" AND ")}` : "";

    // Single query: sort by most-recent comment, pull comment/like counts and
    // author/game names via aggregation subqueries and JOINs so there are zero
    // per-forum round trips. Previously this was 4 queries × N forums.
    const likedByUserExpr = userId
      ? `(SELECT COUNT(*) FROM likes WHERE article_id = a.id AND user_id = ${db_pool.escape(userId)}) > 0`
      : '0';
    const articlesQuery = `
      SELECT a.*,
             lc.last_comment_at,
             lc.last_comment_id,
             lc.last_comment_author_id,
             ulc.username AS last_comment_author_name,
             COALESCE(cc.comment_count, 0) AS comment_count,
             COALESCE(lk.like_count, 0) AS like_count,
             (${likedByUserExpr}) AS liked_by_user,
             CASE WHEN a.author_id IS NULL THEN 'Anonymous' ELSE ua.username END AS author_name,
             gt.game_name
        FROM articles a
        LEFT JOIN (
          SELECT c1.article_id,
                 c1.id AS last_comment_id,
                 c1.author_id AS last_comment_author_id,
                 c1.created_at AS last_comment_at
            FROM comments c1
            INNER JOIN (
              SELECT article_id, MAX(created_at) AS max_created
                FROM comments
                GROUP BY article_id
            ) c2 ON c2.article_id = c1.article_id AND c2.max_created = c1.created_at
        ) lc ON lc.article_id = a.id
        LEFT JOIN users ulc ON ulc.id = lc.last_comment_author_id
        LEFT JOIN (
          SELECT article_id, COUNT(*) AS comment_count
            FROM comments
            GROUP BY article_id
        ) cc ON cc.article_id = a.id
        LEFT JOIN (
          SELECT article_id, COUNT(*) AS like_count
            FROM likes
            GROUP BY article_id
        ) lk ON lk.article_id = a.id
        LEFT JOIN users ua ON ua.id = a.author_id
        LEFT JOIN game_types gt ON gt.id = a.game_type_id
        ${whereClause}
        ORDER BY COALESCE(lc.last_comment_at, a.created_at) DESC
        LIMIT ${limit} OFFSET ${offset}
    `;
    const countQuery = `SELECT COUNT(*) as total FROM articles a ${whereClause}`;

    // Run both queries in parallel
    const [[countResult], [forums]] = await Promise.all([
      db_pool.query(countQuery),
      db_pool.query(articlesQuery),
    ]);
    const total = countResult[0].total;

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
      forum.author_name = "Anonymous";
    }

    // Get likes, game name, and comments — run likes + game name in parallel,
    // then fetch comments with author names in a single JOIN query.
    const [
      likes,
      gameNameRows,
      commentsWithAuthors,
    ] = await Promise.all([
      dbHelpers.getLikesByArticleId(forum_id),
      forum.game_type_id
        ? db_pool.query('SELECT game_name FROM game_types WHERE id = ?', [forum.game_type_id])
        : Promise.resolve([[]])
      ,
      db_pool.query(`
        SELECT c.*,
               COALESCE(u.username, 'User Deleted') AS author_name
          FROM chessusnode.comments c
          LEFT JOIN chessusnode.users u ON u.id = c.author_id
          WHERE c.article_id = ?
          ORDER BY c.created_at ASC
      `, [forum.id]),
    ]);

    forum.likes = likes;
    forum.game_name = gameNameRows[0]?.[0]?.game_name ?? null;
    forum.comments = commentsWithAuthors[0];

    // Attach emotes to each comment
    if (forum.comments && forum.comments.length > 0) {
      const commentIds = forum.comments.map(c => c.id);
      const allEmotes = await dbHelpers.getEmotesByCommentIds(commentIds);
      const emotesByComment = {};
      allEmotes.forEach(e => {
        if (!emotesByComment[e.comment_id]) emotesByComment[e.comment_id] = [];
        emotesByComment[e.comment_id].push({ user_id: e.user_id, username: e.username, emote_type: e.emote_type });
      });
      forum.comments.forEach(c => { c.emotes = emotesByComment[c.id] || []; });
    }

    res.json({ result: forum, message: "Forum found" });
  } catch (err) {
    console.error("Error in /api/forum:", err);
    res.status(500).send({ err: err.message });
  }
});

app.put("/api/forums/edit", authenticateToken, async (req, res) => {
  try {
    const { title, id, content, last_updated_at } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role?.toLowerCase();
    console.log(content);
    console.log("in edit forum route");

    // Content validation
    if (title) {
      const titleCheck = validateContent(title, { fieldName: 'Title', maxLength: 200 });
      if (!titleCheck.isValid) {
        return res.status(400).send({ message: titleCheck.errors[0] });
      }
    }
    if (content) {
      const contentCheck = validateContent(content, { fieldName: 'Content', maxLength: 50000, allowLinks: 'whitelist' });
      if (!contentCheck.isValid) {
        return res.status(400).send({ message: contentCheck.errors[0] });
      }
    }

    // Check ownership or moderation rights
    const [[forum]] = await db_pool.query("SELECT a.*, u.role as author_role FROM articles a LEFT JOIN users u ON a.author_id = u.id WHERE a.id = ?", [id]);
    if (!forum) {
      return res.status(404).send({ message: "Forum not found" });
    }
    if (forum.author_id !== userId) {
      if (!canModerate(userRole, forum.author_role)) {
        return res.status(403).send({ message: "You don't have permission to edit this forum" });
      }
    }
    
    await dbHelpers.updateForum({ title, content, last_updated_at, id });
    
    const result = { title, content, last_updated_at, id };
    console.log("forum: " + result.title + "content: " + result.content + "last updated: " + result.last_updated_at + ", id: " + id);
    res.json({ result });
  } catch (err) {
    console.error("Error in /api/forums/edit:", err);
    res.status(500).send({ message: "Forum edit failed", err: err.message });
  }
});

app.post("/api/forums/delete", authenticateToken, async (req, res) => {
  try {
    const id = req.body.id;
    const userId = req.user.id;
    const userRole = req.user.role?.toLowerCase();

    // Check if forum exists
    const [[forum]] = await db_pool.query("SELECT a.*, u.role as author_role FROM articles a LEFT JOIN users u ON a.author_id = u.id WHERE a.id = ?", [id]);
    if (!forum) {
      return res.status(404).send({ message: "Forum not found" });
    }

    // Verify ownership or moderation rights
    if (forum.author_id !== userId) {
      // Admin 2 cannot delete forum posts
      if (userRole === 'admin' && req.user.admin_level === 2) {
        return res.status(403).send({ message: "Admin 2 does not have permission to delete forum posts" });
      }
      if (!canModerate(userRole, forum.author_role)) {
        return res.status(403).send({ message: "You don't have permission to delete this forum" });
      }
    }

    // Check if this forum is associated with a game that still exists
    let gameExists = false;
    if (forum.game_type_id) {
      const [[game]] = await db_pool.query("SELECT id, game_name FROM game_types WHERE id = ?", [forum.game_type_id]);
      if (game) {
        gameExists = true;
      }
    }

    await dbHelpers.deleteForum(id);
    res.json({ message: "Post deleted", gameExists });
  } catch (err) {
    console.error("Error in /api/forums/delete:", err);
    res.status(500).send({ message: "Forum deletion failed", err: err.message });
  }
});




// ----------------------- Comments ---------------------------


app.post("/api/comments/new", async (req, res) => {
  try {
    const { author_id, forum_id, content, created_at, author_name, parent_id } = req.body;

    // Content moderation
    if (content) {
      const contentCheck = validateContent(content, { fieldName: 'Comment', maxLength: 10000, allowLinks: 'whitelist' });
      if (!contentCheck.isValid) return res.status(400).send({ message: contentCheck.errors[0] });
    }
    
    const comment = await dbHelpers.createComment({
      author_id,
      article_id: forum_id,
      content,
      created_at,
      author_name,
      parent_id: parent_id || null
    });

    const io = app.get('io');
    const { userSockets } = require('./game-socket');

    // If this is a reply, notify the parent comment's author
    if (parent_id) {
      try {
        const parentComments = await dbHelpers.query(
          "SELECT author_id FROM chessusnode.comments WHERE id = ?", [parent_id]
        );
        if (parentComments.length > 0) {
          const parentAuthorId = parentComments[0].author_id;
          if (parentAuthorId && parentAuthorId !== parseInt(author_id)) {
            const notification = await dbHelpers.createNotification({
              user_id: parentAuthorId,
              sender_id: parseInt(author_id),
              type: 'reply',
              title: `${author_name} replied to your comment`,
              content: content ? content.substring(0, 200) : 'New reply to your comment',
              related_id: forum_id,
              action_url: `/forums/${forum_id}`
            });
            if (io) {
              const targetSocketId = userSockets?.get(parentAuthorId);
              if (targetSocketId) {
                io.to(targetSocketId).emit('newNotification', { ...notification, sender_username: author_name });
              }
            }
          }
        }
      } catch (replyNotifErr) {
        console.error('Error creating reply notification:', replyNotifErr.message);
      }
    }

    // Notify the forum post author about the new comment (if not already notified as parent comment author)
    try {
      const forum = await dbHelpers.findArticleById(forum_id);
      if (forum && forum.author_id && forum.author_id !== parseInt(author_id)) {
        // Don't double-notify if forum author is also the parent comment author
        if (parent_id) {
          const parentComments = await dbHelpers.query(
            "SELECT author_id FROM chessusnode.comments WHERE id = ?", [parent_id]
          );
          if (parentComments.length > 0 && parentComments[0].author_id === forum.author_id) {
            // Already notified as parent comment author, skip
          } else {
            const notification = await dbHelpers.createNotification({
              user_id: forum.author_id,
              sender_id: parseInt(author_id),
              type: 'comment',
              title: `${author_name} commented on your post`,
              content: content ? content.substring(0, 200) : 'New comment on your post',
              related_id: forum_id,
              action_url: `/forums/${forum_id}`
            });
            if (io) {
              const targetSocketId = userSockets?.get(forum.author_id);
              if (targetSocketId) {
                io.to(targetSocketId).emit('newNotification', { ...notification, sender_username: author_name });
              }
            }
          }
        } else {
          const notification = await dbHelpers.createNotification({
            user_id: forum.author_id,
            sender_id: parseInt(author_id),
            type: 'comment',
            title: `${author_name} commented on your post`,
            content: content ? content.substring(0, 200) : 'New comment on your post',
            related_id: forum_id,
            action_url: `/forums/${forum_id}`
          });
          if (io) {
            const targetSocketId = userSockets?.get(forum.author_id);
            if (targetSocketId) {
              io.to(targetSocketId).emit('newNotification', { ...notification, sender_username: author_name });
            }
          }
        }
      }
    } catch (notifErr) {
      console.error('Error creating comment notification:', notifErr.message);
    }

    // Notify any users whose profiles are linked in the comment body
    await notifyMentionedUsers(content, author_id, author_name, `mentioned you in a comment`, `/forums/${forum_id}`);

    res.json({ result: comment });
  } catch (err) {
    console.error("Error in /api/comments/new:", err);
    res.status(500).send({ message: "Comment creation failed", err: err.message });
  }
});

app.post("/api/delete-comment", authenticateToken, async (req, res) => {
  try {
    console.log("in delete comment route");
    const id = req.body.id;
    const userId = req.user.id;
    const userRole = req.user.role?.toLowerCase();

    // Look up the comment to verify ownership or moderation rights
    const [[comment]] = await db_pool.query("SELECT c.*, u.role as author_role FROM comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.id = ?", [id]);
    if (!comment) {
      return res.status(404).send({ message: "Comment not found" });
    }

    if (comment.author_id !== userId) {
      if (!canModerate(userRole, comment.author_role)) {
        return res.status(403).send({ message: "You don't have permission to delete this comment" });
      }
    }

    await dbHelpers.deleteComment(id);
    res.json({ message: "Comment deleted" });
  } catch (err) {
    console.error("Error in /api/delete-comment:", err);
    res.status(500).send({ message: "Comment deletion failed", err: err.message });
  }
});

app.put("/api/comments/edit", authenticateToken, async (req, res) => {
  try {
    const { id, content, last_updated_at } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role?.toLowerCase();

    // Look up the comment to verify ownership or moderation rights
    const [[comment]] = await db_pool.query("SELECT c.*, u.role as author_role FROM comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.id = ?", [id]);
    if (!comment) {
      return res.status(404).send({ message: "Comment not found" });
    }

    if (comment.author_id !== userId) {
      if (!canModerate(userRole, comment.author_role)) {
        return res.status(403).send({ message: "You don't have permission to edit this comment" });
      }
    }

    // Content moderation
    if (content) {
      const contentCheck = validateContent(content, { fieldName: 'Comment', maxLength: 10000, allowLinks: 'whitelist' });
      if (!contentCheck.isValid) return res.status(400).send({ message: contentCheck.errors[0] });
    }
    
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


// ------------------- Forum Like Toggle -------------------

app.post("/api/forums/:id/toggle-like", authenticateToken, async (req, res) => {
  try {
    const articleId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    // Verify the article exists
    const [[article]] = await db_pool.query("SELECT id FROM articles WHERE id = ?", [articleId]);
    if (!article) {
      return res.status(404).send({ message: "Forum post not found" });
    }

    // Check existing like
    const [existing] = await db_pool.query(
      "SELECT id FROM likes WHERE article_id = ? AND user_id = ?",
      [articleId, userId]
    );

    if (existing.length > 0) {
      await db_pool.query("DELETE FROM likes WHERE article_id = ? AND user_id = ?", [articleId, userId]);
    } else {
      await db_pool.query(
        "INSERT INTO likes (article_id, user_id, liked) VALUES (?, ?, 1)",
        [articleId, userId]
      );
    }

    const [[countRow]] = await db_pool.query(
      "SELECT COUNT(*) as like_count FROM likes WHERE article_id = ?",
      [articleId]
    );

    res.json({ liked: existing.length === 0, like_count: countRow.like_count });
  } catch (err) {
    console.error("Error in /api/forums/:id/toggle-like:", err);
    res.status(500).send({ message: "Like toggle failed", err: err.message });
  }
});


// ------------------- Comment Emotes -----------------------
const VALID_EMOTE_TYPES = new Set(['thumbsup', 'thumbsdown', 'heart', 'question', 'laugh', 'sad', 'exclaim']);

app.post("/api/comments/:id/emotes", authenticateToken, async (req, res) => {
  try {
    const comment_id = parseInt(req.params.id, 10);
    const { emote_type } = req.body;
    const user_id = req.user.id;

    if (!VALID_EMOTE_TYPES.has(emote_type)) {
      return res.status(400).send({ message: "Invalid emote type" });
    }

    // Verify comment exists
    const [[comment]] = await db_pool.query("SELECT id FROM comments WHERE id = ?", [comment_id]);
    if (!comment) {
      return res.status(404).send({ message: "Comment not found" });
    }

    const result = await dbHelpers.toggleCommentEmote({ comment_id, user_id, emote_type });
    res.json({ result });
  } catch (err) {
    console.error("Error in /api/comments/:id/emotes:", err);
    res.status(500).send({ message: "Emote toggle failed", err: err.message });
  }
});


//  ---------------------- News ------------------------------

app.post("/api/news/new", async (req, res) => {
  try {
    const { author_id, title, content, created_at, external_blog_url, external_blog_label } = req.body;
    
    if (!author_id || !title || !content) {
      return res.status(400).send({ message: "Missing required fields" });
    }

    const [result] = await db_pool.query(
      `INSERT INTO articles (author_id, title, content, created_at, game_type_id, is_news, public, external_blog_url, external_blog_label) 
       VALUES (?, ?, ?, ?, NULL, 1, 1, ?, ?)`,
      [author_id, title, content, created_at || new Date(), external_blog_url || null, external_blog_label || null]
    );

    const newsArticle = {
      id: result.insertId,
      author_id,
      title,
      content,
      external_blog_url: external_blog_url || null,
      external_blog_label: external_blog_label || null,
      created_at: created_at || new Date()
    };

    res.json({ result: newsArticle, message: "News article created successfully" });
  } catch (err) {
    console.error("Error creating news article:", err);
    res.status(500).send({ message: "Failed to create news article", err: err.message });
  }
});

// ── Link-preview helpers (OG metadata scraping) ───────────────────────────────
function _isAllowedPreviewUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (/^(localhost$|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0$)/.test(h)) return false;
    return true;
  } catch { return false; }
}

function _decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function _extractOgMeta(html, baseUrl) {
  const result = { title: null, description: null, image: null, site_name: null };
  const metaRegex = /<meta\b([^>]+)>/gi;
  let m;
  while ((m = metaRegex.exec(html)) !== null) {
    const tag = m[1];
    const prop = /(?:property|name)\s*=\s*["']og:(\w+)["']/i.exec(tag);
    const cont = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (prop && cont) {
      const key = prop[1].toLowerCase();
      if (key in result && !result[key]) result[key] = _decodeHtmlEntities(cont[1]);
    }
  }
  if (!result.title) {
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (t) result.title = _decodeHtmlEntities(t[1].replace(/<[^>]*>/g, '').trim());
  }
  if (result.image && !result.image.startsWith('http')) {
    try { result.image = new URL(result.image, baseUrl).href; } catch {}
  }
  return result;
}

const _linkPreviewCache = new Map();
const _LINK_PREVIEW_TTL_MS = 30 * 60 * 1000;

function _fetchHtmlWithRedirects(urlStr, maxHops) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const attempt = (u, hops) => {
      try {
        const req = https.get(u, {
          timeout: 6000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; GridGroveNewsBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          }
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < maxHops) {
            try {
              const nextUrl = new URL(res.headers.location, u).href;
              if (!_isAllowedPreviewUrl(nextUrl)) return reject(new Error('redirect to blocked URL'));
              res.resume();
              return attempt(nextUrl, hops + 1);
            } catch (e) { return reject(e); }
          }
          let html = '';
          res.on('data', (chunk) => { html += chunk; if (html.length > 300000) res.destroy(); });
          res.on('end', () => resolve(html));
          res.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
      } catch (e) { reject(e); }
    };
    attempt(urlStr, 0);
  });
}

app.get("/api/news/link-preview", async (req, res) => {
  const { url } = req.query;
  if (!url || !_isAllowedPreviewUrl(url)) {
    return res.status(400).json({ message: "Invalid or disallowed URL" });
  }
  const cached = _linkPreviewCache.get(url);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json(cached.data);
  }
  try {
    const html = await _fetchHtmlWithRedirects(url, 5);
    const meta = _extractOgMeta(html, url);
    const result = { url, ...meta };
    _linkPreviewCache.set(url, { data: result, expiresAt: Date.now() + _LINK_PREVIEW_TTL_MS });
    res.json(result);
  } catch (err) {
    console.error('Link preview fetch error:', err.message);
    res.status(502).json({ message: "Could not fetch link preview" });
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

app.delete("/api/news/:newsId", authenticateToken, async (req, res) => {
  try {
    const { newsId } = req.params;
    const userRole = req.user.role?.toLowerCase();

    if (userRole !== 'admin' && userRole !== 'owner') {
      return res.status(403).send({ message: "Access denied. Admin or owner role required." });
    }

    // Admin 2 cannot delete news articles
    if (userRole === 'admin' && req.user.admin_level === 2) {
      return res.status(403).send({ message: "Admin 2 does not have permission to delete news articles" });
    }

    // Check if news article exists
    const [[article]] = await db_pool.query(
      "SELECT id FROM articles WHERE id = ? AND is_news = 1", 
      [newsId]
    );
    if (!article) {
      return res.status(404).send({ message: "News article not found" });
    }

    // Delete comments and likes first, then the article
    await db_pool.query("DELETE FROM comments WHERE article_id = ?", [newsId]);
    await db_pool.query("DELETE FROM likes WHERE article_id = ?", [newsId]);
    await db_pool.query("DELETE FROM articles WHERE id = ?", [newsId]);

    res.json({ message: "News article deleted successfully" });
  } catch (err) {
    console.error("Error deleting news article:", err);
    res.status(500).send({ message: "Failed to delete news article", err: err.message });
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
        "SELECT id, username, role, admin_level, banned, ban_expires_at FROM users WHERE id = ?",
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
      const userPayload = { id: dbUser.id, username: dbUser.username, role: dbUser.role, admin_level: dbUser.admin_level ?? null };
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
    const creator_id = req.user.id;
    const is_anonymous_creator = gameData.is_anonymous_creator ? 1 : 0;

    // Validate required fields - drafts have relaxed validation
    if (!gameData.is_draft) {
      if (!gameData.game_name || gameData.game_name.length < 3) {
        return res.status(400).send({ message: "Game name must be at least 3 characters" });
      }
    } else {
      // Drafts just need a non-empty name
      if (!gameData.game_name || gameData.game_name.trim().length < 1) {
        gameData.game_name = "Untitled Draft";
      }
    }

    // Content moderation: Check game name
    const nameCheck = validateContent(gameData.game_name, { fieldName: 'Game name', maxLength: 100 });
    if (!nameCheck.isValid) {
      return res.status(400).send({ message: nameCheck.errors[0] });
    }

    // Professional name check: flag games with sensitive terms for moderator review
    let gameNeedsNameReview = false;
    let gameNameProfCheck = null;
    if (!gameData.is_draft) {
      gameNameProfCheck = checkProfessionalName(gameData.game_name);
      if (!gameNameProfCheck.isProfessional) {
        gameNeedsNameReview = true;
      }
    }

    // Content moderation: Check description
    if (gameData.descript) {
      const descCheck = validateContent(gameData.descript, { fieldName: 'Description', maxLength: 8000, allowLinks: 'whitelist' });
      if (!descCheck.isValid) {
        return res.status(400).send({ message: descCheck.errors[0] });
      }
    }

    // Content moderation: Check rules
    if (gameData.rules) {
      const rulesCheck = validateContent(gameData.rules, { fieldName: 'Rules', maxLength: 8000, allowLinks: 'whitelist' });
      if (!rulesCheck.isValid) {
        return res.status(400).send({ message: rulesCheck.errors[0] });
      }
    }

    // Validate actions_per_turn range
    if (gameData.actions_per_turn && (gameData.actions_per_turn < 1 || gameData.actions_per_turn > 8)) {
      return res.status(400).send({ message: "Actions per turn must be between 1 and 8" });
    }

    // Validate board size (max 48x48)
    if (gameData.board_width) gameData.board_width = Math.max(1, Math.min(48, parseInt(gameData.board_width) || 8));
    if (gameData.board_height) gameData.board_height = Math.max(1, Math.min(48, parseInt(gameData.board_height) || 8));

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

    const isDraft = gameData.is_draft ? 1 : 0;
    const draftSavedStep = gameData.draft_saved_step || null;

    // Drafts only need a game_name of at least 1 char; full games need 3
    if (!isDraft && (!gameData.game_name || gameData.game_name.length < 3)) {
      return res.status(400).send({ message: "Game name must be at least 3 characters" });
    }

    // Initial-position validation: a published game type must not start in
    // a decided state (one side already in checkmate, no legal moves with
    // no_moves_condition, stalemate under stalemate_draw_condition, capture
    // condition already satisfied, etc.). Drafts skip this check so users
    // can iterate freely.
    if (!isDraft) {
      try {
        const checkResult = await initialStateValidator.validateGameTypeFromRequestBody(gameData);
        if (checkResult && checkResult.decided) {
          return res.status(400).send({
            message: checkResult.reason,
            initialStateError: {
              type: checkResult.type,
              code: checkResult.code,
              reason: checkResult.reason,
              forPlayer: checkResult.forPlayer || null,
            },
          });
        }
      } catch (validationErr) {
        // Don't block on validator failures — log and continue. The admin
        // scan tool will catch persistent issues later.
        console.error('[initial-state] Pre-create validation error:', validationErr.message);
      }
    }

    // Dynamic INSERT builder — column name and value are always co-located so
    // adding a new column in future cannot cause a placeholder/values mismatch.
    const insertMap = {
      creator_id,
      is_anonymous_creator,
      game_name:                             gameData.game_name,
      descript:                              gameData.descript,
      rules:                                 gameData.rules,
      mate_condition:                        gameData.mate_condition || false,
      mate_piece:                            gameData.mate_piece != null ? gameData.mate_piece : null,
      capture_condition:                     gameData.capture_condition || false,
      capture_piece:                         gameData.capture_piece != null ? gameData.capture_piece : null,
      capture_condition_requires_all:        gameData.capture_condition_requires_all || false,
      mate_condition_requires_all:           gameData.mate_condition_requires_all || false,
      value_condition:                       gameData.value_condition || false,
      value_piece:                           gameData.value_piece != null ? gameData.value_piece : null,
      value_max:                             gameData.value_max || null,
      value_title:                           gameData.value_title || null,
      squares_condition:                     gameData.squares_condition || false,
      squares_count:                         gameData.squares_count || null,
      hill_condition:                        gameData.hill_condition || false,
      hill_x:                                gameData.hill_x || null,
      hill_y:                                gameData.hill_y || null,
      hill_turns:                            gameData.hill_turns || null,
      actions_per_turn:                      gameData.actions_per_turn || 1,
      simultaneous_turns:                    gameData.simultaneous_turns || false,
      simul_turns_clock_pause:               gameData.simul_turns_clock_pause ? 1 : 0,
      simul_turns_draw_after_cancellations:  Math.max(0, Math.min(99, Number(gameData.simul_turns_draw_after_cancellations) || 0)),
      simul_turns_submit_mode:               ['immediate', 'stage'].includes(gameData.simul_turns_submit_mode) ? gameData.simul_turns_submit_mode : 'immediate',
      simul_turns_place_conflict:            ['cancel', 'allow'].includes(gameData.simul_turns_place_conflict) ? gameData.simul_turns_place_conflict : 'cancel',
      simul_turns_free_move_after_capture:   ['disable', 'restage', 'allow'].includes(gameData.simul_turns_free_move_after_capture) ? gameData.simul_turns_free_move_after_capture : 'disable',
      simul_turns_simultaneous_capture_draw: gameData.simul_turns_simultaneous_capture_draw === false || gameData.simul_turns_simultaneous_capture_draw === 0 ? 0 : 1,
      simul_turns_simultaneous_checkmate_draw: gameData.simul_turns_simultaneous_checkmate_draw === false || gameData.simul_turns_simultaneous_checkmate_draw === 0 ? 0 : 1,
      board_width:                           gameData.board_width || 8,
      board_height:                          gameData.board_height || 8,
      player_count:                          gameData.player_count || 2,
      starting_piece_count:                  gameData.starting_piece_count || 0,
      range_squares_string:                  sanitizeRangeSquaresJSON(gameData.range_squares_string) || null,
      promotion_squares_string:              gameData.promotion_squares_string || null,
      special_squares_string:                sanitizeSpecialSquaresJSON(gameData.special_squares_string) || null,
      control_squares_string:                gameData.control_squares_string || null,
      randomized_starting_positions:         gameData.randomized_starting_positions || null,
      default_starting_mode:                 ['none','backrow','mirrored','independent','shared','full'].includes(gameData.default_starting_mode) ? gameData.default_starting_mode : null,
      other_game_data:                       gameData.other_game_data || null,
      optional_condition:                    gameData.optional_condition || null,
      draw_move_limit:                       gameData.draw_move_limit != null ? gameData.draw_move_limit : null,
      repetition_draw_count:                 (gameData.repetition_draw_count != null && gameData.repetition_draw_count >= 2 && gameData.repetition_draw_count <= 9) ? gameData.repetition_draw_count : null,
      no_moves_condition:                    gameData.no_moves_condition || false,
      piece_count_condition:                 gameData.piece_count_condition || false,
      promotion_condition:                   gameData.promotion_condition || false,
      lose_all_pieces_condition:             gameData.lose_all_pieces_condition || false,
      stalemate_win_condition:               gameData.stalemate_win_condition || false,
      stalemate_draw_condition:              gameData.stalemate_draw_condition !== undefined ? !!gameData.stalemate_draw_condition : true,
      forced_capture_condition:              gameData.forced_capture_condition || false,
      points_to_win:                         (gameData.points_to_win != null && gameData.points_to_win > 0) ? Math.min(9999, Math.max(1, Number(gameData.points_to_win))) : null,
      starting_points_p1:                    Math.max(0, Math.min(9999, Number(gameData.starting_points_p1) || 0)),
      starting_points_p2:                    Math.max(0, Math.min(9999, Number(gameData.starting_points_p2) || 0)),
      draw_equal_points_at_turn:             (gameData.draw_equal_points_at_turn != null && gameData.draw_equal_points_at_turn > 0) ? Math.min(9999, Math.max(1, Number(gameData.draw_equal_points_at_turn))) : null,
      draw_equal_points_consecutive:         (gameData.draw_equal_points_consecutive != null && gameData.draw_equal_points_consecutive > 0) ? Math.min(999, Math.max(1, Number(gameData.draw_equal_points_consecutive))) : null,
      pieces_string:                         gameData.pieces_string || '{}',
      created_at:                            new Date().toISOString().slice(0, 19).replace('T', ' '),
      is_draft:                              isDraft,
      draft_saved_step:                      draftSavedStep,
    };
    const colList   = Object.keys(insertMap).join(', ');
    const phList    = Object.keys(insertMap).map(() => '?').join(', ');
    const sql       = `INSERT INTO game_types (${colList}) VALUES (${phList})`;
    const values    = Object.values(insertMap);

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

        // Insert each piece (skip multi-tile extension squares, only save anchors)
        for (const piece of piecesToInsert) {
          if (piece.piece_id && !piece._occupied && !piece._anchorKey) {
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
              piece.castling_partner_right_key || null,
              piece.can_control_squares || false,
              piece.castling_distance ?? 2,
              piece.hit_points ?? 1,
              piece.attack_damage ?? 1,
              piece.show_hp_ad || false,
              piece.hp_regen ?? 0,
              piece.cannot_be_captured || false,
              piece.show_regen ?? false,
              piece.burn_damage ?? 0,
              piece.burn_duration ?? 0,
              piece.show_burn ?? false,
              piece.trample || false,
              piece.trample_radius ?? 0,
              piece.ghostwalk || false,
              piece.die_on_capture || false,
              piece.attack_radius ?? 0,
              (piece.image_index != null && piece.image_index >= 0) ? Number(piece.image_index) : null,
              piece.promotion_pieces_override ?? null,
              piece.can_promote_to_checkmate || false,
              piece.limit_promote_checkmate_to_original || false,
              piece.can_promote_to_capture || false,
              piece.limit_promote_capture_to_original || false,
              piece.capture_points_gain ?? 0,
              piece.capture_points_loss ?? 0,
              piece.cannot_move_outside_zone || false,
              piece.is_neutral || false
            );
          }
        }
      } catch (parseError) {
        console.error('Error parsing pieces_string:', parseError);
      }
    }
    
    // Automatically create a forum for this game (non-critical, don't fail the whole request)
    // Skip forum creation for drafts
    if (!isDraft) {
    try {
      const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const forumTitle = `${gameData.game_name} - Discussion`;
      const forumContent = `Welcome to the ${gameData.game_name} discussion forum! Share strategies, ask questions, and connect with other players of this game.${gameData.descript ? '\n\n' + gameData.descript : ''}`;
      
      const forumAuthorId = is_anonymous_creator ? null : creator_id;
      const forumSql = `
        INSERT INTO articles (author_id, game_type_id, title, content, created_at, public)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      // If the game name is flagged, suppress the public forum until the name is approved
      const forumPublic = gameNeedsNameReview ? false : true;
      await db_pool.query(forumSql, [forumAuthorId, gameId, forumTitle, forumContent, currentTime, forumPublic]);
    } catch (forumErr) {
      console.error('Error creating forum for game type:', forumErr.message);
    }

    // Flag game for name review if needed
    if (gameNeedsNameReview) {
      try {
        await db_pool.query(
          "UPDATE game_types SET name_review_status = 'pending_review' WHERE id = ?",
          [gameId]
        );
        await db_pool.query(
          `INSERT INTO name_review_queue (item_type, item_id, submitter_id, flagged_name, triggered_words)
           VALUES ('game', ?, ?, ?, ?)`,
          [gameId, creator_id, gameData.game_name, (gameNameProfCheck?.matches || []).join(', ')]
        );
      } catch (reviewErr) {
        console.error('Error inserting into name_review_queue:', reviewErr.message);
      }
    }
    } // end skip forum for drafts

    // Notify owner of new game type creation (non-blocking) � skip for drafts
    if (!isDraft) {
    dbHelpers.getOwnerUserId().then(async (ownerId) => {
      if (ownerId && ownerId !== creator_id) {
        try {
          const creatorName = creator_id ? (await dbHelpers.findUserById(creator_id))?.username || 'Anonymous' : 'Anonymous';
          await dbHelpers.createNotification({
            user_id: ownerId,
            sender_id: creator_id,
            type: 'system',
            title: `New game type created: ${gameData.game_name}`,
            content: `${creatorName} created a new game type "${gameData.game_name}".`,
            related_id: gameId,
            action_url: `/games/${gameId}`
          });
          const gameSocket = require("./game-socket");
          const ownerSocketId = gameSocket.userSockets.get(ownerId.toString());
          if (ownerSocketId && gameSocket.getIO()) {
            const unreadCount = await dbHelpers.getUnreadNotificationCount(ownerId);
            gameSocket.getIO().to(ownerSocketId).emit('newNotification', { type: 'system', title: `New game type created: ${gameData.game_name}` });
            gameSocket.getIO().to(ownerSocketId).emit('unreadNotificationCount', { unreadCount });
          }
        } catch (err) { console.error('Owner notification (new game type) failed:', err.message); }
      }
    }).catch(() => {});
    } // end skip notification for drafts

    res.status(201).send({
      message: isDraft ? "Draft saved successfully!" : (gameNeedsNameReview ? "Game created! Your game name is under review and will be published once approved." : "Game created successfully!"),
      result: {
        id: result.insertId,
        game_name: gameData.game_name,
        is_draft: isDraft,
        needs_name_review: gameNeedsNameReview
      }
    });
    _resyncAiRules(result.insertId);
    // Game just passed initial-state validation, so explicitly clear any
    // stored warning (defaults to NULL on insert, but be defensive).
    initialStateValidator.writeInitialStateWarning(result.insertId, null).catch(() => {});

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

// Limits for piece configuration to avoid pathological pieces causing UI lag.
const MAX_STEP_BY_STEP_VALUE = 8;
const MAX_CUSTOM_SQUARES = 50;

// Returns null if valid, or an error message string if invalid.
const validatePieceLimits = (pieceData) => {
  const stepFields = [
    ['step_by_step_movement_value', 'step-by-step movement'],
    ['step_by_step_capture', 'step-by-step capture'],
    ['step_by_step_attack_value', 'step-by-step ranged attack'],
    ['step_by_step_attack_range', 'step-by-step ranged attack']
  ];
  for (const [field, label] of stepFields) {
    const raw = pieceData[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const num = parseInt(raw);
    if (!Number.isNaN(num) && Math.abs(num) > MAX_STEP_BY_STEP_VALUE) {
      return `Maximum ${label} value is ${MAX_STEP_BY_STEP_VALUE}.`;
    }
  }

  const customFields = [
    ['custom_movement_squares', 'custom movement squares'],
    ['custom_attack_squares', 'custom attack squares']
  ];
  for (const [field, label] of customFields) {
    const raw = pieceData[field];
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length > MAX_CUSTOM_SQUARES) {
        return `Maximum of ${MAX_CUSTOM_SQUARES} ${label} allowed (received ${parsed.length}).`;
      }
    } catch (e) {
      return `Invalid ${label} payload.`;
    }
  }

  return null;
};

app.post("/api/pieces/create", authenticateToken, multerWrap(pieceUpload.array('piece_images', 8), '2 MB'), async (req, res) => {
  try {
    const pieceData = req.body;
    const creator_id = req.user.id;
    const rawAnonCreator = Array.isArray(pieceData.is_anonymous_creator) ? pieceData.is_anonymous_creator[0] : pieceData.is_anonymous_creator;
    const is_anonymous_creator = rawAnonCreator === 'true' || rawAnonCreator === true ? 1 : 0;
    const imageFiles = Array.isArray(req.files) ? req.files : [];

    if (!imageFiles || imageFiles.length < 2) {
      return res.status(400).send({ message: "At least two piece images are required (Player 1 light and Player 2 dark)" });
    }

    // Content moderation: Check piece name
    if (pieceData.piece_name) {
      const nameCheck = validateContent(pieceData.piece_name, { fieldName: 'Piece name', maxLength: 50 });
      if (!nameCheck.isValid) {
        return res.status(400).send({ message: nameCheck.errors[0] });
      }
    }

    // Professional name check: flag piece names containing sensitive terms for review
    let pieceNeedsNameReview = false;
    let pieceProfCheck = null;
    if (pieceData.piece_name) {
      pieceProfCheck = checkProfessionalName(pieceData.piece_name);
      if (!pieceProfCheck.isProfessional) {
        pieceNeedsNameReview = true;
      }
    }

    // Content moderation: Check piece description
    if (pieceData.piece_description) {
      const descCheck = validateContent(pieceData.piece_description, { fieldName: 'Piece description', maxLength: 1000, allowLinks: 'whitelist' });
      if (!descCheck.isValid) {
        return res.status(400).send({ message: descCheck.errors[0] });
      }
    }

    // Validate piece configuration limits (step-by-step max & custom-square count)
    const limitsError = validatePieceLimits(pieceData);
    if (limitsError) {
      return res.status(400).send({ message: limitsError });
    }

    // Deduplicate uploaded piece images by content hash. If a piece already
    // uses the exact same image, the new upload reuses the existing file
    // instead of creating a duplicate on disk. The order in `imageFiles`
    // is preserved so the player1/player2 mapping in `imagePaths` stays correct.
    for (const file of imageFiles) {
      dedupeUploadedFile(file);
    }

    const imagePaths = imageFiles.map(file => `/uploads/pieces/${file.filename}`);
    const imagesJSON = JSON.stringify(imagePaths);
    const hasRangedAttack = pieceData.can_capture_enemy_via_range === 'true';

    // Image moderation: Determine which images are custom uploads vs library images
    let imageSources = [];
    try {
      imageSources = JSON.parse(pieceData.image_sources || '[]');
    } catch (e) { /* default to empty */ }

    // Check if any images are custom uploads (not from the library)
    const hasCustomUploads = imageSources.some(s => s === 'upload') || imageSources.length === 0;

    // Require authentication for custom image uploads
    if (hasCustomUploads && !creator_id) {
      // Clean up uploaded files
      for (const file of imageFiles) {
        try { fs.unlinkSync(path.join(file.destination, file.filename)); } catch (e) {}
      }
      return res.status(401).send({ message: "You must be logged in to upload custom images. Please use the image library or sign in." });
    }

    // Run NSFW scan on custom-uploaded images only (library images are pre-approved)
    let moderationStatus = 'approved';
    let scanResults = [];
    const customUploadPaths = imageFiles
      .filter((_, i) => !imageSources[i] || imageSources[i] === 'upload')
      .map(file => path.join(file.destination, file.filename));

    if (customUploadPaths.length > 0) {
      const scanResult = await imageModeration.classifyImages(customUploadPaths);
      scanResults = scanResult.results;

      if (scanResult.overall === 'rejected') {
        // Delete all uploaded files
        for (const file of imageFiles) {
          try { fs.unlinkSync(path.join(file.destination, file.filename)); } catch (e) {}
        }
        const rejectedReasons = scanResult.results
          .filter(r => r.status === 'rejected')
          .map(r => r.reason);
        return res.status(400).send({
          message: "One or more images were rejected by our content filter. Please use appropriate images.",
          details: rejectedReasons
        });
      }

      if (scanResult.overall === 'pending_review') {
        // Auto-approve for admin/owner � they don't need manual review
        const uploaderRole = req.user.role?.toLowerCase();
        if (uploaderRole === 'admin' || uploaderRole === 'owner') {
          moderationStatus = 'approved';
        } else {
          moderationStatus = 'pending_review';
        }
      }
    }

    // Insert into consolidated pieces table (all fields in one table now)
    const pieceSql = `
      INSERT INTO pieces (
        piece_name, image_location, piece_width, piece_height, creator_id, is_anonymous_creator, piece_description,
        piece_category, has_checkmate_rule, has_check_rule, has_lose_on_capture_rule, can_castle, can_promote,
        directional_movement_style, repeating_movement,
        up_left_movement, up_movement, up_right_movement, right_movement, down_right_movement, down_movement, down_left_movement, left_movement,
        up_left_movement_exact, up_movement_exact, up_right_movement_exact, right_movement_exact, 
        down_right_movement_exact, down_movement_exact, down_left_movement_exact, left_movement_exact,
        up_left_movement_available_for, up_movement_available_for, up_right_movement_available_for, right_movement_available_for,
        down_right_movement_available_for, down_movement_available_for, down_left_movement_available_for, left_movement_available_for,
        ratio_movement_style, ratio_one_movement, ratio_two_movement, repeating_ratio, max_ratio_iterations,
        step_by_step_movement_style, step_by_step_movement_value,
        can_hop_over_allies, can_hop_over_enemies, exact_ratio_hop_only, directional_hop_disabled, min_turns_per_move, max_turns_per_move,
        first_move_only, available_for_moves, special_scenario_moves,
        can_capture_enemy_via_range, can_capture_enemy_on_move,
        first_move_only_capture, available_for_captures,
        up_left_capture, up_capture, up_right_capture, right_capture, down_right_capture, down_capture, down_left_capture, left_capture,
        up_left_capture_exact, up_capture_exact, up_right_capture_exact, right_capture_exact,
        down_right_capture_exact, down_capture_exact, down_left_capture_exact, left_capture_exact,
        up_left_capture_available_for, up_capture_available_for, up_right_capture_available_for, right_capture_available_for,
        down_right_capture_available_for, down_capture_available_for, down_left_capture_available_for, left_capture_available_for,
        ratio_one_capture, ratio_two_capture, repeating_capture, repeating_ratio_capture, max_ratio_capture_iterations, step_by_step_capture,
        up_left_attack_range, up_attack_range, up_right_attack_range, right_attack_range, down_right_attack_range, down_attack_range, down_left_attack_range, left_attack_range,
        up_left_attack_range_exact, up_attack_range_exact, up_right_attack_range_exact, right_attack_range_exact,
        down_right_attack_range_exact, down_attack_range_exact, down_left_attack_range_exact, left_attack_range_exact,
        up_left_attack_range_available_for, up_attack_range_available_for, up_right_attack_range_available_for, right_attack_range_available_for,
        down_right_attack_range_available_for, down_attack_range_available_for, down_left_attack_range_available_for, left_attack_range_available_for,
        ratio_one_attack_range, ratio_two_attack_range,
        step_by_step_attack_style, step_by_step_attack_value,
        max_piece_captures_per_move, max_piece_captures_per_ranged_attack,
        special_scenario_captures,
        can_fire_over_allies, can_fire_over_enemies, can_en_passant,
        capture_on_hop, chain_capture_enabled, free_move_after_promotion, promotion_pieces_ids,
        can_hop_attack_over_allies, can_hop_attack_over_enemies, chain_hop_allies,
        can_capture_allies, cannot_be_captured, max_chain_hops,
        custom_movement_squares, custom_attack_squares,
        must_move_if_able, must_move_uses_action,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const pieceWidth = Math.min(4, Math.max(1, parseInt(pieceData.piece_width) || 1));
    const pieceHeight = Math.min(4, Math.max(1, parseInt(pieceData.piece_height) || 1));

    const pieceValues = [
      pieceData.piece_name,
      imagesJSON,
      pieceWidth,
      pieceHeight,
      creator_id,
      is_anonymous_creator,
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
      parseBooleanField(pieceData.step_by_step_movement_style),
      parseInt(pieceData.step_by_step_movement_value) || null,
      parseBooleanField(pieceData.can_hop_over_allies),
      parseBooleanField(pieceData.can_hop_over_enemies),
      parseBooleanField(pieceData.exact_ratio_hop_only),
      parseBooleanField(pieceData.directional_hop_disabled),
      Math.min(8, parseInt(pieceData.min_turns_per_move) || 0) || null,
      parseInt(pieceData.max_turns_per_move) || null,
      // Movement special scenario fields
      pieceData.first_move_only === 'true',
      parseInt(pieceData.available_for_moves) || null,
      Array.isArray(pieceData.special_scenario_moves) 
        ? (pieceData.special_scenario_moves.find(s => s && s.length > 0) || null)
        : (pieceData.special_scenario_moves || null),
      // Capture fields
      hasRangedAttack,
      pieceData.can_capture_enemy_on_move === 'true',
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
      parseBooleanField(pieceData.repeating_capture),
      parseBooleanField(pieceData.repeating_ratio_capture),
      parseInt(pieceData.max_ratio_capture_iterations) || null,
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
      parseInt(pieceData.ratio_one_attack_range) || null,
      parseInt(pieceData.ratio_two_attack_range) || null,
      pieceData.step_by_step_attack_style === 'true',
      parseInt(pieceData.step_by_step_attack_value) || null,
      parseInt(pieceData.max_piece_captures_per_move) || 1,
      hasRangedAttack ? (parseInt(pieceData.max_piece_captures_per_ranged_attack) || 1) : null,
      pieceData.special_scenario_captures || null,
      // Ranged firing over pieces
      parseBooleanField(pieceData.can_fire_over_allies),
      parseBooleanField(pieceData.can_fire_over_enemies),
      // En passant
      parseBooleanField(pieceData.can_en_passant),
      // Checkers-style options
      parseBooleanField(pieceData.capture_on_hop),
      parseBooleanField(pieceData.chain_capture_enabled),
      parseBooleanField(pieceData.free_move_after_promotion),
      pieceData.promotion_pieces_ids || null,
      // Attack-specific hopping
      parseBooleanField(pieceData.can_hop_attack_over_allies),
      parseBooleanField(pieceData.can_hop_attack_over_enemies),
      // Chain hop allies
      parseBooleanField(pieceData.chain_hop_allies),
      // Can capture allies
      parseBooleanField(pieceData.can_capture_allies),
      // Cannot be captured
      parseBooleanField(pieceData.cannot_be_captured),
      // Max chain hops
      pieceData.max_chain_hops != null ? parseInt(pieceData.max_chain_hops) : null,
      // Custom movement/attack squares
      pieceData.custom_movement_squares || null,
      pieceData.custom_attack_squares || null,
      // Must-move-if-able (e.g., Duck Chess)
      parseBooleanField(pieceData.must_move_if_able),
      parseBooleanField(pieceData.must_move_uses_action),
      // Created at
      new Date().toISOString().slice(0, 19).replace('T', ' ')
    ];

    const [result] = await db_pool.query(pieceSql, pieceValues);
    const pieceId = result.insertId;

    // Update moderation status if images need review
    if (moderationStatus !== 'approved') {
      await db_pool.query(
        "UPDATE pieces SET moderation_status = ? WHERE id = ?",
        [moderationStatus, pieceId]
      );

      // Add entries to moderation queue for images that need review
      for (const scanRes of scanResults) {
        if (scanRes.status === 'pending_review') {
          const relPath = scanRes.filePath.replace(path.join(__dirname, '..'), '').replace(/\\/g, '/');
          await db_pool.query(
            `INSERT INTO image_moderation_queue (piece_id, uploader_id, image_path, status, nsfw_scores, auto_reason)
             VALUES (?, ?, ?, 'pending_review', ?, ?)`,
            [pieceId, creator_id, relPath, JSON.stringify(scanRes.predictions), scanRes.reason]
          );
        }
      }
    }

    // Flag piece for name review if the name contains sensitive terms
    if (pieceNeedsNameReview) {
      try {
        await db_pool.query(
          "UPDATE pieces SET name_review_status = 'pending_review' WHERE id = ?",
          [pieceId]
        );
        await db_pool.query(
          `INSERT INTO name_review_queue (item_type, item_id, submitter_id, flagged_name, triggered_words)
           VALUES ('piece', ?, ?, ?, ?)`,
          [pieceId, creator_id, pieceData.piece_name, (pieceProfCheck?.matches || []).join(', ')]
        );
      } catch (reviewErr) {
        console.error('Error inserting into name_review_queue (piece create):', reviewErr.message);
      }
    }

    // Notify owner of new piece creation (non-blocking)
    dbHelpers.getOwnerUserId().then(async (ownerId) => {
      if (ownerId && ownerId !== creator_id) {
        try {
          const creatorName = creator_id ? (await dbHelpers.findUserById(creator_id))?.username || 'Anonymous' : 'Anonymous';
          await dbHelpers.createNotification({
            user_id: ownerId,
            sender_id: creator_id,
            type: 'system',
            title: `New piece created: ${pieceData.piece_name}`,
            content: `${creatorName} created a new piece "${pieceData.piece_name}".`,
            related_id: pieceId,
            action_url: `/pieces/${pieceId}`
          });
          const gameSocket = require("./game-socket");
          const ownerSocketId = gameSocket.userSockets.get(ownerId.toString());
          if (ownerSocketId && gameSocket.getIO()) {
            const unreadCount = await dbHelpers.getUnreadNotificationCount(ownerId);
            gameSocket.getIO().to(ownerSocketId).emit('newNotification', { type: 'system', title: `New piece created: ${pieceData.piece_name}` });
            gameSocket.getIO().to(ownerSocketId).emit('unreadNotificationCount', { unreadCount });
          }
        } catch (err) { console.error('Owner notification (new piece) failed:', err.message); }
      }
    }).catch(() => {});

    res.status(201).send({
      message: moderationStatus === 'pending_review'
        ? "Piece created! Your custom images are being reviewed and may take a short time to appear publicly."
        : (pieceNeedsNameReview ? "Piece created! Your piece name is under review and will be published once approved." : "Piece created successfully!"),
      result: {
        id: pieceId,
        piece_name: pieceData.piece_name,
        piece_images: imagePaths,
        moderation_status: moderationStatus,
        needs_name_review: pieceNeedsNameReview
      }
    });
    _resyncAiRulesForPiece(pieceId);

  } catch (err) {
    console.error("Error in /api/pieces/create:", err);
    res.status(500).send({ message: "Failed to create piece", err: err.message });
  }
});

// ----------------------- Pieces Update ------------------------------

app.put("/api/pieces/:pieceId", authenticateToken, multerWrap(pieceUpload.array('piece_images', 8), '2 MB'), async (req, res) => {
  try {
    const { pieceId } = req.params;
    const pieceData = req.body;
    const imageFiles = req.files;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if piece exists and user is creator
    const existingPiece = await dbHelpers.getPieceById(pieceId);
    if (!existingPiece) {
      return res.status(404).send({ message: "Piece not found" });
    }

    // Verify ownership or moderation rights (use server-side role, not client-sent)
    if (existingPiece.creator_id !== parseInt(userId)) {
      const creator = await dbHelpers.findUserById(existingPiece.creator_id);
      const creatorRole = creator?.role || 'user';
      if (!canModerate(userRole, creatorRole)) {
        return res.status(403).send({ message: "You don't have permission to edit this piece" });
      }
    }

    // Content moderation: Check piece name
    if (pieceData.piece_name) {
      const nameCheck = validateContent(pieceData.piece_name, { fieldName: 'Piece name', maxLength: 50 });
      if (!nameCheck.isValid) {
        return res.status(400).send({ message: nameCheck.errors[0] });
      }
    }

    // Professional name check: flag piece names containing sensitive terms for review (edit path)
    let pieceEditNeedsNameReview = false;
    let pieceEditProfCheck = null;
    if (pieceData.piece_name) {
      pieceEditProfCheck = checkProfessionalName(pieceData.piece_name);
      if (!pieceEditProfCheck.isProfessional) {
        pieceEditNeedsNameReview = true;
      }
    }

    // Content moderation: Check piece description
    if (pieceData.piece_description) {
      const descCheck = validateContent(pieceData.piece_description, { fieldName: 'Piece description', maxLength: 1000, allowLinks: 'whitelist' });
      if (!descCheck.isValid) {
        return res.status(400).send({ message: descCheck.errors[0] });
      }
    }

    // Validate piece configuration limits (step-by-step max & custom-square count)
    const limitsError = validatePieceLimits(pieceData);
    if (limitsError) {
      return res.status(400).send({ message: limitsError });
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
    
    // Note: We intentionally keep old image files on disk rather than deleting them.
    // Active games may still reference these URLs in their game state, so deleting
    // them would cause 404 errors and blank pieces mid-game. The disk cost is minimal
    // since piece images are small. Files are cleaned up when the piece itself is deleted.
    if (removedImages.length > 0) {
      console.log(`Piece ${pieceId} update: ${removedImages.length} image(s) replaced (old files kept for active game compatibility)`);
    }
    
    // Add new image paths if any.
    // Deduplicate uploaded piece images by content hash before recording paths,
    // so re-uploading the same image reuses the existing file on disk.
    if (imageFiles && imageFiles.length > 0) {
      for (const file of imageFiles) {
        dedupeUploadedFile(file);
      }
    }
    const newImagePaths = imageFiles ? imageFiles.map(file => `/uploads/pieces/${file.filename}`) : [];
    
    // Combine kept and new images (max 8 total)
    const allImagePaths = [...keptImagePaths, ...newImagePaths].slice(0, 8);
    
    if (allImagePaths.length < 2) {
      return res.status(400).send({ message: "At least two piece images are required (Player 1 light and Player 2 dark)" });
    }

    // Image moderation: scan new custom uploads
    let imageSources = [];
    try {
      imageSources = JSON.parse(pieceData.image_sources || '[]');
    } catch (e) { /* default to empty */ }

    const hasCustomUploads = imageFiles && imageFiles.length > 0 &&
      (imageSources.some(s => s === 'upload') || imageSources.length === 0);

    // Require authentication for custom image uploads
    if (hasCustomUploads && !existingPiece.creator_id) {
      for (const file of imageFiles) {
        try { fs.unlinkSync(path.join(file.destination, file.filename)); } catch (e) {}
      }
      return res.status(401).send({ message: "You must be logged in to upload custom images. Please use the image library or sign in." });
    }

    let moderationStatus = existingPiece.moderation_status || 'approved';
    let scanResults = [];

    if (hasCustomUploads) {
      const customUploadPaths = imageFiles
        .filter((_, i) => !imageSources[i] || imageSources[i] === 'upload')
        .map(file => path.join(file.destination, file.filename));

      if (customUploadPaths.length > 0) {
        const scanResult = await imageModeration.classifyImages(customUploadPaths);
        scanResults = scanResult.results;

        if (scanResult.overall === 'rejected') {
          for (const file of imageFiles) {
            try { fs.unlinkSync(path.join(file.destination, file.filename)); } catch (e) {}
          }
          const rejectedReasons = scanResult.results
            .filter(r => r.status === 'rejected')
            .map(r => r.reason);
          return res.status(400).send({
            message: "One or more images were rejected by our content filter. Please use appropriate images.",
            details: rejectedReasons
          });
        }

        if (scanResult.overall === 'pending_review') {
          // Auto-approve for admin/owner � they don't need manual review
          const uploaderRole = req.user.role?.toLowerCase();
          if (uploaderRole === 'admin' || uploaderRole === 'owner') {
            moderationStatus = 'approved';
          } else {
            moderationStatus = 'pending_review';
          }
        }
      }
    }

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
        step_by_step_movement_style = ?,
        step_by_step_movement_value = ?,
        can_hop_over_allies = ?,
        can_hop_over_enemies = ?,
        exact_ratio_hop_only = ?,
        directional_hop_disabled = ?,
        min_turns_per_move = ?,
        max_turns_per_move = ?,
        first_move_only = ?,
        available_for_moves = ?,
        special_scenario_moves = ?,
        can_capture_enemy_via_range = ?,
        can_capture_enemy_on_move = ?,
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
        repeating_capture = ?,
        repeating_ratio_capture = ?,
        max_ratio_capture_iterations = ?,
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
        ratio_one_attack_range = ?,
        ratio_two_attack_range = ?,
        step_by_step_attack_style = ?,
        step_by_step_attack_value = ?,
        max_piece_captures_per_move = ?,
        max_piece_captures_per_ranged_attack = ?,
        special_scenario_captures = ?,
        can_fire_over_allies = ?,
        can_fire_over_enemies = ?,
        can_en_passant = ?,
        capture_on_hop = ?,
        chain_capture_enabled = ?,
        free_move_after_promotion = ?,
        promotion_pieces_ids = ?,
        can_hop_attack_over_allies = ?,
        can_hop_attack_over_enemies = ?,
        chain_hop_allies = ?,
        can_capture_allies = ?,
        cannot_be_captured = ?,
        max_chain_hops = ?,
        custom_movement_squares = ?,
        custom_attack_squares = ?,
        must_move_if_able = ?,
        must_move_uses_action = ?
      WHERE id = ?
    `;

    const pieceWidth = Math.min(4, Math.max(1, parseInt(pieceData.piece_width) || 1));
    const pieceHeight = Math.min(4, Math.max(1, parseInt(pieceData.piece_height) || 1));

    const pieceValues = [
      pieceData.piece_name,
      imagesJSON,
      pieceWidth,
      pieceHeight,
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
      parseBooleanField(pieceData.step_by_step_movement_style),
      parseInt(pieceData.step_by_step_movement_value) || null,
      parseBooleanField(pieceData.can_hop_over_allies),
      parseBooleanField(pieceData.can_hop_over_enemies),
      parseBooleanField(pieceData.exact_ratio_hop_only),
      parseBooleanField(pieceData.directional_hop_disabled),
      Math.min(8, parseInt(pieceData.min_turns_per_move) || 0) || null,
      parseInt(pieceData.max_turns_per_move) || null,
      // Movement special scenario fields
      pieceData.first_move_only === 'true',
      parseInt(pieceData.available_for_moves) || null,
      Array.isArray(pieceData.special_scenario_moves) 
        ? (pieceData.special_scenario_moves.find(s => s && s.length > 0) || null)
        : (pieceData.special_scenario_moves || null),
      // Capture fields
      hasRangedAttack,
      pieceData.can_capture_enemy_on_move === 'true',
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
      parseBooleanField(pieceData.repeating_capture),
      parseBooleanField(pieceData.repeating_ratio_capture),
      parseInt(pieceData.max_ratio_capture_iterations) || null,
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
      parseInt(pieceData.ratio_one_attack_range) || null,
      parseInt(pieceData.ratio_two_attack_range) || null,
      pieceData.step_by_step_attack_style === 'true',
      parseInt(pieceData.step_by_step_attack_value) || null,
      parseInt(pieceData.max_piece_captures_per_move) || 1,
      hasRangedAttack ? (parseInt(pieceData.max_piece_captures_per_ranged_attack) || 1) : null,
      pieceData.special_scenario_captures || null,
      // Ranged firing over pieces
      parseBooleanField(pieceData.can_fire_over_allies),
      parseBooleanField(pieceData.can_fire_over_enemies),
      // En passant
      parseBooleanField(pieceData.can_en_passant),
      // Checkers-style options
      parseBooleanField(pieceData.capture_on_hop),
      parseBooleanField(pieceData.chain_capture_enabled),
      parseBooleanField(pieceData.free_move_after_promotion),
      pieceData.promotion_pieces_ids || null,
      // Attack-specific hopping
      parseBooleanField(pieceData.can_hop_attack_over_allies),
      parseBooleanField(pieceData.can_hop_attack_over_enemies),
      // Chain hop allies
      parseBooleanField(pieceData.chain_hop_allies),
      // Can capture allies
      parseBooleanField(pieceData.can_capture_allies),
      // Cannot be captured
      parseBooleanField(pieceData.cannot_be_captured),
      // Max chain hops
      pieceData.max_chain_hops != null ? parseInt(pieceData.max_chain_hops) : null,
      // Custom movement/attack squares
      pieceData.custom_movement_squares || null,
      pieceData.custom_attack_squares || null,
      // Must-move-if-able
      parseBooleanField(pieceData.must_move_if_able),
      parseBooleanField(pieceData.must_move_uses_action),
      pieceId
    ];

    await db_pool.query(pieceSql, pieceValues);

    // Update moderation status if new images need review
    if (moderationStatus !== (existingPiece.moderation_status || 'approved')) {
      await db_pool.query(
        "UPDATE pieces SET moderation_status = ? WHERE id = ?",
        [moderationStatus, pieceId]
      );

      for (const scanRes of scanResults) {
        if (scanRes.status === 'pending_review') {
          const relPath = scanRes.filePath.replace(path.join(__dirname, '..'), '').replace(/\\/g, '/');
          await db_pool.query(
            `INSERT INTO image_moderation_queue (piece_id, uploader_id, image_path, status, nsfw_scores, auto_reason)
             VALUES (?, ?, ?, 'pending_review', ?, ?)`,
            [pieceId, existingPiece.creator_id, relPath, JSON.stringify(scanRes.predictions), scanRes.reason]
          );
        }
      }
    }

    // Flag piece for name review if the updated name contains sensitive terms
    if (pieceEditNeedsNameReview) {
      try {
        await db_pool.query(
          "UPDATE pieces SET name_review_status = 'pending_review' WHERE id = ?",
          [pieceId]
        );
        await db_pool.query(
          `INSERT INTO name_review_queue (item_type, item_id, submitter_id, flagged_name, triggered_words)
           VALUES ('piece', ?, ?, ?, ?)`,
          [pieceId, userId, pieceData.piece_name, (pieceEditProfCheck?.matches || []).join(', ')]
        );
      } catch (reviewErr) {
        console.error('Error inserting into name_review_queue (piece edit):', reviewErr.message);
      }
    }

    res.status(200).send({
      message: moderationStatus === 'pending_review'
        ? "Piece updated! Your new images are being reviewed and may take a short time to appear publicly."
        : (pieceEditNeedsNameReview ? "Piece updated! Your piece name is under review and will be published once approved." : "Piece updated successfully!"),
      result: {
        id: pieceId,
        piece_name: pieceData.piece_name,
        moderation_status: moderationStatus,
        needs_name_review: pieceEditNeedsNameReview
      }
    });
    _resyncAiRulesForPiece(pieceId);

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

    // Verify ownership or moderation rights
    if (existingPiece.creator_id !== parseInt(userId)) {
      const creator = await dbHelpers.findUserById(existingPiece.creator_id);
      const creatorRole = creator?.role || 'user';
      // Admin 2 cannot delete pieces
      if (userRole === 'admin' && req.user.admin_level === 2) {
        return res.status(403).send({ message: "Admin 2 does not have permission to delete pieces" });
      }
      if (!canModerate(userRole, creatorRole)) {
        return res.status(403).send({ message: "You don't have permission to delete this piece" });
      }
    }

    // Delete the piece (CASCADE will handle related tables)
    await db_pool.query("DELETE FROM pieces WHERE id = ?", [pieceId]);

    res.status(200).send({ message: "Piece deleted successfully" });

  } catch (err) {
    console.error("Error in /api/pieces/:pieceId (DELETE):", err);
    res.status(500).send({ message: "Failed to delete piece", err: err.message });
  }
});

// ----------------------- Name Review Queue (Admin) ------------------------------

// List name review queue items
app.get("/api/admin/name-review-queue", authenticateAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending_review';
    const [rows] = await db_pool.query(
      `SELECT q.*, u.username as submitter_username
       FROM name_review_queue q
       LEFT JOIN users u ON q.submitter_id = u.id
       WHERE q.status = ?
       ORDER BY q.created_at DESC`,
      [status]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error("Error fetching name review queue:", err);
    res.status(500).send({ message: "Failed to fetch name review queue" });
  }
});

// Approve a name review queue item
app.post("/api/admin/name-review-queue/:id/approve", authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const { review_note } = req.body;

    const [item] = await db_pool.query("SELECT * FROM name_review_queue WHERE id = ?", [id]);
    if (item.length === 0) {
      return res.status(404).send({ message: "Queue item not found" });
    }

    await db_pool.query(
      `UPDATE name_review_queue SET status = 'approved', reviewer_id = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?`,
      [reviewerId, review_note || null, id]
    );

    // Clear the pending status on the underlying record
    const { item_type, item_id } = item[0];
    const table = item_type === 'game' ? 'game_types' : 'pieces';
    await db_pool.query(
      `UPDATE ${table} SET name_review_status = 'approved' WHERE id = ?`,
      [item_id]
    );

    // If it's a game, also make its auto-created forum public
    if (item_type === 'game') {
      try {
        await db_pool.query(
          "UPDATE articles SET public = 1 WHERE game_type_id = ? AND public = 0",
          [item_id]
        );
      } catch (forumErr) { console.error('Error publishing forum on name approval:', forumErr.message); }
    }

    // Notify the creator that their name was approved
    try {
      const creatorIdQuery = item_type === 'game'
        ? "SELECT creator_id FROM game_types WHERE id = ?"
        : "SELECT creator_id FROM pieces WHERE id = ?";
      const [creatorRows] = await db_pool.query(creatorIdQuery, [item_id]);
      const creatorId = creatorRows[0]?.creator_id;
      if (creatorId) {
        const label = item_type === 'game' ? 'Game' : 'Piece';
        await dbHelpers.createNotification({
          user_id: creatorId,
          sender_id: reviewerId,
          type: 'moderation_approved',
          title: `${label} name approved`,
          content: `Your ${item_type} "${item[0].flagged_name}" has been approved and is now publicly visible.`,
          related_id: item_id,
          action_url: item_type === 'game' ? `/games/${item_id}` : `/pieces/${item_id}`
        });
      }
    } catch (notifyErr) { console.error('Failed to send name approval notification:', notifyErr.message); }

    res.json({ message: "Name approved" });
  } catch (err) {
    console.error("Error approving name review item:", err);
    res.status(500).send({ message: "Failed to approve item" });
  }
});

// Reject a name review queue item
app.post("/api/admin/name-review-queue/:id/reject", authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const { review_note } = req.body;

    const [item] = await db_pool.query("SELECT * FROM name_review_queue WHERE id = ?", [id]);
    if (item.length === 0) {
      return res.status(404).send({ message: "Queue item not found" });
    }

    await db_pool.query(
      `UPDATE name_review_queue SET status = 'rejected', reviewer_id = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?`,
      [reviewerId, review_note || null, id]
    );

    // Mark the underlying record as rejected (keeps it hidden from public)
    const { item_type, item_id } = item[0];
    const table = item_type === 'game' ? 'game_types' : 'pieces';
    await db_pool.query(
      `UPDATE ${table} SET name_review_status = 'rejected' WHERE id = ?`,
      [item_id]
    );

    // Notify the creator that their name was rejected
    try {
      const creatorIdQuery = item_type === 'game'
        ? "SELECT creator_id FROM game_types WHERE id = ?"
        : "SELECT creator_id FROM pieces WHERE id = ?";
      const [creatorRows] = await db_pool.query(creatorIdQuery, [item_id]);
      const creatorId = creatorRows[0]?.creator_id;
      if (creatorId) {
        const noteText = review_note ? ` Reason: ${review_note}` : '';
        const label = item_type === 'game' ? 'Game' : 'Piece';
        await dbHelpers.createNotification({
          user_id: creatorId,
          sender_id: reviewerId,
          type: 'moderation_rejected',
          title: `${label} name rejected`,
          content: `Your ${item_type} name "${item[0].flagged_name}" was rejected by a moderator. Please rename it.${noteText}`,
          related_id: item_id,
          action_url: item_type === 'game' ? `/games/${item_id}` : `/pieces/${item_id}`
        });
      }
    } catch (notifyErr) { console.error('Failed to send name rejection notification:', notifyErr.message); }

    res.json({ message: "Name rejected" });
  } catch (err) {
    console.error("Error rejecting name review item:", err);
    res.status(500).send({ message: "Failed to reject item" });
  }
});

// ----------------------- Image Moderation Queue (Admin) ------------------------------
app.get("/api/admin/moderation-queue", authenticateAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending_review';
    const [rows] = await db_pool.query(
      `SELECT q.*, p.piece_name, u.username as uploader_username
       FROM image_moderation_queue q
       LEFT JOIN pieces p ON q.piece_id = p.id
       LEFT JOIN users u ON q.uploader_id = u.id
       WHERE q.status = ?
       ORDER BY q.created_at DESC`,
      [status]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error("Error fetching moderation queue:", err);
    res.status(500).send({ message: "Failed to fetch moderation queue" });
  }
});

// Approve a moderation queue item
app.post("/api/admin/moderation-queue/:id/approve", authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const { review_note } = req.body;

    const [item] = await db_pool.query("SELECT * FROM image_moderation_queue WHERE id = ?", [id]);
    if (item.length === 0) {
      return res.status(404).send({ message: "Queue item not found" });
    }

    await db_pool.query(
      `UPDATE image_moderation_queue SET status = 'approved', reviewer_id = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?`,
      [reviewerId, review_note || null, id]
    );

    // Check if all images for this piece are now approved
    const pieceId = item[0].piece_id;
    const [pending] = await db_pool.query(
      "SELECT COUNT(*) as cnt FROM image_moderation_queue WHERE piece_id = ? AND status = 'pending_review'",
      [pieceId]
    );

    if (pending[0].cnt === 0) {
      await db_pool.query("UPDATE pieces SET moderation_status = 'approved' WHERE id = ?", [pieceId]);
      // Notify the piece creator that their piece is fully approved
      try {
        const [pieceRows] = await db_pool.query("SELECT id, creator_id, piece_name FROM pieces WHERE id = ?", [pieceId]);
        const piece = pieceRows[0];
        if (piece && piece.creator_id) {
          await dbHelpers.createNotification({
            user_id: piece.creator_id,
            sender_id: reviewerId,
            type: 'moderation_approved',
            title: 'Piece approved',
            content: `Your piece "${piece.piece_name}" has been approved and is now visible to other players.`,
            related_id: piece.id,
            action_url: `/pieces/${piece.id}`
          });
          // Live push if recipient is online
          try {
            const ioInst = app.get('io');
            if (ioInst) {
              const { userSockets: uSockets } = require('./game-socket');
              const targetSockId = uSockets && uSockets.get(parseInt(piece.creator_id));
              if (targetSockId) ioInst.to(targetSockId).emit('newNotification', { type: 'moderation_approved', title: 'Piece approved' });
            }
          } catch (e) { /* non-fatal live-push */ }
        }
      } catch (notifyErr) { console.error('Failed to send approval notification:', notifyErr.message); }
    }

    res.json({ message: "Image approved" });
  } catch (err) {
    console.error("Error approving moderation item:", err);
    res.status(500).send({ message: "Failed to approve item" });
  }
});

// Reject a moderation queue item
app.post("/api/admin/moderation-queue/:id/reject", authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const { review_note } = req.body;

    const [item] = await db_pool.query("SELECT * FROM image_moderation_queue WHERE id = ?", [id]);
    if (item.length === 0) {
      return res.status(404).send({ message: "Queue item not found" });
    }

    await db_pool.query(
      `UPDATE image_moderation_queue SET status = 'rejected', reviewer_id = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?`,
      [reviewerId, review_note || null, id]
    );

    // Delete the rejected image file
    try {
      const fullPath = path.join(__dirname, '..', item[0].image_path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (e) { console.error("Error deleting rejected image:", e.message); }

    // Update piece moderation status to rejected
    await db_pool.query("UPDATE pieces SET moderation_status = 'rejected' WHERE id = ?", [item[0].piece_id]);

    // Notify the piece creator that their piece was rejected
    try {
      const [pieceRows] = await db_pool.query("SELECT id, creator_id, piece_name FROM pieces WHERE id = ?", [item[0].piece_id]);
      const piece = pieceRows[0];
      if (piece && piece.creator_id) {
        const noteText = review_note ? ` Reason: ${review_note}` : '';
        await dbHelpers.createNotification({
          user_id: piece.creator_id,
          sender_id: reviewerId,
          type: 'moderation_rejected',
          title: 'Piece rejected',
          content: `Your piece "${piece.piece_name}" was rejected by a moderator.${noteText}`,
          related_id: piece.id,
          action_url: `/pieces`
        });
        try {
          const ioInst = app.get('io');
          if (ioInst) {
            const { userSockets: uSockets } = require('./game-socket');
            const targetSockId = uSockets && uSockets.get(parseInt(piece.creator_id));
            if (targetSockId) ioInst.to(targetSockId).emit('newNotification', { type: 'moderation_rejected', title: 'Piece rejected' });
          }
        } catch (e) { /* non-fatal live-push */ }
      }
    } catch (notifyErr) { console.error('Failed to send rejection notification:', notifyErr.message); }

    res.json({ message: "Image rejected and removed" });
  } catch (err) {
    console.error("Error rejecting moderation item:", err);
    res.status(500).send({ message: "Failed to reject item" });
  }
});

// Directly approve a piece's moderation status (bypasses queue)
app.post("/api/admin/pieces/:pieceId/approve-moderation", authenticateAdmin, async (req, res) => {
  try {
    const { pieceId } = req.params;
    const reviewerId = req.user.id;
    
    // Update piece status
    await db_pool.query("UPDATE pieces SET moderation_status = 'approved' WHERE id = ?", [pieceId]);
    
    // Also approve any pending queue items for this piece
    await db_pool.query(
      "UPDATE image_moderation_queue SET status = 'approved', reviewer_id = ?, reviewed_at = NOW() WHERE piece_id = ? AND status = 'pending_review'",
      [reviewerId, pieceId]
    );

    // Notify the piece creator that their piece is approved
    try {
      const [pieceRows] = await db_pool.query("SELECT id, creator_id, piece_name FROM pieces WHERE id = ?", [pieceId]);
      const piece = pieceRows[0];
      if (piece && piece.creator_id) {
        await dbHelpers.createNotification({
          user_id: piece.creator_id,
          sender_id: reviewerId,
          type: 'moderation_approved',
          title: 'Piece approved',
          content: `Your piece "${piece.piece_name}" has been approved and is now visible to other players.`,
          related_id: piece.id,
          action_url: `/pieces/${piece.id}`
        });
        try {
          const ioInst = app.get('io');
          if (ioInst) {
            const { userSockets: uSockets } = require('./game-socket');
            const targetSockId = uSockets && uSockets.get(parseInt(piece.creator_id));
            if (targetSockId) ioInst.to(targetSockId).emit('newNotification', { type: 'moderation_approved', title: 'Piece approved' });
          }
        } catch (e) { /* non-fatal live-push */ }
      }
    } catch (notifyErr) { console.error('Failed to send approval notification:', notifyErr.message); }

    res.json({ message: "Piece approved" });
  } catch (err) {
    console.error("Error approving piece:", err);
    res.status(500).send({ message: "Failed to approve piece" });
  }
});

// =====================================================================
//   AI TRAINING (admin) — see AI_OVERHAUL_PLAN.md
// =====================================================================
//
// Endpoints:
//   GET  /api/admin/ai-training/status         — engine availability + active job count
//   GET  /api/admin/ai-training/jobs           — recent jobs (any status)
//   GET  /api/admin/ai-training/jobs/:id       — one job + recent log events
//   POST /api/admin/ai-training/jobs           — start a new job
//   POST /api/admin/ai-training/jobs/:id/stop  — signal SIGTERM to a running job
//   PUT  /api/admin/ai-training/memory-cap     — update global memory budget
//
// All gated by `authenticateAdmin`. The trainer is sandboxed in a
// subprocess (1 GB / 1 core by default) so the game server is unaffected.

const trainingManager = require('./ai/training-manager');

app.get('/api/admin/ai-training/status', authenticateAdmin1, async (req, res) => {
  try {
    const built = trainingManager.REMOTE_MODE
      ? await trainingManager.isRustBuiltRemote()
      : trainingManager.isRustBuilt();
    const jobs = await trainingManager.listJobs(20);
    const active = jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
    const usedMemoryMb = await trainingManager.activeMemoryMb();
    const globalMemoryCapMb = await trainingManager.getGlobalMemoryCapMb();
    res.json({
      engineAvailable: built,
      enginePath: trainingManager.RUST_BIN,
      globalMemoryCapMb,
      activeMemoryMb: usedMemoryMb,
      activeJobs: active,
      remoteMode: !!trainingManager.REMOTE_MODE,
      jobs,
    });
  } catch (err) {
    console.error('AI training status error:', err);
    res.status(500).send({ message: 'Failed to load AI training status' });
  }
});

app.put('/api/admin/ai-training/memory-cap', authenticateAdmin1, async (req, res) => {
  try {
    const { memoryCapMb } = req.body;
    const saved = await trainingManager.setGlobalMemoryCapMb(memoryCapMb);
    res.json({ globalMemoryCapMb: saved });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.get('/api/admin/ai-training/jobs', authenticateAdmin1, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const jobs = await trainingManager.listJobs(limit);
    res.json({ jobs });
  } catch (err) {
    console.error('List AI training jobs error:', err);
    res.status(500).send({ message: 'Failed to list training jobs' });
  }
});

app.get('/api/admin/ai-training/jobs/:id', authenticateAdmin1, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });
    const status = await trainingManager.getJobStatus(id);
    if (!status) return res.status(404).send({ message: 'Job not found' });
    res.json(status);
  } catch (err) {
    console.error('Get AI training job error:', err);
    res.status(500).send({ message: 'Failed to load training job' });
  }
});

app.post('/api/admin/ai-training/jobs', authenticateAdmin1, async (req, res) => {
  try {
    const {
      gameTypeId,
      games,
      mctsIters,
      maxRssMb,
      checkpointEvery,
      seed,
      noGameLog,
    } = req.body || {};
    const gid = parseInt(gameTypeId, 10);
    if (!Number.isFinite(gid) || gid <= 0) {
      return res.status(400).send({ message: 'gameTypeId is required' });
    }
    // Server-side caps so a hand-crafted POST cannot blow up resources.
    const safeGames = Math.max(1, Math.min(parseInt(games, 10) || 200, 100000));
    const safeIters = Math.max(10, Math.min(parseInt(mctsIters, 10) || 200, 5000));
    const safeRss = Math.max(128, Math.min(parseInt(maxRssMb, 10) || 1024, 8192));
    const safeCkpt = Math.max(1, Math.min(parseInt(checkpointEvery, 10) || 25, 10000));
    const safeSeed = parseInt(seed, 10) || 0;
    const job = await trainingManager.startJob({
      gameTypeId: gid,
      games: safeGames,
      mctsIters: safeIters,
      maxRssMb: safeRss,
      checkpointEvery: safeCkpt,
      seed: safeSeed,
      userId: req.user && req.user.id,
      noGameLog: !!noGameLog,
    });
    res.status(201).json({ job });
  } catch (err) {
    console.error('Start AI training job error:', err);
    res.status(400).send({ message: err.message || 'Failed to start training job' });
  }
});

app.post('/api/admin/ai-training/jobs/:id/stop', authenticateAdmin1, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });
    const stopped = trainingManager.stopJob(id);
    if (!stopped) {
      return res.status(409).send({ message: 'Job is not running on this server (already finished or restarted).' });
    }
    res.json({ message: 'Stop signal sent' });
  } catch (err) {
    console.error('Stop AI training job error:', err);
    res.status(500).send({ message: 'Failed to stop training job' });
  }
});

app.post('/api/admin/ai-training/jobs/:id/resume', authenticateAdmin1, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });
    const job = await trainingManager.resumeJob(id);
    res.json({ job });
  } catch (err) {
    console.error('Resume AI training job error:', err);
    res.status(400).send({ message: err.message || 'Failed to resume training job' });
  }
});

// Package a job's on-disk directory as a ZIP for devs to download and
// later upload into the production admin portal. Only available when the
// trainer runs locally (same host as the backend) — in REMOTE_MODE the
// files live on a different machine, and the live-site admin portal
// already accepts the uploads we'd be producing.
// Download the plain-text game transcript written directly by the Rust trainer.
// The file is already human-readable; just stream it as-is.
app.get('/api/admin/ai-training/jobs/:id/game-log', authenticateAdmin1, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });
    const content = await trainingManager.getGameLog(id);
    if (!content) {
      return res.status(404).send({
        message: 'No game log found for this job. Game logs are only available for jobs started after this feature was added, or the job was started with "Generate game log" disabled.',
      });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ai-job-${id}-games.txt"`);
    res.send(content);
  } catch (err) {
    console.error('Game log download error:', err);
    res.status(500).send({ message: err.message || 'Failed to fetch game log' });
  }
});

// ---------------------------------------------------------------------------
// Board replay: parse the job's games.txt and return structured move data
// for a specific game so the admin UI can step through the board state.
// ---------------------------------------------------------------------------

/**
 * Convert a file-letter string (e.g. "e", "aa") to a 0-based column index.
 * Matches the col_to_file() function in ai-engine-rs/src/selfplay.rs.
 */
function _replayFileToCol(fileStr) {
  if (!fileStr || typeof fileStr !== 'string') return 0;
  if (fileStr.length === 1) {
    return fileStr.charCodeAt(0) - 97; // 'a' = 0
  }
  // Two-letter: "aa" = 26, "ab" = 27, ...
  return (fileStr.charCodeAt(0) - 97 + 1) * 26 + (fileStr.charCodeAt(1) - 97);
}

/**
 * Parse a square notation like "e4" or "aa12" to {x, y} (0-based from top-left).
 * y = boardHeight - rank  (rank is 1-indexed from the bottom row)
 */
function _replayNotationToXY(notation, boardHeight) {
  if (!notation) return null;
  const match = notation.match(/^([a-z]+)(\d+)$/);
  if (!match) return null;
  const x = _replayFileToCol(match[1]);
  const y = boardHeight - parseInt(match[2], 10);
  return { x, y };
}

/**
 * Parse a single move-line from games.txt.
 * Returns null if the line isn't a move line.
 *
 * The Rust trainer writes lines in the format:
 *   "     N. [P<player>] <PieceName> <notation>[ (captures <name>)][ (castle)]"
 *
 * Castling notation is now written as the actual king from-to squares, e.g.
 * "e1-g1 (castle)", so the same coordinate parser handles both castling and
 * normal moves. The "(castle)" suffix flags the move as a castling move.
 *
 * Legacy O-O / O-O-O notation is still accepted for backwards compatibility
 * with older games.txt files.
 *
 * IMPORTANT:
 *  - PieceName may contain spaces (e.g. "Dragon Queen"). Using \S+ here drops
 *    every move made by multi-word piece names, causing board drift and apparent
 *    ally-captures. We capture it with (.+?) and anchor on the notation token.
 *  - Promotion targets may also contain spaces (=Dragon Queen). Handled via
 *    [A-Za-z ]+ in the notation alternation.
 *  - O-O-O must appear before O-O in the alternation to avoid partial match.
 */
function _replayParseMoveLine(line, boardHeight) {
  const m = line.match(
    /^\s+(\d+)\.\s+\[P(\d+)\]\s+(.+?)\s+(O-O-O|O-O|[a-z]+\d+[x-][a-z]+\d+(?:=[A-Za-z][A-Za-z ]*)?)(?:\s+\(captures\s+([^)]+)\))?(\s+\(castle\))?\s*$/
  );
  if (!m) return null;

  const moveNum      = parseInt(m[1], 10);
  const player       = parseInt(m[2], 10);
  const pieceName    = m[3].trim();
  const notation     = m[4];
  const capturedName = m[5] ? m[5].trim() : null;
  const castleSuffix = !!m[6];

  let fromX = null, fromY = null, toX = null, toY = null;
  let isCastling = false, castleSide = null, promotesTo = null, isCapture = false;

  if (notation === 'O-O') {
    isCastling = true; castleSide = 'kingside';
  } else if (notation === 'O-O-O') {
    isCastling = true; castleSide = 'queenside';
  } else {
    // "e2-e4", "e2xe4", "e7-e8=Queen", "e7-e8=Fire Phoenix", or "e1-g1 (castle)"
    const nm = notation.match(/^([a-z]+\d+)([x-])([a-z]+\d+)(?:=(.+))?$/);
    if (nm) {
      isCapture = nm[2] === 'x';
      const from = _replayNotationToXY(nm[1], boardHeight);
      const to   = _replayNotationToXY(nm[3], boardHeight);
      if (from && to) { fromX = from.x; fromY = from.y; toX = to.x; toY = to.y; }
      promotesTo = nm[4] ? nm[4].trim() : null;
    }
    if (castleSuffix) {
      isCastling = true;
      // Determine side from horizontal direction: king moves right = kingside
      castleSide = (toX !== null && fromX !== null)
        ? (toX > fromX ? 'kingside' : 'queenside')
        : null;
    }
  }

  return { moveNum, player, pieceName, fromX, fromY, toX, toY, isCapture, isCastling, castleSide, capturedName, promotesTo };
}

app.get('/api/admin/ai-training/jobs/:id/game-replay', authenticateAdmin1, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });

    const gameNum = Math.max(1, parseInt(req.query.game || '1', 10) || 1);

    // Get job to find game_type_id
    const jobStatus = await trainingManager.getJobStatus(id);
    if (!jobStatus?.job) return res.status(404).send({ message: 'Job not found' });
    const { job } = jobStatus;
    const gameTypeId = job.game_type_id;

    // Query DB for board dimensions, starting piece placements, and randomization config.
    const [[gameTypeRow]] = await db_pool.query(
      'SELECT board_width, board_height, randomized_starting_positions FROM game_types WHERE id = ? LIMIT 1',
      [gameTypeId],
    );
    if (!gameTypeRow) return res.status(404).send({ message: 'Game type not found' });
    const { board_width: boardWidth, board_height: boardHeight } = gameTypeRow;

    // Detect whether starting positions are randomized per game. If so, the
    // starting board shown in the replay will be the DB default layout, NOT the
    // actual layout used in each game — warn the user in the UI.
    let hasRandomizedPositions = false;
    if (gameTypeRow.randomized_starting_positions) {
      try {
        const rsp = JSON.parse(gameTypeRow.randomized_starting_positions);
        hasRandomizedPositions = !!(rsp && rsp.mode && rsp.mode !== 'none');
      } catch { /* non-fatal */ }
    }

    const [posRows] = await db_pool.query(
      `SELECT gtp.x, gtp.y, gtp.player_number, p.id AS piece_id, p.piece_name,
              COALESCE(p.piece_width,  1) AS piece_width,
              COALESCE(p.piece_height, 1) AS piece_height
       FROM game_type_pieces gtp
       JOIN pieces p ON gtp.piece_id = p.id
       WHERE gtp.game_type_id = ?
       ORDER BY gtp.id`,
      [gameTypeId],
    );

    const startingPieces = posRows.map((row, i) => ({
      instanceId:  `sp_${i}`,
      pieceName:   row.piece_name,
      player:      row.player_number,
      x:           row.x,
      y:           row.y,
      pieceWidth:  row.piece_width  || 1,
      pieceHeight: row.piece_height || 1,
    }));

    // Get the game log
    const content = await trainingManager.getGameLog(id);
    if (!content) {
      return res.status(404).send({
        message: 'No game log for this job. Start a job with "Generate game log" enabled.',
      });
    }

    // Count total games (each game starts with "=== Game #N ===")
    const headers = content.match(/^=== Game #\d+/gm) || [];
    const totalGames = headers.length;
    if (totalGames === 0) return res.status(404).send({ message: 'No games found in log' });

    const safeGameNum = Math.min(gameNum, totalGames);

    // Split content into game blocks and find the requested game
    // Add a sentinel newline so the split works for the very first block too
    const blocks = ('\n' + content).split(/\n(?==== Game #)/);
    const targetBlock = blocks.find((b) => {
      const hm = b.match(/^=== Game #(\d+)/);
      return hm && parseInt(hm[1], 10) === safeGameNum;
    });

    let outcome = 'Unknown';
    const moves = [];

    if (targetBlock) {
      const headerLine = targetBlock.match(/^=== Game #\d+ — (.+?) — \d+ moves ===/);
      if (headerLine) outcome = headerLine[1].trim();

      for (const line of targetBlock.split('\n')) {
        const parsed = _replayParseMoveLine(line, boardHeight);
        if (parsed) moves.push(parsed);
      }
    }

    res.json({ totalGames, gameNum: safeGameNum, boardWidth, boardHeight, outcome, totalMoves: moves.length, startingPieces, moves, hasRandomizedPositions });
  } catch (err) {
    console.error('Game replay error:', err);
    res.status(500).send({ message: err.message || 'Failed to load game replay' });
  }
});

app.get('/api/admin/ai-training/jobs/:id/download', authenticateAdmin1, async (req, res) => {
  try {
    if (trainingManager.REMOTE_MODE) {
      return res.status(400).send({
        message: 'Downloads are only available when the trainer runs on the same host as the backend (local dev). In remote mode, fetch the artifacts from the trainer service host directly.',
      });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });
    const job = await trainingManager.getJobStatus(id);
    if (!job || !job.job) return res.status(404).send({ message: 'Job not found' });
    const fs = require('fs');
    const path = require('path');
    const AdmZip = require('adm-zip');
    const { trainingDirFor } = require('./ai/export-game-rules');
    const jobDir = path.join(trainingDirFor(job.job.game_type_id), 'jobs', String(id));
    if (!fs.existsSync(jobDir)) {
      return res.status(404).send({ message: 'Job directory does not exist on disk' });
    }
    const zip = new AdmZip();
    zip.addLocalFolder(jobDir);
    const buf = zip.toBuffer();
    const fname = `ai-job-${job.job.game_type_id}-${id}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (err) {
    console.error('Download AI training job error:', err);
    res.status(500).send({ message: err.message || 'Failed to package job for download' });
  }
});

// Delete the on-disk training artifacts (log.ndjson, model-*.bin, etc.)
// for a specific job. The DB row is preserved so job history remains
// visible. In remote mode the trainer and backend share the same MySQL
// instance and filesystem path conventions, so we delete directly.
app.delete('/api/admin/ai-training/jobs/:id/data', authenticateAdmin1, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });
    const jobStatus = await trainingManager.getJobStatus(id);
    if (!jobStatus || !jobStatus.job) return res.status(404).send({ message: 'Job not found' });
    const { job } = jobStatus;
    if (job.status === 'running') {
      return res.status(400).send({ message: 'Cannot delete data for a running job. Stop it first.' });
    }
    const fs = require('fs');
    const path = require('path');
    const { trainingDirFor } = require('./ai/export-game-rules');
    let deletedDir = false;
    if (trainingManager.REMOTE_MODE) {
      // Data lives on the trainer-service host — proxy the deletion there.
      const trainerClient = require('./ai/trainer-client');
      await trainerClient.deleteJobData(id);
      deletedDir = true; // best-effort; don't let remote error block DB update
    } else {
      const jobDir = path.join(trainingDirFor(job.game_type_id), 'jobs', String(id));
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        deletedDir = true;
      }
    }
    // Mark the job as having its data cleared in the DB (reset games_played to 0).
    await db_pool.query(
      `UPDATE ai_training_jobs SET games_played = 0, status = 'stopped', error_message = CONCAT(IFNULL(error_message, ''), ' [data cleared]') WHERE id = ?`,
      [id]
    );
    // Auto-invalidate the cached analysis so it no longer reflects deleted data.
    // Best-effort: don't fail the whole request if regeneration errors.
    try {
      const _trainingAnalysis = require('./ai/training-analysis');
      const [[remaining]] = await db_pool.query(
        `SELECT COUNT(*) AS c FROM ai_training_jobs WHERE game_type_id = ? AND games_played > 0`,
        [job.game_type_id],
      );
      if ((remaining?.c || 0) === 0) {
        // No jobs with data left for this game type — drop the cached
        // analysis row entirely so the admin UI shows "No analysis yet"
        // instead of a stale (possibly schema-mismatched) summary.
        await _trainingAnalysis.deleteAnalysis(job.game_type_id);
      } else {
        await _trainingAnalysis.regenerateAndStore(job.game_type_id, null, { filterLegacy: true });
      }
    } catch (analysisErr) {
      console.warn('Could not auto-regenerate analysis after data clear:', analysisErr.message);
    }
    res.json({ ok: true, deletedDir, jobId: id });
  } catch (err) {
    console.error('Delete AI training job data error:', err);
    res.status(500).send({ message: err.message || 'Failed to delete job data' });
  }
});

// Delete a training job entirely — wipes the on-disk directory AND removes
// the DB row from `ai_training_jobs`. Refuses to delete a running job;
// admin must stop it first. Use this when a job is no longer wanted in
// history at all (vs. /data which keeps the row for audit).
app.delete('/api/admin/ai-training/jobs/:id', authenticateAdmin1, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid job id' });
    const jobStatus = await trainingManager.getJobStatus(id);
    if (!jobStatus || !jobStatus.job) return res.status(404).send({ message: 'Job not found' });
    const { job } = jobStatus;
    if (job.status === 'running' || job.status === 'queued') {
      return res.status(400).send({
        message: `Cannot delete a ${job.status} job. Stop it first.`,
      });
    }
    const fs = require('fs');
    const path = require('path');
    const { trainingDirFor } = require('./ai/export-game-rules');
    let deletedDir = false;
    if (trainingManager.REMOTE_MODE) {
      const trainerClient = require('./ai/trainer-client');
      await trainerClient.deleteJobData(id);
      deletedDir = true;
    } else {
      const jobDir = path.join(trainingDirFor(job.game_type_id), 'jobs', String(id));
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        deletedDir = true;
      }
    }
    await db_pool.query('DELETE FROM ai_training_jobs WHERE id = ?', [id]);
    // Refresh cached analysis so the removed job's data isn't double-counted.
    try {
      const _trainingAnalysis = require('./ai/training-analysis');
      const [[remaining]] = await db_pool.query(
        `SELECT COUNT(*) AS c FROM ai_training_jobs WHERE game_type_id = ? AND games_played > 0`,
        [job.game_type_id],
      );
      if ((remaining?.c || 0) === 0) {
        await _trainingAnalysis.deleteAnalysis(job.game_type_id);
      } else {
        await _trainingAnalysis.regenerateAndStore(job.game_type_id, null, { filterLegacy: true });
      }
    } catch (analysisErr) {
      console.warn('Could not auto-regenerate analysis after job delete:', analysisErr.message);
    }
    try { trainingManager._invalidateModelMetaCache?.(job.game_type_id); } catch (_) { /* ignore */ }
    res.json({ ok: true, deletedDir, jobId: id });
  } catch (err) {
    console.error('Delete AI training job error:', err);
    res.status(500).send({ message: err.message || 'Failed to delete job' });
  }
});

// Public endpoint — used by the create-game UI to decide whether the
// "Adaptive" computer difficulty should be enabled for a given game type.
// No auth required: returns only an aggregate game-count and whether a
// trained model exists, no PII.
app.get('/api/ai-models/:gameTypeId/availability', async (req, res) => {
  try {
    const gid = parseInt(req.params.gameTypeId, 10);
    if (!Number.isFinite(gid)) return res.status(400).send({ message: 'Invalid game type id' });
    const meta = await trainingManager.getModelMetaForGameType(gid);
    if (!meta) {
      return res.json({
        available: false,
        gamesPlayed: 0,
      });
    }
    res.json({
      available: !!meta.hasModel,
      gamesPlayed: meta.totalGamesPlayed || 0,
      latestJobAt: meta.latestJobAt || null,
    });
  } catch (err) {
    console.error('AI model availability error:', err);
    res.status(500).send({ message: 'Failed to check model availability' });
  }
});

// Admin: pause / resume new training jobs. Existing in-flight jobs are
// not affected. Status is in-memory only — a server restart resets to
// "not paused" (intentional: we don't want a forgotten pause to silently
// block training forever).
app.get('/api/admin/ai-training/pause-status', authenticateAdmin1, (req, res) => {
  res.json(trainingManager.isNewJobsPaused());
});

app.post('/api/admin/ai-training/pause', authenticateAdmin1, (req, res) => {
  trainingManager.pauseNewJobs(req.body?.reason || 'paused by admin');
  res.json(trainingManager.isNewJobsPaused());
});

app.post('/api/admin/ai-training/resume', authenticateAdmin1, (req, res) => {
  trainingManager.resumeNewJobs();
  res.json(trainingManager.isNewJobsPaused());
});

// Sync disk: scan disk for actual game counts per job and reconcile the
// games_played column in the DB. Jobs whose on-disk data is gone (e.g.
// after accidental deletion) get games_played reset to 0 so the UI
// accurately reflects the loss. In REMOTE_MODE proxies to the trainer-service
// for the disk scan, then applies DB updates here (shared MySQL).
app.post('/api/admin/ai-training/sync-disk', authenticateAdmin1, async (req, res) => {
  try {
    const { gameTypeId } = req.body || {};
    const trainerClient = require('./ai/trainer-client');
    const { trainingDirFor } = require('./ai/export-game-rules');

    // Collect which game type IDs to scan.
    let gtids = [];
    if (gameTypeId) {
      const gtid = parseInt(gameTypeId, 10);
      if (!Number.isFinite(gtid) || gtid <= 0) {
        return res.status(400).send({ message: 'Invalid gameTypeId' });
      }
      gtids = [gtid];
    } else {
      const [rows] = await db_pool.query(
        `SELECT DISTINCT game_type_id FROM ai_training_jobs WHERE games_played > 0`
      );
      gtids = rows.map((r) => r.game_type_id);
    }

    const allUpdated = [];

    for (const gtid of gtids) {
      // Get per-job disk counts.
      let diskJobs = [];
      if (trainingManager.REMOTE_MODE) {
        try {
          const result = await trainerClient.verifyDisk(gtid);
          diskJobs = result?.jobs || [];
        } catch (e) {
          return res.status(502).send({ message: `Trainer service error: ${e.message}` });
        }
      } else {
        // Local: scan directly.
        const fs = require('fs');
        const path = require('path');
        const jobsRoot = path.join(trainingDirFor(gtid), 'jobs');
        if (fs.existsSync(jobsRoot)) {
          for (const entry of fs.readdirSync(jobsRoot)) {
            const jobId = parseInt(entry, 10);
            if (!Number.isFinite(jobId) || jobId <= 0) continue;
            const dir = path.join(jobsRoot, entry);
            try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
            const logPath  = path.join(dir, 'log.ndjson');
            const bookPath = path.join(dir, 'book.jsonl');
            let gamesOnDisk = 0;
            let source = 'none';
            if (fs.existsSync(logPath)) {
              try {
                const text = fs.readFileSync(logPath, 'utf8');
                for (const line of text.split(/\r?\n/)) {
                  if (!line) continue;
                  try { const ev = JSON.parse(line); if (ev?.type === 'game_complete') gamesOnDisk++; } catch { /* skip */ }
                }
                source = 'log';
              } catch { /* unreadable */ }
            } else if (fs.existsSync(bookPath)) {
              try {
                const text = fs.readFileSync(bookPath, 'utf8');
                for (const line of text.split(/\r?\n/)) {
                  if (!line.trim()) continue;
                  try { const r = JSON.parse(line); if (r.p === 0 || r.p === '0') gamesOnDisk++; } catch { /* skip */ }
                }
                source = 'book';
              } catch { /* unreadable */ }
            }
            diskJobs.push({ jobId, gamesOnDisk, source });
          }
        }
      }

      // Build a map of disk counts by jobId.
      const diskMap = {};
      for (const j of diskJobs) diskMap[j.jobId] = j;

      // Fetch DB records for this game type.
      const [dbRows] = await db_pool.query(
        `SELECT id, games_played, status FROM ai_training_jobs WHERE game_type_id = ?`,
        [gtid],
      );

      for (const row of dbRows) {
        const disk = diskMap[row.id];
        const diskGames = disk?.gamesOnDisk ?? 0;
        if (row.games_played > 0 && diskGames === 0) {
          // Data is gone from disk — zero out DB so UI reflects reality.
          await db_pool.query(
            `UPDATE ai_training_jobs SET games_played = 0,
               error_message = CONCAT(IFNULL(error_message, ''), ' [disk data missing — zeroed by sync]')
             WHERE id = ?`,
            [row.id],
          );
          allUpdated.push({
            jobId: row.id,
            gameTypeId: gtid,
            oldGamesPlayed: row.games_played,
            newGamesPlayed: 0,
            reason: 'disk_data_missing',
          });
        } else if (disk && diskGames > 0 && diskGames !== row.games_played) {
          // Disk says a different count than DB — trust disk.
          await db_pool.query(
            `UPDATE ai_training_jobs SET games_played = ? WHERE id = ?`,
            [diskGames, row.id],
          );
          allUpdated.push({
            jobId: row.id,
            gameTypeId: gtid,
            oldGamesPlayed: row.games_played,
            newGamesPlayed: diskGames,
            reason: 'count_mismatch',
          });
        }
      }

      // Invalidate model meta cache for this game type.
      try { trainingManager._invalidateModelMetaCache?.(gtid); } catch { /* non-fatal */ }

      // Regenerate analysis for this game type so it reflects the corrected data.
      try {
        const _trainingAnalysis = require('./ai/training-analysis');
        const [[remaining]] = await db_pool.query(
          `SELECT COUNT(*) AS c FROM ai_training_jobs WHERE game_type_id = ? AND games_played > 0`,
          [gtid],
        );
        if ((remaining?.c || 0) === 0) {
          await _trainingAnalysis.deleteAnalysis(gtid);
        } else {
          await _trainingAnalysis.regenerateAndStore(gtid, null, { filterLegacy: true });
        }
      } catch { /* non-fatal */ }
    }

    res.json({ ok: true, updated: allUpdated, scannedGameTypes: gtids.length });
  } catch (err) {
    console.error('Sync disk error:', err);
    res.status(500).send({ message: err.message || 'Sync failed' });
  }
});

// Back up training data on the trainer host to a directory outside the repo.
// In REMOTE_MODE proxies to the trainer-service (data lives there).
// Locally, copies from ai-training/ to the TRAINING_BACKUP_DIR or a sibling
// directory named ai-training-backup.
app.post('/api/admin/ai-training/backup', authenticateAdmin1, async (req, res) => {
  try {
    const { gameTypeId } = req.body || {};
    const gameTypeIds = gameTypeId ? [parseInt(gameTypeId, 10)] : [];
    const trainerClient = require('./ai/trainer-client');

    if (trainingManager.REMOTE_MODE) {
      const result = await trainerClient.backup(gameTypeIds);
      return res.json(result);
    }

    // Local backup.
    const fs = require('fs');
    const path = require('path');
    const { trainingDirFor, trainingRootDir } = require('./ai/export-game-rules');
    const TRAINING_ROOT = trainingRootDir();
    const BACKUP_ROOT = process.env.TRAINING_BACKUP_DIR
      ? path.resolve(process.env.TRAINING_BACKUP_DIR)
      : path.join(path.dirname(TRAINING_ROOT), 'ai-training-backup');

    let gtids = gameTypeIds.length > 0 ? gameTypeIds : [];
    if (gtids.length === 0 && fs.existsSync(TRAINING_ROOT)) {
      for (const entry of fs.readdirSync(TRAINING_ROOT)) {
        const id = parseInt(entry, 10);
        if (Number.isFinite(id)) gtids.push(id);
      }
    }

    function copyDir(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snapshotRoot = path.join(BACKUP_ROOT, timestamp);
    let copiedGameTypes = 0;
    let copiedFiles = 0;
    for (const gtid of gtids) {
      const src = trainingDirFor(gtid);
      if (!fs.existsSync(src)) continue;
      copyDir(src, path.join(snapshotRoot, String(gtid)));
      copiedGameTypes++;
      const countFiles = (d) => {
        let n = 0;
        for (const e of fs.readdirSync(d)) {
          const full = path.join(d, e);
          n += fs.statSync(full).isDirectory() ? countFiles(full) : 1;
        }
        return n;
      };
      try { copiedFiles += countFiles(path.join(snapshotRoot, String(gtid))); } catch { /* non-fatal */ }
    }

    res.json({ ok: true, backupPath: snapshotRoot, copiedGameTypes, copiedFiles, timestamp });
  } catch (err) {
    console.error('Backup training data error:', err);
    res.status(500).send({ message: err.message || 'Backup failed' });
  }
});

// Check which job directories exist on disk (on-demand, per-job).
// Body: { jobs: [{ id, game_type_id }] }
// Returns { present: [id,...], absent: [id,...] }
app.post('/api/admin/ai-training/disk-status', authenticateAdmin1, async (req, res) => {
  try {
    const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
    if (trainingManager.REMOTE_MODE) {
      const trainerClient = require('./ai/trainer-client');
      const result = await trainerClient.diskStatus(jobs);
      return res.json(result);
    }
    // Local: check directories directly.
    const fs = require('fs');
    const path = require('path');
    const { trainingRootDir } = require('./ai/export-game-rules');
    const TRAINING_ROOT = trainingRootDir();
    const present = [];
    const absent = [];
    for (const j of jobs) {
      const jobId = Number(j.id);
      const gtid = Number(j.game_type_id);
      if (!Number.isFinite(jobId) || !Number.isFinite(gtid)) continue;
      const dir = path.join(TRAINING_ROOT, String(gtid), 'jobs', String(jobId));
      if (fs.existsSync(dir)) {
        present.push(jobId);
      } else {
        absent.push(jobId);
      }
    }
    res.json({ present, absent });
  } catch (err) {
    console.error('Disk status check error:', err);
    res.status(500).send({ message: err.message || 'Disk status check failed' });
  }
});

// Download the rules.json for a game type. Ensures an up-to-date export
// exists first (re-generates from DB if needed). In REMOTE_MODE the file
// lives on the trainer host; a dedicated /trainer/rules/:id endpoint serves it.
app.get('/api/admin/ai-training/rules/:gameTypeId', authenticateAdmin1, async (req, res) => {
  try {
    const gtid = parseInt(req.params.gameTypeId, 10);
    if (!Number.isFinite(gtid) || gtid <= 0) {
      return res.status(400).send({ message: 'Invalid gameTypeId' });
    }
    const { exportGameRules, rulesPathFor } = require('./ai/export-game-rules');
    if (trainingManager.REMOTE_MODE) {
      // Re-export from DB (shared MySQL) then serve via trainer.
      await exportGameRules(gtid);
      const trainerClient = require('./ai/trainer-client');
      const data = await trainerClient.downloadRules(gtid);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="rules-${gtid}.json"`);
      return res.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
    // Local: re-export then serve file.
    await exportGameRules(gtid);
    const filePath = rulesPathFor(gtid);
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return res.status(404).send({ message: 'rules.json not found after export — check game type has pieces' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="rules-${gtid}.json"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Download rules error:', err);
    res.status(500).send({ message: err.message || 'Download rules failed' });
  }
});

// Upload a rules.json file to create a training-only game type.
// This allows local training data to be uploaded for game configs that don't
// live in this database instance (e.g. training locally for a remote site).
//
// Body: multipart/form-data with:
//   rules        — the rules.json file
//   display_name — optional human-readable name (default: "Imported #<id>")
//
// Creates a minimal game_types row with is_training_only = 1, is_draft = 0.
// Writes the uploaded rules.json to ai-training/<id>/rules.json directly
// (bypasses exportGameRules — the uploaded file IS the canonical rules).
// Returns { gameTypeId, gameName }.
app.post('/api/admin/ai-training/upload-rules', authenticateAdmin1, async (req, res) => {
  try {
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    upload.single('rules')(req, res, async (multerErr) => {
      try {
        if (multerErr) {
          return res.status(400).send({ message: multerErr.message || 'File upload failed' });
        }
        if (!req.file) {
          return res.status(400).send({ message: 'No rules file provided' });
        }

        // Parse to validate it is valid JSON.
        let rulesData;
        try {
          rulesData = JSON.parse(req.file.buffer.toString('utf8'));
        } catch (_) {
          return res.status(400).send({ message: 'Uploaded file is not valid JSON' });
        }

        const displayName = (typeof req.body?.display_name === 'string' && req.body.display_name.trim())
          ? req.body.display_name.trim().slice(0, 100)
          : null;

        // Read board dimensions from rules if available; fall back to defaults.
        const boardWidth  = Number(rulesData?.game_type?.board_width)  || 8;
        const boardHeight = Number(rulesData?.game_type?.board_height) || 8;
        const userId = req.user?.id || null;

        // Insert a minimal game_types row.
        const tmpName = displayName || `Imported game (pending)`;
        const [insertRes] = await db_pool.query(
          `INSERT INTO game_types
             (game_name, creator_id, is_draft, is_training_only,
              board_width, board_height, player_count, created_at)
           VALUES (?, ?, 0, 1, ?, ?, 2, NOW())`,
          [tmpName, userId, boardWidth, boardHeight],
        );
        const newGtid = insertRes.insertId;
        const gameName = displayName || `Imported #${newGtid}`;
        // Update name to include the ID if it was auto-generated.
        if (!displayName) {
          await db_pool.query(`UPDATE game_types SET game_name = ? WHERE id = ?`, [gameName, newGtid]);
        }

        // Write the rules.json to ai-training/<id>/rules.json.
        const fs = require('fs');
        const path = require('path');
        const { trainingDirFor } = require('./ai/export-game-rules');
        const gtDir = trainingDirFor(newGtid);
        fs.mkdirSync(gtDir, { recursive: true });
        fs.writeFileSync(path.join(gtDir, 'rules.json'), req.file.buffer);

        return res.json({ gameTypeId: newGtid, gameName });
      } catch (innerErr) {
        console.error('Upload rules inner error:', innerErr);
        return res.status(500).send({ message: innerErr.message || 'Upload rules failed' });
      }
    });
  } catch (err) {
    console.error('Upload rules error:', err);
    res.status(500).send({ message: err.message || 'Upload rules failed' });
  }
});

// Bulk wipe: delete ALL training jobs (and their on-disk data) for every
// game type, or for a single game type when `gameTypeId` is supplied in
// the request body. Running jobs are refused — caller must stop them first.
//
// This is a destructive nuclear option — admin must pass `confirm: true`
// in the request body to prevent accidental invocations.
app.delete('/api/admin/ai-training/wipe', authenticateAdmin1, async (req, res) => {
  try {
    const { gameTypeId, confirm: confirmed } = req.body || {};
    if (!confirmed) {
      return res.status(400).send({ message: 'Pass { confirm: true } in the body to confirm this destructive operation.' });
    }

    const fs = require('fs');
    const path = require('path');
    const { trainingDirFor, exportGameRules: _export } = require('./ai/export-game-rules');
    const _trainingAnalysis = require('./ai/training-analysis');

    // Find the jobs to wipe.
    let jobRows;
    if (gameTypeId) {
      const gtid = parseInt(gameTypeId, 10);
      if (!Number.isFinite(gtid) || gtid <= 0) {
        return res.status(400).send({ message: 'Invalid gameTypeId' });
      }
      const [rows] = await db_pool.query(
        `SELECT id, game_type_id, status FROM ai_training_jobs WHERE game_type_id = ?`,
        [gtid],
      );
      jobRows = rows;
    } else {
      const [rows] = await db_pool.query(
        `SELECT id, game_type_id, status FROM ai_training_jobs`,
      );
      jobRows = rows;
    }

    // Refuse if any are running/queued.
    const active = jobRows.filter((j) => j.status === 'running' || j.status === 'queued');
    if (active.length > 0) {
      return res.status(400).send({
        message: `Cannot wipe — ${active.length} job(s) are still running or queued. Stop them first.`,
        activeIds: active.map((j) => j.id),
      });
    }

    // Collect affected game types and delete DB rows.
    let deletedJobs = 0;
    let deletedDirs = 0;
    const affectedGameTypes = new Set();
    for (const job of jobRows) {
      affectedGameTypes.add(job.game_type_id);
      deletedJobs++;
    }
    if (jobRows.length > 0) {
      const ids = jobRows.map((j) => j.id);
      const placeholders = ids.map(() => '?').join(',');
      await db_pool.query(`DELETE FROM ai_training_jobs WHERE id IN (${placeholders})`, ids);
    }

    // Delete on-disk training data. In REMOTE_MODE the files live on the
    // trainer-service host, so proxy the deletion via the trainer client.
    const gameTypeIdList = Array.from(affectedGameTypes);
    if (trainingManager.REMOTE_MODE) {
      try {
        const trainerClient = require('./ai/trainer-client');
        const result = await trainerClient.wipeGameTypes(gameTypeIdList);
        deletedDirs = result?.deletedDirs ?? gameTypeIdList.length;
      } catch (remoteErr) {
        console.warn('Remote wipe disk cleanup failed (non-fatal):', remoteErr.message);
      }
    } else {
      // Local mode: delete job dirs and rules.json directly.
      for (const gtid of affectedGameTypes) {
        const jobsDir = path.join(trainingDirFor(gtid), 'jobs');
        if (fs.existsSync(jobsDir)) {
          fs.rmSync(jobsDir, { recursive: true, force: true });
          deletedDirs++;
        }
        // Also clear the cached rules.json so the next job re-exports fresh.
        const { rulesPathFor } = require('./ai/export-game-rules');
        const rp = rulesPathFor(gtid);
        if (fs.existsSync(rp)) { try { fs.unlinkSync(rp); } catch (_) {} }
      }
    }

    // Also delete analysis rows for each affected game type.
    for (const gtid of affectedGameTypes) {
      try {
        await _trainingAnalysis.deleteAnalysis(gtid);
      } catch (_) { /* non-fatal */ }
      try {
        trainingManager._invalidateModelMetaCache?.(gtid);
      } catch (_) { /* non-fatal */ }
    }

    res.json({
      ok: true,
      deletedJobs,
      deletedDirs,
      affectedGameTypes: Array.from(affectedGameTypes),
    });
  } catch (err) {
    console.error('Wipe AI training data error:', err);
    res.status(500).send({ message: err.message || 'Wipe failed' });
  }
});

// Return the most recent Rust AI engine stderr errors (in-memory ring buffer,
// max 50 entries, newest first). Useful for diagnosing stuck or crashing jobs.
app.get('/api/admin/ai-engine/errors', authenticateAdmin1, (req, res) => {
  res.json({ errors: trainingManager.getRecentAiErrors() });
});

// SNS / Lambda webhook for CloudWatch-driven auto-pause when the
// frontend EC2 instance's CPUCreditBalance drops below threshold.
// Authenticated via shared-secret header `X-Trainer-Token` so a Lambda
// function with the secret in env can call it without an admin JWT.
//
// Body: { paused: bool, reason?: string }
app.post('/api/admin/ai-training/auto-pause', (req, res) => {
  const provided = req.headers['x-trainer-token'] || '';
  const secret = process.env.TRAINER_SHARED_SECRET || '';
  if (!secret || provided !== secret) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const desired = !!(req.body && req.body.paused);
  if (desired) {
    trainingManager.pauseNewJobs(req.body?.reason || 'auto-paused: low CPU credits');
  } else {
    trainingManager.resumeNewJobs();
  }
  res.json(trainingManager.isNewJobsPaused());
});

// Upload externally-trained AI artifacts (raw book.jsonl OR a zip of a
// completed job dir). On REMOTE_MODE the file is streamed to the
// trainer-service on the frontend EC2; otherwise it's imported locally.
//
// Form field `artifact` (multer single-file). Query/body field `gameTypeId`
// is required. `kind` is auto-detected from the filename (".jsonl" or
// ".zip") but can be overridden.
const artifactUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB matches trainer-service raw limit
});
app.post(
  '/api/admin/ai-training/upload-artifacts',
  authenticateAdmin,
  multerWrap(artifactUpload.single('artifact'), '500 MB'),
  async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).send({ message: 'Missing file (form field "artifact")' });
      }
      const gameTypeId = parseInt(req.body?.gameTypeId || req.query?.gameTypeId, 10);
      if (!Number.isFinite(gameTypeId) || gameTypeId <= 0) {
        return res.status(400).send({ message: 'gameTypeId is required' });
      }
      const lower = (req.file.originalname || '').toLowerCase();
      let kind = (req.body?.kind || req.query?.kind || '').toLowerCase();
      if (!kind) {
        if (lower.endsWith('.jsonl')) kind = 'jsonl';
        else if (lower.endsWith('.zip')) kind = 'zip';
      }
      if (kind !== 'jsonl' && kind !== 'zip') {
        return res.status(400).send({
          message: 'Could not determine upload kind. Use a .jsonl or .zip file.',
        });
      }
      const userId = req.user?.id || null;

      let result;
      if (trainingManager.REMOTE_MODE) {
        const trainerClient = require('./ai/trainer-client');
        result = await trainerClient.uploadArtifact({
          gameTypeId, kind, buffer: req.file.buffer, userId,
        });
      } else {
        const { importUpload } = require('./ai/artifact-uploader');
        result = await importUpload(
          gameTypeId,
          { kind, buffer: req.file.buffer },
          { userId },
        );
      }
      res.json(result);
    } catch (err) {
      console.error('AI artifact upload error:', err);
      res.status(400).send({ message: err.message || 'Failed to import artifacts' });
    }
  },
);

// ----------------------- AI Training Analysis ----------------------------
//
// Analysis routes:
//   POST   /api/admin/ai-training/analysis/:gameTypeId/regenerate  (admin)
//   PUT    /api/admin/ai-training/analysis/:gameTypeId/visibility  (admin)
//   GET    /api/ai-training/analysis/:gameTypeId                   (visibility-aware)
//   GET    /api/ai-training/analysis/by-slug/:slug                 (public)
//   GET    /api/admin/ai-training/trained-game-types               (admin) — game type IDs that have any training data
//
// Visibility values:
//   private  — only admins/owner can view
//   creator  — game creator and admins/owner can view
//   public   — anyone (including unauthenticated) can view via slug

const trainingAnalysis = require('./ai/training-analysis');

// Return the set of game_type_ids that have at least one completed/uploaded training job.
// Used by the admin UI to filter the analysis dropdown to only games with actual data.
app.get('/api/admin/ai-training/trained-game-types', authenticateAdmin1, async (req, res) => {
  try {
    const [rows] = await db_pool.query(
      `SELECT DISTINCT game_type_id FROM ai_training_jobs
       WHERE games_played > 0
       ORDER BY game_type_id`
    );
    res.json({ gameTypeIds: rows.map(r => r.game_type_id) });
  } catch (err) {
    console.error('Trained game types error:', err);
    res.status(500).send({ message: 'Failed to load trained game types' });
  }
});

app.post(
  '/api/admin/ai-training/analysis/:gameTypeId/regenerate',
  authenticateAdmin,
  async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      if (!Number.isFinite(gameTypeId)) {
        return res.status(400).send({ message: 'Invalid gameTypeId' });
      }
      const filterLegacy = req.query.filterLegacy !== 'false' && req.body?.filterLegacy !== false;
      const stored = await trainingAnalysis.regenerateAndStore(gameTypeId, req.user?.id || null, { filterLegacy });
      res.json(stored);
    } catch (err) {
      console.error('AI analysis regenerate error:', err);
      res.status(500).send({ message: err.message || 'Failed to regenerate analysis' });
    }
  },
);

app.put(
  '/api/admin/ai-training/analysis/:gameTypeId/visibility',
  authenticateAdmin,
  async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const visibility = String(req.body?.visibility || '').toLowerCase();
      if (!Number.isFinite(gameTypeId)) {
        return res.status(400).send({ message: 'Invalid gameTypeId' });
      }
      const stored = await trainingAnalysis.setVisibility(gameTypeId, visibility);
      res.json(stored);
    } catch (err) {
      console.error('AI analysis visibility error:', err);
      res.status(400).send({ message: err.message || 'Failed to update visibility' });
    }
  },
);

// Lightweight existence + visibility probe used by the game detail page so
// it can decide whether to show the "View AI analysis" link without
// pulling the full summary_json LONGTEXT (and parsing it) on every page
// load. Returns 200 { exists: true, visibility, slug } when an analysis
// exists AND the caller can see it; 404 otherwise.
app.get(
  '/api/ai-training/analysis/:gameTypeId/exists',
  optionalAuthenticate,
  async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      if (!Number.isFinite(gameTypeId)) {
        return res.status(400).send({ message: 'Invalid gameTypeId' });
      }
      const meta = await trainingAnalysis.getAnalysisExistence(gameTypeId);
      if (!meta) return res.status(404).send({ exists: false });

      const isAdmin = req.user?.role === 'admin' || req.user?.role === 'owner';
      let allowed = false;
      if (meta.visibility === 'public') allowed = true;
      else if (isAdmin) allowed = true;
      else if (meta.visibility === 'creator' && req.user?.id) {
        const [[gt]] = await db_pool.query(
          'SELECT creator_id FROM game_types WHERE id = ? LIMIT 1',
          [gameTypeId],
        );
        if (gt && gt.creator_id === req.user.id) allowed = true;
      }
      if (!allowed) return res.status(404).send({ exists: false });
      res.json({ exists: true, visibility: meta.visibility, slug: meta.slug });
    } catch (err) {
      console.error('AI analysis exists probe error:', err);
      res.status(500).send({ message: err.message || 'Probe failed' });
    }
  },
);

app.get(
  '/api/ai-training/analysis/:gameTypeId',
  optionalAuthenticate,
  async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      if (!Number.isFinite(gameTypeId)) {
        return res.status(400).send({ message: 'Invalid gameTypeId' });
      }
      const stored = await trainingAnalysis.getStoredAnalysis(gameTypeId);
      if (!stored) return res.status(404).send({ message: 'No analysis published yet' });

      const isAdmin = req.user?.role === 'admin' || req.user?.role === 'owner';
      let allowed = false;
      if (stored.visibility === 'public') allowed = true;
      else if (isAdmin) allowed = true;
      else if (stored.visibility === 'creator' && req.user?.id) {
        const [[gt]] = await db_pool.query(
          'SELECT creator_id FROM game_types WHERE id = ? LIMIT 1',
          [gameTypeId],
        );
        if (gt && gt.creator_id === req.user.id) allowed = true;
      }
      if (!allowed) return res.status(403).send({ message: 'Not visible to you' });
      res.json(stored);
    } catch (err) {
      console.error('AI analysis fetch error:', err);
      res.status(500).send({ message: err.message || 'Failed to load analysis' });
    }
  },
);

app.get('/api/ai-training/analysis/by-slug/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').slice(0, 40);
    if (!slug) return res.status(400).send({ message: 'Missing slug' });
    const stored = await trainingAnalysis.getAnalysisBySlug(slug);
    if (!stored) return res.status(404).send({ message: 'Not found' });
    res.json(stored);
  } catch (err) {
    console.error('AI analysis slug fetch error:', err);
    res.status(500).send({ message: err.message || 'Failed to load analysis' });
  }
});

// POST /api/game-types/:id/request-analysis  (must be logged in + creator or admin)
// Sends a notification to the site owner requesting AI analysis for the game.
// If the requester is already an admin/owner the notification is still sent so
// there is a record of the request (and the admin can immediately act on it).
app.post('/api/game-types/:id/request-analysis', authenticateToken, async (req, res) => {
  try {
    const gameTypeId = parseInt(req.params.id, 10);
    if (!Number.isFinite(gameTypeId)) return res.status(400).send({ message: 'Invalid game id' });

    const [[gameType]] = await db_pool.query(
      'SELECT id, game_name, creator_id FROM game_types WHERE id = ? LIMIT 1',
      [gameTypeId]
    );
    if (!gameType) return res.status(404).send({ message: 'Game not found' });

    const requester = req.user;
    const role = (requester.role || '').toLowerCase();
    const isCreator = Number(gameType.creator_id) === Number(requester.id);
    if (!isCreator && role !== 'admin' && role !== 'owner') {
      return res.status(403).send({ message: 'Only the game creator or an admin can request AI analysis' });
    }

    // Find the owner account to notify
    const [[owner]] = await db_pool.query(
      "SELECT id, username FROM users WHERE role = 'owner' LIMIT 1"
    );
    if (!owner) return res.status(404).send({ message: 'No owner account found' });

    // Persistent record in ai_analysis_requests so the admin dashboard can
    // show the full request history independently of the notifications table
    // (which expires read items after 30 days). If the same user already has
    // a pending request for this game, increment its counter and bump the
    // updated_at timestamp instead of creating a duplicate row.
    try {
      const [[existingReq]] = await db_pool.query(
        `SELECT id FROM ai_analysis_requests
           WHERE game_type_id = ? AND requester_user_id = ? AND status = 'pending'
           ORDER BY id DESC LIMIT 1`,
        [gameTypeId, requester.id]
      );
      if (existingReq) {
        await db_pool.query(
          `UPDATE ai_analysis_requests
             SET request_count = request_count + 1,
                 requester_username = ?
           WHERE id = ?`,
          [requester.username, existingReq.id]
        );
      } else {
        await db_pool.query(
          `INSERT INTO ai_analysis_requests
             (game_type_id, requester_user_id, requester_username, status)
           VALUES (?, ?, ?, 'pending')`,
          [gameTypeId, requester.id, requester.username]
        );
      }
    } catch (logErr) {
      // Don't fail the request if the log write fails — the notification path
      // below still gives the owner visibility.
      console.error('ai_analysis_requests log write failed:', logErr.message);
    }

    // Deduplicate: if an unread request for this game already exists, bump it
    const existing = await dbHelpers.findUnreadNotification(owner.id, 'ai_analysis_request', gameTypeId);
    if (existing) {
      await dbHelpers.updateNotification(existing.id, {
        sender_id: requester.id,
        title: `AI analysis requested for "${gameType.game_name}"`,
        content: `${requester.username} (re-)requested AI analysis training for game #${gameTypeId}.`,
      });
      return res.json({ message: 'Analysis request updated', notificationId: existing.id });
    }

    const notification = await dbHelpers.createNotification({
      user_id: owner.id,
      sender_id: requester.id,
      type: 'ai_analysis_request',
      title: `AI analysis requested for "${gameType.game_name}"`,
      content: `${requester.username} requested AI analysis training for game #${gameTypeId} — "${gameType.game_name}".`,
      related_id: gameTypeId,
      action_url: `/admin/dashboard?tab=ai-analysis-requests&gameTypeId=${gameTypeId}`,
    });

    // Real-time push if owner is online
    const io = app.get('io');
    if (io) {
      const { userSockets } = require('./game-socket');
      const ownerSocket = userSockets?.get(owner.id);
      if (ownerSocket) {
        io.to(ownerSocket).emit('newNotification', { ...notification, sender_username: requester.username });
      }
    }

    res.json({ message: 'Analysis request sent', notificationId: notification.id });
  } catch (err) {
    console.error('Request AI analysis error:', err);
    res.status(500).send({ message: 'Failed to send analysis request' });
  }
});

// ----------------------- AI Analysis Requests (Admin) ------------------
//
// Persistent log of every AI analysis request a creator makes. Admins
// review, mark fulfilled, or delete entries. Notifications expire after
// 30/90 days; this table never auto-expires.
//
//   GET    /api/admin/ai-analysis-requests?status=&page=&limit=
//   PATCH  /api/admin/ai-analysis-requests/:id   { status, notes }
//   DELETE /api/admin/ai-analysis-requests/:id

app.get('/api/admin/ai-analysis-requests', authenticateAdmin, async (req, res) => {
  try {
    const status = (req.query.status || '').toString();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    if (['pending', 'fulfilled', 'dismissed'].includes(status)) {
      where.push('aar.status = ?');
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[countRow]] = await db_pool.query(
      `SELECT COUNT(*) AS total FROM ai_analysis_requests aar ${whereSql}`,
      params
    );
    const total = countRow?.total || 0;

    const [rows] = await db_pool.query(
      `SELECT aar.*,
              gt.game_name,
              gt.creator_id AS game_creator_id,
              ru.username   AS requester_current_username,
              ru.profile_picture AS requester_profile_picture,
              fu.username   AS fulfilled_by_username
         FROM ai_analysis_requests aar
         LEFT JOIN game_types gt ON gt.id = aar.game_type_id
         LEFT JOIN users ru      ON ru.id = aar.requester_user_id
         LEFT JOIN users fu      ON fu.id = aar.fulfilled_by_user_id
         ${whereSql}
        ORDER BY
          CASE aar.status WHEN 'pending' THEN 0 WHEN 'fulfilled' THEN 1 ELSE 2 END,
          aar.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('List ai_analysis_requests error:', err);
    res.status(500).send({ message: 'Failed to load analysis requests' });
  }
});

app.patch('/api/admin/ai-analysis-requests/:id', authenticateAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid id' });

    const updates = [];
    const params = [];
    if (req.body?.status && ['pending', 'fulfilled', 'dismissed'].includes(req.body.status)) {
      updates.push('status = ?');
      params.push(req.body.status);
      if (req.body.status === 'fulfilled') {
        updates.push('fulfilled_at = NOW()');
        updates.push('fulfilled_by_user_id = ?');
        params.push(req.user?.id || null);
      } else if (req.body.status === 'pending') {
        updates.push('fulfilled_at = NULL');
        updates.push('fulfilled_by_user_id = NULL');
      }
    }
    if (typeof req.body?.notes === 'string') {
      updates.push('notes = ?');
      params.push(req.body.notes.slice(0, 2000));
    }
    if (updates.length === 0) {
      return res.status(400).send({ message: 'No valid fields to update' });
    }
    params.push(id);
    await db_pool.query(
      `UPDATE ai_analysis_requests SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update ai_analysis_request error:', err);
    res.status(500).send({ message: 'Failed to update analysis request' });
  }
});

app.delete('/api/admin/ai-analysis-requests/:id', authenticateAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid id' });
    await db_pool.query('DELETE FROM ai_analysis_requests WHERE id = ?', [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete ai_analysis_request error:', err);
    res.status(500).send({ message: 'Failed to delete analysis request' });
  }
});

// ----------------------- Announcements ------------------------------
//
// Announcements are one-shot site-wide updates. POSTing one (admin only)
// inserts an `announcements` row AND fans out a `type='announcement'`
// notification to every user, with a real-time socket emit to anyone
// online.
//
//   POST   /api/announcements                  (admin) — create + fan out
//   GET    /api/announcements?page=&limit=     (public, paginated)
//   GET    /api/announcements/:id              (public)
//   DELETE /api/announcements/:id              (admin)

app.post('/api/announcements', authenticateAdmin, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 200);
    const content = String(req.body?.content || '').trim().slice(0, 5000);
    if (!title || !content) {
      return res.status(400).send({ message: 'title and content are required' });
    }
    const [insert] = await db_pool.query(
      `INSERT INTO announcements (title, content, action_url, author_id)
       VALUES (?, ?, ?, ?)`,
      [title, content, null, req.user?.id || null],
    );
    const announcementId = insert.insertId;
    // All announcement notifications now link to the announcement detail page.
    // Use renderContent on the client to surface any inline gridgrove links inside the body.
    const linkUrl = `/announcements/${announcementId}`;

    // Fan out: insert one notification per user. Chunk to keep the
    // single statement size bounded on large user bases.
    const [users] = await db_pool.query('SELECT id FROM users WHERE banned = 0 OR banned IS NULL');
    const CHUNK = 1000;
    let totalInserted = 0;
    for (let i = 0; i < users.length; i += CHUNK) {
      const slice = users.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const values = slice.flatMap((u) => [
        u.id, req.user?.id || null, 'announcement', title,
        content,
        announcementId, linkUrl,
      ]);
      const placeholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
      await db_pool.query(
        `INSERT INTO notifications
           (user_id, sender_id, type, title, content, related_id, action_url)
         VALUES ${placeholders}`,
        values,
      );
      totalInserted += slice.length;
    }

    // Real-time push to anyone online.
    const io = app.get('io');
    if (io) {
      try {
        const { userSockets } = require('./game-socket');
        if (userSockets) {
          for (const u of users) {
            const socketId = userSockets.get(u.id);
            if (socketId) {
              io.to(socketId).emit('newNotification', {
                type: 'announcement',
                title,
                content,
                related_id: announcementId,
                action_url: linkUrl,
                created_at: new Date().toISOString(),
              });
            }
          }
        }
      } catch (e) { /* non-fatal */ }
    }

    res.status(201).json({
      announcement: {
        id: announcementId, title, content, action_url: linkUrl,
        author_id: req.user?.id || null,
      },
      notificationsCreated: totalInserted,
    });
  } catch (err) {
    console.error('Announcement create error:', err);
    res.status(500).send({ message: err.message || 'Failed to create announcement' });
  }
});

app.get('/api/announcements', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await db_pool.query(
      'SELECT COUNT(*) AS total FROM announcements',
    );
    const [rows] = await db_pool.query(
      `SELECT a.id, a.title, a.content, a.action_url, a.created_at,
              a.author_id, u.username AS author_username
         FROM announcements a
         LEFT JOIN users u ON u.id = a.author_id
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    res.json({
      announcements: rows,
      page, limit, total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('Announcements list error:', err);
    res.status(500).send({ message: 'Failed to load announcements' });
  }
});

app.get('/api/announcements/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid id' });
    const [rows] = await db_pool.query(
      `SELECT a.id, a.title, a.content, a.action_url, a.created_at,
              a.author_id, u.username AS author_username
         FROM announcements a
         LEFT JOIN users u ON u.id = a.author_id
        WHERE a.id = ? LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return res.status(404).send({ message: 'Not found' });
    res.json({ announcement: rows[0] });
  } catch (err) {
    console.error('Announcement fetch error:', err);
    res.status(500).send({ message: 'Failed to load announcement' });
  }
});

app.put('/api/announcements/:id', authenticateAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid id' });
    const title = String(req.body?.title || '').trim().slice(0, 200);
    const content = String(req.body?.content || '').trim().slice(0, 5000);
    if (!title || !content) {
      return res.status(400).send({ message: 'title and content are required' });
    }
    const [[existing]] = await db_pool.query('SELECT id FROM announcements WHERE id = ?', [id]);
    if (!existing) return res.status(404).send({ message: 'Announcement not found' });
    // Custom action_url has been removed; force it back to the canonical detail page link.
    const actionUrl = `/announcements/${id}`;
    await db_pool.query(
      'UPDATE announcements SET title = ?, content = ?, action_url = ? WHERE id = ?',
      [title, content, actionUrl, id],
    );
    // Keep the fanned-out notifications in sync with the edited announcement.
    await db_pool.query(
      `UPDATE notifications SET title = ?, content = ?, action_url = ? WHERE type = 'announcement' AND related_id = ?`,
      [title, content, actionUrl, id],
    );
    res.json({ message: 'Announcement updated' });
  } catch (err) {
    console.error('Announcement update error:', err);
    res.status(500).send({ message: err.message || 'Failed to update announcement' });
  }
});

app.delete('/api/announcements/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).send({ message: 'Only the site owner can delete announcements' });
  }
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send({ message: 'Invalid id' });
    await db_pool.query(
      'DELETE FROM notifications WHERE type = ? AND related_id = ?',
      ['announcement', id],
    );
    const [r] = await db_pool.query('DELETE FROM announcements WHERE id = ?', [id]);
    res.json({ deleted: r.affectedRows });
  } catch (err) {
    console.error('Announcement delete error:', err);
    res.status(500).send({ message: 'Failed to delete announcement' });
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

// Requires Admin 1 (full admin) or owner — Admin 2 is blocked.
function authenticateAdmin1(req, res, next) {
  authenticateToken(req, res, () => {
    const role = req.user.role;
    if (role !== 'owner' && (role !== 'admin' || req.user.admin_level === 2)) {
      return res.status(403).send({ message: "Admin level 1 or owner access required" });
    }
    next();
  });
}

/**
 * Check if requester can moderate content created by a target user.
 * Owner can moderate anyone. Admin can moderate non-admin/non-owner users.
 * @param {string} requesterRole - Role of the user performing the action
 * @param {string} targetRole - Role of the user whose content is being acted upon
 * @returns {boolean}
 */
function canModerate(requesterRole, targetRole) {
  const rRole = (requesterRole || '').toLowerCase();
  const tRole = (targetRole || '').toLowerCase();
  if (rRole === 'owner') return true;
  if (rRole === 'admin' && tRole !== 'admin' && tRole !== 'owner') return true;
  return false;
}

/**
 * Clamp `rangeBonus` values inside the range_squares JSON to the valid
 * 1..MAX_RANGE_BONUS window. Frontend already validates, but we re-validate
 * here so a hand-crafted POST cannot bypass the cap.
 * Accepts the raw JSON string from the wizard and returns the (possibly
 * rewritten) JSON string. Returns the input unchanged on parse failure.
 */
const MAX_RANGE_BONUS = 8;
function sanitizeRangeSquaresJSON(raw) {
  if (!raw || typeof raw !== 'string') return raw || null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return raw;
    let dirty = false;
    for (const key of Object.keys(parsed)) {
      const sq = parsed[key];
      if (sq && typeof sq === 'object') {
        const b = Number(sq.rangeBonus);
        const clamped = Number.isFinite(b) ? Math.min(MAX_RANGE_BONUS, Math.max(1, Math.floor(b))) : 1;
        if (clamped !== sq.rangeBonus) { sq.rangeBonus = clamped; dirty = true; }
      }
    }
    return dirty ? JSON.stringify(parsed) : raw;
  } catch { return raw; }
}

/**
 * Same idea but for the special_squares JSON which holds custom squares
 * that may carry their own rangeBonus inside { asRange, rangeBonus, ... }.
 */
function sanitizeSpecialSquaresJSON(raw) {
  if (!raw || typeof raw !== 'string') return raw || null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return raw;
    let dirty = false;
    for (const key of Object.keys(parsed)) {
      const sq = parsed[key];
      if (sq && typeof sq === 'object' && (sq.asRange || sq.rangeBonus != null)) {
        const b = Number(sq.rangeBonus);
        const clamped = Number.isFinite(b) ? Math.min(MAX_RANGE_BONUS, Math.max(1, Math.floor(b))) : 1;
        if (clamped !== sq.rangeBonus) { sq.rangeBonus = clamped; dirty = true; }
      }
    }
    return dirty ? JSON.stringify(parsed) : raw;
  } catch { return raw; }
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
       p.creator_id, p.image_location, p.is_anonymous_creator,
       u.username as real_creator_name,
       CASE 
         WHEN p.creator_id IS NULL THEN 'Anonymous (not logged in)'
         WHEN p.is_anonymous_creator = 1 THEN CONCAT(u.username, ' (Anonymous)')
         ELSE u.username 
       END as creator_name,
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
    // When `includeTrainingOnly=true`, include game types created by uploading
    // a rules.json (is_training_only = 1). These are hidden from the regular
    // admin game list but the AI training panel needs to see them for job setup.
    const includeTrainingOnly = req.query.includeTrainingOnly === 'true';

    const trainingFilter = includeTrainingOnly ? '' : 'AND COALESCE(g.is_training_only, 0) = 0';

    const [games] = await db_pool.query(
      `SELECT g.id, g.game_name, g.descript, g.board_width, g.board_height, 
       g.player_count, g.last_played_at, g.is_anonymous_creator, g.is_training_only,
       u.username as real_creator_name,
       CASE 
         WHEN g.creator_id IS NULL THEN 'Anonymous (not logged in)'
         WHEN g.is_anonymous_creator = 1 THEN CONCAT(u.username, ' (Anonymous)')
         ELSE u.username 
       END as creator_name,
       (SELECT COUNT(*) FROM games gm WHERE gm.game_type_id = g.id) as play_count
       FROM game_types g
       LEFT JOIN users u ON g.creator_id = u.id
       WHERE COALESCE(g.is_draft, 0) = 0 ${trainingFilter}
       ORDER BY g.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query(
      `SELECT COUNT(*) as total FROM game_types WHERE COALESCE(is_draft, 0) = 0 ${trainingFilter}`
    );

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

// List unfinished game drafts (game_types rows with is_draft = 1) for admin review.
app.get("/api/admin/drafts", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [drafts] = await db_pool.query(
      `SELECT g.id, g.game_name, g.descript, g.board_width, g.board_height,
       g.player_count, g.draft_saved_step, g.created_at, g.updated_at,
       g.creator_id,
       u.username as creator_name
       FROM game_types g
       LEFT JOIN users u ON g.creator_id = u.id
       WHERE g.is_draft = 1
       ORDER BY g.updated_at DESC, g.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query(
      "SELECT COUNT(*) as total FROM game_types WHERE is_draft = 1"
    );

    res.json({
      data: drafts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error("Error in /api/admin/drafts:", err);
    res.status(500).send({ message: "Failed to fetch drafts", err: err.message });
  }
});

// Fetch a single draft (full game_types row) for admin inspection.
app.get("/api/admin/drafts/:draftId", authenticateAdmin, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    if (!draftId) return res.status(400).send({ message: "Invalid draft id" });
    const [rows] = await db_pool.query(
      `SELECT g.*, u.username as creator_name
       FROM game_types g
       LEFT JOIN users u ON g.creator_id = u.id
       WHERE g.id = ? AND g.is_draft = 1`,
      [draftId]
    );
    if (rows.length === 0) return res.status(404).send({ message: "Draft not found" });
    res.json({ data: rows[0] });
  } catch (err) {
    console.error("Error fetching draft:", err);
    res.status(500).send({ message: "Failed to fetch draft", err: err.message });
  }
});

// Delete a draft. Only deletes rows still flagged is_draft=1 to avoid wiping
// out a published game by mistake.
app.delete("/api/admin/drafts/:draftId", authenticateAdmin, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    if (!draftId) return res.status(400).send({ message: "Invalid draft id" });
    const [result] = await db_pool.query(
      "DELETE FROM game_types WHERE id = ? AND is_draft = 1",
      [draftId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send({ message: "Draft not found or already published" });
    }
    console.log(`Admin ${req.user.id} deleted draft ${draftId}`);
    res.json({ message: "Draft deleted successfully" });
  } catch (err) {
    console.error("Error deleting draft:", err);
    res.status(500).send({ message: "Failed to delete draft", err: err.message });
  }
});

// ----------------------- Initial Position Validation (admin) ------------------------

// Run a fresh scan of every published game type and store / clear the
// `initial_state_warning` column based on the validator result. Returns a
// summary so the admin UI can show progress.
app.post("/api/admin/initial-state/scan", authenticateAdmin, async (req, res) => {
  try {
    const [rows] = await db_pool.query(
      "SELECT id FROM game_types WHERE (is_draft = 0 OR is_draft IS NULL) ORDER BY id ASC"
    );
    let scanned = 0;
    let flagged = 0;
    let cleared = 0;
    let errored = 0;
    const flaggedItems = [];
    for (const { id } of rows) {
      try {
        const result = await initialStateValidator.validateGameTypeInitialState(id);
        scanned++;
        if (result && result.decided) {
          flagged++;
          await initialStateValidator.writeInitialStateWarning(id, result.reason || 'Starting position is already in a decided state.');
          flaggedItems.push({ id, reason: result.reason, type: result.type, code: result.code });
        } else {
          await initialStateValidator.writeInitialStateWarning(id, null);
          cleared++;
        }
      } catch (err) {
        errored++;
        console.error(`[admin-scan] Game type ${id} failed:`, err.message);
      }
    }
    console.log(`Admin ${req.user.id} ran initial-state scan: ${scanned} scanned, ${flagged} flagged, ${errored} errored.`);
    res.json({ scanned, flagged, cleared, errored, flaggedItems });
  } catch (err) {
    console.error("Error in /api/admin/initial-state/scan:", err);
    res.status(500).send({ message: "Failed to scan initial states", err: err.message });
  }
});

// List currently flagged game types (those whose `initial_state_warning` is
// non-null). Used by the admin UI to render the report without re-scanning.
app.get("/api/admin/initial-state/flagged", authenticateAdmin, async (req, res) => {
  try {
    const [rows] = await db_pool.query(`
      SELECT gt.id, gt.game_name, gt.creator_id, gt.is_draft,
             gt.initial_state_warning, gt.initial_state_checked_at,
             u.username AS creator_name
        FROM game_types gt
        LEFT JOIN users u ON gt.creator_id = u.id
       WHERE gt.initial_state_warning IS NOT NULL
       ORDER BY gt.initial_state_checked_at DESC, gt.id ASC
    `);
    res.json({ data: rows });
  } catch (err) {
    console.error("Error in /api/admin/initial-state/flagged:", err);
    res.status(500).send({ message: "Failed to load flagged game types", err: err.message });
  }
});

// Clear a single game type's warning manually (e.g. after the creator fixes
// it offline). Useful escape hatch from the admin UI.
app.post("/api/admin/initial-state/:gameTypeId/clear", authenticateAdmin, async (req, res) => {
  try {
    const gameTypeId = parseInt(req.params.gameTypeId);
    if (!gameTypeId) return res.status(400).send({ message: "Invalid game type id" });
    await initialStateValidator.writeInitialStateWarning(gameTypeId, null);
    res.json({ message: "Warning cleared" });
  } catch (err) {
    console.error("Error clearing initial-state warning:", err);
    res.status(500).send({ message: "Failed to clear warning", err: err.message });
  }
});

// User growth stats: returns signup counts grouped by week or month, with cumulative totals.
// GET /api/admin/user-growth?view=daily|weekly|monthly
app.get("/api/admin/user-growth", authenticateAdmin, async (req, res) => {
  try {
    const viewParam = req.query.view;
    const view = viewParam === 'monthly' ? 'monthly' : viewParam === 'daily' ? 'daily' : 'weekly';
    let rows;
    // Use COALESCE so that legacy users without created_at fall back to last_active_at.
    if (view === 'monthly') {
      [rows] = await db_pool.query(
        `SELECT DATE_FORMAT(COALESCE(created_at, last_active_at), '%Y-%m') AS period,
                DATE_FORMAT(MIN(COALESCE(created_at, last_active_at)), '%b %Y') AS label,
                COUNT(*) AS signups
         FROM users
         WHERE COALESCE(created_at, last_active_at) IS NOT NULL
         GROUP BY period
         ORDER BY period ASC`
      );
    } else if (view === 'daily') {
      [rows] = await db_pool.query(
        `SELECT DATE_FORMAT(COALESCE(created_at, last_active_at), '%Y-%m-%d') AS period,
                DATE_FORMAT(MIN(COALESCE(created_at, last_active_at)), '%b %d') AS label,
                COUNT(*) AS signups
         FROM users
         WHERE COALESCE(created_at, last_active_at) IS NOT NULL
           AND COALESCE(created_at, last_active_at) >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         GROUP BY period
         ORDER BY period ASC`
      );
    } else {
      [rows] = await db_pool.query(
        `SELECT YEARWEEK(COALESCE(created_at, last_active_at), 1) AS yw,
                DATE_FORMAT(MIN(COALESCE(created_at, last_active_at)), '%b %d') AS label,
                COUNT(*) AS signups
         FROM users
         WHERE COALESCE(created_at, last_active_at) IS NOT NULL
         GROUP BY yw
         ORDER BY yw ASC`
      );
    }
    // Compute running total
    let running = 0;
    const data = rows.map(r => {
      running += Number(r.signups);
      return { period: r.period || r.yw, label: r.label, signups: Number(r.signups), total: running };
    });
    res.json({ view, data });
  } catch (err) {
    console.error("Error in /api/admin/user-growth:", err);
    res.status(500).send({ message: "Failed to fetch user growth data", err: err.message });
  }
});

// Get anonymous live games for admin tracking
app.get("/api/admin/anonymous-games", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [games] = await db_pool.query(
      `SELECT g.id, g.created_at, g.start_time, g.end_time, g.status, g.invite_code,
       g.turn_length, g.increment, gt.game_name, gt.board_width, gt.board_height,
       COALESCE(JSON_LENGTH(JSON_EXTRACT(g.other_data, '$.moves')), 0) AS move_count,
       COUNT(p.id) AS player_count
       FROM games g
       LEFT JOIN game_types gt ON g.game_type_id = gt.id
       LEFT JOIN players p ON p.game_id = g.id
       WHERE g.is_anonymous = 1
       GROUP BY g.id
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query(
      "SELECT COUNT(*) as total FROM games WHERE is_anonymous = 1"
    );

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
    console.error("Error in /api/admin/anonymous-games:", err);
    res.status(500).send({ message: "Failed to fetch anonymous games", err: err.message });
  }
});

// Admin: list games where the host disabled spectating. Read-only — admins
// cannot spectate these (per host's choice), but should still know they exist.
app.get("/api/admin/private-games", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    const [games] = await db_pool.query(
      `SELECT g.id, g.created_at, g.start_time, g.end_time, g.status,
              g.turn_length, g.increment, g.is_correspondence, g.correspondence_days,
              g.host_id, hu.username AS host_username,
              gt.id AS game_type_id, gt.game_name,
              GROUP_CONCAT(pu.username ORDER BY p.player_position SEPARATOR ', ') AS player_names,
              COALESCE(JSON_LENGTH(JSON_EXTRACT(g.other_data, '$.moves')), 0) AS move_count
       FROM games g
       LEFT JOIN game_types gt ON g.game_type_id = gt.id
       LEFT JOIN users hu ON g.host_id = hu.id
       LEFT JOIN players p ON p.game_id = g.id
       LEFT JOIN users pu ON p.user_id = pu.id
       WHERE g.allow_spectators = 0
         AND g.status IN ('waiting','ready','active')
         AND (g.is_anonymous = 0 OR g.is_anonymous IS NULL)
       GROUP BY g.id
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query(
      `SELECT COUNT(*) as total FROM games
       WHERE allow_spectators = 0
         AND status IN ('waiting','ready','active')
         AND (is_anonymous = 0 OR is_anonymous IS NULL)`
    );

    res.json({
      data: games,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error("Error in /api/admin/private-games:", err);
    res.status(500).send({ message: "Failed to fetch private games", err: err.message });
  }
});

// Get deleted users audit log for admin tracking
app.get("/api/admin/deleted-users", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    const [rows] = await db_pool.query(
      `SELECT du.id, du.original_user_id, du.previous_username, du.deleted_at,
              du.deletion_type, du.deleted_by_user_id, u.username AS deleted_by_username
       FROM deleted_users du
       LEFT JOIN users u ON du.deleted_by_user_id = u.id
       ORDER BY du.deleted_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) AS total FROM deleted_users");

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error("Error in /api/admin/deleted-users:", err);
    res.status(500).send({ message: "Failed to fetch deleted users", err: err.message });
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

// Get all currently online players (admin only)
app.get("/api/admin/online-players", authenticateAdmin, async (req, res) => {
  try {
    // Reconcile against active socket mappings to drop stale entries that
    // never fired a clean disconnect (network drops, closed laptops, etc).
    reconcileOnlineUsers();
    res.set('Cache-Control', 'no-store');
    const onlineIds = Array.from(onlineUsers);
    if (onlineIds.length === 0) {
      return res.json({ data: [], total: 0 });
    }
    const [users] = await db_pool.query(
      `SELECT id, username, role, elo, profile_picture, last_active_at
       FROM users WHERE id IN (?)
       ORDER BY username ASC`,
      [onlineIds]
    );
    res.json({ data: users, total: users.length });
  } catch (err) {
    console.error("Error in /api/admin/online-players:", err);
    res.status(500).send({ message: "Failed to fetch online players", err: err.message });
  }
});

// Get all featured games (admin only)
app.get("/api/admin/featured-games", authenticateAdmin, async (req, res) => {
  try {
    // Get all games with their featured status
    const [allGames] = await db_pool.query(`
      SELECT g.id, g.game_name, g.board_width, g.board_height, g.featured_order,
             u.username as creator_name,
             COUNT(DISTINCT gm.id) as play_count
      FROM game_types g
      LEFT JOIN users u ON g.creator_id = u.id
      LEFT JOIN games gm ON g.id = gm.game_type_id
      GROUP BY g.id
      ORDER BY CASE WHEN g.featured_order IS NOT NULL THEN 0 ELSE 1 END,
               g.featured_order ASC, play_count DESC
      LIMIT 50
    `);

    // Get currently featured games
    const featured = allGames.filter(g => g.featured_order !== null)
                             .sort((a, b) => a.featured_order - b.featured_order);

    res.json({
      featured,
      allGames
    });
  } catch (err) {
    console.error("Error in /api/admin/featured-games:", err);
    res.status(500).send({ message: "Failed to fetch featured games", err: err.message });
  }
});

// Update featured games (admin only)
app.put("/api/admin/featured-games", authenticateAdmin, async (req, res) => {
  try {
    const { featuredGameIds } = req.body; // Array of game IDs in order [slot1, slot2, slot3]
    
    if (!Array.isArray(featuredGameIds)) {
      return res.status(400).send({ message: "featuredGameIds must be an array" });
    }

    // Clear all existing featured_order values
    await db_pool.query(`UPDATE game_types SET featured_order = NULL`);

    // Set new featured games with their order
    for (let i = 0; i < featuredGameIds.length; i++) {
      const gameId = featuredGameIds[i];
      if (gameId) {
        await db_pool.query(
          `UPDATE game_types SET featured_order = ? WHERE id = ?`,
          [i + 1, gameId]
        );
      }
    }

    res.json({ message: "Featured games updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/featured-games (PUT):", err);
    res.status(500).send({ message: "Failed to update featured games", err: err.message });
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

// ----------------------- Streams Routes ------------------------------

// Public: Get all streams (for the /media/streams page)
app.get("/api/streams", async (req, res) => {
  try {
    const [streams] = await db_pool.query(
      `SELECT id, title, streamer_name, description, stream_url, thumbnail_url, 
       category, platform, is_live, is_featured, viewer_count, game_name,
       scheduled_start, scheduled_end, created_at
       FROM streams 
       ORDER BY is_live DESC, is_featured DESC, created_at DESC`
    );
    res.json(streams);
  } catch (err) {
    console.error("Error in /api/streams:", err);
    res.status(500).send({ message: "Failed to fetch streams", err: err.message });
  }
});

// Admin: Get all streams with pagination
app.get("/api/admin/streams", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [streams] = await db_pool.query(
      `SELECT s.*, u.username as created_by_name
       FROM streams s
       LEFT JOIN users u ON s.created_by = u.id
       ORDER BY s.created_at DESC 
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db_pool.query("SELECT COUNT(*) as total FROM streams");

    res.json({
      data: streams,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in /api/admin/streams:", err);
    res.status(500).send({ message: "Failed to fetch streams", err: err.message });
  }
});

// Admin: Create a new stream
app.post("/api/admin/streams", authenticateAdmin, async (req, res) => {
  try {
    const { 
      title, streamer_name, description, stream_url, thumbnail_url,
      category, platform, is_live, is_featured, viewer_count, game_name,
      scheduled_start, scheduled_end
    } = req.body;

    if (!title || !streamer_name || !stream_url) {
      return res.status(400).send({ message: "Title, streamer name, and stream URL are required" });
    }

    const [result] = await db_pool.query(
      `INSERT INTO streams (title, streamer_name, description, stream_url, thumbnail_url,
       category, platform, is_live, is_featured, viewer_count, game_name,
       scheduled_start, scheduled_end, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, streamer_name, description || null, stream_url, thumbnail_url || null,
        category || 'other', platform || 'other', is_live || false, is_featured || false,
        viewer_count || 0, game_name || null, scheduled_start || null, scheduled_end || null,
        req.user.id
      ]
    );

    const [[newStream]] = await db_pool.query("SELECT * FROM streams WHERE id = ?", [result.insertId]);
    res.status(201).json({ success: true, stream: newStream, message: "Stream created successfully" });
  } catch (err) {
    console.error("Error in /api/admin/streams (POST):", err);
    res.status(500).send({ message: "Failed to create stream", err: err.message });
  }
});

// Admin: Update a stream
app.put("/api/admin/streams/:streamId", authenticateAdmin, async (req, res) => {
  try {
    const { streamId } = req.params;
    const updates = req.body;
    
    const allowedFields = [
      'title', 'streamer_name', 'description', 'stream_url', 'thumbnail_url',
      'category', 'platform', 'is_live', 'is_featured', 'viewer_count', 'game_name',
      'scheduled_start', 'scheduled_end'
    ];
    
    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    if (fields.length === 0) {
      return res.status(400).send({ message: "No valid fields to update" });
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => updates[field]);
    values.push(streamId);

    await db_pool.query(`UPDATE streams SET ${setClause} WHERE id = ?`, values);

    const [[updatedStream]] = await db_pool.query("SELECT * FROM streams WHERE id = ?", [streamId]);
    res.json({ success: true, stream: updatedStream, message: "Stream updated successfully" });
  } catch (err) {
    console.error("Error in /api/admin/streams/:streamId (PUT):", err);
    res.status(500).send({ message: "Failed to update stream", err: err.message });
  }
});

// Admin: Delete a stream
app.delete("/api/admin/streams/:streamId", authenticateAdmin, async (req, res) => {
  try {
    const { streamId } = req.params;
    
    const [[stream]] = await db_pool.query("SELECT * FROM streams WHERE id = ?", [streamId]);
    if (!stream) {
      return res.status(404).send({ message: "Stream not found" });
    }

    await db_pool.query("DELETE FROM streams WHERE id = ?", [streamId]);
    res.json({ success: true, message: "Stream deleted successfully" });
  } catch (err) {
    console.error("Error in /api/admin/streams/:streamId (DELETE):", err);
    res.status(500).send({ message: "Failed to delete stream", err: err.message });
  }
});

// Admin: Toggle stream live status
app.post("/api/admin/streams/:streamId/toggle-live", authenticateAdmin, async (req, res) => {
  try {
    const { streamId } = req.params;
    
    const [[stream]] = await db_pool.query("SELECT is_live FROM streams WHERE id = ?", [streamId]);
    if (!stream) {
      return res.status(404).send({ message: "Stream not found" });
    }

    const newLiveStatus = !stream.is_live;
    await db_pool.query("UPDATE streams SET is_live = ? WHERE id = ?", [newLiveStatus, streamId]);
    
    res.json({ success: true, is_live: newLiveStatus, message: `Stream is now ${newLiveStatus ? 'live' : 'offline'}` });
  } catch (err) {
    console.error("Error in /api/admin/streams/:streamId/toggle-live:", err);
    res.status(500).send({ message: "Failed to toggle stream status", err: err.message });
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
              name: 'GridGrove Donation',
              description: 'Support the development of GridGrove',
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

// ----------------------- Notifications ---------------------------

// Get notifications for a user (paginated)
app.get("/api/users/:userId/notifications", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    // cursor = last notification id from previous page; enables O(1) keyset pagination.
    // When cursor is provided, the page param is ignored.
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;
    const notifications = await dbHelpers.getNotificationsByUserId(userId, page, limit, cursor);
    const unreadCount = await dbHelpers.getUnreadNotificationCount(userId);
    // Return nextCursor so the client can load more without OFFSET penalty.
    const nextCursor = notifications.length === limit ? notifications[notifications.length - 1].id : null;
    res.json({ notifications, unreadCount, page, limit, nextCursor });
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Get unread notification count
app.get("/api/users/:userId/notifications/unread-count", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const count = await dbHelpers.getUnreadNotificationCount(userId);
    res.json({ unreadCount: count });
  } catch (err) {
    console.error("Error fetching unread count:", err);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// Mark a single notification as read
app.put("/api/users/:userId/notifications/:notificationId/read", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    await dbHelpers.markNotificationRead(parseInt(req.params.notificationId), userId);
    res.json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("Error marking notification read:", err);
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

// Mark all notifications as read
app.put("/api/users/:userId/notifications/read-all", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    await dbHelpers.markAllNotificationsRead(userId);
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("Error marking all notifications read:", err);
    res.status(500).json({ error: "Failed to mark all notifications read" });
  }
});

// Mark a notification as actioned (e.g., accepted friend request)
app.put("/api/users/:userId/notifications/:notificationId/action", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    await dbHelpers.markNotificationActioned(parseInt(req.params.notificationId), userId);
    res.json({ message: "Notification actioned" });
  } catch (err) {
    console.error("Error actioning notification:", err);
    res.status(500).json({ error: "Failed to action notification" });
  }
});

// Delete a notification
app.delete("/api/users/:userId/notifications/:notificationId", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    await dbHelpers.deleteNotification(parseInt(req.params.notificationId), userId);
    res.json({ message: "Notification deleted" });
  } catch (err) {
    console.error("Error deleting notification:", err);
    res.status(500).json({ error: "Failed to delete notification" });
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

// ===================== DIRECT MESSAGES API =====================

// Search for a user by exact username (for starting new conversations)
app.get("/api/users/search", async (req, res) => {
  try {
    const username = req.query.username;
    if (!username) {
      return res.status(400).json({ error: "username query parameter required" });
    }
    const user = await dbHelpers.findUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user: { id: user.id, username: user.username, profile_picture: user.profile_picture } });
  } catch (err) {
    console.error("Error searching user:", err);
    res.status(500).json({ error: "Failed to search user" });
  }
});

// Look up a user by ID (public, returns minimal info)
app.get("/api/users/search-by-id", async (req, res) => {
  try {
    const id = parseInt(req.query.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "id query parameter required" });
    }
    const user = await dbHelpers.findUserById(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user: { id: user.id, username: user.username, profile_picture: user.profile_picture } });
  } catch (err) {
    console.error("Error searching user by ID:", err);
    res.status(500).json({ error: "Failed to search user" });
  }
});

// Search messageable users: friends first, then non-friends with allow_non_friend_dms
app.get("/api/users/:userId/messageable-users", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const search = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit) || 15, 50);

    // Get friends matching the search (or all friends if no search)
    const friendRows = await dbHelpers.query(
      `SELECT DISTINCT u.id, u.username, u.profile_picture, 1 AS is_friend
       FROM friends f
       JOIN chessusnode.users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
       WHERE ((f.user_id = ? AND f.friend_id != ?) OR (f.friend_id = ? AND f.user_id != ?))
         AND f.status = 'accepted'
         AND u.username LIKE ?
       ORDER BY u.username ASC
       LIMIT ?`,
      [userId, userId, userId, userId, userId, `%${search}%`, limit]
    );

    const friendIds = new Set(friendRows.map(r => r.id));
    const remaining = limit - friendRows.length;

    let otherRows = [];
    if (remaining > 0) {
      // Get non-friend users who accept DMs from non-friends
      const placeholders = friendIds.size > 0
        ? `AND u.id NOT IN (${[...friendIds].map(() => '?').join(',')})`
        : '';
      const params = [userId, `%${search}%`, ...(friendIds.size > 0 ? [...friendIds] : []), remaining];
      otherRows = await dbHelpers.query(
        `SELECT u.id, u.username, u.profile_picture, 0 AS is_friend
         FROM chessusnode.users u
         WHERE u.id != ?
           AND u.username LIKE ?
           AND u.allow_non_friend_dms = 1
           ${placeholders}
         ORDER BY u.username ASC
         LIMIT ?`,
        params
      );
    }

    res.json({ users: [...friendRows, ...otherRows] });
  } catch (err) {
    console.error("Error searching messageable users:", err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

// Get conversations for a user
app.get("/api/users/:userId/conversations", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const conversations = await dbHelpers.getConversations(userId);
    res.json({ conversations });
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Get unread DM count
app.get("/api/users/:userId/messages/unread-count", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const count = await dbHelpers.getUnreadDMCount(userId);
    res.json({ unreadCount: count });
  } catch (err) {
    console.error("Error fetching unread DM count:", err);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// Get messages with a specific user
app.get("/api/users/:userId/messages/:otherUserId", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const otherUserId = parseInt(req.params.otherUserId);
    if (isNaN(otherUserId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    const page = parseInt(req.query.page) || 1;
    // beforeId = oldest message id currently visible; fetch messages older than that.
    const beforeId = req.query.beforeId ? parseInt(req.query.beforeId) : null;
    const messages = await dbHelpers.getDirectMessages(userId, otherUserId, page, 50, beforeId);
    const hasMore = messages.length === 50;
    const oldestId = messages.length > 0 ? messages[0].id : null;
    res.json({ messages, hasMore, oldestId });
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Send a direct message
app.post("/api/users/:userId/messages", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const { recipientId, content } = req.body;
    if (!recipientId || !content || !content.trim()) {
      return res.status(400).json({ error: "recipientId and content are required" });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: "Message too long (max 2000 characters)" });
    }
    const recipientIdInt = parseInt(recipientId);
    if (recipientIdInt === userId) {
      return res.status(400).json({ error: "Cannot message yourself" });
    }

    // Check if recipient exists
    const recipient = await dbHelpers.findUserById(recipientIdInt);
    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found" });
    }

    // Check DM permissions - friends-only by default
    if (!recipient.allow_non_friend_dms) {
      const areFriends = await dbHelpers.checkFriendship(userId, recipientIdInt);
      if (!areFriends) {
        return res.status(403).json({ error: "This user only accepts messages from friends" });
      }
    }

    const message = await dbHelpers.sendDirectMessage(userId, recipientIdInt, content.trim());

    // Push real-time notification via socket
    const io = req.app.get('io');
    if (io) {
      const { userSockets } = require('./game-socket');
      const recipientSocketId = userSockets?.get(recipientIdInt.toString());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('newDirectMessage', message);
      }
    }

    res.status(201).json({ message });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Mark messages from a user as read
app.put("/api/users/:userId/messages/:otherUserId/read", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const otherUserId = parseInt(req.params.otherUserId);
    if (isNaN(otherUserId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    await dbHelpers.markDirectMessagesRead(userId, otherUserId);
    res.json({ message: "Messages marked as read" });
  } catch (err) {
    console.error("Error marking messages read:", err);
    res.status(500).json({ error: "Failed to mark messages read" });
  }
});

// Get game chat history
app.get("/api/games/:gameId/chat", async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const messages = await dbHelpers.getGameChatMessages(gameId);
    res.json({ messages });
  } catch (err) {
    console.error("Error fetching game chat:", err);
    res.status(500).json({ error: "Failed to fetch game chat" });
  }
});

// Update user messaging preferences
app.put("/api/users/:userId/messaging-preferences", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const { allow_non_friend_dms, disable_game_chat, sound_enabled, chat_public_for_spectators, show_computer_games_publicly } = req.body;
    const updates = [];
    const values = [];
    if (allow_non_friend_dms !== undefined) {
      updates.push("allow_non_friend_dms = ?");
      values.push(allow_non_friend_dms ? 1 : 0);
    }
    if (disable_game_chat !== undefined) {
      updates.push("disable_game_chat = ?");
      values.push(disable_game_chat ? 1 : 0);
    }
    if (sound_enabled !== undefined) {
      updates.push("sound_enabled = ?");
      values.push(sound_enabled ? 1 : 0);
    }
    if (chat_public_for_spectators !== undefined) {
      updates.push("chat_public_for_spectators = ?");
      values.push(chat_public_for_spectators ? 1 : 0);
    }
    if (show_computer_games_publicly !== undefined) {
      updates.push("show_computer_games_publicly = ?");
      values.push(show_computer_games_publicly ? 1 : 0);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No preferences to update" });
    }
    values.push(userId);
    await dbHelpers.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ message: "Preferences updated" });
  } catch (err) {
    console.error("Error updating messaging preferences:", err);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

// Get the current user's email notification preferences.
app.get("/api/users/:userId/email-preferences", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const [rows] = await db_pool.query(
      "SELECT notification_email_enabled, notification_email_disabled_types FROM users WHERE id = ?",
      [userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const row = rows[0];
    res.json({
      notification_email_enabled: row.notification_email_enabled === null || row.notification_email_enabled === undefined ? 1 : row.notification_email_enabled,
      notification_email_disabled_types: (row.notification_email_disabled_types || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    });
  } catch (err) {
    console.error("Error fetching email preferences:", err);
    res.status(500).json({ error: "Failed to fetch email preferences" });
  }
});

// Update email notification preferences (global toggle + per-type opt-out list).
app.put("/api/users/:userId/email-preferences", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const { notification_email_enabled, notification_email_disabled_types } = req.body;
    const updates = [];
    const values = [];
    if (notification_email_enabled !== undefined) {
      updates.push("notification_email_enabled = ?");
      values.push(notification_email_enabled ? 1 : 0);
    }
    if (notification_email_disabled_types !== undefined) {
      // Whitelist allowed type strings to avoid storing arbitrary input.
      const ALLOWED_TYPES = ['friend_request', 'challenge', 'comment', 'reply', 'game_thread', 'game_move', 'game_chat'];
      const list = Array.isArray(notification_email_disabled_types)
        ? notification_email_disabled_types
        : String(notification_email_disabled_types || '').split(',');
      const cleaned = list
        .map(s => String(s).trim())
        .filter(s => ALLOWED_TYPES.includes(s));
      // Deduplicate
      const unique = Array.from(new Set(cleaned));
      updates.push("notification_email_disabled_types = ?");
      values.push(unique.join(','));
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No preferences to update" });
    }
    values.push(userId);
    await dbHelpers.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ message: "Email preferences updated" });
  } catch (err) {
    console.error("Error updating email preferences:", err);
    res.status(500).json({ error: "Failed to update email preferences" });
  }
});

// One-click unsubscribe from notification digest emails. The token is HMAC-signed
// against the user id so this endpoint requires no login. Successful requests
// flip notification_email_enabled to 0; existing per-type opt-outs are preserved.
app.get("/api/email/unsubscribe", async (req, res) => {
  try {
    const uid = parseInt(req.query.uid, 10);
    const token = String(req.query.token || '');
    if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
      return res.status(400).json({ ok: false, message: "Invalid or expired unsubscribe link." });
    }
    await db_pool.query("UPDATE users SET notification_email_enabled = 0 WHERE id = ?", [uid]);
    return res.json({ ok: true, message: "You have been unsubscribed from notification emails. You can re-enable them in your Preferences." });
  } catch (err) {
    console.error("Error processing unsubscribe:", err);
    res.status(500).json({ ok: false, message: "Failed to process unsubscribe." });
  }
});

// Get the current user's email notification preferences.
app.get("/api/users/:userId/email-preferences", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const [rows] = await db_pool.query(
      "SELECT notification_email_enabled, notification_email_disabled_types FROM users WHERE id = ?",
      [userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const row = rows[0];
    res.json({
      notification_email_enabled: row.notification_email_enabled === null || row.notification_email_enabled === undefined ? 1 : row.notification_email_enabled,
      notification_email_disabled_types: (row.notification_email_disabled_types || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    });
  } catch (err) {
    console.error("Error fetching email preferences:", err);
    res.status(500).json({ error: "Failed to fetch email preferences" });
  }
});

// Update email notification preferences (global toggle + per-type opt-out list).
app.put("/api/users/:userId/email-preferences", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (req.user.id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const { notification_email_enabled, notification_email_disabled_types } = req.body;
    const updates = [];
    const values = [];
    if (notification_email_enabled !== undefined) {
      updates.push("notification_email_enabled = ?");
      values.push(notification_email_enabled ? 1 : 0);
    }
    if (notification_email_disabled_types !== undefined) {
      // Whitelist allowed type strings to avoid storing arbitrary input.
      const ALLOWED_TYPES = ['friend_request', 'challenge', 'comment', 'reply', 'game_thread', 'game_move', 'game_chat'];
      const list = Array.isArray(notification_email_disabled_types)
        ? notification_email_disabled_types
        : String(notification_email_disabled_types || '').split(',');
      const cleaned = list
        .map(s => String(s).trim())
        .filter(s => ALLOWED_TYPES.includes(s));
      // Deduplicate
      const unique = Array.from(new Set(cleaned));
      updates.push("notification_email_disabled_types = ?");
      values.push(unique.join(','));
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No preferences to update" });
    }
    values.push(userId);
    await dbHelpers.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ message: "Email preferences updated" });
  } catch (err) {
    console.error("Error updating email preferences:", err);
    res.status(500).json({ error: "Failed to update email preferences" });
  }
});

// One-click unsubscribe from notification digest emails. The token is HMAC-signed
// against the user id so this endpoint requires no login. Successful requests
// flip notification_email_enabled to 0; existing per-type opt-outs are preserved.
app.get("/api/email/unsubscribe", async (req, res) => {
  try {
    const uid = parseInt(req.query.uid, 10);
    const token = String(req.query.token || '');
    if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
      return res.status(400).json({ ok: false, message: "Invalid or expired unsubscribe link." });
    }
    await db_pool.query("UPDATE users SET notification_email_enabled = 0 WHERE id = ?", [uid]);
    return res.json({ ok: true, message: "You have been unsubscribed from notification emails. You can re-enable them in your Preferences." });
  } catch (err) {
    console.error("Error processing unsubscribe:", err);
    res.status(500).json({ ok: false, message: "Failed to process unsubscribe." });
  }
});

// ========== Site Settings API ==========

// Public: Get a single site setting by key
app.get("/api/site-settings/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const [rows] = await db_pool.query(
      "SELECT setting_value FROM site_settings WHERE setting_key = ?", [key]
    );
    if (rows.length === 0) {
      return res.json({ value: "true" }); // default to enabled
    }
    res.json({ value: rows[0].setting_value });
  } catch (err) {
    console.error("Error fetching site setting:", err.message);
    res.json({ value: "true" });
  }
});

// Public: Get multiple site settings at once via ?keys=key1,key2,key3
// Returns { settings: { key1: value1, key2: value2, ... } }. Missing keys are omitted.
app.get("/api/site-settings", async (req, res) => {
  try {
    const keysParam = (req.query.keys || "").toString().trim();
    if (!keysParam) {
      return res.json({ settings: {} });
    }
    const keys = keysParam.split(",").map(k => k.trim()).filter(Boolean).slice(0, 50);
    if (keys.length === 0) {
      return res.json({ settings: {} });
    }
    const placeholders = keys.map(() => "?").join(",");
    const [rows] = await db_pool.query(
      `SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN (${placeholders})`,
      keys
    );
    const settings = {};
    for (const row of rows) {
      settings[row.setting_key] = row.setting_value;
    }
    res.json({ settings });
  } catch (err) {
    console.error("Error fetching site settings:", err.message);
    res.json({ settings: {} });
  }
});

// Admin: Get all site settings
app.get("/api/admin/site-settings", authenticateAdmin1, async (req, res) => {
  try {
    const [rows] = await db_pool.query("SELECT * FROM site_settings ORDER BY setting_key");
    res.json({ settings: rows });
  } catch (err) {
    console.error("Error fetching site settings:", err.message);
    res.status(500).json({ message: "Failed to load settings" });
  }
});

// Admin: Update a site setting
app.put("/api/admin/site-settings/:key", authenticateAdmin1, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    await db_pool.query(
      "INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [key, String(value), String(value)]
    );
    res.json({ message: "Setting updated", key, value: String(value) });
  } catch (err) {
    console.error("Error updating site setting:", err.message);
    res.status(500).json({ message: "Failed to update setting" });
  }
});

// Admin: upload a team-member picture for the About Us page. Reuses the
// profile-picture multer pipeline (same dir, same size cap) but skips
// the NSFW scan — this endpoint is admin-only and the NSFW model cold-load
// (~30 s) was exceeding nginx's upstream timeout (504) on first use.
// Admins are trusted to upload appropriate images.
app.post(
  "/api/admin/about/upload-picture",
  authenticateAdmin1,
  multerWrap(profilePictureUpload.single('picture'), '2 MB'),
  async (req, res) => {
    try {
      const imageFile = req.file;
      if (!imageFile) {
        return res.status(400).send({ message: "Picture is required" });
      }
      dedupeUploadedFile(imageFile);
      const url = `/uploads/profile-pictures/${imageFile.filename}`;
      res.json({ url });
    } catch (err) {
      console.error("About-team picture upload error:", err.message);
      res.status(500).send({ message: "Failed to upload picture" });
    }
  }
);

// (catch-all /api/* handler is registered at the end of the file, after all
// real route definitions, so it doesn't accidentally swallow routes that are
// declared lower in the file.)

// ────────────────────────────────────────────────────────────────────────────
// POLL API
// ────────────────────────────────────────────────────────────────────────────

// GET /api/poll/active  — public: returns the currently visible, non-expired
// poll with aggregated vote counts plus the calling user's vote (if any).
app.get("/api/poll/active", async (req, res) => {
  try {
    const [[poll]] = await db_pool.query(
      `SELECT id, question, options, expires_at
       FROM polls
       WHERE is_visible = 1
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1`
    );
    if (!poll) return res.json({ poll: null });

    const options = typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;

    // Aggregate vote counts per option
    const [voteCounts] = await db_pool.query(
      `SELECT option_index, COUNT(*) AS cnt FROM poll_votes WHERE poll_id = ? GROUP BY option_index`,
      [poll.id]
    );
    const counts = options.map((_, i) => {
      const row = voteCounts.find(r => r.option_index === i);
      return row ? Number(row.cnt) : 0;
    });

    // Current user's vote (if authenticated)
    let myVote = null;
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.ACCESS_TOKEN_SECRET);
        const [[voteRow]] = await db_pool.query(
          `SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?`,
          [poll.id, decoded.id]
        );
        if (voteRow) myVote = voteRow.option_index;
      } catch (_) { /* unauthenticated or expired token — ignore */ }
    }

    res.json({
      poll: {
        id: poll.id,
        question: poll.question,
        options,
        expires_at: poll.expires_at,
        counts,
        myVote,
        totalVotes: counts.reduce((s, c) => s + c, 0),
      }
    });
  } catch (err) {
    console.error("Error fetching active poll:", err);
    res.status(500).send({ message: "Failed to fetch poll" });
  }
});

// POST /api/poll/:id/vote  — authenticated: cast or change vote
app.post("/api/poll/:id/vote", authenticateToken, async (req, res) => {
  try {
    const pollId = parseInt(req.params.id);
    const { optionIndex } = req.body;
    if (!Number.isInteger(optionIndex) || optionIndex < 0) {
      return res.status(400).send({ message: "Invalid option" });
    }
    const userId = req.user.id;

    const [[poll]] = await db_pool.query(
      `SELECT id, options FROM polls WHERE id = ? AND is_visible = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [pollId]
    );
    if (!poll) return res.status(404).send({ message: "Poll not found or closed" });

    const options = typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
    if (optionIndex >= options.length) return res.status(400).send({ message: "Invalid option index" });

    // Upsert — allows changing vote, never allows deleting
    await db_pool.query(
      `INSERT INTO poll_votes (poll_id, user_id, option_index)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE option_index = VALUES(option_index), voted_at = CURRENT_TIMESTAMP`,
      [pollId, userId, optionIndex]
    );

    // Return updated counts
    const [voteCounts] = await db_pool.query(
      `SELECT option_index, COUNT(*) AS cnt FROM poll_votes WHERE poll_id = ? GROUP BY option_index`,
      [pollId]
    );
    const counts = options.map((_, i) => {
      const row = voteCounts.find(r => r.option_index === i);
      return row ? Number(row.cnt) : 0;
    });

    res.json({ success: true, myVote: optionIndex, counts, totalVotes: counts.reduce((s, c) => s + c, 0) });
  } catch (err) {
    console.error("Error recording vote:", err);
    res.status(500).send({ message: "Failed to record vote" });
  }
});

// ── Admin poll endpoints ──────────────────────────────────────────────────────

// GET /api/admin/poll  — return all polls (most recent first)
app.get("/api/admin/poll", authenticateAdmin1, async (req, res) => {
  try {
    const [polls] = await db_pool.query(
      `SELECT id, question, options, is_visible, expires_at, created_at, updated_at
       FROM polls ORDER BY created_at DESC`
    );
    res.json(polls.map(p => ({
      ...p,
      options: typeof p.options === 'string' ? JSON.parse(p.options) : p.options,
    })));
  } catch (err) {
    console.error("Error fetching polls:", err);
    res.status(500).send({ message: "Failed to fetch polls" });
  }
});

// GET /api/admin/poll/:id/results  — per-option voter list
app.get("/api/admin/poll/:id/results", authenticateAdmin1, async (req, res) => {
  try {
    const pollId = parseInt(req.params.id);
    const [[poll]] = await db_pool.query(`SELECT * FROM polls WHERE id = ?`, [pollId]);
    if (!poll) return res.status(404).send({ message: "Poll not found" });

    const options = typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
    const [votes] = await db_pool.query(
      `SELECT pv.option_index, pv.voted_at, u.id AS user_id, u.username, u.profile_picture
       FROM poll_votes pv
       JOIN users u ON pv.user_id = u.id
       WHERE pv.poll_id = ?
       ORDER BY pv.option_index, pv.voted_at ASC`,
      [pollId]
    );

    const results = options.map((opt, i) => ({
      optionIndex: i,
      option: opt,
      voters: votes.filter(v => v.option_index === i).map(v => ({
        user_id: v.user_id,
        username: v.username,
        profile_picture: v.profile_picture,
        voted_at: v.voted_at,
      })),
    }));

    res.json({
      poll: { ...poll, options },
      results,
      totalVotes: votes.length,
    });
  } catch (err) {
    console.error("Error fetching poll results:", err);
    res.status(500).send({ message: "Failed to fetch results" });
  }
});

// POST /api/admin/poll  — create a new poll
app.post("/api/admin/poll", authenticateAdmin1, async (req, res) => {
  try {
    let { question, options, is_visible, expires_at } = req.body;
    question = (question || '').trim();
    if (!question) return res.status(400).send({ message: "Question is required" });
    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).send({ message: "At least 2 options are required" });
    }
    const cleanOptions = options.map(o => String(o).trim()).filter(Boolean);
    if (cleanOptions.length < 2) return res.status(400).send({ message: "At least 2 non-empty options required" });

    const expiresAt = expires_at ? new Date(expires_at) : null;
    if (expiresAt && isNaN(expiresAt.getTime())) {
      return res.status(400).send({ message: "Invalid expires_at date" });
    }

    const [result] = await db_pool.query(
      `INSERT INTO polls (question, options, is_visible, expires_at) VALUES (?, ?, ?, ?)`,
      [question, JSON.stringify(cleanOptions), is_visible ? 1 : 0, expiresAt]
    );
    const [[created]] = await db_pool.query(`SELECT * FROM polls WHERE id = ?`, [result.insertId]);
    res.status(201).json({ ...created, options: cleanOptions });
  } catch (err) {
    console.error("Error creating poll:", err);
    res.status(500).send({ message: "Failed to create poll" });
  }
});

// PUT /api/admin/poll/:id  — update poll settings
app.put("/api/admin/poll/:id", authenticateAdmin1, async (req, res) => {
  try {
    const pollId = parseInt(req.params.id);
    const [[existing]] = await db_pool.query(`SELECT * FROM polls WHERE id = ?`, [pollId]);
    if (!existing) return res.status(404).send({ message: "Poll not found" });

    let { question, options, is_visible, expires_at } = req.body;
    question = (question ?? existing.question).trim();
    if (!question) return res.status(400).send({ message: "Question is required" });

    let cleanOptions;
    if (options !== undefined) {
      if (!Array.isArray(options) || options.length < 2) {
        return res.status(400).send({ message: "At least 2 options are required" });
      }
      cleanOptions = options.map(o => String(o).trim()).filter(Boolean);
      if (cleanOptions.length < 2) return res.status(400).send({ message: "At least 2 non-empty options required" });
    } else {
      cleanOptions = typeof existing.options === 'string' ? JSON.parse(existing.options) : existing.options;
    }

    const visibleVal = is_visible !== undefined ? (is_visible ? 1 : 0) : existing.is_visible;
    let expiresAt;
    if (expires_at === null || expires_at === '') {
      expiresAt = null;
    } else if (expires_at !== undefined) {
      expiresAt = new Date(expires_at);
      if (isNaN(expiresAt.getTime())) return res.status(400).send({ message: "Invalid expires_at date" });
    } else {
      expiresAt = existing.expires_at;
    }

    await db_pool.query(
      `UPDATE polls SET question = ?, options = ?, is_visible = ?, expires_at = ? WHERE id = ?`,
      [question, JSON.stringify(cleanOptions), visibleVal, expiresAt, pollId]
    );
    const [[updated]] = await db_pool.query(`SELECT * FROM polls WHERE id = ?`, [pollId]);
    res.json({ ...updated, options: cleanOptions });
  } catch (err) {
    console.error("Error updating poll:", err);
    res.status(500).send({ message: "Failed to update poll" });
  }
});

// DELETE /api/admin/poll/:id  — delete poll and all its votes
app.delete("/api/admin/poll/:id", authenticateAdmin1, async (req, res) => {
  try {
    const pollId = parseInt(req.params.id);
    const [[existing]] = await db_pool.query(`SELECT id FROM polls WHERE id = ?`, [pollId]);
    if (!existing) return res.status(404).send({ message: "Poll not found" });
    await db_pool.query(`DELETE FROM polls WHERE id = ?`, [pollId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting poll:", err);
    res.status(500).send({ message: "Failed to delete poll" });
  }
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

// Rolling memory history — keeps last 120 snapshots (2 hours at 1/min).
// Survives until process restart, giving post-crash forensics from the log.
const MEMORY_HISTORY_MAX = 120;
const memoryHistory = [];
let peakRssMB = 0;
let _memLogCount = 0; // throttle console output to every 5th sample (5 min)

setInterval(() => {
  const m = process.memoryUsage();
  const mb = v => Math.round(v / 1024 / 1024);
  const snapshot = {
    t: new Date().toISOString(),
    rss: mb(m.rss),
    heapUsed: mb(m.heapUsed),
    heapTotal: mb(m.heapTotal),
    external: mb(m.external),
    activeGames: gsActiveGames ? gsActiveGames.size : 0,
    onlineUsers: onlineUsers ? onlineUsers.size : 0,
  };
  if (snapshot.rss > peakRssMB) peakRssMB = snapshot.rss;
  memoryHistory.push(snapshot);
  if (memoryHistory.length > MEMORY_HISTORY_MAX) memoryHistory.shift();
  // Log every 5 minutes rather than every minute to reduce console noise.
  // The in-memory chart still samples at 1-minute resolution.
  if (++_memLogCount % 5 === 0) {
    console.log(`[memory] heapUsed=${snapshot.heapUsed}MB heapTotal=${snapshot.heapTotal}MB rss=${snapshot.rss}MB external=${snapshot.external}MB activeGames=${snapshot.activeGames} onlineUsers=${snapshot.onlineUsers}`);
  }
}, 60_000);

// Graceful shutdown for nodemon restarts
process.once('SIGUSR2', () => {
  server.close(() => {
    process.kill(process.pid, 'SIGUSR2');
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

// Weekly notification email digest - runs every hour, checks if users have >10 notifications this week
const checkWeeklyNotificationDigest = async () => {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const usersToNotify = await dbHelpers.getWeeklyNotificationCounts(weekStartStr);

    for (const user of usersToNotify) {
      const alreadySent = await dbHelpers.hasEmailBeenSentForWeek(user.user_id, weekStartStr);
      if (alreadySent) continue;

      const summary = await dbHelpers.getNotificationSummaryForUser(user.user_id, weekStartStr);
      await sendNotificationSummaryEmail(user.email, user.username, summary, user.notification_count, user.user_id);
      await dbHelpers.logNotificationEmail(user.user_id, user.notification_count, weekStartStr);
    }
  } catch (err) {
    console.error('Error in weekly notification digest:', err.message);
  }
};

// Check every hour
setInterval(checkWeeklyNotificationDigest, 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Notification cleanup: prevent the notifications table from growing unbounded.
//   - Delete READ notifications older than 30 days
//   - Delete UNREAD notifications older than 90 days (stale)
// Runs once at startup (delayed) and every 6 hours.
// ---------------------------------------------------------------------------
const cleanupOldNotifications = async () => {
  try {
    const [readResult] = await db_pool.query(
      "DELETE FROM notifications WHERE is_read = 1 AND created_at < (NOW() - INTERVAL 30 DAY)"
    );
    const [unreadResult] = await db_pool.query(
      "DELETE FROM notifications WHERE is_read = 0 AND created_at < (NOW() - INTERVAL 90 DAY)"
    );
    if ((readResult.affectedRows || 0) + (unreadResult.affectedRows || 0) > 0) {
      console.log(`[notifications-cleanup] removed ${readResult.affectedRows} read + ${unreadResult.affectedRows} stale unread`);
    }
  } catch (err) {
    console.error('[notifications-cleanup] error:', err.message);
  }
};
setTimeout(cleanupOldNotifications, 60 * 1000); // 1 minute after startup
setInterval(cleanupOldNotifications, 6 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Anonymous game cleanup:
//   - Close any anonymous game stuck in 'waiting' / 'active' / 'ready' for
//     more than 24 hours by setting status='completed' and end_time=NOW().
//     Anonymous games can be abandoned mid-play (no auto-forfeit on disconnect)
//     so without this, end_time stays NULL and they accumulate forever.
//   - Delete any anonymous game older than 30 days regardless of status.
// Runs once at startup (delayed) and every 6 hours.
// ---------------------------------------------------------------------------
const cleanupAnonymousGames = async () => {
  try {
    // 1. Close stale unfinished anonymous games (>24h old, not completed)
    const [closed] = await db_pool.query(
      `UPDATE games
         SET status = 'completed',
             end_time = COALESCE(end_time, NOW())
       WHERE is_anonymous = 1
         AND status IN ('waiting', 'active', 'ready')
         AND created_at < (NOW() - INTERVAL 24 HOUR)`
    );
    // 2. Delete anonymous games older than 30 days (any status)
    const [deleted] = await db_pool.query(
      `DELETE FROM games
       WHERE is_anonymous = 1
         AND created_at < (NOW() - INTERVAL 30 DAY)`
    );
    // 3. Backfill end_time on ANY 'completed' game (anonymous or not) that
    //    somehow ended up with NULL end_time. Older games and any game whose
    //    final UPDATE failed before today's audit can have a missing end_time;
    //    use the last move's timestamp from other_data when available, else
    //    fall back to the start_time / created_at so the duration isn't huge.
    const [backfilled] = await db_pool.query(
      `UPDATE games
         SET end_time = COALESCE(start_time, created_at, NOW())
       WHERE status = 'completed'
         AND end_time IS NULL`
    );
    // 4. Self-heal duplicate game_outcome notifications. A previous bug
    //    (broadcastGameOver recursing into itself) caused thousands of
    //    duplicate win/loss notifications per game. Keep only the earliest
    //    notification per (user_id, related_id) for type='game_outcome'.
    //    Idempotent: a no-op once dupes are cleared.
    const [dedupedNotifs] = await db_pool.query(
      `DELETE n FROM notifications n
         INNER JOIN (
           SELECT user_id, related_id, MIN(id) AS keep_id
           FROM notifications
           WHERE type = 'game_outcome' AND related_id IS NOT NULL
           GROUP BY user_id, related_id
           HAVING COUNT(*) > 1
         ) keep
           ON n.user_id = keep.user_id
          AND n.related_id = keep.related_id
          AND n.type = 'game_outcome'
          AND n.id <> keep.keep_id`
    );
    if ((closed.affectedRows || 0) + (deleted.affectedRows || 0) + (backfilled.affectedRows || 0) + (dedupedNotifs.affectedRows || 0) > 0) {
      console.log(`[anon-games-cleanup] closed ${closed.affectedRows} stale, deleted ${deleted.affectedRows} old anonymous, backfilled ${backfilled.affectedRows} missing end_time, deduped ${dedupedNotifs.affectedRows} duplicate game_outcome notifications`);
    }
  } catch (err) {
    console.error('[anon-games-cleanup] error:', err.message);
  }
};
setTimeout(cleanupAnonymousGames, 90 * 1000);
setInterval(cleanupAnonymousGames, 6 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Lightweight admin diagnostic endpoint: quick view of in-memory state and
// process RSS / heap. Useful for spotting leaks without SSH'ing into the box.
// ---------------------------------------------------------------------------
app.get("/api/admin/memory-stats", authenticateAdmin, (req, res) => {
  try {
    const mem = process.memoryUsage();

    // DB pool introspection.
    // mysql2/promise createPool() returns a PromisePool; its underlying raw
    // Pool is at .pool. The raw Pool tracks three internal arrays:
    //   _allConnections  – every connection ever opened (grows up to connectionLimit)
    //   _freeConnections – connections currently idle and available
    //   _connectionQueue – callers waiting because the pool is exhausted
    //
    // On a quiet server mysql2 opens connections lazily, so _allConnections
    // may be less than connectionLimit. On a busy server all slots fill and
    // _freeConnections shrinks. "active" = total opened − currently idle.
    const rawPool = db_pool.pool;
    const dbPool = rawPool ? {
      limit: rawPool.config?.connectionLimit ?? null,
      total: rawPool._allConnections?.length ?? null,
      free: rawPool._freeConnections?.length ?? null,
      active: (rawPool._allConnections?.length != null && rawPool._freeConnections?.length != null)
        ? rawPool._allConnections.length - rawPool._freeConnections.length
        : null,
      queued: rawPool._connectionQueue?.length ?? null,
    } : null;

    res.json({
      uptimeSeconds: Math.round(process.uptime()),
      activeGames: gsActiveGames ? gsActiveGames.size : 0,
      gameTimers: gsGameTimers ? gsGameTimers.size : 0,
      disconnectTimeouts: gsDisconnectTimeouts ? gsDisconnectTimeouts.size : 0,
      onlineUsers: onlineUsers ? onlineUsers.size : 0,
      // 429 counter — resets on process restart
      rateLimitHits,
      // DB connection pool
      dbPool,
      memory: {
        rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
        heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        externalMB: +(mem.external / 1024 / 1024).toFixed(1),
        arrayBuffersMB: +((mem.arrayBuffers || 0) / 1024 / 1024).toFixed(1),
        peakRssMB,
      },
      memoryHistory: memoryHistory.slice(),
      nodeVersion: process.version,
    });
  } catch (err) {
    console.error('memory-stats error:', err);
    res.status(500).json({ error: 'Failed to read stats' });
  }
});

// Admin endpoint: folder sizes, disk space, and DB table row counts.
// Called on-demand from the Server Stats tab in the admin dashboard.
app.get("/api/admin/storage-stats", authenticateAdmin1, async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const { trainingRootDir } = require('./ai/export-game-rules');

    // Recursively compute directory size in bytes.
    function getDirSizeBytes(dirPath) {
      let total = 0;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dirPath, entry.name);
          try {
            if (entry.isDirectory()) {
              total += getDirSizeBytes(full);
            } else if (entry.isFile() || entry.isSymbolicLink()) {
              total += fs.statSync(full).size;
            }
          } catch (_) {}
        }
      } catch (_) {}
      return total;
    }

    // Count files (non-recursively) in a directory.
    function countFilesShallow(dirPath) {
      try {
        return fs.readdirSync(dirPath, { withFileTypes: true }).filter(e => e.isFile()).length;
      } catch (_) { return 0; }
    }

    const repoRoot = path.join(__dirname, '..');
    const uploadsDir = path.join(repoRoot, 'uploads');
    const piecesDir = path.join(uploadsDir, 'pieces');
    const avatarsDir = path.join(uploadsDir, 'profile-pictures');
    let trainingDir;
    try { trainingDir = trainingRootDir(); } catch (_) { trainingDir = path.join(repoRoot, 'ai-training'); }

    const folderSizes = {
      uploads: getDirSizeBytes(uploadsDir),
      pieces: getDirSizeBytes(piecesDir),
      profilePictures: getDirSizeBytes(avatarsDir),
      aiTraining: getDirSizeBytes(trainingDir),
    };

    const fileCounts = {
      pieces: countFilesShallow(piecesDir),
      profilePictures: countFilesShallow(avatarsDir),
    };

    // Partition disk space via `df` (Linux). Returns null on non-Linux or error.
    let diskSpace = null;
    try {
      const out = execSync(`df -k "${repoRoot}"`, { timeout: 5000 }).toString();
      const lines = out.trim().split('\n');
      // df may wrap long filesystem names to next line; last line has the numbers
      const dataLine = lines[lines.length - 1].trim().split(/\s+/);
      // df -k columns: Filesystem 1K-blocks Used Available Use% Mounted
      if (dataLine.length >= 5) {
        diskSpace = {
          totalBytes:     parseInt(dataLine[dataLine.length - 5], 10) * 1024,
          usedBytes:      parseInt(dataLine[dataLine.length - 4], 10) * 1024,
          freeBytes:      parseInt(dataLine[dataLine.length - 3], 10) * 1024,
        };
      }
    } catch (_) {}

    // DB table row counts
    const tableList = ['users', 'games', 'game_types', 'pieces', 'ai_training_jobs'];
    const rowCounts = {};
    await Promise.all(tableList.map(async (t) => {
      try {
        const [[r]] = await db_pool.query(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
        rowCounts[t] = r.cnt;
      } catch (_) { rowCounts[t] = null; }
    }));

    res.json({ folderSizes, fileCounts, diskSpace, rowCounts });
  } catch (err) {
    console.error('storage-stats error:', err);
    res.status(500).json({ error: 'Failed to compute storage stats' });
  }
});

// Catch-all for any /api/* GET request not handled by an earlier route.
// MUST stay at the very bottom of this file so it doesn't accidentally
// shadow real routes that are declared further down (e.g. memory-stats).
app.get('/api/*', (req, res) => {
  res.status(404).json({ message: "No data to return from this endpoint!" });
});

