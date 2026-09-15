#!/usr/bin/env node
/*
 * Post today's puzzle to a Discord channel.
 *
 * There are two ways to post, and the script picks whichever is configured.
 *
 * WEBHOOK (the original, and still the fallback). A channel webhook is a URL the
 * server owner creates in Discord's own channel settings; anything that can POST
 * to it can post to the channel. No application, no token, no gateway
 * connection, no process to keep alive - just a request from cron. Its one
 * limitation is the button: Discord's rule is that "non-application-owned
 * webhooks cannot send interactive components", so the best a webhook can do is
 * a LINK button, which Discord always renders grey with a ↗.
 *
 * AS THE APP (when DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID are set). Posting
 * through POST /channels/{id}/messages with a bot token makes the message the
 * application's own, and an application's message may carry a real button - one
 * with a custom_id rather than a URL. Clicking it reaches
 * /api/discord/interactions, which answers LAUNCH_ACTIVITY, so the activity
 * opens in place instead of the player being bounced through a link.
 *
 * That is the only difference. Same embed, same board, same channel. The bot
 * needs View Channel and Send Messages in the target channel and nothing else -
 * it never reads messages and never connects to the gateway.
 *
 * ON THE BUTTON COLOUR. Discord does not allow one. Buttons have six fixed
 * styles and no hex field, so "GridGrove green" is not on offer; style 3
 * (Success) is Discord's green and the closest thing to the site's #26655a,
 * which is why it is the default here. DISCORD_BUTTON_STYLE overrides it.
 *
 * The board is UPLOADED with the message rather than linked. Linking would mean
 * Discord fetching the image from our server, which in turn would mean the
 * server had to be publicly reachable before this could be tested at all.
 * Uploading is one 40KB request a day and makes the whole thing runnable from a
 * laptop against a local server, with nothing deployed.
 *
 * Usage:
 *   node scripts/discord-daily-post.js                  # today
 *   node scripts/discord-daily-post.js --date 2026-09-13
 *   node scripts/discord-daily-post.js --dry-run        # print, do not post
 *   node scripts/discord-daily-post.js --site http://localhost:3001
 *   node scripts/discord-daily-post.js --public-url https://gridgrove.gg
 *   node scripts/discord-daily-post.js --webhook <url>  # post somewhere else
 *   node scripts/discord-daily-post.js --save board.png # write the image out
 *
 * Environment:
 *   DISCORD_WEBHOOK_URL   Required unless --webhook is given, or unless posting
 *                         as the app (below).
 *   DISCORD_POST_SITE_URL Where to read the puzzle and board from. Falls back
 *                         to SITE_URL, then to localhost. Overridden by --site.
 *   DISCORD_BOT_TOKEN     Optional. With DISCORD_CHANNEL_ID, posts as the app
 *   DISCORD_CHANNEL_ID    and the button becomes a real one. Both or neither.
 *   DISCORD_BUTTON_STYLE  Optional, default 3 (green). 1 blurple, 2 grey,
 *                         3 green, 4 red. Ignored for the webhook's link button,
 *                         which Discord forces to style 5.
 */

require('dotenv').config();

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? true) : fallback;
};
const DRY = process.argv.includes('--dry-run');
const DATE = arg('date', null);
const SAVE = arg('save', null);

/*
 * `--webhook` beats the environment, so a throwaway channel can be tried
 * without editing .env and without any risk of the real channel getting a test
 * post. Defaults are local for the same reason: nothing here should reach
 * production, or the internet, unless it was asked to.
 */
const WEBHOOK = arg('webhook', null) || process.env.DISCORD_WEBHOOK_URL;

/*
 * Which server to read the puzzle and the board from.
 *
 * `--site` first, so a test run can be pointed at localhost without touching
 * anything; then DISCORD_POST_SITE_URL, for a deployment that wants this
 * separate; then SITE_URL, which the rest of the repo already sets to the
 * public site. Nothing here is fetched BY Discord, so localhost is a perfectly
 * good answer - see the note about attachments above.
 */
const SITE = String(
  arg('site', null) || process.env.DISCORD_POST_SITE_URL || process.env.SITE_URL
    || 'http://localhost:3001'
).replace(/\/+$/, '');

/*
 * What goes in the LINKS, which is a different question: a test run reads the
 * puzzle from localhost but should still post links somebody can click. So the
 * public site wins here even when --site points somewhere else, and only falls
 * back to SITE when there is nothing else to use.
 */
const PUBLIC = String(
  arg('public-url', null) || process.env.SITE_URL || SITE
).replace(/\/+$/, '');
/*
 * Posting as the application, which is what makes a real button possible.
 *
 * Both or neither: a token with no channel has nowhere to post and a channel
 * with no token cannot authenticate, and silently falling back to the webhook in
 * either case would hide a half-finished configuration behind a post that still
 * looked fine. `--webhook` forces the webhook path regardless, so a test run can
 * still be aimed somewhere harmless.
 */
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || null;
const AS_APP = !arg('webhook', null) && !!(BOT_TOKEN && CHANNEL_ID);

if (!!BOT_TOKEN !== !!CHANNEL_ID) {
  console.warn('[discord] Only one of DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID is set.'
    + ' Both are needed to post as the app; using the webhook instead.');
}

/*
 * The custom_id the button carries, taken from the endpoint that answers it
 * rather than written out again here. The string is a contract between the two
 * halves, and a typo in either would produce a button that looks perfect and
 * does nothing.
 */
const { PLAY_DAILY_ID } = require('../server/discord-interactions');

/*
 * Discord buttons have six fixed styles and no colour field, so the site's
 * #26655a cannot be used. 3 is Discord's green, which is the nearest thing.
 */
const BUTTON_STYLE = (() => {
  const raw = parseInt(process.env.DISCORD_BUTTON_STYLE, 10);
  return [1, 2, 3, 4].includes(raw) ? raw : 3;
})();

// GridGrove's green, so the embed's left edge reads as ours in a busy channel.
const EMBED_COLOUR = 0x26655a;
// The uploaded board's filename. The embed refers to it by this name.
const IMAGE_NAME = 'puzzle.png';

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** "Friday 12th September" - a date a person reads, not a sort key. */
function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const month = dt.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${day} ${ordinal(d)} ${month}`;
}

(async () => {
  if (!WEBHOOK && !AS_APP && !DRY) {
    console.error('[discord] Nothing to post to. Set DISCORD_WEBHOOK_URL, or set'
      + ' DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID to post as the app.');
    process.exit(1);
  }

  const url = `${SITE}/api/puzzles/daily${DATE ? `?date=${encodeURIComponent(DATE)}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    console.error(`[discord] ${url} returned ${res.status}`);
    process.exit(1);
  }
  const { date, puzzle } = await res.json();

  if (!puzzle) {
    /*
     * An empty day is not an error and must not become a daily failure email.
     * There is genuinely nothing to announce, so nothing is announced.
     */
    console.log(`[discord] No puzzle scheduled for ${date || 'today'}. Nothing posted.`);
    return;
  }

  // The puzzle page lives under its game, which is how every link on the site
  // reaches it - a bare /puzzles/:id is not a route.
  const puzzleUrl = `${PUBLIC}/games/${puzzle.game_type_id}/puzzles/${puzzle.id}`;

  /*
   * The LINK-button fallback points at the puzzle's own page, never at the
   * activity.
   *
   * A deep link to the activity - https://discord.com/activities/<app id> - can
   * only say "open GridGrove", not which puzzle, so it opens whatever is
   * scheduled the day it is CLICKED. On the morning it was posted that is the
   * same thing; a week later it is the wrong puzzle, and the post is still
   * sitting in the channel offering it. The site link names the puzzle and
   * keeps naming it, which is what a post about a specific puzzle should do.
   *
   * The real button below has no such problem: it carries the puzzle's id.
   */
  const playUrl = puzzleUrl;

  const depth = Number(puzzle.solution_depth) || 1;
  const moveWord = depth === 1 ? 'one move' : `${depth} moves`;

  const message = {
    /*
     * A webhook posts as itself, so it is named here. Posting as the app takes
     * its name and avatar from the application instead, and Discord rejects a
     * `username` on that endpoint - so the field is only set on the webhook path.
     */
    ...(AS_APP ? {} : { username: 'GridGrove' }),
    embeds: [{
      title: puzzle.title || 'Puzzle of the Day',
      url: puzzleUrl,
      description: [
        `**${puzzle.game_name}** — Player ${puzzle.side_to_move} to move.`,
        puzzle.goal_label ? `Goal: ${puzzle.goal_label}, in ${moveWord}.` : null,
        puzzle.description || null,
      ].filter(Boolean).join('\n'),
      color: EMBED_COLOUR,
      // Refers to the file uploaded alongside this message, by name. Discord
      // resolves `attachment://` against the multipart parts below.
      image: { url: `attachment://${IMAGE_NAME}` },
      footer: {
        /*
         * Who made the puzzle, said out loud. Most of these are GridGrove's own
         * generated ones, so the ones that are NOT want crediting - and "puzzle
         * by" rather than "by", because the byline sits next to a game name and
         * "by X" reads as though X made the game.
         */
        text: [
          'Puzzle of the Day',
          puzzle.creator_username ? `puzzle by ${puzzle.creator_username}` : null,
          prettyDate(date),
        ].filter(Boolean).join(' · '),
      },
    }],
    components: [{
      type: 1,            // action row
      components: [AS_APP
        /*
         * A real button. custom_id instead of url, which is what makes it
         * interactive - and interactive is exactly what a non-application
         * webhook may not send, so this shape is only reachable on the bot path.
         * The click lands on /api/discord/interactions and is answered with
         * LAUNCH_ACTIVITY.
         */
        ? {
          type: 2,
          style: BUTTON_STYLE,
          label: 'Play now',
          /*
           * The puzzle's id, appended.
           *
           * Discord hands a button's custom_id back on the click AND passes it
           * to the activity it launches, so this is how a post says which
           * puzzle it is about. Without it the button could only mean "open
           * GridGrove", and a post from last week opened today's puzzle - the
           * board in the message and the board in the activity disagreeing,
           * with the message being the one that was right.
           *
           * The handler matches on the prefix, so a button already sitting in
           * a channel from before this existed still works and still means
           * today's puzzle.
           */
          custom_id: `${PLAY_DAILY_ID}:${puzzle.id}`,
        }
        /*
         * The fallback. Style 5 is the only kind a plain channel webhook may
         * send, and Discord renders it grey with a ↗ whatever else is asked for.
         */
        : {
          type: 2,
          style: 5,
          label: 'Play now',
          url: playUrl,
        }],
    }],
  };

  /*
   * The board. Fetched from whichever server SITE points at - which during
   * testing is localhost, and that is the point: Discord never fetches it, so
   * it does not have to be reachable from anywhere but here.
   */
  let png = null;
  try {
    const img = await fetch(`${SITE}/api/puzzles/${puzzle.id}/image.png`, {
      signal: AbortSignal.timeout(20000),
    });
    if (img.ok) png = Buffer.from(await img.arrayBuffer());
    else console.warn(`[discord] Board image returned ${img.status}; posting without it.`);
  } catch (err) {
    console.warn(`[discord] Could not draw the board (${err.message}); posting without it.`);
  }

  // No image is a worse post, not a failed one. The text still says what the
  // puzzle is and the button still opens it.
  if (!png) delete message.embeds[0].image;

  if (SAVE && png) {
    require('fs').writeFileSync(SAVE, png);
    console.log(`[discord] Board written to ${SAVE} (${png.length} bytes).`);
  }

  if (DRY) {
    console.log(JSON.stringify(message, null, 2));
    console.log(png
      ? `[discord] Would upload ${IMAGE_NAME} (${png.length} bytes).`
      : '[discord] Would post with no image.');
    console.log(AS_APP
      ? `[discord] Would post as the app to channel ${CHANNEL_ID}, with an interactive button (style ${BUTTON_STYLE}).`
      : '[discord] Would post through the webhook, with a link button.');
    if (!WEBHOOK && !AS_APP) console.log('[discord] Nothing configured to post to - this was a dry run only.');
    return;
  }

  if (!WEBHOOK && !AS_APP) {
    console.error('[discord] Nothing to post to. Set DISCORD_WEBHOOK_URL or pass --webhook <url>.');
    process.exit(1);
  }

  /*
   * Multipart, because the image travels with the message. `payload_json` is
   * Discord's name for the part that would otherwise have been the whole body.
   */
  const form = new FormData();
  form.append('payload_json', JSON.stringify(message));
  if (png) {
    form.append('files[0]', new Blob([png], { type: 'image/png' }), IMAGE_NAME);
  }

  /*
   * Where this goes, and what it may carry.
   *
   * As the app: the channel's own messages endpoint, authenticated with the bot
   * token. Components are native there, so there is no query parameter to
   * remember and an interactive button is allowed.
   *
   * As a webhook: ?with_components=true, or the button silently does not appear.
   * Discord's wording is that the parameter decides "whether to respect the
   * components field of the request" - so without it the array is dropped rather
   * than rejected, and the message posts looking fine with no button on it. That
   * is exactly what happened on the first real post. Even with it set, a plain
   * channel webhook may only send NON-interactive components, which is why that
   * path's button is a style 5 link.
   */
  const target = AS_APP
    ? `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`
    : WEBHOOK + (WEBHOOK.includes('?') ? '&' : '?') + 'with_components=true';

  const post = await fetch(target, {
    method: 'POST',
    // No Content-Type header: fetch sets it, with the multipart boundary.
    headers: AS_APP ? { Authorization: `Bot ${BOT_TOKEN}` } : undefined,
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!post.ok) {
    const detail = await post.text().catch(() => '');
    const who = AS_APP ? 'Discord rejected the post' : 'Webhook rejected the post';
    console.error(`[discord] ${who} (${post.status}): ${detail.slice(0, 300)}`);
    /*
     * The two failures worth naming, because the status alone sends you looking
     * in the wrong place: 403 on the bot path is almost always the bot not being
     * in the server, or lacking View Channel / Send Messages on that channel -
     * not a bad token, which is 401.
     */
    if (AS_APP && post.status === 403) {
      console.error('[discord] 403 here usually means the bot is not in the server, or cannot'
        + ` see or post in channel ${CHANNEL_ID}. Check View Channel and Send Messages.`);
    }
    if (AS_APP && post.status === 401) {
      console.error('[discord] 401 means DISCORD_BOT_TOKEN is wrong. It is the BOT token from'
        + ' the Bot tab, not the client secret.');
    }
    process.exit(1);
  }
  console.log(`[discord] Posted "${puzzle.title || puzzle.id}" for ${date}`
    + (AS_APP ? ' as the app, with an interactive button.' : ' through the webhook.'));
})().catch((err) => {
  console.error('[discord] Failed to post:', err.message);
  process.exit(1);
});
