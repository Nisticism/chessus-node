/*
 * The tournament match tree.
 *
 *   node scripts/e2e/tournament-bracket-test.js
 *
 * Bracket generators are easy to write so that they look right at 8 players and
 * fall apart at 5 or 11, so most of this plays the brackets out - every field
 * size from 2 to 33, every result decided by a fixed pseudo-random sequence -
 * and checks the things that have to be true of a finished tournament:
 *
 *   - single elimination: one loss is the end of you, and one player is left;
 *   - double elimination: two losses is the end of you, nobody is dropped on
 *     one, and nobody plays a match they are not entitled to;
 *   - round robin: everybody plays everybody exactly once, and nobody plays
 *     twice in the same round.
 */
const {
  BYE,
  seedOrder,
  bracketSize,
  buildBracket,
  buildSingleElimination,
  buildDoubleElimination,
  buildRoundRobin,
  applyResult,
  computeStandings,
  championOf
} = require('../../server/tournament-bracket');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

/* A fixed sequence, so a failure can be reproduced exactly. */
const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const players = (n) => Array.from({ length: n }, (_, i) => i + 1);
const isReal = (id) => id != null && id !== BYE;

/**
 * Play a bracket to the end, choosing winners with `rand`.
 * Returns the finished nodes and a per-player loss count.
 */
const playOut = (format, ids, rand) => {
  const nodes = buildBracket(format, ids);
  const losses = new Map(ids.map((id) => [String(id), 0]));
  let guard = 0;

  for (;;) {
    if (guard += 1, guard > 10000) throw new Error('bracket never finished');
    const next = nodes.find((n) => n.status === 'ready');
    if (!next) break;
    const winner = rand() < 0.5 ? next.playerOneId : next.playerTwoId;
    const loser = winner === next.playerOneId ? next.playerTwoId : next.playerOneId;
    applyResult(nodes, next.key, winner);
    if (isReal(loser)) losses.set(String(loser), losses.get(String(loser)) + 1);
  }

  return { nodes, losses };
};

// ---------------------------------------------------------------- seeding ---

check('the seeding order for 8 puts the top seed against the bottom one',
  JSON.stringify(seedOrder(8)) === JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]),
  JSON.stringify(seedOrder(8)));

check('and for 16 it is still a permutation of every seed',
  new Set(seedOrder(16)).size === 16 && Math.max(...seedOrder(16)) === 16);

check('the top two seeds can only meet in the final', (() => {
  // In a bracket of 16, seed 1 and seed 2 must sit in opposite halves.
  const order = seedOrder(16);
  return order.slice(0, 8).includes(1) && order.slice(8).includes(2);
})());

check('a bracket is padded up to a power of two',
  bracketSize(5) === 8 && bracketSize(8) === 8 && bracketSize(9) === 16 && bracketSize(2) === 2);

// ----------------------------------------------------- single elimination ---

check('single elimination has one match fewer than the bracket seats', (() => {
  const nodes = buildSingleElimination(players(8));
  return nodes.length === 7;
})());

check('an 8-player draw pairs the top seed with the bottom seed first', (() => {
  const nodes = buildSingleElimination(players(8));
  const first = nodes.find((n) => n.round === 1 && n.slot === 0);
  return first.playerOneId === 1 && first.playerTwoId === 8;
})());

check('every first-round match feeds a distinct seat in the second round', (() => {
  const nodes = buildSingleElimination(players(8));
  const seats = nodes
    .filter((n) => n.round === 1)
    .map((n) => `${n.winnerTo.key}:${n.winnerTo.slot}`);
  return new Set(seats).size === seats.length;
})());

check('a 5-player field gives the top three seeds a bye, not the bottom three', (() => {
  const nodes = buildBracket('single_elimination', players(5));
  const walkovers = nodes.filter((n) => n.round === 1 && n.status === 'bye').map((n) => n.winnerId);
  // 8-seat bracket, 5 entrants: seeds 1, 2 and 3 draw the byes.
  return walkovers.length === 3 && [1, 2, 3].every((s) => walkovers.includes(s));
})());

check('a bye advances its player without waiting for a game', (() => {
  const nodes = buildBracket('single_elimination', players(5));
  const second = nodes.find((n) => n.round === 2 && n.slot === 0);
  // Seed 1 walked over, so it is already seated in the semi-final.
  return second.playerOneId === 1;
})());

// ----------------------------------------------------- double elimination ---

check('double elimination has 2n-2 matches plus the grand final and its reset', (() => {
  const nodes = buildDoubleElimination(players(8));
  const winners = nodes.filter((n) => n.bracket === 'winners').length;
  const losers = nodes.filter((n) => n.bracket === 'losers').length;
  return winners === 7 && losers === 6
    && nodes.filter((n) => n.bracket === 'grand_final').length === 1
    && nodes.filter((n) => n.bracket === 'grand_final_reset').length === 1;
})(), JSON.stringify({
  w: buildDoubleElimination(players(8)).filter((n) => n.bracket === 'winners').length,
  l: buildDoubleElimination(players(8)).filter((n) => n.bracket === 'losers').length
}));

check('every winners match except the final sends its loser somewhere', (() => {
  const nodes = buildDoubleElimination(players(16));
  return nodes
    .filter((n) => n.bracket === 'winners')
    .every((n) => n.loserTo && n.loserTo.key);
})());

check('no two winners matches drop their losers into the same seat', (() => {
  const nodes = buildDoubleElimination(players(16));
  const seats = nodes
    .filter((n) => n.bracket === 'winners' && n.loserTo)
    .map((n) => `${n.loserTo.key}:${n.loserTo.slot}`);
  return new Set(seats).size === seats.length;
})());

check('and no two losers matches feed the same seat either', (() => {
  const nodes = buildDoubleElimination(players(16));
  const seats = nodes
    .filter((n) => n.bracket === 'losers' && n.winnerTo)
    .map((n) => `${n.winnerTo.key}:${n.winnerTo.slot}`);
  return new Set(seats).size === seats.length;
})());

check('every losers seat is fed by exactly one match', (() => {
  const nodes = buildDoubleElimination(players(16));
  const needed = new Set();
  nodes.filter((n) => n.bracket === 'losers').forEach((n) => {
    needed.add(`${n.key}:1`);
    needed.add(`${n.key}:2`);
  });
  const fed = new Set();
  nodes.forEach((n) => {
    for (const edge of [n.winnerTo, n.loserTo]) {
      if (edge && edge.key.startsWith('L')) fed.add(`${edge.key}:${edge.slot}`);
    }
  });
  const unfed = [...needed].filter((s) => !fed.has(s));
  return unfed.length === 0;
})(), 'some losers seat has nobody routed into it');

check('the grand final is fed by both bracket champions', (() => {
  const nodes = buildDoubleElimination(players(8));
  const gf = nodes.find((n) => n.bracket === 'grand_final');
  const feeders = nodes.filter((n) => n.winnerTo && n.winnerTo.key === gf.key);
  return feeders.length === 2
    && feeders.some((n) => n.bracket === 'winners' && n.winnerTo.slot === 1)
    && feeders.some((n) => n.bracket === 'losers' && n.winnerTo.slot === 2);
})());

check('winning the grand final from the winners bracket ends it', (() => {
  const { nodes } = playOut('double_elimination', players(4), makeRandom(7));
  const gf = nodes.find((n) => n.bracket === 'grand_final');
  const reset = nodes.find((n) => n.bracket === 'grand_final_reset');
  // Whoever came from the winners side sits in slot 1.
  if (String(gf.winnerId) !== String(gf.playerOneId)) return true; // covered below
  return reset.status === 'bye';
})());

check('winning it from the losers bracket forces the reset instead', (() => {
  // Drive a bracket by hand so the losers-side player takes the grand final.
  const nodes = buildBracket('double_elimination', players(4));
  const gf = nodes.find((n) => n.bracket === 'grand_final');
  const reset = nodes.find((n) => n.bracket === 'grand_final_reset');
  let guard = 0;
  for (;;) {
    if (guard += 1, guard > 100) return false;
    const next = nodes.find((n) => n.status === 'ready');
    if (!next) break;
    // In the grand final, let the losers-bracket player (slot 2) win.
    const winner = next.bracket === 'grand_final' ? next.playerTwoId : next.playerOneId;
    applyResult(nodes, next.key, winner);
  }
  return reset.status === 'completed' && gf.status === 'completed'
    && String(gf.winnerId) === String(gf.playerTwoId);
})());

// --------------------------------------------------------- played out ------

const singleFailures = [];
const doubleFailures = [];

for (let n = 2; n <= 33; n += 1) {
  const ids = players(n);

  // --- single elimination: one loss and you are out, one player left ---
  const single = playOut('single_elimination', ids, makeRandom(n * 31 + 5));
  const singleChampion = championOf('single_elimination', single.nodes, ids);
  const overLosses = [...single.losses.entries()].filter(([, l]) => l > 1);
  if (!isReal(singleChampion)) singleFailures.push(`${n}: no champion`);
  if (overLosses.length) singleFailures.push(`${n}: ${overLosses.length} player(s) lost twice`);
  if (single.losses.get(String(singleChampion)) !== 0) singleFailures.push(`${n}: champion had a loss`);
  const eliminated = [...single.losses.values()].filter((l) => l === 1).length;
  if (eliminated !== n - 1) singleFailures.push(`${n}: ${eliminated} eliminated, expected ${n - 1}`);

  // --- double elimination: two losses and you are out ---
  if (n >= 2) {
    const double = playOut('double_elimination', ids, makeRandom(n * 17 + 3));
    const champion = championOf('double_elimination', double.nodes, ids);
    if (!isReal(champion)) doubleFailures.push(`${n}: no champion`);

    const tooMany = [...double.losses.entries()].filter(([, l]) => l > 2);
    if (tooMany.length) doubleFailures.push(`${n}: ${tooMany.length} player(s) lost 3+ times`);

    // Nobody may be left standing with fewer than two losses except the winner.
    const stillAlive = [...double.losses.entries()]
      .filter(([id, l]) => l < 2 && String(id) !== String(champion));
    if (stillAlive.length) {
      doubleFailures.push(`${n}: ${stillAlive.length} player(s) out with fewer than 2 losses (${stillAlive.slice(0, 3).map(([id, l]) => `${id}:${l}`)})`);
    }

    // Every match that was actually played had two real players in it.
    const bad = double.nodes.filter((m) => m.status === 'completed'
      && (!isReal(m.playerOneId) || !isReal(m.playerTwoId)));
    if (bad.length) doubleFailures.push(`${n}: ${bad.length} match(es) played against a bye`);
  }
}

check('single elimination plays out correctly for every field size from 2 to 33',
  singleFailures.length === 0, singleFailures.slice(0, 5).join('; '));

check('double elimination never eliminates anyone on one loss, for 2 to 33 players',
  doubleFailures.length === 0, doubleFailures.slice(0, 5).join('; '));

// ------------------------------------------------------------ round robin ---

check('a round robin has every player meet every other exactly once', (() => {
  for (const n of [3, 4, 5, 6, 8, 11]) {
    const ids = players(n);
    const nodes = buildRoundRobin(ids);
    const pairs = new Map();
    for (const node of nodes) {
      if (!isReal(node.playerOneId) || !isReal(node.playerTwoId)) continue;
      const key = [node.playerOneId, node.playerTwoId].sort((a, b) => a - b).join('-');
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    const expected = (n * (n - 1)) / 2;
    if (pairs.size !== expected) return false;
    if ([...pairs.values()].some((c) => c !== 1)) return false;
  }
  return true;
})());

check('and nobody is asked to play two games in the same round', (() => {
  for (const n of [3, 4, 5, 6, 7, 8, 11]) {
    const nodes = buildRoundRobin(players(n));
    const byRound = new Map();
    for (const node of nodes) {
      if (!byRound.has(node.round)) byRound.set(node.round, []);
      byRound.get(node.round).push(node.playerOneId, node.playerTwoId);
    }
    for (const seats of byRound.values()) {
      const real = seats.filter(isReal);
      if (new Set(real).size !== real.length) return false;
    }
  }
  return true;
})());

check('an odd field gives each player exactly one bye round', (() => {
  const nodes = buildBracket('pool_play', players(5));
  const byeCounts = new Map(players(5).map((id) => [id, 0]));
  nodes.filter((n) => n.status === 'bye').forEach((n) => {
    const real = [n.playerOneId, n.playerTwoId].find(isReal);
    if (real != null) byeCounts.set(real, byeCounts.get(real) + 1);
  });
  return [...byeCounts.values()].every((c) => c === 1);
})());

check('the round count is one fewer than the field, rounded up to even', (() => {
  return Math.max(...buildRoundRobin(players(6)).map((n) => n.round)) === 5
    && Math.max(...buildRoundRobin(players(5)).map((n) => n.round)) === 5;
})());

// -------------------------------------------------------------- standings ---

check('standings score a win at 1 and a draw at a half', (() => {
  const ids = players(4);
  const nodes = buildBracket('pool_play', ids);
  const ready = nodes.filter((n) => n.status === 'ready');
  applyResult(nodes, ready[0].key, ready[0].playerOneId);
  applyResult(nodes, ready[1].key, null, { isDraw: true });
  const table = computeStandings(nodes, ids);
  const winner = table.find((r) => String(r.playerId) === String(ready[0].playerOneId));
  const drawer = table.find((r) => String(r.playerId) === String(ready[1].playerOneId));
  return winner.points === 1 && winner.wins === 1 && drawer.points === 0.5 && drawer.draws === 1;
})());

check('a tie on points is broken by the game between the tied players', (() => {
  const ids = [10, 20];
  const nodes = buildBracket('pool_play', ids);
  const only = nodes.find((n) => n.status === 'ready');
  applyResult(nodes, only.key, 20);
  const table = computeStandings(nodes, ids);
  return String(table[0].playerId) === '20';
})());

check('a round robin is not won until every game is played', (() => {
  const ids = players(4);
  const nodes = buildBracket('pool_play', ids);
  const first = nodes.find((n) => n.status === 'ready');
  applyResult(nodes, first.key, first.playerOneId);
  return championOf('pool_play', nodes, ids) === null;
})());

// ------------------------------------------------------------- refusals ----

check('an elimination match refuses to end in a draw', (() => {
  const nodes = buildBracket('single_elimination', players(4));
  const first = nodes.find((n) => n.status === 'ready');
  try {
    applyResult(nodes, first.key, null, { isDraw: true });
    return false;
  } catch (e) {
    return /cannot end in a draw/.test(e.message);
  }
})());

check('a result naming somebody who is not in the match is refused', (() => {
  const nodes = buildBracket('single_elimination', players(4));
  const first = nodes.find((n) => n.status === 'ready');
  try {
    applyResult(nodes, first.key, 999);
    return false;
  } catch (e) {
    return /not playing/.test(e.message);
  }
})());

check('a match cannot be decided twice', (() => {
  const nodes = buildBracket('single_elimination', players(4));
  const first = nodes.find((n) => n.status === 'ready');
  applyResult(nodes, first.key, first.playerOneId);
  const changed = applyResult(nodes, first.key, first.playerTwoId);
  return changed.length === 0 && String(nodes.find((n) => n.key === first.key).winnerId) === String(first.playerOneId);
})());

check('a one-player tournament is refused rather than drawn', (() => {
  try {
    buildBracket('single_elimination', [1]);
    return false;
  } catch (e) {
    return /at least two/.test(e.message);
  }
})());

// ------------------------------------------------------------------ report --

console.log('');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n      ${r.detail}`}`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
