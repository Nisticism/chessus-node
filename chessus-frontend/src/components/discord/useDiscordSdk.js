import { useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import axios from "axios";
import API_URL from "../../global/global";
import { getLaunchParams, restoreLaunchParamsToUrl } from "../../helpers/discord-launch-params";

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
 *   stage: string|undefined,   the step that failed, when one did
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

    /*
     * Put the launch parameters back on the URL before anything reads it.
     *
     * The Discord SDK reads window.location.search itself and cannot be handed
     * values, so if a navigation has stripped the query the SDK cannot start no
     * matter what this file knows. Restoring the captured copy is what lets it.
     * A no-op when the URL still has them, which is the ordinary case.
     */
    restoreLaunchParamsToUrl();

    const params = getLaunchParams();
    if (!params.get('frame_id')) {
      /*
       * A normal browser tab. Not an error, just not Discord - so this is the
       * quiet path for every ordinary visitor and must stay silent.
       *
       * Is this the activity, loaded without the parameters it needs?
       *
       * This used to ask "are we in an iframe", and that gate was wrong: in the
       * Discord client the activity is the top document of its own view, so
       * window.self === window.top and the check said "ordinary browser tab".
       * It therefore suppressed the one report that mattered, on every launch,
       * which is why several rounds of instrumentation came back empty.
       *
       * The host answers it properly. Discord serves the activity from
       * <application_id>.discordsays.com and nothing else is ever on that
       * domain, so this fires exactly once per activity launch and stays silent
       * for every ordinary visitor to the site.
       */
      const onActivityHost = /\.discordsays\.com$/i.test(window.location.hostname);
      if (onActivityHost) {
        report('no-frame-id',
          `activity loaded without frame_id. host=${window.location.hostname}`
          + ` path=${window.location.pathname}`
          + ` params=${[...params.keys()].join(',') || '(none)'}`
          + ` framed=${(() => { try { return window.self !== window.top; } catch (_) { return 'blocked'; } })()}`);
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

    /*
     * Which parameters Discord actually sent, by NAME only.
     *
     * The SDK constructor requires frame_id, instance_id AND platform, and
     * throws on whichever is missing - but this file only ever checked
     * frame_id, and the constructor sat outside the try below, so that throw
     * took the whole effect down before a single line could be reported. Three
     * rounds of "nothing was logged" and this was it.
     *
     * Names, not values: these are identifiers for the guild, channel and
     * instance, and the name alone answers the question.
     */
    report('effect-start', `query params: ${[...params.keys()].join(',') || '(none)'}`);

    let cancelled = false;

    /*
     * Inside the try, where everything belongs. A constructor that throws is a
     * failure like any other and has to be able to say so.
     */
    let sdk;
    try {
      sdk = new DiscordSDK(clientId);
    } catch (ctorErr) {
      report('sdk-constructor', ctorErr?.message || String(ctorErr));
      setState({
        status: 'error', sdk: null, token: null, user: null,
        stage: 'sdk-constructor',
        error: ctorErr?.message || 'Could not start the Discord SDK.',
      });
      return undefined;
    }

    /*
     * Ask Discord for consent and swap the code for a token.
     *
     * This is the ONLY path that can show the player a modal, and it runs only
     * when there is no usable token already - which after the first launch is
     * the uncommon case.
     */
    const authorizeFresh = async () => {
      stage = 'authorize';
      const { code } = await withTimeout(sdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        scope: SCOPES,
      }), 120000, 'authorize');
      report('authorize-ok', `got a code of length ${String(code || '').length}`);
      /*
       * The code is swapped for a token ON THE SERVER. The exchange needs the
       * client secret, and a secret shipped to an iframe is a published secret.
       */
      stage = 'token-exchange';
      /*
       * Absolute first, then through Discord's proxy.
       *
       * Inside an activity the page is served from <app_id>.discordsays.com and
       * Discord proxies it to the mapped target. An ABSOLUTE url to
       * gridgrove.gg is therefore cross-origin and subject to the activity's
       * content security policy; a RELATIVE one stays on the proxy host, is
       * same-origin, and Discord forwards it to the same server.
       *
       * The absolute form is tried first because it is what works everywhere
       * else, and the relative form only on a network-level failure - the shape
       * axios reports as "Network Error", meaning no response arrived at all.
       * That is exactly what was happening here: the exchange never reached the
       * server (nothing in its logs), while requests made later in the same
       * session did.
       */
      let data;
      try {
        ({ data } = await axios.post(`${API_URL}discord/token`, { code }));
      } catch (netErr) {
        const noResponse = !netErr?.response;
        if (!noResponse) throw netErr;
        report('token-exchange-retry', `absolute url failed (${netErr?.message}); trying the proxy path`);
        ({ data } = await axios.post('/api/discord/token', { code }));
        report('token-exchange-proxy-ok', 'the relative path worked where the absolute one did not');
      }
      if (!data?.access_token) throw new Error('Discord returned no access token');
      writeCachedToken(clientId, data.access_token, data.expires_in);
      return data.access_token;
    };

    // Which step we are on, so a failure reports where and not only what.
    let stage = 'ready';

    /*
     * A step that never settles is worse than one that fails.
     *
     * The last launch produced no token, no error and no report - which no
     * thrown exception can explain, but a promise that simply never resolves
     * explains exactly. `sdk.ready()` talks to the Discord client over postMessage
     * and has nothing to time it out; if that conversation is never answered the
     * whole handshake stops there, silently, and the board carries on looking
     * fine. A timeout turns that into a rejection, which the reporter can see.
     *
     * Generous on authorize, because a human is reading a consent modal.
     */
    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`${label} did not settle within ${ms}ms`)), ms)),
    ]);

    (async () => {
      try {
        await withTimeout(sdk.ready(), 15000, 'sdk.ready');
        /*
         * Breadcrumbs, not just failures. Knowing a step SUCCEEDED is what turns
         * "nothing was logged" from a mystery into a position on the path - the
         * distinction that cost several rounds of guessing.
         */
        report('ready-ok', 'sdk handshake complete');

        const cached = readCachedToken(clientId);
        report('token-source', cached ? 'using a cached token' : 'no cached token; will authorize');
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
          // The step that threw, carried out with the error. "Network Error" on
          // its own does not say which call; with the stage it does.
          stage,
          error: err?.message || 'Could not sign in with Discord.',
        });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return state;
}
