import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import InfoTooltip from "../piecewizard/InfoTooltip";
import UniqueBadge from "./UniqueBadge";
import styles from "./uniquebadge.module.scss";
import { formatDateLegacy } from "../../helpers/date-formatter";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";

const ABOUT = 'The “One solution” badge means exactly one winning move at every step, the last '
  + 'included, checked against every defence. Puzzles of up to three moves are checked for it '
  + 'automatically when you press “Check puzzle”. Puzzles longer than three moves cannot be '
  + 'verified automatically, but GridGrove staff can award the badge by hand: once the puzzle is '
  + 'published, you can request a verification here. Puzzles by players need the badge to be '
  + 'picked as Puzzle of the Day.';

const formatDate = (v) => (v ? formatDateLegacy(v) : '');

/*
 * The builder's panel for the "verified unique solution" badge: where this
 * puzzle stands, why, and - for a puzzle the automatic check cannot settle - a
 * way to ask staff to verify it.
 *
 * Its own component, fetching its own data, because PuzzleBuilder is already at
 * the size where one more branch upsets the hooks lint.
 *
 * checkResult: the builder's save/check notice. When it settles on new words
 * (a save, or a finished check) the panel reads the verdict again; progress
 * updates during a check are ignored.
 */
export default function UniqueStatusPanel({ puzzleId, published, checkResult }) {
  const refreshKey = checkResult && !checkResult.progress ? checkResult.text : '';
  const [info, setInfo] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    if (!puzzleId) return;
    try {
      const { data } = await axios.get(`${API_URL}puzzles/${puzzleId}/verification`, { headers: authHeader() });
      setInfo(data);
    } catch (_) {
      setInfo(null);
    }
  }, [puzzleId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const send = async (method) => {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = method === 'post'
        ? await axios.post(`${API_URL}puzzles/${puzzleId}/verification-request`, { note }, { headers: authHeader() })
        : await axios.delete(`${API_URL}puzzles/${puzzleId}/verification-request`, { headers: authHeader() });
      setMessage({ tone: 'ok', text: data?.message });
      setNote('');
      await load();
    } catch (err) {
      setMessage({ tone: 'warn', text: err?.response?.data?.message || 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };

  if (!puzzleId || !info) return null;

  const status = info.unique_status || 'unchecked';
  const request = info.request;
  const open = request?.status === 'open';
  const lastResolved = request && (request.status === 'verified' || request.status === 'not_verified') ? request : null;
  const canRequest = status === 'unchecked' && !open;

  let headline;
  if (status === 'verified') headline = <UniqueBadge status="verified" method={info.unique_method} />;
  else if (status === 'not_unique') headline = <span className={styles["status-warn"]}>More than one solution</span>;
  else headline = <span className={styles["status-dim"]}>Not verified yet</span>;

  let explain = info.unique_detail;
  if (status === 'unchecked') {
    explain = info.autoCheckable
      ? 'Press “Check puzzle” — for a puzzle of up to three moves it settles this automatically. '
        + 'If the check cannot finish, you can ask staff instead.'
      : `This puzzle is ${info.solverMoves} moves long, so it cannot be verified automatically. `
        + 'Staff can verify it by hand on request.';
  }

  return (
    <div className={styles["panel"]}>
      <div className={styles["panel-head"]}>
        <span>Unique solution:</span>
        {headline}
        <InfoTooltip text={ABOUT} />
      </div>
      {explain && <div className={styles["panel-detail"]}>{explain}</div>}

      {open && (
        <div className={styles["panel-actions"]}>
          <span className={styles["panel-detail"]}>
            Verification requested {formatDate(request.created_at)} — you will get a notification with the outcome.
          </span>
          <button type="button" className={styles["link-btn"]} disabled={busy} onClick={() => send('delete')}>
            withdraw
          </button>
        </div>
      )}
      {!open && lastResolved && status !== 'verified' && (
        <div className={styles["panel-detail"]}>
          Your last request ({formatDate(lastResolved.resolved_at)}): not verified
          {lastResolved.resolution ? ` — ${lastResolved.resolution}` : ''}.
        </div>
      )}

      {canRequest && published && (
        <div className={styles["panel-actions"]}>
          <input
            className={styles["note-input"]}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything staff should know (optional)"
            aria-label="Note for staff"
          />
          <button type="button" className={styles["btn"]} disabled={busy} onClick={() => send('post')}>
            {busy ? 'Sending…' : 'Request verification'}
          </button>
        </div>
      )}
      {canRequest && !published && (
        <div className={styles["panel-detail"]}>Publish the puzzle to request a verification.</div>
      )}
      {message && (
        <div className={message.tone === 'ok' ? styles["status-ok"] : styles["status-warn"]}>{message.text}</div>
      )}
    </div>
  );
}
