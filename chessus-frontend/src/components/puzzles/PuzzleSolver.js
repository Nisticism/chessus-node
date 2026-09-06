import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { getPieceById } from "../../actions/pieces";
import useBoardViewport from "../common/useBoardViewport";
import BoardZoomControls from "../common/BoardZoomControls";
import boardVp from "../common/boardViewport.module.scss";
import styles from "./puzzlesolver.module.scss";

/*
 * Puzzle solver.
 *
 * Open to everyone, signed in or not - only BUILDING puzzles is a supporter
 * perk. A signed-in solver's attempts are recorded against them; a guest's are
 * anonymous.
 *
 * The answer is never in the page. The client posts the move it played and the
 * server decides, so the solution only arrives once it has been found or the
 * solver has asked to see it. Checking client-side would put the answer one
 * view-source away.
 */

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";
const resolveUrl = (p) => (!p ? null : (p.startsWith('http') ? p : `${ASSET_URL}${p}`));
const keyOf = (x, y) => `${y},${x}`;

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

const goalText = (p) => {
  if (!p) return '';
  if (p.goal === 'checkmate_in_1') return 'Checkmate in one move';
  return p.goal_description || (p.goal === 'win_material' ? 'Win material' : 'Find the move');
};

const FEEDBACK_CATEGORIES = [
  { value: 'multiple_solutions', label: 'Another move also works' },
  { value: 'no_solution', label: "I don't think this can be solved" },
  { value: 'unclear_goal', label: 'The goal is unclear' },
  { value: 'too_easy', label: 'Too easy' },
  { value: 'too_hard', label: 'Too hard' },
  { value: 'praise', label: 'Nice puzzle' },
  { value: 'other', label: 'Something else' },
];

const PuzzleSolver = () => {
  const { gameId, puzzleId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  const [puzzle, setPuzzle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pieceDataMap, setPieceDataMap] = useState({});

  const [placements, setPlacements] = useState({});
  const [selected, setSelected] = useState(null);
  const [lastTry, setLastTry] = useState(null);   // {from,to}
  const [outcome, setOutcome] = useState(null);   // 'solved' | 'wrong' | 'revealed'
  const [attempts, setAttempts] = useState(0);
  const [solution, setSolution] = useState(null);
  const [ratingChange, setRatingChange] = useState(null);
  const [ratingNote, setRatingNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(() => Date.now());

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState('other');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackNotice, setFeedbackNotice] = useState(null);

  const boardWidth = puzzle?.board_width || 8;
  const boardHeight = puzzle?.board_height || 8;
  const lightColor = currentUser?.light_square_color || localStorage.getItem('boardLightColor') || '#e3d4bf';
  const darkColor = currentUser?.dark_square_color || localStorage.getItem('boardDarkColor') || '#64472b';

  const vp = useBoardViewport({
    boardWidth,
    boardHeight,
    fitMaxSquare: 78,
    maxSquare: 160,
    maxHeight: () => Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 300),
    insetW: 8,
    insetH: 8,
  });

  // Same shape as the builder: a floor keeps the hook's measurement stable, and
  // above it the column follows the board's current size so zooming expands
  // sideways instead of clipping. See the builder for the full reasoning.
  const boardColumnMax = useMemo(() => {
    const heightBudget = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 300);
    const byHeight = Math.floor((heightBudget - 8) / Math.max(1, boardHeight));
    const fitSquare = Math.max(6, Math.min(78, byHeight));
    const floorPx = Math.max(120, fitSquare * boardWidth + 24);
    const zoomedPx = (vp.squareSize || 0) * boardWidth + 24;
    const widgetPx = vp.placement === 'side' ? 64 : 0;
    return Math.max(floorPx, zoomedPx) + widgetPx;
  }, [boardWidth, boardHeight, vp.squareSize, vp.placement]);

  const isSkinnyBoard = boardHeight >= boardWidth * 2;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}puzzles/${puzzleId}`, { headers: authHeader() });
        if (cancelled) return;
        const p = data.puzzle;
        setPuzzle(p);
        const map = {};
        (p.position || []).forEach((pl) => { map[keyOf(pl.x, pl.y)] = pl; });
        setPlacements(map);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Could not load this puzzle');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [puzzleId]);

  // Board dimensions are not on the puzzle row; take them from the game type.
  const [board, setBoard] = useState(null);
  useEffect(() => {
    if (!puzzle) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}games/${puzzle.game_type_id}`);
        if (!cancelled) setBoard(data);
      } catch (_) { /* fall back to 8x8 */ }
    })();
    return () => { cancelled = true; };
  }, [puzzle]);
  useEffect(() => {
    if (board && puzzle && (puzzle.board_width !== board.board_width)) {
      setPuzzle((p) => ({ ...p, board_width: board.board_width, board_height: board.board_height, game_name: board.game_name }));
    }
  }, [board, puzzle]);

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
      if (!cancelled && Object.keys(loaded).length) setPieceDataMap((prev) => ({ ...prev, ...loaded }));
    })();
    return () => { cancelled = true; };
  }, [placements, pieceDataMap]);

  const submit = useCallback(async (move) => {
    setBusy(true);
    setLastTry(move);
    try {
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzleId}/solve`,
        { moves: [move], duration_ms: Date.now() - startedAt },
        { headers: authHeader() }
      );
      setAttempts((n) => n + 1);
      if (data.rating) setRatingChange(data.rating);
      else if (data.ratingNote) setRatingNote(data.ratingNote);
      if (data.solved) {
        setOutcome('solved');
        setSolution(data.solution || [move]);
      } else {
        setOutcome('wrong');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not submit that move');
    } finally {
      setBusy(false);
    }
  }, [puzzleId, startedAt]);

  const reveal = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(
        `${API_URL}puzzles/${puzzleId}/solve`,
        { moves: [{ from: { x: -1, y: -1 }, to: { x: -1, y: -1 } }], revealed: true },
        { headers: authHeader() }
      );
      setSolution(data.solution || null);
      setOutcome('revealed');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load the solution');
    } finally {
      setBusy(false);
    }
  }, [puzzleId]);

  const handleSquareClick = useCallback((x, y) => {
    if (busy || outcome === 'solved' || outcome === 'revealed') return;
    const k = keyOf(x, y);
    const here = placements[k];
    if (!selected) {
      if (!here) return;
      if (Number(here.player_id) !== Number(puzzle?.side_to_move)) return;
      setSelected(k);
      return;
    }
    if (selected === k) { setSelected(null); return; }
    const [fy, fx] = selected.split(',').map(Number);
    const mover = placements[selected];
    setSelected(null);
    submit({
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    });
  }, [busy, outcome, selected, placements, puzzle, submit]);

  const sendFeedback = async () => {
    setFeedbackNotice(null);
    try {
      await axios.post(
        `${API_URL}puzzles/${puzzleId}/feedback`,
        { category: feedbackCategory, message: feedbackMessage },
        { headers: authHeader() }
      );
      setFeedbackNotice({ tone: 'ok', text: "Sent to the puzzle's creator. Thanks for the note." });
      setFeedbackMessage('');
      setFeedbackOpen(false);
    } catch (err) {
      setFeedbackNotice({ tone: 'error', text: err?.response?.data?.message || 'Could not send that' });
    }
  };

  if (loading) return <div className={styles["solver-page"]}><p>Loading…</p></div>;
  if (error && !puzzle) return <div className={styles["solver-page"]}><p>{error}</p></div>;
  if (!puzzle) return null;

  const sol = Array.isArray(solution) ? solution[0] : null;
  const squares = [];
  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const k = keyOf(x, y);
      const p = placements[k];
      const isLight = (x + y) % 2 === 0;
      const setup = puzzle.setup_move;
      const classes = [
        styles["square"],
        selected === k ? styles["selected"] : '',
        setup && ((setup.from?.x === x && setup.from?.y === y) || (setup.to?.x === x && setup.to?.y === y)) ? styles["setup"] : '',
        lastTry && lastTry.to.x === x && lastTry.to.y === y && outcome === 'wrong' ? styles["wrong"] : '',
        sol && sol.from?.x === x && sol.from?.y === y ? styles["sol-from"] : '',
        sol && sol.to?.x === x && sol.to?.y === y ? styles["sol-to"] : '',
      ].filter(Boolean).join(' ');
      const src = imageFor(p, pieceDataMap);
      squares.push(
        <div
          key={k}
          className={classes}
          style={{ background: isLight ? lightColor : darkColor, width: vp.squareSize, height: vp.squareSize }}
          onClick={() => handleSquareClick(x, y)}
          title={p ? `${p.piece_name} (Player ${p.player_id})` : ''}
        >
          {src
            ? <img src={src} alt={p.piece_name} draggable={false} />
            : (p ? <span className={styles["piece-fallback"]}>{(p.piece_name || '?').charAt(0)}</span> : null)}
        </div>
      );
    }
  }

  return (
    <div className={`${styles["solver-page"]}${isSkinnyBoard ? ` ${styles["skinny"]}` : ''}`}>
      <h1>{puzzle.title || 'Puzzle'}</h1>
      <p className={styles["subtitle"]}>
        {puzzle.game_name && <>in <Link to={`/games/${puzzle.game_type_id}`}>{puzzle.game_name}</Link></>}
        {puzzle.creator_username && <> · by {puzzle.creator_username}</>}
      </p>

      <div className={styles["layout"]}>
        <div className={styles["board-side"]} style={{ width: boardColumnMax, maxWidth: '100%' }}>
          <div style={{ ...vp.frameStyle, justifyContent: 'flex-start' }}>
            <div
              className={`${boardVp.viewport} ${vp.hideScrollbars ? boardVp.noScrollbars : ''}`}
              ref={vp.viewportRef}
              style={vp.viewportStyle}
            >
              <div style={vp.contentStyle}>
                <div className={styles["board"]} style={{ gridTemplateColumns: `repeat(${boardWidth}, ${vp.squareSize}px)` }}>
                  {squares}
                </div>
              </div>
            </div>
            <BoardZoomControls {...vp.controlProps} />
          </div>
        </div>

        <div className={styles["panel"]}>
          <div className={styles["goal"]}>
            <span className={styles["goal-label"]}>Your goal</span>
            <span className={styles["goal-text"]}>{goalText(puzzle)}</span>
            <span className={styles["goal-side"]}>
              You are Player {puzzle.side_to_move}.
              {puzzle.rating_public && puzzle.rating != null && (
                <> · Rated {puzzle.rating} by {puzzle.rating_sample_count} solvers</>
              )}
            </span>
          </div>

          {puzzle.description && <p className={styles["description"]}>{puzzle.description}</p>}

          {outcome === 'solved' && (
            <div className={`${styles["notice"]} ${styles["notice-ok"]}`}>
              Solved{attempts > 1 ? ` in ${attempts} tries` : ' first try'}. Nicely done.
            </div>
          )}
          {outcome === 'wrong' && (
            <div className={`${styles["notice"]} ${styles["notice-warn"]}`}>
              Not that one. Try again — the position is unchanged.
            </div>
          )}
          {ratingChange && (
            <div className={styles["rating-change"]}>
              Puzzle rating {ratingChange.before} → <strong>{ratingChange.after}</strong>
              <span className={ratingChange.delta >= 0 ? styles["delta-up"] : styles["delta-down"]}>
                {ratingChange.delta >= 0 ? `+${ratingChange.delta}` : ratingChange.delta}
              </span>
            </div>
          )}
          {!ratingChange && ratingNote && (
            <p className={styles["hint"]}>{ratingNote}</p>
          )}
          {outcome === 'revealed' && sol && (
            <div className={`${styles["notice"]} ${styles["notice-info"]}`}>
              The answer was ({sol.from.x}, {sol.from.y}) → ({sol.to.x}, {sol.to.y}), highlighted on the board.
            </div>
          )}
          {error && <div className={`${styles["notice"]} ${styles["notice-error"]}`}>{error}</div>}

          {outcome !== 'solved' && outcome !== 'revealed' && (
            <p className={styles["hint"]}>
              {selected ? 'Now click where it should go.' : 'Click the piece you want to move.'}
            </p>
          )}

          <div className={styles["actions"]}>
            {outcome !== 'solved' && outcome !== 'revealed' && (
              <button className={styles["btn-secondary"]} onClick={reveal} disabled={busy}>
                Show me the answer
              </button>
            )}
            <button className={styles["btn-secondary"]} onClick={() => navigate(`/games/${puzzle.game_type_id}`)}>
              More puzzles
            </button>
          </div>

          {/* Feedback goes to the creator. It cannot take a puzzle down - it is
              a note from a solver, which is why a message is required. */}
          {currentUser && (
            <div className={styles["feedback"]}>
              {!feedbackOpen ? (
                <button className={styles["link-btn"]} onClick={() => setFeedbackOpen(true)}>
                  Send the creator a note about this puzzle
                </button>
              ) : (
                <>
                  <label className={styles["field"]}>
                    <span>What did you notice?</span>
                    <select value={feedbackCategory} onChange={(e) => setFeedbackCategory(e.target.value)}>
                      {FEEDBACK_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className={styles["field"]}>
                    <span>Your note <em>(goes to {puzzle.creator_username || 'the creator'})</em></span>
                    <textarea
                      rows={3}
                      value={feedbackMessage}
                      onChange={(e) => setFeedbackMessage(e.target.value)}
                      maxLength={2000}
                      placeholder="The bishop on the other side also seems to work…"
                    />
                  </label>
                  <div className={styles["actions"]}>
                    <button className={styles["btn"]} onClick={sendFeedback} disabled={feedbackMessage.trim().length < 10}>
                      Send
                    </button>
                    <button className={styles["link-btn"]} onClick={() => setFeedbackOpen(false)}>Cancel</button>
                  </div>
                </>
              )}
              {feedbackNotice && (
                <div className={`${styles["notice"]} ${styles[`notice-${feedbackNotice.tone}`]}`}>
                  {feedbackNotice.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PuzzleSolver;
