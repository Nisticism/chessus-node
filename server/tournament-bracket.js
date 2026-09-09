/*
 * Tournament brackets: the match tree.
 *
 * A bracket is a tree of matches, and the only thing that ever happens to it is
 * "somebody won a match". So each match node carries the edges out of it -
 * where its winner goes, and (in double elimination) where its loser goes:
 *
 *     { key: 'W1-0', winnerTo: { key: 'W2-0', slot: 1 },
 *                     loserTo:  { key: 'L1-0', slot: 1 } }
 *
 * Recording a result is then a single write into the named slot of one other
 * node - O(1), with no re-derivation of the bracket from the list of results.
 * The whole shape is decided once, when the tournament starts, and after that
 * the tree only ever gets filled in.
 *
 * Storing the tree by its edges rather than by array arithmetic is what makes
 * the same code work for all three formats. Single elimination is a binary tree
 * whose edges all point at the parent; double elimination is that same tree
 * plus a second edge per node into the losers bracket, which changes nothing
 * about how a result is recorded; a round robin has no edges at all, just
 * rounds of independent matches and a table.
 *
 * Everything here is pure: no database, no clock, no randomness. It takes a
 * list of player ids and gives back a list of plain nodes, which is what makes
 * it testable against the corner cases that only show up at 3 or 11 players.
 */

/** The stand-in for an absent player in a bracket padded out to a power of two. */
const BYE = 'BYE';

const isRealPlayer = (id) => id != null && id !== BYE;

/**
 * The seeding order for a bracket of `size`.
 *
 * Returns seed numbers in bracket-slot order, so that the top seed and the
 * second seed can only meet in the final, the top four only in the semis, and
 * so on: [1, 8, 4, 5, 2, 7, 3, 6] for eight.
 *
 * Built by doubling: every seed s in a bracket of n becomes the pair
 * (s, 2n + 1 - s) in a bracket of 2n, which is the rule that produces the
 * familiar "the top seed plays the bottom seed" layout at every level at once.
 */
const seedOrder = (size) => {
  let order = [1];
  let current = 1;
  while (current < size) {
    const next = current * 2;
    const doubled = [];
    for (const seed of order) {
      doubled.push(seed, next + 1 - seed);
    }
    order = doubled;
    current = next;
  }
  return order;
};

/** The smallest power of two that seats everyone. */
const bracketSize = (playerCount) => {
  let size = 1;
  while (size < playerCount) size *= 2;
  return Math.max(2, size);
};

const BRACKET_PREFIXES = {
  winners: 'W',
  losers: 'L',
  round_robin: 'R',
  grand_final: 'G',
  grand_final_reset: 'GR'
};

const makeNode = (bracket, round, slot, extra = {}) => ({
  key: `${BRACKET_PREFIXES[bracket]}${round}-${slot}`,
  bracket,
  round,
  slot,
  playerOneId: null,
  playerTwoId: null,
  winnerId: null,
  loserId: null,
  isDraw: false,
  status: 'pending',
  winnerTo: null,
  loserTo: null,
  ...extra
});

/*
 * Single elimination.
 *
 * Round r has size/2^r matches, and match i of round r feeds match floor(i/2)
 * of round r+1, taking slot 1 or 2 depending on whether it is the even or the
 * odd child. That is the parent pointer of an ordinary binary heap, which is
 * why none of this needs explicit child links.
 */
const buildSingleElimination = (playerIds) => {
  const size = bracketSize(playerIds.length);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const nodes = [];

  for (let round = 1; round <= rounds; round += 1) {
    const matchCount = size / 2 ** round;
    for (let slot = 0; slot < matchCount; slot += 1) {
      const node = makeNode('winners', round, slot);
      if (round < rounds) {
        node.winnerTo = { key: `W${round + 1}-${Math.floor(slot / 2)}`, slot: (slot % 2) + 1 };
      }
      if (round === 1) {
        // Seats are filled from the seeding order; seeds past the end of the
        // entry list are byes, which is how a field of 5 plays in a bracket of
        // 8 without anybody sitting out a round by accident.
        node.playerOneId = playerIds[order[slot * 2] - 1] ?? BYE;
        node.playerTwoId = playerIds[order[slot * 2 + 1] - 1] ?? BYE;
      }
      nodes.push(node);
    }
  }

  return nodes;
};

/*
 * Double elimination.
 *
 * The winners bracket is exactly the single-elimination tree above. What is
 * added is a second, longer bracket that everyone drops into on their first
 * loss and leaves for good on their second.
 *
 * The losers bracket alternates between two kinds of round:
 *
 *   - a *drop* round, where the survivors meet the players who have just lost
 *     in the winners bracket. It keeps as many matches as the round before it,
 *     since each survivor is matched against one new arrival;
 *   - a *halving* round, where the survivors play each other and the bracket
 *     shrinks by half.
 *
 * Losers round 1 is the exception at the start: nobody has survived anything
 * yet, so it is made up entirely of the first round's losers playing each
 * other. From then on the rounds alternate drop, halve, drop, halve, which is
 * why a bracket of `size` has 2*(log2(size) - 1) losers rounds and size - 2
 * losers matches.
 */
const buildDoubleElimination = (playerIds) => {
  const size = bracketSize(playerIds.length);
  const winnerRounds = Math.log2(size);
  const nodes = buildSingleElimination(playerIds);
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  const grandFinal = makeNode('grand_final', 1, 0);
  const reset = makeNode('grand_final_reset', 1, 0);
  // The losers-bracket champion arrives with one loss; the winners-bracket
  // champion with none. Taking the title has to cost two, so if the grand
  // final goes to the player who came up through the losers bracket, it is
  // replayed once - the "bracket reset".
  grandFinal.resetKey = reset.key;

  byKey.get(`W${winnerRounds}-0`).winnerTo = { key: grandFinal.key, slot: 1 };

  if (winnerRounds === 1) {
    // Two entrants: there is no losers bracket to drop into, so the final is
    // simply a rematch that the loser of the first game has to win twice.
    byKey.get('W1-0').loserTo = { key: grandFinal.key, slot: 2 };
    return [...nodes, grandFinal, reset];
  }

  const loserNodes = [];
  const roundMatchCounts = [];

  // Losers round 1: the first round's losers, paired off among themselves.
  roundMatchCounts[1] = size / 4;
  for (let slot = 0; slot < roundMatchCounts[1]; slot += 1) {
    loserNodes.push(makeNode('losers', 1, slot));
  }

  // Then drop (even) and halving (odd) rounds, alternating to the end.
  for (let k = 1; k <= winnerRounds - 1; k += 1) {
    const dropRound = 2 * k;
    roundMatchCounts[dropRound] = size / 2 ** (k + 1);
    for (let slot = 0; slot < roundMatchCounts[dropRound]; slot += 1) {
      loserNodes.push(makeNode('losers', dropRound, slot));
    }

    const halveRound = 2 * k + 1;
    const halveCount = size / 2 ** (k + 2);
    if (halveCount >= 1) {
      roundMatchCounts[halveRound] = halveCount;
      for (let slot = 0; slot < halveCount; slot += 1) {
        loserNodes.push(makeNode('losers', halveRound, slot));
      }
    }
  }

  const lastLoserRound = 2 * (winnerRounds - 1);

  // Edges out of the losers bracket: each match feeds the next losers round,
  // and the last one feeds the grand final.
  for (const node of loserNodes) {
    const nextRound = node.round + 1;
    if (node.round === lastLoserRound) {
      node.winnerTo = { key: grandFinal.key, slot: 2 };
    } else if (nextRound % 2 === 0) {
      // Into a drop round, where the survivor keeps its position and waits for
      // an arrival from the winners bracket in slot 2.
      node.winnerTo = { key: `L${nextRound}-${node.slot}`, slot: 1 };
    } else {
      // Into a halving round, where survivors pair off as in any bracket.
      node.winnerTo = { key: `L${nextRound}-${Math.floor(node.slot / 2)}`, slot: (node.slot % 2) + 1 };
    }
  }

  // Winners round 1 fills both sides of losers round 1.
  nodes
    .filter((n) => n.bracket === 'winners' && n.round === 1)
    .forEach((source, index) => {
      source.loserTo = { key: `L1-${Math.floor(index / 2)}`, slot: (index % 2) + 1 };
    });

  /*
   * Where each later winners round drops into the losers bracket.
   *
   * The order is turned end for end on alternate rounds. Dropping players
   * straight down would keep sending the same two people at each other - the
   * pair who met in winners round 1 would meet again in losers round 2 - so
   * reversing the arrivals pushes a rematch as late as the bracket allows.
   */
  for (let k = 1; k <= winnerRounds - 1; k += 1) {
    const winnerRound = k + 1;
    const targetRound = 2 * k;
    const count = roundMatchCounts[targetRound];
    const reversed = winnerRound % 2 === 1;
    nodes
      .filter((n) => n.bracket === 'winners' && n.round === winnerRound)
      .forEach((source, index) => {
        const targetSlot = reversed ? count - 1 - (index % count) : index % count;
        source.loserTo = { key: `L${targetRound}-${targetSlot}`, slot: 2 };
      });
  }

  return [...nodes, ...loserNodes, grandFinal, reset];
};

/*
 * Round robin.
 *
 * Everyone plays everyone once, arranged by the circle method: fix one player
 * and rotate the rest, so that each of the n-1 rounds is a set of matches that
 * can all be played at the same time. With an odd number of players a bye is
 * added, and whoever is drawn against it sits that round out.
 *
 * There are no edges here - no match decides who plays in another - so the
 * standings are computed from the results instead.
 */
const buildRoundRobin = (playerIds) => {
  const entrants = [...playerIds];
  if (entrants.length % 2 === 1) entrants.push(BYE);

  const n = entrants.length;
  const rounds = n - 1;
  const half = n / 2;
  const nodes = [];

  // The first entrant stays put; the others rotate around it.
  const rotating = entrants.slice(1);

  for (let round = 1; round <= rounds; round += 1) {
    const lineup = [entrants[0], ...rotating];
    for (let i = 0; i < half; i += 1) {
      const home = lineup[i];
      const away = lineup[n - 1 - i];
      // Alternate who takes the first seat, so nobody plays every game from
      // the same side of the board.
      const flip = round % 2 === 0;
      const node = makeNode('round_robin', round, i);
      node.playerOneId = flip ? away : home;
      node.playerTwoId = flip ? home : away;
      nodes.push(node);
    }
    rotating.unshift(rotating.pop());
  }

  return nodes;
};

const buildBracket = (format, playerIds) => {
  const ids = playerIds.filter((id) => id != null);
  if (ids.length < 2) {
    throw new Error('A tournament needs at least two players to draw a bracket');
  }

  if (format === 'single_elimination') return settleBracket(buildSingleElimination(ids));
  if (format === 'double_elimination') return settleBracket(buildDoubleElimination(ids));
  if (format === 'pool_play' || format === 'round_robin') return settleBracket(buildRoundRobin(ids));
  throw new Error(`Unknown tournament format: ${format}`);
};

/**
 * Bring one node up to date: mark it ready once both seats are filled, or walk
 * a bye straight through it.
 *
 * Returns the keys of the nodes it changed, itself included.
 */
const settleNode = (byKey, node) => {
  const changed = [];
  if (!node || node.status === 'completed' || node.status === 'bye') return changed;

  const one = node.playerOneId;
  const two = node.playerTwoId;

  // An empty seat is not the same as a bye: it means the match that feeds it
  // has not been played yet. Settling on one would walk the other player over
  // an opponent who is still on their way, which stalls the bracket - the seat
  // never fills, and every match behind it waits forever.
  if (one == null || two == null) return changed;

  const oneIsBye = one === BYE;
  const twoIsBye = two === BYE;

  const pushInto = (edge, playerId) => {
    if (!edge) return;
    const target = byKey.get(edge.key);
    if (!target) return;
    if (edge.slot === 1) target.playerOneId = playerId;
    else target.playerTwoId = playerId;
    changed.push(target.key, ...settleNode(byKey, target));
  };

  if (oneIsBye && twoIsBye) {
    // Both seats empty: nothing to play, and nothing comes out the far side
    // either, so the emptiness has to be passed along.
    node.status = 'bye';
    changed.push(node.key);
    pushInto(node.winnerTo, BYE);
    pushInto(node.loserTo, BYE);
    return changed;
  }

  if (oneIsBye || twoIsBye) {
    // A walkover: the real player advances without a game being played.
    node.status = 'bye';
    node.winnerId = oneIsBye ? two : one;
    node.loserId = null;
    changed.push(node.key);
    pushInto(node.winnerTo, node.winnerId);
    // Nobody actually lost, so the losers-bracket seat stays empty and whoever
    // is waiting there gets a walkover of their own.
    pushInto(node.loserTo, BYE);
    return changed;
  }

  if (isRealPlayer(one) && isRealPlayer(two) && node.status === 'pending') {
    node.status = 'ready';
    changed.push(node.key);
  }

  return changed;
};

/** Walk every bye through the bracket once, at the moment it is drawn. */
const settleBracket = (nodes) => {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // In bracket order, so a bye cascades all the way forward in one pass.
  for (const node of nodes) settleNode(byKey, node);
  return nodes;
};

/**
 * Record a result and push the players along their edges.
 *
 * Returns the keys of every node that changed, so a caller with a database
 * behind it can write back those rows alone rather than the whole bracket.
 */
const applyResult = (nodes, key, winnerId, { isDraw = false } = {}) => {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const node = byKey.get(key);
  if (!node) throw new Error(`No match ${key} in this bracket`);
  if (node.status === 'completed' || node.status === 'bye') return [];

  const changed = new Set([key]);

  if (isDraw) {
    // Only a round robin can end level. An elimination match has to produce
    // somebody to advance, so a draw there is refused and the match is left
    // open for a replay.
    if (node.bracket !== 'round_robin') {
      throw new Error(`Match ${key} is an elimination match and cannot end in a draw`);
    }
    node.isDraw = true;
    node.status = 'completed';
    node.winnerId = null;
    node.loserId = null;
    return [...changed];
  }

  if (!isRealPlayer(winnerId)) throw new Error(`Match ${key} needs a winner`);
  if (String(node.playerOneId) !== String(winnerId) && String(node.playerTwoId) !== String(winnerId)) {
    throw new Error(`${winnerId} is not playing in match ${key}`);
  }

  node.status = 'completed';
  node.isDraw = false;
  node.winnerId = winnerId;
  node.loserId = String(node.playerOneId) === String(winnerId) ? node.playerTwoId : node.playerOneId;

  const advance = (edge, playerId) => {
    if (!edge || !isRealPlayer(playerId)) return;
    const target = byKey.get(edge.key);
    if (!target) return;
    if (edge.slot === 1) target.playerOneId = playerId;
    else target.playerTwoId = playerId;
    changed.add(target.key);
    for (const settled of settleNode(byKey, target)) changed.add(settled);
  };

  advance(node.winnerTo, node.winnerId);
  advance(node.loserTo, node.loserId);

  /*
   * The bracket reset. If the player who came up through the losers bracket
   * takes the grand final, both finalists have one loss and the title is
   * decided by one more game.
   */
  if (node.bracket === 'grand_final' && node.resetKey) {
    const resetNode = byKey.get(node.resetKey);
    if (resetNode) {
      if (String(node.winnerId) === String(node.playerTwoId)) {
        resetNode.playerOneId = node.playerOneId;
        resetNode.playerTwoId = node.playerTwoId;
        changed.add(resetNode.key);
        for (const settled of settleNode(byKey, resetNode)) changed.add(settled);
      } else {
        // The winners-bracket player held on, so there is nothing left to play.
        resetNode.status = 'bye';
        changed.add(resetNode.key);
      }
    }
  }

  return [...changed];
};

/**
 * Round-robin standings.
 *
 * A win is worth 1 and a draw 0.5. Ties are broken first on the result between
 * the tied players and then on wins, which rewards beating people over drawing
 * with them.
 */
const computeStandings = (nodes, playerIds) => {
  const table = new Map(playerIds.map((id) => [String(id), {
    playerId: id, played: 0, wins: 0, draws: 0, losses: 0, points: 0
  }]));

  const played = nodes.filter((n) => n.status === 'completed' && n.bracket === 'round_robin');

  for (const node of played) {
    const one = table.get(String(node.playerOneId));
    const two = table.get(String(node.playerTwoId));
    if (!one || !two) continue;

    one.played += 1;
    two.played += 1;

    if (node.isDraw) {
      one.draws += 1; two.draws += 1;
      one.points += 0.5; two.points += 0.5;
      continue;
    }

    const winner = String(node.winnerId) === String(node.playerOneId) ? one : two;
    const loser = winner === one ? two : one;
    winner.wins += 1;
    winner.points += 1;
    loser.losses += 1;
  }

  const headToHead = (a, b) => {
    const match = played.find((n) => {
      const ids = [String(n.playerOneId), String(n.playerTwoId)];
      return ids.includes(String(a.playerId)) && ids.includes(String(b.playerId));
    });
    if (!match || match.isDraw) return 0;
    if (String(match.winnerId) === String(a.playerId)) return -1;
    if (String(match.winnerId) === String(b.playerId)) return 1;
    return 0;
  };

  return [...table.values()].sort((a, b) => (
    b.points - a.points
    || headToHead(a, b)
    || b.wins - a.wins
    || String(a.playerId).localeCompare(String(b.playerId))
  ));
};

/**
 * Who won the tournament, or null while it is still being played.
 */
const championOf = (format, nodes, playerIds = []) => {
  if (format === 'pool_play' || format === 'round_robin') {
    const outstanding = nodes.some((n) => n.bracket === 'round_robin' && n.status !== 'completed' && n.status !== 'bye');
    if (outstanding) return null;
    const standings = computeStandings(nodes, playerIds);
    return standings.length ? standings[0].playerId : null;
  }

  const reset = nodes.find((n) => n.bracket === 'grand_final_reset');
  if (reset && reset.status === 'completed') return reset.winnerId;
  if (reset && reset.status !== 'bye') {
    // A reset is still pending, so the grand final did not settle it.
    const grandFinal = nodes.find((n) => n.bracket === 'grand_final');
    if (grandFinal && grandFinal.status === 'completed'
      && String(grandFinal.winnerId) === String(grandFinal.playerTwoId)) return null;
  }

  const grandFinal = nodes.find((n) => n.bracket === 'grand_final');
  if (grandFinal) return grandFinal.status === 'completed' ? grandFinal.winnerId : null;

  const winners = nodes.filter((n) => n.bracket === 'winners');
  if (!winners.length) return null;
  const lastRound = Math.max(...winners.map((n) => n.round));
  const final = winners.find((n) => n.round === lastRound && n.slot === 0);
  if (!final) return null;
  return (final.status === 'completed' || final.status === 'bye') ? final.winnerId : null;
};

module.exports = {
  BYE,
  seedOrder,
  bracketSize,
  buildBracket,
  buildSingleElimination,
  buildDoubleElimination,
  buildRoundRobin,
  applyResult,
  settleBracket,
  settleNode,
  computeStandings,
  championOf
};
