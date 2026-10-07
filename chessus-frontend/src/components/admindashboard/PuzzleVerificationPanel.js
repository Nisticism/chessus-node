import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import { formatDateLegacy } from "../../helpers/date-formatter";
import admin from "./admin-dashboard.module.scss";
import styles from "./puzzle-verification.module.scss";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";

/*
 * Admin tab for the "verified unique solution" badge.
 *
 * Every puzzle, with where its badge stands. From here staff can:
 *   - run a uniqueness search of any puzzle. It runs in the server's 'long'
 *     job lane - its own worker thread with a capped heap and a reduced CPU
 *     share, one search at a time - for as long as it needs, or until a chosen
 *     limit or a cancel; its verdict sets the badge;
 *   - award or refuse the badge by hand, for what no search can settle;
 *   - resolve a creator's verification request, which notifies them.
 * Open requests sort to the top.
 */

const FILTERS = [
  ['requested', 'Requested'],
  ['all', 'All'],
  ['unchecked', 'Not verified'],
  ['verified', 'Verified'],
  ['not_unique', 'Refused'],
];

const LIMITS = [
  ['', 'No time limit'],
  ['1', 'Stop after 1 hour'],
  ['6', 'Stop after 6 hours'],
  ['24', 'Stop after 24 hours'],
];

const STATUS_LABEL = { verified: 'One solution', not_unique: 'Refused', unchecked: 'Not verified' };
// A finished search's verdict. The last two grade the line itself (puzzle-line-quality.js).
const RUN_VERDICT_LABEL = {
  unique: 'one solution', not_unique: 'not unique', not_forced: 'not forced',
  weak_reply: 'weak opponent reply', slow_move: 'slow solver move',
};
// The verdict form's outcome a search verdict suggests.
const SUGGESTED_OUTCOME = { weak_reply: 'weak_reply', slow_move: 'slow_move', not_unique: 'not_unique', unique: 'verified' };
const METHOD_LABEL = { auto: 'automatic check', search: 'staff search', manual: 'by hand' };

const duration = (ms) => {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

function LiveProgress({ live }) {
  const p = live.progress;
  if (live.state === 'queued') return <span className={styles["small"]}>Waiting for the search before it to finish (#{live.queuePosition} in line).</span>;
  const fraction = p && p.total ? (p.step > 1 ? 0.95 : Math.min(0.95, p.done / p.total)) : 0;
  return (
    <div>
      <div className={styles["bar"]}><div className={styles["bar-fill"]} style={{ width: `${Math.max(2, fraction * 100)}%` }} /></div>
      <span className={styles["small"]}>
        {p ? `Move ${p.step} of ${p.steps}` : 'Starting'}
        {p && p.total ? ` · ${p.done}/${p.total} first moves` : ''}
        {p && p.nodes ? ` · ${Number(p.nodes).toLocaleString()} positions` : ''}
        {` · ${duration(live.elapsedMs)} so far`}
        {live.etaMs != null ? ` · about ${duration(live.etaMs)} left` : ''}
      </span>
    </div>
  );
}

export default function PuzzleVerificationPanel() {
  const [filter, setFilter] = useState('requested');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [limitFor, setLimitFor] = useState({});
  /*
   * The one place a verdict is given: { puzzleId, requestId (null when nobody
   * asked), outcome, reason }. Award, Not unique and Resolve request all open
   * it; with a request open it resolves it (setting the badge and telling the
   * requester), without one it only sets the badge. No pop-ups.
   */
  const [resolving, setResolving] = useState(null);
  const liveCount = useRef(0);

  const load = useCallback(async (opts = {}) => {
    setError(null);
    try {
      const { data: d } = await axios.get(`${API_URL}admin/puzzle-verification`, {
        headers: authHeader(),
        params: { filter: opts.filter ?? filter, search: opts.search ?? search, page: opts.page ?? page, limit: 25 },
      });
      setData(d);
      liveCount.current = d.running || 0;
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load puzzles');
    }
  }, [filter, search, page]);

  useEffect(() => { load(); }, [load]);

  /*
   * While a search is running, follow its progress; when one ends, reload so
   * the row shows the verdict.
   */
  useEffect(() => {
    if (!data?.running) return undefined;
    const t = setInterval(async () => {
      try {
        const { data: d } = await axios.get(`${API_URL}admin/puzzle-verification/live`, { headers: authHeader() });
        const byPuzzle = new Map((d.live || []).map((j) => [j.meta?.puzzleId, j]));
        if ((d.live || []).length < liveCount.current) { load(); return; }
        setData((prev) => (prev ? {
          ...prev,
          puzzles: prev.puzzles.map((p) => ({ ...p, live: byPuzzle.get(p.id) || null })),
        } : prev));
      } catch (_) { /* the next tick will try again */ }
    }, 2000);
    return () => clearInterval(t);
  }, [data?.running, load]);

  const act = async (fn, okText) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ tone: 'ok', text: res?.data?.message || okText });
      await load();
      return true;
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.message || 'That did not work' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runSearch = (p) => act(
    () => axios.post(`${API_URL}admin/puzzles/${p.id}/verification-runs`,
      { maxHours: limitFor[p.id] ? Number(limitFor[p.id]) : undefined }, { headers: authHeader() }),
    'Search started'
  );
  const cancelRun = (p) => {
    if (!window.confirm(`Stop the search of #${p.id}? Its progress is lost.`)) return;
    act(() => axios.post(`${API_URL}admin/puzzle-verification-runs/${p.live.meta.runId}/cancel`, {}, { headers: authHeader() }), 'Canceled');
  };
  const clearVerdict = (p) => act(
    () => axios.post(`${API_URL}admin/puzzles/${p.id}/unique`, { status: 'unchecked', detail: '' }, { headers: authHeader() }),
    'Cleared'
  );
  // Open the verdict form, on the outcome the clicked button stands for (or the
  // one the puzzle's current status suggests).
  const startResolve = (p, preset) => {
    const outcome = preset
      || SUGGESTED_OUTCOME[p.run_verdict]
      || (p.unique_status === 'verified' ? 'verified' : p.unique_status === 'not_unique' ? 'not_unique' : (p.request_id ? 'not_verified' : 'not_unique'));
    const reason = outcome === 'verified' ? '' : (p.unique_detail || p.run_detail || '');
    setResolving({ requestId: p.request_id || null, puzzleId: p.id, outcome, reason });
  };
  const sendResolve = () => {
    const { requestId, puzzleId, outcome, reason } = resolving;
    // A request: resolve it (badge + the requester's notification). None: just the badge.
    const call = requestId
      ? () => axios.post(`${API_URL}admin/puzzle-verification-requests/${requestId}/resolve`, { outcome, reason }, { headers: authHeader() })
      : () => axios.post(`${API_URL}admin/puzzles/${puzzleId}/unique`,
        { status: outcome === 'verified' ? 'verified' : 'not_unique', detail: reason }, { headers: authHeader() });
    return act(call, requestId ? 'Resolved' : 'Saved').then((ok) => { if (ok) setResolving(null); });
  };

  if (error) return <div><p>{error}</p></div>;
  if (!data) return <div><p>Loading…</p></div>;
  if (data.migrationPending) {
    return <div><h2>Puzzle Verification</h2><p>The verification tables have not been created on this server yet. Run migrations and reload.</p></div>;
  }

  const lanes = data.limits?.lanes || {};
  const long = lanes.long;
  const counts = data.counts || {};
  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.limit || 25)));

  return (
    <div>
      <h2>Puzzle Verification</h2>
      <p className={styles["intro"]}>
        The <strong>One solution</strong> badge means exactly one winning move at every step of a
        puzzle, the last included, against every defense. “Check puzzle” settles it automatically
        for puzzles of up to three moves. For longer ones, run a search here — it runs for as long
        as it needs — or award the badge by hand. Players’ puzzles need the badge to be picked as
        Puzzle of the Day; GridGrove’s own are exempt.
      </p>
      {long && (
        <p className={styles["caps"]}>
          Searches run one at a time in their own worker thread, capped at {long.heapMb} MB of memory
          and {Math.round(long.dutyCycle * 100)}% of one CPU core (the server has {data.limits.cpus}).
          Builder checks use a separate lane ({lanes.interactive?.heapMb} MB, {Math.round((lanes.interactive?.dutyCycle || 0) * 100)}%),
          so neither waits for the other. A server restart stops a search; start it again afterwards.
        </p>
      )}

      <div className={styles["filters"]}>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={`${admin["tab"]} ${filter === key ? admin["active"] : ""}`}
            onClick={() => { setFilter(key); setPage(1); }}
          >
            {label}{counts[key] != null ? ` (${counts[key]})` : ''}
          </button>
        ))}
        <input
          className={styles["search"]}
          placeholder="Search title, game, creator or #id"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {notice && <p className={admin[notice.tone === 'ok' ? 'success' : 'error']}>{notice.text}</p>}

      {data.puzzles.length === 0 ? <p>No puzzles here.</p> : (
        <div className={admin["table-container"]}>
          <table className={admin["data-table"]}>
            <thead>
              <tr><th>Puzzle</th><th>Line</th><th>Badge</th><th>Request</th><th>Search</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {data.puzzles.map((p) => (
                <tr key={p.id}>
                  <td className={styles["cell"]}>
                    <a className={styles["title-link"]} href={`/games/${p.game_type_id}/puzzles/${p.id}`} target="_blank" rel="noreferrer">
                      #{p.id} {p.title || 'Untitled'}
                    </a>
                    <span className={styles["small"]}>
                      {p.game_name || 'Unknown game'} · by {p.creator_username || 'deleted user'}
                      {p.is_draft ? ' · draft' : ''}
                    </span>
                  </td>
                  <td className={styles["cell"]}>
                    {p.solverMoves} move{p.solverMoves === 1 ? '' : 's'}
                    <span className={styles["small"]}>{p.goal_label} · check: {p.validation_status}</span>
                  </td>
                  <td className={styles["cell"]}>
                    <span className={styles[`status-${p.unique_status}`]}>{STATUS_LABEL[p.unique_status] || p.unique_status}</span>
                    {p.unique_method && (
                      <span className={styles["small"]}>
                        {METHOD_LABEL[p.unique_method] || p.unique_method}
                        {p.unique_checked_by_username ? ` (${p.unique_checked_by_username})` : ''}
                        {p.unique_checked_at ? `, ${formatDateLegacy(p.unique_checked_at)}` : ''}
                      </span>
                    )}
                    {p.unique_detail && <span className={styles["small"]}>{p.unique_detail}</span>}
                  </td>
                  <td className={styles["cell"]}>
                    {p.request_id ? (
                      <div className={styles["request"]}>
                        <strong>{p.requester_username || 'Someone'}</strong>
                        <span className={styles["small"]}>asked {formatDateLegacy(p.request_created_at)}</span>
                        {p.request_note && <span className={styles["small"]}>“{p.request_note}”</span>}
                      </div>
                    ) : '—'}
                  </td>
                  <td className={styles["cell"]}>
                    {p.live ? <LiveProgress live={p.live} /> : p.run_id ? (
                      <>
                        {p.run_state === 'done' ? (RUN_VERDICT_LABEL[p.run_verdict] || p.run_verdict || 'done') : p.run_state}
                        {p.run_finished_at && <span className={styles["small"]}>{formatDateLegacy(p.run_finished_at)}</span>}
                        {p.run_detail && p.run_detail !== p.unique_detail && <span className={styles["small"]}>{p.run_detail}</span>}
                      </>
                    ) : (p.autoCheckable ? <span className={styles["small"]}>Up to 3 moves: “Check puzzle” settles this.</span> : '—')}
                  </td>
                  <td className={styles["cell"]}>
                    <div className={styles["row-actions"]}>
                      {p.live ? (
                        <button className={admin["ban-btn"]} disabled={busy} onClick={() => cancelRun(p)}>Cancel search</button>
                      ) : p.searchable ? (
                        <>
                          <select
                            value={limitFor[p.id] || ''}
                            onChange={(e) => setLimitFor((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            aria-label="Time limit"
                          >
                            {LIMITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <button className={admin["promote-btn"]} disabled={busy} onClick={() => runSearch(p)}>Run search</button>
                        </>
                      ) : <span className={styles["small"]}>The search cannot judge this goal.</span>}
                    </div>
                    <div className={styles["row-actions"]} style={{ marginTop: 6 }}>
                      {resolving?.puzzleId !== p.id && (
                        <>
                          {p.unique_status !== 'verified' && (
                            <button className={admin["edit-btn"]} disabled={busy} onClick={() => startResolve(p, 'verified')}>Award</button>
                          )}
                          {p.unique_status !== 'not_unique' && (
                            <button className={admin["edit-btn"]} disabled={busy} onClick={() => startResolve(p, 'not_unique')}>Not unique</button>
                          )}
                          {p.request_id && (
                            <button className={admin["save-btn"]} disabled={busy} onClick={() => startResolve(p)}>Resolve request</button>
                          )}
                        </>
                      )}
                      {p.unique_status !== 'unchecked' && (
                        <button className={admin["cancel-btn"]} disabled={busy} onClick={() => clearVerdict(p)}>Clear</button>
                      )}
                    </div>
                    {resolving?.puzzleId === p.id && (
                      <div className={styles["resolve"]}>
                        <select
                          value={resolving.outcome}
                          onChange={(e) => setResolving({ ...resolving, outcome: e.target.value })}
                          aria-label="Outcome"
                        >
                          <option value="verified">Verified — award the badge</option>
                          <option value="not_unique">Not verified — more than one solution</option>
                          <option value="weak_reply">Not verified — an opponent reply is not their best</option>
                          <option value="slow_move">Not verified — a solver move is not the fastest</option>
                          {resolving.requestId && <option value="not_verified">Not verified — another reason</option>}
                        </select>
                        <textarea
                          value={resolving.reason}
                          maxLength={1000}
                          placeholder={resolving.outcome === 'verified'
                            ? (resolving.requestId ? 'Optional note for the creator' : 'Optional note, shown with the badge')
                            : (resolving.requestId ? 'Reason, sent to the creator' : 'Reason, shown with the verdict')}
                          onChange={(e) => setResolving({ ...resolving, reason: e.target.value })}
                        />
                        <div className={styles["row-actions"]}>
                          <button className={admin["save-btn"]} disabled={busy} onClick={sendResolve}>
                            {resolving.requestId ? `Send to ${p.requester_username || 'requester'}` : 'Save verdict'}
                          </button>
                          <button className={admin["cancel-btn"]} disabled={busy} onClick={() => setResolving(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className={styles["pager"]}>
          <button className={admin["page-button"]} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className={admin["page-button"]} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
