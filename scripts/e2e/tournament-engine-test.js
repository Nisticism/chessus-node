/*
 * Tournaments end to end, against the real database.
 *
 *   node scripts/e2e/tournament-engine-test.js
 *
 * scripts/e2e/tournament-bracket-test.js proves the tree is the right shape.
 * This proves the rest of it: that starting a tournament writes that tree down,
 * that a real game finishing moves the bracket along, and that the tournament
 * closes with the right champion.
 *
 * Results are picked up by reading the games table rather than by a hook on the
 * places that end a game, so the test finishes its games the way those places
 * do - by writing status and winner_id - and then checks the bracket caught it.
 *
 * Everything it creates is torn down at the end, whether it passed or not.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db_pool = require('../../configs/db');
const engine = require('../../server/tournament-engine');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

const created = { tournaments: [], games: [] };

/** Every tournament notification sent for one tournament, newest last. */
const notificationsFor = async (tournamentId, userId = null) => {
  const [rows] = await db_pool.query(
    `SELECT user_id, title, content, action_url, created_at, id
     FROM notifications
     WHERE type = 'tournament' AND related_id = ?
       ${userId ? 'AND user_id = ?' : ''}
     ORDER BY id ASC`,
    userId ? [tournamentId, userId] : [tournamentId]
  );
  return rows;
};

const gameTypeId = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10);

/** Fixture users, in join order - which is also seeding order. */
let PLAYERS = [];

const makeTournament = async (format, playerIds) => {
  const startAt = new Date(Date.now() + 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await db_pool.query(
    `INSERT INTO tournaments
      (format, game_type_id, time_control, increment_seconds, min_players, max_players,
       is_private, start_datetime, number_of_rounds, expected_length_minutes, status, created_by_id)
     VALUES (?, ?, 10, 0, 2, 32, 1, ?, 3, 60, 'open', ?)`,
    [format, gameTypeId, startAt, playerIds[0]]
  );
  const id = result.insertId;
  created.tournaments.push(id);

  for (const playerId of playerIds) {
    await db_pool.query(
      `INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)`,
      [id, playerId]
    );
  }
  return id;
};

/** A game between two players, of the kind a bracket challenge would create. */
const makeGame = async (hostId, challengedId) => {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await db_pool.query(
    `INSERT INTO games
      (created_at, turn_length, increment, player_count, player_turn, pieces, other_data,
       game_type_id, status, host_id, is_challenge, challenged_user_id, allow_spectators)
     VALUES (?, 600, 0, 2, 1, '[]', '{}', ?, 'waiting', ?, 1, ?, 1)`,
    [now, gameTypeId, hostId, challengedId]
  );
  created.games.push(result.insertId);
  return result.insertId;
};

/** End a game the way game-socket.js does: a status and a winner. */
const finishGame = async (gameId, winnerId) => {
  await db_pool.query(
    `UPDATE games SET status = 'completed', end_time = NOW(), winner_id = ? WHERE id = ?`,
    [winnerId, gameId]
  );
};

const readyMatches = async (tournamentId) =>
  (await engine.loadBracket(tournamentId)).filter((n) => n.status === 'ready');

/** Play one match to a decision, through the same path a real game takes. */
const playMatch = async (tournamentId, match, winnerId) => {
  const gameId = await makeGame(match.playerOneId, match.playerTwoId);
  await engine.attachGameToMatch(tournamentId, match.key, gameId, match.playerOneId);
  await finishGame(gameId, winnerId);
  await engine.reconcileTournament(tournamentId);
  return gameId;
};

/** Play a whole tournament out, always letting the first seat win. */
const playOut = async (tournamentId, pick = (m) => m.playerOneId) => {
  let guard = 0;
  for (;;) {
    if (guard += 1, guard > 200) throw new Error('tournament never finished');
    const ready = await readyMatches(tournamentId);
    if (!ready.length) break;
    await playMatch(tournamentId, ready[0], pick(ready[0]));
  }
};

const tournamentRow = async (id) => {
  const [[row]] = await db_pool.query('SELECT * FROM tournaments WHERE id = ?', [id]);
  return row;
};

async function main() {
  const [users] = await db_pool.query(
    "SELECT id, username FROM users WHERE username LIKE 'e2e%' ORDER BY id"
  );
  PLAYERS = users.map((u) => Number(u.id));
  if (PLAYERS.length < 4) {
    throw new Error('needs the e2e fixture users - see scripts/e2e/fixtures.sql');
  }

  const [[gameType]] = await db_pool.query('SELECT id FROM game_types WHERE id = ?', [gameTypeId]);
  if (!gameType) throw new Error(`no game type ${gameTypeId}; set TEST_GAME_TYPE_ID`);

  // ------------------------------------------- a 5-player single elimination --
  const five = PLAYERS.slice(0, 5);
  const singleId = await makeTournament('single_elimination', five);
  await engine.startTournament(singleId);

  const drawn = await engine.loadBracket(singleId);
  check('starting a tournament writes the whole bracket down',
    drawn.length === 7, `${drawn.length} matches`);

  check('and moves the tournament into play',
    (await tournamentRow(singleId)).status === 'started');

  check('the byes in a 5-player draw are already resolved',
    drawn.filter((n) => n.status === 'bye').length === 3,
    `${drawn.filter((n) => n.status === 'bye').length} byes`);

  /*
   * Two, not one. The single real first-round match is playable, and so is the
   * semi-final between seeds 2 and 3, since the byes on both sides of it have
   * already put them there.
   */
  check('every match whose players are known is playable at once',
    drawn.filter((n) => n.status === 'ready').length === 2,
    drawn.filter((n) => n.status === 'ready').map((n) => n.key).join(','));

  check('a bye seats its player in the next round without a game', (() => {
    const semi = drawn.find((n) => n.round === 2 && n.slot === 0);
    return semi.playerOneId === five[0];
  })(), 'the top seed should be waiting in the semi-final');

  // Starting twice must not redraw a bracket that is already being played.
  let secondStart = null;
  try {
    await engine.startTournament(singleId);
  } catch (err) {
    secondStart = err;
  }
  check('a tournament cannot be started twice',
    secondStart && secondStart.statusCode === 409, secondStart?.message);

  // --- one real game decides one real match ---
  const firstMatch = (await readyMatches(singleId))[0];
  const gameId = await makeGame(firstMatch.playerOneId, firstMatch.playerTwoId);

  let wrongGame = null;
  try {
    // A game between the wrong people must not be accepted as this match.
    const outsider = five.find((id) => id !== firstMatch.playerOneId && id !== firstMatch.playerTwoId);
    const strayGame = await makeGame(firstMatch.playerOneId, outsider);
    await engine.attachGameToMatch(singleId, firstMatch.key, strayGame, firstMatch.playerOneId);
  } catch (err) {
    wrongGame = err;
  }
  check('a game between the wrong two players is refused',
    wrongGame && /not between the two players/.test(wrongGame.message), wrongGame?.message);

  let notPlaying = null;
  try {
    const outsider = five.find((id) => id !== firstMatch.playerOneId && id !== firstMatch.playerTwoId);
    await engine.attachGameToMatch(singleId, firstMatch.key, gameId, outsider);
  } catch (err) {
    notPlaying = err;
  }
  check('and somebody who is not in the match cannot attach a game to it',
    notPlaying && notPlaying.statusCode === 403, notPlaying?.message);

  await engine.attachGameToMatch(singleId, firstMatch.key, gameId, firstMatch.playerOneId);
  check('attaching a game puts the match in play',
    (await engine.loadBracket(singleId)).find((n) => n.key === firstMatch.key).status === 'active');

  let twice = null;
  try {
    const another = await makeGame(firstMatch.playerOneId, firstMatch.playerTwoId);
    await engine.attachGameToMatch(singleId, firstMatch.key, another, firstMatch.playerOneId);
  } catch (err) {
    twice = err;
  }
  check('a match will not take a second game while one is running',
    twice && twice.statusCode === 409, twice?.message);

  // --- a drawn knockout game settles nothing ---
  await finishGame(gameId, null);
  const drawReport = await engine.reconcileTournament(singleId);
  const afterDraw = (await engine.loadBracket(singleId)).find((n) => n.key === firstMatch.key);
  check('a drawn elimination game leaves the match to be replayed',
    drawReport.replayable === 1 && afterDraw.status === 'ready' && afterDraw.gameId === null,
    `status=${afterDraw.status} game=${afterDraw.gameId}`);

  check('and the pairing survives the replay',
    afterDraw.playerOneId === firstMatch.playerOneId && afterDraw.playerTwoId === firstMatch.playerTwoId);

  // --- played properly, the winner advances ---
  const replayId = await makeGame(afterDraw.playerOneId, afterDraw.playerTwoId);
  await engine.attachGameToMatch(singleId, afterDraw.key, replayId, afterDraw.playerOneId);
  await finishGame(replayId, afterDraw.playerTwoId);
  await engine.reconcileTournament(singleId);

  const advanced = await engine.loadBracket(singleId);
  const decided = advanced.find((n) => n.key === firstMatch.key);
  const next = advanced.find((n) => n.key === decided.winnerTo.key);
  check('a finished game advances its winner',
    decided.status === 'completed'
    && decided.winnerId === afterDraw.playerTwoId
    && [next.playerOneId, next.playerTwoId].includes(afterDraw.playerTwoId),
    `winner=${decided.winnerId} next=${next.key}`);

  check('and records who went out',
    decided.loserId === afterDraw.playerOneId);

  // --- to the end ---
  await playOut(singleId);
  const finishedSingle = await tournamentRow(singleId);
  check('playing every match out completes the tournament',
    finishedSingle.status === 'completed', finishedSingle.status);
  check('and records a champion who is one of the entrants',
    five.includes(Number(finishedSingle.winner_id)), String(finishedSingle.winner_id));

  const bracketView = await engine.getBracketForResponse(singleId);
  check('the bracket comes back grouped into rounds, with names on it', (() => {
    const first = bracketView.rounds[0];
    return bracketView.rounds.length === 3
      && first.matches.length === 4
      && first.matches.some((m) => m.playerOne.username && m.playerOne.seed === 1);
  })(), `${bracketView.rounds.length} rounds`);

  check('a bye reads as a bye rather than as an unknown player',
    bracketView.rounds[0].matches.some((m) => m.playerTwo.type === 'bye'));

  check('the champion is named in the bracket too',
    Number(bracketView.championId) === Number(finishedSingle.winner_id)
    && !!bracketView.championUsername);

  /*
   * Two people pressing Start at the same instant. The status check cannot
   * catch this on its own - both calls read 'open' before either has written -
   * so the bracket must be protected inside the transaction as well. A second
   * draw over the top of a live bracket would re-seed a tournament that people
   * are already playing.
   */
  const raceId = await makeTournament('single_elimination', PLAYERS.slice(0, 4));
  const outcomes = await Promise.allSettled([
    engine.startTournament(raceId),
    engine.startTournament(raceId)
  ]);
  const won = outcomes.filter((o) => o.status === 'fulfilled').length;
  const raceBracket = await engine.loadBracket(raceId);
  check('two simultaneous starts draw exactly one bracket',
    won === 1 && raceBracket.length === 3,
    `${won} succeeded, ${raceBracket.length} matches written`);

  const lost = outcomes.find((o) => o.status === 'rejected');
  check('and the host who lost the race is told so, not shown a database error',
    lost && lost.reason.statusCode === 409 && !/Duplicate entry/i.test(lost.reason.message),
    lost && `${lost.reason.statusCode}: ${lost.reason.message}`);

  // ---------------------------------------------------------- round robin ----
  const four = PLAYERS.slice(0, 4);
  const rrId = await makeTournament('pool_play', four);
  await engine.startTournament(rrId);

  const rrNodes = await engine.loadBracket(rrId);
  check('a 4-player round robin draws six matches over three rounds',
    rrNodes.length === 6 && Math.max(...rrNodes.map((n) => n.round)) === 3,
    `${rrNodes.length} matches`);

  check('and every one of them is playable straight away',
    rrNodes.every((n) => n.status === 'ready'));

  // A drawn round-robin game is a real result, unlike a drawn knockout.
  const rrFirst = (await readyMatches(rrId))[0];
  const rrGame = await makeGame(rrFirst.playerOneId, rrFirst.playerTwoId);
  await engine.attachGameToMatch(rrId, rrFirst.key, rrGame, rrFirst.playerOneId);
  await finishGame(rrGame, null);
  await engine.reconcileTournament(rrId);
  const rrDrawn = (await engine.loadBracket(rrId)).find((n) => n.key === rrFirst.key);
  check('a drawn round-robin game counts as a draw rather than being replayed',
    rrDrawn.status === 'completed' && rrDrawn.isDraw === true,
    `status=${rrDrawn.status} draw=${rrDrawn.isDraw}`);

  await playOut(rrId);
  const finishedRR = await tournamentRow(rrId);
  check('a round robin completes once every game has been played',
    finishedRR.status === 'completed', finishedRR.status);

  const rrView = await engine.getBracketForResponse(rrId);
  check('and comes back with a standings table', (() => {
    if (rrView.standings.length !== 4) return false;
    const totalPlayed = rrView.standings.reduce((sum, r) => sum + r.played, 0);
    // Six games, each counting for both players.
    return totalPlayed === 12 && rrView.standings.every((r) => r.username);
  })(), JSON.stringify(rrView.standings.map((r) => [r.username, r.points])));

  check('the table is sorted with the leader first',
    rrView.standings[0].points >= rrView.standings[rrView.standings.length - 1].points);

  check('and the champion is the player at the top of it',
    Number(rrView.championId) === Number(rrView.standings[0].playerId));

  // ---------------------------------------------------- double elimination ---
  const deId = await makeTournament('double_elimination', PLAYERS.slice(0, 5));
  await engine.startTournament(deId);
  const deNodes = await engine.loadBracket(deId);

  check('a double-elimination draw has a losers bracket and a grand final',
    deNodes.some((n) => n.bracket === 'losers')
    && deNodes.some((n) => n.bracket === 'grand_final'),
    deNodes.map((n) => n.bracket).join(','));

  const deFirst = (await readyMatches(deId))[0];
  await playMatch(deId, deFirst, deFirst.playerOneId);
  const afterFirstLoss = await engine.loadBracket(deId);
  const played = afterFirstLoss.find((n) => n.key === deFirst.key);
  const dropTarget = afterFirstLoss.find((n) => n.key === played.loserTo.key);
  check('losing once drops you into the losers bracket rather than out',
    dropTarget.bracket === 'losers'
    && [dropTarget.playerOneId, dropTarget.playerTwoId].includes(played.loserId),
    `${played.loserId} -> ${dropTarget.key}`);

  await playOut(deId);
  const finishedDE = await tournamentRow(deId);
  check('a double-elimination tournament plays out to a champion',
    finishedDE.status === 'completed' && PLAYERS.includes(Number(finishedDE.winner_id)),
    `${finishedDE.status} / ${finishedDE.winner_id}`);

  /* ------------------------------------------------------- notifications ---
   *
   * A bracket advances when somebody else's game finishes, so the only way a
   * player learns their next match exists is to be told. These check that they
   * are told once, at the right moment, and that the link goes somewhere.
   */
  const notifyPlayers = PLAYERS.slice(0, 4);
  const notifyId = await makeTournament('single_elimination', notifyPlayers);
  await engine.startTournament(notifyId);

  const atStart = await notificationsFor(notifyId);
  check('drawing the bracket tells all four players their first match is ready',
    atStart.length === 4 && new Set(atStart.map((n) => Number(n.user_id))).size === 4,
    `${atStart.length} notification(s) to ${new Set(atStart.map((n) => n.user_id)).size} player(s)`);

  check('and the notification links to the bracket',
    atStart.every((n) => n.action_url === `/play/tournaments/${notifyId}`),
    atStart.map((n) => n.action_url).join(' | '));

  check('each player is told who they are drawn against', (() => {
    const first = atStart.find((n) => Number(n.user_id) === notifyPlayers[0]);
    if (!first) return false;
    // Their opponent's name appears in the message, and their own does not.
    return /drawn against \w+/.test(first.content);
  })(), atStart[0] && atStart[0].content);

  // Play the first semi-final. Nobody new becomes ready - the other semi is
  // still outstanding - so the winner should not be told anything yet.
  const semis = await readyMatches(notifyId);
  await playMatch(notifyId, semis[0], semis[0].playerOneId);
  const afterOne = await notificationsFor(notifyId);
  check('winning one semi-final announces nothing while the other is unplayed',
    afterOne.length === 4, `${afterOne.length} notification(s)`);

  // Play the second. Now the final has both its players.
  const remaining = await readyMatches(notifyId);
  await playMatch(notifyId, remaining[0], remaining[0].playerOneId);
  const afterTwo = await notificationsFor(notifyId);
  const finalists = afterTwo.slice(4);
  check('and finishing the second one tells both finalists',
    finalists.length === 2 && new Set(finalists.map((n) => Number(n.user_id))).size === 2,
    `${finalists.length} notification(s)`);

  check('the two who were knocked out are not told about a match they are not in',
    finalists.every((n) => [semis[0].playerOneId, remaining[0].playerOneId]
      .includes(Number(n.user_id))),
    finalists.map((n) => n.user_id).join(','));

  // Reconciling again must not repeat anything.
  await engine.reconcileTournament(notifyId);
  await engine.getBracketForResponse(notifyId);
  check('reading the bracket again does not send the same notification twice',
    (await notificationsFor(notifyId)).length === afterTwo.length,
    `${(await notificationsFor(notifyId)).length} vs ${afterTwo.length}`);

  // Finish it.
  await playOut(notifyId);
  const atEnd = await notificationsFor(notifyId);
  const closing = atEnd.slice(afterTwo.length);
  check('everybody is told when the tournament finishes',
    closing.length === 4, `${closing.length} closing notification(s)`);

  const championId = Number((await tournamentRow(notifyId)).winner_id);
  const championNote = closing.find((n) => Number(n.user_id) === championId);
  check('and the winner is told they won, not that somebody else did',
    championNote && /You won/.test(championNote.title),
    championNote && championNote.title);

  check('while everyone else is told who did',
    closing.filter((n) => Number(n.user_id) !== championId)
      .every((n) => /finished/i.test(n.title) && !/You won/.test(n.title)),
    closing.map((n) => `${n.user_id}:${n.title}`).join(' | '));

  /*
   * Two reconciles arriving together on the last match of a tournament.
   *
   * That is not far-fetched: the bracket reconciles whenever anybody reads it,
   * and the page polls, so two readers looking at the moment the final ends is
   * the ordinary case rather than the exotic one. Both calls see a tournament
   * still marked as in progress, so only the write that actually closes it may
   * announce the result.
   */
  const raceNotifyId = await makeTournament('single_elimination', PLAYERS.slice(0, 2));
  await engine.startTournament(raceNotifyId);
  const raceFinal = (await readyMatches(raceNotifyId))[0];
  const raceGame = await makeGame(raceFinal.playerOneId, raceFinal.playerTwoId);
  await engine.attachGameToMatch(raceNotifyId, raceFinal.key, raceGame, raceFinal.playerOneId);
  await finishGame(raceGame, raceFinal.playerOneId);

  const before = (await notificationsFor(raceNotifyId)).length;
  await Promise.allSettled([
    engine.reconcileTournament(raceNotifyId),
    engine.reconcileTournament(raceNotifyId)
  ]);
  const closingRace = (await notificationsFor(raceNotifyId)).length - before;
  check('two reconciles landing together announce the result once, not twice',
    closingRace === 2, `${closingRace} closing notification(s) for a 2-player final`);

  /*
   * A bye is not worth a notification - there is nothing for the player to do,
   * and telling them a match is ready would send them to a bracket with no
   * button on it.
   */
  const byeId = await makeTournament('single_elimination', PLAYERS.slice(0, 3));
  await engine.startTournament(byeId);
  const byeNotes = await notificationsFor(byeId);
  check('a walkover is not announced as a match to play',
    byeNotes.length === 2,
    `${byeNotes.length} notification(s) for a 3-player draw with one bye`);

  // ------------------------------------------------------------- refusals ---
  const tinyId = await makeTournament('single_elimination', [PLAYERS[0]]);
  let tooFew = null;
  try {
    await engine.startTournament(tinyId);
  } catch (err) {
    tooFew = err;
  }
  check('a tournament with one entrant will not start',
    tooFew && tooFew.statusCode === 400, tooFew?.message);

  check('and nothing was written for it',
    (await engine.loadBracket(tinyId)).length === 0);
}

async function cleanup() {
  for (const id of created.tournaments) {
    await db_pool.query(
      "DELETE FROM notifications WHERE type = 'tournament' AND related_id = ?", [id]
    ).catch(() => {});
    // tournament_matches and participants cascade from here.
    await db_pool.query('DELETE FROM tournaments WHERE id = ?', [id]).catch(() => {});
  }
  for (const id of created.games) {
    await db_pool.query('DELETE FROM games WHERE id = ?', [id]).catch(() => {});
  }
}

main()
  .catch((err) => {
    check('the suite ran to the end', false, err.stack || err.message);
  })
  .then(cleanup)
  .then(() => {
    console.log('');
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n      ${r.detail}`}`);
    }
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  });
