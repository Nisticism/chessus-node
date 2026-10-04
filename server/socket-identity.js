/**
 * Who is on the other end of a socket.
 *
 * A socket used to say who it was: `authenticate` took a userId from the
 * client and believed it, and every game handler then trusted the userId (or
 * hostId) inside each payload. Anyone could move, resign or host as anyone.
 *
 * Now a socket's user comes only from a verified access token - in the
 * handshake (`auth: { token }`) or in a later `authenticate` - and the ids in a
 * payload are checked against what this socket has proved it is:
 *
 *   - the signed-in user (socket.userId, from the token), or
 *   - an anonymous id it holds: `anon_<its own socket id>`, or a stable
 *     credential-backed anon id the server handed it (on creating or joining an
 *     anonymous game) or that it proved with that game's token
 *     (authenticateAnonCorresPlayer).
 *
 * A claim it cannot back is replaced with the socket's own user (or nothing),
 * so a forged id can only ever act as yourself.
 */
const jwt = require('jsonwebtoken');

/**
 * Check an access token. Returns { user: { id, username } } or { error } where
 * error is 'missing' | 'expired' | 'invalid' | 'banned'. The token's
 * signature is the only thing that names a user - never a field beside it.
 */
function verifyAccessToken(token, { isUserBanned } = {}) {
  if (!token || typeof token !== 'string') return { error: 'missing' };
  let payload;
  try {
    payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (err) {
    return { error: err && err.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
  const id = Number(payload && payload.id);
  if (!Number.isInteger(id) || id <= 0) return { error: 'invalid' };
  if (typeof isUserBanned === 'function' && isUserBanned(id)) return { error: 'banned' };
  return { user: { id, username: payload.username || null } };
}

// Payload fields that name the acting player, and the name fields that go with them.
const ACTOR_ID_FIELDS = ['userId', 'hostId'];
const ACTOR_NAME_FIELDS = ['username', 'hostUsername'];

/**
 * The id this socket may act as, given the one it claimed.
 * `ownsAnonId(socket, id)` says whether the server bound that anon id to it.
 */
function resolveActorId(socket, claimed, ownsAnonId) {
  if (socket.userId != null && String(claimed) === String(socket.userId)) return socket.userId;
  if (typeof claimed === 'string' && claimed.startsWith('anon_')
      && (claimed === `anon_${socket.id}` || ownsAnonId(socket, claimed))) {
    return claimed;
  }
  return socket.userId != null ? socket.userId : null;
}

/**
 * Rewrite the actor fields of one incoming payload in place. Empty claims are
 * left alone (handlers already fall back to socket.userId or treat the sender
 * as a guest). Returns the ids that were refused, for logging.
 */
function bindActorFields(socket, data, ownsAnonId) {
  const refused = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return refused;
  for (const field of ACTOR_ID_FIELDS) {
    const claimed = data[field];
    if (claimed == null || claimed === '') continue;
    const actual = resolveActorId(socket, claimed, ownsAnonId);
    if (String(actual) !== String(claimed)) refused.push(`${field}=${claimed}`);
    data[field] = actual;
  }
  // A display name rides along with the id; a guest's name travels as guestName.
  for (const field of ACTOR_NAME_FIELDS) {
    if (field in data) data[field] = socket.userId != null ? socket.username : undefined;
  }
  return refused;
}

module.exports = { verifyAccessToken, resolveActorId, bindActorFields };
