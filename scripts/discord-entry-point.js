#!/usr/bin/env node
/*
 * Move the "Launch" click from Discord's hands into ours.
 *
 * Every app with an activity gets an Entry Point command created for it
 * automatically - the ⠿ Launch that appears in a channel when somebody starts
 * the activity. It ships with handler DISCORD_LAUNCH_ACTIVITY, which means
 * Discord opens the activity and posts its own "Game Invitation" card without
 * asking the app anything. That card cannot be changed, styled, or suppressed,
 * because the app is never in the conversation.
 *
 * Flipping the handler to APP_HANDLER sends the click to our interactions
 * endpoint instead (server/discord-interactions.js), which answers with
 * LAUNCH_ACTIVITY and no card. Same launch, no uninvited message.
 *
 * This is a one-line change to one field, which is why it is a script and not a
 * documented click-path: the field is not exposed in the Developer Portal UI at
 * all, only over the API.
 *
 * AUTH. No bot token. Discord's client credentials grant issues a bearer token
 * for the `applications.commands.update` scope from the client id and secret the
 * server already has, and that token may manage the app's own commands. Adding a
 * bot user to the app just to edit its own command would be a bigger footprint
 * than the job needs.
 *
 * Usage:
 *   node scripts/discord-entry-point.js                  # show, change nothing
 *   node scripts/discord-entry-point.js --app-handler     # route clicks to us
 *   node scripts/discord-entry-point.js --discord-handler  # give it back to Discord
 *   node scripts/discord-entry-point.js --app-handler --dry-run
 *
 * Environment (both already needed by the token exchange):
 *   DISCORD_CLIENT_ID
 *   DISCORD_CLIENT_SECRET
 */

require('dotenv').config();

const DISCORD_API = 'https://discord.com/api/v10';

// Application command types, and the two Entry Point handlers.
const PRIMARY_ENTRY_POINT = 4;
const APP_HANDLER = 1;
const DISCORD_LAUNCH_ACTIVITY = 2;

const HANDLER_NAMES = {
  [APP_HANDLER]: 'APP_HANDLER (our interactions endpoint answers the click)',
  [DISCORD_LAUNCH_ACTIVITY]: 'DISCORD_LAUNCH_ACTIVITY (Discord launches it and posts its own card)',
};

const DRY = process.argv.includes('--dry-run');
const WANT = process.argv.includes('--app-handler') ? APP_HANDLER
  : process.argv.includes('--discord-handler') ? DISCORD_LAUNCH_ACTIVITY
    : null;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

/** A bearer token for our own commands, from the client credentials grant. */
async function bearerToken() {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      // Basic auth rather than body parameters: this grant is the one Discord
      // documents that way, and it keeps the secret out of the form body.
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'applications.commands.update',
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    // Discord's error body can echo the credentials back, so it is summarised
    // rather than printed - the status is what tells you which half is wrong.
    const detail = await res.text().catch(() => '');
    throw new Error(`Discord refused the client credentials grant (${res.status}). `
      + `Check DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET. ${detail.slice(0, 120)}`);
  }

  const body = await res.json();
  if (!body?.access_token) throw new Error('Discord returned no access token');
  return body.access_token;
}

async function api(token, path, init = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('[discord] DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must both be set.');
    process.exit(1);
  }

  const token = await bearerToken();
  const commands = await api(token, `/applications/${CLIENT_ID}/commands`);
  const entry = commands.find((c) => c.type === PRIMARY_ENTRY_POINT);

  if (!entry) {
    /*
     * No Entry Point command means the app has never had its activity enabled -
     * Discord creates the command when you do. Creating one here would produce a
     * Launch button for an activity that cannot open, so this stops and says so
     * rather than papering over a setting that has to be turned on in the portal.
     */
    console.error('[discord] This app has no Entry Point command, which means Activities are not');
    console.error('          enabled for it. Turn on Activities in the Developer Portal');
    console.error('          (Settings -> Activities), then run this again.');
    console.error(`          Commands currently registered: ${commands.length
      ? commands.map((c) => `${c.name} (type ${c.type})`).join(', ') : 'none'}`);
    process.exit(1);
  }

  const current = Number(entry.handler);
  console.log(`[discord] Entry Point command: "${entry.name}" (id ${entry.id})`);
  console.log(`[discord] Handler is ${current}: ${HANDLER_NAMES[current] || 'unrecognised'}`);

  if (WANT === null) {
    console.log('[discord] Nothing changed. Pass --app-handler to route clicks to this server,');
    console.log('          or --discord-handler to hand them back to Discord.');
    return;
  }

  if (current === WANT) {
    console.log(`[discord] Already set to ${WANT}. Nothing to do.`);
    return;
  }

  if (DRY) {
    console.log(`[discord] Would PATCH handler ${current} -> ${WANT}: ${HANDLER_NAMES[WANT]}`);
    return;
  }

  const updated = await api(token, `/applications/${CLIENT_ID}/commands/${entry.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ handler: WANT }),
  });

  console.log(`[discord] Handler is now ${updated.handler}: ${HANDLER_NAMES[updated.handler]}`);

  if (WANT === APP_HANDLER) {
    /*
     * The order matters and it is easy to get backwards: with APP_HANDLER set and
     * no working interactions URL, every Launch click gets Discord's red "this
     * application did not respond". Said out loud here because the failure looks
     * like a broken activity rather than a missing setting.
     */
    console.log('[discord] Launch clicks now come to this server. Make sure the Interactions');
    console.log('          Endpoint URL is saved in the Developer Portal (General Information)');
    console.log('          and that DISCORD_PUBLIC_KEY is set, or clicks will show an error.');
  }
})().catch((err) => {
  console.error('[discord] Failed:', err.message);
  process.exit(1);
});
