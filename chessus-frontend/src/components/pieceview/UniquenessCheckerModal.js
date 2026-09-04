import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import styles from "./pieceview.module.scss";
import PiecesService from "../../services/pieces.service";
import { checkPieceDuplicates } from "../../actions/pieces";

/**
 * Uniqueness Checker.
 *
 * One modal for both halves of the same question — "is this piece original?":
 *   1. a library-wide scan for any piece with an identical ruleset, and
 *   2. a one-to-one comparison against a piece you pick.
 *
 * Both answers come from the same server-side comparison
 * (/api/pieces/duplicates and /api/pieces/:a/compare/:b both run
 * comparePieceRows), so the scan can't call a piece unique while the comparison
 * shows it has no functional differences.
 *
 * Lives in its own component rather than inline in PieceView both because it is
 * self-contained state, and because PieceView is large enough that adding this
 * much JSX tips eslint-plugin-react-hooks' path counter into false "called
 * conditionally" errors for every hook in the file.
 */
const UniquenessCheckerModal = ({ piece, pieceId, currentUser, onClose }) => {
  // null = the library-wide scan hasn't been run yet; [] = ran, found nothing.
  const [matches, setMatches] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [compareTab, setCompareTab] = useState('differences');

  // Debounced piece search for the comparer.
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    let active = true;
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await PiecesService.getPieces(1, 10, 'newest', term);
        const list = (res.data?.pieces || res.data?.data || res.data || [])
          .filter((p) => String(p.id) !== String(pieceId));
        if (active) setResults(list);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [search, pieceId]);

  const runScan = async () => {
    if (!piece) return;
    setScanError('');

    const role = (currentUser?.role || '').toLowerCase();
    const isAdminUser = role === 'admin' || role === 'owner';

    if (!isAdminUser) {
      const storageKey = `uniqueness-checks-${pieceId}`;
      const now = Date.now();
      const stored = (() => {
        try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
      })();
      const windowMs = 24 * 60 * 60 * 1000;
      const recent = stored.filter((t) => now - t < windowMs);
      if (recent.length >= 3) {
        const oldest = Math.min(...recent);
        const resetIn = Math.ceil((oldest + windowMs - now) / 60000);
        setScanError(`Limit reached — you can run 3 uniqueness checks per 24 hours. Try again in about ${resetIn} minute${resetIn !== 1 ? 's' : ''}.`);
        return;
      }
      recent.push(now);
      localStorage.setItem(storageKey, JSON.stringify(recent));
    }

    setScanLoading(true);
    try {
      const result = await checkPieceDuplicates(piece, pieceId);
      setMatches(result.matches || []);
    } catch {
      setScanError('Failed to run check. Please try again.');
    } finally {
      setScanLoading(false);
    }
  };

  const selectCompare = async (otherId) => {
    setCompareLoading(true);
    setCompareError('');
    try {
      const res = await PiecesService.comparePieces(pieceId, otherId);
      setCompareData(res.data);
      setCompareTab('differences');
    } catch (err) {
      setCompareError(err.response?.data?.error || 'Comparison failed. Please try again.');
    } finally {
      setCompareLoading(false);
    }
  };

  return (
    <div className={styles["uniqueness-modal-overlay"]} onClick={onClose}>
      <div className={styles["compare-modal"]} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles["uniqueness-modal-title"]}>🔍 Uniqueness Checker</h3>

        {/* 1. Scan the whole library for a functionally identical piece */}
        <div className={styles["uniqueness-section"]}>
          <div className={styles["uniqueness-section-head"]}>
            <strong>Check against every piece</strong>
            <button
              type="button"
              className={styles["uniqueness-run-btn"]}
              onClick={runScan}
              disabled={scanLoading}
            >
              {scanLoading ? 'Checking…' : (matches ? 'Run again' : 'Run check')}
            </button>
          </div>

          {scanError ? (
            <p className={styles["compare-error"]}>{scanError}</p>
          ) : !matches ? (
            <p className={styles["compare-muted"]}>
              Scans every piece in the library for one with the same ruleset as{' '}
              <strong>{piece?.piece_name}</strong>. Limited to 3 runs per day.
            </p>
          ) : matches.length === 0 ? (
            <p className={styles["compare-muted"]}>
              This piece is unique — no other piece has the same ruleset.
            </p>
          ) : (
            <>
              <p className={styles["compare-muted"]}>
                {matches.length} piece{matches.length !== 1 ? 's have' : ' has'} an identical ruleset:
              </p>
              <ul className={styles["uniqueness-match-list"]}>
                {matches.map((m) => (
                  <li key={m.id}>
                    <Link to={`/pieces/${m.id}`} onClick={onClose}>{m.piece_name}</Link>
                    {' '}
                    <span className={styles["compare-result-by"]}>
                      by {m.creator_username || 'Anonymous'}
                    </span>
                    {' '}
                    <button
                      type="button"
                      className={styles["uniqueness-compare-link"]}
                      onClick={() => selectCompare(m.id)}
                    >
                      compare
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* 2. Compare against one specific piece */}
        <div className={styles["uniqueness-section"]}>
          <div className={styles["uniqueness-section-head"]}>
            <strong>Compare with a specific piece</strong>
            {compareData && (
              <button
                type="button"
                className={styles["compare-back"]}
                onClick={() => { setCompareData(null); setCompareError(''); }}
              >
                ← Pick another
              </button>
            )}
          </div>

          {!compareData ? (
            <>
              <input
                type="text"
                className={styles["compare-search-input"]}
                placeholder="Search pieces by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {compareError && <p className={styles["compare-error"]}>{compareError}</p>}
              <div className={styles["compare-results"]}>
                {searchLoading ? (
                  <p className={styles["compare-muted"]}>Searching…</p>
                ) : results.length === 0 ? (
                  <p className={styles["compare-muted"]}>
                    {search.trim().length < 2 ? 'Type at least 2 characters to search.' : 'No pieces found.'}
                  </p>
                ) : (
                  results.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles["compare-result-item"]}
                      onClick={() => selectCompare(p.id)}
                      disabled={compareLoading}
                    >
                      <span>{p.piece_name}</span>
                      {p.creator_username && (
                        <span className={styles["compare-result-by"]}>by {p.creator_username}</span>
                      )}
                    </button>
                  ))
                )}
                {compareLoading && <p className={styles["compare-muted"]}>Comparing…</p>}
              </div>
            </>
          ) : (
            <>
              <div className={styles["compare-header"]}>
                <strong>{compareData.pieceA?.name}</strong> vs <strong>{compareData.pieceB?.name}</strong>
              </div>
              {compareData.differences.length === 0 && (
                <p className={styles["uniqueness-identical"]}>
                  These two pieces are functionally identical.
                </p>
              )}
              <div className={styles["compare-tabs"]}>
                <button
                  type="button"
                  className={`${styles["compare-tab"]} ${compareTab === 'differences' ? styles["compare-tab-active"] : ''}`}
                  onClick={() => setCompareTab('differences')}
                >
                  Differences ({compareData.differences.length})
                </button>
                <button
                  type="button"
                  className={`${styles["compare-tab"]} ${compareTab === 'similarities' ? styles["compare-tab-active"] : ''}`}
                  onClick={() => setCompareTab('similarities')}
                >
                  Similarities ({compareData.similarities.length})
                </button>
              </div>
              <div className={styles["compare-table"]}>
                {compareTab === 'differences' ? (
                  compareData.differences.length === 0 ? (
                    <p className={styles["compare-muted"]}>No differences — these pieces are functionally identical.</p>
                  ) : (
                    <>
                      <div className={`${styles["compare-row"]} ${styles["compare-row-head"]}`}>
                        <span>Attribute</span>
                        <span>{compareData.pieceA?.name}</span>
                        <span>{compareData.pieceB?.name}</span>
                      </div>
                      {compareData.differences.map((d) => (
                        <div key={d.field} className={styles["compare-row"]}>
                          <span>{d.label}</span>
                          <span>{d.a}</span>
                          <span>{d.b}</span>
                        </div>
                      ))}
                    </>
                  )
                ) : (
                  compareData.similarities.length === 0 ? (
                    <p className={styles["compare-muted"]}>No shared non-default attributes.</p>
                  ) : (
                    <>
                      <div className={`${styles["compare-row"]} ${styles["compare-row-two"]} ${styles["compare-row-head"]}`}>
                        <span>Attribute</span>
                        <span>Shared value</span>
                      </div>
                      {compareData.similarities.map((s) => (
                        <div key={s.field} className={`${styles["compare-row"]} ${styles["compare-row-two"]}`}>
                          <span>{s.label}</span>
                          <span>{s.value}</span>
                        </div>
                      ))}
                    </>
                  )
                )}
              </div>
            </>
          )}
        </div>

        <button type="button" className={styles["uniqueness-modal-close"]} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

export default UniquenessCheckerModal;
