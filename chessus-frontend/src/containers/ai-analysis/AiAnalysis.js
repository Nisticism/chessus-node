import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./ai-analysis.module.scss";

/**
 * Public-facing AI training analysis page.
 *
 * Two routes feed this component:
 *   /ai-analysis/:slug       — public link (visibility=public)
 *   /games/:gameId/analysis  — visibility-aware (admin/creator/public)
 */
const AiAnalysis = () => {
  const params = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const url = params.slug
        ? `${API_URL}ai-training/analysis/by-slug/${params.slug}`
        : `${API_URL}ai-training/analysis/${params.gameId}`;
      const res = await axios.get(url, { headers: authHeader() });
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  }, [params.slug, params.gameId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={styles.page}><p>Loading analysis…</p></div>;
  if (error) return (
    <div className={styles.page}>
      <h2>AI Training Analysis</h2>
      <p className={styles.error}>{error}</p>
    </div>
  );
  if (!data || !data.summary) return (
    <div className={styles.page}>
      <h2>AI Training Analysis</h2>
      <p>Analysis is not available.</p>
    </div>
  );

  const s = data.summary;
  const gtid = data.gameTypeId;

  return (
    <div className={styles.page}>
      <h2>AI Training Analysis</h2>
      <p className={styles.intro}>
        This report aggregates outcomes from every self-play training game
        for{' '}
        {gtid ? <Link to={`/games/${gtid}`}>game type #{gtid}</Link> : 'this game'}.
        Numbers are produced by the AI bot playing itself many times, then
        summarized to highlight balance issues.
      </p>

      <div className={styles.headlineGrid}>
        <Stat label="Total games" value={s.totalGames} />
        <Stat label="Decisive" value={`${s.decisive} (${pct(s.decisive, s.totalGames)})`} />
        <Stat label="Draws" value={`${s.draws} (${pct(s.draws, s.totalGames)})`} />
        <Stat label="Avg moves / game" value={s.avgMoves.toFixed(1)} />
      </div>

      <div className={styles.section}>
        <h3>Player balance</h3>
        <div className={styles.sideRow}>
          <div className={styles.sideBlock}>
            <h4>{labelForPlayer(1)}</h4>
            <div className={styles.bigNumber}>{(s.perSide['1'].winRate * 100).toFixed(1)}%</div>
            <div className={styles.sideSublabel}>{s.perSide['1'].wins} wins</div>
          </div>
          <div className={styles.sideBlock}>
            <h4>{labelForPlayer(2)}</h4>
            <div className={styles.bigNumber}>{(s.perSide['2'].winRate * 100).toFixed(1)}%</div>
            <div className={styles.sideSublabel}>{s.perSide['2'].wins} wins</div>
          </div>
          <div className={styles.sideBlock}>
            <h4>Drew</h4>
            <div className={styles.bigNumber}>{(s.balance.drawShare * 100).toFixed(1)}%</div>
            <div className={styles.sideSublabel}>{s.draws} games</div>
          </div>
        </div>
        <div className={`${styles.balanceCard} ${styles[`severity_${s.balance.severity}`] || ''}`}>
          <strong>Imbalance: {s.balance.severity}</strong> (
          {(s.balance.imbalance * 100).toFixed(1)}% gap between the two
          players across decisive games)
          {s.balance.note && <p>{s.balance.note}</p>}
        </div>
      </div>

      <div className={styles.section}>
        <h3>How games ended</h3>
        <h4>Draws ({s.draws})</h4>
        <ul>
          {Object.entries(s.drawBreakdown)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => <li key={k}>{prettyReason(k)}: {v} ({pct(v, s.draws)})</li>)}
          {s.draws === 0 && <li>None — every game produced a winner.</li>}
        </ul>
        <h4>Decisive ({s.decisive})</h4>
        <ul>
          {Object.entries(s.decisiveBy)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => <li key={k}>{prettyReason(k)}: {v}</li>)}
          {s.decisive === 0 && <li>No decisive games yet.</li>}
        </ul>
      </div>

      <div className={styles.section}>
        <h3>Sample size</h3>
        <ul>
          <li>{s.jobCount} training job{s.jobCount === 1 ? '' : 's'}</li>
          <li>{s.totalGames} total games (game length: {s.minMoves}–{s.maxMoves} moves)</li>
          <li>Average game time: {(s.avgElapsedMs / 1000).toFixed(1)}s</li>
          {s.filteredLegacy && s.legacyExcluded > 0 && (
            <li>
              {s.legacyExcluded} older game{s.legacyExcluded === 1 ? '' : 's'} excluded
              (from training runs before draw/end-reason tracking was added).
            </li>
          )}
        </ul>
      </div>

      {data.generatedAt && (
        <p className={styles.footer}>
          Last regenerated {new Date(data.generatedAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
};

const Stat = ({ label, value }) => (
  <div className={styles.stat}>
    <div className={styles.statLabel}>{label}</div>
    <div className={styles.statValue}>{value}</div>
  </div>
);

const pct = (n, d) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '0%';

// Color labels are not stored on game types today, so we just use the
// generic "Player 1" / "Player 2" terminology. If a per-game-type color
// field is added later, surface it here (e.g. "Player 1 (White)").
function labelForPlayer(n) {
  return `Player ${n}`;
}

const REASON_LABELS = {
  stalemate: 'Stalemate',
  move_limit: 'Move-limit rule (fifty-move analog)',
  move_cap_rollout: 'Trainer move cap (game ran past 400 plies)',
  rollout_cap: 'Random rollout cap',
  no_move: 'No legal move available',
  royal_capture: 'Royal piece captured',
  checkmate: 'Checkmate',
  unknown: 'Unrecorded reason (older training run)',
};
function prettyReason(k) { return REASON_LABELS[k] || k; }

export default AiAnalysis;
