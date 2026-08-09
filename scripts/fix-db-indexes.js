/**
 * fix-db-indexes.js
 * One-time production script — adds missing indexes across all tables.
 * Also converts notification and DM pagination to keyset-ready format.
 *
 * Run on EC2:
 *   cd /home/ec2-user/chessus-node   (or wherever the repo lives)
 *   node -r dotenv/config scripts/fix-db-indexes.js
 *
 * If env vars are already set by PM2 / systemd:
 *   node scripts/fix-db-indexes.js
 *
 * The script is idempotent — safe to run multiple times.
 * Each index is checked against information_schema.statistics before creation.
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (e) {}

const db = require('../configs/db');

const DB_NAME = process.env.DB_NAME || 'chessusnode';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function indexExists(table, indexName) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.statistics
      WHERE table_schema = ?
        AND table_name   = ?
        AND index_name   = ?`,
    [DB_NAME, table, indexName]
  );
  return rows[0].cnt > 0;
}

async function addIndex(table, indexName, columns, description) {
  if (await indexExists(table, indexName)) {
    console.log(`  SKIP  ${table}.${indexName} — already exists`);
    return false;
  }
  try {
    await db.query(`ALTER TABLE \`${DB_NAME}\`.\`${table}\` ADD INDEX \`${indexName}\` (${columns})`);
    console.log(`  ADD   ${table}.${indexName} (${description})`);
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') {
      console.log(`  SKIP  ${table}.${indexName} — already exists (ER_DUP_KEYNAME)`);
      return false;
    }
    console.error(`  FAIL  ${table}.${indexName}: ${err.message}`);
    return false;
  }
}

async function tableExists(table) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [DB_NAME, table]
  );
  return rows[0].cnt > 0;
}

// ─── index definitions ────────────────────────────────────────────────────────
//
// Format: { table, index, columns, description }
// columns is the raw SQL fragment placed after ADD INDEX `name` (...)
//
const INDEXES = [
  // ── notifications ──────────────────────────────────────────────────────────
  // Created with these indexes in newer installs; add them on older prod tables.
  { table: 'notifications', index: 'idx_notif_user_created',  columns: '`user_id`, `created_at` DESC', description: 'paginated notification list per user (keyset fallback + sort)' },
  { table: 'notifications', index: 'idx_notif_user_id_id',    columns: '`user_id`, `id` DESC',         description: 'keyset pagination by id (cursor-based)' },
  { table: 'notifications', index: 'idx_notif_user_unread',   columns: '`user_id`, `is_read`',         description: 'unread notification count' },

  // ── users ──────────────────────────────────────────────────────────────────
  { table: 'users', index: 'idx_users_username',    columns: '`username`',   description: 'login, mention-notification lookups (called on every auth check)' },
  { table: 'users', index: 'idx_users_email',       columns: '`email`',      description: 'login, registration, donation lookup' },
  { table: 'users', index: 'idx_users_google_id',   columns: '`google_id`',  description: 'Google OAuth login' },
  { table: 'users', index: 'idx_users_lichess_id',  columns: '`lichess_id`', description: 'Lichess OAuth login' },
  { table: 'users', index: 'idx_users_elo',         columns: '`elo` DESC',   description: 'leaderboard ORDER BY elo DESC' },
  { table: 'users', index: 'idx_users_last_active', columns: '`last_active_at` DESC', description: 'users list sort by last active' },

  // ── articles (forums) ──────────────────────────────────────────────────────
  { table: 'articles', index: 'idx_articles_game_type_id', columns: '`game_type_id`',          description: 'game forum lookup by game_type_id' },
  { table: 'articles', index: 'idx_articles_author_id',    columns: '`author_id`',              description: 'forum listing by author' },
  { table: 'articles', index: 'idx_articles_created_at',   columns: '`created_at` DESC',        description: 'forum list ORDER BY created_at' },
  { table: 'articles', index: 'idx_articles_is_news',      columns: '`is_news`, `created_at` DESC', description: 'news list WHERE is_news=1 ORDER BY created_at' },
  { table: 'articles', index: 'idx_articles_category',     columns: '`category`',               description: 'forum filter by category' },

  // ── comments ───────────────────────────────────────────────────────────────
  { table: 'comments', index: 'idx_comments_article_id',  columns: '`article_id`, `created_at`', description: 'comment list + last-comment subquery (GROUP BY article_id, MAX created_at)' },
  { table: 'comments', index: 'idx_comments_author_id',   columns: '`author_id`',                description: 'comments by author' },
  { table: 'comments', index: 'idx_comments_parent_id',   columns: '`parent_id`',                description: 'threaded replies lookup' },

  // ── likes ──────────────────────────────────────────────────────────────────
  { table: 'likes', index: 'idx_likes_article_id',  columns: '`article_id`',             description: 'aggregate like count per forum (GROUP BY article_id)' },
  { table: 'likes', index: 'idx_likes_user_article', columns: '`user_id`, `article_id`', description: 'did user like this post (compound equality check)' },

  // ── game_types ─────────────────────────────────────────────────────────────
  { table: 'game_types', index: 'idx_gametypes_creator_id',    columns: '`creator_id`',           description: 'filter games by creator' },
  { table: 'game_types', index: 'idx_gametypes_last_played_at',columns: '`last_played_at` DESC',   description: 'last_played sort' },
  { table: 'game_types', index: 'idx_gametypes_game_name',     columns: '`game_name`',             description: 'alphabetical sort + LIKE search' },
  { table: 'game_types', index: 'idx_gametypes_featured_order',columns: '`featured_order`',        description: 'featured games ordering' },

  // ── pieces ─────────────────────────────────────────────────────────────────
  { table: 'pieces', index: 'idx_pieces_creator_id',  columns: '`creator_id`',  description: 'filter pieces by creator' },
  { table: 'pieces', index: 'idx_pieces_piece_name',  columns: '`piece_name`',  description: 'alphabetical sort + LIKE search' },
  { table: 'pieces', index: 'idx_pieces_game_type_id',columns: '`game_type_id`',description: 'filter pieces by owning game type' },

  // ── games (live/completed game sessions) ───────────────────────────────────
  { table: 'games', index: 'idx_games_game_type_id',    columns: '`game_type_id`',          description: 'play-count aggregation JOIN' },
  { table: 'games', index: 'idx_games_status_end_time', columns: '`status`, `end_time` DESC',description: 'match history WHERE status=completed ORDER BY end_time' },
  { table: 'games', index: 'idx_games_winner_id',       columns: '`winner_id`',             description: 'stats / win-count queries' },
  { table: 'games', index: 'idx_games_created_at',      columns: '`created_at` DESC',       description: 'game activity sort' },
  { table: 'games', index: 'idx_games_anon_created',    columns: '`is_anonymous`, `created_at`', description: 'anonymous-game cleanup DELETE (is_anonymous=1 AND created_at<NOW()-30d)' },
  { table: 'games', index: 'idx_games_anon_status',     columns: '`is_anonymous`, `status`',     description: 'anonymous-game cleanup UPDATE (is_anonymous=1 AND status IN(...))' },

  // ── players ────────────────────────────────────────────────────────────────
  { table: 'players', index: 'idx_players_game_id',     columns: '`game_id`',             description: 'join players to game rows' },
  { table: 'players', index: 'idx_players_user_id',     columns: '`user_id`',             description: 'match history — all games for a user' },
  { table: 'players', index: 'idx_players_game_user',   columns: '`game_id`, `user_id`',  description: 'INNER JOIN pme ON game_id=? AND user_id=? (match history)' },
  { table: 'players', index: 'idx_players_position',    columns: '`game_id`, `player_position`', description: 'p1/p2 join in match history query' },

  // ── friends ────────────────────────────────────────────────────────────────
  // existing: unique_friendship (user_id, friend_id), idx_user_id, idx_friend_id
  { table: 'friends', index: 'idx_friends_user_status',  columns: '`user_id`, `status`',  description: 'pending friend requests for a user' },
  { table: 'friends', index: 'idx_friends_friend_status', columns: '`friend_id`, `status`',description: 'inbound friend requests for a user' },

  // ── direct_messages (keyset helpers) ──────────────────────────────────────
  // existing: idx_dm_sender, idx_dm_recipient, idx_dm_conversation, idx_dm_unread
  // Add compound keyset index used by beforeId cursor pagination
  { table: 'direct_messages', index: 'idx_dm_conv_id',
    columns: '`sender_id`, `recipient_id`, `id` DESC',
    description: 'keyset cursor pagination for DM thread (beforeId)' },
];

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== fix-db-indexes.js ===');
  console.log(`Database: ${DB_NAME}`);
  console.log('Checking indexes...\n');

  let added = 0;
  let skipped = 0;
  let failed = 0;
  let missingTable = 0;

  for (const def of INDEXES) {
    if (!(await tableExists(def.table))) {
      console.log(`  SKIP  ${def.table}.${def.index} — table does not exist yet`);
      missingTable++;
      continue;
    }
    const result = await addIndex(def.table, def.index, def.columns, def.description);
    if (result === true)  added++;
    else if (result === false) skipped++;
    else failed++;
  }

  console.log('\n=== Summary ===');
  console.log(`  Added:   ${added}`);
  console.log(`  Skipped: ${skipped} (already existed)`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  No table: ${missingTable}`);
  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
