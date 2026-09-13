/*
 * Who is a real player, and what to call everyone else.
 *
 * Four places rendered a player's name as a link to /profile/<username>, and
 * each decided for itself who deserved one. The checks disagreed: match history
 * looked for a null id, the live game checked only for the bot sentinel, and
 * nothing looked at what an anonymous player's id actually is - so a guest in a
 * live game got a link to a profile that does not exist, under a name they had
 * typed into a join box.
 */

/**
 * Does this player have a GridGrove account, and therefore a profile page?
 *
 * The ID is the only trustworthy signal:
 *
 *   a registered player  the integer primary key from `users`
 *   a bot                the literal string 'bot'
 *   an anonymous player  a generated string - "anon_<hex>" in a live game,
 *                        "anon_corres_<hex>" in correspondence - so the game
 *                        has something stable to address them by
 *
 * server/game-socket.js applies the same test before writing a winner_id, for
 * the same reason: an anon id is not a users row and must not be treated as one.
 *
 * The NAME cannot answer this. A guest types whatever they like into the join
 * box and the server stores it, so "is the username 'Guest'" is a different
 * question with a different answer.
 *
 * @param {object|null|undefined} player
 * @returns {boolean}
 */
export const hasProfile = (player) => {
  if (!player) return false;
  if (player.isBot || player.isGuest) return false;
  const id = player.id;
  if (id == null || id === 'bot') return false;
  // Integer-like and nothing else. String ids that are all digits are fine -
  // JSON round-trips turn 42 into "42" often enough to matter.
  return /^\d+$/.test(String(id));
};

/**
 * What to show for a player.
 *
 * Anyone without an account is "Guest", whatever they typed. A name in the same
 * position and the same style as a real username reads as a real username -
 * which is what made the dead profile links look like a broken site rather than
 * a guest. Bots keep their own label, which is generated and already says what
 * they are.
 *
 * @param {object|null|undefined} player
 * @returns {string}
 */
export const playerLabel = (player) => {
  if (!player) return 'Guest';
  if (player.isBot || player.id === 'bot') return player.username || 'Computer';
  if (hasProfile(player)) return player.username;
  return 'Guest';
};
