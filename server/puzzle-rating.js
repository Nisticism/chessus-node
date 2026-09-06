/*
 * Puzzle rating.
 *
 * Two separate numbers that are easy to confuse:
 *
 *   users.puzzle_elo   what a solver is worth. Moves on their FIRST attempt at
 *                      a puzzle and never again, so it cannot be farmed.
 *   puzzles.rating     what a puzzle appears to be worth. Not set by anyone -
 *                      it is the mean puzzle_elo of the people who have solved
 *                      it, so it emerges from play.
 *
 * The puzzle's rating is NOT used to move the solver's. That would be circular:
 * a rating derived from solver ratings feeding back into solver ratings, on very
 * little data. The solver is scored against a fixed anchor instead.
 *
 * What that gives you is the behaviour you would expect from Elo without needing
 * an opponent: the expected score rises with your own rating, so
 *
 *   - a low-rated solver failing loses very little  (expected was low)
 *   - a high-rated solver solving gains very little (expected was high)
 *   - a high-rated solver failing loses a lot
 *
 * A rating therefore settles where your solve rate matches the expected score -
 * roughly, it measures how often you solve puzzles. Someone solving 90% settles
 * near 1580; someone solving half stays near the 1200 anchor.
 *
 * Switching the anchor to the puzzle's own emergent rating (once it has enough
 * samples) would make hard puzzles worth more, and is a one-line change here -
 * but it is deliberately not done yet, because with a handful of solves per
 * puzzle the feedback loop is louder than the signal.
 */

const PUZZLE_ELO_DEFAULT = 1200;

// What a puzzle is assumed to be worth while we have nothing better to go on.
const ANCHOR_RATING = 1200;

// Ratings move faster while a solver is new, then settle down.
const PROVISIONAL_ATTEMPTS = 20;
const K_PROVISIONAL = 40;
const K_SETTLED = 24;

// Below this many solves the public rating is noise, so it is not shown.
const MIN_SOLVERS_FOR_PUBLIC_RATING = 10;

const clampElo = (v) => Math.max(100, Math.min(3000, Math.round(v)));

/** Standard logistic expectation of `rating` against `opponent`. */
function expectedScore(rating, opponent = ANCHOR_RATING) {
  return 1 / (1 + Math.pow(10, (opponent - rating) / 400));
}

function kFactor(ratedAttemptsSoFar) {
  return ratedAttemptsSoFar < PROVISIONAL_ATTEMPTS ? K_PROVISIONAL : K_SETTLED;
}

/**
 * Work out a solver's new rating after a first (rated) attempt.
 * Returns { before, after, delta, expected, k }.
 */
function rateAttempt({ currentElo, ratedAttemptsSoFar = 0, solved }) {
  const before = Number.isFinite(currentElo) ? currentElo : PUZZLE_ELO_DEFAULT;
  const expected = expectedScore(before);
  const k = kFactor(ratedAttemptsSoFar);
  const raw = k * ((solved ? 1 : 0) - expected);

  // Always move by at least a point in the direction of the result. Without
  // this the curve has a trapdoor: by about 2000 the expected score is so close
  // to 1 that a solve rounds to +0 while a failure still costs the full K, so
  // the rating could only ever fall no matter how well you did. A minimum step
  // puts the ceiling where +1 per solve balances the losses instead.
  const floored = solved ? Math.max(1, raw) : Math.min(-1, raw);
  const after = clampElo(before + floored);
  return { before, after, delta: after - before, expected, k };
}

/**
 * Fold one solver into a puzzle's emergent rating.
 *
 * Only solvers count. A puzzle attempted by a hundred beginners and solved by
 * none would otherwise read as easy, when the truth is the opposite - the people
 * who got it are the evidence of what it takes.
 *
 * Kept as a running mean (rating + sample count) rather than recomputed from the
 * attempts table, so recording an attempt stays one small update.
 */
function foldSolverIntoPuzzleRating({ rating, sampleCount, solverElo }) {
  const n = Math.max(0, Number(sampleCount) || 0);
  const current = Number.isFinite(rating) ? rating : PUZZLE_ELO_DEFAULT;
  // The first solver replaces the placeholder rather than averaging with it.
  const next = n === 0 ? solverElo : (current * n + solverElo) / (n + 1);
  return { rating: clampElo(next), sampleCount: n + 1 };
}

/** Whether a puzzle's rating should be shown to anyone but its creator. */
function isRatingPublic(puzzle) {
  if (!puzzle) return false;
  if (puzzle.hide_rating) return false;
  return (Number(puzzle.rating_sample_count) || 0) >= MIN_SOLVERS_FOR_PUBLIC_RATING;
}

module.exports = {
  PUZZLE_ELO_DEFAULT,
  ANCHOR_RATING,
  MIN_SOLVERS_FOR_PUBLIC_RATING,
  expectedScore,
  kFactor,
  rateAttempt,
  foldSolverIntoPuzzleRating,
  isRatingPublic,
};
