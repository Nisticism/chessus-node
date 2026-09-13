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
 */

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
    const params = new URLSearchParams(window.location.search);
    if (!params.get('frame_id')) {
      // A normal browser tab. Not an error, just not Discord.
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

    (async () => {
      try {
        await sdk.ready();

        /*
         * Two scopes, and no more.
         *
         *   identify              a user id and display name, which is all a
         *                         streak needs.
         *   rpc.activities.write  lets the activity describe ITSELF - see
         *                         setActivity in DiscordActivity.js. Without
         *                         it Discord falls back to a generic "Game
         *                         Invitation / Game ended. Start a new one?"
         *                         card, which makes no sense for a puzzle.
         *
         * Anything beyond these would mean asking a player to grant more
         * access than solving a puzzle warrants.
         */
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'rpc.activities.write'],
        });

        /*
         * The code is swapped for a token ON THE SERVER. The exchange needs the
         * client secret, and a secret shipped to an iframe is a published
         * secret.
         */
        const { data } = await axios.post(`${API_URL}discord/token`, { code });
        if (cancelled) return;

        const auth = await sdk.commands.authenticate({ access_token: data.access_token });
        if (cancelled) return;

        setState({
          status: 'ready',
          sdk,
          token: data.access_token,
          user: auth?.user || null,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        /*
         * A failed handshake is not a failed puzzle. The activity falls back to
         * playing anonymously - no streak, no record - rather than showing an
         * error where a board should be.
         */
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
