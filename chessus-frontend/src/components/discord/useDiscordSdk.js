import { useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import axios from "axios";
import API_URL from "../../global/global";

/*
 * The handshake with the Discord client.
 *
 * The activity is an ordinary page of this site, served into an iframe inside
 * Discord. Discord puts a `frame_id` on the query string when it does that, and
 * that parameter is the only reliable way to know which of the two contexts we
 * are running in - so it is what decides whether the SDK is started at all.
 * Opened in a normal browser tab, this hook does nothing and reports `outside`,
 * and the page renders as a plain web page.
 *
 * The identity it produces is deliberately weak: a Discord access token that
 * the server will trade for a user id when it wants one. It is enough to say
 * "this is the same person who played yesterday", which is what a streak needs,
 * and it is not a GridGrove session and cannot become one.
 *
 * ── Two things this file got wrong before, both worth naming ───────────────
 *
 * 1. AUTHENTICATE WAS TREATED AS PART OF SIGNING IN. The token was fetched,
 *    then `authenticate` was awaited, and only then was any state set - so a
 *    throw from `authenticate` landed in the outer catch and discarded a
 *    perfectly good access token. Every such player was recorded as anonymous
 *    and nothing they solved was saved.
 *
 *    They are separate things. The ACCESS TOKEN is identity: the server trades
 *    it for a user id, and that is all progress needs. `authenticate` opens the
 *    RPC session, which only buys presence (setActivity). Losing the second must
 *    not cost the first, so the token is committed the moment it exists and the
 *    RPC handshake is attempted afterwards, best effort.
 *
 * 2. AUTHORIZE WAS CALLED TWICE. `prompt: 'none'` was assumed to throw when
 *    there was no grant to reuse, with a second call as the fallback - so when
 *    the first call did what the SDK actually documents ("if the user does not
 *    yet have a valid token for all scopes requested, this command will open an
 *    OAuth modal") the player got the modal twice.
 *
 *    The way to not be asked is to already hold a valid token, which is what the
 *    cache below is for - not to ask more cleverly.
 */

/*
 * Where the token is kept between launches.
 *
 * The scopes are part of the key on purpose. Discord will re-prompt when the
 * scopes change anyway, so a cached token from a previous set is worthless -
 * keying by them means adding a scope invalidates the cache by construction,
 * rather than leaving a stale token to fail in a confusing way later.
 */
const SCOPES = ['identify', 'rpc.activities.write'];
const tokenKey = (clientId) => `gg:discord:token:${clientId}:${SCOPES.join(',')}`;

/*
 * Treat a token as expired well before it really is. A token that dies
 * mid-puzzle costs the solve; one re-authorised a minute early costs nothing.
 */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

function readCachedToken(clientId) {
  try {
    const raw = window.localStorage.getItem(tokenKey(clientId));
    if (!raw) return null;
    const { access_token: accessToken, expires_at: expiresAt } = JSON.parse(raw);
    if (typeof accessToken !== 'string' || !accessToken) return null;
    // No expiry recorded means an older entry; treat it as usable and let a
    // rejection sort it out rather than forcing everyone through a new prompt.
    if (expiresAt && Date.now() > expiresAt - EXPIRY_MARGIN_MS) return null;
    return accessToken;
  } catch (_) {
    // Storage can be unavailable (a locked-down client, private mode). Not
    // having a cache is the normal path, not an error.
    return null;
  }
}

function writeCachedToken(clientId, accessToken, expiresInSeconds) {
  try {
    window.localStorage.setItem(tokenKey(clientId), JSON.stringify({
      access_token: accessToken,
      expires_at: expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : null,
    }));
  } catch (_) { /* a cache that cannot be written is just a cache miss */ }
}

function clearCachedToken(clientId) {
  try { window.localStorage.removeItem(tokenKey(clientId)); } catch (_) { /* ignore */ }
}

/**
 * @returns {{
 *   status: 'outside'|'connecting'|'ready'|'error',
 *   sdk: object|null,
 *   token: string|null,
 *   user: object|null,
 *   error: string|null,
 * }}
 */
export default function useDiscordSdk() {
  const [state, setState] = useState({
    status: 'connecting', sdk: null, token: null, user: null, error: null,
  });

  useEffect(() => {
    /*
     * Tell the server what went wrong, because nothing else can.
     *
     * The handshake runs in an iframe inside the Discord client, where the
     * console is unreachable - so a failure here is invisible except as
     * "progress was not saved", which is what it looked like for three rounds.
     * Fire-and-forget: a report that fails is not worth a second failure.
     */
    const report = (stage, message) => {
      try {
        axios.post(`${API_URL}discord/diag`, { stage, message: String(message || '') })
          .catch(() => {});
      } catch (_) { /* never let reporting break the activity */ }
    };

    const params = new URLSearchParams(window.location.search);
    if (!params.get('frame_id')) {
      /*
       * A normal browser tab. Not an error, just not Discord - so this is the
       * quiet path for every ordinary visitor and must stay silent.
       *
       * The exception worth hearing about: running INSIDE an iframe with no
       * frame_id. That is not a browser tab, it is an activity whose URL did not
       * carry the parameter the whole handshake keys off - and it would look
       * exactly like the symptom being chased, a board that plays fine and saves
       * nothing.
       */
      const framed = (() => {
        try { return window.self !== window.top; } catch (_) { return true; }
      })();
      if (framed) {
        report('no-frame-id', `framed but no frame_id; search="${window.location.search}"`);
      }
      setState({ status: 'outside', sdk: null, token: null, user: null, error: null });
      return undefined;
    }

    const clientId = process.env.REACT_APP_DISCORD_CLIENT_ID;
    if (!clientId) {
      setState({
        status: 'error', sdk: null, token: null, user: null,
        error: 'This build has no Discord application id.',
      });
      return undefined;
    }

    let cancelled = false;
    const sdk = new DiscordSDK(clientId);

    /*
     * Ask Discord for consent and swap the code for a token.
     *
     * This is the ONLY path that can show the player a modal, and it runs only
     * when there is no usable token already - which after the first launch is
     * the uncommon case.
     */
    const authorizeFresh = async () => {
      stage = 'authorize';
      const { code } = await sdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        scope: SCOPES,
      });
      /*
       * The code is swapped for a token ON THE SERVER. The exchange needs the
       * client secret, and a secret shipped to an iframe is a published secret.
       */
      stage = 'token-exchange';
      const { data } = await axios.post(`${API_URL}discord/token`, { code });
      if (!data?.access_token) throw new Error('Discord returned no access token');
      writeCachedToken(clientId, data.access_token, data.expires_in);
      return data.access_token;
    };

    // Which step we are on, so a failure reports where and not only what.
    let stage = 'ready';

    (async () => {
      try {
        await sdk.ready();

        const cached = readCachedToken(clientId);
        let token = cached || await authorizeFresh();
        if (cancelled) return;

        /*
         * Identity is settled. Commit it before anything else can fail - this is
         * what progress needs, and it must not depend on the RPC handshake below.
         */
        setState({ status: 'ready', sdk, token, user: null, error: null });

        /*
         * The RPC session, which is what setActivity needs. Best effort.
         *
         * A CACHED token that is refused here is a token Discord no longer
         * accepts - revoked, or expired earlier than it claimed - so the cache is
         * dropped and consent asked for once. A FRESH token refused here is a
         * working token and a failed RPC handshake, which costs presence and
         * nothing else, so it is logged and the puzzle carries on.
         */
        try {
          const auth = await sdk.commands.authenticate({ access_token: token });
          if (cancelled) return;
          setState({ status: 'ready', sdk, token, user: auth?.user || null, error: null });
        } catch (rpcErr) {
          if (cancelled) return;
          if (!cached) {
            console.warn('[discord] authenticate failed; presence is off but the token is good:', rpcErr?.message);
            return;
          }
          clearCachedToken(clientId);
          token = await authorizeFresh();
          if (cancelled) return;
          setState({ status: 'ready', sdk, token, user: null, error: null });
          try {
            const auth = await sdk.commands.authenticate({ access_token: token });
            if (!cancelled) setState({ status: 'ready', sdk, token, user: auth?.user || null, error: null });
          } catch (againErr) {
            console.warn('[discord] authenticate failed on a fresh token:', againErr?.message);
          }
        }
      } catch (err) {
        if (cancelled) return;
        /*
         * A failed handshake is not a failed puzzle. The activity falls back to
         * playing anonymously - no streak, no record - rather than showing an
         * error where a board should be.
         */
        clearCachedToken(clientId);
        report(stage, err?.message || String(err));
        setState({
          status: 'error', sdk, token: null, user: null,
          error: err?.message || 'Could not sign in with Discord.',
        });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return state;
}
