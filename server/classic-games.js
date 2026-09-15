/*
 * The classic games GridGrove publishes, and the pieces they are made of.
 *
 * Tic Tac Toe and Connect Four were built locally and had to reach production
 * somehow. Doing it from here rather than by hand means the same two games
 * exist on every database with the same rules under the same account, and that
 * a fresh database gets them without anybody remembering to.
 *
 * Its own module rather than another few hundred lines in migrations.js: this
 * is the DEFINITION of two games, and it will be edited whenever one of them
 * is tuned, which is a different rhythm from the schema changes that file is
 * otherwise made of.
 */
const fs = require('fs');
const path = require('path');

const db_pool = require('../configs/db');

/**
 * Where uploaded piece art lives, matching the rule index.js uses: an explicit
 * UPLOADS_DIR (a mounted volume in production) or the repo-relative folder, so
 * a deployment that has never set the variable still works.
 */
function uploadsPiecesDir() {
  const base = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, '..', 'uploads');
  return path.join(base, 'pieces');
}

/**
 * Write the seeded artwork into the uploads directory, skipping what is there.
 *
 * The files are named by the sha256 of their contents - the same convention
 * every upload uses - so a file that is already present necessarily holds the
 * same drawing and is left alone. Run on every boot rather than once, so a
 * volume that lost its files gets them back.
 *
 * Returns how many were written.
 */
function writeClassicArt(art) {
  const dir = uploadsPiecesDir();
  fs.mkdirSync(dir, { recursive: true });

  let written = 0;
  for (const meta of Object.values(art || {})) {
    if (!meta || !meta.file || !meta.svg) continue;
    const target = path.join(dir, meta.file);
    if (fs.existsSync(target)) continue;
    fs.writeFileSync(target, meta.svg, 'utf8');
    written++;
  }
  return written;
}

/**
 * Tic Tac Toe and Connect Four, owned by GridGrove.
 *
 * Idempotent on the game NAME and on piece name plus owner, so a redeploy
 * updates a game that is already there rather than making a second one. The
 * rules are written every time on purpose: this file is what these two games
 * ARE, so a correction to one of them should reach every database on the next
 * deploy rather than only new ones.
 *
 * Returns the number of games ensured, or 0 when it could not run.
 */
async function seedClassicGames() {
  const seedPath = path.join(__dirname, '..', 'db', 'seeds', 'classic-games.json');
  if (!fs.existsSync(seedPath)) return 0;

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch (err) {
    console.error('[seed] classic-games.json is not readable JSON:', err.message);
    return 0;
  }

  const [[owner]] = await db_pool.query(
    "SELECT id FROM users WHERE username = 'GridGrove' LIMIT 1"
  );
  if (!owner) {
    console.error('[seed] No GridGrove account; skipping the classic games.');
    return 0;
  }

  const wrote = writeClassicArt(seed.art);
  if (wrote) console.log(`[DB] Wrote ${wrote} classic-game image(s) into uploads/pieces`);

  const url = (key) => `/uploads/pieces/${seed.art[key].file}`;

  /*
   * One piece per game, with two pictures. image_location is indexed by
   * player, so the first entry is player 1's and the second is player 2's -
   * which is also the turn order, so in Tic Tac Toe the first player is the
   * crosses.
   *
   * Every movement column is left at its default of zero. A mark and a counter
   * are placed and never move, which is what makes these games expressible at
   * all.
   */
  const ensurePiece = async (name, description, images) => {
    const imageLocation = JSON.stringify(images);
    const [[existing]] = await db_pool.query(
      'SELECT id FROM pieces WHERE piece_name = ? AND creator_id = ? LIMIT 1', [name, owner.id]
    );
    if (existing) {
      await db_pool.query(
        'UPDATE pieces SET image_location = ?, piece_description = ? WHERE id = ?',
        [imageLocation, description, existing.id]
      );
      return existing.id;
    }
    const [res] = await db_pool.query(
      `INSERT INTO pieces (piece_name, piece_description, creator_id, image_location, name_review_status)
       VALUES (?, ?, ?, ?, 'approved')`,
      [name, description, owner.id, imageLocation]
    );
    console.log(`[DB] Created the "${name}" piece (id ${res.insertId}) for GridGrove`);
    return res.insertId;
  };

  const markId = await ensurePiece(
    'Mark', 'A cross or a nought. It is placed and never moves.',
    [url('cross'), url('nought')]
  );
  const discId = await ensurePiece(
    'Disc', 'A counter that is dropped into a column and never moves.',
    [url('red'), url('yellow')]
  );

  const ensureGame = async (fields) => {
    const [[existing]] = await db_pool.query(
      'SELECT id FROM game_types WHERE game_name = ? LIMIT 1', [fields.game_name]
    );
    if (existing) {
      const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
      await db_pool.query(
        `UPDATE game_types SET ${sets} WHERE id = ?`, [...Object.values(fields), existing.id]
      );
      return { id: existing.id, created: false };
    }
    const cols = Object.keys(fields).join(', ');
    const qs = Object.keys(fields).map(() => '?').join(', ');
    const [res] = await db_pool.query(
      `INSERT INTO game_types (${cols}) VALUES (${qs})`, Object.values(fields)
    );
    return { id: res.insertId, created: true };
  };

  const common = {
    creator_id: owner.id,
    player_count: 2,
    actions_per_turn: 1,
    pieces_string: '{}',
    line_condition: 1,
    line_win_type: 'in_a_row',
    line_directions: 'all',
    line_same_piece_type: 0,
    is_draft: 0,
    name_review_status: 'approved',
  };

  const tictactoe = await ensureGame({
    ...common,
    game_name: 'Tic Tac Toe',
    descript: 'Noughts and crosses. Place a mark on any empty square; three in a row wins.',
    rules: 'Players take turns placing a mark on any empty square. The first to get three '
      + 'of their marks in a row - across, down or diagonally - wins. If the board fills '
      + 'with nobody in a row, the game is a draw.',
    board_width: 3,
    board_height: 3,
    other_game_data: JSON.stringify({
      place_pieces_action: true,
      placeable_pieces: [{
        piece_id: markId,
        name: 'Mark',
        image_url: url('cross'),
        image_location: JSON.stringify([url('cross'), url('nought')]),
        player: 'all',
      }],
    }),
    // The board decides the length here, so a 3x3 asks for three.
    line_length_matches_board: 1,
    line_length: 3,
    board_gravity: 'off',
  });

  const connectFour = await ensureGame({
    ...common,
    game_name: 'Connect Four',
    descript: 'Drop a disc into any column. Four in a row - across, down or diagonally - wins.',
    rules: 'Players take turns dropping a disc into a column; it falls to the lowest free '
      + 'space. The first to line up four of their own discs in any direction wins. If the '
      + 'grid fills with nobody in four, the game is a draw.',
    board_width: 7,
    board_height: 6,
    other_game_data: JSON.stringify({
      place_pieces_action: true,
      placeable_pieces: [{
        piece_id: discId,
        name: 'Disc',
        image_url: url('red'),
        image_location: JSON.stringify([url('red'), url('yellow')]),
        player: 'all',
      }],
    }),
    // Four, not the board's six: Connect Four is four in a row on a 7x6 grid.
    line_length_matches_board: 0,
    line_length: 4,
    board_gravity: 'down',
  });

  for (const [name, res] of [['Tic Tac Toe', tictactoe], ['Connect Four', connectFour]]) {
    console.log(`[DB] ${res.created ? 'Created' : 'Refreshed'} "${name}" (game ${res.id}) for GridGrove`);
  }
  return (tictactoe.created ? 1 : 0) + (connectFour.created ? 1 : 0);
}

/**
 * Hand the pieces used by GridGrove's games to GridGrove.
 *
 * A chess pawn is not anybody's creation in the sense the rest of the library
 * is - it shipped with the site under whoever happened to add it - and while
 * that stands, the Classic Pieces filter shows the stones and marks but not
 * the pawns and knights of the official Chess game.
 *
 * Scoped to the pieces those games actually place, start with, or configure,
 * found FROM THE GAMES rather than from a list written here, so adding a game
 * to the GridGrove account brings its pieces along on the next deploy.
 *
 * A piece also used by somebody else's game still moves: it is the same row,
 * and the alternative - refusing whenever a piece is shared - would leave the
 * chess pieces behind precisely because they are the popular ones.
 *
 * Returns how many rows changed owner.
 */
async function adoptClassicGamePieces() {
  const [[owner]] = await db_pool.query(
    "SELECT id FROM users WHERE username = 'GridGrove' LIMIT 1"
  );
  if (!owner) return 0;

  const [games] = await db_pool.query(
    'SELECT id, pieces_string, other_game_data FROM game_types WHERE creator_id = ?', [owner.id]
  );
  if (!games.length) return 0;

  const pieceIds = new Set();
  const collect = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) pieceIds.add(n);
  };

  for (const game of games) {
    // Pieces the game starts with, keyed "y,x" in pieces_string.
    try {
      const placements = JSON.parse(game.pieces_string || '{}') || {};
      for (const entry of Object.values(placements)) collect(entry && entry.piece_id);
    } catch (_) { /* a game with unreadable placements contributes none */ }

    // And pieces it lets a player deploy.
    try {
      const other = JSON.parse(game.other_game_data || '{}') || {};
      for (const entry of (other.placeable_pieces || [])) collect(entry && entry.piece_id);
    } catch (_) { /* likewise */ }
  }

  /*
   * And the junction table, which is where a game's PER-SQUARE configuration
   * lives. A piece can appear there without being in pieces_string, so reading
   * only the placements would miss some of exactly the pieces this is for.
   */
  const [junction] = await db_pool.query(
    `SELECT DISTINCT gtp.piece_id FROM game_type_pieces gtp
     JOIN game_types gt ON gt.id = gtp.game_type_id
     WHERE gt.creator_id = ?`, [owner.id]
  );
  for (const row of junction) collect(row.piece_id);

  if (!pieceIds.size) return 0;

  const ids = [...pieceIds];
  const [result] = await db_pool.query(
    'UPDATE pieces SET creator_id = ? WHERE id IN (?) AND creator_id <> ?',
    [owner.id, ids, owner.id]
  );
  if (result.affectedRows) {
    console.log(`[DB] ${result.affectedRows} piece(s) used by GridGrove's games transferred to GridGrove`);
  } else {
    console.log(`[DB] All ${ids.length} pieces used by GridGrove's games already belong to it`);
  }
  return result.affectedRows;
}

module.exports = { seedClassicGames, adoptClassicGamePieces, writeClassicArt };
