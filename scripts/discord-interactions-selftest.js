#!/usr/bin/env node
/*
 * Prove the interactions endpoint before Discord ever sees it.
 *
 * The signature check is the whole security of that endpoint, and it is the kind
 * of code that is easy to write in a way that always says yes. Discord will not
 * tell you gently either: it sends deliberately invalid signatures as a routine
 * probe and removes the endpoint if one is ever accepted. So the interesting
 * assertions here are the REJECTIONS - a run that only proved a good signature
 * passes would have proved almost nothing.
 *
 * No database, no Discord, no deploy. A throwaway Ed25519 keypair stands in for
 * Discord's: this script holds the private half, the endpoint is handed the
 * public half through the same environment variable production uses, and the
 * requests are signed exactly the way Discord signs them.
 *
 * Usage:
 *   node scripts/discord-interactions-selftest.js
 */

const crypto = require('crypto');
const express = require('express');

// A stand-in for Discord's keypair. Generated per run, so nothing here can
// accidentally start depending on a fixed key.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
// The last 32 bytes of the SPKI DER are the raw key - which is the form Discord
// publishes in the portal, and therefore the form the endpoint has to accept.
const rawHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');

// Set before the module reads it: the key is parsed once and cached.
process.env.DISCORD_PUBLIC_KEY = rawHex;

const {
  registerDiscordInteractionRoutes,
  interactionsRawBody,
  INTERACTIONS_PATH,
  PLAY_DAILY_ID,
} = require('../server/discord-interactions');

const app = express();
// The same two-step mount index.js uses: raw bytes for this path, then the route.
app.use(INTERACTIONS_PATH, interactionsRawBody);
registerDiscordInteractionRoutes(app);

let failures = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        got      ${JSON.stringify(got)}`);
}

/**
 * Post an interaction the way Discord would.
 *
 * @param {object} opts.payload    The interaction body.
 * @param {string} opts.signWith   'good' | 'wrong-key' | 'garbage' | 'none'
 * @param {string} opts.tamperBody Body sent INSTEAD of the signed one, to prove
 *                                 the signature covers the bytes and not the shape.
 */
async function post(base, { payload, signWith = 'good', tamperBody = null, timestamp = null }) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));

  let signature;
  if (signWith === 'good') {
    signature = crypto.sign(null, Buffer.concat([Buffer.from(ts, 'utf8'), body]), privateKey).toString('hex');
  } else if (signWith === 'wrong-key') {
    const other = crypto.generateKeyPairSync('ed25519');
    signature = crypto.sign(null, Buffer.concat([Buffer.from(ts, 'utf8'), body]), other.privateKey).toString('hex');
  } else if (signWith === 'garbage') {
    signature = 'z'.repeat(128);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (signature) headers['X-Signature-Ed25519'] = signature;
  if (signWith !== 'none') headers['X-Signature-Timestamp'] = ts;

  const res = await fetch(base + INTERACTIONS_PATH, {
    method: 'POST',
    headers,
    body: tamperBody !== null ? tamperBody : body,
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* a plain-text rejection */ }
  return { status: res.status, json, text };
}

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  console.log('Signature is valid:');

  let r = await post(base, { payload: { type: 1 } });
  check('PING is answered with PONG', { status: r.status, ...r.json }, { status: 200, type: 1 });

  r = await post(base, { payload: { type: 2, data: { type: 4, name: 'launch' } } });
  check('Entry Point click launches the activity',
    { status: r.status, ...r.json }, { status: 200, type: 12 });

  r = await post(base, { payload: { type: 3, data: { custom_id: PLAY_DAILY_ID } } });
  check('daily post button launches the activity',
    { status: r.status, ...r.json }, { status: 200, type: 12 });

  r = await post(base, { payload: { type: 3, data: { custom_id: `${PLAY_DAILY_ID}:2026-09-13` } } });
  check('a custom_id with state appended still launches',
    { status: r.status, ...r.json }, { status: 200, type: 12 });

  // Unknown-but-authentic traffic should get a real answer, not a crash: Discord
  // shows the user a red error if the app fails to respond at all.
  r = await post(base, { payload: { type: 2, data: { type: 1, name: 'something-else' } } });
  check('an unknown command gets an ephemeral reply', { status: r.status, type: r.json?.type, flags: r.json?.data?.flags },
    { status: 200, type: 4, flags: 64 });

  r = await post(base, { payload: { type: 3, data: { custom_id: 'stale-button' } } });
  check('a stale button gets an ephemeral reply', { status: r.status, type: r.json?.type, flags: r.json?.data?.flags },
    { status: 200, type: 4, flags: 64 });

  console.log('\nSignature is not valid (each of these MUST be 401):');

  r = await post(base, { payload: { type: 1 }, signWith: 'none' });
  check('no signature headers at all', r.status, 401);

  r = await post(base, { payload: { type: 1 }, signWith: 'garbage' });
  check('a signature that is not hex', r.status, 401);

  r = await post(base, { payload: { type: 1 }, signWith: 'wrong-key' });
  check('a real signature from the wrong key', r.status, 401);

  // The one that matters most: a valid signature over a DIFFERENT body. If the
  // handler verified the parsed object, or re-serialised before verifying, this
  // would pass and the endpoint would be forgeable by anyone who saw one request.
  r = await post(base, { payload: { type: 1 }, tamperBody: JSON.stringify({ type: 2, data: { type: 4 } }) });
  check('a good signature over a body that was then swapped', r.status, 401);

  // Same bytes, different timestamp: the timestamp is part of the signed message,
  // so replaying the body under a new one must not verify.
  const ts = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify({ type: 1 }), 'utf8');
  const sig = crypto.sign(null, Buffer.concat([Buffer.from(ts, 'utf8'), body]), privateKey).toString('hex');
  const res = await fetch(base + INTERACTIONS_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': sig,
      'X-Signature-Timestamp': String(Number(ts) + 1),
    },
    body,
  });
  check('the signed timestamp swapped for another', res.status, 401);

  console.log('\nUnconfigured server:');
  r = await post(base, { payload: { type: 1 } });
  check('(sanity) still works while the key is set', r.status, 200);

  server.close();

  console.log(failures === 0
    ? '\nAll checks passed.'
    : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('selftest crashed:', err);
  process.exit(1);
});
