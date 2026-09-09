/*
 * Tournaments, above the bracket.
 *
 * server/tournament-bracket.js knows the shape of a bracket and nothing else -
 * no database, no games. This is the half that connects it to both: it draws
 * the bracket when a tournament starts, links each match to the game that
 * decides it, and moves the winners along.
 *
 * Results are picked up by reconciling against the games table rather than by
 * hooking the places that finish a game. There are more than a dozen of those
 * - checkmate, resignation, timeout, disconnection, agreement, and several
 * kinds of draw - and a bracket that advances only when somebody remembered to
 * call it would quietly stall the first time a new ending was added. Reading
 * the finished games instead means the bracket cannot fall behind: whatever
 * ended the game, the row says who won.
 */
const db_pool = require('../configs/db');
const dbHelpers = require('./db-helpers');
const bracketLogic = require('./tournament-bracket');

const { BYE } = bracketLogic;

/** How a row's two seats read back to the bracket logic. */
const seatOf = (playerId, isBye) => {
  if (isBye) return BYE;
  return playerId == null ? null : Number(playerId);
};

const rowToNode = (row) => ({
  id: Number(row.id),
  key: row.match_key,
  bracket: row.bracket,
  round: Number(row.round_number),
  slot: Number(row.slot_index),
  playerOneId: seatOf(row.player_one_id, row.player_one_is_bye),
  playerTwoId: seatOf(row.player_two_id, row.player_two_is_bye),
  winnerId: row.winner_id == null ? null : Number(row.winner_id),
  loserId: row.loser_id == null ? null : Number(row.loser_id),
  isDraw: Boolean(row.is_draw),
  gameId: row.game_id == null ? null : Number(row.game_id),
  status: row.status,
  winnerTo: row.winner_to_key ? { key: row.winner_to_key, slot: Number(row.winner_to_slot) } : null,
  loserTo: row.loser_to_key ? { key: row.loser_to_key, slot: Number(row.loser_to_slot) } : null,
  // Carried so the grand final can find its reset match without a lookup table.
  resetKey: row.bracket === 'grand_final'
    ? 'GR1-0'
    : undefined
});

/** Split a seat back into the (id, is_bye) pair the table stores. */
const seatColumns = (seat) => (seat === BYE ? [null, 1] : [seat == null ? null : Number(seat), 0]);

const loadBracket = async (tournamentId, connection = db_pool) => {
  const [rows] = await connection.query(
    `SELECT * FROM tournament_matches
     WHERE tournament_id = ?
     ORDER BY
       FIELD(bracket, 'winners', 'losers', 'grand_final', 'grand_final_reset', 'round_robin'),
       round_number ASC, slot_index ASC`,
    [tournamentId]
  );
  return rows.map(rowToNode);
};

/** Write back the nodes whose keys are named, and nothing else. */
const persistNodes = async (tournamentId, nodes, keys, connection = db_pool) => {
  const wanted = new Set(keys);
  const changed = nodes.filter((n) => wanted.has(n.key));
  for (const node of changed) {
    const [oneId, oneBye] = seatColumns(node.playerOneId);
    const [twoId, twoBye] = seatColumns(node.playerTwoId);
    await connection.query(
      `UPDATE tournament_matches
       SET player_one_id = ?, player_one_is_bye = ?,
           player_two_id = ?, player_two_is_bye = ?,
           winner_id = ?, loser_id = ?, is_draw = ?, status = ?, game_id = ?
       WHERE tournament_id = ? AND match_key = ?`,
      [
        oneId, oneBye, twoId, twoBye,
        node.winnerId == null || node.winnerId === BYE ? null : Number(node.winnerId),
        node.loserId == null || node.loserId === BYE ? null : Number(node.loserId),
        node.isDraw ? 1 : 0,
        node.status,
        node.gameId == null ? null : Number(node.gameId),
        tournamentId,
        node.key
      ]
    );
  }
  return changed.length;
};

/**
 * Draw the bracket and start the tournament.
 *
 * Entrants are seeded in the order they joined, which is the only ordering the
 * site records; it is at least stable and visible, so nobody is quietly given
 * an easier half of the draw.
 */
const startTournament = async (tournamentId) => {
  const [[tournament]] = await db_pool.query(
    `SELECT id, format, status, min_players, created_by_id FROM tournaments WHERE id = ?`,
    [tournamentId]
  );
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { statusCode: 404 });
  if (tournament.status === 'started') {
    throw Object.assign(new Error('This tournament has already started'), { statusCode: 409 });
  }
  if (tournament.status === 'completed' || tournament.status === 'cancelled') {
    throw Object.assign(new Error(`This tournament is ${tournament.status}`), { statusCode: 409 });
  }

  const [participants] = await db_pool.query(
    `SELECT user_id FROM tournament_participants WHERE tournament_id = ? ORDER BY joined_at ASC, id ASC`,
    [tournamentId]
  );
  const playerIds = participants.map((p) => Number(p.user_id));

  if (playerIds.length < 2) {
    throw Object.assign(
      new Error('A tournament needs at least two players before it can start'),
      { statusCode: 400 }
    );
  }

  const nodes = bracketLogic.buildBracket(tournament.format, playerIds);

  const connection = await db_pool.getConnection();
  try {
    await connection.beginTransaction();

    /*
     * Two hosts pressing Start at the same moment.
     *
     * The status check further up cannot catch that on its own - both calls
     * read 'open' before either has written. Locking the tournament row here
     * makes the second call wait for the first to commit and then see the
     * status it wrote, so it is turned away cleanly.
     *
     * Without the lock the two transactions interleave their inserts and
     * deadlock, which InnoDB resolves by killing one of them: the bracket
     * still comes out right, but the losing host is shown a database error
     * instead of being told the tournament has started.
     */
    const [[locked]] = await connection.query(
      `SELECT status FROM tournaments WHERE id = ? FOR UPDATE`,
      [tournamentId]
    );
    const [[existing]] = await connection.query(
      `SELECT COUNT(*) AS count FROM tournament_matches WHERE tournament_id = ?`,
      [tournamentId]
    );
    if (!locked || locked.status === 'started' || Number(existing.count) > 0) {
      await connection.rollback();
      throw Object.assign(new Error('This tournament has already started'), { statusCode: 409 });
    }
    if (locked.status === 'completed' || locked.status === 'cancelled') {
      await connection.rollback();
      throw Object.assign(new Error(`This tournament is ${locked.status}`), { statusCode: 409 });
    }

    for (const node of nodes) {
      const [oneId, oneBye] = seatColumns(node.playerOneId);
      const [twoId, twoBye] = seatColumns(node.playerTwoId);
      await connection.query(
        `INSERT INTO tournament_matches
          (tournament_id, match_key, bracket, round_number, slot_index,
           player_one_id, player_one_is_bye, player_two_id, player_two_is_bye,
           winner_id, loser_id, is_draw, status,
           winner_to_key, winner_to_slot, loser_to_key, loser_to_slot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tournamentId, node.key, node.bracket, node.round, node.slot,
          oneId, oneBye, twoId, twoBye,
          node.winnerId == null || node.winnerId === BYE ? null : Number(node.winnerId),
          node.loserId == null || node.loserId === BYE ? null : Number(node.loserId),
          node.isDraw ? 1 : 0,
          node.status,
          node.winnerTo ? node.winnerTo.key : null,
          node.winnerTo ? node.winnerTo.slot : null,
          node.loserTo ? node.loserTo.key : null,
          node.loserTo ? node.loserTo.slot : null
        ]
      );
    }

    await connection.query(
      `UPDATE tournaments SET status = 'started', started_at = NOW() WHERE id = ?`,
      [tournamentId]
    );

    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (_) { /* already rolled back */ }
    /*
     * A backstop for the race, in case the lock above is ever bypassed: if the
     * bracket exists now, somebody else drew it, and from this host's side the
     * tournament simply started without their click. If it does not exist, the
     * failure was real and is passed on rather than dressed up.
     */
    if (err.code === 'ER_DUP_ENTRY' || err.code === 'ER_LOCK_DEADLOCK') {
      const [[after]] = await db_pool.query(
        `SELECT COUNT(*) AS count FROM tournament_matches WHERE tournament_id = ?`,
        [tournamentId]
      );
      if (Number(after.count) > 0) {
        throw Object.assign(new Error('This tournament has already started'), { statusCode: 409 });
      }
    }
    throw err;
  } finally {
    connection.release();
  }

  // The first round is playable the moment the bracket is drawn.
  const drawn = await loadBracket(tournamentId);
  await announceReadyMatches(tournamentId, drawn.filter((n) => n.status === 'ready'));
  return drawn;
};

/* ------------------------------------------------------------ telling people
 *
 * A bracket advances when the game behind a match finishes, which may be while
 * neither of the next two players is looking at it - the pairing that decides
 * their opponent could be settled hours later, in someone else's game. Without
 * a notification the only way to learn your next match exists is to keep
 * checking, so the tournament stalls on whoever happened to look.
 */

/** Deliver one notification, and push it to the player if they are online. */
const sendNotification = async ({ userId, type, title, content, tournamentId, actionUrl }) => {
  try {
    const notification = await dbHelpers.createNotification({
      user_id: userId,
      sender_id: null,
      type,
      title,
      content,
      related_id: tournamentId,
      action_url: actionUrl
    });

    // Live delivery, if the socket layer is up. Required lazily: the socket
    // module is large, and this file is loaded by scripts that never start it.
    try {
      const gameSocket = require('./game-socket');
      const io = gameSocket.getIO && gameSocket.getIO();
      const socketId = gameSocket.userSockets && gameSocket.userSockets.get(String(userId));
      if (io && socketId) {
        io.to(socketId).emit('newNotification', notification);
        const unreadCount = await dbHelpers.getUnreadNotificationCount(userId);
        io.to(socketId).emit('unreadNotificationCount', { unreadCount });
      }
    } catch (_) { /* no socket layer in this process */ }
  } catch (err) {
    // A notification that cannot be delivered must not undo a result that has
    // already been recorded - the bracket is the thing that matters.
    console.error(`[tournament ${tournamentId}] notification failed for user ${userId}:`, err.message);
  }
};

const tournamentLabel = async (tournamentId) => {
  const [[row]] = await db_pool.query(
    `SELECT gt.game_name FROM tournaments t
     INNER JOIN game_types gt ON gt.id = t.game_type_id
     WHERE t.id = ?`,
    [tournamentId]
  );
  return row && row.game_name ? `${row.game_name} tournament` : 'tournament';
};

const usernamesFor = async (userIds) => {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const [rows] = await db_pool.query('SELECT id, username FROM users WHERE id IN (?)', [ids]);
  return new Map(rows.map((r) => [String(r.id), r.username]));
};

/**
 * Tell both players that a match of theirs is now playable.
 *
 * A walkover never reaches 'ready' - settleNode resolves it to 'bye' the
 * moment it is drawn - so it is already excluded, and there would be nothing
 * to tell the player to do anyway. The check on the two seats is belt and
 * braces against a future status that skips that rule.
 */
const announceReadyMatches = async (tournamentId, nodes) => {
  const playable = (nodes || []).filter((n) => n.status === 'ready'
    && Number(n.playerOneId) && Number(n.playerTwoId));
  if (!playable.length) return 0;

  const label = await tournamentLabel(tournamentId);
  const names = await usernamesFor(playable.flatMap((n) => [n.playerOneId, n.playerTwoId]));
  const actionUrl = `/play/tournaments/${tournamentId}`;

  let sent = 0;
  for (const node of playable) {
    for (const [playerId, opponentId] of [
      [node.playerOneId, node.playerTwoId],
      [node.playerTwoId, node.playerOneId]
    ]) {
      const opponent = names.get(String(opponentId)) || 'your opponent';
      await sendNotification({
        userId: Number(playerId),
        type: 'tournament',
        title: 'Your next tournament match is ready',
        content: `You are drawn against ${opponent} in the ${label}. Open the bracket to start the game.`,
        tournamentId,
        actionUrl
      });
      sent += 1;
    }
  }
  return sent;
};

/** Tell everyone how the tournament ended. */
const announceTournamentFinished = async (tournamentId, championId, playerIds) => {
  const label = await tournamentLabel(tournamentId);
  const names = await usernamesFor([...playerIds, championId]);
  const championName = names.get(String(championId)) || 'Someone';
  const actionUrl = `/play/tournaments/${tournamentId}`;

  for (const playerId of playerIds) {
    const won = Number(playerId) === Number(championId);
    await sendNotification({
      userId: Number(playerId),
      type: 'tournament',
      title: won ? 'You won the tournament' : 'The tournament has finished',
      content: won ? `You won the ${label}.` : `${championName} won the ${label}.`,
      tournamentId,
      actionUrl
    });
  }
};

/**
 * Record one result and advance everyone it moves.
 */
const recordResult = async (tournamentId, matchKey, winnerId, { isDraw = false } = {}) => {
  const nodes = await loadBracket(tournamentId);

  // What was playable before this result, so that only the matches this result
  // actually opened up get announced. A match makes that crossing once, which
  // is what stops the notification being sent twice.
  const wasReady = new Set(nodes.filter((n) => n.status === 'ready').map((n) => n.key));

  const changedKeys = bracketLogic.applyResult(nodes, matchKey, winnerId, { isDraw });
  if (!changedKeys.length) return { changed: 0, nodes };

  await persistNodes(tournamentId, nodes, changedKeys);

  const newlyReady = nodes.filter((n) => n.status === 'ready' && !wasReady.has(n.key));
  if (newlyReady.length) await announceReadyMatches(tournamentId, newlyReady);

  await settleTournamentIfFinished(tournamentId, nodes);
  return { changed: changedKeys.length, nodes, newlyReady: newlyReady.map((n) => n.key) };
};

/** Close the tournament off once its last match is decided. */
const settleTournamentIfFinished = async (tournamentId, nodes) => {
  const [[tournament]] = await db_pool.query(
    `SELECT format, status FROM tournaments WHERE id = ?`,
    [tournamentId]
  );
  if (!tournament || tournament.status !== 'started') return null;

  const [participants] = await db_pool.query(
    `SELECT user_id FROM tournament_participants WHERE tournament_id = ?`,
    [tournamentId]
  );
  const playerIds = participants.map((p) => Number(p.user_id));

  const champion = bracketLogic.championOf(tournament.format, nodes, playerIds);
  if (champion == null || champion === BYE) return null;

  const [update] = await db_pool.query(
    `UPDATE tournaments SET status = 'completed', winner_id = ?, completed_at = NOW()
     WHERE id = ? AND status = 'started'`,
    [Number(champion), tournamentId]
  );

  // Only the call that actually closed the tournament announces it, so two
  // reconciles arriving together cannot send the result twice.
  if (update.affectedRows) {
    await announceTournamentFinished(tournamentId, Number(champion), playerIds);
  }
  return Number(champion);
};

/**
 * Put a match back the way it was before a game was attached.
 *
 * Used when the game did not settle anything - it was cancelled, or a knockout
 * game ended level. Clearing the game id without also putting the status back
 * would leave the match reading as in progress with no game behind it, so
 * neither player could start the replay.
 */
const releaseMatchForReplay = async (tournamentId, matchKey) => {
  await db_pool.query(
    `UPDATE tournament_matches
     SET game_id = NULL, status = 'ready'
     WHERE tournament_id = ? AND match_key = ? AND status IN ('ready', 'active')`,
    [tournamentId, matchKey]
  );
};

/**
 * Bring the bracket up to date with the games behind it.
 *
 * Every match with a game attached is checked against that game's row. This is
 * cheap - one indexed query and, in the ordinary case, no writes - so it can be
 * run whenever anybody looks at the bracket, which is what keeps it correct
 * without every ending in game-socket.js having to remember to call in.
 */
const reconcileTournament = async (tournamentId) => {
  const [rows] = await db_pool.query(
    `SELECT tm.match_key, tm.bracket, tm.player_one_id, tm.player_two_id,
            g.id AS game_id, g.status AS game_status, g.winner_id AS game_winner_id
     FROM tournament_matches tm
     INNER JOIN games g ON g.id = tm.game_id
     WHERE tm.tournament_id = ?
       AND tm.status IN ('ready', 'active')
       AND g.status IN ('completed', 'cancelled')`,
    [tournamentId]
  );

  if (!rows.length) return { applied: 0, replayable: 0 };

  let applied = 0;
  let replayable = 0;

  for (const row of rows) {
    if (row.game_status === 'cancelled') {
      // The game never happened, so the pairing stands and can be played again.
      await releaseMatchForReplay(tournamentId, row.match_key);
      replayable += 1;
      continue;
    }

    const winnerId = row.game_winner_id == null ? null : Number(row.game_winner_id);
    const isDraw = winnerId == null;

    if (isDraw && row.bracket !== 'round_robin') {
      /*
       * A drawn elimination match settles nothing: somebody has to come out of
       * it. The pairing is kept and the game unlinked, so the two players can
       * play it again - which is what a tournament does with a drawn knockout
       * game anyway.
       */
      await releaseMatchForReplay(tournamentId, row.match_key);
      replayable += 1;
      continue;
    }

    // A winner the bracket does not recognise means the game was not the one
    // this match is about; leave it alone rather than corrupt the tree.
    const seats = [row.player_one_id, row.player_two_id].map(Number);
    if (!isDraw && !seats.includes(winnerId)) {
      replayable += 1;
      continue;
    }

    try {
      await recordResult(tournamentId, row.match_key, winnerId, { isDraw });
      applied += 1;
    } catch (err) {
      console.error(`[tournament ${tournamentId}] could not record ${row.match_key}:`, err.message);
    }
  }

  return { applied, replayable };
};

/**
 * The bracket as the client wants it: matches grouped into rounds, with
 * usernames attached and, for a round robin, the table.
 */
const getBracketForResponse = async (tournamentId) => {
  const [[tournament]] = await db_pool.query(
    `SELECT id, format, status, winner_id, started_at, completed_at FROM tournaments WHERE id = ?`,
    [tournamentId]
  );
  if (!tournament) return null;

  await reconcileTournament(tournamentId);

  const nodes = await loadBracket(tournamentId);
  if (!nodes.length) {
    return {
      format: tournament.format,
      status: tournament.status,
      started: false,
      rounds: [],
      standings: [],
      championId: null
    };
  }

  const [participants] = await db_pool.query(
    `SELECT tp.user_id, u.username
     FROM tournament_participants tp
     INNER JOIN users u ON u.id = tp.user_id
     WHERE tp.tournament_id = ?
     ORDER BY tp.joined_at ASC, tp.id ASC`,
    [tournamentId]
  );
  const nameById = new Map(participants.map((p) => [String(p.user_id), p.username]));
  const seedById = new Map(participants.map((p, i) => [String(p.user_id), i + 1]));
  const playerIds = participants.map((p) => Number(p.user_id));

  const describeSeat = (seat) => {
    if (seat === BYE) return { type: 'bye' };
    if (seat == null) return { type: 'pending' };
    return {
      type: 'player',
      id: Number(seat),
      username: nameById.get(String(seat)) || 'Unknown',
      seed: seedById.get(String(seat)) || null
    };
  };

  const matches = nodes.map((node) => ({
    id: node.id,
    key: node.key,
    bracket: node.bracket,
    round: node.round,
    slot: node.slot,
    status: node.status,
    gameId: node.gameId,
    isDraw: node.isDraw,
    winnerId: node.winnerId,
    playerOne: describeSeat(node.playerOneId),
    playerTwo: describeSeat(node.playerTwoId)
  }));

  // Grouped by bracket and round, which is the shape a bracket is drawn in.
  const rounds = [];
  for (const match of matches) {
    let group = rounds.find((r) => r.bracket === match.bracket && r.round === match.round);
    if (!group) {
      group = { bracket: match.bracket, round: match.round, matches: [] };
      rounds.push(group);
    }
    group.matches.push(match);
  }

  const isRoundRobin = tournament.format === 'pool_play' || tournament.format === 'round_robin';
  const standings = isRoundRobin
    ? bracketLogic.computeStandings(nodes, playerIds).map((row) => ({
      ...row,
      username: nameById.get(String(row.playerId)) || 'Unknown'
    }))
    : [];

  return {
    format: tournament.format,
    status: tournament.status,
    started: true,
    startedAt: tournament.started_at,
    completedAt: tournament.completed_at,
    championId: tournament.winner_id == null ? null : Number(tournament.winner_id),
    championUsername: tournament.winner_id == null
      ? null
      : (nameById.get(String(tournament.winner_id)) || null),
    rounds,
    standings
  };
};

/**
 * Attach a game to a match.
 *
 * The game is created through the ordinary flow - one player challenges the
 * other from the bracket - and reported here, rather than being built a second
 * time on the server. That matters more than it looks: building a game means
 * assembling every piece from its definition, and the site already does that in
 * several places that have drifted apart from each other. A tournament game is
 * an ordinary game, so it is made the ordinary way.
 *
 * What is checked here is that the reported game really is the match: the right
 * two players, the tournament's own game type, and not already finished.
 */
const attachGameToMatch = async (tournamentId, matchKey, gameId, reporterId) => {
  const [[tournament]] = await db_pool.query(
    `SELECT id, game_type_id, status FROM tournaments WHERE id = ?`,
    [tournamentId]
  );
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { statusCode: 404 });
  if (tournament.status !== 'started') {
    throw Object.assign(new Error('This tournament is not in progress'), { statusCode: 409 });
  }

  const [[match]] = await db_pool.query(
    `SELECT * FROM tournament_matches WHERE tournament_id = ? AND match_key = ?`,
    [tournamentId, matchKey]
  );
  if (!match) throw Object.assign(new Error('Match not found'), { statusCode: 404 });
  if (match.status === 'completed' || match.status === 'bye') {
    throw Object.assign(new Error('This match has already been decided'), { statusCode: 409 });
  }
  if (match.game_id) {
    throw Object.assign(new Error('This match already has a game'), { statusCode: 409 });
  }

  const seats = [Number(match.player_one_id), Number(match.player_two_id)];
  if (seats.some((id) => !id)) {
    throw Object.assign(new Error('This match is still waiting on an opponent'), { statusCode: 409 });
  }
  if (!seats.includes(Number(reporterId))) {
    throw Object.assign(new Error('You are not playing in this match'), { statusCode: 403 });
  }

  const [[game]] = await db_pool.query(
    `SELECT id, game_type_id, host_id, challenged_user_id, status FROM games WHERE id = ?`,
    [gameId]
  );
  if (!game) throw Object.assign(new Error('Game not found'), { statusCode: 404 });
  if (Number(game.game_type_id) !== Number(tournament.game_type_id)) {
    throw Object.assign(new Error('That game is not of this tournament\'s game type'), { statusCode: 400 });
  }
  if (game.status === 'completed' || game.status === 'cancelled') {
    throw Object.assign(new Error('That game has already finished'), { statusCode: 400 });
  }

  const gameSeats = [Number(game.host_id), Number(game.challenged_user_id)].filter(Boolean).sort();
  if (gameSeats.length !== 2 || gameSeats.join(',') !== [...seats].sort().join(',')) {
    throw Object.assign(
      new Error('That game is not between the two players in this match'),
      { statusCode: 400 }
    );
  }

  // Two players reporting at once would otherwise both attach a game; the
  // condition on game_id makes the first write the one that counts.
  const [result] = await db_pool.query(
    `UPDATE tournament_matches SET game_id = ?, status = 'active'
     WHERE tournament_id = ? AND match_key = ? AND game_id IS NULL`,
    [gameId, tournamentId, matchKey]
  );
  if (!result.affectedRows) {
    throw Object.assign(new Error('This match already has a game'), { statusCode: 409 });
  }

  return getBracketForResponse(tournamentId);
};

/** Every tournament match a user still has to play. */
const getPendingMatchesForUser = async (userId) => {
  const [rows] = await db_pool.query(
    `SELECT tm.tournament_id, tm.match_key, tm.bracket, tm.round_number, tm.status,
            tm.player_one_id, tm.player_two_id, tm.game_id,
            t.format, t.game_type_id, gt.game_name AS game_type_name
     FROM tournament_matches tm
     INNER JOIN tournaments t ON t.id = tm.tournament_id
     INNER JOIN game_types gt ON gt.id = t.game_type_id
     WHERE t.status = 'started'
       AND tm.status IN ('ready', 'active')
       AND (tm.player_one_id = ? OR tm.player_two_id = ?)
     ORDER BY tm.round_number ASC`,
    [userId, userId]
  );
  return rows;
};

module.exports = {
  startTournament,
  loadBracket,
  recordResult,
  reconcileTournament,
  getBracketForResponse,
  attachGameToMatch,
  getPendingMatchesForUser
};
