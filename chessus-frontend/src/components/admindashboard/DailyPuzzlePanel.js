import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import styles from "./admin-dashboard.module.scss";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";

/**
 * Admin tab for the daily puzzle rotation.
 *
 * Three things an admin needs and cannot get anywhere else:
 *
 *   1. What is lined up, far enough ahead that a bad pick can be swapped before
 *      anybody sees it. The last week is shown too, so "what was yesterday's"
 *      is answerable without a query.
 *   2. Where the queue runs dry. The scheduler stops rather than reaching for a
 *      puzzle nobody has verified, so an empty tail is the normal signal that
 *      more puzzles are needed - not a bug.
 *   3. A way to intervene: clear a day, pin a specific puzzle to one, or top the
 *      whole queue back up.
 *
 * The one thing an admin cannot override is a creator's own opt-out. Everything
 * else here is discretionary by design.
 */
export default function DailyPuzzlePanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [assignDate, setAssignDate] = useState('');
  const [assignId, setAssignId] = useState('');
  const [review, setReview] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [queue, pending] = await Promise.all([
        axios.get(`${API_URL}admin/daily-puzzles`, { headers: authHeader() }),
        axios.get(`${API_URL}admin/puzzle-pool/review`, { headers: authHeader() }),
      ]);
      setData(queue.data);
      setReview(pending.data?.review || []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load the daily puzzle queue');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (fn, successFallback) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ tone: 'ok', text: res?.data?.message || successFallback });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.message || 'That did not work' });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const clearDay = (date) => {
    if (!window.confirm(`Clear the puzzle scheduled for ${date}? The puzzle itself is not deleted.`)) return;
    act(() => axios.delete(`${API_URL}admin/daily-puzzles/${date}`, { headers: authHeader() }), 'Cleared');
  };

  const assign = () => {
    if (!assignDate || !assignId) {
      setNotice({ tone: 'error', text: 'A date and a puzzle id are both needed' });
      return;
    }
    act(
      () => axios.put(
        `${API_URL}admin/daily-puzzles/${assignDate}`,
        { puzzle_id: Number(assignId) },
        { headers: authHeader() }
      ),
      'Scheduled'
    );
  };

  const fill = () => act(
    () => axios.post(`${API_URL}admin/daily-puzzles/fill`, {}, { headers: authHeader() }),
    'Queue filled'
  );

  const refreshPool = () => act(
    () => axios.post(`${API_URL}admin/puzzle-pool/refresh`, {}, { headers: authHeader() }),
    'Pool refreshed'
  );

  const decide = (gameTypeId, status) => act(
    () => axios.put(
      `${API_URL}admin/puzzle-pool/${gameTypeId}`,
      { status },
      { headers: authHeader() }
    ),
    status === 'included' ? 'Added to the pool' : 'Kept out'
  );

  if (error) return <div className={styles["panel"]}><p>{error}</p></div>;
  if (!data) return <div className={styles["panel"]}><p>Loading…</p></div>;

  if (data.migrationPending) {
    return (
      <div className={styles["panel"]}>
        <h2>Puzzle of the Day</h2>
        <p>The daily puzzle tables have not been created on this server yet. Run migrations and reload.</p>
      </div>
    );
  }

  const today = data.today;
  const upcoming = (data.scheduled || []).filter(r => String(r.puzzle_date).slice(0, 10) >= today);
  const past = (data.scheduled || []).filter(r => String(r.puzzle_date).slice(0, 10) < today);

  const row = (r) => {
    const date = String(r.puzzle_date).slice(0, 10);
    return (
      <tr key={date}>
        <td>
          {date}
          {date === today && <strong> · today</strong>}
        </td>
        <td>
          #{r.puzzle_id} {r.title || <em>Untitled</em>}
          {!r.allow_daily && <span title="Creator has since opted out"> ⚠ opted out</span>}
          {r.validation_status !== 'valid' && <span title="No longer validating cleanly"> ⚠ {r.validation_status}</span>}
        </td>
        <td>{r.game_name} <small>({r.board_width}×{r.board_height})</small></td>
        <td>{r.creator_username || '—'}</td>
        <td>{r.scheduled_by_username ? `by ${r.scheduled_by_username}` : 'auto'}</td>
        <td>
          <button disabled={busy} onClick={() => clearDay(date)}>Clear</button>
        </td>
      </tr>
    );
  };

  return (
    <div className={styles["panel"]}>
      <h2>Puzzle of the Day</h2>

      <p>
        {upcoming.length} day(s) scheduled from today, of a {data.horizonDays}-day horizon.{' '}
        {data.eligibleUnscheduled} eligible puzzle(s) are waiting to be used.
        {data.pool && (
          <> Pool: {data.pool.in_pool} game(s) in, {data.pool.awaiting} awaiting a decision,{' '}
          {data.pool.excluded_count} out.</>
        )}
      </p>

      {upcoming.length < data.horizonDays && (
        <p>
          The queue is short. The scheduler stops rather than using a puzzle that has not
          been verified, so this usually means more puzzles are needed — not that
          something has broken.
        </p>
      )}

      {notice && <p className={styles[notice.tone === 'ok' ? 'success' : 'error']}>{notice.text}</p>}

      <div className={styles["actions"]}>
        <button disabled={busy} onClick={fill}>Fill the queue</button>
        <button disabled={busy} onClick={refreshPool}>Add new games to the pool</button>
        <button disabled={busy} onClick={load}>Reload</button>
      </div>
      <p>
        “Add new games to the pool” brings in games made since the last sweep that now
        have a checked puzzle and meet the requirements. It only ever adds — it cannot
        overturn a decision you made below.
      </p>

      <h3>Schedule a specific puzzle</h3>
      <div className={styles["actions"]}>
        <input
          type="date"
          value={assignDate}
          onChange={(e) => setAssignDate(e.target.value)}
          aria-label="Date"
        />
        <input
          type="number"
          placeholder="Puzzle id"
          value={assignId}
          onChange={(e) => setAssignId(e.target.value)}
          aria-label="Puzzle id"
        />
        <button disabled={busy} onClick={assign}>Schedule</button>
      </div>
      <p>
        Overrides whatever was on that day. A puzzle whose creator has opted out cannot be
        scheduled — that is the one thing this does not override.
      </p>

      {/*
        * The review queue. These games are OUT of the rotation until somebody
        * rules on them, so this is where a short queue usually gets fixed.
        *
        * Each row shows what the sweep matched on and what each side already
        * has, because "which of these two do I keep" is far easier to answer
        * next to the play counts and the number of ready puzzles.
        */}
      {!!review && review.length > 0 && (
        <>
          <h3>Games waiting on your decision ({review.length})</h3>
          <p>
            The sweep found each of these too similar to another game to add on its own,
            but not similar enough to drop without asking. They stay out of the rotation
            until you rule. Open either game to compare them.
          </p>
          <div className={styles["table"]} style={{ display: 'block' }}>
            {review.map((r) => (
              <div
                key={r.game_type_id}
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  padding: '12px 0',
                  display: 'flex',
                  gap: '16px',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <div>
                    <a href={`/games/${r.game_type_id}`} target="_blank" rel="noreferrer">
                      #{r.game_type_id} {r.game_name}
                    </a>{' '}
                    <small>
                      {r.board_width}×{r.board_height} · {r.plays} play(s) ·{' '}
                      {r.ready_puzzles} ready puzzle(s)
                    </small>
                  </div>
                  {!!r.duplicate_of && (
                    <div style={{ marginTop: 4 }}>
                      <small>looks like </small>
                      <a href={`/games/${r.duplicate_of}`} target="_blank" rel="noreferrer">
                        #{r.duplicate_of} {r.other_name}
                      </a>{' '}
                      <small>
                        {r.other_width}×{r.other_height} · {r.other_plays} play(s) ·{' '}
                        {r.other_ready_puzzles} ready puzzle(s)
                      </small>
                    </div>
                  )}
                  <div style={{ marginTop: 4 }}>
                    <small>
                      matched on <strong>{r.similarity_kind || 'similarity'}</strong>
                      {r.similarity_score != null && <> ({r.similarity_score}% confidence)</>}
                    </small>
                  </div>
                </div>
                <div className={styles["actions"]} style={{ flex: '0 0 auto', margin: 0 }}>
                  <button disabled={busy} onClick={() => decide(r.game_type_id, 'included')}>
                    Keep in pool
                  </button>
                  <button disabled={busy} onClick={() => decide(r.game_type_id, 'excluded')}>
                    Leave out
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Upcoming</h3>
      {upcoming.length === 0 ? <p>Nothing scheduled.</p> : (
        <table className={styles["table"]}>
          <thead>
            <tr><th>Date</th><th>Puzzle</th><th>Game</th><th>Creator</th><th>Scheduled</th><th /></tr>
          </thead>
          <tbody>{upcoming.map(row)}</tbody>
        </table>
      )}

      {past.length > 0 && (
        <>
          <h3>Recently shown</h3>
          <table className={styles["table"]}>
            <thead>
              <tr><th>Date</th><th>Puzzle</th><th>Game</th><th>Creator</th><th>Scheduled</th><th /></tr>
            </thead>
            <tbody>{past.map(row)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
