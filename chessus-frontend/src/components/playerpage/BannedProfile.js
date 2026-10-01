import React, { useState } from "react";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { parseServerDate } from "../../helpers/date-formatter";
import styles from "./bannedprofile.module.scss";

const when = (value) => {
  if (!value) return null;
  const d = parseServerDate(value);
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : String(value);
};

/*
 * A banned account on its profile page.
 *
 * Everyone sees the profile with a banner on top, the way chess sites do it -
 * opponents' game records still make sense. The public wording is generic; the
 * actual reason is for staff. When the ban hides what they made (the default),
 * the server leaves out their games, pieces, puzzles, picture and bio for
 * everyone but staff, and the banner says so.
 *
 * Staff get the reason, who banned and when, how long for, whether their
 * creations are hidden (with a switch), and Unban. The server sends those
 * details to staff only (profileForViewer in server/index.js).
 */
const BannedNotice = ({ username, user, staff, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ban = user?.ban || {};
  const hidden = staff ? !!ban.hides_content : !!user?.content_hidden;

  const act = async (url, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await axios.post(url, body, { headers: authHeader() });
      setBusy(false);
      if (onChanged) onChanged();
    } catch (err) {
      setError(err?.response?.data?.message || 'That did not work - try again.');
      setBusy(false);
    }
  };

  if (!staff) {
    return (
      <div className={styles.notice} role="status">
        <p className={styles.title}>
          <span className={styles.badge}>Banned</span>
          <span>This account has been banned for violating the GridGrove Terms and Conditions.</span>
        </p>
        {hidden && <p className={styles.sub}>The games, pieces and puzzles they created have been removed.</p>}
      </div>
    );
  }

  return (
    <div className={styles.notice} role="status">
      <p className={styles.title}>
        <span className={styles.badge}>Banned</span>
        <span>This account is banned. Visitors see a banner like this one, without the reason.</span>
      </p>
      <dl className={styles.details}>
        <dt>Reason</dt>
        <dd>{ban.reason || 'No reason recorded'}</dd>
        <dt>Banned</dt>
        <dd>{when(ban.banned_at) || 'Unknown'}{ban.banned_by ? ` by ${ban.banned_by}` : ''}</dd>
        <dt>Until</dt>
        <dd>{ban.expires_at ? when(ban.expires_at) : 'Permanent'}</dd>
        <dt>Their creations</dt>
        <dd>
          {hidden
            ? 'Hidden from everyone but staff - games, pieces, puzzles, picture and bio. You can still see them below.'
            : 'Still visible to everyone.'}
        </dd>
      </dl>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => act(`${API_URL}admin/users/${user.id}/ban-content`, { hide: !hidden })}
        >
          {hidden ? 'Show their creations' : 'Hide their creations'}
        </button>
        <button
          type="button"
          className={styles.unban}
          disabled={busy}
          onClick={() => act(`${API_URL}admin/users/${user.id}/unban`, {}, `Unban ${username}? They will be able to sign in again.`)}
        >
          {busy ? 'Working…' : 'Unban'}
        </button>
        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  );
};

/*
 * Wraps the profile: a banner on top when the account is banned, the profile
 * underneath either way.
 *
 * Every decision lives here rather than in PlayerPage, which is at the size
 * where one more conditional trips a false rules-of-hooks lint error.
 */
const BannedProfile = ({ username, user, currentUser, onUnbanned, children }) => {
  const banned = !!(user && user.username === username && user.banned);
  const staff = ['admin', 'owner'].includes(currentUser?.role?.toLowerCase());
  return (
    <>
      {banned && <BannedNotice username={username} user={user} staff={staff} onChanged={onUnbanned} />}
      {children}
    </>
  );
};

export default BannedProfile;
