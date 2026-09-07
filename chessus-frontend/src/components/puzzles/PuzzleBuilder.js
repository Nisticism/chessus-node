import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
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

// Matches the server's cap. A line is [your move, their reply, ...].
const MAX_MOVES_PER_SIDE = 8;
const MAX_PLIES = MAX_MOVES_PER_SIDE * 2;

const PuzzleBuilder = () => {
  const { gameId, puzzleId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromMatch = location.state?.fromMatch || null;
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
  /*
   * The solution is a flat list of plies that ALTERNATES, starting with the side
   * to move: [your move 1, their reply 1, your move 2, ...]. A one-move puzzle
   * is a list of one, which is exactly the shape puzzles had before longer lines
   * existed, so nothing needs converting.
   *
   * The replies are the creator's script rather than an engine's best defence -
   * there is no engine for user-defined pieces. That is the whole reason a long
   * line cannot be verified the way a mate in 1 can.
   */
  const [solutionLine, setSolutionLine] = useState([]);
  const [setupMove, setSetupMove] = useState(null); // the move that led into the position

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sideToMove, setSideToMove] = useState(1);
  const [goal, setGoal] = useState('checkmate_in_1');
  const [goalDescription, setGoalDescription] = useState('');
  const [hideRating, setHideRating] = useState(false);

  const [pieceDataMap, setPieceDataMap] = useState({});
  const [checkResult, setCheckResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(puzzleId ? Number(puzzleId) : null);

  /*
   * Everything for this game the signed-in account may edit: their own puzzles
   * including drafts, or all of them for an admin or owner. Listed at the foot
   * of the builder so editing an existing puzzle does not mean going back to
   * the game page to find it.
   */
  const [myPuzzles, setMyPuzzles] = useState([]);
  const [puzzleListStaff, setPuzzleListStaff] = useState(false);

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

  const vp = useBoardViewport({
    boardWidth,
    boardHeight,
    fitMaxSquare: 72,
    maxSquare: 160,
    maxHeight: () => Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 320),
    insetW: 8,
    insetH: 8,
  });

  const boardColumnMax = useMemo(() => {
    const heightBudget = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 320);
    const byHeight = Math.floor((heightBudget - 8) / Math.max(1, boardHeight));
    const fitSquare = Math.max(6, Math.min(72, byHeight));

    // The FLOOR is what keeps this from feeding back on itself. useBoardViewport
    // measures this column to decide how wide the board may be, so a width taken
    // purely from the board is a loop; at the floor the width test always clears
    // the height-limited size, which pins fitSquare to the height whatever the
    // column does. 120px minimum only so a one-file board is still clickable.
    const floorPx = Math.max(120, fitSquare * boardWidth + 24);

    // Above the floor the column follows the board's CURRENT size, so zooming in
    // expands sideways into space that is going spare instead of clipping
    // against a frame stuck at the unzoomed width. A tall board then scrolls
    // vertically only - which is the axis that genuinely cannot fit - and
    // max-width: 100% stops it from pushing past the panel.
    const zoomedPx = (vp.squareSize || 0) * boardWidth + 24;

    // Tall boards get the zoom widget mounted beside the board rather than
    // under it, so it takes a bite out of the same column. Without allowing for
    // it the board is squeezed by exactly the widget's width and scrolls
    // sideways when it did not need to.
    const widgetPx = vp.placement === 'side' ? 64 : 0;
    return Math.max(floorPx, zoomedPx) + widgetPx;
  }, [boardWidth, boardHeight, vp.squareSize, vp.placement]);
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

        // Arriving from a match replay: seed the board with that position
        // instead of the game's opening setup. Engine pieces carry the flags
        // that make a piece royal, so they are copied across rather than
        // rebuilt - a position without them can never be checkmate.
        if (fromMatch?.pieces?.length) {
          const seeded = {};
          for (const pc of fromMatch.pieces) {
            const pieceId = pc.piece_id ?? parseInt(String(pc.id).split('_')[0], 10);
            if (!Number.isFinite(pieceId)) continue;
            seeded[keyOf(pc.x, pc.y)] = {
              piece_id: pieceId,
              player_id: Number(pc.player_id ?? pc.team ?? 1),
              piece_name: pc.piece_name,
              image_url: pc.image_url,
              image_location: pc.image_location,
              ends_game_on_checkmate: pc.ends_game_on_checkmate,
              ends_game_on_capture: pc.ends_game_on_capture,
            };
          }
          setPlacements(seeded);
          if (fromMatch.setupMove?.from && fromMatch.setupMove?.to) {
            setSetupMove({ from: fromMatch.setupMove.from, to: fromMatch.setupMove.to });
          }
          setCheckResult({
            tone: 'info',
            text: 'Loaded from the match. Rearrange anything you like, then set the solution.',
          });
        } else {
          setPlacements(parsed);
        }
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
        setHideRating(!!p.hide_rating);
        if (p.setup_move) setSetupMove(p.setup_move);
        if (Array.isArray(p.solution_line)) setSolutionLine(p.solution_line.filter(Boolean));
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

  /*
   * The board as it stands after the moves recorded so far. Solution mode plays
   * forward from the starting position, so every move after the first is chosen
   * from the position the previous one left behind - which is the only way to
   * record a line by hand without keeping the whole thing in your head.
   */
  const solutionBoard = useMemo(() => {
    const next = { ...placements };
    for (const ply of solutionLine) {
      if (!ply?.from || !ply?.to) continue;
      const fromKey = keyOf(ply.from.x, ply.from.y);
      const mover = next[fromKey];
      if (!mover) continue;
      delete next[fromKey];
      next[keyOf(ply.to.x, ply.to.y)] = {
        ...mover,
        /*
         * Stamp the board id the first time a piece moves, from the square it
         * started on. A piece keeps that id for the whole line - the engine
         * never renames it - so a second move by the same piece has to quote it
         * rather than build a new one from where the piece now stands.
         */
        id: mover.id || `${mover.piece_id}_${ply.from.y}_${ply.from.x}`,
        x: ply.to.x,
        y: ply.to.y,
      };
    }
    return next;
  }, [placements, solutionLine]);

  // Which side plays the next ply, and whose move number it is.
  const nextPlyIndex = solutionLine.length;
  const nextIsSolver = nextPlyIndex % 2 === 0;
  const nextSide = nextIsSolver
    ? Number(sideToMove)
    : (Number(sideToMove) === 1 ? 2 : 1);
  const nextMoveNumber = Math.floor(nextPlyIndex / 2) + 1;
  const lineFull = solutionLine.length >= MAX_PLIES;

  const refreshPuzzleList = useCallback(async () => {
    if (!gameId || !allowed) return;
    try {
      const { data } = await axios.get(
        `${API_URL}game-types/${gameId}/puzzles/editable`, { headers: authHeader() }
      );
      setMyPuzzles(data?.puzzles || []);
      setPuzzleListStaff(!!data?.staff);
    } catch (_) { /* the builder still works without the list */ }
  }, [gameId, allowed]);

  useEffect(() => { refreshPuzzleList(); }, [refreshPuzzleList]);

  const positionArray = useMemo(
    () => Object.entries(placements).map(([k, v]) => {
      const [y, x] = k.split(',').map(Number);
      return { ...v, x, y };
    }),
    [placements]
  );

  const handleSquareClick = useCallback((x, y) => {
    const k = keyOf(x, y);
    // Arranging edits the starting position; recording plays forward from it.
    const here = (mode === 'solution' ? solutionBoard : placements)[k];

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

    // Solution mode: pick the piece, then where it goes. Sides alternate, so
    // the same two clicks record your move and then their reply.
    if (lineFull) {
      setCheckResult({ tone: 'warn', text: `A solution can be at most ${MAX_MOVES_PER_SIDE} moves per side.` });
      return;
    }
    if (!selected) {
      if (!here) return;
      if (Number(here.player_id) !== nextSide) {
        setCheckResult({
          tone: 'warn',
          text: `That piece belongs to Player ${here.player_id}, but it is Player ${nextSide}'s turn in the line.`,
        });
        return;
      }
      setSelected(k);
      return;
    }
    if (selected === k) { setSelected(null); return; }
    const [fy, fx] = selected.split(',').map(Number);
    const mover = solutionBoard[selected];
    setSolutionLine((prev) => [...prev, {
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    }]);
    setSelected(null);
    setCheckResult(null);
  }, [mode, selected, placements, solutionBoard, nextSide, lineFull]);

  const body = () => ({
    title: title.trim() || null,
    description: description.trim() || null,
    position: positionArray,
    side_to_move: sideToMove,
    goal,
    goal_description: goalDescription.trim() || null,
    setup_move: setupMove,
    hide_rating: hideRating,
    solution_line: solutionLine,
  });

  const save = async ({ publish = false } = {}) => {
    if (!solutionLine.length) {
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
      refreshPuzzleList();
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

  const boardCells = mode === 'solution' ? solutionBoard : placements;
  const lastPly = mode === 'solution' ? solutionLine[solutionLine.length - 1] : null;

  const squares = [];
  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const k = keyOf(x, y);
      const p = boardCells[k];
      const isLight = (x + y) % 2 === 0;
      const isSelected = selected === k;
      // Highlight the move just recorded, so the line reads as you build it.
      const isFrom = !!lastPly && lastPly.from.x === x && lastPly.from.y === y;
      const isTo = !!lastPly && lastPly.to.x === x && lastPly.to.y === y;
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
          <button className={styles["btn-secondary"]} onClick={() => { setPlacements(startingPlacements); setSolutionLine([]); setSelected(null); }}>
            Reset to starting position
          </button>
          <button className={styles["btn-secondary"]} onClick={() => { setPlacements({}); setSolutionLine([]); setSelected(null); }}>
            Clear the board
          </button>
        </div>
      </div>
      <p className={styles["mode-hint"]}>
        {mode === 'arrange'
          ? 'Click a piece then an empty square to move it. Click a piece twice to take it off the board.'
          : (lineFull
            ? `That is ${MAX_MOVES_PER_SIDE} moves each — as long as a solution can be.`
            : (nextIsSolver
              ? `Play your move ${nextMoveNumber}: click the Player ${nextSide} piece, then where it goes.`
              : `Now play the reply you expect from Player ${nextSide} — the board carries on from there. Leave it here if your move ${Math.ceil(nextPlyIndex / 2)} is the whole answer.`))}
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
            <select value={sideToMove} onChange={(e) => { setSideToMove(Number(e.target.value)); setSolutionLine([]); setSelected(null); }}>
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

          <label className={styles["checkbox-field"]}>
            <input type="checkbox" checked={hideRating} onChange={(e) => setHideRating(e.target.checked)} />
            <span>
              Hide this puzzle's rating
              <InfoTooltip text="A puzzle's rating is the average rating of the people who have solved it. It is hidden from everyone until at least 10 people have solved it; tick this to keep it hidden after that too." />
            </span>
          </label>

          <div className={styles["solution-readout"]}>
            <strong>Solution:</strong>{' '}
            {!solutionLine.length && <em>not set yet</em>}
            {!!solutionLine.length && (
              <>
                <ol className={styles["ply-list"]}>
                  {solutionLine.map((ply, i) => (
                    <li
                      key={i}
                      className={i % 2 === 0 ? styles["ply-yours"] : styles["ply-theirs"]}
                    >
                      <span className={styles["ply-label"]}>
                        {i % 2 === 0
                          ? `Your move ${Math.floor(i / 2) + 1}`
                          : `Their reply ${Math.floor(i / 2) + 1}`}
                      </span>
                      ({ply.from.x}, {ply.from.y}) → ({ply.to.x}, {ply.to.y})
                    </li>
                  ))}
                </ol>
                <button
                  className={styles["link-btn"]}
                  onClick={() => { setSolutionLine((prev) => prev.slice(0, -1)); setSelected(null); }}
                >
                  undo last move
                </button>
                <button
                  className={styles["link-btn"]}
                  onClick={() => { setSolutionLine([]); setSelected(null); }}
                >
                  clear
                </button>
              </>
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
            On a longer line the check confirms every move can actually be played, but the
            replies are the ones you wrote, so whether the opponent could defend better is
            your call.
          </p>

          <button className={styles["link-btn"]} onClick={() => navigate(`/games/${gameId}`)}>
            ← Back to {game?.game_name || 'the game'}
          </button>
        </div>
      </div>

      {myPuzzles.length > 0 && (
        <div className={styles["puzzle-list"]}>
          <h2>
            {puzzleListStaff ? 'All puzzles for this game' : 'Your puzzles for this game'}
            <span className={styles["puzzle-list-count"]}>{myPuzzles.length}</span>
          </h2>
          <p className={styles["puzzle-list-hint"]}>
            Click one to open it here and edit it. Drafts are listed first and are not
            visible to anyone else.
          </p>
          <div className={styles["puzzle-list-rows"]}>
            {myPuzzles.map((pz) => (
              <button
                type="button"
                key={pz.id}
                className={`${styles["puzzle-row"]}${Number(pz.id) === Number(savedId) ? ` ${styles["puzzle-row-current"]}` : ''}`}
                onClick={() => navigate(`/games/${gameId}/puzzles/${pz.id}/edit`)}
              >
                <span className={styles["puzzle-row-title"]}>
                  {!!pz.is_draft && <span className={styles["draft-tag"]}>DRAFT</span>}
                  {pz.title || 'Untitled puzzle'}
                </span>
                <span className={styles["puzzle-row-meta"]}>
                  {pz.goal === 'checkmate_in_1'
                    ? 'Checkmate in 1'
                    : (pz.goal_description || (pz.goal === 'win_material' ? 'Win material' : 'Find the move'))}
                  {pz.solution_depth > 1 && <> · {pz.solution_depth} moves</>}
                  {puzzleListStaff && pz.creator_username && <> · by {pz.creator_username}</>}
                  {pz.attempt_count > 0 && <> · {pz.solve_count}/{pz.attempt_count} solved</>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PuzzleBuilder;
