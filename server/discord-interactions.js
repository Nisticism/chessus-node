/*
 * Discord talking to us, instead of us talking to Discord.
 *
 * Every other piece of the Discord integration is outbound: the daily post is a
 * request to a webhook, the token exchange and the identify call are requests to
 * discord.com. This file is the one inbound direction. Discord POSTs an
 * INTERACTION here when somebody clicks something, and then waits - briefly -
 * for the reply that decides what happens next.
 *
 * Two clicks matter to GridGrove.
 *
 *   1. "Launch" on the app. That is Discord's auto-created Entry Point command,
 *      and on its default handler Discord opens the activity itself and posts
 *      its own olive "Game Invitation" card - in Discord's words, "without
 *      coordinating with the app". Nothing the app knows about today's puzzle
 *      can reach that card, because the app is never asked. Moving the command
 *      to APP_HANDLER routes the click here instead, and the card stops being
 *      Discord's to write.
 *
 *   2. A real button on the daily post. A plain channel webhook may only send
 *      LINK buttons, which Discord always renders grey with a ↗. A blurple one
 *      is a different kind of button: it carries a custom_id rather than a URL,
 *      and somebody has to answer the click. That is this file too.
 *
 * Both answers are the same answer - callback type 12, LAUNCH_ACTIVITY, which
 * tells Discord to open the activity the app already ships. The value of doing
 * it ourselves is not the launch; it is that the click is now ours, so the
 * message beside it is ours as well.
 *
 * ── Security ───────────────────────────────────────────────────────────────
 *
 * This endpoint is public and cannot be authenticated the usual way, because
 * Discord has no credential of ours to present. What it has is an Ed25519
 * signature over every request, made with a key only Discord holds. Verifying
 * that signature is not one check among several - it is the entire gate, and
 * everything below it assumes the bytes came from Discord.
 *
 * Discord enforces this rather than trusting us to: it periodically sends
 * deliberately invalid signatures, and if the endpoint ever answers one with
 * anything but a rejection it removes the interactions URL and emails the owner.
 * So the failure path here is as load-bearing as the success path.
 */

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

/** Where this lives. Exported so index.js and the docs cannot drift apart. */
const INTERACTIONS_PATH = '/api/discord/interactions';

/**
 * The custom_id on the daily post's launch button.
 *
 * Shared with scripts/discord-daily-post.js rather than written out twice: the
 * string is a contract between the message that ships the button and the code
 * that answers it, and a typo in either half would produce a button that looks
 * perfect and does nothing.
 */
const PLAY_DAILY_ID = 'gridgrove:play-daily';

/*
 * WHICH PUZZLE A CLICK WAS ABOUT, REMEMBERED FOR A MOMENT.
 *
 * The button carries the puzzle's id in its custom_id, and the plan was that
 * Discord would hand that straight to the activity it launches. It is listed
 * among an activity's launch parameters, so the id should arrive on the URL and
 * be read by launchedPuzzleId() - and when it does, none of this is consulted.
 *
 * It cannot be relied on alone. A LAUNCH_ACTIVITY response carries no payload,
 * so nothing here gets to put the id anywhere; whether it arrives is entirely
 * Discord's business, and if it does not, the activity has no way to know it
 * was opened from a post at all and falls back to "today" - which is the whole
 * complaint: an old post opening the current puzzle.
 *
 * So the click is also recorded HERE, where the id is certainly known, and the
 * activity can ask for it by the channel it opened in. Short-lived on purpose:
 * a launch follows its click within seconds, and anything older is a different
 * question that should get today's puzzle.
 */
const LAUNCH_MEMORY_MS = 3 * 60 * 1000;
const launchMemory = new Map();   // channelId -> { puzzleId, userId, at }

function rememberLaunch(channelId, userId, puzzleId) {
  if (!channelId || !puzzleId) return;
  launchMemory.set(String(channelId), { puzzleId, userId: userId ? String(userId) : null, at: Date.now() });
  // Bounded: drop anything already stale whenever something new arrives, so a
  // busy channel cannot grow this without limit and a quiet one costs nothing.
  const cutoff = Date.now() - LAUNCH_MEMORY_MS;
  for (const [k, v] of launchMemory) if (v.at < cutoff) launchMemory.delete(k);
}

/**
 * The puzzle a recent click in this channel was about, if there was one.
 *
 * Not consumed on read: two people can open the same post seconds apart, and
 * the second of them should get the same puzzle as the first rather than
 * today's. It ages out instead.
 *
 * @param {string} channelId
 * @param {string} [userId] - preferred when known, but a match on the channel
 *   alone is still better than the wrong puzzle.
 * @returns {number|null}
 */
function recentLaunchPuzzleId(channelId, userId) {
  if (!channelId) return null;
  const hit = launchMemory.get(String(channelId));
  if (!hit) return null;
  if (Date.now() - hit.at > LAUNCH_MEMORY_MS) { launchMemory.delete(String(channelId)); return null; }
  if (userId && hit.userId && String(userId) !== hit.userId) return null;
  return hit.puzzleId;
}

/** The puzzle id appended to a play-daily custom_id, if it carries one. */
function puzzleIdFromCustomId(customId) {
  const m = /play-daily[:\-_](\d+)/.exec(String(customId || ''));
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Interaction types, as Discord numbers them (see the Interaction object docs).
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;

// Application command types. Only the Entry Point one is relevant here.
const PRIMARY_ENTRY_POINT = 4;

// Callback types - what we may answer with.
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const LAUNCH_ACTIVITY = 12;

// Message flag 1 << 6: only the person who clicked sees it.
const EPHEMERAL = 64;

/*
 * Discord publishes the app's public key as 32 raw bytes in hex. Node's verifier
 * wants a KeyObject, and the shortest honest way to get one is to put the raw
 * bytes behind the fixed 12-byte SPKI header that says "this is Ed25519". The
 * header never varies, so it is a constant rather than a DER encoder.
 */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/*
 * Parsed once, at first use, and remembered - including the failure.
 *
 * A malformed key is a configuration mistake that will not fix itself, and
 * re-deriving it on every request would turn one startup problem into a
 * per-request one. `null` means "no usable key", which the handler reports as
 * 503: the endpoint is unconfigured, not the request bad.
 */
let cachedKey;
function publicKey() {
  if (cachedKey !== undefined) return cachedKey;

  const hex = (process.env.DISCORD_PUBLIC_KEY || '').trim();
  // 32 bytes, hex, and nothing else. Anything shorter would be silently
  // truncated by Buffer.from and fail every verification for no visible reason.
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    if (hex) console.error('[discord] DISCORD_PUBLIC_KEY is not 64 hex characters; interactions are disabled.');
    cachedKey = null;
    return cachedKey;
  }

  try {
    cachedKey = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
  } catch (err) {
    console.error('[discord] DISCORD_PUBLIC_KEY could not be read as an Ed25519 key:', err.message);
    cachedKey = null;
  }
  return cachedKey;
}

/**
 * Did Discord really send these bytes?
 *
 * The signature covers the timestamp header followed by the body exactly as it
 * arrived, which is why this takes a Buffer and not a parsed object - JSON
 * survives a round trip through an object with different bytes, and different
 * bytes are a different message.
 *
 * There is deliberately no clock-skew check on the timestamp. Discord's own
 * reference implementation does not make one, a replayed interaction can do
 * nothing here anyway (the token it carries is single-use and short-lived, and
 * no route below writes anything), and the cost of getting it wrong is
 * asymmetric: a server whose clock has drifted would reject every real
 * interaction and lose the endpoint.
 *
 * @param {Buffer} body      The unparsed request body.
 * @param {string} signature X-Signature-Ed25519, 64 bytes of hex.
 * @param {string} timestamp X-Signature-Timestamp, verbatim.
 * @returns {boolean}
 */
function verifySignature(body, signature, timestamp) {
  const key = publicKey();
  if (!key || !Buffer.isBuffer(body)) return false;
  if (typeof signature !== 'string' || !/^[0-9a-fA-F]{128}$/.test(signature)) return false;
  if (typeof timestamp !== 'string' || !timestamp) return false;

  try {
    return crypto.verify(
      null,                                     // Ed25519 hashes internally
      Buffer.concat([Buffer.from(timestamp, 'utf8'), body]),
      key,
      Buffer.from(signature, 'hex')
    );
  } catch (err) {
    // A verify() that throws is a malformed signature, which is a rejection
    // rather than a server fault. Logged at warn because it is also exactly what
    // Discord's routine security probe looks like.
    console.warn('[discord] interaction signature could not be checked:', err.message);
    return false;
  }
}

/*
 * The raw bytes, because the signature is over bytes.
 *
 * Mounted in index.js ahead of express.json for the same reason the Stripe
 * webhook is. `type: '*​/*'` rather than 'application/json' so that a request
 * arriving with an odd or missing Content-Type still produces a Buffer to
 * verify - it will fail verification if it is not from Discord, which is the
 * correct outcome, whereas an empty body would fail it confusingly.
 *
 * 64kb because interaction payloads are a few kilobytes at most, and the body is
 * read before anything has vouched for the sender.
 */
const interactionsRawBody = express.raw({ type: () => true, limit: '64kb' });

/*
 * Its own rate limit, outside the general /api/ one.
 *
 * The general limiter allows 500 requests per 15 minutes per IP, and all of
 * Discord's interaction traffic arrives from a small set of Discord IPs - so
 * that ceiling is shared by every player in every server at once, and hitting
 * it would mean answering Discord with a 429. This ceiling is high enough that
 * only a flood reaches it, and a flood is what it is for.
 */
const interactionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many interactions' },
});

/**
 * Wire up the interactions endpoint.
 *
 * Takes no db_pool: nothing here reads or writes GridGrove state. A launch is a
 * launch, and the progress it leads to is recorded later by the activity itself
 * through the routes in discord-routes.js, authenticated properly by a token.
 */
function registerDiscordInteractionRoutes(app) {
  app.post(INTERACTIONS_PATH, interactionsLimiter, (req, res) => {
    /*
     * Verify first, parse second, and answer nothing before both are done. The
     * order is the point: every line after this one is allowed to treat the
     * payload as Discord's.
     */
    if (!publicKey()) {
      return res.status(503).send('Discord interactions are not configured');
    }

    const ok = verifySignature(
      req.body,
      req.get('X-Signature-Ed25519'),
      req.get('X-Signature-Timestamp')
    );
    // 401 exactly, and with no detail. Discord checks for this specific status,
    // and a body describing what was wrong would only help a forger.
    if (!ok) return res.status(401).send('invalid request signature');

    let interaction;
    try {
      interaction = JSON.parse(req.body.toString('utf8'));
    } catch (_) {
      return res.status(400).send('malformed interaction');
    }

    /*
     * A PING is Discord asking whether anyone is home - sent when the URL is
     * first saved in the portal, and periodically afterwards. Failing it is how
     * an endpoint gets rejected at registration, which is why it is the first
     * case and not an afterthought.
     */
    if (interaction.type === PING) {
      return res.json({ type: PONG });
    }

    if (interaction.type === APPLICATION_COMMAND) {
      if (interaction.data?.type === PRIMARY_ENTRY_POINT) {
        /*
         * The "Launch" click, now ours to answer.
         *
         * A bare LAUNCH_ACTIVITY opens the activity and says nothing in the
         * channel, which is the whole improvement: the player gets the puzzle
         * and the channel does not get a card nobody asked for. The daily post
         * is where GridGrove speaks to a channel, and it says more than that
         * card ever could.
         *
         * If an announcement is ever wanted, it is a follow-up POST to
         * /webhooks/{app_id}/{interaction.token} after this response - not a
         * field on it, because type 12 carries no message.
         */
        return res.json({ type: LAUNCH_ACTIVITY });
      }

      // Some other command exists on the app that this file has not been taught.
      // Answering visibly-but-privately beats Discord's red "app didn't respond".
      console.warn('[discord] unhandled command:', interaction.data?.name, 'type', interaction.data?.type);
      return res.json({
        type: CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'That is not something GridGrove knows how to do yet.', flags: EPHEMERAL },
      });
    }

    if (interaction.type === MESSAGE_COMPONENT) {
      // startsWith, not equality: Discord passes a custom_id back verbatim, so
      // appending state to it (a date, a puzzle id) stays possible later without
      // breaking every button already sitting in a channel's history.
      if (String(interaction.data?.custom_id || '').startsWith(PLAY_DAILY_ID)) {
        /*
         * Note which puzzle, before answering. The response itself can carry
         * nothing, so this is the only moment the id and the place it was
         * clicked are both in hand.
         */
        const clickedPuzzle = puzzleIdFromCustomId(interaction.data.custom_id);
        // channel_id at the top level, or the channel object - Discord sends
        // both and which one is present has varied by interaction type.
        const clickedChannel = interaction.channel_id || interaction.channel?.id;
        rememberLaunch(
          clickedChannel,
          interaction.member?.user?.id || interaction.user?.id,
          clickedPuzzle
        );
        /*
         * Logged because this is the hinge. If old posts still open today's
         * puzzle, the question is whether the click was seen with an id on it -
         * and that is answered here rather than guessed at.
         */
        console.log(`[discord] play-daily click: puzzle ${clickedPuzzle || '(none in custom_id)'}`
          + ` channel ${clickedChannel || '(unknown)'}`);
        return res.json({ type: LAUNCH_ACTIVITY });
      }

      console.warn('[discord] unhandled component:', interaction.data?.custom_id);
      return res.json({
        type: CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'That button is from an older version of this post.', flags: EPHEMERAL },
      });
    }

    /*
     * Autocomplete and modal submissions cannot arrive: nothing here ever sends
     * a modal or declares an autocompleting option. If one does, it is a new
     * interaction type from Discord, and the honest answer is that we do not
     * handle it - logged, so it is visible, rather than guessed at.
     */
    console.warn('[discord] unhandled interaction type:', interaction.type);
    return res.status(400).send('unhandled interaction type');
  });
}

/**
 * What the activity was opened for.
 *
 * The activity asks this when its own launch parameters did not name a puzzle.
 * Answering by CHANNEL because that is what an activity knows about itself
 * without anybody having to sign in - Discord puts channel_id on the launch URL
 * - and a click and the launch it causes happen in the same channel seconds
 * apart.
 *
 * Nothing secret is returned: a puzzle id that was just posted publicly in that
 * channel. A wrong or unknown channel gets null, which means "today's", which
 * is what the activity did before any of this existed.
 */
function registerDiscordLaunchContextRoute(app) {
  app.get('/api/discord/launch-context', (req, res) => {
    const puzzleId = recentLaunchPuzzleId(req.query.channel_id, req.query.user_id);
    // The other half of the same question: the activity asked, and this is
    // what it was told.
    console.log(`[discord] launch-context: channel ${req.query.channel_id || '(none)'}`
      + ` -> puzzle ${puzzleId || 0} (0 means today)`);
    res.json({ puzzleId: puzzleId || null });
  });
}

module.exports = {
  registerDiscordInteractionRoutes,
  registerDiscordLaunchContextRoute,
  recentLaunchPuzzleId,
  // Exported alongside its reader so the pair can be exercised without Discord
  // in the loop - the click cannot otherwise be simulated, since the handler
  // verifies a real signature first.
  rememberLaunch,
  interactionsRawBody,
  INTERACTIONS_PATH,
  PLAY_DAILY_ID,
  // Exported for the test script, which checks that a good signature passes and
  // a tampered one does not without needing Discord in the loop.
  verifySignature,
};
