import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import API_URL from "../../global/global";
import styles from "./discordlinkpanel.module.scss";

/*
 * Joining a Discord account to this one, from the account page.
 *
 * The other half of the handshake lives in the Discord activity, which issues a
 * six-character code. All this does is accept it: the code proves "the person
 * holding that Discord id was signed in to Discord a few minutes ago", and the
 * session you are reading this with proves the rest.
 *
 * Deliberately not OAuth. A Discord OAuth flow means registering a redirect,
 * handling a callback and holding refresh tokens we have no other use for -
 * real work for something most people do once. A one-time code proves the same
 * single fact.
 *
 * Only ever shown on your own profile. Linking is not something anyone should
 * be able to start from somebody else's page.
 *
 * Renders as a ROW inside the profile's Connected Accounts card rather than a
 * card of its own - it is literally a connected account, and it sat oddly as a
 * separate block beside the ratings. The caller passes its own row and label
 * classes so this matches the Chess.com and Lichess rows beside it instead of
 * carrying a second, nearly-identical set of styles.
 *
 * @param {string} [itemClass]  The card's row class.
 * @param {string} [labelClass] The card's label class.
 */
export default function DiscordLinkPanel({ itemClass = '', labelClass = '' }) {
  const [linked, setLinked] = useState(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);   // { kind, text }

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}account/link-discord`, { headers: authHeader() });
      setLinked(data.linked || null);
    } catch (_) {
      setLinked(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await axios.post(
        `${API_URL}account/link-discord`, { code: trimmed }, { headers: authHeader() }
      );
      setCode('');
      /*
       * Say what they got, not just that it worked. Somebody who has been
       * playing signed out has a streak riding on this, and "linked" alone does
       * not tell them it survived.
       */
      setMessage({
        kind: 'ok',
        text: data.carriedStreak > 0
          ? `Linked. Your ${data.carriedStreak}-day streak came with you.`
          : 'Linked.',
      });
      await load();
    } catch (err) {
      setMessage({ kind: 'bad', text: err?.response?.data?.message || 'Could not link that code.' });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await axios.delete(`${API_URL}account/link-discord`, { headers: authHeader() });
      setLinked(null);
      // Said plainly: unlinking is not deleting, and people hesitate over it
      // precisely because they cannot tell which one it is.
      setMessage({ kind: 'ok', text: 'Unlinked. Your streak stays on the Discord account.' });
    } catch (err) {
      setMessage({ kind: 'bad', text: err?.response?.data?.message || 'Could not unlink.' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <div className={`${itemClass} ${styles["row"]}`}>
      <span className={labelClass}>Discord</span>

      {linked ? (
        <div className={styles["linked"]}>
          <div className={styles["linked-head"]}>
            <span className={styles["name"]}>{linked.username || linked.discord_user_id}</span>
            {/*
              * What the link actually DOES, not just that it exists. "Linked"
              * on its own leaves somebody wondering whether their Discord
              * solves count - which is the only reason they linked it.
              */}
            <span className={styles["synced"]}>Synced</span>
          </div>
          <p className={styles["body"]}>
            Daily puzzles you solve in Discord count towards your puzzle rating,
            and solving on the site counts towards your streak.
          </p>
          <div className={styles["linked-foot"]}>
            {linked.current_streak > 0 && (
              <span className={styles["streak"]}>
                <strong>{linked.current_streak}</strong> day streak
                {linked.best_streak > linked.current_streak && ` · best ${linked.best_streak}`}
              </span>
            )}
            {linked.total_solved > 0 && (
              <span className={styles["streak"]}>
                {linked.total_solved} solved
              </span>
            )}
            <button type="button" className={styles["ghost"]} onClick={unlink} disabled={busy}>
              Unlink
            </button>
          </div>
        </div>
      ) : (
        <div className={styles["unlinked"]}>
          <p className={styles["body"]}>
            Solve the daily puzzle in Discord and it counts towards your puzzle
            rating. In the activity, press <em>Link a GridGrove account</em> and
            enter the code here.
          </p>
          <form className={styles["form"]} onSubmit={submit}>
            <input
              className={styles["input"]}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={12}
              spellCheck={false}
              autoComplete="off"
              aria-label="Discord link code"
            />
            <button type="submit" className={styles["primary"]} disabled={busy || !code.trim()}>
              {busy ? 'Linking…' : 'Link'}
            </button>
          </form>
        </div>
      )}

      {message && (
        <p className={`${styles["message"]} ${styles[message.kind]}`}>{message.text}</p>
      )}
    </div>
  );
}
