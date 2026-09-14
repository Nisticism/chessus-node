import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import useSeo from "../../hooks/useSeo";
import { PLATFORM_ACCOUNT_USERNAME } from "../../helpers/platform-account";
import styles from "./newpuzzle.module.scss";

/*
 * Where building a puzzle starts.
 *
 * The builder has always needed a game before it can draw anything, so the only
 * way in was from a game's own page - which meant knowing to look there, and
 * meant "make a puzzle" had no home of its own in the menu. This is that home:
 * pick the game first, then build.
 *
 * Arriving with a game already chosen (/create/puzzle/:gameId) skips this
 * entirely and goes straight to the builder, so the route from a game's page is
 * one click, exactly as it was.
 */

const NewPuzzle = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  useSeo({
    title: 'New Puzzle | GridGrove',
    description: 'Build a puzzle from one of your games.',
    path: '/create/puzzle',
  });

  useEffect(() => {
    if (!currentUser?.id) { setLoading(false); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        /*
         * Two lists: the games this person made, and the games the site itself
         * owns - Chess, Go, the ones nobody here invented.
         *
         * The platform's games are open to everyone to build on, under the same
         * allowance as your own: three each for a free account, uncapped for a
         * supporter, counted per game. Somebody with no games of their own can
         * now build a puzzle on the day they arrive, which used to require
         * designing a whole game first.
         *
         * Asked for by NAME rather than by id, because the platform account's
         * id differs between databases.
         */
        const unwrap = (data) =>
          (Array.isArray(data) ? data : (data?.games || data?.rows || [])).filter(Boolean);
        const [mineRes, platformRes] = await Promise.all([
          axios.get(`${API_URL}games?creatorId=${currentUser.id}&limit=200`,
            { headers: authHeader() }),
          axios.get(`${API_URL}games?creatorUsername=${encodeURIComponent(PLATFORM_ACCOUNT_USERNAME)}&limit=50`),
        ]);
        if (cancelled) return;
        const mine = unwrap(mineRes.data).map((g) => ({ ...g, isPlatform: false }));
        const mineIds = new Set(mine.map((g) => Number(g.id)));
        const platform = unwrap(platformRes.data)
          // The platform account's own games, unless this IS the platform
          // account looking at its own list - then they are already above.
          .filter((g) => !mineIds.has(Number(g.id)))
          .map((g) => ({ ...g, isPlatform: true }));
        setGames([...mine, ...platform]);
      } catch (_) {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const nameOf = (g) => g.game_name || g.name || `Game ${g.id}`;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => nameOf(g).toLowerCase().includes(q));
  }, [games, query]);

  // Close when the click lands outside, the way every other dropdown here does.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (game) => {
    if (!game) return;
    navigate(`/create/puzzle/${game.id}`);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(matches[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  if (!currentUser) {
    return (
      <div className={styles["page"]}>
        <h1 className={styles["title"]}>New puzzle</h1>
        <p className={styles["empty"]}>
          <Link className={styles["link"]} to="/login">Sign in</Link> to build a puzzle.
        </p>
      </div>
    );
  }

  return (
    <div className={styles["page"]}>
      <h1 className={styles["title"]}>New puzzle</h1>
      <p className={styles["sub"]}>
        Choose the game your puzzle is played on — one of yours, or one of GridGrove's
        own. Its pieces, board and rules are what the puzzle will use, so the solver plays
        it exactly as the game is.
      </p>

      {loading && <p className={styles["empty"]}>Loading games…</p>}

      {!loading && failed && (
        <p className={styles["empty"]}>Could not load the games just now. Try again in a moment.</p>
      )}

      {/* The case worth handling properly rather than showing an empty box: a
          puzzle needs a game, and if there is no game there is nothing to pick. */}
      {!loading && !failed && games.length === 0 && (
        <div className={styles["none"]}>
          <p className={styles["none-title"]}>There are no games to build a puzzle for.</p>
          <p className={styles["none-body"]}>
            A puzzle is a position in a specific game — its board, its pieces, its rules —
            so there has to be a game first.
          </p>
          <Link className={styles["btn"]} to="/create/game">Create a game</Link>
        </div>
      )}

      {!loading && !failed && games.length > 0 && (
        <div className={styles["picker"]} ref={boxRef}>
          <label className={styles["label"]} htmlFor="puzzle-game-search">Game</label>
          <input
            id="puzzle-game-search"
            className={styles["input"]}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls="puzzle-game-list"
            autoComplete="off"
            placeholder={games.length > 6 ? 'Search games…' : 'Pick a game…'}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />

          {open && (
            <ul className={styles["list"]} id="puzzle-game-list" role="listbox">
              {matches.length === 0 && (
                <li className={styles["no-match"]}>No game matches “{query.trim()}”.</li>
              )}
              {matches.map((g, i) => (
                <li key={g.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    className={`${styles["option"]} ${i === highlight ? styles["option-active"] : ''}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(g)}
                  >
                    <span className={styles["option-name"]}>
                      {nameOf(g)}
                      {/* Said on the row rather than as a separate section, so
                          searching still returns one flat list. */}
                      {g.isPlatform && (
                        <span className={styles["option-tag"]}>GridGrove</span>
                      )}
                    </span>
                    <span className={styles["option-meta"]}>
                      {g.board_width}×{g.board_height}
                      {g.is_draft ? ' · draft' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default NewPuzzle;
