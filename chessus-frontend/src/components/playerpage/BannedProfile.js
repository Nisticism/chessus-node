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
 * Visitors get only this - the profile, its games and its pieces are not shown.
 * Staff get it as a notice above the full profile, with the reason, who banned
 * the account and when, how long for, and an Unban button. The server sends the
 * details to staff only (profileForViewer in server/index.js).
 */
const BannedNotice = ({ username, user, staff, onUnbanned }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ban = user?.ban || {};

  const unban = async () => {
    if (!window.confirm(`Unban ${username}? They will be able to sign in again.`)) return;
    setBusy(true);
    setError(null);
    try {
      await axios.post(`${API_URL}admin/users/${user.id}/unban`, {}, { headers: authHeader() });
      if (onUnbanned) onUnbanned();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not unban this account.');
      setBusy(false);
    }
  };

  if (!staff) {
    return (
      <div className={`${styles.notice} ${styles.visitor}`} role="status">
        <h1 className={styles.title}>
          <span>{username}</span>
          <span className={styles.badge}>Banned</span>
        </h1>
        <p>This account has been banned for breaking the GridGrove Terms and Conditions, so its profile is not shown.</p>
      </div>
    );
  }

  return (
    <div className={styles.notice} role="status">
      <h2 className={styles.title}>
        <span className={styles.badge}>Banned</span>
        <span>This account is banned. Visitors see only that - not the profile below.</span>
      </h2>
      <dl className={styles.details}>
        <dt>Reason</dt>
        <dd>{ban.reason || 'No reason recorded'}</dd>
        <dt>Banned</dt>
        <dd>{when(ban.banned_at) || 'Unknown'}{ban.banned_by ? ` by ${ban.banned_by}` : ''}</dd>
        <dt>Until</dt>
        <dd>{ban.expires_at ? when(ban.expires_at) : 'Permanent'}</dd>
      </dl>
      <div className={styles.actions}>
        <button type="button" className={styles.unban} onClick={unban} disabled={busy}>
          {busy ? 'Unbanning…' : 'Unban'}
        </button>
        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  );
};

/*
 * Wraps the profile. Not banned: the profile, untouched. Banned: visitors get
 * the notice INSTEAD of the profile; staff get it ABOVE the profile.
 *
 * Every decision lives here rather than in PlayerPage, which is at the size
 * where one more conditional trips a false rules-of-hooks lint error.
 */
const BannedProfile = ({ username, user, currentUser, onUnbanned, children }) => {
  const banned = !!(user && user.username === username && user.banned);
  if (!banned) return children;
  const staff = ['admin', 'owner'].includes(currentUser?.role?.toLowerCase());
  if (!staff) return <BannedNotice username={username} user={user} staff={false} />;
  return (
    <>
      <BannedNotice username={username} user={user} staff onUnbanned={onUnbanned} />
      {children}
    </>
  );
};

export default BannedProfile;
