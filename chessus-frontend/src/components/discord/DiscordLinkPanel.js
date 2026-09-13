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
 */
export default function DiscordLinkPanel() {
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
    <div className={styles["panel"]}>
      <h3 className={styles["title"]}>Discord</h3>

      {linked ? (
        <>
          <p className={styles["body"]}>
            Linked to <strong>{linked.username || linked.discord_user_id}</strong>.
            Solving the daily puzzle in Discord now counts towards your puzzle rating,
            and solving it here counts towards your streak.
          </p>
          {linked.current_streak > 0 && (
            <p className={styles["streak"]}>
              <strong>{linked.current_streak}</strong> day streak
              {linked.best_streak > linked.current_streak && (
                <span className={styles["muted"]}> · best {linked.best_streak}</span>
              )}
            </p>
          )}
          <button type="button" className={styles["ghost"]} onClick={unlink} disabled={busy}>
            Unlink
          </button>
        </>
      ) : (
        <>
          <p className={styles["body"]}>
            Play the daily puzzle in Discord and link it here, and your solves there
            will move your puzzle rating. In the GridGrove Discord activity, press
            <em> Link a GridGrove account</em> and enter the code it gives you.
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
        </>
      )}

      {message && (
        <p className={`${styles["message"]} ${styles[message.kind]}`}>{message.text}</p>
      )}
    </div>
  );
}
