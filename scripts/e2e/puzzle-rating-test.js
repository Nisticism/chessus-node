/*
 * Puzzle rating checks. Pure arithmetic against the real module - no server, no
 * database. The behaviour being pinned down is the SHAPE of the curve, which is
 * what was actually specified: losses shrink as you fall, gains shrink as you
 * rise.
 *
 *   node scripts/e2e/puzzle-rating-test.js
 */
const {
  rateAttempt, scoreAttempt, foldSolverIntoPuzzleRating, isRatingPublic,
  expectedScore, ANCHOR_RATING, PUZZLE_ELO_DEFAULT, MIN_SOLVERS_FOR_PUBLIC_RATING,
} = require('../../server/puzzle-rating');

// Everything is measured from the anchor, so the checks hold wherever it sits
// (1200 until 2026-10-08, 1000 since).
const A = ANCHOR_RATING;

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

// --- the curve ---------------------------------------------------------------
const solved = (elo, n = 50) => rateAttempt({ currentElo: elo, ratedAttemptsSoFar: n, solved: true }).delta;
const failed = (elo, n = 50) => rateAttempt({ currentElo: elo, ratedAttemptsSoFar: n, solved: false }).delta;

const ladder = [A - 400, A, A + 400, A + 800];
const gains = ladder.map(solved);
const losses = ladder.map(failed);
console.log(`  gains  by rating ${ladder.join('/')}: ${gains.join(', ')}`);
console.log(`  losses by rating ${ladder.join('/')}: ${losses.join(', ')}`);

check(
  'gains shrink as your rating rises',
  gains.every((g, i) => i === 0 || g < gains[i - 1]) && gains.every((g) => g > 0),
  gains.join(', ')
);
check(
  'losses shrink as your rating falls',
  losses.every((l, i) => i === 0 || Math.abs(l) > Math.abs(losses[i - 1])) && losses.every((l) => l < 0),
  losses.join(', ')
);
check('new players start at the anchor, on the same 1000 as game Elo',
  PUZZLE_ELO_DEFAULT === A && A === 1000, `default ${PUZZLE_ELO_DEFAULT}, anchor ${A}`);
check(
  'a solver at the anchor gains and loses symmetrically',
  Math.abs(solved(ANCHOR_RATING) + failed(ANCHOR_RATING)) <= 1,
  `${solved(ANCHOR_RATING)} vs ${failed(ANCHOR_RATING)}`
);
check(
  'solving always gains at least a point, however high you are',
  solved(A + 1200) >= 1 && solved(A + 800) >= 1,
  `${solved(A + 800)} at ${A + 800}, ${solved(A + 1200)} at ${A + 1200}`
);
check(
  'failing always costs at least a point, however low you are',
  failed(A - 800) <= -1,
  `${failed(A - 800)} at ${A - 800}`
);
check(
  'a new solver moves faster than a settled one',
  solved(A, 0) > solved(A, 100),
  `${solved(A, 0)} vs ${solved(A, 100)}`
);

// A rating should settle where solve rate meets expectation, not run away.
let elo = PUZZLE_ELO_DEFAULT;
for (let i = 0; i < 400; i++) {
  elo = rateAttempt({ currentElo: elo, ratedAttemptsSoFar: 100, solved: Math.random() < 0.9 }).after;
}
check(
  'a 90% solver settles well above the anchor rather than running away',
  elo > A + 200 && elo < A + 600,
  `settled at ${elo}`
);

let elo2 = PUZZLE_ELO_DEFAULT;
for (let i = 0; i < 400; i++) {
  elo2 = rateAttempt({ currentElo: elo2, ratedAttemptsSoFar: 100, solved: Math.random() < 0.5 }).after;
}
check('a 50% solver stays near the anchor', Math.abs(elo2 - ANCHOR_RATING) < 150, `settled at ${elo2}`);

// --- partial credit ----------------------------------------------------------
// Solutions are compared as a prefix, and a miss on the first move is worth
// nothing however much of the rest matches.
const same = (a, b) => a === b;
check('a full line scores 1', scoreAttempt(['a', 'b', 'c'], ['a', 'b', 'c'], same) === 1, 'x');
check('two of three scores two thirds', Math.abs(scoreAttempt(['a', 'b', 'x'], ['a', 'b', 'c'], same) - 2 / 3) < 1e-9, 'x');
check('one of four scores a quarter', scoreAttempt(['a'], ['a', 'b', 'c', 'd'], same) === 0.25, 'x');
check(
  'missing the first move scores nothing even if later moves match',
  scoreAttempt(['x', 'b', 'c'], ['a', 'b', 'c'], same) === 0,
  'x'
);
check('a single-move puzzle is all or nothing',
  scoreAttempt(['a'], ['a'], same) === 1 && scoreAttempt(['x'], ['a'], same) === 0, 'x');

const partial = rateAttempt({ currentElo: A, ratedAttemptsSoFar: 50, score: 0.5 });
const full = rateAttempt({ currentElo: A, ratedAttemptsSoFar: 50, score: 1 });
const none = rateAttempt({ currentElo: A, ratedAttemptsSoFar: 50, score: 0 });
console.log(`  at ${A}: full ${full.delta}, half ${partial.delta}, none ${none.delta}`);
check(
  'partial credit lands between a solve and a miss',
  partial.delta < full.delta && partial.delta > none.delta,
  `${none.delta} < ${partial.delta} < ${full.delta}`
);

// --- the puzzle's emergent rating -------------------------------------------
let pz = { rating: PUZZLE_ELO_DEFAULT, sampleCount: 0 };
// First solver replaces the placeholder rather than averaging with it.
pz = foldSolverIntoPuzzleRating({ rating: pz.rating, sampleCount: pz.sampleCount, solverElo: 1900 });
check('the first solver sets the rating outright', pz.rating === 1900 && pz.sampleCount === 1, JSON.stringify(pz));

pz = foldSolverIntoPuzzleRating({ rating: pz.rating, sampleCount: pz.sampleCount, solverElo: 1700 });
check('later solvers average in', pz.rating === 1800 && pz.sampleCount === 2, JSON.stringify(pz));

// --- visibility --------------------------------------------------------------
check(
  'a rating stays hidden below the sample threshold',
  !isRatingPublic({ rating: 1800, rating_sample_count: MIN_SOLVERS_FOR_PUBLIC_RATING - 1, hide_rating: 0 }),
  'shown too early'
);
check(
  'a rating shows once enough people have solved it',
  isRatingPublic({ rating: 1800, rating_sample_count: MIN_SOLVERS_FOR_PUBLIC_RATING, hide_rating: 0 }),
  'still hidden at the threshold'
);
check(
  'the creator can hide it however many solvers there are',
  !isRatingPublic({ rating: 1800, rating_sample_count: 500, hide_rating: 1 }),
  'hide_rating ignored'
);

console.log('');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
