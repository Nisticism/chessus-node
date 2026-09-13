#!/usr/bin/env node
/*
 * Post today's puzzle to a Discord channel.
 *
 * There is no bot here and there does not need to be one. A channel webhook is
 * a URL the server owner creates in Discord's own channel settings; anything
 * that can POST to it can post to the channel. No application, no token, no
 * gateway connection, no process to keep alive - just a request from cron.
 *
 * The one thing a plain webhook cannot do is send INTERACTIVE components, so
 * there is no "solve it here" button on the message. It can send a LINK button,
 * which is all this needs: the link opens the activity (inside Discord) or the
 * puzzle page (outside it), and the playing happens there.
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
 *   DISCORD_WEBHOOK_URL   Required unless --webhook is given.
 *   DISCORD_POST_SITE_URL Where to read the puzzle and board from. Falls back
 *                         to SITE_URL, then to localhost. Overridden by --site.
 *   DISCORD_APP_ID        Optional. When set, the button deep-links to the
 *                         activity instead of the website.
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
const APP_ID = process.env.DISCORD_APP_ID || null;

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
  if (!WEBHOOK && !DRY) {
    console.error('[discord] DISCORD_WEBHOOK_URL is not set. Nothing to post to.');
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
  const playUrl = APP_ID
    ? `https://discord.com/activities/${APP_ID}`
    : puzzleUrl;

  const depth = Number(puzzle.solution_depth) || 1;
  const moveWord = depth === 1 ? 'one move' : `${depth} moves`;

  const message = {
    // A webhook posts as itself, so it is named here rather than in Discord.
    username: 'GridGrove',
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
      type: 1,          // action row
      components: [{
        type: 2,        // button
        style: 5,       // link - the only kind a plain webhook may send
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
    if (!WEBHOOK) console.log('[discord] No webhook configured - this was a dry run only.');
    return;
  }

  if (!WEBHOOK) {
    console.error('[discord] No webhook. Set DISCORD_WEBHOOK_URL or pass --webhook <url>.');
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
   * ?with_components=true, or the button silently does not appear.
   *
   * Discord's wording is that the parameter decides "whether to respect the
   * components field of the request" - so without it the array is dropped
   * rather than rejected, and the message posts looking fine with no button on
   * it. That is exactly what happened on the first real post.
   *
   * A plain channel webhook may only send NON-interactive components even with
   * this set, which is why the button is style 5 (a link). An interactive
   * button would need an application-owned webhook and somewhere to receive the
   * interaction, and the link is all this needs anyway.
   */
  const target = WEBHOOK + (WEBHOOK.includes('?') ? '&' : '?') + 'with_components=true';

  const post = await fetch(target, {
    method: 'POST',
    // No Content-Type header: fetch sets it, with the multipart boundary.
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!post.ok) {
    const detail = await post.text().catch(() => '');
    console.error(`[discord] Webhook rejected the post (${post.status}): ${detail.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[discord] Posted "${puzzle.title || puzzle.id}" for ${date}.`);
})().catch((err) => {
  console.error('[discord] Failed to post:', err.message);
  process.exit(1);
});
