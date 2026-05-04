import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./ai-training-panel.module.scss";
import AiGameReplayModal from "./AiGameReplayModal";
import ToggleSwitch from "../common/ToggleSwitch";

/**
 * Admin tab for AI self-play training.
 *
 * - Lists existing/recent training jobs from the DB.
 * - Lets an admin start a new job for any game type.
 * - Polls the selected job's status (every 3s) for live progress.
 *
 * See AI_OVERHAUL_PLAN.md for the broader design.
 */
const AiTrainingPanel = ({ initialAnalysisGameTypeId } = {}) => {
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
    generateGameLog: false,
  });

  // Board replay modal state
  const [replayJobId, setReplayJobId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const pollRef = useRef(null);
  const [pauseStatus, setPauseStatus] = useState(null);

  // Global memory cap editing state
  const [capEditing, setCapEditing] = useState(false);
  const [capInput, setCapInput] = useState("");
  const [capSaving, setCapSaving] = useState(false);
  const [capError, setCapError] = useState(null);

  // Artifact upload state
  const [uploadGameTypeId, setUploadGameTypeId] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadingArtifact, setUploadingArtifact] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const uploadInputRef = useRef(null);

  // AI engine error log state
  const [aiErrors, setAiErrors] = useState([]);
  const [aiErrorsCollapsed, setAiErrorsCollapsed] = useState(true);

  const fetchAiErrors = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}admin/ai-engine/errors`, {
        headers: authHeader(),
      });
      setAiErrors(res.data?.errors || []);
    } catch (_) { /* non-fatal */ }
  }, []);

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
      const res = await axios.get(`${API_URL}admin/games?limit=500&page=1&includeTrainingOnly=true`, {
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
    fetchAiErrors();
  }, [fetchStatus, fetchGameTypes, fetchPauseStatus, fetchAiErrors]);

  // Poll status every 5 s while the panel is open.
  useEffect(() => {
    const id = setInterval(() => {
      fetchStatus();
      fetchPauseStatus();
      fetchAiErrors();
    }, 5000);
    return () => clearInterval(id);
  }, [fetchStatus, fetchPauseStatus, fetchAiErrors]);

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
        if (err?.response?.status === 404) {
          // Job was deleted — stop polling and deselect it.
          if (pollRef.current) clearInterval(pollRef.current);
          setSelectedJobId(null);
          setJobDetail(null);
        }
        /* otherwise keep stale detail */
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
          noGameLog: !form.generateGameLog,
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

  const handleDeleteData = async (jobId) => {
    if (!window.confirm(
      `Delete all on-disk training data for job #${jobId}?\n\nThis removes the log file and model files from disk and resets games_played to 0. The job record itself is kept for history. This cannot be undone.`
    )) return;
    try {
      await axios.delete(
        `${API_URL}admin/ai-training/jobs/${jobId}/data`,
        { headers: authHeader() },
      );
      await fetchStatus();
    } catch (err) {
      alert(err?.response?.data?.message || err.message || "Failed to delete job data");
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!window.confirm(
      `Permanently DELETE job #${jobId}?\n\nThis removes the job from the list AND wipes all on-disk training data (log + models). The job will no longer appear in history. This cannot be undone.`
    )) return;
    try {
      await axios.delete(
        `${API_URL}admin/ai-training/jobs/${jobId}`,
        { headers: authHeader() },
      );
      if (selectedJobId === jobId) {
        setSelectedJobId(null);
        setJobDetail(null);
      }
      await fetchStatus();
    } catch (err) {
      alert(err?.response?.data?.message || err.message || "Failed to delete job");
    }
  };

  const handleDownload = async (jobId) => {
    try {
      const res = await axios.get(
        `${API_URL}admin/ai-training/jobs/${jobId}/download`,
        { headers: authHeader(), responseType: 'blob' },
      );
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-job-${jobId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // response might be a blob containing JSON error
      let msg = 'Failed to download job';
      if (err?.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text()).message || msg; } catch (_) { /* ignore */ }
      } else {
        msg = err?.response?.data?.message || err.message || msg;
      }
      alert(msg);
    }
  };

  const handleGameLog = async (jobId) => {
    try {
      const res = await axios.get(
        `${API_URL}admin/ai-training/jobs/${jobId}/game-log`,
        { headers: authHeader(), responseType: 'blob' },
      );
      const blob = new Blob([res.data], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-job-${jobId}-games.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      let msg = 'Failed to download game log';
      if (err?.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text()).message || msg; } catch (_) { /* ignore */ }
      } else {
        msg = err?.response?.data?.message || err.message || msg;
      }
      alert(msg);
    }
  };

  // Wipe state
  const [wipeGameTypeId, setWipeGameTypeId] = useState('');
  const [wiping, setWiping] = useState(false);
  const [wipeResult, setWipeResult] = useState(null);
  const [wipeError, setWipeError] = useState(null);

  // Disk status state (on-demand per-job check)
  const [diskPresent, setDiskPresent] = useState(null); // Set<number> of job IDs on disk
  const [diskAbsent, setDiskAbsent] = useState(null);   // Set<number> of job IDs NOT on disk
  const [diskChecking, setDiskChecking] = useState(false);
  const [diskCheckError, setDiskCheckError] = useState(null);

  // Import rules (training-only game type) state
  const [importRulesFile, setImportRulesFile] = useState(null);
  const [importRulesName, setImportRulesName] = useState('');
  const [importingRules, setImportingRules] = useState(false);
  const [importRulesResult, setImportRulesResult] = useState(null);
  const [importRulesError, setImportRulesError] = useState(null);
  const importRulesInputRef = React.useRef(null);

  const handleImportRules = async (e) => {
    e.preventDefault();
    setImportRulesError(null);
    setImportRulesResult(null);
    if (!importRulesFile) {
      setImportRulesError('Choose a rules.json file first.');
      return;
    }
    if (!importRulesFile.name.toLowerCase().endsWith('.json')) {
      setImportRulesError('File must be a .json file (exported rules.json).');
      return;
    }
    setImportingRules(true);
    try {
      const fd = new FormData();
      fd.append('rules', importRulesFile);
      if (importRulesName.trim()) fd.append('display_name', importRulesName.trim());
      const res = await axios.post(
        `${API_URL}admin/ai-training/upload-rules`,
        fd,
        { headers: { ...authHeader(), 'Content-Type': 'multipart/form-data' } },
      );
      setImportRulesResult(res.data);
      setImportRulesFile(null);
      setImportRulesName('');
      if (importRulesInputRef.current) importRulesInputRef.current.value = '';
      await fetchGameTypes(); // refresh dropdowns so the new type appears
    } catch (err) {
      setImportRulesError(err?.response?.data?.message || err.message || 'Import failed');
    } finally {
      setImportingRules(false);
    }
  };

  const handleCheckDisk = async () => {
    if (!status?.jobs?.length) return;
    setDiskChecking(true);
    setDiskCheckError(null);
    try {
      const jobs = status.jobs.map((j) => ({ id: j.id, game_type_id: j.game_type_id }));
      const res = await axios.post(
        `${API_URL}admin/ai-training/disk-status`,
        { jobs },
        { headers: authHeader() },
      );
      setDiskPresent(new Set(res.data.present));
      setDiskAbsent(new Set(res.data.absent));
    } catch (err) {
      setDiskCheckError(err?.response?.data?.message || err.message || 'Disk check failed');
    } finally {
      setDiskChecking(false);
    }
  };

  // Sync-disk state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const handleSyncDisk = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await axios.post(
        `${API_URL}admin/ai-training/sync-disk`,
        {},
        { headers: authHeader() },
      );
      setSyncResult(res.data);
      await fetchStatus();
    } catch (err) {
      setSyncError(err?.response?.data?.message || err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Backup state
  const [backupGameTypeId, setBackupGameTypeId] = useState('');
  const [backing, setBacking] = useState(false);
  const [backupResult, setBackupResult] = useState(null);
  const [backupError, setBackupError] = useState(null);

  // Restore state
  const [latestSnapshot, setLatestSnapshot] = useState(null);
  const [latestSnapshotLoading, setLatestSnapshotLoading] = useState(false);
  const [latestSnapshotError, setLatestSnapshotError] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [restoreError, setRestoreError] = useState(null);

  const handleBackup = async () => {
    setBacking(true);
    setBackupResult(null);
    setBackupError(null);
    try {
      const body = {};
      if (backupGameTypeId) body.gameTypeId = parseInt(backupGameTypeId, 10);
      const res = await axios.post(
        `${API_URL}admin/ai-training/backup`,
        body,
        { headers: authHeader() },
      );
      setBackupResult(res.data);
      // Invalidate cached snapshot info so restore section refreshes
      setLatestSnapshot(null);
    } catch (err) {
      setBackupError(err?.response?.data?.message || err.message || 'Backup failed');
    } finally {
      setBacking(false);
    }
  };

  const handleLoadLatestSnapshot = async () => {
    setLatestSnapshotLoading(true);
    setLatestSnapshotError(null);
    try {
      const res = await axios.get(`${API_URL}admin/ai-training/backup/latest-snapshot`, { headers: authHeader() });
      setLatestSnapshot(res.data);
    } catch (err) {
      setLatestSnapshotError(err?.response?.data?.message || err.message || 'Failed to read backup directory');
    } finally {
      setLatestSnapshotLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!latestSnapshot?.snapshot) return;
    const confirmed = window.confirm(
      `Restore from snapshot "${latestSnapshot.snapshot}"?\n\n` +
      `This will copy all files from that snapshot back into the active training directory, ` +
      `overwriting any existing files. It does NOT delete files that are not in the backup.\n\n` +
      `Game types in snapshot: ${latestSnapshot.gameTypeIds?.join(', ') || '(none)'}\n\n` +
      `Continue?`
    );
    if (!confirmed) return;
    setRestoring(true);
    setRestoreResult(null);
    setRestoreError(null);
    try {
      const res = await axios.post(`${API_URL}admin/ai-training/restore`, {}, { headers: authHeader() });
      setRestoreResult(res.data);
    } catch (err) {
      setRestoreError(err?.response?.data?.message || err.message || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  const handleWipe = async () => {
    const targetLabel = wipeGameTypeId
      ? `ALL training jobs for game type #${wipeGameTypeId}`
      : 'ALL training jobs for ALL game types';
    const proceed = window.confirm(
      `DESTRUCTIVE ACTION — wipe ${targetLabel}?\n\n` +
      `This will permanently delete every job record AND the on-disk training data (logs, models, book files) for the selected scope.\n\n` +
      `Running jobs must be stopped first. This CANNOT be undone.\n\n` +
      `Press OK to confirm.`
    );
    if (!proceed) return;
    setWiping(true);
    setWipeResult(null);
    setWipeError(null);
    try {
      const body = { confirm: true };
      if (wipeGameTypeId) body.gameTypeId = parseInt(wipeGameTypeId, 10);
      const res = await axios.delete(`${API_URL}admin/ai-training/wipe`, {
        headers: authHeader(),
        data: body,
      });
      setWipeResult(res.data);
      await fetchStatus();
    } catch (err) {
      setWipeError(err?.response?.data?.message || err.message || 'Wipe failed');
    } finally {
      setWiping(false);
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
        Rust subprocess (1 core, configurable RAM) so it cannot impact the live
        game server. Multiple jobs can run concurrently as long as their combined
        RAM stays within the global memory cap.
        {status?.remoteMode && (
          <> Trainer runs on the <strong>frontend EC2 instance</strong> via the trainer-service proxy.</>
        )}
      </p>

      {status && (
        <div style={{ margin: '8px 0 12px', padding: '8px 12px', background: 'var(--bg-panel, #1a2a3a)', borderRadius: 4, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>
              Memory budget:{' '}
              <strong style={{ color: (status.activeMemoryMb || 0) > 0 ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                {status.activeMemoryMb || 0} / {status.globalMemoryCapMb || 8192} MB
              </strong>
              {' '}in use &mdash; {status.activeJobs || 0} job{status.activeJobs !== 1 ? 's' : ''} running.
              {status.globalMemoryCapMb && (status.activeMemoryMb || 0) > 0 && (
                <span style={{ marginLeft: 8, color: (status.globalMemoryCapMb - (status.activeMemoryMb || 0)) < 512 ? '#e05' : undefined }}>
                  ({status.globalMemoryCapMb - (status.activeMemoryMb || 0)} MB free)
                </span>
              )}
            </span>
            {!capEditing && (
              <button
                type="button"
                style={{ fontSize: '0.8rem', padding: '2px 8px', cursor: 'pointer' }}
                onClick={() => { setCapInput(String(status.globalMemoryCapMb || 8192)); setCapEditing(true); setCapError(null); }}
              >
                Set cap
              </button>
            )}
          </div>
          {capEditing && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                New global cap (MB):
                <input
                  type="number"
                  min={1}
                  max={131072}
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  style={{ width: 100, padding: '2px 6px' }}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Escape') { setCapEditing(false); setCapError(null); } }}
                />
              </label>
              <button
                type="button"
                disabled={capSaving}
                onClick={async () => {
                  setCapSaving(true);
                  setCapError(null);
                  try {
                    await axios.put(
                      `${API_URL}admin/ai-training/memory-cap`,
                      { memoryCapMb: parseInt(capInput, 10) },
                      { headers: authHeader() },
                    );
                    setCapEditing(false);
                    await fetchStatus();
                  } catch (err) {
                    setCapError(err?.response?.data?.message || err.message || 'Failed to save cap');
                  } finally {
                    setCapSaving(false);
                  }
                }}
              >
                {capSaving ? 'Saving\u2026' : 'Save'}
              </button>
              <button type="button" onClick={() => { setCapEditing(false); setCapError(null); }}>Cancel</button>
            </div>
          )}
          {capError && <div className={styles.error} style={{ marginTop: 6 }}>{capError}</div>}
        </div>
      )}

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
          <button type="button" onClick={togglePause} className={styles.btnPauseToggle}>
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
          <div style={{ gridColumn: '1 / -1' }}>
            <ToggleSwitch
              checked={form.generateGameLog}
              onChange={(v) => setForm({ ...form, generateGameLog: v })}
              label="Generate game log (games.txt)"
              tooltip={<span>When enabled, the trainer writes a plain-text game transcript (games.txt) to the job folder. Disable to save disk space if you don't need a move-by-move record.</span>}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !form.gameTypeId || (status && !status.engineAvailable)}
          >
            {submitting ? "Starting…" : "Start training"}
          </button>
          {status && status.globalMemoryCapMb && parseInt(form.maxRssMb, 10) > 0 && (() => {
            const free = status.globalMemoryCapMb - (status.activeMemoryMb || 0);
            const needed = parseInt(form.maxRssMb, 10);
            return needed > free ? (
              <div className={styles.error} style={{ marginTop: 6 }}>
                This job needs {needed} MB but only {free} MB is free under the {status.globalMemoryCapMb} MB global cap.
                Stop a running job or lower Max RAM to proceed.
              </div>
            ) : null;
          })()}
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
        <h4>Import game rules for local training</h4>
        <p className={styles.intro}>
          Upload a <code>rules.json</code> exported from another instance (or generated
          with <code>exportGameRules</code>) to create a training-only game type here.
          Training-only games are hidden from public listings but can be trained, analyzed,
          and have artifacts uploaded to them. Use this workflow to train locally on game
          configs that live on a different site instance.
        </p>
        <form onSubmit={handleImportRules} className={styles.form}>
          <label>
            Display name (optional)
            <input
              type="text"
              maxLength={100}
              placeholder="e.g. My Custom Variant (training only)"
              value={importRulesName}
              onChange={(e) => setImportRulesName(e.target.value)}
            />
          </label>
          <label>
            rules.json file
            <input
              ref={importRulesInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => { setImportRulesFile(e.target.files?.[0] || null); setImportRulesResult(null); setImportRulesError(null); }}
            />
          </label>
          <button
            type="submit"
            disabled={importingRules || !importRulesFile}
          >
            {importingRules ? 'Importing…' : 'Import rules'}
          </button>
          {importRulesError && <div className={styles.error}>{importRulesError}</div>}
          {importRulesResult && (
            <div className={styles.success || ''} style={{ color: '#4caf50' }}>
              Imported as game #{importRulesResult.gameTypeId} — &quot;{importRulesResult.gameName}&quot;.
              You can now start a training job for it from the &quot;Start a new training job&quot; section above.
            </div>
          )}
        </form>
      </div>

      <div className={styles.section}>
        <h4>Recent jobs</h4>
        {(!status || !status.jobs || status.jobs.length === 0) ? (
          <div className={styles.empty}>No training jobs yet.</div>
        ) : (
          <>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={diskChecking}
                className={`${styles.btn} ${styles.btnNeutral}`}
                onClick={handleCheckDisk}
                title="Check which jobs have their data directory on disk. Shows a green dot or red dash in the Data column."
              >
                {diskChecking ? 'Checking disk…' : 'Check disk data'}
              </button>
              {diskCheckError && (
                <span className={styles.error} style={{ fontSize: '0.88em' }}>{diskCheckError}</span>
              )}
              {(diskPresent || diskAbsent) && !diskChecking && (
                <span style={{ fontSize: '0.88em', color: 'var(--text-muted)' }}>
                  {diskPresent?.size ?? 0} present, {diskAbsent?.size ?? 0} missing
                </span>
              )}
            </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Game</th>
                <th>Status</th>
                <th>Progress</th>
                <th>MCTS</th>
                <th>Started</th>
                <th title="Whether this job's data directory exists on disk (only visible after 'Check disk data')">Data</th>
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
                  <td>
                    #{j.game_type_id}
                    {j.game_name && (
                      <span style={{ marginLeft: 5, color: '#b0b0b0' }}>{j.game_name}</span>
                    )}
                    {j.is_training_only ? (
                      <span
                        style={{ marginLeft: 5, fontSize: '0.75em', padding: '1px 5px', borderRadius: 3, background: '#3a2a5a', color: '#c5a6ff', border: '1px solid #7c5cbe' }}
                        title="This game type was imported from a rules.json file for local AI training. It is hidden from public listings."
                      >
                        training only
                      </span>
                    ) : null}
                  </td>
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
                  <td title={
                    !diskPresent && !diskAbsent ? 'Click "Check disk data" to verify' :
                    diskPresent?.has(j.id) ? 'Job directory found on disk' :
                    diskAbsent?.has(j.id) ? 'Job directory NOT found on disk' :
                    'Not checked'
                  } style={{ textAlign: 'center', fontSize: '1.1em' }}>
                    {!diskPresent && !diskAbsent ? (
                      <span style={{ color: '#666' }}>—</span>
                    ) : diskPresent?.has(j.id) ? (
                      <span style={{ color: '#4caf50' }}>●</span>
                    ) : diskAbsent?.has(j.id) ? (
                      <span style={{ color: '#f44336' }}>✕</span>
                    ) : (
                      <span style={{ color: '#666' }}>—</span>
                    )}
                  </td>
                  <td>
                    {j.status === "running" && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnWarning}`}
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
                          className={`${styles.btn} ${styles.btnSuccess}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResume(j.id);
                          }}
                        >
                          Resume
                        </button>
                      )}
                    {(j.games_played || 0) > 0 && (
                      <button
                        type="button"
                        title="Download this job's data as a ZIP. Upload the result on the live site's admin portal to merge it into production training data."
                        className={`${styles.btn} ${styles.btnNeutral}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(j.id);
                        }}
                      >
                        ⬇ Download
                      </button>
                    )}
                    {j.status !== "running" && (j.games_played || 0) > 0 && (
                      <button
                        type="button"
                        title="Delete on-disk training data (log + model files). Resets games_played to 0. Job record is kept."
                        className={`${styles.btn} ${styles.btnDanger}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteData(j.id);
                        }}
                      >
                        🗑 Clear Data
                      </button>
                    )}
                    {j.status !== "running" && (j.games_played || 0) > 0 && (
                      <button
                        type="button"
                        disabled={!j.has_game_log}
                        title={
                          j.has_game_log
                            ? "Download a human-readable transcript of every move the AI played in this job (first 200 games), in chess notation. Useful for verifying that game rules are applied correctly during training."
                            : "No game log available. Start a new job with 'Generate game log' enabled to create one."
                        }
                        className={`${styles.btn} ${styles.btnNeutral}`}
                        style={j.has_game_log ? undefined : { opacity: 0.45, cursor: "not-allowed" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (j.has_game_log) handleGameLog(j.id);
                        }}
                      >
                        📋 Game Log
                      </button>
                    )}
                    {j.status !== "running" && (j.games_played || 0) > 0 && (
                      <button
                        type="button"
                        disabled={!j.has_game_log}
                        title={
                          j.has_game_log
                            ? "Open an interactive board viewer to step through any game in this job's game log. Useful for verifying that pieces move correctly during training."
                            : "No game log available. Start a new job with 'Generate game log' enabled to create one."
                        }
                        className={`${styles.btn} ${styles.btnNeutral}`}
                        style={j.has_game_log ? undefined : { opacity: 0.45, cursor: "not-allowed" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (j.has_game_log) setReplayJobId(j.id);
                        }}
                      >
                        ♟ Board Replay
                      </button>
                    )}
                    {j.status !== "running" && j.status !== "queued" && (
                      <button
                        type="button"
                        title="Permanently delete this job from the list AND wipe its on-disk data. The job record is removed entirely."
                        className={`${styles.btn} ${styles.btnDangerStrong}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteJob(j.id);
                        }}
                      >
                        ✕ Delete Job
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
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
                <code>{formatTrainingEvent(ev)}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h4>Sync disk data</h4>
        <p className={styles.intro}>
          Scans the trainer host's disk and compares actual game counts against
          what the database believes. Jobs whose files are missing from disk get
          their <code>games_played</code> zeroed so counts are accurate. Run
          this after a suspected data-loss event to fix the "trained on N games"
          display and the analysis numbers.
        </p>
        <button
          type="button"
          disabled={syncing}
          className={`${styles.btn} ${styles.btnNeutral}`}
          onClick={handleSyncDisk}
        >
          {syncing ? 'Scanning…' : 'Verify &amp; sync disk data'}
        </button>
        {syncError && <div className={styles.error} style={{ marginTop: 8 }}>{syncError}</div>}
        {syncResult && (
          <div style={{ marginTop: 8 }}>
            {syncResult.skipped?.length > 0 && (
              <div style={{ color: '#ff7043', marginBottom: 6, fontWeight: 600 }}>
                Warning: {syncResult.skipped.length} game type{syncResult.skipped.length === 1 ? '' : 's'} skipped
                — training directory not found at TRAINING_ROOT.
                No DB counts were changed for these game types.
                This usually means <code>TRAINING_DATA_DIR</code> in <code>.env</code> is pointing
                to the wrong location. Fix it, restart the trainer service, then sync again.
                <ul style={{ margin: '4px 0 0 16px', padding: 0, fontWeight: 'normal' }}>
                  {syncResult.skipped.map((s) => (
                    <li key={s.gameTypeId}>Game type #{s.gameTypeId} — directory not found</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ color: syncResult.updated.length > 0 ? '#ffd96b' : '#4caf50' }}>
              Scanned {syncResult.scannedGameTypes} game type{syncResult.scannedGameTypes === 1 ? '' : 's'}.{' '}
              {syncResult.updated.length === 0 ? (
                'All games_played counts match disk — no changes needed.'
              ) : (
                <>
                  {syncResult.updated.length} job{syncResult.updated.length === 1 ? '' : 's'} updated:
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {syncResult.updated.map((u) => (
                      <li key={u.jobId}>
                        Job #{u.jobId} (game #{u.gameTypeId}):
                        {' '}{u.oldGamesPlayed} → {u.newGamesPlayed} games
                        {u.reason === 'disk_data_missing' ? ' [disk data missing]' : ' [count corrected]'}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h4>Backup training data</h4>
        <p className={styles.intro}>
          Copies all training files (logs, models, book files) to a snapshot
          directory outside the repo on the trainer host.
          Set <code>TRAINING_BACKUP_DIR</code> in the trainer's <code>.env</code> to
          control where snapshots go; defaults to <code>ai-training-backup/</code>
          next to the repo root. Each run creates a timestamped subfolder so
          previous snapshots are not overwritten.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Game type (blank = all)
            <select
              value={backupGameTypeId}
              onChange={(e) => { setBackupGameTypeId(e.target.value); setBackupResult(null); setBackupError(null); }}
              style={{ marginLeft: 6 }}
            >
              <option value="">— all game types —</option>
              {gameTypes.map((g) => (
                <option key={g.id} value={g.id}>
                  #{g.id} — {g.game_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={backing}
            className={`${styles.btn} ${styles.btnNeutral}`}
            onClick={handleBackup}
          >
            {backing ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
        {backupError && <div className={styles.error} style={{ marginTop: 8 }}>{backupError}</div>}
        {backupResult && (
          <div style={{ marginTop: 8, color: '#4caf50' }}>
            Backed up {backupResult.copiedGameTypes} game type{backupResult.copiedGameTypes === 1 ? '' : 's'}
            {backupResult.copiedFiles > 0 ? ` (${backupResult.copiedFiles} files)` : ''}.
            Snapshot: <code style={{ fontSize: '0.85em' }}>{backupResult.backupPath}</code>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h4>Restore from latest backup</h4>
        <p className={styles.intro}>
          Copies files from the most recent backup snapshot back into the active
          training directory. Existing files are overwritten; files not present
          in the backup are left in place.
        </p>
        {!latestSnapshot && (
          <button
            type="button"
            disabled={latestSnapshotLoading}
            className={`${styles.btn} ${styles.btnNeutral}`}
            onClick={handleLoadLatestSnapshot}
          >
            {latestSnapshotLoading ? 'Checking…' : 'Check latest snapshot'}
          </button>
        )}
        {latestSnapshotError && <div className={styles.error} style={{ marginTop: 8 }}>{latestSnapshotError}</div>}
        {latestSnapshot && (
          latestSnapshot.snapshot ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 8, color: '#ccc', fontSize: '0.9em' }}>
                Latest snapshot: <code style={{ fontSize: '0.85em' }}>{latestSnapshot.snapshot}</code>
                {' '}— {latestSnapshot.gameTypeIds?.length ?? 0} game type{latestSnapshot.gameTypeIds?.length === 1 ? '' : 's'}
                {latestSnapshot.gameTypeIds?.length > 0 && (
                  <span> (#{latestSnapshot.gameTypeIds.join(', #')})</span>
                )}
                {latestSnapshot.totalSnapshots > 1 && (
                  <span style={{ marginLeft: 8, opacity: 0.6 }}>({latestSnapshot.totalSnapshots} snapshots total)</span>
                )}
              </div>
              <button
                type="button"
                disabled={restoring}
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={handleRestore}
              >
                {restoring ? 'Restoring…' : 'Restore from this snapshot'}
              </button>
              <button
                type="button"
                disabled={latestSnapshotLoading}
                className={`${styles.btn} ${styles.btnNeutral}`}
                style={{ marginLeft: 8 }}
                onClick={() => { setLatestSnapshot(null); setRestoreResult(null); setRestoreError(null); }}
              >
                Refresh
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 8, color: '#aaa' }}>
              No backup snapshots found in <code style={{ fontSize: '0.85em' }}>{latestSnapshot.backupRoot}</code>.
              <button
                type="button"
                className={`${styles.btn} ${styles.btnNeutral}`}
                style={{ marginLeft: 8 }}
                onClick={() => { setLatestSnapshot(null); setLatestSnapshotError(null); }}
              >
                Retry
              </button>
            </div>
          )
        )}
        {restoreError && <div className={styles.error} style={{ marginTop: 8 }}>{restoreError}</div>}
        {restoreResult && (
          <div style={{ marginTop: 8, color: '#4caf50' }}>
            Restored {restoreResult.restoredGameTypes} game type{restoreResult.restoredGameTypes === 1 ? '' : 's'}
            {restoreResult.restoredFiles > 0 ? ` (${restoreResult.restoredFiles} files)` : ''}{' '}
            from snapshot <code style={{ fontSize: '0.85em' }}>{restoreResult.snapshot}</code>.
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h4>Global wipe analysis data</h4>
        <p className={styles.intro}>
          Permanently deletes all training job records and on-disk data (logs,
          models, book files) for a specific game type, or for every game type
          at once. Stop any running jobs first. This cannot be undone.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Game type ID (blank = all games)
            <select
              value={wipeGameTypeId}
              onChange={(e) => { setWipeGameTypeId(e.target.value); setWipeResult(null); setWipeError(null); }}
              style={{ marginLeft: 6 }}
            >
              <option value="">— all game types —</option>
              {gameTypes.map((g) => (
                <option key={g.id} value={g.id}>
                  #{g.id} — {g.game_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={wiping}
            className={`${styles.btn} ${styles.btnDangerStrong}`}
            onClick={handleWipe}
          >
            {wiping ? 'Wiping…' : wipeGameTypeId ? `⚠ Wipe game #${wipeGameTypeId}` : '⚠ Wipe ALL games'}
          </button>
        </div>
        {wipeError && <div className={styles.error} style={{ marginTop: 8 }}>{wipeError}</div>}
        {wipeResult && (
          <div style={{ marginTop: 8, color: '#4caf50' }}>
            Wiped {wipeResult.deletedJobs} job{wipeResult.deletedJobs === 1 ? '' : 's'}
            {wipeResult.deletedDirs > 0 ? `, removed ${wipeResult.deletedDirs} on-disk director${wipeResult.deletedDirs === 1 ? 'y' : 'ies'}` : ''}
            {wipeResult.affectedGameTypes?.length > 0 ? ` (game types: ${wipeResult.affectedGameTypes.join(', ')})` : ''}.
          </div>
        )}
      </div>

      <AnalysisSection gameTypes={gameTypes} initialGameTypeId={initialAnalysisGameTypeId} />

      {/* AI Engine Error Log */}
      <div className={styles.section} style={{ marginTop: 24 }}>
        <div
          style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8 }}
          onClick={() => setAiErrorsCollapsed(c => !c)}
        >
          <span style={{ display: 'inline-block', width: '1em' }}>{aiErrorsCollapsed ? '\u25B6' : '\u25BC'}</span>
          <strong>AI Engine Error Log</strong>
          {aiErrors.length > 0 && (
            <span className={styles.errorBadge}>{aiErrors.length}</span>
          )}
          <button
            type="button"
            className={styles.btnNeutral}
            style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: '0.82em' }}
            onClick={(e) => { e.stopPropagation(); fetchAiErrors(); }}
            title="Refresh error log"
          >
            Refresh
          </button>
        </div>
        {!aiErrorsCollapsed && (
          <div style={{ marginTop: 8 }}>
            {aiErrors.length === 0 ? (
              <div className={styles.emptyNote}>No errors recorded since last server start.</div>
            ) : (
              <div className={styles.errorLog}>
                {aiErrors.map((e, i) => (
                  <div key={i} className={styles.errorLogEntry}>
                    <span className={styles.errorLogTime}>
                      {new Date(e.timestamp).toLocaleTimeString()} &mdash; Job #{e.jobId}
                    </span>
                    <pre className={styles.errorLogLine}>{e.line}</pre>
                  </div>
                ))}
                <div className={styles.emptyNote} style={{ marginTop: 4 }}>
                  Showing up to 50 most recent stderr lines. Cleared on server restart.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {replayJobId !== null && (
        <AiGameReplayModal
          jobId={replayJobId}
          onClose={() => setReplayJobId(null)}
        />
      )}
    </div>
  );
};

const END_REASON_LABELS = {
  checkmate: 'checkmate',
  stalemate: 'draw (stalemate)',
  stalemate_win: 'win (stalemate — player stalemated wins)',
  lose_all_pieces: 'anti-chess (lost all pieces)',
  no_moves_loss: 'win (no legal moves — player with no moves loses)',
  capture_condition: 'win (capture condition)',
  squares_condition: 'win (control squares)',
  move_limit: 'draw (move-limit rule)',
  move_cap_rollout: 'draw (trainer move cap)',
  rollout_cap: 'draw (rollout cap)',
  no_move: 'draw (no legal move)',
  royal_capture: 'royal piece captured',
  repetition: 'draw (repetition)',
  insufficient_material: 'draw (insufficient material)',
  promotion: 'win (promotion-as-win condition)',
  simultaneous_capture_draw: 'draw (simultaneous capture of game-ending pieces)',
  simultaneous_checkmate_draw: 'draw (simultaneous checkmate)',
  cancellation_draw: 'draw (simul-turns cancellation threshold)',
};

function formatTrainingEvent(ev) {
  if (!ev || typeof ev !== 'object') return JSON.stringify(ev);
  if (ev.type === 'game_complete') {
    const reason = END_REASON_LABELS[ev.end_reason] || (ev.winner ? 'win' : 'draw');
    const outcome = ev.winner
      ? `P${ev.winner} wins by ${reason}`
      : reason;
    return `Game ${ev.index}: ${outcome} — ${ev.moves} moves (${ev.elapsed_ms}ms)`;
  }
  if (ev.type === 'started')    return `Started: target ${ev.games_target} (seed ${ev.seed})`;
  if (ev.type === 'checkpoint') return `Checkpoint @ ${ev.games_played}: ${ev.path}`;
  if (ev.type === 'finished')   return `Finished: ${ev.games_played} games (${ev.elapsed_ms}ms)`;
  if (ev.type === 'aborted')    return `Aborted: ${ev.reason}`;
  if (ev.type === 'warning')    return `Warning: ${ev.msg}`;
  return JSON.stringify(ev);
}

const VISIBILITY_META = {
  private: {
    label: 'Admins only',
    icon: '🔒',
    tooltip: 'Only admins and the site owner can view this analysis. The game creator cannot see it.',
  },
  creator: {
    label: 'Creator + admins',
    icon: '👤',
    tooltip: 'The game\'s creator can see this analysis on the game detail page, along with admins and the site owner.',
  },
  public: {
    label: 'Public link',
    icon: '🌐',
    tooltip: 'Anyone can view this analysis via a shareable link — useful for sharing balance data with the community.',
  },
};

const AnalysisSection = ({ gameTypes, initialGameTypeId }) => {
  const [analysisGameTypeId, setAnalysisGameTypeId] = useState(initialGameTypeId ? String(initialGameTypeId) : '');
  const initializedRef = React.useRef(false);

  // If a new initialGameTypeId arrives (e.g. user navigated from game detail
  // page), apply it — but only once so the user's own changes aren't overridden.
  useEffect(() => {
    if (!initializedRef.current && initialGameTypeId) {
      setAnalysisGameTypeId(String(initialGameTypeId));
      initializedRef.current = true;
    }
  }, [initialGameTypeId]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [filterLegacy, setFilterLegacy] = useState(true);
  // IDs of game types that have at least one completed training job.
  const [trainedGameTypeIds, setTrainedGameTypeIds] = useState(null); // null = not yet loaded
  const [filterTrained, setFilterTrained] = useState(true);

  // Load which game types actually have training data so we can offer a
  // "show trained only" filter on the dropdown.
  useEffect(() => {
    axios.get(`${API_URL}admin/ai-training/trained-game-types`, { headers: authHeader() })
      .then(res => setTrainedGameTypeIds(new Set(res.data.gameTypeIds.map(String))))
      .catch(() => setTrainedGameTypeIds(new Set())); // fail silently — show all
  }, []);

  const visibleGameTypes = filterTrained && trainedGameTypeIds
    ? gameTypes.filter(g => trainedGameTypeIds.has(String(g.id)))
    : gameTypes;

  const loadExisting = useCallback(async (gtid) => {
    if (!gtid) { setAnalysis(null); return; }
    setLoading(true); setErr(null);
    try {
      const res = await axios.get(`${API_URL}ai-training/analysis/${gtid}`, {
        headers: authHeader(),
      });
      setAnalysis(res.data);
    } catch (e) {
      if (e?.response?.status === 404) setAnalysis(null);
      else setErr(e?.response?.data?.message || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadExisting(analysisGameTypeId); }, [analysisGameTypeId, loadExisting]);

  const regenerate = async () => {
    if (!analysisGameTypeId) return;
    setBusy(true); setErr(null);
    try {
      const res = await axios.post(
        `${API_URL}admin/ai-training/analysis/${analysisGameTypeId}/regenerate`,
        { filterLegacy },
        { headers: authHeader() },
      );
      setAnalysis(res.data);
    } catch (e) {
      setErr(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const updateVisibility = async (visibility) => {
    if (!analysisGameTypeId) return;
    setBusy(true); setErr(null);
    try {
      const res = await axios.put(
        `${API_URL}admin/ai-training/analysis/${analysisGameTypeId}/visibility`,
        { visibility },
        { headers: authHeader() },
      );
      setAnalysis(res.data);
    } catch (e) {
      setErr(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const summary = analysis?.summary;
  const publicLink = analysis?.slug
    ? `${window.location.origin}/ai-analysis/${analysis.slug}`
    : null;

  return (
    <div className={styles.section}>
      <h4>AI Training Analysis</h4>
      <p className={styles.intro}>
        Aggregate every job's results for a game type into a balance report
        (per-side win rate, draw breakdown, sample size). Publish the
        analysis to the game's creator only, or to everyone via a shareable
        link.
      </p>
      <div className={styles.form}>
        <label>
          Game type
          <select
            value={analysisGameTypeId}
            onChange={(e) => setAnalysisGameTypeId(e.target.value)}
          >
            <option value="">— select —</option>
            {visibleGameTypes.map((g) => (
              <option key={g.id} value={g.id}>
                #{g.id} — {g.game_name}
              </option>
            ))}
          </select>
        </label>
        <ToggleSwitch
          checked={filterTrained}
          onChange={(v) => setFilterTrained(v)}
          label={trainedGameTypeIds
            ? `Show trained games only (${trainedGameTypeIds.size} of ${gameTypes.length})`
            : 'Show trained games only'}
        />
        <button
          type="button"
          onClick={regenerate}
          disabled={!analysisGameTypeId || busy}
        >
          {analysis ? 'Regenerate analysis' : 'Generate analysis'}
        </button>
        <button
          type="button"
          disabled={!analysisGameTypeId}
          title="Download the rules.json for this game type (re-generated from the database). Use it for local training with the Rust engine."
          onClick={() => {
            if (!analysisGameTypeId) return;
            // Trigger browser download via a hidden link.
            const a = document.createElement('a');
            a.href = `${API_URL}admin/ai-training/rules/${analysisGameTypeId}`;
            a.download = `rules-${analysisGameTypeId}.json`;
            // Include auth token as query param isn't ideal — use fetch + blob instead.
            axios.get(`${API_URL}admin/ai-training/rules/${analysisGameTypeId}`, {
              headers: authHeader(),
              responseType: 'blob',
            }).then((res) => {
              const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/json' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = `rules-${analysisGameTypeId}.json`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              window.URL.revokeObjectURL(url);
            }).catch((err) => {
              alert(err?.response?.data?.message || err.message || 'Failed to download rules');
            });
          }}
        >
          Download rules.json
        </button>
        <ToggleSwitch
          checked={filterLegacy}
          onChange={(v) => setFilterLegacy(v)}
          label="Exclude pre-tracking games (recommended — omits games from before draw/end-reason tracking, which all report as unknown draws)"
        />
        {err && <div className={styles.error}>{err}</div>}
      </div>

      {loading && <div>Loading…</div>}
      {!loading && analysisGameTypeId && !analysis && (
        <div className={styles.empty}>
          No analysis yet for this game type. Click "Generate analysis" once
          enough training games exist.
        </div>
      )}
      {summary && (
        <div className={styles.analysisBlock}>
          <div className={styles.analysisStats}>
            <div>
              <strong>Total games:</strong> {summary.totalGames ?? 0} (across {summary.jobCount ?? 0} job{(summary.jobCount ?? 0) === 1 ? '' : 's'})
              {(summary.dbOnlyGames ?? 0) > 0 && (
                <span style={{ marginLeft: 8, color: '#ffd96b', fontSize: '0.9em' }}
                  title="These jobs' disk data is unavailable on the trainer host — win/loss/draw breakdown cannot be computed for them.">
                  + {summary.dbOnlyGames} games from {summary.dbOnlyJobCount} older job{summary.dbOnlyJobCount === 1 ? '' : 's'} (no disk data — count only)
                </span>
              )}
            </div>
            <div><strong>Decisive:</strong> {summary.decisive ?? 0} ({(((summary.decisive ?? 0) / Math.max(1, summary.totalGames ?? 0)) * 100).toFixed(1)}%) — <strong>Draws:</strong> {summary.draws ?? 0} ({(((summary.draws ?? 0) / Math.max(1, summary.totalGames ?? 0)) * 100).toFixed(1)}%)</div>
            {summary.perSide && summary.perSide['1'] && (
              <div><strong>Player 1 wins:</strong> {summary.perSide['1'].wins} ({(summary.perSide['1'].winRate * 100).toFixed(1)}%)</div>
            )}
            {summary.perSide && summary.perSide['2'] && (
              <div><strong>Player 2 wins:</strong> {summary.perSide['2'].wins} ({(summary.perSide['2'].winRate * 100).toFixed(1)}%)</div>
            )}
            {summary.filteredLegacy && summary.legacyExcluded > 0 && (
              <div style={{ fontStyle: 'italic', color: '#888' }}>
                {summary.legacyExcluded} pre-tracking game{summary.legacyExcluded === 1 ? '' : 's'} excluded from these numbers.
              </div>
            )}
            {summary.balance ? (
              <>
                <div><strong>Balance:</strong> {summary.balance.severity} (imbalance {(summary.balance.imbalance * 100).toFixed(1)}%)</div>
                {summary.balance.note && (
                  <div className={styles.balanceNote}>{summary.balance.note}</div>
                )}
              </>
            ) : (
              <div style={{ fontStyle: 'italic', color: '#888' }}>Balance data not available — regenerate analysis to compute it.</div>
            )}
            <div><strong>Avg game length:</strong> {(summary.avgMoves ?? 0).toFixed(1)} moves (range {summary.minMoves ?? 0}–{summary.maxMoves ?? 0})</div>
            <details>
              <summary>Win breakdown</summary>
              <ul>
                {summary.decisiveBy && Object.entries(summary.decisiveBy).map(([k, v]) => {
                  if (v <= 0) return null;
                  if (k === 'stalemate_win' && summary.stalemate_win_condition === false) return null;
                  return <li key={k}>{k.replace(/_/g, ' ')}: {v}</li>;
                }).filter(Boolean)}
                {(!summary.decisiveBy || Object.values(summary.decisiveBy).every((v) => v === 0)) && (
                  <li>No decisive games recorded.</li>
                )}
              </ul>
            </details>
            <details>
              <summary>Draw breakdown</summary>
              <ul>
                {Object.entries(summary.drawBreakdown || {}).map(([k, v]) => {
                  if (v <= 0) return null;
                  if (k === 'stalemate' && summary.stalemate_draw_condition === false) return null;
                  return <li key={k}>{k}: {v}</li>;
                }).filter(Boolean)}
                {(!summary.drawBreakdown || Object.values(summary.drawBreakdown).every((v) => v === 0)) && (
                  <li>No draws recorded.</li>
                )}
              </ul>
              <small>
                Draws labeled "unknown" come from games run before per-draw
                reasons were tracked. New training runs (after rebuilding the
                Rust trainer) will populate these categories.
              </small>
            </details>
          </div>

          <div className={styles.visibilityControls}>
            <div className={styles.visibilityHeader}>
              <span><strong>Visibility:</strong></span>
              <span className={`${styles.visibilityBadge} ${styles[`vis_${analysis.visibility}`]}`}>
                {VISIBILITY_META[analysis.visibility]?.icon} {VISIBILITY_META[analysis.visibility]?.label}
              </span>
            </div>
            <div className={styles.visibilityButtons}>
              {['private', 'creator', 'public'].map((v) => {
                const meta = VISIBILITY_META[v];
                const isActive = analysis.visibility === v;
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={busy || isActive}
                    onClick={() => updateVisibility(v)}
                    title={meta.tooltip}
                    className={`${styles.visBtn} ${isActive ? styles.visBtnActive : ''}`}
                  >
                    <span className={styles.visBtnIcon}>{meta.icon}</span>
                    <span className={styles.visBtnLabel}>
                      {isActive ? `✓ ${meta.label}` : `Set ${meta.label}`}
                    </span>
                  </button>
                );
              })}
            </div>
            {publicLink && analysis.visibility === 'public' && (
              <div className={styles.publicLink}>
                <span>Public link:</span>
                <a href={publicLink} target="_blank" rel="noreferrer">{publicLink}</a>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => navigator.clipboard.writeText(publicLink)}
                  title="Copy shareable link to clipboard"
                >
                  📋 Copy
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AiTrainingPanel;