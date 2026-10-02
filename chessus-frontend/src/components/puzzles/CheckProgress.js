import React from "react";

/*
 * A background puzzle check's progress (server/puzzle-jobs.js), for the
 * builder. A puzzle of several moves is searched against every reply the
 * opponent could make, which takes from a few seconds to a couple of minutes -
 * long enough that a creator should see it moving and know how long is left.
 *
 * `view` is the job as GET /api/puzzle-jobs/:id returns it.
 */
const fmt = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
};

const CheckProgress = ({ view }) => {
  if (!view) return null;
  const p = view.progress;
  // The first step searches deepest and is nearly all of the work.
  const fraction = !p || !p.total ? 0 : (p.step > 1 ? 0.95 : Math.min(0.95, p.done / p.total));
  let line;
  if (view.state === "queued") {
    line = `Waiting for ${view.queuePosition > 1 ? `${view.queuePosition - 1} other checks` : "another check"} to finish…`;
  } else if (!p) {
    line = "Starting the search…";
  } else {
    line = `Checking move ${p.step} of ${p.steps} against every defence`
      + (view.etaMs != null ? ` — about ${fmt(view.etaMs)} left` : " — estimating time…");
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}
      >
        <div style={{ width: `${Math.round(fraction * 100)}%`, height: "100%", background: "var(--accent-primary, #4caf50)", transition: "width 0.4s ease" }} />
      </div>
      <div style={{ fontSize: "0.85em", marginTop: 6, opacity: 0.85 }}>
        {line}
        {view.elapsedMs > 0 && ` (${fmt(view.elapsedMs)} so far)`}
      </div>
    </div>
  );
};

export default CheckProgress;
