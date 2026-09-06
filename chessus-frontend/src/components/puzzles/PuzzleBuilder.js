import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { getGameById } from "../../actions/games";
import { getPieceById } from "../../actions/pieces";
import { useDispatch } from "react-redux";
import { canCreatePuzzles } from "../../helpers/supporterTiers";
import InfoTooltip from "../piecewizard/InfoTooltip";
import useBoardViewport from "../common/useBoardViewport";
import BoardZoomControls from "../common/BoardZoomControls";
import boardVp from "../common/boardViewport.module.scss";
import styles from "./puzzlebuilder.module.scss";

/*
 * Puzzle builder.
 *
 * Two modes over one board. ARRANGE sets up the position - drag a piece to an
 * empty square, click it twice to remove it - and SOLUTION records the move the
 * solver is meant to find.
 *
 * Positions are stored in the same compact shape as a game type's
 * pieces_string ({ piece_id, player_id, x, y } plus the per-game-type royal
 * flags) rather than as full piece definitions. The server merges the movement
 * columns back in when it needs to run the engine, so the answer to "what does
 * this piece do" always comes from one place.
 */

const GOALS = [
  { value: 'checkmate_in_1', label: 'Checkmate in 1', help: 'The only goal the server can check for you. It will tell you if another move also mates.' },
  { value: 'win_material', label: 'Win material', help: 'Say what the solver should win, e.g. "win the rook".' },
  { value: 'specific_move', label: 'Find this exact move', help: 'The answer is the move you record, whatever the reason.' },
  { value: 'custom', label: 'Something else', help: 'Describe the goal in your own words.' },
];

// Declared locally, as everywhere else in the app - global.js does not export it.
const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const keyOf = (x, y) => `${y},${x}`;

const resolveUrl = (p) => (!p ? null : (p.startsWith('http') ? p : `${ASSET_URL}${p}`));

/**
 * Same precedence the rest of the site uses: the placement's own image_url is a
 * deliberate per-square override, so it wins. The piece's image_location is the
 * fallback, indexed by player - which is also the only source that stays correct
 * if a placement was written with an since-moved asset host.
 */
const imageFor = (placement, pieceDataMap) => {
  if (placement?.image_url) return resolveUrl(placement.image_url);
  const loc = placement?.image_location || pieceDataMap[placement?.piece_id]?.image_location;
  if (!loc) return null;
  try {
    const images = typeof loc === 'string' ? JSON.parse(loc) : loc;
    if (Array.isArray(images) && images.length) {
      const idx = Math.min(Number(placement.player_id || 1) - 1, images.length - 1);
      return resolveUrl(images[Math.max(0, idx)]);
    }
  } catch (_) { /* fall through */ }
  return null;
};

const PuzzleBuilder = () => {
  const { gameId, puzzleId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Board contents, keyed "y,x" to match pieces_string.
  const [placements, setPlacements] = useState({});
  const [startingPlacements, setStartingPlacements] = useState({});

  const [mode, setMode] = useState('arrange');   // 'arrange' | 'solution'
  const [selected, setSelected] = useState(null); // "y,x" of the held piece
  const [solution, setSolution] = useState(null); // { from:{x,y}, to:{x,y}, pieceId }

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sideToMove, setSideToMove] = useState(1);
  const [goal, setGoal] = useState('checkmate_in_1');
  const [goalDescription, setGoalDescription] = useState('');

  const [pieceDataMap, setPieceDataMap] = useState({});
  const [checkResult, setCheckResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(puzzleId ? Number(puzzleId) : null);

  const allowed = canCreatePuzzles(currentUser);

  const boardWidth = game?.board_width || 8;
  const boardHeight = game?.board_height || 8;

  // The shared fit/zoom hook, so a 3x48 or a 25x10 board behaves here exactly
  // as it does in a live game: sized to fit by default, zoomable past that,
  // scrolling inside its own frame rather than stretching the page.
  // How wide the board can possibly be at its default zoom, worked out from the
  // window and the board's own rows - never from the space available. That
  // independence is the point: the board column is capped to this, and the cap
  // feeds the hook's width budget, so deriving it from the available width
  // would be a loop that shrinks the board a square per pass.
  //
  // Without the cap a 3x48 board renders as a thin strip centred in a full-width
  // column, leaving a gulf between it and the settings panel.
  // A board much taller than it is wide leaves the board+settings pair hugging
  // the left of a 1140px panel with a lot of dead space to the right, and the
  // toolbar strung out across the top of nothing. Both centre instead, and the
  // four toolbar buttons stack into a 2x2 block.
  const isSkinnyBoard = boardHeight >= boardWidth * 2;

  const boardColumnMax = useMemo(() => {
    const heightBudget = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 320);
    const byHeight = Math.floor((heightBudget - 8) / Math.max(1, boardHeight));
    const square = Math.max(6, Math.min(72, byHeight));
    // Small floor only - the mode tabs, hint and board buttons sit in a
    // full-width toolbar above the layout, not in this column, so nothing here
    // needs room beyond the board itself. That is what lets a 3x48 board sit
    // right next to the settings instead of stranding 290px of empty column.
    return Math.max(120, square * boardWidth + 24);
  }, [boardWidth, boardHeight]);

  const vp = useBoardViewport({
    boardWidth,
    boardHeight,
    fitMaxSquare: 72,
    maxSquare: 160,
    maxHeight: () => Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 320),
    insetW: 8,
    insetH: 8,
  });
  const lightColor = currentUser?.light_square_color || localStorage.getItem('boardLightColor') || '#e3d4bf';
  const darkColor = currentUser?.dark_square_color || localStorage.getItem('boardDarkColor') || '#64472b';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await dispatch(getGameById(gameId));
        if (cancelled) return;
        setGame(data);
        let parsed = {};
        try { parsed = data.pieces_string ? JSON.parse(data.pieces_string) : {}; } catch (_) { parsed = {}; }
        setStartingPlacements(parsed);
        setPlacements(parsed);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load this game');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gameId, dispatch]);

  // Load an existing draft for editing.
  useEffect(() => {
    if (!puzzleId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}puzzles/${puzzleId}`, { headers: authHeader() });
        if (cancelled) return;
        const p = data.puzzle;
        const map = {};
        (p.position || []).forEach((pl) => { map[keyOf(pl.x, pl.y)] = pl; });
        setPlacements(map);
        setTitle(p.title || '');
        setDescription(p.description || '');
        setSideToMove(p.side_to_move || 1);
        setGoal(p.goal || 'checkmate_in_1');
        setGoalDescription(p.goal_description || '');
        if (Array.isArray(p.solution_line) && p.solution_line[0]) setSolution(p.solution_line[0]);
      } catch (err) {
        if (!cancelled) setError('Could not load that puzzle');
      }
    })();
    return () => { cancelled = true; };
  }, [puzzleId]);

  // Piece definitions for anything on the board, so images survive a placement
  // written against an old asset host.
  useEffect(() => {
    const ids = [...new Set(Object.values(placements).map((p) => p.piece_id).filter(Boolean))];
    const missing = ids.filter((id) => !pieceDataMap[id]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const loaded = {};
      await Promise.all(missing.map(async (id) => {
        try { loaded[id] = await getPieceById(id); } catch (_) { /* image falls back */ }
      }));
      if (!cancelled && Object.keys(loaded).length) {
        setPieceDataMap((prev) => ({ ...prev, ...loaded }));
      }
    })();
    return () => { cancelled = true; };
  }, [placements, pieceDataMap]);

  const positionArray = useMemo(
    () => Object.entries(placements).map(([k, v]) => {
      const [y, x] = k.split(',').map(Number);
      return { ...v, x, y };
    }),
    [placements]
  );

  const handleSquareClick = useCallback((x, y) => {
    const k = keyOf(x, y);
    const here = placements[k];

    if (mode === 'arrange') {
      if (selected === k) {
        // Second click on the held piece removes it - the board is the palette.
        setPlacements((prev) => { const next = { ...prev }; delete next[k]; return next; });
        setSelected(null);
        return;
      }
      if (selected) {
        setPlacements((prev) => {
          const next = { ...prev };
          const moving = next[selected];
          delete next[selected];
          if (moving) next[k] = moving;
          return next;
        });
        setSelected(null);
        return;
      }
      if (here) setSelected(k);
      return;
    }

    // Solution mode: pick the piece, then where it goes.
    if (!selected) {
      if (!here) return;
      if (Number(here.player_id) !== Number(sideToMove)) {
        setCheckResult({ tone: 'warn', text: `That piece belongs to Player ${here.player_id}, but Player ${sideToMove} is to move.` });
        return;
      }
      setSelected(k);
      return;
    }
    const [fy, fx] = selected.split(',').map(Number);
    const mover = placements[selected];
    setSolution({
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    });
    setSelected(null);
    setCheckResult(null);
  }, [mode, selected, placements, sideToMove]);

  const body = () => ({
    title: title.trim() || null,
    description: description.trim() || null,
    position: positionArray,
    side_to_move: sideToMove,
    goal,
    goal_description: goalDescription.trim() || null,
    solution_line: solution ? [solution] : [],
  });

  const save = async ({ publish = false } = {}) => {
    if (!solution) {
      setCheckResult({ tone: 'warn', text: 'Record the solution first: switch to "Set the solution" and play the move.' });
      return null;
    }
    setBusy(true);
    setCheckResult(null);
    try {
      let id = savedId;
      if (id) {
        await axios.put(`${API_URL}puzzles/${id}`, body(), { headers: authHeader() });
      } else {
        const { data } = await axios.post(`${API_URL}game-types/${gameId}/puzzles`, body(), { headers: authHeader() });
        id = data.puzzle.id;
        setSavedId(id);
      }
      if (publish) {
        await axios.post(`${API_URL}puzzles/${id}/publish`, { publish: true }, { headers: authHeader() });
      }
      setCheckResult({ tone: 'ok', text: publish ? 'Published.' : 'Saved as a draft.' });
      return id;
    } catch (err) {
      setCheckResult({ tone: 'error', text: err?.response?.data?.message || 'Could not save this puzzle' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    const id = await save();
    if (!id) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API_URL}puzzles/${id}/validate`, {}, { headers: authHeader() });
      if (data.status === 'valid') {
        setCheckResult({ tone: 'ok', text: 'Checked: exactly one move mates, and it is yours.' });
      } else if (data.status === 'ambiguous') {
        setCheckResult({
          tone: 'warn',
          text: `${data.solutionCount} different moves mate here. That is allowed — solvers may just find a different one. ${data.detail || ''}`,
        });
      } else if (data.status === 'unsolvable') {
        setCheckResult({ tone: 'error', text: data.detail || 'Your recorded move does not achieve the goal.' });
      } else {
        setCheckResult({ tone: 'info', text: data.detail || 'Only mate in 1 can be checked automatically. Solvers will let you know how this one plays.' });
      }
    } catch (err) {
      setCheckResult({ tone: 'error', text: err?.response?.data?.message || 'Could not check this puzzle' });
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className={styles["builder-page"]}>
        <div className={styles["locked"]}>
          <h1>Puzzle Builder</h1>
          <p>Building puzzles is a Silver Supporter perk. Solving them is free for everyone.</p>
          <button className={styles["btn"]} onClick={() => navigate('/donate')}>Support the site</button>
        </div>
      </div>
    );
  }
  if (loading) return <div className={styles["builder-page"]}><p>Loading…</p></div>;
  if (error) return <div className={styles["builder-page"]}><p>{error}</p></div>;

  const squares = [];
  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const k = keyOf(x, y);
      const p = placements[k];
      const isLight = (x + y) % 2 === 0;
      const isSelected = selected === k;
      const isFrom = solution && solution.from.x === x && solution.from.y === y;
      const isTo = solution && solution.to.x === x && solution.to.y === y;
      squares.push(
        <div
          key={k}
          className={[
            styles["square"],
            isSelected ? styles["selected"] : '',
            isFrom ? styles["sol-from"] : '',
            isTo ? styles["sol-to"] : '',
          ].filter(Boolean).join(' ')}
          style={{
            background: isLight ? lightColor : darkColor,
            width: vp.squareSize,
            height: vp.squareSize,
          }}
          onClick={() => handleSquareClick(x, y)}
          title={p ? `${p.piece_name} (Player ${p.player_id})` : ''}
        >
          {(() => {
            const src = imageFor(p, pieceDataMap);
            return src ? <img src={src} alt={p.piece_name} draggable={false} /> : (
              p ? <span className={styles["piece-fallback"]}>{(p.piece_name || '?').charAt(0)}</span> : null
            );
          })()}
        </div>
      );
    }
  }

  return (
    <div className={`${styles["builder-page"]}${isSkinnyBoard ? ` ${styles["skinny"]}` : ''}`}>
      <h1>{savedId ? 'Edit Puzzle' : 'New Puzzle'}{game ? ` — ${game.game_name}` : ''}</h1>

      {/* Page-level controls, deliberately not inside the board column: they need
          a readable width, and keeping them there forced a floor on that column
          that stranded empty space beside skinny boards. */}
      <div className={styles["toolbar"]}>
        <div className={styles["mode-tabs"]}>
          <button
            className={mode === 'arrange' ? styles["tab-active"] : styles["tab"]}
            onClick={() => { setMode('arrange'); setSelected(null); }}
          >
            1. Arrange the position
          </button>
          <button
            className={mode === 'solution' ? styles["tab-active"] : styles["tab"]}
            onClick={() => { setMode('solution'); setSelected(null); }}
          >
            2. Set the solution
          </button>
        </div>
        <div className={styles["board-actions"]}>
          <button className={styles["btn-secondary"]} onClick={() => { setPlacements(startingPlacements); setSolution(null); setSelected(null); }}>
            Reset to starting position
          </button>
          <button className={styles["btn-secondary"]} onClick={() => { setPlacements({}); setSolution(null); setSelected(null); }}>
            Clear the board
          </button>
        </div>
      </div>
      <p className={styles["mode-hint"]}>
        {mode === 'arrange'
          ? 'Click a piece then an empty square to move it. Click a piece twice to take it off the board.'
          : `Click the piece Player ${sideToMove} should move, then the square it moves to.`}
      </p>

      <div className={styles["layout"]}>
        {/* A DEFINITE width, not max-width. useBoardViewport measures this column
            to size the board, so an `auto` grid track sized by its content is a
            loop: the board shrinks, the column shrinks with it, and it settles
            at the 6px minimum square. */}
        <div className={styles["board-side"]} style={{ width: boardColumnMax, maxWidth: '100%' }}>
          {/* width is what the board WANTS; max-width is what the page allows.
              Both are page- or window-derived, never content-derived, so the
              hook's measurement stays stable either way. */}
          <div style={{ ...vp.frameStyle, justifyContent: 'flex-start' }}>
            <div
              className={`${boardVp.viewport} ${vp.hideScrollbars ? boardVp.noScrollbars : ''}`}
              ref={vp.viewportRef}
              style={vp.viewportStyle}
            >
              <div style={vp.contentStyle}>
                <div
                  className={styles["board"]}
                  style={{ gridTemplateColumns: `repeat(${boardWidth}, ${vp.squareSize}px)` }}
                >
                  {squares}
                </div>
              </div>
            </div>
            <BoardZoomControls {...vp.controlProps} />
          </div>

        </div>

        <div className={styles["form-side"]}>
          <label className={styles["field"]}>
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Back rank trap" />
          </label>

          <label className={styles["field"]}>
            <span>Description <em>(optional)</em></span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
          </label>

          <label className={styles["field"]}>
            <span>Who moves?</span>
            <select value={sideToMove} onChange={(e) => { setSideToMove(Number(e.target.value)); setSolution(null); }}>
              <option value={1}>Player 1</option>
              <option value={2}>Player 2</option>
            </select>
          </label>

          <label className={styles["field"]}>
            <span>
              Goal
              <InfoTooltip text={GOALS.find((g) => g.value === goal)?.help || ''} />
            </span>
            <select value={goal} onChange={(e) => setGoal(e.target.value)}>
              {GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>

          {goal !== 'checkmate_in_1' && (
            <label className={styles["field"]}>
              <span>What should the solver do?</span>
              <input
                value={goalDescription}
                onChange={(e) => setGoalDescription(e.target.value)}
                maxLength={255}
                placeholder="Win the rook"
              />
            </label>
          )}

          <div className={styles["solution-readout"]}>
            <strong>Solution:</strong>{' '}
            {solution
              ? `(${solution.from.x}, ${solution.from.y}) → (${solution.to.x}, ${solution.to.y})`
              : <em>not set yet</em>}
            {solution && (
              <button className={styles["link-btn"]} onClick={() => setSolution(null)}>clear</button>
            )}
          </div>

          {checkResult && (
            <div className={`${styles["notice"]} ${styles[`notice-${checkResult.tone}`]}`}>
              {checkResult.text}
            </div>
          )}

          <div className={styles["form-actions"]}>
            <button className={styles["btn-secondary"]} onClick={check} disabled={busy}>
              {busy ? 'Working…' : 'Check puzzle'}
            </button>
            <button className={styles["btn-secondary"]} onClick={() => save()} disabled={busy}>
              Save draft
            </button>
            <button className={styles["btn"]} onClick={() => save({ publish: true })} disabled={busy}>
              Publish
            </button>
          </div>
          <p className={styles["fine-print"]}>
            Checking is advice, not a gate — you can publish either way. Only “checkmate in 1”
            can be checked automatically; everything else is judged by the people solving it.
          </p>

          <button className={styles["link-btn"]} onClick={() => navigate(`/games/${gameId}`)}>
            ← Back to {game?.game_name || 'the game'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PuzzleBuilder;
