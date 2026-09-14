/*
 * Who is playing, when the answer comes from Discord rather than from us.
 *
 * The Discord activity runs in an iframe inside the Discord client. It cannot
 * see a GridGrove session, and the whole point is that it does not need one -
 * you can play the daily puzzle without ever having made an account here.
 *
 * That leaves identity. The activity does an OAuth authorize/authenticate
 * handshake with the `identify` scope and ends up holding an access token. It
 * sends that token, NOT a user id: a client-supplied id is a claim about who
 * somebody is, and this file exists so that claim is never taken at face value.
 * The token is presented to Discord, and Discord says whose it is.
 *
 * What comes back is deliberately weak. A verified Discord id is enough to say
 * "this is the same person who solved Tuesday's puzzle", and that is all it is
 * ever allowed to mean here. It does not sign anyone in, it does not stand in
 * for a GridGrove account, and no route may use it to reach anything but daily
 * puzzle progress. See server/discord-routes.js, which is the only caller.
 */

const DISCORD_API = 'https://discord.com/api/v10';

/*
 * Verified tokens, kept briefly.
 *
 * Playing one puzzle is a handful of requests over a few minutes, and asking
 * Discord to identify the same person on each of them is a round trip we can
 * skip - but a token that is revoked mid-session should stop working in
 * minutes, not hours, so the window is short. The cache is per-process and
 * lost on restart, which is correct: it is an optimisation, not state.
 */
const TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED = 5000;
const cache = new Map();   // access token -> { user, expires }

/** Drop everything stale, and if it is still too big, the oldest entries. */
function prune() {
  const now = Date.now();
  for (const [token, entry] of cache) {
    if (entry.expires <= now) cache.delete(token);
  }
  // Map iterates in insertion order, so the front is the oldest.
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
}

/**
 * Ask Discord who a token belongs to.
 *
 * @param {string} accessToken A bearer token from the activity's OAuth handshake.
 * @returns {Promise<{id: string, username: string, avatar: string|null}|null>}
 *   The Discord user, or null if the token is missing, malformed, expired, or
 *   rejected. Callers treat null as "anonymous", never as an error to report -
 *   a puzzle is still playable by someone we cannot name.
 */
async function identify(accessToken) {
  if (typeof accessToken !== 'string') return null;
  const token = accessToken.trim();
  // Long enough to be a token, short enough not to be an attack.
  if (token.length < 8 || token.length > 512) return null;

  prune();
  const hit = cache.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;

  let res;
  try {
    res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    // Discord unreachable. Not the player's fault and not a reason to fail the
    // puzzle, so they fall back to anonymous for this request.
    console.warn('[discord] identify failed:', err.message);
    return null;
  }

  if (!res.ok) {
    // A token Discord refuses. Logged because the visible symptom - progress
    // quietly not saving - is indistinguishable from playing anonymously, and
    // this is the line that tells the two apart.
    console.warn(`[discord] identify rejected a token: ${res.status}`);
    return null;
  }

  let body;
  try { body = await res.json(); } catch (_) { return null; }
  if (!body || typeof body.id !== 'string') return null;

  const user = {
    /*
     * A snowflake is a 64-bit integer and JSON numbers are not, so it stays a
     * string from here all the way into the VARCHAR column. Parsing it would
     * quietly round the last couple of digits and merge two players.
     */
    id: body.id,
    username: typeof body.global_name === 'string' && body.global_name
      ? body.global_name
      : (typeof body.username === 'string' ? body.username : null),
    avatar: typeof body.avatar === 'string' ? body.avatar : null,
  };

  cache.set(token, { user, expires: Date.now() + TOKEN_TTL_MS });
  return user;
}

/**
 * Trade the activity's one-time OAuth code for an access token.
 *
 * This is the only place the client secret is used, and the reason the exchange
 * happens here rather than in the activity: the secret must never be shipped to
 * a browser, iframed or otherwise.
 *
 * @returns {Promise<{access_token: string}>}
 * @throws  {Error} with a `status` when Discord refuses the exchange.
 */
async function exchangeCode(code) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const err = new Error('Discord activity is not configured on this server');
    err.status = 503;
    throw err;
  }
  if (typeof code !== 'string' || !code || code.length > 512) {
    const err = new Error('Missing authorization code');
    err.status = 400;
    throw err;
  }

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    // Discord's body can name the client secret in some failure modes, so the
    // detail is logged and the caller gets the shape of the problem only.
    const detail = await res.text().catch(() => '');
    console.warn('[discord] token exchange rejected:', res.status, detail.slice(0, 200));
    const err = new Error('Discord rejected the sign-in');
    err.status = 401;
    throw err;
  }

  const body = await res.json();
  if (!body || typeof body.access_token !== 'string') {
    const err = new Error('Discord returned no access token');
    err.status = 502;
    throw err;
  }
  /*
   * expires_in travels with the token so the activity can cache it and stop
   * asking for consent on every launch. It is a lifetime in seconds, not a
   * secret - Discord documents it as part of the response - and without it the
   * client has no way to tell a live token from a dead one except by using it
   * and failing, which costs the player a prompt at the worst moment.
   */
  /*
   * The success side of the handshake, said out loud.
   *
   * Only failures were logged, so "the activity never ran" and "the activity ran
   * fine" produced exactly the same silence - which is not a distinction a log
   * should leave to guesswork. This fires at most once per launch.
   */
  console.log('[discord] token exchange ok'
    + ` (expires_in=${Number(body.expires_in) || 'unknown'})`);

  return {
    access_token: body.access_token,
    expires_in: Number(body.expires_in) || null,
  };
}

/**
 * Express middleware: attach `req.discord` when the caller proved who they are.
 *
 * Absent or bad token means `req.discord` is null and the request carries on -
 * the anonymous path is a supported way to play, not a failure.
 */
function optionalDiscord(req, _res, next) {
  const header = req.get('X-Discord-Token') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!token) { req.discord = null; return next(); }

  identify(token)
    .then((user) => { req.discord = user; next(); })
    .catch(() => { req.discord = null; next(); });
}

/**
 * Is this Discord user in GridGrove's own server?
 *
 * Asked with the BOT token rather than by requesting the `guilds` scope from
 * the player. The scope would let us read every server they are in, which is a
 * great deal more than the question needs - and the question is only ever "are
 * they in this one". The bot is already in that server, so it may look up a
 * member there and nothing else.
 *
 * @returns {Promise<boolean|null>} true/false when Discord answered, and null
 *   when the check could not be made at all (no token or guild configured,
 *   Discord unreachable). Callers must treat null as "unknown" and refuse
 *   rather than assume - a membership check that fails open is not a check.
 */
async function isGuildMember(discordUserId) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId || !discordUserId) return null;

  let res;
  try {
    res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn('[discord] guild membership check failed:', err.message);
    return null;
  }

  // 404 is the answer "not a member", not a failure - Discord returns it for a
  // user who is not in the guild, and it is the case this exists to detect.
  if (res.status === 404) return false;
  if (res.ok) return true;

  console.warn(`[discord] guild membership check returned ${res.status}`);
  return null;
}

module.exports = { identify, exchangeCode, optionalDiscord, isGuildMember };
