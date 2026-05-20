import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import styles from "./admin-dashboard.module.scss";
import ToggleSwitch from "../common/ToggleSwitch";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";

/**
 * Admin tab for the Fairy-Stockfish bot integration.
 *
 * Surfaces:
 *   1. Server-side engine stats (active workers, queue depth, estimated RAM).
 *      Until the deep-analysis engine is wired, this just shows zeros and a
 *      "Not implemented" note.
 *   2. Per-game-type deep-analysis toggle. When OFF (the default), the bot
 *      runs in the player's browser (zero server RAM). When ON, the server
 *      will eventually run the engine itself for stronger play.
 */
export default function FairyStockfishPanel() {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [gameTypes, setGameTypes] = useState(null);
  const [gameTypesError, setGameTypesError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [filter, setFilter] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const resp = await axios.get(`${API_URL}admin/fairy-stockfish/stats`, { headers: authHeader() });
      setStats(resp.data);
      setStatsError(null);
    } catch (err) {
      setStatsError(err?.response?.data?.message || "Failed to load engine stats");
    }
  }, []);

  const loadGameTypes = useCallback(async () => {
    try {
      const resp = await axios.get(`${API_URL}admin/fairy-stockfish/game-types`, { headers: authHeader() });
      setGameTypes(Array.isArray(resp.data) ? resp.data : []);
      setGameTypesError(null);
    } catch (err) {
      setGameTypesError(err?.response?.data?.message || "Failed to load game types");
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadGameTypes();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, [loadStats, loadGameTypes]);

  const toggleDeepAnalysis = async (id, next) => {
    setSavingId(id);
    try {
      await axios.put(
        `${API_URL}admin/fairy-stockfish/game-types/${id}`,
        { deepAnalysisEnabled: next },
        { headers: authHeader() },
      );
      setGameTypes(prev => (prev || []).map(g => g.id === id ? { ...g, deepAnalysisEnabled: next } : g));
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update deep analysis flag");
    } finally {
      setSavingId(null);
    }
  };

  const filtered = (gameTypes || []).filter(g =>
    !filter || g.gameName.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className={styles["fairy-stockfish-panel"] || ""}>
      <h3>Fairy-Stockfish Bot</h3>
      <p style={{ color: "#bbb", fontSize: 14, marginTop: 0 }}>
        The Fairy-Stockfish bot is a strong, classical-style computer player
        powered by a WebAssembly chess engine. By default it runs in the
        player's browser at no cost to the server. Enable "Deep Analysis"
        on a game type to have the server run the engine instead for stronger
        play (uses ~20&nbsp;MB RAM per active match).
      </p>

      <section style={{ marginTop: 20 }}>
        <h4>Server Engine Stats</h4>
        {statsError && <div style={{ color: "#f88" }}>{statsError}</div>}
        {!stats && !statsError && <div>Loading...</div>}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Stat label="Active workers" value={stats.activeWorkers} />
            <Stat label="Queue depth" value={stats.queueDepth} />
            <Stat label="Max workers" value={stats.maxWorkers} />
            <Stat label="Estimated RAM" value={`${stats.estimatedRamMB} MB`} />
          </div>
        )}
        {stats && !stats.engineImplemented && (
          <p style={{ color: "#fc8", fontSize: 13, marginTop: 12 }}>
            Note: the server-side deep-analysis engine is not yet wired.
            Game types with "Deep Analysis" enabled will currently fall
            back to the existing medium AI on the server. All client-side
            (browser) Fairy-Stockfish matches are unaffected and work.
          </p>
        )}
      </section>

      <section style={{ marginTop: 30 }}>
        <h4>Per-Game-Type Deep Analysis</h4>
        <input
          type="text"
          placeholder="Filter by name..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: 12, padding: 6, width: 240 }}
        />
        {gameTypesError && <div style={{ color: "#f88" }}>{gameTypesError}</div>}
        {!gameTypes && !gameTypesError && <div>Loading...</div>}
        {gameTypes && (
          <table className={styles["table"] || ""} style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Game Type</th>
                <th style={{ textAlign: "left" }}>Board</th>
                <th style={{ textAlign: "left" }}>Deep Analysis</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id}>
                  <td>{g.gameName}</td>
                  <td>{g.boardWidth}x{g.boardHeight}</td>
                  <td>
                    <ToggleSwitch
                      checked={!!g.deepAnalysisEnabled}
                      onChange={(v) => toggleDeepAnalysis(g.id, v)}
                      label={savingId === g.id ? "Saving..." : ""}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={3} style={{ color: "#888" }}>No game types match.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: 12, background: "#1e1e1e", borderRadius: 6 }}>
      <div style={{ color: "#aaa", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
