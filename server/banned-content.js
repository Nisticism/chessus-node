/*
 * What a ban hides.
 *
 * A banned account's profile stays up, with a banner (the way chess sites do
 * it - opponents' game records still make sense). What the person CREATED is
 * hidden by default: games, pieces, puzzles, their profile picture and bio,
 * because when a ban is about content, leaving the content up is the harm.
 * Staff can choose to keep it visible per ban (users.ban_hides_content), e.g.
 * for a cheating ban where the creations were fine.
 *
 * Staff (admin/owner) always see everything, so they can review it. An expired
 * ban hides nothing.
 */

const isStaffUser = (user) => ['admin', 'owner'].includes(String(user?.role || '').toLowerCase());

/** SQL condition: the user in `column` is not banned with their content hidden. */
const creatorNotHidden = (column) => `NOT EXISTS (
  SELECT 1 FROM users hidden_creator
   WHERE hidden_creator.id = ${column}
     AND hidden_creator.banned = 1
     AND hidden_creator.ban_hides_content = 1
     AND (hidden_creator.ban_expires_at IS NULL OR hidden_creator.ban_expires_at > NOW()))`;

/** Is this user's content hidden right now? */
async function contentHiddenFor(db_pool, userId) {
  if (!userId) return false;
  const [[row]] = await db_pool.query(
    `SELECT 1 AS hidden FROM users WHERE id = ? AND banned = 1 AND ban_hides_content = 1
       AND (ban_expires_at IS NULL OR ban_expires_at > NOW()) LIMIT 1`, [userId]);
  return !!row;
}

/** Should this viewer be kept from this creator's content? */
async function hideFromViewer(db_pool, creatorId, viewer) {
  if (isStaffUser(viewer)) return false;
  return contentHiddenFor(db_pool, creatorId);
}

/** Ids of every user whose content is hidden right now (for filtering results in code). */
async function hiddenCreatorIds(db_pool) {
  const [rows] = await db_pool.query(
    `SELECT id FROM users WHERE banned = 1 AND ban_hides_content = 1
       AND (ban_expires_at IS NULL OR ban_expires_at > NOW())`);
  return new Set(rows.map((r) => Number(r.id)));
}

const REMOVED_MESSAGE = 'This was removed because its creator was banned for violating the Terms and Conditions.';

module.exports = { isStaffUser, creatorNotHidden, contentHiddenFor, hideFromViewer, hiddenCreatorIds, REMOVED_MESSAGE };
