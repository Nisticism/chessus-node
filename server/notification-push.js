/*
 * Putting a notification in front of someone who is online - one way, used by
 * every kind of notification.
 *
 * It used to be written out by hand at each of thirty-odd call sites, and they
 * had drifted:
 *   - a dozen looked the socket up by a NUMBER, but userSockets is keyed by
 *     the id as a STRING (registerUserSocket), so the lookup never matched
 *     and nothing was pushed - friend requests, replies, comments, mentions,
 *     piece moderation, announcements, the challenge popup, game chat;
 *   - others pushed only { type, title }, so the list grew an entry with no
 *     id, no text, no link and no time until the page was reloaded (the
 *     owner's notes, puzzle verification, piece moderation);
 *   - all of them pushed to the user's MOST RECENT socket only, so a second
 *     tab never heard.
 *
 * pushNotification sends the whole row, as the list itself would load it
 * (sender_username included), to EVERY live socket of the user, and then the
 * unread count from the database - the count is the truth, not a +1 kept by
 * the client.
 */
const dbHelpers = require('./db-helpers');

/**
 * Push a notification row (as createNotification returns it, or an updated
 * row) to every socket the user has open. Does nothing when they are offline:
 * they will load it with the list.
 *
 * @param {number|string} userId
 * @param {object} row  the notification; needs its id
 * @param {object} [opts]
 * @param {string} [opts.senderUsername]  looked up from sender_id when not given
 */
async function pushNotification(userId, row, { senderUsername } = {}) {
  if (!userId || !row) return;
  try {
    const gameSocket = require('./game-socket');
    const io = gameSocket.getIO && gameSocket.getIO();
    const sockets = gameSocket.socketIdsOf ? gameSocket.socketIdsOf(userId) : [];
    if (!io || sockets.length === 0) return;

    let sender = senderUsername ?? row.sender_username ?? null;
    if (sender == null && row.sender_id) {
      try { sender = (await dbHelpers.findUserById(row.sender_id))?.username || null; } catch (_) { /* shown without */ }
    }
    const payload = {
      is_read: 0,
      is_actioned: 0,
      ...row,
      user_id: row.user_id ?? userId,
      created_at: row.created_at || new Date().toISOString(),
      sender_username: sender,
    };
    const unreadCount = await dbHelpers.getUnreadNotificationCount(userId);
    io.to(sockets).emit('newNotification', payload);
    io.to(sockets).emit('unreadNotificationCount', { unreadCount });
  } catch (err) {
    console.error('[notification-push] push failed:', err.message);
  }
}

/**
 * Create a notification and push it. Returns the row (null on failure - a
 * notification is never worth failing the request that caused it).
 *
 * @param {object} fields  createNotification's fields
 * @param {object} [opts]  pushNotification's options
 */
async function notifyUser(fields, opts = {}) {
  if (!fields || !fields.user_id) return null;
  try {
    const row = await dbHelpers.createNotification(fields);
    await pushNotification(fields.user_id, row, opts);
    return row;
  } catch (err) {
    console.error(`[notification-push] ${fields.type} notification failed:`, err.message);
    return null;
  }
}

/**
 * An unread notification about the same thing is brought up to date instead
 * of piling up a second one (moves and chat in one game). Pushed again with
 * the same id, so the list replaces the entry rather than adding one.
 */
async function upsertNotification(fields, opts = {}) {
  if (!fields || !fields.user_id) return null;
  try {
    const existing = fields.related_id != null
      ? await dbHelpers.findUnreadNotification(fields.user_id, fields.type, fields.related_id)
      : null;
    if (!existing) return notifyUser(fields, opts);
    const { sender_id = null, title, content = null } = fields;
    await dbHelpers.updateNotification(existing.id, { sender_id, title, content });
    const row = { ...existing, sender_id, title, content, created_at: new Date().toISOString() };
    await pushNotification(fields.user_id, row, opts);
    return row;
  } catch (err) {
    console.error(`[notification-push] ${fields.type} notification failed:`, err.message);
    return null;
  }
}

module.exports = { pushNotification, notifyUser, upsertNotification };
