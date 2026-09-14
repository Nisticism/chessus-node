/*
 * The site's own account.
 *
 * GridGrove publishes work under a system account rather than under a person:
 * the generated puzzles behind Puzzle of the Day, and the games that shipped
 * with the site - Chess, Go - which nobody here invented.
 *
 * Its own module because three unrelated places need it and the name is the
 * only stable handle: the row's id is a different number on every database, so
 * nothing may hard-code one. The frontend mirrors this in
 * chessus-frontend/src/helpers/platform-account.js.
 */
const PLATFORM_ACCOUNT_USERNAME = 'GridGrove';

/*
 * Cached, because it is asked on every puzzle creation and the answer changes
 * exactly once in the life of a database - when the migration creates the row.
 * A miss is re-queried rather than remembered as "no account", so a server that
 * happened to start before the migration finishes still finds it afterwards.
 */
let cachedId = null;

/** The platform account's user id on this database, or null if it has none. */
async function platformAccountId(db_pool) {
  if (cachedId != null) return cachedId;
  const [[row]] = await db_pool.query(
    'SELECT id FROM users WHERE username = ? LIMIT 1', [PLATFORM_ACCOUNT_USERNAME]
  );
  if (row) cachedId = Number(row.id);
  return cachedId;
}

module.exports = { PLATFORM_ACCOUNT_USERNAME, platformAccountId };
