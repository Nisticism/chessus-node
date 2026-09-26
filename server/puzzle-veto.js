/*
 * Vetoes in puzzles.
 *
 * A veto game lets one side ban the other's moves - BEFORE they move
 * (pre-emptive) or AFTER they show it, forcing them to choose again
 * (reactive). A puzzle in such a game has to include the vetoes, or it is a
 * puzzle about a different game.
 *
 * HOW A LINE CARRIES THEM
 *
 * Every ply may have `vetoes`: moves vetoed against THAT ply's mover by the
 * other side. What they mean depends on the style and on whose ply it is:
 *
 *   pre-emptive, solver's ply    the bot's bans, shown before the solver moves
 *                                (the first one is the bot's veto that opens
 *                                the puzzle, after their last move)
 *   pre-emptive, opponent's ply  the veto the SOLVER must submit after their
 *                                own move - part of the answer
 *   reactive, solver's ply       moves the bot rejects if the solver shows
 *                                them. Hidden; showing one costs nothing, the
 *                                solver just chooses again
 *   reactive, opponent's ply     the moves the opponent shows first, in order.
 *                                The solver should veto each, then let the
 *                                ply itself be played
 *
 * A reactive puzzle also opens with a decision: the setup move ("their last
 * move") is the opponent's move the solver decides on, and setup_move.vetoes
 * are the moves they showed before it. The stored position is the board after
 * the setup move, as for every puzzle; the solver is shown the board before
 * it until they have decided.
 *
 * HOW AN ANSWER IS JUDGED
 *
 * The solver's answer is a sequence of steps - a move, then (pre-emptive)
 * their veto, or (reactive) each veto-or-allow decision - and it is judged
 * exactly like a line of moves: as a prefix, step by step. A wrong veto or a
 * wrong decision is a wrong step, so partial credit counts the vetoes.
 *
 * Budgets: the per-turn limit applies (a veto has at most that many moves in
 * it). The per-game limit does not - a puzzle is one moment of a game, not a
 * whole one.
 */
const {
  buildGameState, applyPly, trulyLegalMoves, moveKey,
} = require('./puzzle-validation');

/** The game's veto rules, or null when it has none (same rule as the live game). */
function vetoConfigOf(gameType) {
  if (!gameType || !Number(gameType.veto_enabled) || Number(gameType.simultaneous_turns)) return null;
  return {
    style: gameType.veto_style === 'reactive' ? 'reactive' : 'preemptive',
    perTurn: Math.max(1, Math.min(5, Number(gameType.veto_per_turn_limit) || 1)),
    disallowPlacement: !!Number(gameType.veto_disallow_placement),
    disallowPromotion: !!Number(gameType.veto_disallow_promotion),
  };
}

const isPlace = (m) => !!m && (m.type === 'place' || m.isPlacement);
const sq = (s) => (s ? { x: Number(s.x), y: Number(s.y) } : null);

/**
 * One vetoed move, as it is stored: squares, not piece ids. A placement is
 * banned by square, whatever would be put there - the live game's rule.
 */
function cleanVeto(m) {
  if (!m || !m.to) return null;
  if (isPlace(m)) return { type: 'place', to: sq(m.to) };
  if (!m.from) return null;
  const out = { from: sq(m.from), to: sq(m.to) };
  if (m.isRangedAttack) out.isRangedAttack = true;
  if (m.isCastling) {
    out.isCastling = true;
    if (m.castlingWith != null) out.castlingWith = m.castlingWith;
  }
  if (m.via) out.via = sq(m.via);
  return out;
}

/** The identity of a vetoed move: which move it is on the board. */
function vetoKey(m) {
  if (!m || !m.to) return '';
  if (isPlace(m)) return `place:${m.to.x},${m.to.y}`;
  const parts = [`${m.from ? m.from.x : '?'},${m.from ? m.from.y : '?'}>${m.to.x},${m.to.y}`];
  if (m.isRangedAttack) parts.push('r');
  if (m.isCastling) parts.push('c');
  if (m.via) parts.push(`v${m.via.x},${m.via.y}`);
  return parts.join('|');
}

const vetoSetKey = (list) => (Array.isArray(list) ? list : [])
  .map(vetoKey).filter(Boolean).sort().join(';');

/** Does this move fall under any veto in the list? */
function isVetoed(move, list) {
  const k = vetoKey(move);
  return !!k && (Array.isArray(list) ? list : []).some((v) => vetoKey(v) === k);
}

/** A stored line or setup move with every veto list normalised (for saving). */
function cleanVetoList(list, cfg) {
  if (!Array.isArray(list) || !list.length) return undefined;
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const v = cleanVeto(raw);
    if (!v) continue;
    if (cfg?.disallowPlacement && v.type === 'place') continue;
    const k = vetoKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.length ? out : undefined;
}

/** The move a decision is about, stripped of its own veto list. */
const proposalOf = (ply) => {
  if (!ply) return null;
  const { vetoes, ...rest } = ply; // eslint-disable-line no-unused-vars
  return rest;
};

/*
 * The solver's answer as a list of steps, in the order they are played.
 *
 *   { kind: 'move',   ply, plyIndex }
 *   { kind: 'veto',   set, plyIndex }             pre-emptive: bans on reply plyIndex
 *   { kind: 'decide', proposal, answer, plyIndex } reactive: answer true = veto it.
 *                                                  plyIndex -1 is the opening.
 */
function answerSteps(puzzle, line, cfg) {
  const steps = [];
  const plies = Array.isArray(line) ? line : [];
  if (!cfg) {
    plies.forEach((ply, i) => { if (i % 2 === 0) steps.push({ kind: 'move', ply, plyIndex: i }); });
    return steps;
  }
  const decideOn = (ply, plyIndex) => {
    for (const p of (ply.vetoes || [])) steps.push({ kind: 'decide', proposal: p, answer: true, plyIndex });
    steps.push({ kind: 'decide', proposal: proposalOf(ply), answer: false, plyIndex });
  };
  const setup = puzzle?.setup_move;
  if (cfg.style === 'reactive' && setup?.from && setup?.to) decideOn(setup, -1);
  for (let i = 0; i < plies.length; i += 2) {
    steps.push({ kind: 'move', ply: plies[i], plyIndex: i });
    const reply = plies[i + 1];
    if (!reply) continue;
    if (cfg.style === 'preemptive') steps.push({ kind: 'veto', set: reply.vetoes || [], plyIndex: i + 1 });
    else decideOn(reply, i + 1);
  }
  return steps;
}

/** Is a submitted step the step expected? */
function stepMatches(expected, given) {
  if (!expected || !given || given.kind !== expected.kind) return false;
  if (expected.kind === 'move') return moveKey(given.move) === moveKey(expected.ply);
  if (expected.kind === 'veto') return vetoSetKey(given.vetoes) === vetoSetKey(expected.set);
  if (expected.kind === 'decide') return !!given.veto === !!expected.answer;
  return false;
}

/*
 * What the solver is asked for next, after `matched` correct steps. Never
 * carries the answer: a ban the bot made (pre-emptive) is information the
 * solver would have in the game; a move shown for a decision likewise.
 */
function nextPrompt(steps, matched, line, cfg) {
  const next = steps[matched];
  if (!next) return null;
  if (next.kind === 'move') {
    const banned = cfg?.style === 'preemptive' ? (line[next.plyIndex]?.vetoes || []) : [];
    return { expect: 'move', banned };
  }
  if (next.kind === 'veto') return { expect: 'veto', limit: cfg.perTurn };
  return { expect: 'decide', proposal: next.proposal, opening: next.plyIndex === -1 };
}

/*
 * The opponent's move that is played now, when the step just matched finished
 * their turn: the veto that preceded a pre-emptive reply, or the "allow" that
 * let a reactive one through. The opening's allowed move is the setup move.
 */
function replyAfter(steps, matched, line, puzzle) {
  const last = steps[matched - 1];
  if (!last) return null;
  if (last.kind === 'veto') return proposalOf(line[last.plyIndex]);
  if (last.kind === 'decide' && last.answer === false) {
    return last.plyIndex === -1 ? proposalOf(puzzle.setup_move) : proposalOf(line[last.plyIndex]);
  }
  return null;
}

/** How many of the line's plies have been played after `matched` steps. */
function pliesPlayed(steps, matched) {
  let played = 0;
  for (let i = 0; i < matched; i++) {
    const s = steps[i];
    if (s.kind === 'move') played = Math.max(played, s.plyIndex + 1);
    else if (s.kind === 'veto') played = Math.max(played, s.plyIndex + 1);
    else if (s.kind === 'decide' && s.answer === false && s.plyIndex >= 0) played = Math.max(played, s.plyIndex + 1);
  }
  return played;
}

/** The board BEFORE the setup move: the moved piece back on its square. */
function positionBeforeSetup(position, setup) {
  if (!Array.isArray(position) || !setup?.from || !setup?.to) return position;
  return position.map((p) => (Number(p.x) === Number(setup.to.x) && Number(p.y) === Number(setup.to.y)
    ? { ...p, x: Number(setup.from.x), y: Number(setup.from.y) }
    : p));
}

/*
 * Would this move be legal for `side` in `state`? Tried on a fresh copy, since
 * the engine mutates what it is given. A placement veto names a square only,
 * so it is legal when anything placeable could go there.
 */
async function legalFor(makeState, side, move) {
  const tryOne = async (m) => {
    const state = await makeState();
    state.currentTurn = Number(side);
    // A veto names squares, not pieces; the engine wants the piece's id.
    let ply = m;
    if (!isPlace(m) && m.from) {
      const piece = (state.pieces || []).find((p) => Number(p.x) === Number(m.from.x) && Number(p.y) === Number(m.from.y));
      if (!piece) return false;
      ply = { ...m, pieceId: piece.id };
    }
    const r = await applyPly(state, ply, { autoPromote: true });
    return r.ok;
  };
  if (isPlace(move)) {
    const probe = await makeState();
    const templates = probe.otherGameData?.placeable_pieces || [];
    for (const t of templates) {
      // eslint-disable-next-line no-await-in-loop
      if (await tryOne({ type: 'place', placePieceId: Number(t.piece_id), to: move.to })) return true;
    }
    return false;
  }
  return tryOne({ ...move });
}

/*
 * Problems with a puzzle's vetoes, as sentences for the creator - empty when
 * there are none. `puzzle.position` is hydrated. Checked: every veto is a
 * move the mover could actually make there; none bans the move the line then
 * plays; no veto is larger than the per-turn limit; and a pre-emptive veto
 * leaves the mover something to do.
 */
async function vetoProblems(puzzle, gameType, line, cfg) {
  if (!cfg) return [];
  const problems = [];
  const side = Number(puzzle.side_to_move) || 1;
  const other = side === 1 ? 2 : 1;
  const plies = Array.isArray(line) ? line : [];

  // A board after the setup and the first `n` plies, freshly built each call.
  const stateAfter = (n) => async () => {
    const state = buildGameState(puzzle, gameType);
    for (let i = 0; i < n; i++) {
      state.currentTurn = i % 2 === 0 ? side : other;
      // eslint-disable-next-line no-await-in-loop
      const r = await applyPly(state, plies[i], { autoPromote: true });
      if (!r.ok) break;
    }
    return state;
  };

  const checkList = async (label, list, mover, makeState, played) => {
    if (!list?.length) return;
    if (list.length > cfg.perTurn) {
      problems.push(`${label}: ${list.length} vetoes, but this game allows ${cfg.perTurn} per turn.`);
    }
    for (const v of list) {
      if (cfg.disallowPlacement && isPlace(v)) {
        problems.push(`${label}: placements cannot be vetoed in this game.`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      if (!(await legalFor(makeState, mover, v))) {
        problems.push(`${label}: a vetoed move (${vetoKey(v)}) is not a move Player ${mover} could make there.`);
      }
    }
    if (played && isVetoed(played, list)) {
      problems.push(`${label}: the move the line plays is itself vetoed.`);
    }
    if (cfg.style === 'preemptive') {
      const state = await makeState();
      state.currentTurn = mover;
      const legal = await trulyLegalMoves(state, mover);
      const left = (legal || []).filter((m) => !isVetoed(m.move || m, list));
      if (legal?.length && !left.length) {
        problems.push(`${label}: the veto leaves Player ${mover} with no legal move, which the game never allows.`);
      }
    }
  };

  // Reactive opening: moves shown before the setup move, on the board before it.
  const setup = puzzle.setup_move;
  if (cfg.style === 'reactive' && setup?.vetoes?.length) {
    const before = positionBeforeSetup(puzzle.position, setup);
    const makeState = async () => buildGameState({ ...puzzle, position: JSON.parse(JSON.stringify(before)), setup_move: null }, gameType);
    await checkList('Their opening move', setup.vetoes, other, makeState, setup);
  }

  for (let i = 0; i < plies.length; i++) {
    const mover = i % 2 === 0 ? side : other;
    const whose = i % 2 === 0 ? `Your move ${i / 2 + 1}` : `Their reply ${(i + 1) / 2}`;
    // eslint-disable-next-line no-await-in-loop
    await checkList(whose, plies[i]?.vetoes, mover, stateAfter(i), plies[i]);
  }
  return problems;
}

module.exports = {
  vetoConfigOf, cleanVeto, cleanVetoList, vetoKey, vetoSetKey, isVetoed,
  answerSteps, stepMatches, nextPrompt, replyAfter, pliesPlayed,
  positionBeforeSetup, vetoProblems, proposalOf,
};
