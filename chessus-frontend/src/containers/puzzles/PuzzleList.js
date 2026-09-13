import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import API_URL from "../../global/global";
import useSeo from "../../hooks/useSeo";
import Pagination from "../../components/pagination/Pagination";
import { formatDateLegacy } from "../../helpers/date-formatter";
import styles from "./puzzlelist.module.scss";

/*
 * Every puzzle on the site, in one place.
 *
 * There was no such page. A puzzle could be reached from its own game, from the
 * home page's daily card, or from a link somebody sent you - but "show me the
 * puzzles" had no answer, and the home page's "Find puzzles" button pointed at
 * the open-games lobby, which lists games looking for an opponent.
 *
 * The filters are on the query string rather than in component state alone, so a
 * filtered list is a URL: shareable, bookmarkable, and unchanged by a refresh or
 * by coming back from a puzzle you just solved.
 */

const PER_PAGE = 24;

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most played' },
  { value: 'hardest', label: 'Hardest' },
  { value: 'easiest', label: 'Easiest' },
];

/** What the puzzle asks for, in the shortest honest words. */
const goalLabel = (p) => {
  if (p.goal === 'checkmate_in_1') return 'Checkmate in 1';
  if (p.goal_description) return p.goal_description;
  if (p.goal === 'win_material') return 'Win material';
  return 'Find the move';
};

const hasAuthor = (name) => name && name !== 'Anonymous' && name !== 'User Deleted';

const PuzzleList = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  const sort = SORTS.some((s) => s.value === params.get('sort')) ? params.get('sort') : 'newest';
  const gameFilter = params.get('game') || '';
  const searchParam = params.get('q') || '';

  const [searchTerm, setSearchTerm] = useState(searchParam);
  const [puzzles, setPuzzles] = useState([]);
  const [games, setGames] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useSeo({
    title: 'Puzzles | GridGrove',
    description: 'Every puzzle on GridGrove, from every game on the site. Free to solve, no account needed.',
    path: '/play/puzzles',
  });

  /*
   * One writer for the query string, so a filter change always resets the page.
   * Changing the sort while on page 4 and landing on a page 4 of a different
   * list is the bug this exists to prevent.
   */
  const setFilter = useCallback((patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Typing should not fire a request per keystroke, and should not reset the
  // page while the person is still mid-word.
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchTerm !== searchParam) setFilter({ q: searchTerm.trim() });
    }, 350);
    return () => clearTimeout(id);
  }, [searchTerm, searchParam, setFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}puzzles`, {
          params: {
            limit: PER_PAGE,
            offset: (page - 1) * PER_PAGE,
            sort,
            gameTypeId: gameFilter || undefined,
            search: searchParam || undefined,
          },
        });
        if (cancelled) return;
        setPuzzles(data?.puzzles || []);
        setTotal(Number(data?.total) || 0);
      } catch (_) {
        if (!cancelled) { setPuzzles([]); setTotal(0); setFailed(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, sort, gameFilter, searchParam]);

  // The filter list is built from puzzles that exist, so it can never offer a
  // game with nothing behind it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}puzzles/games`);
        if (!cancelled) setGames(data?.games || []);
      } catch (_) { /* the filter is a convenience; the list still works */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const isFiltered = !!(searchParam || gameFilter);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className={styles["page"]}>
      <header className={styles["page-header"]}>
        <h1 className={styles["page-title"]}>Puzzles</h1>
        <p className={styles["page-sub"]}>
          Every published puzzle, from every game on the site. Free to solve — no account needed,
          and signing in builds a puzzle rating.
        </p>
      </header>

      <div className={styles["filter-bar"]}>
        <div className={styles["search-wrapper"]}>
          <span className={styles["search-icon"]}>&#128269;</span>
          <input
            type="text"
            placeholder="Search by title, game, or author..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles["search-input"]}
          />
          {searchTerm && (
            <button
              className={styles["search-clear"]}
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
            >&#215;</button>
          )}
        </div>

        <div className={styles["filter-controls"]}>
          <div className={styles["filter-group"]}>
            <span className={styles["filter-label"]}>Game</span>
            <select
              className={styles["filter-select"]}
              value={gameFilter}
              onChange={(e) => setFilter({ game: e.target.value })}
            >
              <option value="">All games</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>{g.game_name} ({g.puzzle_count})</option>
              ))}
            </select>
          </div>

          <div className={styles["filter-group"]}>
            <span className={styles["filter-label"]}>Sort by</span>
            <div className={styles["sort-pills"]}>
              {SORTS.map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles["sort-pill"]} ${sort === opt.value ? styles["sort-pill-active"] : ''}`}
                  onClick={() => setFilter({ sort: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className={styles["count-line"]}>
        {loading ? 'Loading…' : `${total} ${total === 1 ? 'puzzle' : 'puzzles'}`}
        {isFiltered && !loading && (
          <button className={styles["clear-all"]} onClick={() => setFilter({ q: '', game: '', sort: '' })}>
            Clear filters
          </button>
        )}
      </p>

      {failed && (
        <p className={styles["empty"]}>Could not load the puzzles just now. Try again in a moment.</p>
      )}

      {!loading && !failed && puzzles.length === 0 && (
        <p className={styles["empty"]}>
          {isFiltered
            ? 'No puzzles match that. Try a different game or clear the filters.'
            : 'There are no published puzzles yet.'}
        </p>
      )}

      <div className={styles["grid"]}>
        {puzzles.map((p) => (
          <article key={p.id} className={styles["card"]}>
            <button
              type="button"
              className={styles["card-open"]}
              onClick={() => navigate(`/games/${p.game_type_id}/puzzles/${p.id}`)}
            >
              <span className={styles["card-title"]}>{p.title || 'Untitled puzzle'}</span>
              <span className={styles["card-goal"]}>
                {goalLabel(p)}
                {p.solution_depth > 1 && <> · {p.solution_depth} moves</>}
              </span>
            </button>

            {/* The three facts asked for: the game, who wrote it, and when. The
                game and the author are links because they lead somewhere; the
                date is not, because it does not. */}
            <div className={styles["card-meta"]}>
              <Link className={styles["chip"]} to={`/games/${p.game_type_id}`}>
                ♟ {p.game_name || 'Unknown game'}
              </Link>
              {hasAuthor(p.creator_username) ? (
                <Link className={styles["chip"]} to={`/profile/${p.creator_username}`}>
                  {p.creator_username}
                </Link>
              ) : (
                <span className={styles["chip"]}>{p.creator_username || 'User Deleted'}</span>
              )}
              {p.published_at && (
                <span className={styles["date"]}>{formatDateLegacy(p.published_at)}</span>
              )}
            </div>

            <div className={styles["card-foot"]}>
              {p.featured_on && (
                <span className={styles["featured"]} title="This was a Puzzle of the Day">
                  ★ Puzzle of the Day
                </span>
              )}
              <span className={styles["muted"]}>
                {Number(p.attempt_count) > 0
                  ? `${p.solve_count}/${p.attempt_count} solved`
                  : 'Not attempted yet'}
              </span>
              {p.rating_public && p.rating != null && (
                <span className={styles["muted"]}>Rating {Math.round(p.rating)}</span>
              )}
            </div>
          </article>
        ))}
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(n) => {
            setFilter({ page: n });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
    </div>
  );
};

export default PuzzleList;
