import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import styles from "./admin-dashboard.module.scss";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";

const card = { background: 'var(--bg-panel, #14202e)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '14px 18px', minWidth: 150 };
const th = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted, #9fb0c3)', fontWeight: 600, fontSize: 13 };
const td = { padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' };

// Best-effort ISO-3166 alpha-2 -> flag emoji.
function flag(cc) {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1f1e6, base = 'A'.charCodeAt(0);
  try { return String.fromCodePoint(A + cc.charCodeAt(0) - base, A + cc.charCodeAt(1) - base); } catch (_) { return ''; }
}

function TrafficPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true); setError(null);
    try {
      const resp = await axios.get(`${API_URL}admin/analytics?days=${d}`, { headers: authHeader() });
      setData(resp.data);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load analytics');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const t = data?.totals;
  const maxDaily = Math.max(1, ...((data?.daily || []).map(d => d.views)));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Traffic &amp; Usage</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={styles["tab"]}
              style={{ padding: '4px 12px', opacity: days === d ? 1 : 0.6, fontWeight: days === d ? 700 : 400 }}>
              {d}d
            </button>
          ))}
        </div>
        {data && !data.geoEnabled && (
          <span style={{ color: '#d4a64a', fontSize: 12 }}>Country lookup unavailable (geoip-lite not installed on server)</span>
        )}
      </div>

      {error && <p style={{ color: '#e06c6c' }}>{error}</p>}
      {loading && !data ? <p>Loading…</p> : data && (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
            <div style={card}><div style={{ fontSize: 12, opacity: 0.7 }}>Page views</div><div style={{ fontSize: 26, fontWeight: 700 }}>{t.views.toLocaleString()}</div></div>
            <div style={card}><div style={{ fontSize: 12, opacity: 0.7 }}>Unique visitors</div><div style={{ fontSize: 26, fontWeight: 700 }}>{t.visitors.toLocaleString()}</div></div>
            <div style={card}><div style={{ fontSize: 12, opacity: 0.7 }}>Logged-in views</div><div style={{ fontSize: 26, fontWeight: 700 }}>{t.authedViews.toLocaleString()}</div></div>
            <div style={card}><div style={{ fontSize: 12, opacity: 0.7 }}>Guest views</div><div style={{ fontSize: 26, fontWeight: 700 }}>{t.guestViews.toLocaleString()}</div></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            <div>
              <h3>Daily page views</h3>
              {(!data.daily || data.daily.length === 0) ? (
                <p style={{ opacity: 0.6 }}>No data yet.</p>
              ) : (
                <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, borderBottom: '1px solid rgba(255,255,255,0.12)', paddingTop: 8, minWidth: 'min-content' }}>
                    {data.daily.map(d => (
                      <div key={d.day} title={`${d.day}: ${d.views} views, ${d.visitors} visitors`}
                        style={{ width: 30, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
                        <span style={{ fontSize: 10, opacity: 0.75 }}>{d.views}</span>
                        <div style={{ width: '100%', height: `${Math.max(6, Math.round((d.views / maxDaily) * 100))}%`, minHeight: 6, background: 'var(--accent-muted, #4caf50)', borderRadius: '3px 3px 0 0' }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, minWidth: 'min-content' }}>
                    {data.daily.map(d => (
                      <div key={d.day} style={{ width: 30, fontSize: 9, opacity: 0.6, textAlign: 'center' }}>{d.day.slice(5)}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <h3>By country</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Country</th><th style={th}>Visitors</th><th style={th}>Views</th></tr></thead>
                <tbody>
                  {(data.byCountry || []).map(c => (
                    <tr key={c.country}><td style={td}>{flag(c.country)} {c.country}</td><td style={td}>{c.visitors}</td><td style={td}>{c.views}</td></tr>
                  ))}
                </tbody>
              </table>
              {(!data.byCountry || data.byCountry.length === 0) && <p style={{ opacity: 0.6 }}>No data yet.</p>}
            </div>

            <div>
              <h3>Top pages</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Path</th><th style={th}>Views</th></tr></thead>
                <tbody>
                  {(data.topPages || []).map(p => (
                    <tr key={p.path}><td style={td}>{p.path}</td><td style={td}>{p.views}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3>Acquisition (referrer / UTM source)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Source</th><th style={th}>Visitors</th><th style={th}>Views</th></tr></thead>
                <tbody>
                  {(data.topReferrers || []).map(r => (
                    <tr key={r.source}><td style={td}>{r.source}</td><td style={td}>{r.visitors}</td><td style={td}>{r.views}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default TrafficPanel;
