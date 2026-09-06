/*
 * Puzzle rating checks. Pure arithmetic against the real module - no server, no
 * database. The behaviour being pinned down is the SHAPE of the curve, which is
 * what was actually specified: losses shrink as you fall, gains shrink as you
 * rise.
 *
 *   node scripts/e2e/puzzle-rating-test.js
 */
const {
  rateAttempt, foldSolverIntoPuzzleRating, isRatingPublic,
  expectedScore, ANCHOR_RATING, MIN_SOLVERS_FOR_PUBLIC_RATING,
} = require('../../server/puzzle-rating');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

// --- the curve ---------------------------------------------------------------
const solved = (elo, n = 50) => rateAttempt({ currentElo: elo, ratedAttemptsSoFar: n, solved: true }).delta;
const failed = (elo, n = 50) => rateAttempt({ currentElo: elo, ratedAttemptsSoFar: n, solved: false }).delta;

const gains = [800, 1200, 1600, 2000].map(solved);
const losses = [800, 1200, 1600, 2000].map(failed);
console.log(`  gains  by rating 800/1200/1600/2000: ${gains.join(', ')}`);
console.log(`  losses by rating 800/1200/1600/2000: ${losses.join(', ')}`);

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
check(
  'a solver at the anchor gains and loses symmetrically',
  Math.abs(solved(ANCHOR_RATING) + failed(ANCHOR_RATING)) <= 1,
  `${solved(ANCHOR_RATING)} vs ${failed(ANCHOR_RATING)}`
);
check(
  'solving always gains at least a point, however high you are',
  solved(2400) >= 1 && solved(2000) >= 1,
  `${solved(2000)} at 2000, ${solved(2400)} at 2400`
);
check(
  'failing always costs at least a point, however low you are',
  failed(400) <= -1,
  `${failed(400)} at 400`
);
check(
  'a new solver moves faster than a settled one',
  solved(1200, 0) > solved(1200, 100),
  `${solved(1200, 0)} vs ${solved(1200, 100)}`
);

// A rating should settle where solve rate meets expectation, not run away.
let elo = 1200;
for (let i = 0; i < 400; i++) {
  elo = rateAttempt({ currentElo: elo, ratedAttemptsSoFar: 100, solved: Math.random() < 0.9 }).after;
}
check(
  'a 90% solver settles well above the anchor rather than running away',
  elo > 1400 && elo < 1800,
  `settled at ${elo}`
);

let elo2 = 1200;
for (let i = 0; i < 400; i++) {
  elo2 = rateAttempt({ currentElo: elo2, ratedAttemptsSoFar: 100, solved: Math.random() < 0.5 }).after;
}
check('a 50% solver stays near the anchor', Math.abs(elo2 - ANCHOR_RATING) < 150, `settled at ${elo2}`);

// --- the puzzle's emergent rating -------------------------------------------
let pz = { rating: 1200, sampleCount: 0 };
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
