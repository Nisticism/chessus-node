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
 * How much of a puzzle a solver got, as a score in [0, 1].
 *
 * Solutions are compared as a PREFIX: getting the first three plies of a
 * four-ply puzzle right scores 0.75. Missing the very first move scores zero
 * however much of the rest happens to line up - if you did not see the idea,
 * you did not solve it, which is how the mainstream sites treat it too.
 *
 * Single-move puzzles (everything today) collapse to 1 or 0, so this changes
 * nothing until multi-move solutions exist.
 */
function scoreAttempt(submitted, solution, sameMove) {
  const line = Array.isArray(solution) ? solution : [solution].filter(Boolean);
  const played = Array.isArray(submitted) ? submitted : [submitted].filter(Boolean);
  if (!line.length) return 0;
  let correct = 0;
  for (let i = 0; i < line.length; i++) {
    if (i >= played.length || !sameMove(played[i], line[i])) break;
    correct++;
  }
  if (correct === 0) return 0;
  return correct / line.length;
}

/**
 * Work out a solver's new rating after a first (rated) attempt.
 *
 * `score` is the fraction of the solution found (see scoreAttempt); `solved` is
 * accepted as a shorthand for 1 or 0.
 *
 * Returns { before, after, delta, expected, k, score }.
 */
function rateAttempt({ currentElo, ratedAttemptsSoFar = 0, solved, score }) {
  const before = Number.isFinite(currentElo) ? currentElo : PUZZLE_ELO_DEFAULT;
  const actual = Number.isFinite(score)
    ? Math.max(0, Math.min(1, score))
    : (solved ? 1 : 0);
  const expected = expectedScore(before);
  const k = kFactor(ratedAttemptsSoFar);
  const raw = k * (actual - expected);

  // Always move by at least a point in the direction of the result. Without
  // this the curve has a trapdoor: by about 2000 the expected score is so close
  // to 1 that a solve rounds to +0 while a failure still costs the full K, so
  // the rating could only ever fall no matter how well you did. A minimum step
  // puts the ceiling where +1 per solve balances the losses instead.
  // A full solve always gains at least a point and a complete miss always costs
  // at least one; partial credit in between is allowed to land wherever the
  // arithmetic puts it, including zero.
  let moved = raw;
  if (actual >= 1) moved = Math.max(1, raw);
  else if (actual <= 0) moved = Math.min(-1, raw);
  const after = clampElo(before + moved);
  return { before, after, delta: after - before, expected, k, score: actual };
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
  scoreAttempt,
  PUZZLE_ELO_DEFAULT,
  ANCHOR_RATING,
  MIN_SOLVERS_FOR_PUBLIC_RATING,
  expectedScore,
  kFactor,
  rateAttempt,
  foldSolverIntoPuzzleRating,
  isRatingPublic,
};
