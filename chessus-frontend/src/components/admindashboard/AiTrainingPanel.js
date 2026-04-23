import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./ai-training-panel.module.scss";

/**
 * Admin tab for AI self-play training.
 *
 * - Lists existing/recent training jobs from the DB.
 * - Lets an admin start a new job for any game type.
 * - Polls the selected job's status (every 3s) for live progress.
 *
 * See AI_OVERHAUL_PLAN.md for the broader design.
 */
const AiTrainingPanel = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [gameTypes, setGameTypes] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);

  // Form state
  const [form, setForm] = useState({
    gameTypeId: "",
    games: 200,
    mctsIters: 200,
    maxRssMb: 2048,
    checkpointEvery: 25,
    seed: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const pollRef = useRef(null);
  const [pauseStatus, setPauseStatus] = useState(null);

  // Artifact upload state
  const [uploadGameTypeId, setUploadGameTypeId] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadingArtifact, setUploadingArtifact] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const uploadInputRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}admin/ai-training/status`, {
        headers: authHeader(),
      });
      setStatus(res.data);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPauseStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}admin/ai-training/pause-status`, {
        headers: authHeader(),
      });
      setPauseStatus(res.data);
    } catch (_) { /* non-fatal */ }
  }, []);

  const togglePause = async () => {
    try {
      const url = pauseStatus?.paused
        ? `${API_URL}admin/ai-training/resume`
        : `${API_URL}admin/ai-training/pause`;
      const body = pauseStatus?.paused ? {} : { reason: 'paused by admin from dashboard' };
      const res = await axios.post(url, body, { headers: authHeader() });
      setPauseStatus(res.data);
    } catch (err) {
      alert(err?.response?.data?.message || err.message || 'Failed to toggle pause');
    }
  };

  const fetchGameTypes = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}admin/games?limit=500&page=1`, {
        headers: authHeader(),
      });
      const list = Array.isArray(res.data?.data)
        ? res.data.data
        : Array.isArray(res.data)
        ? res.data
        : [];
      setGameTypes(list);
    } catch (err) {
      // Non-fatal — admin can still type a game id manually.
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchGameTypes();
    fetchPauseStatus();
  }, [fetchStatus, fetchGameTypes, fetchPauseStatus]);

  // Poll status every 5 s while the panel is open.
  useEffect(() => {
    const id = setInterval(() => {
      fetchStatus();
      fetchPauseStatus();
    }, 5000);
    return () => clearInterval(id);
  }, [fetchStatus, fetchPauseStatus]);

  // Poll selected job detail every 3 s.
  useEffect(() => {
    if (!selectedJobId) {
      setJobDetail(null);
      return undefined;
    }
    const fetchDetail = async () => {
      try {
        const res = await axios.get(`${API_URL}admin/ai-training/jobs/${selectedJobId}`, {
          headers: authHeader(),
        });
        setJobDetail(res.data);
      } catch (err) {
        /* keep stale detail */
      }
    };
    fetchDetail();
    pollRef.current = setInterval(fetchDetail, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedJobId]);

  const handleStart = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await axios.post(
        `${API_URL}admin/ai-training/jobs`,
        {
          gameTypeId: parseInt(form.gameTypeId, 10),
          games: parseInt(form.games, 10),
          mctsIters: parseInt(form.mctsIters, 10),
          maxRssMb: parseInt(form.maxRssMb, 10),
          checkpointEvery: parseInt(form.checkpointEvery, 10),
          seed: parseInt(form.seed, 10) || 0,
        },
        { headers: authHeader() },
      );
      setSelectedJobId(res.data?.job?.id || null);
      await fetchStatus();
    } catch (err) {
      setSubmitError(err?.response?.data?.message || err.message || "Failed to start job");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStop = async (jobId) => {
    if (!window.confirm(`Stop training job #${jobId}? Progress so far is preserved.`)) return;
    try {
      await axios.post(
        `${API_URL}admin/ai-training/jobs/${jobId}/stop`,
        {},
        { headers: authHeader() },
      );
      await fetchStatus();
    } catch (err) {
      alert(err?.response?.data?.message || err.message || "Failed to stop job");
    }
  };

  const handleResume = async (jobId) => {
    try {
      await axios.post(
        `${API_URL}admin/ai-training/jobs/${jobId}/resume`,
        {},
        { headers: authHeader() },
      );
      await fetchStatus();
    } catch (err) {
      alert(err?.response?.data?.message || err.message || "Failed to resume job");
    }
  };

  const handleArtifactUpload = async (e) => {
    e.preventDefault();
    setUploadError(null);
    setUploadResult(null);
    if (!uploadFile) {
      setUploadError("Choose a .jsonl or .zip file first.");
      return;
    }
    const gtid = parseInt(uploadGameTypeId, 10);
    if (!Number.isFinite(gtid) || gtid <= 0) {
      setUploadError("Choose a game type to attach this upload to.");
      return;
    }
    const lower = uploadFile.name.toLowerCase();
    if (!lower.endsWith('.jsonl') && !lower.endsWith('.zip')) {
      setUploadError("File must be a .jsonl (raw book) or .zip (full job dir).");
      return;
    }
    setUploadingArtifact(true);
    try {
      const fd = new FormData();
      fd.append('artifact', uploadFile);
      fd.append('gameTypeId', String(gtid));
      const res = await axios.post(
        `${API_URL}admin/ai-training/upload-artifacts`,
        fd,
        {
          headers: { ...authHeader(), 'Content-Type': 'multipart/form-data' },
        },
      );
      setUploadResult(res.data);
      setUploadFile(null);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      await fetchStatus();
    } catch (err) {
      setUploadError(err?.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setUploadingArtifact(false);
    }
  };

  if (loading && !status) {
    return <div className={styles.panel}>Loading AI training status…</div>;
  }

  return (
    <div className={styles.panel}>
      <h3>AI Training</h3>
      <p className={styles.intro}>
        Train a self-play AI for any game type. Training runs as a sandboxed
        Rust subprocess (2 GB RAM / 1 core by default) so it cannot impact
        the live game server.
        {status?.remoteMode && (
          <> Trainer runs on the <strong>frontend EC2 instance</strong> via the trainer-service proxy.</>
        )}
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {pauseStatus && (
        <div
          style={{
            padding: '8px 12px',
            margin: '8px 0',
            borderRadius: 4,
            background: pauseStatus.paused ? '#5b1f1f' : '#1f3a1f',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>
            {pauseStatus.paused ? (
              <><strong>Training paused.</strong> {pauseStatus.reason || ''} New jobs and resumes will be rejected. Existing in-flight jobs continue.</>
            ) : (
              <>Training is accepting new jobs.</>
            )}
          </span>
          <button type="button" onClick={togglePause}>
            {pauseStatus.paused ? 'Resume Training' : 'Pause Training'}
          </button>
        </div>
      )}

      {status && !status.engineAvailable && (
        <div className={styles.warning}>
          <strong>
            {status.remoteMode
              ? 'Trainer service is unreachable or the Rust binary is not built on the frontend EC2.'
              : 'Rust trainer is not built.'}
          </strong>{' '}
          {status.remoteMode ? (
            <>Verify <code>trainer-service</code> is running on the frontend instance and that <code>REMOTE_TRAINER_URL</code> + <code>TRAINER_SHARED_SECRET</code> are configured on the backend.</>
          ) : (
            <>SSH into the server and run:
              <pre className={styles.code}>cd ai-engine-rs && cargo build --release</pre>
              (Install Rust first via <code>scripts/install-rust.sh</code> or
              <code> scripts/install-rust.bat</code> if it's missing.) Expected
              binary path: <code>{status.enginePath}</code>
            </>
          )}
        </div>
      )}

      <div className={styles.section}>
        <h4>Start a new training job</h4>
        <form onSubmit={handleStart} className={styles.form}>
          <label>
            Game type
            <select
              value={form.gameTypeId}
              onChange={(e) => setForm({ ...form, gameTypeId: e.target.value })}
              required
            >
              <option value="">— select —</option>
              {gameTypes.map((g) => (
                <option key={g.id} value={g.id}>
                  #{g.id} — {g.game_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Self-play games
            <input
              type="number"
              min={1}
              max={100000}
              value={form.games}
              onChange={(e) => setForm({ ...form, games: e.target.value })}
            />
          </label>
          <label>
            MCTS iterations / move
            <input
              type="number"
              min={10}
              max={5000}
              value={form.mctsIters}
              onChange={(e) => setForm({ ...form, mctsIters: e.target.value })}
            />
          </label>
          <label>
            Max RAM (MB)
            <input
              type="number"
              min={128}
              max={8192}
              value={form.maxRssMb}
              onChange={(e) => setForm({ ...form, maxRssMb: e.target.value })}
            />
          </label>
          <label>
            Checkpoint every N games
            <input
              type="number"
              min={1}
              max={10000}
              value={form.checkpointEvery}
              onChange={(e) => setForm({ ...form, checkpointEvery: e.target.value })}
            />
          </label>
          <label>
            Seed (0 = random)
            <input
              type="number"
              value={form.seed}
              onChange={(e) => setForm({ ...form, seed: e.target.value })}
            />
          </label>
          <button
            type="submit"
            disabled={submitting || !form.gameTypeId || (status && !status.engineAvailable)}
          >
            {submitting ? "Starting…" : "Start training"}
          </button>
          {submitError && <div className={styles.error}>{submitError}</div>}
        </form>
      </div>

      <div className={styles.section}>
        <h4>Upload pre-trained artifacts</h4>
        <p className={styles.intro}>
          Train on a dev machine and upload the results here. Uploaded data
          is merged with everything already gathered by cloud training — it
          stacks rather than replaces.
        </p>
        <details className={styles.details}>
          <summary>Local training instructions</summary>
          <ol>
            <li>
              Build the Rust trainer:
              <pre className={styles.code}>cd ai-engine-rs && cargo build --release</pre>
            </li>
            <li>
              Export the rules JSON for the game type you want to train (run
              from the project root):
              <pre className={styles.code}>{`node -e "require('./server/ai/export-game-rules').exportGameRules(<gameTypeId>).then(r => console.log(JSON.stringify(r, null, 2)))" > rules.json`}</pre>
            </li>
            <li>
              Run training:
              <pre className={styles.code}>{`./ai-engine-rs/target/release/ai-engine train --rules rules.json --out ./local-job --games 200 --mcts-iters 200`}</pre>
            </li>
            <li>
              Upload the resulting <code>book.jsonl</code> directly, OR zip
              the entire <code>local-job/</code> directory and upload that.
              A zip may also include <code>log.ndjson</code> and{' '}
              <code>model-*.bin</code> checkpoints — they will be preserved.
            </li>
          </ol>
          <p>
            The upload is recorded as a completed training job tagged{' '}
            <em>uploaded</em>. The adaptive bot consults the merged book
            from <strong>all</strong> jobs (cloud + uploaded) for that game
            type.
          </p>
        </details>
        <form onSubmit={handleArtifactUpload} className={styles.form}>
          <label>
            Game type
            <select
              value={uploadGameTypeId}
              onChange={(e) => setUploadGameTypeId(e.target.value)}
              required
            >
              <option value="">— select —</option>
              {gameTypes.map((g) => (
                <option key={g.id} value={g.id}>
                  #{g.id} — {g.game_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Artifact file (.jsonl or .zip)
            <input
              ref={uploadInputRef}
              type="file"
              accept=".jsonl,.zip,application/zip,application/x-zip-compressed"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            type="submit"
            disabled={uploadingArtifact || !uploadFile || !uploadGameTypeId}
          >
            {uploadingArtifact ? 'Uploading…' : 'Upload artifact'}
          </button>
          {uploadError && <div className={styles.error}>{uploadError}</div>}
          {uploadResult && (
            <div className={styles.success || ''}>
              Uploaded job #{uploadResult.jobId} — {uploadResult.gamesEstimate} games,{' '}
              {uploadResult.recordCount} positions
              {uploadResult.extrasImported?.length
                ? ` (extras: ${uploadResult.extrasImported.join(', ')})`
                : ''}
              .
            </div>
          )}
        </form>
      </div>

      <div className={styles.section}>
        <h4>Recent jobs</h4>
        {(!status || !status.jobs || status.jobs.length === 0) ? (
          <div className={styles.empty}>No training jobs yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Game</th>
                <th>Status</th>
                <th>Progress</th>
                <th>MCTS</th>
                <th>Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {status.jobs.map((j) => (
                <tr
                  key={j.id}
                  className={selectedJobId === j.id ? styles.activeRow : ""}
                  onClick={() => setSelectedJobId(j.id)}
                >
                  <td>{j.id}</td>
                  <td>{j.game_type_id}</td>
                  <td>
                    <span className={`${styles.status} ${styles[`status_${j.status}`] || ""}`}>
                      {j.status}
                    </span>
                    {j.source === 'uploaded' && (
                      <span
                        className={styles.uploadedBadge || ''}
                        style={{
                          marginLeft: 6,
                          fontSize: '0.75em',
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: '#e0f2fe',
                          color: '#075985',
                          border: '1px solid #7dd3fc',
                        }}
                        title="Imported from a file upload (not cloud-trained)"
                      >
                        uploaded
                      </span>
                    )}
                  </td>
                  <td>
                    {j.games_played} / {j.games_target}
                  </td>
                  <td>{j.mcts_iters}</td>
                  <td>{j.started_at ? new Date(j.started_at).toLocaleString() : "-"}</td>
                  <td>
                    {j.status === "running" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStop(j.id);
                        }}
                      >
                        Stop
                      </button>
                    )}
                    {(j.status === "stopped" ||
                      j.status === "interrupted" ||
                      j.status === "failed" ||
                      j.status === "aborted_oom") &&
                      (j.games_played || 0) < (j.games_target || 0) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResume(j.id);
                          }}
                        >
                          Resume
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedJobId && jobDetail && (
        <div className={styles.section}>
          <h4>Job #{selectedJobId} — recent events</h4>
          <div className={styles.summary}>
            Live progress: <strong>{jobDetail.liveProgress}</strong> /{" "}
            {jobDetail.job?.games_target} games
            {jobDetail.isLive ? " (running on this server)" : " (not active here)"}
            {jobDetail.job?.error_message && (
              <div className={styles.error}>Error: {jobDetail.job.error_message}</div>
            )}
          </div>
          <div className={styles.eventLog}>
            {(jobDetail.events || []).slice().reverse().map((ev, i) => (
              <div key={i} className={styles.event}>
                <code>{JSON.stringify(ev)}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AiTrainingPanel;
