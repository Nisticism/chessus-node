import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import StandardButton from "../standardbutton/StandardButton";
import styles from "./admin-dashboard.module.scss";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";

const SLOTS = 9;
// A dropdown of thousands is unusable; a search narrows it, and this caps what one shows.
const MAX_OPTIONS = 200;

/** Does a game match a search: name, creator, or "#id" / a bare id. */
function matches(game, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const asId = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  if (asId != null && game.id === asId) return true;
  return String(game.game_name || '').toLowerCase().includes(q)
    || String(game.creator_name || '').toLowerCase().includes(q);
}

/*
 * One slot: a search box over every published game, and the dropdown of what
 * matches. The game already in the slot stays in its dropdown whatever the
 * search says, so narrowing the list never silently changes a choice.
 */
function FeaturedSlot({ index, games, chosen, takenIds, onChoose }) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const hits = games.filter((g) => matches(g, query));
    const shown = hits.slice(0, MAX_OPTIONS);
    if (chosen && !shown.some((g) => g.id === chosen.id)) shown.unshift(chosen);
    return { shown, total: hits.length };
  }, [games, query, chosen]);

  return (
    <div className={styles["featured-slot"]}>
      <label htmlFor={`featured-slot-${index}`}>Slot {index + 1}</label>
      <input
        type="search"
        className={styles["featured-search"]}
        placeholder="Search by name, creator or #id"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={`Search games for slot ${index + 1}`}
      />
      <select
        id={`featured-slot-${index}`}
        value={chosen?.id || ''}
        onChange={(e) => onChoose(index, e.target.value)}
        className={styles["featured-select"]}
      >
        <option value="">-- None (use popular) --</option>
        {options.shown.map((game) => (
          <option key={game.id} value={game.id} disabled={takenIds.has(game.id) && game.id !== chosen?.id}>
            {game.game_name} ({game.board_width}x{game.board_height}) - {game.play_count || 0} plays{game.is_draft ? ' - draft' : ''}
          </option>
        ))}
      </select>
      <div className={styles["featured-search-count"]}>
        {query.trim()
          ? `${options.total} match${options.total === 1 ? '' : 'es'}${options.total > MAX_OPTIONS ? ` - showing the first ${MAX_OPTIONS}` : ''}`
          : `${games.length} games${games.length > MAX_OPTIONS ? ` - search to see past the ${MAX_OPTIONS} most played` : ''}`}
      </div>
      {chosen && (
        <div className={styles["featured-preview"]}>
          <strong>{chosen.game_name}</strong>
          <span>by {chosen.creator_name || 'Unknown'}</span>
          <span>{chosen.board_width}x{chosen.board_height} board</span>
        </div>
      )}
    </div>
  );
}

/**
 * Admin tab: the nine games featured on the home page ("Explore the Grove").
 * Any published game can be chosen - the list is every one, searchable per slot.
 */
export default function FeaturedGamesPanel() {
  const [slots, setSlots] = useState(Array(SLOTS).fill(null));
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}admin/featured-games`, { headers: authHeader() });
      const next = Array(SLOTS).fill(null);
      for (const game of data.featured || []) {
        if (game.featured_order >= 1 && game.featured_order <= SLOTS) next[game.featured_order - 1] = game;
      }
      setSlots(next);
      setGames(data.allGames || []);
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.message || 'Failed to load featured games' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const takenIds = useMemo(() => new Set(slots.filter(Boolean).map((g) => g.id)), [slots]);

  const choose = (index, gameId) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = gameId === '' ? null : (games.find((g) => g.id === Number(gameId)) || null);
      return next;
    });
  };

  const save = async () => {
    setNotice(null);
    try {
      await axios.put(`${API_URL}admin/featured-games`, { featuredGameIds: slots.map((g) => g?.id || null) }, { headers: authHeader() });
      setNotice({ tone: 'ok', text: 'Featured games saved.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.message || 'Failed to save featured games' });
    }
  };

  if (loading) return <div className={styles["featured-container"]}><p>Loading…</p></div>;

  return (
    <div className={styles["featured-container"]}>
      <h2 style={{ marginBottom: '20px', color: 'var(--accent-primary)' }}>Featured Games on Homepage</h2>
      <p style={{ marginBottom: '30px', color: 'var(--text-dim)' }}>
        Select up to 9 games to feature on the homepage. These games will be displayed in the "Explore the Grove" section above the popular games.
        Leave a slot empty to fall back to popular games. Slots are shown in a 3&times;3 grid on the home page.
        Any published game can be chosen: search a slot by name, creator or #id.
      </p>

      {notice && <p className={styles[notice.tone === 'ok' ? 'success' : 'error']}>{notice.text}</p>}

      <div className={styles["featured-slots"]}>
        {slots.map((chosen, index) => (
          // The slot number is the identity, so it is the key.
          <FeaturedSlot key={index} index={index} games={games} chosen={chosen} takenIds={takenIds} onChoose={choose} />
        ))}
      </div>

      <div style={{ marginTop: '30px' }}>
        <StandardButton onClick={save} buttonText="Save Featured Games" />
      </div>
    </div>
  );
}
